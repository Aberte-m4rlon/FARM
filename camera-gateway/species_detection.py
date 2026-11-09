from __future__ import annotations

import logging
import json
import math
import os
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
import ipaddress
import re

import cv2
import numpy as np
import requests


# Fixed Tapo gate-camera background: the upper-right crossbeam repeatedly
# receives goat scores even in empty-shelter footage. Keep configurable because
# a different camera mounting may place animals inside this region.
DEFAULT_STATIC_BACKGROUND_REGIONS = ((0.68, 0.05, 0.84, 0.38),)
DEFAULT_ROBOFLOW_API_URL = "https://serverless.roboflow.com"
DEFAULT_ROBOFLOW_MODEL_ID = "animal-detect-8sepq/2"


@dataclass(frozen=True)
class DetectionSnapshot:
    sequence: int
    captured_at: float
    completed_at: float
    detections: tuple[dict[str, Any], ...]
    inference_ms: float
    model_version: str
    raw_detections: tuple[dict[str, Any], ...] = ()
    rejected_detections: tuple[dict[str, Any], ...] = ()
    observed_classes: tuple[str, ...] = ()


def _bounded_float(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return min(high, max(low, value)) if math.isfinite(value) else default


def _parse_excluded_regions(value: str) -> tuple[tuple[float, float, float, float], ...]:
    """Parse camera-specific normalized boxes: x1,y1,x2,y2;..."""
    regions: list[tuple[float, float, float, float]] = []
    for item in value.split(";"):
        if not item.strip():
            continue
        try:
            coordinates = tuple(float(part.strip()) for part in item.split(","))
        except (TypeError, ValueError, OverflowError):
            continue
        if len(coordinates) != 4 or not all(math.isfinite(part) for part in coordinates):
            continue
        x1, y1, x2, y2 = coordinates
        if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
            continue
        regions.append((x1, y1, x2, y2))
    return tuple(regions)


class SpeciesDetectionWorker:
    """Low-rate, latest-frame ML client; OpenCV remains the per-frame tracker."""

    def __init__(
        self,
        detector_url: str | None = None,
        api_key: str = "",
        expected_sha256: str = "",
        *,
        backend: str = "private",
        model_id: str = "",
        confidence_threshold: float = 0.5,
        request_timeout_seconds: float = 8.0,
        interval_seconds: float = 1.0,
        max_interval_seconds: float = 2.5,
        excluded_regions: tuple[tuple[float, float, float, float], ...] = (),
        logger: logging.Logger | None = None,
        session_factory: Any = requests.Session,
        roboflow_client_factory: Any | None = None,
    ) -> None:
        self.backend = backend
        self.detector_url = (detector_url or "").rstrip("/")
        self.health_url = self.detector_url.removesuffix("/api/v1/detect") + "/api/v1/detect/health"
        self.api_key = api_key
        self.expected_sha256 = expected_sha256.lower()
        self.model_id = model_id
        self.confidence_threshold = min(0.99, max(0.05, float(confidence_threshold)))
        self.request_timeout_seconds = min(30.0, max(2.0, float(request_timeout_seconds)))
        self.base_interval = max(0.5, interval_seconds)
        self.max_interval = max(self.base_interval, max_interval_seconds)
        self.interval = self.base_interval
        self.excluded_regions = excluded_regions
        self.logger = logger or logging.getLogger("alpasfarm.camera_gateway.species")
        self._debug_enabled = os.getenv("CAMERA_GATEWAY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
        self._debug_dir = Path(__file__).resolve().parent / "state" / "hybrid-debug"
        self._session_factory = session_factory
        self._roboflow_client_factory = roboflow_client_factory
        self._roboflow_client: Any | None = None
        self._frames: queue.Queue[tuple[np.ndarray, float] | None] = queue.Queue(maxsize=1)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._snapshot: DetectionSnapshot | None = None
        self._sequence = 0
        self._ready = False
        self._actual_sha256: str | None = None
        self._model_version = "unavailable"
        self._last_error: str | None = None
        self._latencies: deque[float] = deque(maxlen=60)
        self._inferences = 0
        self._failed = 0
        self._failure_streak = 0
        self._stale = 0
        self._dropped = 0
        self._excluded_detections = 0
        self._last_success_at: float | None = None
        self._api_calls = 0
        self._observed_classes: tuple[str, ...] = ()

    @classmethod
    def from_env(cls, *, logger: logging.Logger | None = None) -> SpeciesDetectionWorker | None:
        log = logger or logging.getLogger("alpasfarm.camera_gateway.species")
        roboflow_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
        roboflow_url = os.getenv("ROBOFLOW_API_URL", "").strip() or DEFAULT_ROBOFLOW_API_URL
        roboflow_model_id = os.getenv("ROBOFLOW_MODEL_ID", "").strip() or DEFAULT_ROBOFLOW_MODEL_ID
        roboflow_requested = any(os.getenv(name, "").strip() for name in (
            "ROBOFLOW_API_KEY", "ROBOFLOW_API_URL", "ROBOFLOW_MODEL_ID",
        ))
        configured_regions = os.getenv("CAMERA_HYBRID_EXCLUDED_REGIONS", "").strip()
        excluded_regions = (
            DEFAULT_STATIC_BACKGROUND_REGIONS
            if not configured_regions
            else _parse_excluded_regions(configured_regions)
        )

        if roboflow_requested:
            parsed = urlparse(roboflow_url)
            if not roboflow_key:
                log.error("Roboflow is configured but ROBOFLOW_API_KEY is missing; hybrid counting will fail closed.")
                return None
            if (
                parsed.scheme != "https"
                or parsed.hostname != "serverless.roboflow.com"
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                log.error("Roboflow detector is disabled; use the HTTPS serverless.roboflow.com endpoint.")
                return None
            if not re.fullmatch(r"[A-Za-z0-9_-]+/[0-9]+", roboflow_model_id):
                log.error("Roboflow detector is disabled; ROBOFLOW_MODEL_ID must be a project/version identifier.")
                return None
            if excluded_regions:
                log.info("Roboflow detector has %s camera-specific background exclusion region(s) configured.", len(excluded_regions))
            return cls(
                roboflow_url,
                roboflow_key,
                backend="roboflow",
                model_id=roboflow_model_id,
                confidence_threshold=_bounded_float("ROBOFLOW_CONFIDENCE_THRESHOLD", 0.5, 0.05, 0.99),
                request_timeout_seconds=_bounded_float("ROBOFLOW_REQUEST_TIMEOUT_SECONDS", 8.0, 2.0, 30.0),
                interval_seconds=_bounded_float("CAMERA_ML_INTERVAL_SECONDS", 1.0, 0.5, 3.0),
                max_interval_seconds=_bounded_float("CAMERA_ML_MAX_INTERVAL_SECONDS", 2.5, 1.0, 5.0),
                excluded_regions=excluded_regions,
                logger=log,
            )

        url = os.getenv("CAMERA_HYBRID_DETECTOR_URL", "").strip()
        key = os.getenv("CAMERA_HYBRID_API_KEY", "").strip()
        fingerprint = os.getenv("CAMERA_HYBRID_MODEL_SHA256", "").strip()
        if not (url or key or fingerprint):
            return None
        # An unpinned or unauthenticated model must never silently become the
        # livestock source of truth.
        if not (url and key and len(fingerprint) == 64 and all(c in "0123456789abcdefABCDEF" for c in fingerprint)):
            log.warning("Hybrid detector is disabled; its private URL, API key, and approved model SHA must all be configured.")
            return None
        parsed = urlparse(url)
        private_http = False
        if parsed.scheme == "http" and parsed.hostname:
            try:
                private_http = parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"} or ipaddress.ip_address(parsed.hostname).is_private
            except ValueError:
                private_http = parsed.hostname.lower() == "localhost"
        if (
            parsed.scheme != "https" and not private_http
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path.rstrip("/") != "/api/v1/detect"
        ):
            log.warning("Hybrid detector is disabled; use a private HTTPS or LAN endpoint ending in /api/v1/detect.")
            return None
        if excluded_regions:
            log.info("Hybrid detector has %s camera-specific background exclusion region(s) configured.", len(excluded_regions))
        return cls(
            url,
            key,
            fingerprint,
            interval_seconds=_bounded_float("CAMERA_ML_INTERVAL_SECONDS", 1.0, 0.5, 3.0),
            max_interval_seconds=_bounded_float("CAMERA_ML_MAX_INTERVAL_SECONDS", 2.5, 1.0, 5.0),
            excluded_regions=excluded_regions,
            logger=log,
        )

    @staticmethod
    def configuration_requested() -> bool:
        """True when config signals ML mode, even if its credentials are incomplete."""
        return any(os.getenv(name, "").strip() for name in (
            "ROBOFLOW_API_KEY", "ROBOFLOW_API_URL", "ROBOFLOW_MODEL_ID",
            "CAMERA_HYBRID_DETECTOR_URL", "CAMERA_HYBRID_API_KEY", "CAMERA_HYBRID_MODEL_SHA256",
        ))

    @property
    def enabled(self) -> bool:
        return True

    @property
    def ready(self) -> bool:
        with self._lock:
            return self._ready

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="alpasfarm-species-detector", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 3.0) -> None:
        self._stop.set()
        try:
            self._frames.put_nowait(None)
        except queue.Full:
            try:
                self._frames.get_nowait()
                self._frames.put_nowait(None)
            except queue.Empty:
                pass
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def submit(self, frame: np.ndarray, captured_at: float | None = None) -> None:
        if self._stop.is_set() or not isinstance(frame, np.ndarray) or frame.size == 0:
            return
        item = (frame.copy(), captured_at if captured_at is not None else time.monotonic())
        try:
            self._frames.put_nowait(item)
        except queue.Full:
            try:
                self._frames.get_nowait()
                self._frames.put_nowait(item)
                with self._lock:
                    self._dropped += 1
            except queue.Empty:
                pass

    def latest_after(self, sequence: int) -> DetectionSnapshot | None:
        with self._lock:
            snapshot = self._snapshot
            if snapshot is None or snapshot.sequence <= sequence:
                return None
            return DetectionSnapshot(
                snapshot.sequence,
                snapshot.captured_at,
                snapshot.completed_at,
                tuple(dict(item) for item in snapshot.detections),
                snapshot.inference_ms,
                snapshot.model_version,
                tuple(dict(item) for item in snapshot.raw_detections),
                tuple(dict(item) for item in snapshot.rejected_detections),
                tuple(snapshot.observed_classes),
            )

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            recent = list(self._latencies)
            return {
                "enabled": True,
                "backend": self.backend,
                "ready": self._ready,
                "model_version": self._model_version,
                "model_sha256": self._actual_sha256,
                "inferences": self._inferences,
                "api_calls": self._api_calls,
                "failed": self._failed,
                "excluded_detections": self._excluded_detections,
                "stale": self._stale,
                "dropped_frames": self._dropped,
                "mean_latency_ms": round(sum(recent) / len(recent), 1) if recent else None,
                "p95_latency_ms": round(sorted(recent)[min(len(recent) - 1, int(len(recent) * 0.95))], 1) if recent else None,
                "base_interval_seconds": round(self.base_interval, 2),
                "effective_interval_seconds": round(self.interval, 2),
                "request_timeout_seconds": self.request_timeout_seconds,
                "observed_classes": list(self._observed_classes),
                "last_error": self._last_error,
            }

    def _new_roboflow_client(self) -> Any:
        if self._roboflow_client_factory is not None:
            return self._roboflow_client_factory(
                self.detector_url,
                self.api_key,
                self.confidence_threshold,
            )
        from inference_sdk import InferenceConfiguration, InferenceHTTPClient

        configuration = InferenceConfiguration(
            api_key_transport="header",
            confidence_threshold=self.confidence_threshold,
            max_concurrent_requests=1,
            max_batch_size=1,
        )
        return InferenceHTTPClient(
            api_url=self.detector_url,
            api_key=self.api_key,
        ).configure(configuration)

    def _roboflow_infer(self, frame: np.ndarray) -> dict[str, Any]:
        if self._roboflow_client is None:
            raise RuntimeError("Roboflow SDK client is unavailable.")
        # The SDK currently uses a thread-local requests.Session without a
        # public timeout setting. Apply a timeout to that worker-owned session;
        # fail closed if a future SDK changes this seam rather than send an
        # unbounded HTTP request.
        from inference_sdk.http.utils import executors

        session_factory = getattr(executors, "_get_thread_local_requests_session", None)
        if not callable(session_factory):
            raise RuntimeError("Installed Roboflow SDK cannot enforce the configured request timeout.")
        session = session_factory()
        original_request = session.request

        def request_with_timeout(method: str, url: str, **kwargs: Any) -> Any:
            kwargs.setdefault("timeout", (2.0, self.request_timeout_seconds))
            with self._lock:
                self._api_calls += 1
            return original_request(method, url, **kwargs)

        session.request = request_with_timeout
        try:
            result = self._roboflow_client.infer(frame, model_id=self.model_id)
        finally:
            session.request = original_request
        if not isinstance(result, dict):
            raise ValueError("Roboflow returned an invalid inference response.")
        return result

    @staticmethod
    def _roboflow_predictions_to_body(
        result: dict[str, Any], width: int, height: int, model_id: str,
    ) -> dict[str, Any]:
        predictions = result.get("predictions")
        if not isinstance(predictions, list):
            raise ValueError("Roboflow response has no prediction list.")
        image = result.get("image")
        if isinstance(image, dict):
            try:
                reported_width = int(image.get("width", width))
                reported_height = int(image.get("height", height))
            except (TypeError, ValueError, OverflowError) as error:
                raise ValueError("Roboflow returned invalid image dimensions.") from error
            if reported_width != width or reported_height != height:
                raise ValueError("Roboflow response dimensions do not match the submitted camera frame.")

        converted: list[dict[str, Any]] = []
        for item in predictions:
            if not isinstance(item, dict):
                continue
            try:
                center_x = float(item["x"])
                center_y = float(item["y"])
                box_width = float(item["width"])
                box_height = float(item["height"])
                confidence = float(item["confidence"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if not all(math.isfinite(value) for value in (center_x, center_y, box_width, box_height, confidence)):
                continue
            if box_width <= 0 or box_height <= 0:
                continue
            label = item.get("class")
            if not isinstance(label, str) or not label.strip():
                label = item.get("class_name")
            if not isinstance(label, str) or not label.strip():
                continue
            converted.append({
                "class": label.strip(),
                "confidence": confidence,
                "bbox": {
                    "x1": center_x - box_width / 2.0,
                    "y1": center_y - box_height / 2.0,
                    "x2": center_x + box_width / 2.0,
                    "y2": center_y + box_height / 2.0,
                },
            })
        return {
            "success": True,
            "image": {"width": width, "height": height},
            "model_version": str(result.get("model_version") or model_id),
            "predictions": converted,
        }

    def _check_model(self, session: requests.Session) -> bool:
        try:
            response = session.get(self.health_url, timeout=(2.0, 3.0))
            response.raise_for_status()
            body = response.json()
            classes = body.get("classes")
            actual_hash = str(body.get("model_sha256") or "").lower()
            ready = (
                body.get("status") == "ready"
                and body.get("model_loaded") is True
                and isinstance(classes, list)
                and {str(name).strip().lower() for name in classes} == {"goat", "sheep"}
                and actual_hash == self.expected_sha256
            )
            with self._lock:
                self._ready = ready
                self._actual_sha256 = actual_hash or None
                self._model_version = str(body.get("model_version") or "unknown")
                self._last_error = None if ready else "Model health, classes, or pinned fingerprint did not match."
            if ready:
                self.logger.info("Hybrid animal detector ready: version=%s fingerprint verified.", self._model_version)
            else:
                self.logger.error("Hybrid detector is disabled because model health or its pinned goat/sheep fingerprint did not match.")
            return ready
        except (requests.RequestException, ValueError, TypeError, AttributeError) as error:
            with self._lock:
                self._ready = False
                self._last_error = type(error).__name__
            self.logger.warning("Hybrid detector health check failed; animal detections remain disabled (%s).", type(error).__name__)
            return False

    @staticmethod
    def _normalize_predictions(body: dict[str, Any], width: int, height: int) -> tuple[dict[str, Any], ...]:
        raw = body.get("predictions")
        if not isinstance(raw, list):
            raise ValueError("Detector response has no prediction list.")
        if width <= 0 or height <= 0:
            raise ValueError("Detector frame dimensions are invalid.")
        normalized: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            label = item.get("class")
            if not isinstance(label, str) or not label.strip():
                label = item.get("class_name")
            if not isinstance(label, str) or not label.strip():
                continue
            bbox = item.get("bbox")
            confidence = item.get("confidence")
            if not isinstance(bbox, dict) or not isinstance(confidence, (int, float)):
                continue
            try:
                values = [float(bbox[key]) for key in ("x1", "y1", "x2", "y2")]
                confidence = float(confidence)
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if not all(math.isfinite(value) for value in (*values, confidence)) or not 0.0 <= confidence <= 1.0:
                continue
            x1, y1, x2, y2 = values
            x1, x2 = min(width - 1.0, max(0.0, x1)), min(float(width), max(0.0, x2))
            y1, y2 = min(height - 1.0, max(0.0, y1)), min(float(height), max(0.0, y2))
            if x2 <= x1 or y2 <= y1:
                continue
            normalized.append({
                "class": label.strip(),
                "confidence": confidence,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            })
        return tuple(normalized)

    def _prepare_predictions(
        self,
        body: dict[str, Any],
        width: int,
        height: int,
    ) -> tuple[tuple[dict[str, Any], ...], tuple[dict[str, Any], ...], tuple[dict[str, Any], ...]]:
        """Apply the same ML geometry and fixed-camera filters to live and replay frames."""
        normalized = self._normalize_predictions(body, width, height)
        raw_detections = normalized
        eligible: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        for item in normalized:
            species = item["class"].strip().casefold()
            if species not in {"goat", "sheep"}:
                rejected.append({**item, "rejection_reason": "unrelated_class"})
                continue
            if self.backend == "roboflow" and item["confidence"] < self.confidence_threshold:
                rejected.append({**item, "rejection_reason": "below_confidence_threshold"})
                continue
            eligible.append({**item, "class": species})
        detections, static_rejected = self._exclude_static_background(tuple(eligible), width, height)
        rejected.extend(static_rejected)
        developer = body.get("developer_diagnostics")
        server_rejected: list[dict[str, Any]] = []
        if isinstance(developer, dict):
            raw_source = developer.get("raw_detections")
            if isinstance(raw_source, list):
                raw_detections = self._normalize_predictions({"predictions": raw_source}, width, height)
            rejected_source = developer.get("rejected_detections")
            if isinstance(rejected_source, list):
                for item in rejected_source:
                    if not isinstance(item, dict):
                        continue
                    normalized_item = self._normalize_predictions({"predictions": [item]}, width, height)
                    if not normalized_item:
                        continue
                    reasons = item.get("rejection_reasons")
                    normalized_rejected = dict(normalized_item[0])
                    normalized_rejected["rejection_reason"] = ",".join(
                        reason for reason in reasons if isinstance(reason, str)
                    ) if isinstance(reasons, list) else str(item.get("rejection_reason") or "model_filter")
                    server_rejected.append(normalized_rejected)
        return detections, raw_detections, tuple(server_rejected) + tuple(rejected)

    def _detect(self, session: requests.Session, frame: np.ndarray, captured_at: float) -> None:
        height, width = frame.shape[:2]
        started = time.perf_counter()
        if self.backend == "roboflow":
            input_frame = frame
            if frame.ndim == 2:
                input_frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            elif frame.ndim == 3 and frame.shape[2] == 4:
                input_frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            elif frame.ndim != 3 or frame.shape[2] != 3:
                raise ValueError("Roboflow input frame must be grayscale, BGR, or BGRA.")
            result = self._roboflow_infer(input_frame)
            body = self._roboflow_predictions_to_body(result, width, height, self.model_id)
        else:
            ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 72])
            if not ok:
                raise ValueError("OpenCV could not encode the detector frame.")
            files = {"image": ("camera.jpg", encoded.tobytes(), "image/jpeg")}
            headers = {"X-API-Key": self.api_key}
            timeout = (2.0, max(5.0, self.interval * 3.0))
            response = session.post(
                self.detector_url + ("?diagnostics=1" if self._debug_enabled else ""),
                files=files,
                headers=headers,
                timeout=timeout,
            )
            if self._debug_enabled and response.status_code == 404:
                # Keep tracking alive if diagnostics are disabled or the local ML
                # service has not been restarted with the developer endpoint yet.
                response = session.post(self.detector_url, files=files, headers=headers, timeout=timeout)
            response.raise_for_status()
            body = response.json()
            if body.get("success") is not True:
                raise ValueError("Detector response did not confirm inference success.")
        image = body.get("image")
        if not isinstance(image, dict) or image.get("width") != width or image.get("height") != height:
            raise ValueError("Detector frame dimensions differ from the submitted frame.")
        detections, raw_detections, all_rejected = self._prepare_predictions(body, width, height)
        observed_classes = tuple(sorted({item["class"] for item in raw_detections}))
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        now = time.monotonic()
        with self._lock:
            self._sequence += 1
            self._inferences += 1
            self._ready = True
            self._excluded_detections += len(all_rejected)
            self._failure_streak = 0
            self._last_success_at = now
            self._last_error = None
            self._model_version = str(body.get("model_version") or self._model_version)
            self._observed_classes = observed_classes
            self._latencies.append(elapsed_ms)
            p95 = sorted(self._latencies)[min(len(self._latencies) - 1, int(len(self._latencies) * 0.95))]
            self.interval = min(self.max_interval, max(self.base_interval, p95 / 1000.0 * 1.25))
            self._snapshot = DetectionSnapshot(
                self._sequence,
                captured_at,
                now,
                detections,
                elapsed_ms,
                str(body.get("model_version") or self._model_version),
                raw_detections,
                all_rejected,
                observed_classes,
            )
            snapshot = self._snapshot
        if self.backend == "roboflow" and observed_classes:
            self.logger.info("Roboflow model returned class label(s): %s.", ", ".join(observed_classes))
        self._write_debug(frame, snapshot)

    def _exclude_static_background(
        self,
        detections: tuple[dict[str, Any], ...],
        width: int,
        height: int,
    ) -> tuple[tuple[dict[str, Any], ...], tuple[dict[str, Any], ...]]:
        if not self.excluded_regions or width <= 0 or height <= 0:
            return detections, ()
        kept: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        for detection in detections:
            bbox = detection["bbox"]
            center_x = (bbox["x1"] + bbox["x2"]) / (2.0 * width)
            center_y = (bbox["y1"] + bbox["y2"]) / (2.0 * height)
            region_index = next((
                index
                for index, (x1, y1, x2, y2) in enumerate(self.excluded_regions, start=1)
                if x1 <= center_x <= x2 and y1 <= center_y <= y2
            ), None)
            if region_index is not None:
                rejected.append({
                    **detection,
                    "rejection_reason": f"static_background_region_{region_index}",
                })
            else:
                kept.append(detection)
        return tuple(kept), tuple(rejected)

    def _write_debug(self, frame: np.ndarray, snapshot: DetectionSnapshot) -> None:
        """Write local-only model/tracker inputs for developer review."""
        if not self._debug_enabled:
            return
        self._debug_dir.mkdir(parents=True, exist_ok=True)
        height, width = frame.shape[:2]

        def draw(
            items: tuple[dict[str, Any], ...],
            *,
            rejected: bool = False,
            image: np.ndarray | None = None,
            color: tuple[int, int, int] | None = None,
        ) -> np.ndarray:
            image = frame.copy() if image is None else image
            for item in items:
                bbox = item.get("bbox", {})
                try:
                    x1, y1, x2, y2 = (int(round(float(bbox[key]))) for key in ("x1", "y1", "x2", "y2"))
                except (KeyError, TypeError, ValueError, OverflowError):
                    continue
                box_color = color or ((0, 0, 255) if rejected else (0, 210, 0))
                cv2.rectangle(image, (x1, y1), (x2, y2), box_color, 2)
                label = f"{item.get('class', '?')} {float(item.get('confidence', 0)):.2f}"
                reason = item.get("rejection_reason")
                if reason:
                    label += f" REJECTED {reason}"
                cv2.putText(image, label, (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, box_color, 1, cv2.LINE_AA)
            return image

        rejected_view = draw(snapshot.rejected_detections, rejected=True)
        rejected_view = draw(snapshot.detections, image=rejected_view)

        images = {
            "original-frame.jpg": frame,
            "raw-detections.jpg": draw(snapshot.raw_detections, color=(255, 160, 0)),
            "filtered-detections.jpg": draw(snapshot.detections),
            "rejected-detections.jpg": rejected_view,
        }
        for name, image in images.items():
            ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 78])
            if ok:
                temporary = self._debug_dir / f"{name}.tmp"
                temporary.write_bytes(encoded.tobytes())
                temporary.replace(self._debug_dir / name)
        details = {
            "sequence": snapshot.sequence,
            "captured_at_monotonic": round(snapshot.captured_at, 4),
            "completed_at_monotonic": round(snapshot.completed_at, 4),
            "inference_ms": round(snapshot.inference_ms, 1),
            "model_version": snapshot.model_version,
            "model_sha256": self._actual_sha256,
            "observed_classes": snapshot.observed_classes,
            "image": {"width": width, "height": height},
            "excluded_regions_normalized": self.excluded_regions,
            "raw_detections": snapshot.raw_detections,
            "filtered_detections": snapshot.detections,
            "rejected_detections": snapshot.rejected_detections,
        }
        temporary_json = self._debug_dir / "detections.json.tmp"
        temporary_json.write_text(json.dumps(details, separators=(",", ":")), encoding="utf-8")
        temporary_json.replace(self._debug_dir / "detections.json")

    def _run(self) -> None:
        with self._session_factory() as session:
            next_health_check = 0.0
            next_client_retry = 0.0
            next_inference_at = 0.0
            while not self._stop.is_set():
                now = time.monotonic()
                if self.backend == "private" and now >= next_health_check and not self.ready:
                    self._check_model(session)
                    next_health_check = time.monotonic() + (30.0 if self.ready else 10.0)
                elif self.backend == "roboflow" and self._roboflow_client is None and now >= next_client_retry:
                    try:
                        self._roboflow_client = self._new_roboflow_client()
                        with self._lock:
                            self._model_version = self.model_id
                            self._last_error = None
                        self.logger.info("Roboflow hosted detector client configured for model %s.", self.model_id)
                    except Exception as error:
                        with self._lock:
                            self._ready = False
                            self._last_error = type(error).__name__
                        self.logger.warning("Roboflow SDK client could not start; hybrid counting remains fail-closed (%s).", type(error).__name__)
                        next_client_retry = time.monotonic() + 10.0
                try:
                    queued = self._frames.get(timeout=0.25)
                except queue.Empty:
                    continue
                if queued is None:
                    return
                wait_for = max(0.0, next_inference_at - time.monotonic())
                if wait_for and self._stop.wait(wait_for):
                    return
                # Keep only the freshest camera frame while respecting the
                # measured CPU inference interval.
                while True:
                    try:
                        newer = self._frames.get_nowait()
                    except queue.Empty:
                        break
                    if newer is None:
                        return
                    queued = newer
                if self.backend == "private" and not self.ready:
                    continue
                if self.backend == "roboflow" and self._roboflow_client is None:
                    continue
                frame, captured_at = queued
                max_age = max(3.0, self.interval * 3.0)
                if time.monotonic() - captured_at > max_age:
                    with self._lock:
                        self._stale += 1
                    continue
                try:
                    self._detect(session, frame, captured_at)
                except Exception as error:
                    with self._lock:
                        self._failed += 1
                        self._failure_streak += 1
                        self._last_error = type(error).__name__
                        self.interval = min(self.max_interval, max(self.base_interval, self.interval * 1.5))
                        if self._failure_streak >= 3:
                            self._ready = False
                            if self.backend == "private":
                                next_health_check = 0.0
                    self.logger.warning("%s detector request failed; OpenCV retains confirmed tracks and creates no motion-only animal boxes (%s).", self.backend, type(error).__name__)
                next_inference_at = time.monotonic() + self.interval
