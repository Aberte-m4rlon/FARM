"""Train and evaluate a camera-only sheep activity baseline from public video ZIPs.

This recognizes the source dataset's five activity labels. It does not classify
lameness, disease, or QR identity.
"""

from __future__ import annotations

import argparse
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import re
import shutil
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "sheep_goat"
MODEL_DIR = Path(__file__).resolve().parent / "models"
ARCHIVE_NAMES = (
    "Standing_Walking_Misc_Sheep_Classes.zip",
    "Grazing_Running_Sitting_Sheep_Classes.zip",
)
LABELS = ("grazing", "running", "sitting", "standing", "walking")
VIDEO_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv"}
GRID_ROWS = 2
GRID_COLS = 4
IMAGE_SIZE = (160, 90)
FEATURE_VERSION = "dense-flow-grid-v1"


def group_key(info_name: str, archive_name: str) -> str:
    """Keep front/side clips of a numbered animal in the same data split."""
    stem = PurePosixPath(info_name).stem
    match = re.match(r"^(\d+)", stem)
    if match:
        return f"animal-{match.group(1)}"
    return f"clip-{archive_name}-{stem.casefold()}"


def labeled_videos(archives: list[Path]) -> list[tuple[Path, str, str, str]]:
    records: list[tuple[Path, str, str, str]] = []
    for archive_path in archives:
        if not archive_path.is_file():
            raise FileNotFoundError(f"Dataset archive not found: {archive_path}")
        with ZipFile(archive_path) as archive:
            for info in archive.infolist():
                if info.is_dir() or PurePosixPath(info.filename).suffix.casefold() not in VIDEO_SUFFIXES:
                    continue
                parts = [part.casefold() for part in PurePosixPath(info.filename).parts]
                label = next((candidate for candidate in LABELS if candidate in parts), None)
                if label is None:
                    continue
                records.append((archive_path, info.filename, label, group_key(info.filename, archive_path.name)))
    return records


def pair_features(previous: np.ndarray, current: np.ndarray, seconds: float) -> np.ndarray:
    flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    scale = max(seconds, 1e-3)
    flow_x = flow[:, :, 0] / scale
    flow_y = flow[:, :, 1] / scale
    magnitude = cv2.magnitude(flow_x, flow_y)
    height, width = magnitude.shape
    features: list[float] = []
    for row in range(GRID_ROWS):
        y0, y1 = row * height // GRID_ROWS, (row + 1) * height // GRID_ROWS
        for col in range(GRID_COLS):
            x0, x1 = col * width // GRID_COLS, (col + 1) * width // GRID_COLS
            cell_mag = magnitude[y0:y1, x0:x1]
            cell_x = flow_x[y0:y1, x0:x1]
            cell_y = flow_y[y0:y1, x0:x1]
            features.extend((
                float(cell_mag.mean()),
                float(cell_mag.std()),
                float(np.percentile(cell_mag, 90)),
                float(np.mean(cell_mag > 1.0)),
                float(cell_x.mean()),
                float(cell_y.mean()),
            ))
    return np.asarray(features, dtype=np.float32)


def video_features(video_path: Path, sample_count: int = 12) -> np.ndarray | None:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        return None
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if count < 3 or not np.isfinite(fps) or fps <= 0:
        capture.release()
        return None

    frame_ids = np.unique(np.linspace(0, count - 1, min(sample_count, count), dtype=np.int32))
    sampled: list[tuple[int, np.ndarray]] = []
    for frame_id in frame_ids:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_id))
        ok, frame = capture.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, IMAGE_SIZE, interpolation=cv2.INTER_AREA)
        sampled.append((int(frame_id), gray))
    capture.release()
    if len(sampled) < 3:
        return None

    pair_stats = []
    for (previous_id, previous), (current_id, current) in zip(sampled, sampled[1:]):
        delta_seconds = (current_id - previous_id) / fps
        pair_stats.append(pair_features(previous, current, delta_seconds))
    values = np.stack(pair_stats)
    feature = np.concatenate((values.mean(axis=0), values.std(axis=0))).astype(np.float32)
    return feature if np.isfinite(feature).all() else None


