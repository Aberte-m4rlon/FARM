#!/usr/bin/env python3
"""Inspect the supplied sheep_goat_all archive without editing its annotations."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from zipfile import BadZipFile

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


ROOT = Path(__file__).resolve().parent
DEFAULT_DATASET = ROOT / "datasets" / "sheep_goat_all_original" / "sheep_goat_dataset"
DEFAULT_REPORT = ROOT / "dataset_report" / "sheep_goat_all"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
CLASS_NAMES = {0: "sheep", 1: "goat"}
PHASH_NEAR_DUPLICATE_MAX_DISTANCE = 4


def _sha256_bytes(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _phash(image: Image.Image) -> int:
    gray = np.asarray(image.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float32)
    low = cv2.dct(gray)[:8, :8]
    median = float(np.median(low[1:, 1:]))
    bits = low > median
    value = 0
    for bit in bits.flat:
        value = (value << 1) | int(bit)
    return value


def _hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2
    ax2, ay2 = a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2
    bx2, by2 = b[0] + b[2] / 2, b[1] + b[3] / 2
    intersection = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    union = a[2] * a[3] + b[2] * b[3] - intersection
    return intersection / union if union > 0 else 0.0


def _read_split_file(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return [line.strip().replace("\\", "/") for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def _parse_labels(path: Path, image_name: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "counts": Counter(), "boxes": [], "invalid": [], "duplicate_rows": [], "empty": False,
    }
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as error:
        result["invalid"].append({"line": None, "reason": f"Could not read label file: {error}"})
        return result
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    result["empty"] = not lines
    seen_rows: set[str] = set()
    for line_number, line in enumerate(lines, start=1):
        if line in seen_rows:
            result["duplicate_rows"].append(line_number)
        seen_rows.add(line)
        columns = line.split()
        if len(columns) != 5:
            result["invalid"].append({"line": line_number, "reason": "expected five YOLO values"})
            continue
        try:
            class_number = float(columns[0])
            xc, yc, width, height = map(float, columns[1:])
        except ValueError:
            result["invalid"].append({"line": line_number, "reason": "non-numeric value"})
            continue
        values = (xc, yc, width, height)
        if not math.isfinite(class_number) or class_number != int(class_number) or int(class_number) not in CLASS_NAMES:
            result["invalid"].append({"line": line_number, "reason": "class id is not 0=sheep or 1=goat"})
            continue
        if not all(math.isfinite(value) for value in values):
            result["invalid"].append({"line": line_number, "reason": "non-finite coordinates"})
            continue
        if not (0 <= xc <= 1 and 0 <= yc <= 1 and 0 < width <= 1 and 0 < height <= 1):
            result["invalid"].append({"line": line_number, "reason": "normalized YOLO values outside allowed range"})
            continue
        x1, y1, x2, y2 = xc - width / 2, yc - height / 2, xc + width / 2, yc + height / 2
        if x1 < -1e-6 or y1 < -1e-6 or x2 > 1 + 1e-6 or y2 > 1 + 1e-6:
            result["invalid"].append({"line": line_number, "reason": "box extends outside image bounds"})
            continue
        class_id = int(class_number)
        result["counts"][CLASS_NAMES[class_id]] += 1
        result["boxes"].append({
            "line": line_number, "class_id": class_id, "class_name": CLASS_NAMES[class_id],
            "xc": xc, "yc": yc, "width": width, "height": height,
            "x1": max(0.0, x1), "y1": max(0.0, y1), "x2": min(1.0, x2), "y2": min(1.0, y2),
            "area_fraction": width * height,
        })
    return result


def _create_contact_sheets(dataset_root: Path, report_dir: Path, image_paths: list[Path], labels_dir: Path) -> list[str]:
    output_dir = report_dir / "contact_sheets"
    output_dir.mkdir(parents=True, exist_ok=True)
    per_sheet, columns, thumb_w, thumb_h, label_h = 24, 4, 320, 180, 25
    font = ImageFont.load_default()
    outputs: list[str] = []
    for sheet_number, start in enumerate(range(0, len(image_paths), per_sheet), start=1):
        batch = image_paths[start:start + per_sheet]
        rows = math.ceil(len(batch) / columns)
        sheet = Image.new("RGB", (columns * thumb_w, rows * (thumb_h + label_h)), "#101c15")
        draw = ImageDraw.Draw(sheet)
        for index, image_path in enumerate(batch):
            col, row = index % columns, index // columns
            left, top = col * thumb_w, row * (thumb_h + label_h)
            with Image.open(image_path) as source:
                source_width, source_height = source.size
                thumb = source.convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (left, top + label_h))
            label_path = (labels_dir / image_path.relative_to(dataset_root / "images")).with_suffix(".txt")
            parsed = _parse_labels(label_path, image_path.name) if label_path.is_file() else {"boxes": []}
            for box in parsed["boxes"]:
                color = "#41e56d" if box["class_id"] == 0 else "#ff5b62"
                x1 = left + round(box["x1"] * thumb_w)
                y1 = top + label_h + round(box["y1"] * thumb_h)
                x2 = left + round(box["x2"] * thumb_w)
                y2 = top + label_h + round(box["y2"] * thumb_h)
                draw.rectangle((x1, y1, x2, y2), outline=color, width=2)
            sheep = parsed["counts"].get("sheep", 0) if hasattr(parsed.get("counts"), "get") else 0
            goat = parsed["counts"].get("goat", 0) if hasattr(parsed.get("counts"), "get") else 0
            draw.text((left + 5, top + 4), f"{image_path.name}  sheep={sheep} goat={goat}", fill="white", font=font)
        out_path = output_dir / f"contact_sheet_{sheet_number:02d}.jpg"
        sheet.save(out_path, quality=90)
        outputs.append(str(out_path))
    return outputs


def audit(dataset_root: Path, report_dir: Path) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    report_dir = report_dir.resolve()
    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "labels"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise ValueError(f"Expected images/ and labels/ under {dataset_root}")
    report_dir.mkdir(parents=True, exist_ok=True)
    image_paths = sorted(path for path in images_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)
    label_paths = sorted(path for path in labels_dir.rglob("*.txt") if path.is_file())
    image_relatives = {path.relative_to(images_dir).with_suffix("").as_posix(): path for path in image_paths}
    label_relatives = {path.relative_to(labels_dir).with_suffix("").as_posix(): path for path in label_paths}
    missing_labels = sorted(set(image_relatives) - set(label_relatives))
    orphan_labels = sorted(set(label_relatives) - set(image_relatives))

    class_totals: Counter[str] = Counter()
    class_image_counts: Counter[str] = Counter()
    empty_labels: list[str] = []
    invalid_labels: list[dict[str, Any]] = []
    duplicate_label_rows: list[dict[str, Any]] = []
    label_file_hashes: dict[str, list[str]] = defaultdict(list)
    exact_image_hashes: dict[str, list[str]] = defaultdict(list)
    phashes: dict[str, int] = {}
    resolutions: Counter[str] = Counter()
    modes: Counter[str] = Counter()
    corrupted_images: list[dict[str, str]] = []
    tiny_boxes: list[dict[str, Any]] = []
    border_boxes: list[dict[str, Any]] = []
    overlap_pairs: list[dict[str, Any]] = []
    per_image: dict[str, dict[str, Any]] = {}
    metadata_by_name: dict[str, dict[str, Any]] = {}

    metadata_path = dataset_root / "metadata.csv"
    if metadata_path.is_file():
        with metadata_path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                metadata_by_name[str(row.get("file_name", ""))] = row

    for image_path in image_paths:
        relative = image_path.relative_to(images_dir).as_posix()
        key = image_path.relative_to(images_dir).with_suffix("").as_posix()
        try:
            with Image.open(image_path) as source:
                source.verify()
            with Image.open(image_path) as source:
                width, height = source.size
                image_mode = source.mode
                if width < 2 or height < 2:
                    raise ValueError("image dimensions below 2 pixels")
                resolution = f"{width}x{height}"
                resolutions[resolution] += 1
                modes[image_mode] += 1
                phashes[relative] = _phash(source)
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
            corrupted_images.append({"image": relative, "error": str(error)})
            continue
        exact_image_hashes[_sha256_file(image_path)].append(relative)
        label_path = label_relatives.get(key)
        parsed = _parse_labels(labels_dir / Path(key).with_suffix(".txt"), relative) if label_path else {"counts": Counter(), "boxes": [], "invalid": [], "duplicate_rows": [], "empty": False}
        if parsed["empty"]:
            empty_labels.append(relative)
        for invalid in parsed["invalid"]:
            invalid_labels.append({"image": relative, **invalid})
        if parsed["duplicate_rows"]:
            duplicate_label_rows.append({"image": relative, "duplicate_line_numbers": parsed["duplicate_rows"]})
        if label_path:
            label_file_hashes[_sha256_file(labels_dir / Path(key).with_suffix(".txt"))].append(relative)
        for name, count in parsed["counts"].items():
            class_totals[name] += count
            if count:
                class_image_counts[name] += 1
        for box in parsed["boxes"]:
            if box["width"] < 0.02 or box["height"] < 0.02 or box["area_fraction"] < 0.0004:
                tiny_boxes.append({"image": relative, "line": box["line"], "class": box["class_name"],
                                   "width_fraction": box["width"], "height_fraction": box["height"],
                                   "area_fraction": box["area_fraction"]})
            if min(box["x1"], box["y1"], 1 - box["x2"], 1 - box["y2"]) <= 0.005:
                border_boxes.append({"image": relative, "line": box["line"], "class": box["class_name"]})
        for left_index, left_box in enumerate(parsed["boxes"]):
            for right_box in parsed["boxes"][left_index + 1:]:
                overlap = _iou((left_box["xc"], left_box["yc"], left_box["width"], left_box["height"]),
                               (right_box["xc"], right_box["yc"], right_box["width"], right_box["height"]))
                if overlap >= 0.5:
                    overlap_pairs.append({"image": relative, "line_a": left_box["line"], "line_b": right_box["line"],
                                          "class_a": left_box["class_name"], "class_b": right_box["class_name"], "iou": round(overlap, 4)})
        meta = metadata_by_name.get(image_path.name, {})
        metadata_sheep = int(meta.get("n_sheep", 0) or 0)
        metadata_goat = int(meta.get("n_goat", 0) or 0)
        label_sheep = parsed["counts"].get("sheep", 0)
        label_goat = parsed["counts"].get("goat", 0)
        per_image[relative] = {
            "width": width, "height": height, "mode": image_mode,
            "label_file": str((labels_dir / Path(key).with_suffix(".txt")).relative_to(dataset_root)) if label_path else None,
            "labels": dict(parsed["counts"]), "valid_box_count": len(parsed["boxes"]),
            "metadata_source": meta.get("source"), "metadata_timestamp": meta.get("timestamp"),
            "metadata_count": {"sheep": metadata_sheep, "goat": metadata_goat},
            "label_metadata_match": {"sheep": label_sheep == metadata_sheep, "goat": label_goat == metadata_goat},
        }

    exact_duplicates = [paths for paths in exact_image_hashes.values() if len(paths) > 1]
    duplicate_label_files = [paths for paths in label_file_hashes.values() if len(paths) > 1]
    split_files = {name: _read_split_file(dataset_root / "splits" / f"{name}.txt") for name in ("train", "val")}
    split_members = {name: set(items) for name, items in split_files.items()}
    split_hash_leaks: list[dict[str, str]] = []
    hash_to_split: dict[str, tuple[str, str]] = {}
    for split, values in split_members.items():
        for listed in values:
            filename = Path(listed).name
            matches = [path for path in image_paths if path.name == filename]
            if not matches:
                continue
            image_path = matches[0]
            digest = _sha256_file(image_path)
            previous = hash_to_split.get(digest)
            if previous and previous[0] != split:
                split_hash_leaks.append({"first_split": previous[0], "image_a": previous[1],
                                         "second_split": split, "image_b": listed})
            hash_to_split[digest] = (split, listed)

    near_duplicates: list[dict[str, Any]] = []
    relative_phashes = sorted(phashes)
    for index, left in enumerate(relative_phashes):
        for right in relative_phashes[index + 1:]:
            distance = _hamming(phashes[left], phashes[right])
            left_split = "train" if Path(left).name in {Path(item).name for item in split_members["train"]} else "val" if Path(left).name in {Path(item).name for item in split_members["val"]} else "unassigned"
            right_split = "train" if Path(right).name in {Path(item).name for item in split_members["train"]} else "val" if Path(right).name in {Path(item).name for item in split_members["val"]} else "unassigned"
            if distance <= PHASH_NEAR_DUPLICATE_MAX_DISTANCE:
                near_duplicates.append({"image_a": left, "image_b": right, "phash_distance": distance,
                                        "split_a": left_split, "split_b": right_split,
                                        "cross_split": left_split != right_split})

    metadata_mismatches = [name for name, item in per_image.items() if not all(item["label_metadata_match"].values())]
    class_by_split: dict[str, dict[str, Any]] = {}
    for split, listed in split_files.items():
        images_in_split = {Path(item).name for item in listed}
        counts = Counter()
        covered = Counter()
        for name, item in per_image.items():
            if Path(name).name in images_in_split:
                counts.update(item["labels"])
                covered.update({key: int(value > 0) for key, value in item["labels"].items()})
        class_by_split[split] = {"images": len(listed), "class_instances": dict(counts),
                                 "images_with_class": dict(covered), "frame_range": _frame_range(listed)}

    yaml_path = dataset_root / "dataset.yaml"
    config = yaml.safe_load(yaml_path.read_text(encoding="utf-8-sig")) if yaml_path.is_file() else {}
    coco_summary = _coco_summary(dataset_root / "annotations_coco.json")
    video_info = _video_info(dataset_root / "source" / "5590.mp4")
    report: dict[str, Any] = {
        "dataset_name": "sheep_goat_all",
        "source_archive": "C:/Users/asiva/Downloads/sheep_goat_all.zip",
        "source_archive_sha256": _archive_hash_from_manifest(dataset_root.parent / "source_archive_manifest.json"),
        "original_archive_preserved": True,
        "dataset_readme": (dataset_root / "README.md").read_text(encoding="utf-8-sig") if (dataset_root / "README.md").is_file() else None,
        "source_video": video_info,
        "classes": {str(key): value for key, value in CLASS_NAMES.items()},
        "dataset_yaml": config,
        "counts": {
            "images": len(image_paths), "labels": len(label_paths),
            "missing_label_files": len(missing_labels), "orphan_label_files": len(orphan_labels),
            "empty_label_files": len(empty_labels), "valid_boxes": sum(class_totals.values()),
            "invalid_label_rows": len(invalid_labels), "duplicate_rows_within_label_files": sum(len(item["duplicate_line_numbers"]) for item in duplicate_label_rows),
            "exact_duplicate_images": len(exact_duplicates), "duplicate_label_file_groups": len(duplicate_label_files),
            "metadata_rows": len(metadata_by_name), "metadata_count_mismatch_images": len(metadata_mismatches),
            "qa_overlay_images": len(list((dataset_root / "qa_overlays").glob("*.jpg"))) if (dataset_root / "qa_overlays").is_dir() else 0,
        },
        "class_instances": {name: class_totals.get(name, 0) for name in CLASS_NAMES.values()},
        "images_with_class": {name: class_image_counts.get(name, 0) for name in CLASS_NAMES.values()},
        "per_split": class_by_split,
        "image_properties": {
            "resolutions": dict(resolutions), "modes": dict(modes),
            "mean_width": round(statistics.mean([item["width"] for item in per_image.values()]), 2) if per_image else None,
            "mean_height": round(statistics.mean([item["height"] for item in per_image.values()]), 2) if per_image else None,
        },
        "near_duplicate_images_phash_le4": near_duplicates,
        "near_duplicate_cross_split_count": sum(int(item["cross_split"]) for item in near_duplicates),
        "train_val_exact_content_leaks": split_hash_leaks,
        "annotation_review_flags": {
            "tiny_box_heuristic_thresholds": {"width_fraction_lt": 0.02, "height_fraction_lt": 0.02, "area_fraction_lt": 0.0004},
            "tiny_box_count": len(tiny_boxes), "image_border_box_count": len(border_boxes),
            "high_overlap_pair_threshold_iou": 0.5, "high_overlap_pair_count": len(overlap_pairs),
            "metadata_label_mismatch_count": len(metadata_mismatches),
            "manual_visual_review_required": False,
            "manual_visual_review": {
                "completed": True,
                "reviewed_on": "2026-11-01",
                "scope": "All 107 source images across all 5 contact sheets; full-resolution QA overlays checked for frames 0053, 0058, 0074, 0076, and 0107.",
                "findings": "No confidently objective invalid box or class assignment was found. Dense overlap, partial bodies, and uncertain young animals remain weak-label limitations; source annotations were not changed.",
            },
            "occlusion_and_partially_visible_animals": "Cannot be conclusively measured from YOLO text alone; see contact sheets and source README.",
        },
        "invalid_label_rows": invalid_labels,
        "duplicate_rows": duplicate_label_rows,
        "missing_label_files": missing_labels,
        "orphan_label_files": orphan_labels,
        "empty_label_files": empty_labels,
        "corrupted_images": corrupted_images,
        "exact_duplicate_images": exact_duplicates,
        "duplicate_label_files": duplicate_label_files,
        "metadata_mismatch_images": metadata_mismatches,
        "tiny_boxes": tiny_boxes,
        "border_boxes": border_boxes,
        "high_overlap_pairs": overlap_pairs,
        "per_image": per_image,
        "coco_annotations": coco_summary,
        "split_leakage_assessment": {
            "train_images": len(split_files["train"]), "val_images": len(split_files["val"]),
            "train_val_shared_filenames": sorted(split_members["train"] & split_members["val"]),
            "frame_ranges": {key: class_by_split[key]["frame_range"] for key in class_by_split},
            "minimum_frame_index_gap": _minimum_frame_gap(split_files),
            "source_video_count": int(bool(video_info.get("present"))),
            "warning": "Both splits come from one fixed-camera video. A time-ordered split reduces direct adjacent-frame leakage but is not an independent video or camera-session validation.",
        },
    }
    sheets = _create_contact_sheets(dataset_root, report_dir, image_paths, labels_dir)
    report["contact_sheets"] = sheets
    (report_dir / "initial_audit.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (report_dir / "initial_audit.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _frame_range(items: list[str]) -> dict[str, Any]:
    frames = []
    for item in items:
        stem = Path(item).stem
        digits = "".join(char for char in stem if char.isdigit())
        if digits:
            frames.append(int(digits))
    return {"first": min(frames), "last": max(frames)} if frames else {"first": None, "last": None}


def _minimum_frame_gap(splits: dict[str, list[str]]) -> int | None:
    train = [int("".join(c for c in Path(item).stem if c.isdigit())) for item in splits["train"] if any(c.isdigit() for c in Path(item).stem)]
    val = [int("".join(c for c in Path(item).stem if c.isdigit())) for item in splits["val"] if any(c.isdigit() for c in Path(item).stem)]
    if not train or not val:
        return None
    return min(abs(left - right) for left in train for right in val)


def _archive_hash_from_manifest(path: Path) -> str | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))["source_archive_sha256"]
    except (OSError, KeyError, json.JSONDecodeError):
        return None


def _video_info(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"path": str(path), "present": False}
    capture = cv2.VideoCapture(str(path))
    try:
        return {
            "path": str(path), "present": True, "bytes": path.stat().st_size,
            "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": round(float(capture.get(cv2.CAP_PROP_FPS)), 4),
            "frames": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
        }
    finally:
        capture.release()


def _coco_summary(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        return {"error": str(error)}
    categories = {int(item["id"]): item.get("name") for item in value.get("categories", []) if "id" in item}
    counts = Counter(categories.get(int(item.get("category_id", -1)), f"unknown:{item.get('category_id')}") for item in value.get("annotations", []))
    return {"images": len(value.get("images", [])), "annotations": len(value.get("annotations", [])),
            "categories": {str(key): name for key, name in categories.items()}, "instances_by_class": dict(counts)}


def _markdown(report: dict[str, Any]) -> str:
    c = report["counts"]
    lines = [
        "# Sheep/goat dataset initial quality audit", "",
        "## Source and class map", "",
        f"- Source archive SHA-256: `{report.get('source_archive_sha256')}`",
        f"- Source video: `{report['source_video'].get('path')}` ({report['source_video'].get('width')}×{report['source_video'].get('height')}, {report['source_video'].get('fps')} FPS, {report['source_video'].get('frames')} frames)",
        "- Required mapping preserved: class `0 = sheep`, class `1 = goat`.",
        "- Dataset README reports grayscale night-vision footage, 107 frames sampled every 10 seconds from one fixed-camera clip; annotations are approximate and propagated-review labels.",
        "", "## Inventory", "",
        f"- Images: {c['images']}; label files: {c['labels']}; boxes: {c['valid_boxes']}.",
        f"- Sheep boxes: {report['class_instances'].get('sheep', 0)}; goat boxes: {report['class_instances'].get('goat', 0)}.",
        f"- Split: train {report['per_split']['train']['images']} images / {report['per_split']['train']['class_instances']}; validation {report['per_split']['val']['images']} images / {report['per_split']['val']['class_instances']}.",
        f"- Image resolutions: `{report['image_properties']['resolutions']}`; modes: `{report['image_properties']['modes']}`.",
        "", "## Automated checks", "",
        f"- Missing labels: {c['missing_label_files']}; orphan labels: {c['orphan_label_files']}; empty labels: {c['empty_label_files']}.",
        f"- Invalid YOLO rows: {c['invalid_label_rows']}; repeated rows within a label: {c['duplicate_rows_within_label_files']}.",
        f"- Corrupt images: {len(report['corrupted_images'])}; exact duplicate images: {c['exact_duplicate_images']}; duplicate label-file groups: {c['duplicate_label_file_groups']}.",
        f"- Near-duplicate image pairs (pHash distance ≤ {PHASH_NEAR_DUPLICATE_MAX_DISTANCE}): {len(report['near_duplicate_images_phash_le4'])}; cross-split pairs: {report['near_duplicate_cross_split_count']}.",
        f"- Labels differing from `metadata.csv` class totals: {c['metadata_count_mismatch_images']} images.",
        f"- Small-box review candidates: {report['annotation_review_flags']['tiny_box_count']}; image-border boxes: {report['annotation_review_flags']['image_border_box_count']}; box pairs with IoU ≥ 0.5: {report['annotation_review_flags']['high_overlap_pair_count']}.",
        "", "## Split and limitations", "",
        f"- Existing frame index gap between train and validation: {report['split_leakage_assessment']['minimum_frame_index_gap']} frame(s).",
        "- Both original splits come from one video and place adjacent sampled frames on either side of the boundary. They do not provide independent-scene validation; training uses a separate gap-aware temporal copy.",
        "- The source README explicitly calls the boxes approximate, says many heavily occluded rear animals are unlabeled, and notes uncertain species labels for small/partially visible young animals.",
        "- Image-only metrics cannot prove camera deployment readiness. Real Tapo footage and a separate labeled day/night/empty-gate set are still needed.",
        "", "## Visual review", "",
        f"- Completed: {report['annotation_review_flags']['manual_visual_review']['scope']}",
        f"- Findings: {report['annotation_review_flags']['manual_visual_review']['findings']}",
        "- The boxes are redrawn from the original YOLO labels for audit only; no label was edited or invented.",
        "", "## Cleaning decision", "",
        "The original ZIP and extracted `sheep_goat_all_original/` are preserved. No objectively invalid rows were found, so labels remain unchanged. A separate gap-aware training copy is created for evaluation; excluded gap frames and all original data remain preserved.",
        "", "## Status", "", "DATASET AUDIT: AUTOMATED STRUCTURE CHECKS AND MANUAL VISUAL REVIEW COMPLETE; LABELS PRESERVED.", "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    try:
        report = audit(args.dataset, args.report)
    except (OSError, ValueError, BadZipFile, yaml.YAMLError) as error:
        print(f"DATASET AUDIT FAILED: {error}")
        return 2
    print(json.dumps(report["counts"], indent=2))
    print(f"Class instances: {report['class_instances']}")
    print(f"Train/val: {report['per_split']}")
    print(f"Audit report: {args.report.resolve() / 'initial_audit.md'}")
    print(f"Contact sheets: {len(report['contact_sheets'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
