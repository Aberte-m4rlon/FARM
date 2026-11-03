#!/usr/bin/env python3
"""Prepare the private Tapo C320WS Roboflow export with chronological holdouts."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from PIL import Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "datasets" / "tapo_c320ws_2026-10-17"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
FRAME_PATTERN = re.compile(r"^(?P<source>.+_mp4)-(?P<frame>\d+)_jpg(?:\.rf\.|$)", re.IGNORECASE)
# The export contains a single source video. Keep chronological intervals apart
# so nearly identical neighboring frames cannot straddle a split boundary.
SPLIT_WINDOWS = {
    "train": (0, 249),
    "val": (275, 350),
    "test": (375, 524),
}
MIN_GAP_FRAMES = 24


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_label(text: str, label_path: str) -> Counter[int]:
    counts: Counter[int] = Counter()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        columns = line.split()
        if len(columns) != 5:
            raise ValueError(f"Expected five YOLO columns in {label_path}:{line_number}.")
        try:
            class_value = float(columns[0])
            x_center, y_center, width, height = map(float, columns[1:])
        except ValueError as error:
            raise ValueError(f"Non-numeric YOLO label in {label_path}:{line_number}.") from error
        if class_value not in (0, 1) or class_value != int(class_value):
            raise ValueError(f"Only class 0=goat and 1=sheep are accepted in {label_path}:{line_number}.")
        if not all(map(lambda value: value == value and abs(value) != float("inf"), (x_center, y_center, width, height))):
            raise ValueError(f"Non-finite bounding box in {label_path}:{line_number}.")
        if not (0 <= x_center <= 1 and 0 <= y_center <= 1 and 0 < width <= 1 and 0 < height <= 1):
            raise ValueError(f"Bounding box is outside normalized YOLO bounds in {label_path}:{line_number}.")
        if x_center - width / 2 < -1e-6 or x_center + width / 2 > 1 + 1e-6 or y_center - height / 2 < -1e-6 or y_center + height / 2 > 1 + 1e-6:
            raise ValueError(f"Bounding box extends beyond the image in {label_path}:{line_number}.")
        counts[int(class_value)] += 1
    return counts


def prepare(archive_path: Path, output: Path) -> dict[str, Any]:
    archive_path = archive_path.resolve()
    output = output.resolve()
    if not archive_path.is_file():
        raise ValueError(f"Dataset ZIP does not exist: {archive_path}")
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory already contains files; refusing to overwrite: {output}")

    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError(f"Could not open dataset ZIP: {error}") from error

    with archive:
        infos = archive.infolist()
        if len(infos) > 10_000 or sum(item.file_size for item in infos) > 2_000_000_000:
            raise ValueError("Dataset archive exceeds the safe size or file-count limit.")
        for info in infos:
            name = info.filename.replace("\\", "/")
            parts = PurePosixPath(name).parts
            if name.startswith("/") or ".." in parts or (parts and ":" in parts[0]):
                raise ValueError(f"Unsafe path in dataset ZIP: {info.filename}")

        yaml_infos = [item for item in infos if PurePosixPath(item.filename).name.lower() == "data.yaml"]
        if not yaml_infos:
            raise ValueError("Roboflow data.yaml is missing from the ZIP.")
        yaml_info = min(yaml_infos, key=lambda item: len(PurePosixPath(item.filename).parts))
        source_config = yaml.safe_load(archive.read(yaml_info).decode("utf-8-sig"))
        names = source_config.get("names") if isinstance(source_config, dict) else None
        if not isinstance(names, list) or [str(name).strip().lower() for name in names] != ["goat", "sheep"]:
            raise ValueError(f"Expected classes in order Goat, Sheep; found {names!r}.")

        image_infos: dict[str, zipfile.ZipInfo] = {}
        label_infos: dict[str, zipfile.ZipInfo] = {}
        valid_split_roots = {"train", "valid", "test"}
        for info in infos:
            if info.is_dir():
                continue
            parts = PurePosixPath(info.filename).parts
            if len(parts) != 3 or parts[0] not in valid_split_roots or parts[1] not in {"images", "labels"}:
                continue
            key = f"{parts[0]}/{parts[2]}"
            extension = PurePosixPath(parts[2]).suffix.lower()
            collection = image_infos if parts[1] == "images" and extension in IMAGE_EXTENSIONS else label_infos if parts[1] == "labels" and extension == ".txt" else None
            if collection is not None:
                if key in collection:
                    raise ValueError(f"Duplicate file entry in dataset ZIP: {info.filename}")
                collection[key] = info

        if not image_infos:
            raise ValueError("No YOLO images found in the ZIP.")
        expected_label_keys = {
            f"{PurePosixPath(key).parts[0]}/{PurePosixPath(key).parts[1].rsplit('.', 1)[0]}.txt"
            for key in image_infos
        }
        if expected_label_keys != set(label_infos):
            missing_labels = sorted(expected_label_keys - set(label_infos))[:3]
            orphan_labels = sorted(set(label_infos) - expected_label_keys)[:3]
            raise ValueError(f"Images/labels do not match; missing labels={missing_labels}, orphan labels={orphan_labels}.")

        records: list[dict[str, Any]] = []
        source_ids: set[str] = set()
        used_names: set[str] = set()
        class_totals: dict[str, Counter[int]] = {split: Counter() for split in SPLIT_WINDOWS}
        for key, image_info in sorted(image_infos.items()):
            original_split, filename = key.split("/", 1)
            match = FRAME_PATTERN.match(filename)
            if not match:
                raise ValueError(f"Cannot read source video/frame from image filename: {filename}")
            source_id = match.group("source")
            frame_index = int(match.group("frame"))
            source_ids.add(source_id)
            split = next((name for name, (first, last) in SPLIT_WINDOWS.items() if first <= frame_index <= last), None)
            label_key = f"{original_split}/{Path(filename).with_suffix('.txt').name}"
            label_text = archive.read(label_infos[label_key]).decode("utf-8-sig")
            label_counts = _validate_label(label_text, label_key)
            try:
                with Image.open(archive.open(image_info)) as image:
                    image.verify()
                    if image.width < 2 or image.height < 2:
                        raise ValueError(f"Image is too small: {filename}")
            except (OSError, UnidentifiedImageError) as error:
                raise ValueError(f"Image is corrupt: {filename}: {error}") from error
            record = {
                "original_split": original_split,
                "filename": filename,
                "frame_index": frame_index,
                "source_id": source_id,
                "split": split,
                "image_info": image_info,
                "label_text": label_text,
                "label_counts": label_counts,
            }
            records.append(record)
            if split:
                if filename in used_names:
                    raise ValueError(f"Image basename is duplicated across source splits: {filename}")
                used_names.add(filename)
                class_totals[split].update(label_counts)

        if len(source_ids) != 1:
            raise ValueError(f"This chronological split is for one source video; found {len(source_ids)} video IDs.")
        for split, counts in class_totals.items():
            if any(counts[class_id] == 0 for class_id in (0, 1)):
                raise ValueError(f"{split} interval needs both goat and sheep labels; found {dict(counts)}.")

        # Reject exact duplicate image content across the selected intervals.
        image_hashes: dict[str, tuple[str, str]] = {}
        selected = [record for record in records if record["split"]]
        for record in selected:
            content = archive.read(record["image_info"])
            digest = hashlib.sha256(content).hexdigest()
            previous = image_hashes.get(digest)
            if previous and previous[0] != record["split"]:
                raise ValueError(f"Identical image content crosses temporal splits: {previous[1]} and {record['filename']}.")
            image_hashes[digest] = (record["split"], record["filename"])

        output.mkdir(parents=True, exist_ok=True)
        rows: list[dict[str, Any]] = []
        split_summary: dict[str, Any] = {}
        for split, (first_frame, last_frame) in SPLIT_WINDOWS.items():
            split_records = [record for record in selected if record["split"] == split]
            for record in split_records:
                image_path = output / "images" / split / record["filename"]
                label_path = output / "labels" / split / Path(record["filename"]).with_suffix(".txt")
                image_path.parent.mkdir(parents=True, exist_ok=True)
                label_path.parent.mkdir(parents=True, exist_ok=True)
                image_path.write_bytes(archive.read(record["image_info"]))
                label_path.write_text(record["label_text"].strip() + "\n", encoding="utf-8")
                rows.append({
                    "split": split,
                    "image": record["filename"],
                    "group_id": f"tapo-temporal-segment-{split}",
                    "source_id": record["source_id"],
                    "frame_index": record["frame_index"],
                })
            split_summary[split] = {
                "frames_in_window": [first_frame, last_frame],
                "images": len(split_records),
                "instances": {"goat": class_totals[split][0], "sheep": class_totals[split][1]},
            }

        (output / "data.yaml").write_text(yaml.safe_dump({
            "path": str(output),
            "train": "images/train",
            "val": "images/val",
            "test": "images/test",
            "nc": 2,
            "names": ["goat", "sheep"],
            "group_manifest": "groups.csv",
            "validation_mode": "single_video_temporal_holdout",
            "temporal_min_gap_frames": MIN_GAP_FRAMES,
        }, sort_keys=False), encoding="utf-8")
        with (output / "groups.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=["split", "image", "group_id", "source_id", "frame_index"])
            writer.writeheader()
            writer.writerows(rows)

        excluded = [record for record in records if not record["split"]]
        report = {
            "dataset_name": "My First Project.v1i.yolov8",
            "archive_sha256": _sha256(archive_path),
            "source_video_id": next(iter(source_ids)),
            "source_images": len(records),
            "selected_images": len(selected),
            "excluded_gap_images": len(excluded),
            "split_method": "chronological_single_video_holdout",
            "minimum_unused_frames_between_splits": MIN_GAP_FRAMES,
            "split_summary": split_summary,
            "promotion_eligible": False,
            "evaluation_warning": "All images come from one source video. Temporal holdout scores do not establish generalization to a separate recording, lighting condition, or camera session.",
        }
        (output / "preparation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True, help="Roboflow YOLOv8 ZIP from the Tapo camera footage.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Private prepared dataset directory.")
    args = parser.parse_args()
    try:
        report = prepare(args.archive, args.output)
    except (OSError, ValueError, zipfile.BadZipFile, yaml.YAMLError) as error:
        print(f"DATASET PREPARATION STOPPED: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    print(f"\nYOLO configuration: {args.output.resolve() / 'data.yaml'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
