"""Strict validation for real, annotated goat/sheep YOLO detection datasets.

This module intentionally does not create labels. Classification-only folders
cannot be converted into object-detection data by drawing guessed boxes.
"""

from __future__ import annotations

import hashlib
import csv
import math
import re
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, UnidentifiedImageError


SPECIES_CLASSES = {"goat", "sheep"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


class DatasetValidationError(ValueError):
    """Raised when a training dataset is incomplete or unsafe to evaluate."""


def _names_in_order(names: Any) -> list[str]:
    if isinstance(names, list):
        return [str(name).strip().lower() for name in names]
    if isinstance(names, dict):
        try:
            return [str(names[key] if key in names else names[str(key)]).strip().lower() for key in range(len(names))]
        except (KeyError, TypeError):
            pass
    raise DatasetValidationError("data.yaml must define names as a two-item list or an index-to-name mapping.")


def _resolve_split_path(root: Path, configured: Any, split: str) -> Path:
    if isinstance(configured, list):
        raise DatasetValidationError(f"The {split} split must point to one image directory so leakage checks are reproducible.")
    if not isinstance(configured, str) or not configured.strip():
        raise DatasetValidationError(f"data.yaml must define a non-empty {split}: images/{split} path.")
    path = Path(configured)
    return (path if path.is_absolute() else root / path).resolve()


def _labels_directory(image_dir: Path) -> Path:
    parts = list(image_dir.parts)
    candidates = [index for index, part in enumerate(parts) if part.lower() == "images"]
    if candidates:
        parts[candidates[-1]] = "labels"
        return Path(*parts)
    raise DatasetValidationError(
        f"Image directory {image_dir} must be inside an `images` folder paired with a matching `labels` folder."
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_dataset_yaml(data_yaml: Path | str, require_test: bool = True) -> dict[str, Any]:
    """Validate image integrity, real YOLO boxes, class coverage, and split isolation."""
    config_path = Path(data_yaml).resolve()
    if not config_path.is_file():
        raise DatasetValidationError(f"Dataset configuration does not exist: {config_path}")
    try:
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise DatasetValidationError(f"Could not read data.yaml: {error}") from error
    if not isinstance(config, dict):
        raise DatasetValidationError("data.yaml must contain a YAML mapping.")

    names = _names_in_order(config.get("names"))
    if len(names) != 2 or set(names) != SPECIES_CLASSES or config.get("nc", len(names)) != 2:
        raise DatasetValidationError(
            "data.yaml must define exactly two classes, goat and sheep; the class order must match the YOLO label IDs."
        )
    class_names = tuple(names)

    root_value = config.get("path", ".")
    if not isinstance(root_value, str):
        raise DatasetValidationError("data.yaml `path` must be a directory path.")
    root_path = Path(root_value)
    dataset_root = (root_path if root_path.is_absolute() else config_path.parent / root_path).resolve()

    required_splits = ("train", "val", "test") if require_test else ("train", "val")
    report: dict[str, Any] = {
        "data_yaml": str(config_path),
        "dataset_root": str(dataset_root),
        "classes": list(class_names),
        "splits": {},
        "duplicate_images_across_splits": [],
    }
    seen_hashes: dict[str, tuple[str, str]] = {}
    image_keys: set[str] = set()
    dataset_digest = hashlib.sha256()
    total_instances = {name: 0 for name in class_names}

    for split in required_splits:
        image_dir = _resolve_split_path(dataset_root, config.get(split), split)
        label_dir = _labels_directory(image_dir)
        if not image_dir.is_dir() or not label_dir.is_dir():
            raise DatasetValidationError(
                f"Missing real YOLO {split} images or labels: expected `{image_dir}` and `{label_dir}`."
            )
        images = sorted(path for path in image_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)
        if not images:
            raise DatasetValidationError(f"The {split} image split is empty: {image_dir}")

        split_instances = {name: 0 for name in class_names}
        negative_images = 0
        split_fingerprint = hashlib.sha256()
        expected_label_paths: set[Path] = set()
        for image_path in images:
            relative = image_path.relative_to(image_dir)
            image_keys.add(f"{split}/{relative.as_posix()}")
            label_path = (label_dir / relative).with_suffix(".txt")
            expected_label_paths.add(label_path.resolve())
            if not label_path.is_file():
                raise DatasetValidationError(f"Missing YOLO annotation for {split} image: {relative.as_posix()}")
            try:
                with Image.open(image_path) as image:
                    image.verify()
                with Image.open(image_path) as image:
                    width, height = image.size
                    if width < 2 or height < 2:
                        raise DatasetValidationError(f"Image is too small: {image_path}")
            except DatasetValidationError:
                raise
            except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
                raise DatasetValidationError(f"Corrupt or unsafe image {image_path}: {error}") from error

            image_hash = _sha256(image_path)
            previous = seen_hashes.get(image_hash)
            if previous and previous[0] != split:
                report["duplicate_images_across_splits"].append({
                    "first_split": previous[0], "duplicate_split": split,
                    "first_image": previous[1], "duplicate_image": relative.as_posix(),
                })
            else:
                seen_hashes[image_hash] = (split, relative.as_posix())

            label_text = label_path.read_text(encoding="utf-8").strip()
            if not label_text:
                negative_images += 1
            else:
                for line_number, line in enumerate(label_text.splitlines(), start=1):
                    columns = line.split()
                    if len(columns) != 5:
                        raise DatasetValidationError(f"Expected 5 YOLO columns at {label_path}:{line_number}.")
                    try:
                        class_float = float(columns[0])
                        x_center, y_center, box_width, box_height = map(float, columns[1:])
                    except ValueError as error:
                        raise DatasetValidationError(f"Non-numeric YOLO label at {label_path}:{line_number}.") from error
                    if not math.isfinite(class_float) or class_float != int(class_float) or int(class_float) not in (0, 1):
                        raise DatasetValidationError(
                            f"Unknown class index at {label_path}:{line_number}; valid IDs are 0 through {len(class_names) - 1} as declared in data.yaml."
                        )
                    if not all(math.isfinite(value) for value in (x_center, y_center, box_width, box_height)):
                        raise DatasetValidationError(f"Non-finite bounding box at {label_path}:{line_number}.")
                    if not (0 <= x_center <= 1 and 0 <= y_center <= 1 and 0 < box_width <= 1 and 0 < box_height <= 1):
                        raise DatasetValidationError(f"Bounding box is outside normalized YOLO bounds at {label_path}:{line_number}.")
                    if x_center - box_width / 2 < -1e-6 or x_center + box_width / 2 > 1 + 1e-6 or y_center - box_height / 2 < -1e-6 or y_center + box_height / 2 > 1 + 1e-6:
                        raise DatasetValidationError(f"Bounding box extends beyond its image at {label_path}:{line_number}.")
                    split_instances[class_names[int(class_float)]] += 1

            digest_line = f"{split}/{relative.as_posix()} {image_hash}\n".encode("utf-8")
            split_fingerprint.update(digest_line)
            split_fingerprint.update(label_text.encode("utf-8"))
            split_fingerprint.update(b"\n")
            dataset_digest.update(digest_line)
            dataset_digest.update(label_text.encode("utf-8"))
            dataset_digest.update(b"\n")

        actual_label_paths = {path.resolve() for path in label_dir.rglob("*.txt") if path.is_file()}
        orphaned = actual_label_paths - expected_label_paths
        if orphaned:
            first = sorted(orphaned)[0]
            raise DatasetValidationError(f"Orphan label file has no matching image: {first}")
        if any(count == 0 for count in split_instances.values()):
            raise DatasetValidationError(f"Every {split} split must include at least one goat and one sheep box; found {split_instances}.")
        for class_name, count in split_instances.items():
            total_instances[class_name] += count
        report["splits"][split] = {
            "image_directory": str(image_dir),
            "images": len(images), "negative_images": negative_images,
            "instances": split_instances, "labels_sha256": split_fingerprint.hexdigest(),
        }

    if report["duplicate_images_across_splits"]:
        sample = report["duplicate_images_across_splits"][0]
        raise DatasetValidationError(
            "Identical image content appears in more than one split "
            f"({sample['first_split']}/{sample['first_image']} and {sample['duplicate_split']}/{sample['duplicate_image']})."
        )
    group_manifest_value = config.get("group_manifest")
    if not isinstance(group_manifest_value, str) or not group_manifest_value.strip():
        raise DatasetValidationError(
            "data.yaml must include `group_manifest: groups.csv` so images from the same animal/video/source cannot leak across splits."
        )
    group_manifest = Path(group_manifest_value)
    group_manifest = (group_manifest if group_manifest.is_absolute() else dataset_root / group_manifest).resolve()
    if not group_manifest.is_file():
        raise DatasetValidationError(f"Source-group manifest does not exist: {group_manifest}")
    temporal_mode = config.get("validation_mode") == "single_video_temporal_holdout"
    image_to_group: dict[str, str] = {}
    groups_to_splits: dict[str, set[str]] = {}
    image_to_source_frame: dict[str, tuple[str, int]] = {}
    temporal_ranges: dict[str, list[int]] = {split: [] for split in required_splits}
    source_ids: set[str] = set()
    try:
        with group_manifest.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not reader.fieldnames or not {"split", "image", "group_id"}.issubset(set(reader.fieldnames)):
                raise DatasetValidationError("groups.csv must have columns: split,image,group_id.")
            if temporal_mode and not {"source_id", "frame_index"}.issubset(set(reader.fieldnames)):
                raise DatasetValidationError(
                    "A single-video temporal holdout manifest must also include source_id and frame_index columns."
                )
            for row_number, row in enumerate(reader, start=2):
                split = (row.get("split") or "").strip()
                image = (row.get("image") or "").replace("\\", "/").strip().lstrip("/")
                group_id = (row.get("group_id") or "").strip()
                key = f"{split}/{image}"
                if split not in required_splits or not image or not group_id:
                    raise DatasetValidationError(f"Invalid split/image/group_id at groups.csv:{row_number}.")
                if key in image_to_group:
                    raise DatasetValidationError(f"Duplicate image entry in groups.csv: {key}")
                image_to_group[key] = group_id
                groups_to_splits.setdefault(group_id, set()).add(split)
                if temporal_mode:
                    source_id = (row.get("source_id") or "").strip()
                    try:
                        frame_index = int((row.get("frame_index") or "").strip())
                    except ValueError as error:
                        raise DatasetValidationError(f"Invalid frame_index at groups.csv:{row_number}.") from error
                    if not source_id or frame_index < 0:
                        raise DatasetValidationError(f"Invalid source_id/frame_index at groups.csv:{row_number}.")
                    filename_match = re.search(r"(?P<source>.+_mp4)-(?P<frame>\d+)_jpg(?:\.rf\.|$)", image, re.IGNORECASE)
                    if not filename_match or filename_match.group("source") != source_id or int(filename_match.group("frame")) != frame_index:
                        raise DatasetValidationError(f"groups.csv source/frame does not match image filename: {key}")
                    image_to_source_frame[key] = (source_id, frame_index)
                    source_ids.add(source_id)
                    temporal_ranges[split].append(frame_index)
    except DatasetValidationError:
        raise
    except (OSError, csv.Error) as error:
        raise DatasetValidationError(f"Could not read source-group manifest: {error}") from error
    missing_group_rows = image_keys - set(image_to_group)
    extra_group_rows = set(image_to_group) - image_keys
    if missing_group_rows or extra_group_rows:
        missing = sorted(missing_group_rows)[:3]
        extra = sorted(extra_group_rows)[:3]
        raise DatasetValidationError(f"groups.csv must map every image exactly once; missing={missing}, unknown={extra}.")
    leaking_groups = {group: sorted(splits) for group, splits in groups_to_splits.items() if len(splits) > 1}
    if leaking_groups:
        raise DatasetValidationError(f"Source animals/videos occur across train/validation/test splits: {leaking_groups}")
    if temporal_mode:
        if len(source_ids) != 1:
            raise DatasetValidationError(
                f"A single-video temporal holdout must contain exactly one source video; found {len(source_ids)}."
            )
        try:
            min_gap_frames = int(config.get("temporal_min_gap_frames", -1))
        except (TypeError, ValueError) as error:
            raise DatasetValidationError("temporal_min_gap_frames must be a non-negative integer.") from error
        if min_gap_frames < 0:
            raise DatasetValidationError("temporal_min_gap_frames must be a non-negative integer.")
        split_ranges: dict[str, dict[str, int]] = {}
        previous_max: int | None = None
        for split in required_splits:
            values = temporal_ranges[split]
            if not values:
                raise DatasetValidationError(f"No temporal frame indexes were recorded for {split}.")
            low, high = min(values), max(values)
            gap = None if previous_max is None else low - previous_max - 1
            if gap is not None and gap < min_gap_frames:
                raise DatasetValidationError(
                    f"Temporal splits need at least {min_gap_frames} unused frames between them; {split} has {gap}."
                )
            split_ranges[split] = {"first_frame": low, "last_frame": high}
            if previous_max is not None and low <= previous_max:
                raise DatasetValidationError("Temporal split frame ranges overlap or are out of order.")
            previous_max = high
        report["group_isolation"] = {
            "manifest": str(group_manifest),
            "unique_temporal_segments": len(groups_to_splits),
            "verified": False,
            "reason": "One source video spans the splits; independent source-group isolation is not established.",
        }
        report["temporal_holdout"] = {
            "verified": True,
            "source_video_count": 1,
            "source_video_id": next(iter(source_ids)),
            "minimum_unused_frames_between_splits": min_gap_frames,
            "split_frame_ranges": split_ranges,
            "independent_source_evaluation": False,
            "promotion_eligible": False,
            "warning": "This measures a later time segment from the same video, not generalization to a separate recording or camera session.",
        }
    else:
        report["group_isolation"] = {
            "manifest": str(group_manifest),
            "unique_groups": len(groups_to_splits),
            "verified": True,
        }
    for key, group_id in sorted(image_to_group.items()):
        dataset_digest.update(f"{key} {group_id}\n".encode("utf-8"))
        if temporal_mode:
            source_id, frame_index = image_to_source_frame[key]
            dataset_digest.update(f"{key} {source_id} {frame_index}\n".encode("utf-8"))
    report["total_instances"] = total_instances
    report["dataset_fingerprint_sha256"] = dataset_digest.hexdigest()
    report["validation_passed"] = True
    return report
