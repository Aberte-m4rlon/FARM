from __future__ import annotations

import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Mapping

import cv2
import requests


def setting_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def setting_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        if not math.isfinite(value):
            return default
        return max(minimum, min(maximum, value))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class PreviewUploadConfig:
    fps: int = 15
    timeout_seconds: float = 8.0
    max_retries: int = 2
    backoff_initial_seconds: float = 2.0
    backoff_max_seconds: float = 30.0
    jpeg_quality: int = 72

    @property
    def interval_seconds(self) -> float:
        return 1.0 / self.fps

    @classmethod
    def from_env(cls) -> "PreviewUploadConfig":
        initial = setting_float("CAMERA_FRAME_BACKOFF_INITIAL", 2.0, 0.5, 60.0)
        maximum = max(initial, setting_float("CAMERA_FRAME_BACKOFF_MAX", 30.0, 0.5, 300.0))
        return cls(
            fps=setting_int("CAMERA_PREVIEW_UPLOAD_FPS", 15, 1, 15),
            timeout_seconds=setting_float("CAMERA_FRAME_UPLOAD_TIMEOUT", 8.0, 1.0, 60.0),
            max_retries=setting_int("CAMERA_FRAME_MAX_RETRIES", 2, 0, 5),
            backoff_initial_seconds=initial,
            backoff_max_seconds=maximum,
            jpeg_quality=setting_int("CAMERA_GATEWAY_JPEG_QUALITY", 72, 45, 90),
        )


class LatestFrameBuffer:
    """A single replaceable frame slot; old preview frames are never queued."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: Any | None = None
        self._sequence = 0

    def publish(self, frame: Any) -> int:
        with self._lock:
            self._sequence += 1
            self._frame = frame
            return self._sequence

    def snapshot(self) -> tuple[int, Any | None]:
        with self._lock:
            return self._sequence, self._frame


def retry_after_seconds(headers: Mapping[str, str], now: float | None = None) -> float | None:
    """Prefer the camera endpoint's precise millisecond retry hint."""
    retry_after_ms = headers.get("X-Camera-Retry-After-Ms")
    if retry_after_ms:
        try:
            delay = float(retry_after_ms) / 1_000
            if math.isfinite(delay) and delay >= 0:
                return delay
        except (TypeError, ValueError):
            pass

    retry_after = headers.get("Retry-After")
    if retry_after:
        try:
            delay = float(retry_after)
            if math.isfinite(delay) and delay >= 0:
                return delay
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    from datetime import timezone
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return max(0.0, retry_at.timestamp() - (time.time() if now is None else now))
            except (TypeError, ValueError, OverflowError):
                pass

    return None


