import hmac
import hashlib
import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
try:
    import pytesseract
except ImportError:
    pytesseract = None

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv()

if pytesseract is not None:
    configured_tesseract = os.getenv("TESSERACT_CMD", "").strip()
    if configured_tesseract:
        pytesseract.pytesseract.tesseract_cmd = configured_tesseract

from PIL import Image, ImageOps, UnidentifiedImageError

# Keep Pillow's strict opener before Ultralytics adds its optional HEIF fallback.
_PIL_IMAGE_OPEN = Image.open

logger = logging.getLogger("ml-server.species")

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "20000000"))
CONFIDENCE_THRESHOLD = float(os.getenv("YOLO_CONFIDENCE_THRESHOLD", "0.60"))
IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))
MAX_DETECTIONS = int(os.getenv("YOLO_MAX_DETECTIONS", "50"))
PERSON_MODEL_NAME = os.getenv("YOLO_PERSON_MODEL_NAME", "yolo11n.pt").strip() or "yolo11n.pt"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "active" / "best.pt"
MODEL_PATH = Path(os.getenv("YOLO_SPECIES_MODEL_PATH", str(DEFAULT_MODEL_PATH)))
MODEL_VERSION = os.getenv("YOLO_MODEL_VERSION", "new-model-pending")
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": {"JPEG"},
    "image/png": {"PNG"},
    "image/webp": {"WEBP"},
}

_model: Any = None
_person_model: Any = None
_model_error: str | None = None
_person_model_error: str | None = None
_model_sha256: str | None = None
_model_lock = threading.RLock()
_person_model_lock = threading.RLock()
_metrics_lock = threading.Lock()
_successful_inferences = 0
_failed_inferences = 0
_last_success_at: str | None = None
_last_failure_at: str | None = None
_recent_inference_times: deque[float] = deque(maxlen=240)
_recent_inference_latencies_ms: deque[float] = deque(maxlen=240)
_total_detections = {"goat": 0, "sheep": 0}
_last_detections = {"goat": 0, "sheep": 0}
_recent_detections: deque[tuple[float, int]] = deque(maxlen=240)


class SpeciesModelUnavailable(RuntimeError):
    pass


class InvalidImage(ValueError):
    pass


def model_status() -> dict[str, Any]:
    class_names: list[str] = []
    if _model is not None:
        names = _model.names
        values = names if isinstance(names, dict) else dict(enumerate(names))
        class_names = [
            str(name).strip().lower()
            for _, name in sorted((int(index), name) for index, name in values.items())
        ]
    return {
        "model_loaded": _model is not None,
        "weights_present": MODEL_PATH.is_file(),
        "model_path_configured": bool(os.getenv("YOLO_SPECIES_MODEL_PATH")) or str(MODEL_PATH) == str(DEFAULT_MODEL_PATH),
        "model_error": _model_error,
        "classes": class_names,
        "version": MODEL_VERSION,
        "model_sha256": _model_sha256,
        "image_size": IMAGE_SIZE,
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "person_guard_loaded": _person_model is not None,
        "person_guard_error": _person_model_error,
    }


def inference_diagnostics() -> dict[str, Any]:
    """Return bounded, real inference telemetry; do not infer camera health from ML health."""
    now = time.monotonic()
    with _metrics_lock:
        while _recent_inference_times and now - _recent_inference_times[0] > 60:
            _recent_inference_times.popleft()
        while _recent_detections and now - _recent_detections[0][0] > 60:
            _recent_detections.popleft()
        recent_latencies = list(_recent_inference_latencies_ms)
        fps = 0.0
        if len(_recent_inference_times) > 1:
            span = _recent_inference_times[-1] - _recent_inference_times[0]
            if span > 0:
                fps = (len(_recent_inference_times) - 1) / span
        return {
            "successful_inferences_total": _successful_inferences,
            "failed_inferences_total": _failed_inferences,
            "inferences_last_minute": len(_recent_inference_times),
            "inference_fps_recent": round(fps, 3),
            "last_success_at": _last_success_at,
            "last_failure_at": _last_failure_at,
            "detections_last_minute": sum(count for _, count in _recent_detections),
            "total_detections_by_class": dict(_total_detections),
            "last_detections_by_class": dict(_last_detections),
            "latency_ms_average_recent": round(sum(recent_latencies) / len(recent_latencies), 2) if recent_latencies else None,
            "latency_ms_p95_recent": round(sorted(recent_latencies)[min(len(recent_latencies) - 1, int(len(recent_latencies) * 0.95))], 2) if recent_latencies else None,
        }


