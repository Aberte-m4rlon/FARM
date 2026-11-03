#!/usr/bin/env python3
"""Train a versioned goat/sheep candidate and evaluate/export it without promotion."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from PIL import Image

from app.dataset_pipeline import DatasetValidationError, validate_dataset_yaml


ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = ROOT / "datasets" / "species_v1" / "data.yaml"
DEFAULT_WEIGHTS = "yolo11n.pt"
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")
EXPORT_MAP_TOLERANCE = 0.03


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _confusion_matrix(model: Any, names: dict[int, str]) -> dict[str, Any] | None:
    validator = getattr(model, "validator", None)
    confusion = getattr(validator, "confusion_matrix", None)
    matrix_value = getattr(confusion, "matrix", None)
    if matrix_value is None:
        return None
    matrix = np.asarray(matrix_value, dtype=np.int64)
    ordered = [names[index] for index in range(len(names))]
    background = len(ordered)
    if matrix.shape != (background + 1, background + 1):
        return {"labels": ordered + ["background"], "matrix_predicted_rows_true_columns": matrix.tolist()}
    return {
        "labels": ordered + ["background"],
        "matrix_predicted_rows_true_columns": matrix.tolist(),
        "false_positives_by_class": {name: int(matrix[index, background]) for index, name in enumerate(ordered)},
        "false_negatives_by_class": {name: int(matrix[background, index]) for index, name in enumerate(ordered)},
        "cross_class_confusions": {
            f"true_{true_name}_predicted_{predicted_name}": int(matrix[predicted_index, true_index])
            for true_index, true_name in enumerate(ordered)
            for predicted_index, predicted_name in enumerate(ordered)
            if predicted_index != true_index
        },
    }


def _metrics_payload(metrics: Any, names: dict[int, str], conf: float, confusion_matrix: dict[str, Any] | None) -> dict[str, Any]:
    box = metrics.box
    per_class = {}
    maps = np.asarray(getattr(box, "maps", []), dtype=float).reshape(-1)
    precisions = np.asarray(getattr(box, "p", []), dtype=float).reshape(-1)
    recalls = np.asarray(getattr(box, "r", []), dtype=float).reshape(-1)
    for index, name in names.items():
        per_class[name] = {
            "precision_at_best_f1": _float(precisions[index]) if index < len(precisions) else None,
            "recall_at_best_f1": _float(recalls[index]) if index < len(recalls) else None,
            "map50_95": _float(maps[index]) if index < len(maps) else None,
        }
    return {
        "confidence_used_for_validation": conf,
        "precision_at_best_f1": _float(box.mp),
        "recall_at_best_f1": _float(box.mr),
        "map50": _float(box.map50),
        "map50_95": _float(box.map),
        "per_class": per_class,
        "confusion_matrix": confusion_matrix,
    }


def _names(detector: Any) -> dict[int, str]:
    names = detector.names
    values = names if isinstance(names, dict) else dict(enumerate(names))
    normalized = {int(index): str(name).strip().lower() for index, name in values.items()}
    if set(normalized) != {0, 1} or set(normalized.values()) != {"goat", "sheep"}:
        raise RuntimeError(f"Trained candidate must contain exactly goat and sheep classes; got {normalized}.")
    return normalized


def _align_species_head(detector: Any, target_order: list[str], torch: Any) -> bool:
    """Swap the two YOLO class output channels when checkpoint and data order differ."""
    source_names = _names(detector)
    source_order = [source_names[index] for index in sorted(source_names)]
    if source_order == target_order:
        return False
    if len(target_order) != 2 or set(target_order) != {"goat", "sheep"}:
        raise RuntimeError(f"Dataset class order must contain goat and sheep, got {target_order}.")

    detection_model = getattr(detector, "model", None)
    sequential = getattr(detection_model, "model", None)
    if sequential is None or not len(sequential):
        raise RuntimeError("Could not locate the detection head in the starting checkpoint.")
    head = sequential[-1]
    class_branches = getattr(head, "cv3", None)
    if class_branches is None:
        raise RuntimeError("Starting checkpoint has no supported YOLO class-prediction branches to remap safely.")
    with torch.no_grad():
        for branch in class_branches:
            classifier = branch[-1]
            if getattr(classifier, "out_channels", None) != 2:
                raise RuntimeError("Expected a two-class prediction layer while aligning goat/sheep class IDs.")
            classifier.weight.copy_(classifier.weight[[1, 0]].clone())
            if classifier.bias is not None:
                classifier.bias.copy_(classifier.bias[[1, 0]].clone())
    detection_model.names = {index: name for index, name in enumerate(target_order)}
    return True


def _write_ultralytics_data_yaml(data_yaml: Path, dataset_root: Path, output_path: Path) -> Path:
    """Make an Ultralytics-compatible YAML with a stable, resolved dataset root."""
    config = yaml.safe_load(data_yaml.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict):
        raise ValueError("Training data YAML must contain a mapping.")
    config["path"] = dataset_root.resolve().as_posix()
    output_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return output_path


def _benchmark(detector: Any, images_dir: Path, image_size: int, threshold: float, device: str, limit: int = 120) -> dict[str, Any]:
    image_paths = sorted(
        path for path in images_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    )[:limit]
    if not image_paths:
        return {"images": 0, "latency_ms_average": None, "latency_ms_p50": None, "latency_ms_p95": None, "fps": None}
    latencies: list[float] = []
    for index, path in enumerate(image_paths):
        with Image.open(path) as source:
            image = source.convert("RGB")
            started = time.perf_counter()
            detector.predict(image, imgsz=image_size, conf=threshold, max_det=10, device=device, verbose=False)
            elapsed_ms = (time.perf_counter() - started) * 1000
        if index >= min(5, len(image_paths) - 1):
            latencies.append(elapsed_ms)
    if not latencies:
        latencies = [elapsed_ms]
    ordered = sorted(latencies)
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
    average = statistics.fmean(latencies)
    return {
        "images": len(latencies),
        "warmup_images": min(5, len(image_paths) - 1),
        "latency_ms_average": round(average, 2),
        "latency_ms_p50": round(float(np.percentile(ordered, 50)), 2),
        "latency_ms_p95": round(p95, 2),
        "fps_from_average_latency": round(1000 / average, 2) if average > 0 else None,
        "device": device,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="Real YOLO data.yaml with train/val/test boxes.")
    parser.add_argument(
        "--weights", default=DEFAULT_WEIGHTS,
        help="Ultralytics model/checkpoint to start from (default: generic yolo11n.pt, not an ALPASFARM species model).",
    )
    parser.add_argument("--version", required=True, help="New candidate version, e.g. goat-sheep-v2.")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--freeze-backbone", action="store_true", help="Freeze feature layers and fine-tune only the detection head.")
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--device", default="auto", help="auto, cpu, or an Ultralytics device string such as 0.")
    parser.add_argument("--confidence", type=float, default=0.60, help="Production operating threshold to record and evaluate.")
    args = parser.parse_args()

    if not VERSION_PATTERN.fullmatch(args.version):
        parser.error("--version must be 2-64 letters, numbers, dots, underscores, or hyphens and start with a letter or number.")
    if args.epochs < 1 or args.batch < 1 or args.imgsz < 64 or args.patience < 0 or not 0 < args.confidence < 1:
        parser.error("epochs, batch, image size, patience, and confidence must be valid positive values.")
    try:
        dataset_report = validate_dataset_yaml(args.data)
    except DatasetValidationError as error:
        print(f"TRAINING STOPPED: dataset validation failed: {error}", file=sys.stderr)
        print("No labels were synthesized and no model weights were changed.", file=sys.stderr)
        return 2

    version_dir = ROOT / "models" / "candidates" / args.version
    run_dir = ROOT / "runs" / "species_detector" / args.version
    if version_dir.exists() or run_dir.exists():
        print(f"TRAINING STOPPED: candidate/version already exists: {args.version}. Choose a new version.", file=sys.stderr)
        return 2

    try:
        import torch
        from ultralytics import YOLO
    except Exception as error:
        print(f"TRAINING STOPPED: PyTorch and Ultralytics are required: {error}", file=sys.stderr)
        return 2

    selected_device = ("0" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
    model_path = Path(args.weights).expanduser()
    source_reference = str(model_path.resolve()) if model_path.is_file() else args.weights
    try:
        source_model = YOLO(source_reference)
    except Exception as error:
        print(f"TRAINING STOPPED: starting Ultralytics model could not be loaded: {error}", file=sys.stderr)
        return 2
    checkpoint_path = Path(getattr(source_model, "ckpt_path", "") or "")
    if not checkpoint_path.is_file() and model_path.is_file():
        checkpoint_path = model_path.resolve()
    source_sha = sha256_file(checkpoint_path) if checkpoint_path.is_file() else None
    source_label = str(checkpoint_path.resolve()) if checkpoint_path.is_file() else source_reference
    target_class_order = list(dataset_report["classes"])
    raw_source_names = getattr(source_model, "names", {})
    raw_source_names = raw_source_names if isinstance(raw_source_names, dict) else dict(enumerate(raw_source_names))
    source_names = {int(index): str(name).strip().lower() for index, name in raw_source_names.items()}
    is_species_checkpoint = len(source_names) == 2 and set(source_names.values()) == {"goat", "sheep"}
    starting_head_reinitialized = not is_species_checkpoint
    if is_species_checkpoint:
        starting_class_names = source_names
        try:
            class_order_channels_swapped = _align_species_head(source_model, target_class_order, torch)
        except Exception as error:
            print(f"TRAINING STOPPED: class IDs could not be aligned safely: {error}", file=sys.stderr)
            return 2
    else:
        # Ultralytics will transfer compatible backbone weights and create a fresh
        # detector head sized and named for this dataset during train().
        starting_class_names = source_names
        class_order_channels_swapped = False
        print(
            f"Starting checkpoint has {len(source_names)} non-species classes; "
            "Ultralytics will replace its detection head for goat/sheep training."
        )
    version_dir.mkdir(parents=True, exist_ok=False)
    training_data_yaml = _write_ultralytics_data_yaml(
        args.data.resolve(), Path(dataset_report["dataset_root"]), version_dir / "ultralytics_data.yaml"
    )
    (version_dir / "dataset_validation.json").write_text(json.dumps(dataset_report, indent=2) + "\n", encoding="utf-8")
    train_config = {
        "model_version": args.version,
        "dataset_yaml": str(args.data.resolve()),
        "ultralytics_dataset_yaml": str(training_data_yaml.resolve()),
        "dataset_fingerprint_sha256": dataset_report["dataset_fingerprint_sha256"],
        "starting_weights": source_label,
        "starting_weights_sha256": source_sha,
        "starting_weights_classes_before_alignment": {str(index): name for index, name in starting_class_names.items()},
        "dataset_class_order": target_class_order,
        "class_order_channels_swapped": class_order_channels_swapped,
        "starting_head_reinitialized_for_species_classes": starting_head_reinitialized,
        "epochs": args.epochs,
        "patience": args.patience,
        "batch": args.batch,
        "image_size": args.imgsz,
        "freeze_backbone": args.freeze_backbone,
        "seed": 42,
        "workers": args.workers,
        "device": selected_device,
        "confidence_threshold": args.confidence,
        "training_started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "torch_version": torch.__version__,
    }
    (version_dir / "training_config.json").write_text(json.dumps(train_config, indent=2) + "\n", encoding="utf-8")

    try:
        source_model.train(
            data=str(training_data_yaml.resolve()), epochs=args.epochs, batch=args.batch, imgsz=args.imgsz,
            device=selected_device, workers=args.workers, seed=42, deterministic=True,
            patience=args.patience, freeze=23 if args.freeze_backbone else None,
            val=True, plots=True, project=str(run_dir.parent), name=args.version,
            exist_ok=False, save=True, pretrained=True,
        )
        trained_weights = run_dir / "weights" / "best.pt"
        if not trained_weights.is_file():
            raise RuntimeError(f"Training ended without a best checkpoint: {trained_weights}")
        trained_model = YOLO(str(trained_weights))
        class_names = _names(trained_model)
        metrics_map = trained_model.val(
            data=str(training_data_yaml.resolve()), split="test", imgsz=args.imgsz,
            device=selected_device, workers=args.workers, conf=0.001,
            project=str(version_dir / "evaluation"), name="pytorch-test-map", plots=True,
        )
        pytorch_map_confusion = _confusion_matrix(trained_model, class_names)
        metrics_operating = trained_model.val(
            data=str(training_data_yaml.resolve()), split="test", imgsz=args.imgsz,
            device=selected_device, workers=args.workers, conf=args.confidence,
            project=str(version_dir / "evaluation"), name="pytorch-test-operating-point", plots=True,
        )
        pytorch_operating_confusion = _confusion_matrix(trained_model, class_names)
        pytorch_test = _metrics_payload(metrics_map, class_names, 0.001, pytorch_map_confusion)
        pytorch_test["production_threshold_confusion_matrix"] = pytorch_operating_confusion
        pytorch_test["production_threshold"] = args.confidence
        version_dir.joinpath("best.pt").write_bytes(trained_weights.read_bytes())

        export_model = YOLO(str(version_dir / "best.pt"))
        exported_path = Path(export_model.export(format="onnx", imgsz=args.imgsz, half=False, dynamic=False, simplify=False))
        onnx_path = version_dir / "best.onnx"
        if exported_path.resolve() != onnx_path.resolve():
            shutil.copy2(exported_path, onnx_path)
        onnx_model = YOLO(str(onnx_path))
        _names(onnx_model)
        onnx_map = onnx_model.val(
            data=str(training_data_yaml.resolve()), split="test", imgsz=args.imgsz,
            device="cpu", workers=args.workers, conf=0.001,
            project=str(version_dir / "evaluation"), name="onnx-test-map", plots=True,
        )
        onnx_map_confusion = _confusion_matrix(onnx_model, class_names)
        onnx_operating = onnx_model.val(
            data=str(training_data_yaml.resolve()), split="test", imgsz=args.imgsz,
            device="cpu", workers=args.workers, conf=args.confidence,
            project=str(version_dir / "evaluation"), name="onnx-test-operating-point", plots=True,
        )
        onnx_operating_confusion = _confusion_matrix(onnx_model, class_names)
        onnx_test = _metrics_payload(onnx_map, class_names, 0.001, onnx_map_confusion)
        onnx_test["production_threshold_confusion_matrix"] = onnx_operating_confusion
        onnx_test["production_threshold"] = args.confidence

        map_delta = abs((pytorch_test["map50_95"] or 0) - (onnx_test["map50_95"] or 0))
        map50_delta = abs((pytorch_test["map50"] or 0) - (onnx_test["map50"] or 0))
        export_passed = map_delta <= EXPORT_MAP_TOLERANCE and map50_delta <= EXPORT_MAP_TOLERANCE
        test_dir = Path(dataset_report["splits"]["test"]["image_directory"])
        pytorch_benchmark = _benchmark(YOLO(str(version_dir / "best.pt")), test_dir, args.imgsz, args.confidence, selected_device)
        onnx_benchmark = _benchmark(onnx_model, test_dir, args.imgsz, args.confidence, "cpu")
        temporal_holdout = dataset_report.get("temporal_holdout")
        promotion_blockers = [
            "Run a separate validation on labeled AlpasFarm/Tapo C320WS footage before production use.",
            "Verify false positives on empty-gate, people, dogs, objects, day, and night footage.",
        ]
        if temporal_holdout:
            promotion_blockers.append(
                "The dataset contains one source video; temporal holdout scores are not independent evidence. Evaluate on additional labeled camera sessions."
            )
        if not export_passed:
            promotion_blockers.append("ONNX test metrics exceed the configured PyTorch-to-ONNX tolerance.")
        manifest = {
            "model_version": args.version,
            "status": "candidate_evaluated",
            "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "training_config": train_config,
            "dataset": dataset_report,
            "test_metrics_pytorch": pytorch_test,
            "test_metrics_onnx": onnx_test,
            "export_comparison": {
                "map50_delta": map50_delta,
                "map50_95_delta": map_delta,
                "allowed_absolute_delta": EXPORT_MAP_TOLERANCE,
                "passed": export_passed,
            },
            "inference_benchmark": {"pytorch": pytorch_benchmark, "onnx_cpu": onnx_benchmark},
            "artifacts": {
                "best_pt_sha256": sha256_file(version_dir / "best.pt"),
                "best_onnx_sha256": sha256_file(onnx_path),
                "best_pt_bytes": (version_dir / "best.pt").stat().st_size,
                "best_onnx_bytes": onnx_path.stat().st_size,
            },
            "promotion_ready": False,
            "promotion_blockers": promotion_blockers,
            "cctv_validation": "single_video_temporal_holdout_only" if temporal_holdout else "not_run",
        }
        (version_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "candidate_directory": str(version_dir),
            "manifest": str(version_dir / "manifest.json"),
            "pytorch_test": {key: pytorch_test[key] for key in ("precision_at_best_f1", "recall_at_best_f1", "map50", "map50_95")},
            "onnx_test": {key: onnx_test[key] for key in ("precision_at_best_f1", "recall_at_best_f1", "map50", "map50_95")},
            "export_comparison_passed": export_passed,
            "promotion_ready": False,
        }, indent=2))
        return 0
    except Exception as error:
        failure = {
            "model_version": args.version,
            "status": "candidate_failed",
            "error_type": type(error).__name__,
            "error": str(error),
            "training_config": train_config,
            "promotion_ready": False,
            "cctv_validation": "not_run",
        }
        (version_dir / "manifest.json").write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(f"Candidate failed; the production weights were not modified: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
