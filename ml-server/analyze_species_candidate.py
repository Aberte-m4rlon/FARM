#!/usr/bin/env python3
"""Create per-image error analysis for a goat/sheep detection candidate."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO


CLASSES = ("sheep", "goat")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _names(model: Any) -> dict[int, str]:
    source = model.names
    names = source if isinstance(source, dict) else dict(enumerate(source))
    normalized = {int(index): str(name).strip().lower() for index, name in names.items()}
    if set(normalized.values()) != set(CLASSES) or set(normalized) != {0, 1}:
        raise ValueError(f"Candidate class names are not exactly {CLASSES}: {normalized}")
    return normalized


def _labels(path: Path, width: int, height: int, names: dict[int, str]) -> list[dict[str, Any]]:
    output = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        if not line.strip():
            continue
        columns = line.split()
        if len(columns) != 5:
            raise ValueError(f"Malformed label at {path}:{line_number}")
        class_id = int(float(columns[0]))
        x, y, w, h = map(float, columns[1:])
        output.append({
            "class_id": class_id,
            "class": names[class_id],
            "bbox": ((x - w / 2) * width, (y - h / 2) * height, (x + w / 2) * width, (y + h / 2) * height),
        })
    return output


def _iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union else 0.0


def _match(
    ground_truth: list[dict[str, Any]], predictions: list[dict[str, Any]], iou_threshold: float
) -> dict[str, Any]:
    pairs = sorted(
        (
            (_iou(truth["bbox"], prediction["bbox"]), truth_index, prediction_index)
            for truth_index, truth in enumerate(ground_truth)
            for prediction_index, prediction in enumerate(predictions)
        ),
        reverse=True,
    )
    matched_truth: set[int] = set()
    matched_predictions: set[int] = set()
    matches = []
    correct_truth: set[int] = set()
    correct_predictions: set[int] = set()
    for overlap, truth_index, prediction_index in pairs:
        if overlap < iou_threshold:
            break
        if truth_index in matched_truth or prediction_index in matched_predictions:
            continue
        matched_truth.add(truth_index)
        matched_predictions.add(prediction_index)
        truth = ground_truth[truth_index]
        prediction = predictions[prediction_index]
        matches.append({
            "iou": round(float(overlap), 4),
            "true_class": truth["class"],
            "predicted_class": prediction["class"],
            "confidence": round(float(prediction["confidence"]), 4),
            "class_correct": truth["class"] == prediction["class"],
        })
        if truth["class"] == prediction["class"]:
            correct_truth.add(truth_index)
            correct_predictions.add(prediction_index)
    return {
        "matches": matches,
        "matched_truth_indexes": matched_truth,
        "matched_prediction_indexes": matched_predictions,
        "false_negatives_by_class": Counter(ground_truth[index]["class"] for index in range(len(ground_truth)) if index not in correct_truth),
        "false_positives_by_class": Counter(predictions[index]["class"] for index in range(len(predictions)) if index not in correct_predictions),
    }


def _box_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(item["class"] for item in items)
    return {name: counts[name] for name in CLASSES}


def _draw_overlay(image_path: Path, truth: list[dict[str, Any]], predictions: list[dict[str, Any]], threshold: float) -> Image.Image:
    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for item in truth:
        draw.rectangle(item["bbox"], outline=(0, 255, 120) if item["class"] == "sheep" else (255, 80, 80), width=3)
        x, y, _, _ = item["bbox"]
        draw.text((x, max(0, y - 18)), f"GT {item['class']}", fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    for item in predictions:
        draw.rectangle(item["bbox"], outline=(0, 235, 255) if item["class"] == "sheep" else (255, 180, 0), width=2)
        x, y, _, _ = item["bbox"]
        draw.text((x, y + 2), f"P {item['class']} {item['confidence']:.2f}", fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    draw.rectangle((0, 0, image.width, 26), fill=(0, 0, 0))
    draw.text((8, 5), f"{image_path.name} | predictions confidence >= {threshold:.2f}", fill=(255, 255, 255))
    return image


def _contact_sheet(images: list[Image.Image], output: Path, columns: int = 3) -> None:
    if not images:
        return
    thumbnail_width = 640
    thumbnail_height = 360
    gap = 8
    rows = (len(images) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumbnail_width + (columns + 1) * gap,
                               rows * thumbnail_height + (rows + 1) * gap), (28, 35, 31))
    for index, source in enumerate(images):
        thumbnail = source.copy()
        thumbnail.thumbnail((thumbnail_width, thumbnail_height), Image.Resampling.LANCZOS)
        x = gap + (index % columns) * (thumbnail_width + gap)
        y = gap + (index // columns) * (thumbnail_height + gap)
        sheet.paste(thumbnail, (x, y))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=90)


def analyze(data_yaml: Path, model_path: Path, output_dir: Path, thresholds: list[float], imgsz: int = 640, device: str = "cpu") -> dict[str, Any]:
    config = yaml.safe_load(data_yaml.read_text(encoding="utf-8-sig"))
    dataset_root = Path(config.get("path", "."))
    if not dataset_root.is_absolute():
        dataset_root = (data_yaml.parent / dataset_root).resolve()
    model = YOLO(str(model_path.resolve()))
    names = _names(model)
    report: dict[str, Any] = {
        "model": str(model_path.resolve()),
        "data_yaml": str(data_yaml.resolve()),
        "class_order": [names[index] for index in range(2)],
        "iou_match_threshold": 0.5,
        "image_size": imgsz,
        "device": device,
        "thresholds": {},
    }

    for threshold in thresholds:
        aggregate_tp = {split: Counter() for split in ("val", "test")}
        aggregate_fp = {split: Counter() for split in ("val", "test")}
        aggregate_fn = {split: Counter() for split in ("val", "test")}
        test_class_confusion = Counter()
        image_rows = []
        overlays = []
        for split in ("val", "test"):
            configured = Path(config[split])
            image_dir = (configured if configured.is_absolute() else dataset_root / configured).resolve()
            label_dir = Path(*["labels" if part.lower() == "images" else part for part in image_dir.parts])
            image_paths = sorted(path for path in image_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)
            for image_path in image_paths:
                label_path = label_dir / image_path.relative_to(image_dir).with_suffix(".txt")
                with Image.open(image_path) as image:
                    source_image = image.convert("RGB")
                    width, height = source_image.size
                    result = model.predict(source_image, imgsz=imgsz, conf=threshold, max_det=300, device=device, verbose=False)[0]
                truths = _labels(label_path, width, height, names)
                predictions = []
                if result.boxes is not None:
                    for box in result.boxes:
                        class_id = int(box.cls[0].item())
                        if class_id not in names:
                            continue
                        predictions.append({
                            "class_id": class_id,
                            "class": names[class_id],
                            "confidence": float(box.conf[0].item()),
                            "bbox": tuple(float(value) for value in box.xyxy[0].tolist()),
                        })
                matched = _match(truths, predictions, 0.5)
                image_tp = Counter(match["true_class"] for match in matched["matches"] if match["class_correct"])
                image_fp = matched["false_positives_by_class"]
                image_fn = matched["false_negatives_by_class"]
                aggregate_tp[split].update(image_tp)
                aggregate_fp[split].update(image_fp)
                aggregate_fn[split].update(image_fn)
                for match in matched["matches"]:
                    if split == "test":
                        test_class_confusion[(match["true_class"], match["predicted_class"])] += 1
                image_rows.append({
                    "split": split,
                    "image": image_path.name,
                    "ground_truth": _box_counts(truths),
                    "predictions": _box_counts(predictions),
                    "true_positives_by_class_iou_0_5": {name: image_tp[name] for name in CLASSES},
                    "false_positives_by_class_iou_0_5": {name: image_fp[name] for name in CLASSES},
                    "false_negatives_by_class_iou_0_5": {name: image_fn[name] for name in CLASSES},
                    "matched_class_confusions": matched["matches"],
                })
                if split == "test":
                    overlays.append(_draw_overlay(image_path, truths, predictions, threshold))

        per_class_by_split = {}
        for split in ("val", "test"):
            per_class = {}
            for name in CLASSES:
                tp = aggregate_tp[split][name]
                fp = aggregate_fp[split][name]
                fn = aggregate_fn[split][name]
                precision = tp / (tp + fp) if tp + fp else 0.0
                recall = tp / (tp + fn) if tp + fn else 0.0
                per_class[name] = {
                    "true_positives_iou_0_5": tp,
                    "false_positives_iou_0_5": fp,
                    "false_negatives_iou_0_5": fn,
                    "precision_iou_0_5": round(precision, 4),
                    "recall_iou_0_5": round(recall, 4),
                }
            per_class_by_split[split] = per_class
        key = f"{threshold:.3f}"
        report["thresholds"][key] = {
            "evaluated_splits": ["val", "test"],
            "test_images": sum(row["split"] == "test" for row in image_rows),
            "test_ground_truth_boxes": {
                name: sum(row["ground_truth"][name] for row in image_rows if row["split"] == "test") for name in CLASSES
            },
            "test_predictions": {
                name: sum(row["predictions"][name] for row in image_rows if row["split"] == "test") for name in CLASSES
            },
            "per_split_per_class_iou_0_5": per_class_by_split,
            "test_per_class_iou_0_5": per_class_by_split["test"],
            "test_matched_class_confusion_counts": {
                f"true_{true}_predicted_{predicted}": test_class_confusion[(true, predicted)]
                for true in CLASSES for predicted in CLASSES
            },
            "images": image_rows,
        }
        sheet_path = output_dir / f"test_errors_conf_{threshold:.3f}.jpg"
        _contact_sheet(overlays, sheet_path)
        report["thresholds"][key]["test_overlay_contact_sheet"] = str(sheet_path.resolve())

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "per_image_error_analysis.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    with (output_dir / "per_image_error_analysis.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            "threshold", "split", "image", "ground_truth_sheep", "ground_truth_goat", "predicted_sheep", "predicted_goat",
            "tp_sheep", "tp_goat", "fp_sheep", "fp_goat", "fn_sheep", "fn_goat",
        ])
        writer.writeheader()
        for threshold, block in report["thresholds"].items():
            for row in block["images"]:
                writer.writerow({
                    "threshold": threshold, "split": row["split"], "image": row["image"],
                    "ground_truth_sheep": row["ground_truth"]["sheep"], "ground_truth_goat": row["ground_truth"]["goat"],
                    "predicted_sheep": row["predictions"]["sheep"], "predicted_goat": row["predictions"]["goat"],
                    "tp_sheep": row["true_positives_by_class_iou_0_5"]["sheep"], "tp_goat": row["true_positives_by_class_iou_0_5"]["goat"],
                    "fp_sheep": row["false_positives_by_class_iou_0_5"]["sheep"], "fp_goat": row["false_positives_by_class_iou_0_5"]["goat"],
                    "fn_sheep": row["false_negatives_by_class_iou_0_5"]["sheep"], "fn_goat": row["false_negatives_by_class_iou_0_5"]["goat"],
                })
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--thresholds", type=float, nargs="+", default=[0.05, 0.60])
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    report = analyze(args.data, args.model, args.output, args.thresholds, args.imgsz, args.device)
    print(json.dumps({
        "report": str((args.output / "per_image_error_analysis.json").resolve()),
        "csv": str((args.output / "per_image_error_analysis.csv").resolve()),
        "summaries": {threshold: value["test_per_class_iou_0_5"] for threshold, value in report["thresholds"].items()},
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