def extract_features(records: list[tuple[Path, str, str, str]]) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    features: list[np.ndarray] = []
    labels: list[str] = []
    groups: list[str] = []
    sources: list[str] = []
    temp_root = DATA_DIR / ".extract-temp"
    temp_root.mkdir(parents=True, exist_ok=True)

    def process(record: tuple[Path, str, str, str]):
        archive_path, member, label, group = record
        try:
            with ZipFile(archive_path) as archive:
                info = archive.getinfo(member)
                suffix = PurePosixPath(member).suffix.casefold()
                fd, raw_path = tempfile.mkstemp(prefix="clip-", suffix=suffix, dir=temp_root)
                os.close(fd)
                video_path = Path(raw_path)
                try:
                    with archive.open(info) as src, video_path.open("wb") as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
                    feature = video_features(video_path)
                finally:
                    video_path.unlink(missing_ok=True)
            if feature is None:
                return None, f"Skip unreadable clip: {member}"
            return (feature, label, group, f"{archive_path.name}:{member}"), None
        except Exception as error:  # keep a corrupt clip from discarding the other public samples
            return None, f"Skip {member}: {type(error).__name__}: {error}"

    workers = max(1, min(4, os.cpu_count() or 1))
    print(f"Extracting video features with {workers} workers.", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process, record) for record in records]
        for index, future in enumerate(as_completed(futures), start=1):
            result, warning = future.result()
            if warning:
                print(warning, flush=True)
            if result is not None:
                feature, label, group, source = result
                features.append(feature)
                labels.append(label)
                groups.append(group)
                sources.append(source)
            if index % 10 == 0 or index == len(records):
                print(f"Processed {index}/{len(records)} labeled clips; usable={len(features)}", flush=True)

    if not features:
        raise RuntimeError("No labeled clips could be decoded.")
    return np.stack(features), np.asarray(labels), groups, sources


