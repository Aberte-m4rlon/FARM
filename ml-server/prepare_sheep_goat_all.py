#!/usr/bin/env python3
"""Create a label-preserving temporal training copy of sheep_goat_all."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import yaml


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "datasets" / "sheep_goat_all_original" / "sheep_goat_dataset"
DEFAULT_DESTINATION = ROOT / "datasets" / "sheep_goat_all_temporal_20261101_v1"
SPLITS = {
    "train": (1, 58),
    "val": (64, 72),
    "test": (99, 107),
}
REQUIRED_NAMES = ["sheep", "goat"]
MINIMUM_TEMPORAL_GAP_SECONDS = 50


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _class_names(config: dict[str, Any]) -> list[str]:
    names = config.get("names")
    if isinstance(names, list):
        return [str(item).strip().lower() for item in names]
    if isinstance(names, dict):
        return [str(names.get(index, names.get(str(index), ""))).strip().lower() for index in range(len(names))]
    return []


def _read_metadata(source: Path) -> dict[str, dict[str, str]]:
    with (source / "metadata.csv").open("r", encoding="utf-8-sig", newline="") as stream:
        return {row["file_name"]: row for row in csv.DictReader(stream)}


def _label_counts(label_path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    for line_number, line in enumerate(label_path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        if not line.strip():
            continue
        columns = line.split()
        if len(columns) != 5 or columns[0] not in {"0", "1"}:
            raise ValueError(f"Unexpected label row at {label_path}:{line_number}; original annotations were not changed.")
        counts[REQUIRED_NAMES[int(columns[0])]] += 1
    return counts


def prepare(source: Path, destination: Path) -> dict[str, Any]:
    source = source.resolve()
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite an existing training copy: {destination}")
    config_path = source / "dataset.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or _class_names(config) != REQUIRED_NAMES:
        raise ValueError("The source dataset must keep class 0=sheep and class 1=goat.")

    source_video = source / "source" / "5590.mp4"
    capture = cv2.VideoCapture(str(source_video))
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
    finally:
        capture.release()
    if not fps or fps <= 0:
        raise ValueError(f"Could not read the source-video frame rate: {source_video}")
    sample_stride = round(fps * 10)
    if sample_stride < 1:
        raise ValueError(f"Invalid source-video sample stride from {fps} FPS.")

    metadata = _read_metadata(source)
    selected: dict[str, list[tuple[int, Path, Path, dict[str, str]]]] = {name: [] for name in SPLITS}
    split_counts: dict[str, Counter[str]] = {name: Counter() for name in SPLITS}
    for image_path in sorted((source / "images").glob("*.jpg")):
        try:
            sample_index = int(image_path.stem.split("_")[-1])
        except ValueError as error:
            raise ValueError(f"Unexpected source frame filename: {image_path.name}") from error
        split_name = next((name for name, (low, high) in SPLITS.items() if low <= sample_index <= high), None)
        if split_name is None:
            continue
        label_path = source / "labels" / f"{image_path.stem}.txt"
        if not label_path.is_file():
            raise FileNotFoundError(f"Missing original YOLO label: {label_path}")
        row = metadata.get(image_path.name)
        if not row:
            raise ValueError(f"Missing metadata row for {image_path.name}")
        counts = _label_counts(label_path)
        split_counts[split_name].update(counts)
        selected[split_name].append((sample_index, image_path, label_path, row))

    if any(not selected[split] for split in SPLITS):
        raise ValueError("One or more configured temporal splits are empty.")
    if any(any(split_counts[split][name] == 0 for name in REQUIRED_NAMES) for split in SPLITS):
        raise ValueError(f"Every train/validation/test split needs both classes; found {split_counts}.")

    destination.mkdir(parents=True)
    groups_path = destination / "groups.csv"
    manifest_rows: list[dict[str, Any]] = []
    video_id = source_video.stem
    source_id = f"{video_id}_mp4"
    for split_name, rows in selected.items():
        (destination / "images" / split_name).mkdir(parents=True)
        (destination / "labels" / split_name).mkdir(parents=True)
        for sample_index, image_path, label_path, metadata_row in rows:
            source_frame_index = (sample_index - 1) * sample_stride
            copied_name = f"{source_id}-{source_frame_index:06d}_jpg.rf.{image_path.stem}.jpg"
            shutil.copy2(image_path, destination / "images" / split_name / copied_name)
            shutil.copy2(label_path, destination / "labels" / split_name / f"{Path(copied_name).stem}.txt")
            manifest_rows.append({
                "split": split_name,
                "image": copied_name,
                "group_id": f"{source_id}-{split_name}-temporal-segment",
                "source_id": source_id,
                "frame_index": source_frame_index,
                "original_image": image_path.name,
                "timestamp": metadata_row["timestamp"],
            })

    with groups_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=["split", "image", "group_id", "source_id", "frame_index", "original_image", "timestamp"],
        )
        writer.writeheader()
        writer.writerows(manifest_rows)

    data_config = {
        "path": ".",
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": 2,
        "names": {0: "sheep", 1: "goat"},
        "group_manifest": "groups.csv",
        "validation_mode": "single_video_temporal_holdout",
        "temporal_min_gap_frames": round(MINIMUM_TEMPORAL_GAP_SECONDS * fps),
    }
    (destination / "data.yaml").write_text(yaml.safe_dump(data_config, sort_keys=False), encoding="utf-8")

    frame_ranges = {
        split: {
            "first_sample": min(item[0] for item in items),
            "last_sample": max(item[0] for item in items),
            "images": len(items),
            "instances": dict(split_counts[split]),
        }
        for split, items in selected.items()
    }
    gaps = {
        "train_to_val_source_frames": (min(item[0] for item in selected["val"]) - max(item[0] for item in selected["train"]) - 1) * sample_stride,
        "val_to_test_source_frames": (min(item[0] for item in selected["test"]) - max(item[0] for item in selected["val"]) - 1) * sample_stride,
        "minimum_required_source_frames": data_config["temporal_min_gap_frames"],
    }
    source_archive_manifest = source.parent / "source_archive_manifest.json"
    source_archive_sha = None
    if source_archive_manifest.is_file():
        source_archive_sha = json.loads(source_archive_manifest.read_text(encoding="utf-8")).get("source_archive_sha256")
    manifest = {
        "dataset": destination.name,
        "source_dataset": str(source),
        "source_archive_sha256": source_archive_sha,
        "source_video_sha256": _file_sha256(source_video),
        "source_video_fps": fps,
        "sample_interval_seconds": 10,
        "approximate_source_frame_stride": sample_stride,
        "class_map": {"0": "sheep", "1": "goat"},
        "labels_copied_without_changes": True,
        "excluded_gap_sample_ranges": [[59, 63], [73, 98]],
        "splits": frame_ranges,
        "temporal_gaps": gaps,
        "same_source_video_warning": "All partitions come from one video. The test split is a later temporal holdout, not independent-camera or production evidence.",
    }
    (destination / "prepared_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (destination / "README.md").write_text(
        "# Sheep/goat temporal training copy\n\n"
        "This is a separate copy made from `sheep_goat_all_original`; image and YOLO label contents were copied unchanged. "
        "The original ZIP and extraction remain preserved.\n\n"
        "Class order is `0=sheep`, `1=goat`. Frames are split chronologically into train (1–58), validation (64–72), "
        "and test (99–107); sampled frames 59–63 and 73–98 are intentionally omitted between partitions. "
        "The source README says frames were sampled every 10 seconds.\n\n"
        "This dataset contains only one fixed-camera video. The time gap reduces adjacent-frame leakage, but its test metrics "
        "are not evidence of performance on another camera session or on the live Tapo camera. Labels are approximate and "
        "include propagated boxes, occlusion, and uncertain young-animal classes.\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    report = prepare(args.source, args.destination)
    print(json.dumps(report, indent=2))
    print(f"Dataset YAML: {(args.destination.resolve() / 'data.yaml')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
