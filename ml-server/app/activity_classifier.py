"""Experimental camera-only classifier for five sheep activity labels."""

from __future__ import annotations

import base64
import binascii
import logging
import threading
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("ml-server.sheep-activity")
MODEL_PATH = Path(__file__).resolve().parent / "artifacts" / "sheep_activity_v1.npz"
LABELS = ("grazing", "running", "sitting", "standing", "walking")
IMAGE_WIDTH = 160
IMAGE_HEIGHT = 90
FRAME_COUNT = 12
MAX_FRAME_BYTES = 256 * 1024
MAX_TOTAL_FRAME_BYTES = 2 * 1024 * 1024
MIN_CLIP_SECONDS = 4.0
MAX_CLIP_SECONDS = 30.0

_model: dict[str, Any] | None = None
_model_error: str | None = None
_model_lock = threading.RLock()


class InvalidActivityClip(ValueError):
    pass


def _load_model() -> dict[str, Any]:
    global _model, _model_error
    with _model_lock:
        if _model is not None:
            return _model
        if not MODEL_PATH.is_file():
            _model_error = "Activity model artifact is missing."
            raise FileNotFoundError(_model_error)
        try:
            with np.load(MODEL_PATH, allow_pickle=False) as archive:
                labels = tuple(str(label) for label in archive["labels"].tolist())
                candidate = {
                    "mean": np.asarray(archive["mean"], dtype=np.float32),
                    "scale": np.asarray(archive["scale"], dtype=np.float32),
                    "weights": np.asarray(archive["weights"], dtype=np.float32),
                    "bias": np.asarray(archive["bias"], dtype=np.float32),
                    "labels": labels,
                    "feature_version": str(archive["feature_version"].item()),
                }
            if (
                labels != LABELS
                or candidate["mean"].shape != (96,)
                or candidate["scale"].shape != (96,)
                or candidate["weights"].shape != (5, 96)
                or candidate["bias"].shape != (5,)
                or candidate["feature_version"] != "dense-flow-grid-v1"
                or not all(np.isfinite(candidate[name]).all() for name in ("mean", "scale", "weights", "bias"))
                or np.any(candidate["scale"] <= 0)
            ):
                raise ValueError("Activity model metadata or tensor shapes are invalid.")
            _model = candidate
            _model_error = None
            return candidate
        except Exception as error:
            _model_error = "Activity model artifact could not be loaded."
            logger.exception("Could not load sheep activity model: %s", error)
            raise RuntimeError(_model_error) from error


def model_status() -> dict[str, Any]:
    try:
        _load_model()
    except (FileNotFoundError, RuntimeError):
        pass
    return {
        "model_loaded": _model is not None,
        "weights_present": MODEL_PATH.is_file(),
        "model_version": "sheep_activity_v1",
        "supported_species": ["sheep"],
        "classes": list(LABELS),
        "model_error": _model_error,
    }


def _decode_frame(item: Any) -> tuple[np.ndarray, float, int]:
    if not isinstance(item, dict):
        raise InvalidActivityClip("Each activity frame must include image and at_ms fields.")
    data_url = item.get("image")
    at_ms = item.get("at_ms")
    prefix = "data:image/jpeg;base64,"
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        raise InvalidActivityClip("Activity frames must be JPEG data URLs.")
    encoded = data_url[len(prefix):]
    if not encoded or len(encoded) > MAX_FRAME_BYTES * 4 // 3 + 8:
        raise InvalidActivityClip("An activity frame is empty or exceeds the size limit.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise InvalidActivityClip("An activity frame is not valid base64.") from error
    if not raw or len(raw) > MAX_FRAME_BYTES:
        raise InvalidActivityClip("An activity frame is empty or exceeds the size limit.")
    if isinstance(at_ms, bool) or not isinstance(at_ms, (int, float)) or not np.isfinite(at_ms):
        raise InvalidActivityClip("Activity frame timestamps are invalid.")
    try:
        with Image.open(BytesIO(raw)) as source:
            if source.format != "JPEG" or source.width * source.height > 640 * 360:
                raise InvalidActivityClip("Activity frame dimensions or format are invalid.")
            source.load()
            gray = cv2.cvtColor(np.asarray(source.convert("RGB")), cv2.COLOR_RGB2GRAY)
    except InvalidActivityClip:
        raise
    except (UnidentifiedImageError, OSError, cv2.error) as error:
        raise InvalidActivityClip("An activity frame could not be decoded.") from error
    gray = cv2.resize(gray, (IMAGE_WIDTH, IMAGE_HEIGHT), interpolation=cv2.INTER_AREA)
    return gray, float(at_ms), len(raw)


def _pair_features(previous: np.ndarray, current: np.ndarray, seconds: float) -> np.ndarray:
    flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    scale = max(seconds, 1e-3)
    flow_x = flow[:, :, 0] / scale
    flow_y = flow[:, :, 1] / scale
    magnitude = cv2.magnitude(flow_x, flow_y)
    features: list[float] = []
    for row in range(2):
        y0, y1 = row * IMAGE_HEIGHT // 2, (row + 1) * IMAGE_HEIGHT // 2
        for col in range(4):
            x0, x1 = col * IMAGE_WIDTH // 4, (col + 1) * IMAGE_WIDTH // 4
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


def predict_activity(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("frames"), list):
        raise InvalidActivityClip("Request must include a frames list.")
    frame_items = payload["frames"]
    if len(frame_items) != FRAME_COUNT:
        raise InvalidActivityClip(f"Exactly {FRAME_COUNT} frames are required for an activity estimate.")

    decoded = [_decode_frame(item) for item in frame_items]
    total_bytes = sum(size for _, _, size in decoded)
    if total_bytes > MAX_TOTAL_FRAME_BYTES:
        raise InvalidActivityClip("The activity clip exceeds the total size limit.")
    timestamps = np.asarray([timestamp for _, timestamp, _ in decoded], dtype=np.float64)
    delta_ms = np.diff(timestamps)
    if np.any(delta_ms <= 0):
        raise InvalidActivityClip("Activity frame timestamps must increase.")
    duration = (timestamps[-1] - timestamps[0]) / 1000.0
    if not MIN_CLIP_SECONDS <= duration <= MAX_CLIP_SECONDS:
        raise InvalidActivityClip("Activity frames must span between 4 and 30 seconds.")

    frames = [image for image, _, _ in decoded]
    pairs = [
        _pair_features(previous, current, seconds)
        for previous, current, seconds in zip(frames, frames[1:], delta_ms / 1000.0)
    ]
    values = np.stack(pairs)
    feature = np.concatenate((values.mean(axis=0), values.std(axis=0))).astype(np.float32)
    if feature.shape != (96,) or not np.isfinite(feature).all():
        raise InvalidActivityClip("Could not compute valid motion features from the activity clip.")

    model = _load_model()
    normalized = np.clip((feature - model["mean"]) / model["scale"], -8, 8)
    logits = model["weights"] @ normalized + model["bias"]
    logits -= float(np.max(logits))
    probabilities = np.exp(logits)
    probabilities /= probabilities.sum()
    best = int(np.argmax(probabilities))
    return {
        "success": True,
        "activity": model["labels"][best],
        "model_score": round(float(probabilities[best]), 6),
        "probabilities": {
            label: round(float(probabilities[index]), 6)
            for index, label in enumerate(model["labels"])
        },
        "model_version": "sheep_activity_v1",
        "screening_only": True,
    }