def grouped_split(labels: np.ndarray, groups: list[str], seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    groups_by_label: dict[str, set[str]] = defaultdict(set)
    for label, group in zip(labels.tolist(), groups):
        groups_by_label[label].add(group)
    assignment: dict[str, str] = {}
    # Assign rare classes first so the small classes get held-out examples without
    # splitting the same numbered animal's views between training and evaluation.
    for label in sorted(groups_by_label, key=lambda key: len(groups_by_label[key])):
        candidates = np.asarray(sorted(groups_by_label[label]), dtype=object)
        rng.shuffle(candidates)
        unassigned = [str(group) for group in candidates if str(group) not in assignment]
        if not unassigned:
            continue
        test_count = max(1, round(len(candidates) * 0.15)) if len(candidates) >= 5 else 0
        val_count = max(1, round(len(candidates) * 0.15)) if len(candidates) >= 5 else 0
        for group in unassigned[:test_count]:
            assignment[group] = "test"
        for group in unassigned[test_count:test_count + val_count]:
            assignment[group] = "validation"
    train = np.asarray([assignment.get(group, "train") == "train" for group in groups])
    validation = np.asarray([assignment.get(group) == "validation" for group in groups])
    test = np.asarray([assignment.get(group) == "test" for group in groups])
    if not train.any() or not test.any():
        raise RuntimeError("Could not form non-empty group-separated train and test sets.")
    return train, validation, test


def classification_metrics(truth: np.ndarray, predicted: np.ndarray, label_names: tuple[str, ...]) -> dict:
    matrix = np.zeros((len(label_names), len(label_names)), dtype=np.int64)
    for actual, guess in zip(truth, predicted):
        matrix[int(actual), int(guess)] += 1
    recalls = {}
    f1s = []
    for index, name in enumerate(label_names):
        tp = int(matrix[index, index])
        support = int(matrix[index].sum())
        predicted_count = int(matrix[:, index].sum())
        recall = tp / support if support else None
        precision = tp / predicted_count if predicted_count else 0.0
        f1 = 2 * precision * recall / (precision + recall) if recall is not None and precision + recall else 0.0
        recalls[name] = {"support": support, "recall": recall, "f1": f1}
        recalls[name]["precision"] = precision
        if support:
            f1s.append(f1)
    return {
        "accuracy": float(np.mean(truth == predicted)) if len(truth) else None,
        "macro_f1": float(np.mean(f1s)) if f1s else None,
        "per_class": recalls,
        "confusion_matrix_rows_true_columns_predicted": matrix.tolist(),
    }


def train(features: np.ndarray, labels: np.ndarray, groups: list[str], seed: int, epochs: int) -> tuple[dict, dict]:
    label_names = tuple(label for label in LABELS if label in set(labels.tolist()))
    label_to_index = {label: index for index, label in enumerate(label_names)}
    target = np.asarray([label_to_index[label] for label in labels], dtype=np.int64)
    train_mask, val_mask, test_mask = grouped_split(labels, groups, seed)
    mean = features[train_mask].mean(axis=0)
    scale = features[train_mask].std(axis=0)
    scale[scale < 1e-6] = 1.0
    normalized = np.clip((features - mean) / scale, -8, 8).astype(np.float32)

    torch.manual_seed(seed)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    model = nn.Linear(normalized.shape[1], len(label_names))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.02, weight_decay=0.01)
    x_train = torch.from_numpy(normalized[train_mask])
    y_train = torch.from_numpy(target[train_mask])
    train_counts = np.bincount(target[train_mask], minlength=len(label_names))
    class_weights = len(y_train) / np.maximum(1, len(label_names) * train_counts)
    weight_tensor = torch.tensor(class_weights, dtype=torch.float32)
    x_val = torch.from_numpy(normalized[val_mask])
    y_val = torch.from_numpy(target[val_mask])
    best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
    best_val_loss = float("inf")
    stale_epochs = 0
    limit = max(epochs, 1)

    for epoch in range(limit):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        loss = F.cross_entropy(model(x_train), y_train, weight=weight_tensor)
        loss.backward()
        optimizer.step()
        if len(x_val):
            model.eval()
            with torch.no_grad():
                val_loss = float(F.cross_entropy(model(x_val), y_val).item())
            if val_loss < best_val_loss - 1e-5:
                best_val_loss = val_loss
                best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
                stale_epochs = 0
            else:
                stale_epochs += 1
            if stale_epochs >= 60:
                break
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        predictions = torch.softmax(model(torch.from_numpy(normalized[test_mask])), dim=1).numpy()
    predicted = predictions.argmax(axis=1)
    metrics = classification_metrics(target[test_mask], predicted, label_names)
    metrics.update({
        "class_labels": list(label_names),
        "example_counts_total": dict(Counter(labels.tolist())),
        "example_counts_train": dict(Counter(labels[train_mask].tolist())),
        "example_counts_validation": dict(Counter(labels[val_mask].tolist())),
        "example_counts_test": dict(Counter(labels[test_mask].tolist())),
        "unique_subject_groups": len(set(groups)),
        "train_subject_groups": len(set(np.asarray(groups, dtype=object)[train_mask].tolist())),
        "test_subject_groups": len(set(np.asarray(groups, dtype=object)[test_mask].tolist())),
        "feature_version": FEATURE_VERSION,
        "feature_dimensions": int(features.shape[1]),
        "best_validation_loss": best_val_loss if len(x_val) else None,
    })
    artifact = {
        "mean": mean.astype(np.float32),
        "scale": scale.astype(np.float32),
        "weights": model.weight.detach().numpy().astype(np.float32),
        "bias": model.bias.detach().numpy().astype(np.float32),
        "labels": np.asarray(label_names),
        "feature_version": np.asarray(FEATURE_VERSION),
    }
    return artifact, metrics