def _record_inference(success: bool, latency_ms: float, detections: dict[str, int] | None = None) -> None:
    global _successful_inferences, _failed_inferences, _last_success_at, _last_failure_at
    now = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    with _metrics_lock:
        if success:
            counts = detections or {"goat": 0, "sheep": 0}
            _successful_inferences += 1
            _last_success_at = timestamp
            _recent_inference_times.append(now)
            _recent_inference_latencies_ms.append(latency_ms)
            _recent_detections.append((now, counts["goat"] + counts["sheep"]))
            for species in ("goat", "sheep"):
                _last_detections[species] = counts[species]
                _total_detections[species] += counts[species]
        else:
            _failed_inferences += 1
            _last_failure_at = timestamp


def _load_model():
    global _model, _model_error, _model_sha256
    with _model_lock:
        if _model is not None:
            return _model
        if not MODEL_PATH.is_file():
            _model_error = "Weights file is missing."
            raise SpeciesModelUnavailable(_model_error)
        try:
            from ultralytics import YOLO

            candidate = YOLO(str(MODEL_PATH))
            names = candidate.names
            values = names.values() if isinstance(names, dict) else names
            normalized = {str(name).strip().lower() for name in values}
            if normalized != {"goat", "sheep"}:
                _model_error = "Configured weights must contain exactly goat and sheep classes."
                raise SpeciesModelUnavailable(_model_error)
            _model = candidate
            _model_error = None
            digest = hashlib.sha256()
            with MODEL_PATH.open("rb") as weights_file:
                for chunk in iter(lambda: weights_file.read(1024 * 1024), b""):
                    digest.update(chunk)
            _model_sha256 = digest.hexdigest()
            logger.info("Goat/sheep YOLO model loaded from configured private storage.")
            return _model
        except SpeciesModelUnavailable:
            raise
        except Exception as error:
            _model_error = "Configured YOLO weights could not be loaded."
            logger.exception("Could not load configured goat/sheep model: %s", error)
            raise SpeciesModelUnavailable(_model_error) from error


def load_species_model() -> Any:
    """Load only the configured goat/sheep detector; never substitute weights."""
    return _load_model()


def load_person_guard_model() -> Any:
    """Load a COCO person detector used to reject people misclassified as livestock."""
    global _person_model, _person_model_error
    with _person_model_lock:
        if _person_model is not None:
            return _person_model
        try:
            from ultralytics import YOLO

            candidate = YOLO(PERSON_MODEL_NAME)
            names = candidate.names
            values = names.values() if isinstance(names, dict) else names
            normalized = {str(name).strip().lower() for name in values}
            if "person" not in normalized:
                _person_model_error = "The person guard model has no person class."
                raise SpeciesModelUnavailable(_person_model_error)
            _person_model = candidate
            _person_model_error = None
            logger.info("COCO person guard model loaded.")
            return _person_model
        except SpeciesModelUnavailable:
            raise
        except Exception as error:
            _person_model_error = "The person guard model could not be loaded."
            logger.exception("Could not load COCO person guard model: %s", error)
            raise SpeciesModelUnavailable(_person_model_error) from error


def _person_boxes(image: Image.Image, device: str | None = None) -> list[tuple[float, float, float, float]]:
    model = load_person_guard_model()
    result = model.predict(
        image,
        classes=[0],
        conf=0.25,
        imgsz=min(IMAGE_SIZE, 640),
        max_det=20,
        verbose=False,
        **({"device": device} if device is not None else {}),
    )[0]
    boxes = result.boxes
    if boxes is None:
        return []
    return [tuple(float(value) for value in box.xyxy[0].tolist()) for box in boxes]


