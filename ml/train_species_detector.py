#!/usr/bin/env python3
"""Train and export AlpasFarm's goat/sheep object detector.

Only species and bounding-box labels are learned. This model is not a health
classifier and must never be used to infer symptoms or diagnoses.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ML_DIR = Path(__file__).resolve().parent
DEFAULT_ARCHIVE = ROOT / "Sheep vs Goat.v16i.yolov8.zip"
DATA_ROOT = ML_DIR / ".data"
SOURCE_DIR = DATA_ROOT / "source"
PREPARED_DIR = DATA_ROOT / "prepared"
CLASSES = ["goat", "sheep"]
SEED = 42


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-zip", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", default="auto", help="auto, cpu, or a CUDA device such as 0")
    parser.add_argument("--weights", default="yolov8n.pt", help="Ultralytics checkpoint for transfer learning")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--skip-export", action="store_true", help="Train and evaluate without writing a public ONNX model")
    return parser.parse_args()


def safe_member_path(root: Path, name: str) -> Path:
    """Resolve a ZIP member under root and reject traversal paths."""
    member = PurePosixPath(name)
    if member.is_absolute() or ".." in member.parts:
        raise ValueError(f"Unsafe archive path: {name}")
    target = root.joinpath(*member.parts).resolve()
    if root.resolve() not in target.parents:
        raise ValueError(f"Archive path escapes extraction folder: {name}")
    return target


def extract_dataset(archive: Path) -> Path:
    if not archive.is_file():
        raise FileNotFoundError(f"Dataset archive not found: {archive}")

    source = SOURCE_DIR.resolve()
    if source == ROOT.resolve() or ROOT.resolve() not in source.parents:
        raise RuntimeError(f"Refusing to extract outside the ML workspace: {source}")
    if source.exists():
        shutil.rmtree(source)
    source.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive) as bundle:
        corrupt = bundle.testzip()
        if corrupt:
            raise ValueError(f"Dataset archive has a corrupt member: {corrupt}")

        yaml_member = bundle.read("data.yaml").decode("utf-8")
        if not re.search(r"(?m)^nc:\s*2\s*$", yaml_member):
            raise ValueError("Expected a two-class detector dataset (nc: 2).")
        if not re.search(r"(?m)^names:\s*\[[^\]]*goat[^\]]*sheep[^\]]*\]", yaml_member, re.IGNORECASE):
            raise ValueError("Expected dataset classes in goat, sheep order.")

        selected = [
            entry for entry in bundle.infolist()
            if re.match(r"^(train|valid)/(images|labels)/.+$", entry.filename)
            or entry.filename in {"data.yaml", "README.dataset.txt", "README.roboflow.txt"}
        ]
        for entry in selected:
            if entry.is_dir():
                continue
            target = safe_member_path(source, entry.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(entry))

    return source


def image_label_pairs(source: Path) -> list[dict[str, object]]:
    pairs: list[dict[str, object]] = []
    for source_split in ("train", "valid"):
        images = sorted((source / source_split / "images").glob("*"), key=lambda p: p.as_posix().lower())
        for image in images:
            if not image.is_file() or image.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                continue
            label = source / source_split / "labels" / f"{image.stem}.txt"
            if not label.is_file():
                raise ValueError(f"Image is missing its YOLO label: {image.relative_to(source)}")
            class_ids: set[int] = set()
            with label.open("r", encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, start=1):
                    text = line.strip()
                    if not text:
                        continue
                    fields = text.split()
                    if len(fields) != 5:
                        raise ValueError(f"Malformed YOLO label {label}:{line_number}")
                    try:
                        class_id = int(fields[0])
                        box = [float(value) for value in fields[1:]]
                    except ValueError as error:
                        raise ValueError(f"Non-numeric YOLO label {label}:{line_number}") from error
                    if class_id not in (0, 1):
                        raise ValueError(f"Unexpected class {class_id} in {label}:{line_number}")
                    x, y, width, height = box
                    if not all(0 <= value <= 1 for value in box) or width <= 0 or height <= 0:
                        raise ValueError(f"Out-of-range box in {label}:{line_number}")
                    class_ids.add(class_id)

            # Roboflow's augmented variants contain the same source ID before _jpg.rf.<hash>.
            group = re.sub(r"_jpg\.rf\.[^.]+$", "", image.stem, flags=re.IGNORECASE)
            pairs.append({"image": image, "label": label, "group": group, "classes": tuple(sorted(class_ids))})

    if not pairs:
        raise ValueError(f"No labeled images found in {source}")
    return pairs


def split_by_source(pairs: list[dict[str, object]], seed: int) -> dict[str, list[dict[str, object]]]:
    """Split source image groups, keeping every augmented variant together."""
    groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for pair in pairs:
        groups[str(pair["group"])].append(pair)

    # Stratify source IDs by whether their annotations include goats and/or sheep.
    strata: dict[tuple[int, ...], list[str]] = defaultdict(list)
    for group, members in groups.items():
        signature = tuple(sorted({class_id for member in members for class_id in member["classes"]}))
        strata[signature].append(group)

    rng = random.Random(seed)
    assignment: dict[str, str] = {}
    for signature in sorted(strata):
        ids = sorted(strata[signature])
        rng.shuffle(ids)
        total = len(ids)
        n_test = int(round(total * 0.15))
        n_val = int(round(total * 0.15))
        if total >= 3:
            n_test = max(1, n_test)
            n_val = max(1, n_val)
        if n_test + n_val >= total:
            n_test = max(0, min(n_test, total - 2))
            n_val = max(0, min(n_val, total - n_test - 1))
        n_train = total - n_val - n_test
        for group in ids[:n_train]:
            assignment[group] = "train"
        for group in ids[n_train:n_train + n_val]:
            assignment[group] = "val"
        for group in ids[n_train + n_val:]:
            assignment[group] = "test"

    split_pairs: dict[str, list[dict[str, object]]] = {name: [] for name in ("train", "val", "test")}
    for pair in pairs:
        split_pairs[assignment[str(pair["group"])]].append(pair)
    for split in split_pairs:
        split_pairs[split].sort(key=lambda item: Path(item["image"]).as_posix().lower())
    return split_pairs


def prepare_dataset(source: Path, seed: int) -> tuple[Path, dict[str, dict[str, int]]]:
    pairs = image_label_pairs(source)
    splits = split_by_source(pairs, seed)
    prepared = PREPARED_DIR.resolve()
    if ROOT.resolve() not in prepared.parents or prepared == ROOT.resolve():
        raise RuntimeError(f"Refusing to write prepared data outside the ML workspace: {prepared}")
    if prepared.exists():
        shutil.rmtree(prepared)

    summary: dict[str, dict[str, int]] = {}
    for split, members in splits.items():
        images_dir = prepared / "images" / split
        labels_dir = prepared / "labels" / split
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)
        counts = Counter({"goat": 0, "sheep": 0})
        for index, pair in enumerate(members):
            image = Path(pair["image"])
            label = Path(pair["label"])
            output_stem = f"{index:06d}_{image.stem}"
            shutil.copy2(image, images_dir / f"{output_stem}{image.suffix.lower()}")
            shutil.copy2(label, labels_dir / f"{output_stem}.txt")
            for class_id in pair["classes"]:
                counts[CLASSES[int(class_id)]] += 1
        summary[split] = {"images": len(members), "source_groups": len({str(p["group"]) for p in members}), **dict(counts)}

    data_yaml = prepared / "data.yaml"
    data_yaml.write_text(
        "path: " + prepared.as_posix() + "\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "nc: 2\n"
        "names: ['goat', 'sheep']\n",
        encoding="utf-8",
    )
    return data_yaml, summary


def main() -> int:
    args = parse_args()
    if args.epochs < 1 or args.batch < 1 or args.imgsz < 32:
        print("epochs, batch, and imgsz must be positive values.", file=sys.stderr)
        return 2

    try:
        source = extract_dataset(args.dataset_zip.resolve())
        data_yaml, split_summary = prepare_dataset(source, args.seed)
    except Exception as error:
        print(f"Dataset preparation failed: {error}", file=sys.stderr)
        return 2

    print("Prepared grouped dataset:")
    print(json.dumps(split_summary, indent=2))

    yolo_config = DATA_ROOT / "ultralytics-config"
    yolo_config.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(yolo_config.resolve())

    try:
        import torch
        from ultralytics import YOLO
    except ImportError as error:
        print(
            "Training dependencies are missing. Install ml/requirements.txt in a virtual environment.\n"
            f"Details: {error}",
            file=sys.stderr,
        )
        return 2

    device = args.device
    if device == "auto":
        device = "0" if torch.cuda.is_available() else "cpu"

    runs_dir = ML_DIR / "runs"
    run_dir = runs_dir / "species-detector"
    model = YOLO(args.weights)
    model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=device,
        workers=0,
        seed=args.seed,
        deterministic=True,
        project=str(runs_dir),
        name="species-detector",
        exist_ok=True,
        patience=15,
    )
    # YOLO.train() returns validation metrics (not the trainer). The run path is
    # deterministic because project/name/exist_ok are fixed above.
    best_weights = run_dir / "weights" / "best.pt"
    if not best_weights.is_file():
        raise FileNotFoundError(f"Training finished without best weights: {best_weights}")

    test_model = YOLO(str(best_weights))
    test_metrics = test_model.val(
        data=str(data_yaml),
        split="test",
        imgsz=args.imgsz,
        device=device,
        project=str(runs_dir),
        name="species-detector-test",
        exist_ok=True,
        plots=True,
    )
    box_metrics = getattr(test_metrics, "box", None)
    per_class = {}
    for class_id, class_name in enumerate(CLASSES):
        try:
            precision = box_metrics.p[class_id]
            recall = box_metrics.r[class_id]
            map50 = box_metrics.ap50[class_id]
            map5095 = box_metrics.ap[class_id]
            per_class[class_name] = {
                "precision": float(precision), "recall": float(recall),
                "map50": float(map50), "map50_95": float(map5095),
            }
        except (AttributeError, IndexError, TypeError, ValueError):
            per_class[class_name] = {"metrics": "unavailable"}

    def metric_number(value: object) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if number == number and abs(number) != float("inf") else None

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model": "YOLOv8n",
        "classes": CLASSES,
        "dataset": args.dataset_zip.name,
        "dataset_license": "CC BY 4.0 (attribution required)",
        "split_seed": args.seed,
        "split_summary": split_summary,
        "test": {
            "map50": metric_number(getattr(box_metrics, "map50", None)),
            "map50_95": metric_number(getattr(box_metrics, "map", None)),
            "per_class": per_class,
        },
        "scope": "Species and bounding-box detection only; not trained for health screening or diagnosis.",
    }
    metrics_path = run_dir / "test_metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2, allow_nan=False), encoding="utf-8")

    if not args.skip_export:
        export_path = Path(test_model.export(format="onnx", imgsz=args.imgsz, dynamic=False, simplify=False, opset=12))
        public_models = ROOT / "public" / "models"
        public_models.mkdir(parents=True, exist_ok=True)
        deployment_path = public_models / "goat_sheep_yolov8n.onnx"
        shutil.copy2(export_path, deployment_path)
        print(f"Exported detector: {deployment_path}")

    print(f"Held-out metrics: {metrics_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