def predict_video(video_path: Path, model_path: Path) -> dict:
    feature = video_features(video_path)
    if feature is None:
        raise RuntimeError(f"Could not decode enough frames from {video_path}")
    artifact = np.load(model_path, allow_pickle=False)
    if str(artifact["feature_version"]) != FEATURE_VERSION:
        raise RuntimeError("Model feature version does not match this script.")
    normalized = np.clip((feature - artifact["mean"]) / artifact["scale"], -8, 8)
    logits = artifact["weights"] @ normalized + artifact["bias"]
    probabilities = np.exp(logits - logits.max())
    probabilities /= probabilities.sum()
    order = probabilities.argsort()[::-1]
    return {"prediction": str(artifact["labels"][order[0]]), "probabilities": {
        str(artifact["labels"][index]): float(probabilities[index]) for index in order
    }}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", action="append", type=Path, help="Dataset ZIP; repeat for the two public archives.")
    parser.add_argument("--model-out", type=Path, default=MODEL_DIR / "sheep_activity_v1.npz")
    parser.add_argument("--metrics-out", type=Path, default=MODEL_DIR / "sheep_activity_v1_metrics.json")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--epochs", type=int, default=600)
    parser.add_argument("--predict-video", type=Path, help="Predict an activity for one video using a trained model.")
    args = parser.parse_args()

    if args.predict_video:
        print(json.dumps(predict_video(args.predict_video, args.model_out), indent=2))
        return

    archives = args.archive or [DATA_DIR / name for name in ARCHIVE_NAMES]
    archives = [path if path.is_absolute() else (ROOT / path).resolve() for path in archives]
    if args.model_out.exists() or args.metrics_out.exists():
        parser.error("Refusing to overwrite an existing artifact or metrics file; use a new versioned candidate path.")
    records = labeled_videos(archives)
    print(f"Found {len(records)} labeled videos: {dict(Counter(row[2] for row in records))}", flush=True)
    features, labels, groups, sources = extract_features(records)
    artifact, metrics = train(features, labels, groups, args.seed, args.epochs)
    args.model_out.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.model_out, **artifact)
    report = {
        "model": args.model_out.name,
        "model_version": args.model_out.stem,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "training_config": {
            "seed": args.seed,
            "epochs": args.epochs,
            "optimizer": "AdamW",
            "feature_version": FEATURE_VERSION,
            "image_size": list(IMAGE_SIZE),
            "sampled_frames_per_clip": 12,
            "grouped_train_validation_test_split": True,
        },
        "input_archives": [
            {"name": archive.name, "bytes": archive.stat().st_size}
            for archive in archives
        ],
        "input_video_count": len(records),
        "dataset_sources": [
            {"title": "Video Dataset of Sheep Activity (Standing and Walking)", "doi": "10.17632/w65pvb84dg.1", "license": "CC BY 4.0"},
            {"title": "Video Dataset of Sheep Activity (Grazing, Running, Sitting)", "doi": "10.17632/h5ppwx6fn4.1", "license": "CC BY 4.0"},
        ],
        "method": "Group-separated supervised logistic classifier over dense optical-flow statistics from video clips.",
        "limitations": [
            "This model predicts the five source activity labels; it is not trained to identify lameness, illness, or abnormal gait.",
            "The clips are sheep footage from other farms and fixed-camera setups; goat-farm performance needs local validation.",
            "This artifact is an offline training baseline and is not wired into the live alert path by this script.",
            "QR identification remains a separate, farm-verified camera step.",
        ],
        "metrics": metrics,
    }
    artifact_digest = hashlib.sha256(args.model_out.read_bytes()).hexdigest()
    report["artifact_sha256"] = artifact_digest
    args.metrics_out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"model": str(args.model_out), "report": str(args.metrics_out), "metrics": metrics}, indent=2), flush=True)


if __name__ == "__main__":
    main()