def _is_person_detection(
    animal_box: tuple[float, float, float, float],
    people: list[tuple[float, float, float, float]],
) -> bool:
    x1, y1, x2, y2 = animal_box
    animal_area = max(1.0, (x2 - x1) * (y2 - y1))
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    for px1, py1, px2, py2 in people:
        # Suppress a livestock class when a person substantially explains the
        # livestock box, including the inverse case where a broad false goat
        # box encloses the person. Requiring strong overlap in either direction
        # avoids dropping a real goat that is merely near someone.
        pad_x = (px2 - px1) * 0.04
        pad_y = (py2 - py1) * 0.04
        center_inside = px1 - pad_x <= center_x <= px2 + pad_x and py1 - pad_y <= center_y <= py2 + pad_y
        overlap_w = max(0.0, min(x2, px2) - max(x1, px1))
        overlap_h = max(0.0, min(y2, py2) - max(y1, py1))
        overlap_area = overlap_w * overlap_h
        person_area = max(1.0, (px2 - px1) * (py2 - py1))
        person_center_inside_animal = x1 <= (px1 + px2) / 2 <= x2 and y1 <= (py1 + py2) / 2 <= y2
        if (center_inside and overlap_area / animal_area >= 0.55) or (
            person_center_inside_animal and overlap_area / person_area >= 0.75
        ):
            return True
    return False


def _decode_qr_codes_in_ear_region(
    image: Image.Image,
    box: tuple[float, float, float, float],
    decoder: cv2.QRCodeDetector,
) -> list[dict[str, Any]]:
    """Decode real QR payloads only from the upper animal ROI and return image-space boxes."""
    width, height = image.size
    x1, y1, x2, y2 = box
    animal_width = max(1.0, x2 - x1)
    animal_height = max(1.0, y2 - y1)
    crop_left = max(0, int(x1 - animal_width * 0.06))
    crop_top = max(0, int(y1 - animal_height * 0.03))
    crop_right = min(width, int(x2 + animal_width * 0.06))
    # Eartags are attached around the head/ear region; exclude most of the body and background.
    crop_bottom = min(height, int(y1 + animal_height * 0.72))
    if crop_right - crop_left < 16 or crop_bottom - crop_top < 16:
        return []

    roi = np.asarray(image.crop((crop_left, crop_top, crop_right, crop_bottom)).convert("RGB"))
    gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
    decoded: list[tuple[str, np.ndarray]] = []
    try:
        found, values, points, _ = decoder.detectAndDecodeMulti(gray)
        if found and points is not None:
            for value, polygon in zip(values, points):
                if value and len(value) <= 2_048:
                    decoded.append((value, np.asarray(polygon, dtype=np.float32).reshape(-1, 2)))
    except (cv2.error, AttributeError, TypeError, ValueError):
        # Older OpenCV builds may lack the multi-code API; use its real single-code decoder.
        pass

    if not decoded:
        try:
            value, points, _ = decoder.detectAndDecode(gray)
            if value and points is not None and len(value) <= 2_048:
                decoded.append((value, np.asarray(points, dtype=np.float32).reshape(-1, 2)))
        except (cv2.error, AttributeError, TypeError, ValueError):
            return []

    results: list[dict[str, Any]] = []
    seen_values: set[str] = set()
    for value, polygon in decoded:
        if value in seen_values or polygon.shape[0] < 4:
            continue
        seen_values.add(value)
        qr_x1 = max(0.0, float(crop_left + polygon[:, 0].min()))
        qr_y1 = max(0.0, float(crop_top + polygon[:, 1].min()))
        qr_x2 = min(float(width), float(crop_left + polygon[:, 0].max()))
        qr_y2 = min(float(height), float(crop_top + polygon[:, 1].max()))
        if qr_x2 <= qr_x1 or qr_y2 <= qr_y1:
            continue
        results.append({
            "value": value,
            "bbox": {
                "x1": round(qr_x1, 2), "y1": round(qr_y1, 2),
                "x2": round(qr_x2, 2), "y2": round(qr_y2, 2),
            },
        })
    return results