class PreviewUploader:
    """Rate-limited best-effort preview uploader, independent of inference."""

    def __init__(
        self,
        frames: LatestFrameBuffer,
        upload_url: str,
        token: str,
        stop_event: threading.Event,
        config: PreviewUploadConfig | None = None,
        *,
        test_only: bool = False,
        session_factory: Callable[[], Any] = requests.Session,
        logger: logging.Logger | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.frames = frames
        self.upload_url = upload_url
        self.token = token
        self.stop_event = stop_event
        self.config = config or PreviewUploadConfig.from_env()
        self.test_only = test_only
        self.session_factory = session_factory
        self.log = logger or logging.getLogger("alpasfarm-camera-gateway.preview")
        self.monotonic = monotonic
        self.uploaded = 0
        self.skipped = 0
        self.http_200 = 0
        self.http_204 = 0
        self.http_429 = 0
        self.failures = 0
        self.current_backoff_seconds = 0.0
        self.http_request_seconds_total = 0.0
        self.http_request_count = 0

    def _snapshot_latest(self, previous_sequence: int) -> tuple[int, Any | None]:
        sequence, frame = self.frames.snapshot()
        if sequence > previous_sequence:
            self.skipped += max(0, sequence - previous_sequence - 1)
        return sequence, frame

    def _log_metrics(self) -> None:
        average_http_ms = (
            self.http_request_seconds_total * 1_000 / self.http_request_count
            if self.http_request_count else 0.0
        )
        self.log.info(
            "Preview upload stats: configured_fps=%s uploaded=%s skipped=%s HTTP200=%s HTTP204=%s HTTP429=%s failures=%s avg_http_ms=%.1f current_backoff=%.1fs.",
            self.config.fps,
            self.uploaded,
            self.skipped,
            self.http_200,
            self.http_204,
            self.http_429,
            self.failures,
            average_http_ms,
            self.current_backoff_seconds,
        )

    def run(self) -> None:
        self.log.info("Preview uploader worker started (pid=%s).", os.getpid())
        self.log.info("Preview upload rate configured: %s FPS maximum.", self.config.fps)

        headers = {"X-Camera-Gateway-Token": self.token, "Content-Type": "image/jpeg"}
        if self.test_only:
            headers["X-Camera-Gateway-Test-Only"] = "1"
        next_upload_at = 0.0
        next_metrics_at = self.monotonic() + 60
        last_sequence = 0
        consecutive_429 = 0
        exponential_backoff = self.config.backoff_initial_seconds
        rate_limited = False
        last_429_log_at = 0.0
        last_429_log_delay: float | None = None
        last_failure_log_at = 0.0
        first_upload_logged = False

        with self.session_factory() as session:
            while not self.stop_event.is_set():
                now = self.monotonic()
                if now < next_upload_at:
                    self.stop_event.wait(min(next_upload_at - now, 1.0))
                    if now >= next_metrics_at:
                        self._log_metrics()
                        next_metrics_at = now + 60
                    continue

                sequence, frame = self._snapshot_latest(last_sequence)
                if frame is None or sequence <= last_sequence:
                    self.stop_event.wait(0.1)
                    if now >= next_metrics_at:
                        self._log_metrics()
                        next_metrics_at = now + 60
                    continue

                last_sequence = sequence
                attempt = 0
                while not self.stop_event.is_set():
                    try:
                        encoded, jpeg = cv2.imencode(
                            ".jpg", frame,
                            [cv2.IMWRITE_JPEG_QUALITY, self.config.jpeg_quality],
                        )
                    except Exception:
                        self.failures += 1
                        if self.monotonic() - last_failure_log_at >= 60:
                            self.log.warning("Could not encode the latest preview frame; local detection continues.")
                            last_failure_log_at = self.monotonic()
                        next_upload_at = self.monotonic() + self.config.interval_seconds
                        break
                    if not encoded:
                        self.failures += 1
                        if self.monotonic() - last_failure_log_at >= 60:
                            self.log.warning("Could not encode the latest preview frame; local detection continues.")
                            last_failure_log_at = self.monotonic()
                        next_upload_at = self.monotonic() + self.config.interval_seconds
                        break

                    try:
                        request_started_at = self.monotonic()
                        response = session.post(
                            self.upload_url,
                            data=jpeg.tobytes(),
                            headers=headers,
                            timeout=self.config.timeout_seconds,
                        )
                    except requests.RequestException:
                        request_finished_at = self.monotonic()
                        self.http_request_seconds_total += max(0.0, request_finished_at - request_started_at)
                        self.http_request_count += 1
                        self.failures += 1
                        if self.monotonic() - last_failure_log_at >= 60:
                            self.log.warning("Could not reach ALPASFARM for the preview; detection and counting continue.")
                            last_failure_log_at = self.monotonic()
                        if attempt >= self.config.max_retries:
                            next_upload_at = max(
                                request_started_at + self.config.interval_seconds,
                                self.monotonic() + self.config.backoff_initial_seconds,
                            )
                            break
                        delay = max(self.config.interval_seconds, min(
                            self.config.backoff_max_seconds,
                            self.config.backoff_initial_seconds * (2 ** attempt),
                        ))
                        attempt += 1
                        if self.stop_event.wait(delay):
                            break
                        sequence, frame = self._snapshot_latest(last_sequence)
                        if sequence > last_sequence:
                            last_sequence = sequence
                        continue

                    status = int(response.status_code)
                    response_headers = response.headers
                    response.close()
                    response_received_at = self.monotonic()
                    self.http_request_seconds_total += max(0.0, response_received_at - request_started_at)
                    self.http_request_count += 1

                    if 200 <= status < 300:
                        self.uploaded += 1
                        if status == 200:
                            self.http_200 += 1
                        elif status == 204:
                            self.http_204 += 1
                        if rate_limited:
                            self.log.info("Camera frame upload recovered.")
                        elif not first_upload_logged:
                            self.log.info("Live camera feed reached ALPASFARM.")
                            first_upload_logged = True
                        rate_limited = False
                        first_upload_logged = True
                        consecutive_429 = 0
                        exponential_backoff = self.config.backoff_initial_seconds
                        self.current_backoff_seconds = 0.0
                        next_upload_at = max(
                            request_started_at + self.config.interval_seconds,
                            response_received_at,
                        )
                        break

                    self.failures += 1
                    if status == 429:
                        self.http_429 += 1
                        consecutive_429 += 1
                        fallback_delay = min(
                            self.config.backoff_max_seconds,
                            exponential_backoff,
                        )
                        server_delay = retry_after_seconds(response_headers)
                        delay = server_delay if server_delay is not None else fallback_delay
                        exponential_backoff = min(
                            self.config.backoff_max_seconds,
                            max(self.config.backoff_initial_seconds, fallback_delay * 2),
                        )
                        next_allowed_at = max(
                            request_started_at + self.config.interval_seconds,
                            response_received_at + delay,
                        )
                        effective_delay = max(0.0, next_allowed_at - response_received_at)
                        self.current_backoff_seconds = effective_delay
                        rate_limited = True
                        if effective_delay != last_429_log_delay or response_received_at - last_429_log_at >= 60:
                            self.log.warning(
            "Camera frame upload rate limited by ALPASFARM (HTTP 429); backing off preview upload for %.2f seconds.",
                                effective_delay,
                            )
                            last_429_log_at = response_received_at
                            last_429_log_delay = effective_delay
                        next_upload_at = next_allowed_at
                        break

                    retryable = status in {408, 425} or 500 <= status <= 599
                    if retryable and attempt < self.config.max_retries:
                        delay = max(self.config.interval_seconds, min(
                            self.config.backoff_max_seconds,
                            self.config.backoff_initial_seconds * (2 ** attempt),
                        ))
                        attempt += 1
                        if self.stop_event.wait(delay):
                            break
                        sequence, frame = self._snapshot_latest(last_sequence)
                        if sequence > last_sequence:
                            last_sequence = sequence
                        continue

                    if response_received_at - last_failure_log_at >= 60:
                        self.log.warning(
                            "ALPASFARM refused the preview frame (HTTP %s); detection and counting continue.",
                            status,
                        )
                        last_failure_log_at = response_received_at
                    next_upload_at = max(
                        request_started_at + self.config.interval_seconds,
                        response_received_at + self.config.backoff_initial_seconds,
                    )
                    break

                now = self.monotonic()
                if now >= next_metrics_at:
                    self._log_metrics()
                    next_metrics_at = now + 60

        self._log_metrics()