def _read_eartag_numbers_in_ear_region(
    image: Image.Image,
    box: tuple[float, float, float, float],
) -> list[dict[str, Any]]:
    """Read complete numeric strings from the animal's upper head/tag area.

    OCR is restricted to the upper animal ROI and accepts digits only. A later
    tracking layer must still confirm the same value in three frames before it
    can identify an animal.
    """
    width, height = image.size
    x1, y1, x2, y2 = box
    animal_width = max(1.0, x2 - x1)
    animal_height = max(1.0, y2 - y1)
    crop_left = max(0, int(x1 - animal_width * 0.06))
    crop_top = max(0, int(y1 - animal_height * 0.03))
    crop_right = min(width, int(x2 + animal_width * 0.06))
    crop_bottom = min(height, int(y1 + animal_height * 0.58))
    if crop_right - crop_left < 20 or crop_bottom - crop_top < 16:
        return []

    roi = np.asarray(image.crop((crop_left, crop_top, crop_right, crop_bottom)).convert("RGB"))
    gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
    scale = min(4, max(2, int(96 / max(1, min(gray.shape[:2])))))
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(gray)

    if pytesseract is None:
        return []

    candidates: list[tuple[int, float, int, int, int, int]] = []
    variants = [gray, cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]]
    for processed in variants:
        try:
            data = pytesseract.image_to_data(
                processed,
                config="--oem 1 --psm 7 -c tessedit_char_whitelist=0123456789",
                output_type=pytesseract.Output.DICT,
                timeout=1.5,
            )
        except (pytesseract.TesseractNotFoundError, pytesseract.TesseractError, RuntimeError):
            # OCR is optional during local development if the system binary is not installed.
            return []
        for index, text in enumerate(data.get("text", [])):
            value = str(text).strip()
            try:
                score = float(data["conf"][index])
                left, top = int(data["left"][index]), int(data["top"][index])
                word_width, word_height = int(data["width"][index]), int(data["height"][index])
            except (KeyError, TypeError, ValueError, IndexError):
                continue
            # No letter substitution, partial non-digits, zero, or overlong value.
            if not value.isascii() or not value.isdigit() or not 1 <= len(value) <= 6 or score < 45:
                continue
            number = int(value)
            if number <= 0 or word_width <= 0 or word_height <= 0:
                continue
            candidates.append((number, score, left, top, word_width, word_height))

    if not candidates:
        return []
    # Prefer the strongest full numeric word. Do not combine separate OCR
    # fragments: that can turn a partial/ambiguous tag into a guessed number.
    number, score, left, top, word_width, word_height = max(candidates, key=lambda candidate: candidate[1])
    inverse_scale = 1 / scale
    number_box = {
        "x1": round(crop_left + left * inverse_scale, 2),
        "y1": round(crop_top + top * inverse_scale, 2),
        "x2": round(crop_left + (left + word_width) * inverse_scale, 2),
        "y2": round(crop_top + (top + word_height) * inverse_scale, 2),
    }
    return [{"value": str(number), "confidence": round(score, 1), "bbox": number_box}]


def verify_species_api_key(candidate: str | None) -> None:
    expected = os.getenv("SPECIES_API_KEY", "")
    if not expected:
        raise SpeciesModelUnavailable("Species API secret is not configured.")
    if not candidate or not hmac.compare_digest(candidate, expected):
        raise PermissionError("Invalid API key.")


def decode_image(contents: bytes, content_type: str | None) -> Image.Image:
    accepted_formats = ALLOWED_IMAGE_TYPES.get((content_type or "").lower())
    if accepted_formats is None:
        raise InvalidImage("Upload must be JPG, PNG, or WebP.")
    if not contents or len(contents) > MAX_IMAGE_BYTES:
        raise InvalidImage("Image is empty or exceeds the upload limit.")

    try:
        with _PIL_IMAGE_OPEN(BytesIO(contents)) as source:
            if source.format not in accepted_formats:
                raise InvalidImage("Image content does not match its declared file type.")
            width, height = source.size
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise InvalidImage("Image dimensions are invalid or too large.")
            source.verify()
        with _PIL_IMAGE_OPEN(BytesIO(contents)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.load()
            return image
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise InvalidImage("Image is corrupt or cannot be decoded.") from error


def detect(
    image: Image.Image,
    *,
    persist_tracking: bool = False,
    device: str | None = None,
    include_identification: bool = True,
    identification_max_detections: int | None = None,
    identification_line_y: float | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        people = _person_boxes(image, device=device)
        model = _load_model()
        if persist_tracking:
            result = model.track(
                image,
                conf=CONFIDENCE_THRESHOLD,
                imgsz=IMAGE_SIZE,
                max_det=MAX_DETECTIONS,
                tracker="bytetrack.yaml",
                persist=True,
                verbose=False,
                **({"device": device} if device is not None else {}),
            )[0]
        else:
            result = model.predict(image, conf=CONFIDENCE_THRESHOLD, imgsz=IMAGE_SIZE, max_det=MAX_DETECTIONS, verbose=False)[0]
        names = model.names
        predictions: list[dict[str, Any]] = []
        counts = {"goat": 0, "sheep": 0}
        boxes = result.boxes
        qr_decoder = cv2.QRCodeDetector() if include_identification else None
        identification_indices: set[int] | None = None
        if include_identification and identification_max_detections is not None:
            limit = max(0, identification_max_detections)
            candidates: list[tuple[float, int]] = []
            if boxes is not None and limit:
                for candidate_index, candidate_box in enumerate(boxes):
                    candidate_class_id = int(candidate_box.cls[0].item())
                    candidate_class = str(names[candidate_class_id] if not isinstance(names, dict) else names[candidate_class_id]).strip().lower()
                    if candidate_class not in counts:
                        continue
                    candidate_coords = [float(value) for value in candidate_box.xyxy[0].tolist()]
                    if _is_person_detection(tuple(candidate_coords), people):
                        continue
                    if identification_line_y is not None:
                        center_y = ((candidate_coords[1] + candidate_coords[3]) / 2) / max(1, image.height)
                        rank = abs(center_y - identification_line_y)
                    else:
                        rank = -float(candidate_box.conf[0].item())
                    candidates.append((rank, candidate_index))
            identification_indices = {index for _, index in sorted(candidates)[:limit]}
        if boxes is not None:
            for box_index, box in enumerate(boxes):
                class_id = int(box.cls[0].item())
                class_name = str(names[class_id] if not isinstance(names, dict) else names[class_id]).strip().lower()
                if class_name not in counts:
                    continue
                confidence = float(box.conf[0].item())
                x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
                if _is_person_detection((x1, y1, x2, y2), people):
                    continue
                identify_this_animal = include_identification and (
                    identification_indices is None or box_index in identification_indices
                )
                qr_codes = _decode_qr_codes_in_ear_region(image, (x1, y1, x2, y2), qr_decoder) if identify_this_animal and qr_decoder else []
                eartag_numbers = _read_eartag_numbers_in_ear_region(image, (x1, y1, x2, y2)) if identify_this_animal else []
                predictions.append({
                    "class": class_name,
                    "confidence": round(confidence, 6),
                    "bbox": {
                        "x1": round(x1, 2), "y1": round(y1, 2),
                        "x2": round(x2, 2), "y2": round(y2, 2),
                    },
                    "qr_codes": qr_codes,
                    "eartag_numbers": eartag_numbers,
                })
                if persist_tracking and boxes.id is not None:
                    predictions[-1]["tracking_id"] = str(int(boxes.id[box_index].item()))
                counts[class_name] += 1

        latency_ms = (time.perf_counter() - started) * 1000
        _record_inference(True, latency_ms, counts)
        return {
            "success": True,
            "counts": {
                "goat": counts["goat"],
                "sheep": counts["sheep"],
                "total": len(predictions),
            },
            "predictions": predictions,
            "model_version": MODEL_VERSION,
            "inference_ms": round(latency_ms, 2),
            "image": {"width": image.width, "height": image.height},
        }
    except SpeciesModelUnavailable:
        _record_inference(False, (time.perf_counter() - started) * 1000)
        raise
    except Exception as error:
        _record_inference(False, (time.perf_counter() - started) * 1000)
        logger.exception("Goat/sheep inference failed: %s", error)
        raise RuntimeError("Inference failed.") from error
