from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import cv2


def setting_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def iso_timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SessionVideoRecorder:
    def __init__(
        self,
        session_id: str,
        base_dir: str | Path,
        *,
        fps: int = 10,
        max_width: int = 960,
        segment_seconds: int = 300,
        max_local_bytes: int = 1_073_741_824,
        min_free_bytes: int = 536_870_912,
        logger: logging.Logger | None = None,
    ) -> None:
        self.session_id = session_id
        self.base_dir = Path(base_dir).resolve()
        self.recording_dir = self.base_dir / "recordings" / session_id
        self.recording_dir.mkdir(parents=True, exist_ok=True)
        self.fps = fps
        self.max_width = max_width
        self.segment_seconds = segment_seconds
        self.max_local_bytes = max_local_bytes
        self.min_free_bytes = min_free_bytes
        self.logger = logger or logging.getLogger("alpasfarm-camera-gateway.recorder")
        self.writer: cv2.VideoWriter | None = None
        self.output_path: Path | None = None
        self.sequence = self._next_sequence()
        self.segment_started_at = 0.0
        self.segment_last_frame_at = 0.0
        self.segment_frames = 0
        self.frame_width = 0
        self.frame_height = 0

    def _next_sequence(self) -> int:
        existing: list[int] = []
        for path in self.recording_dir.glob("segment-*.json"):
            try:
                existing.append(int(path.stem.split("-")[-1]))
            except ValueError:
                continue
        for path in self.recording_dir.glob("segment-*.mp4"):
            try:
                existing.append(int(path.stem.split("-")[-1]))
            except ValueError:
                continue
        counter = self.recording_dir / "next-sequence.txt"
        try:
            existing.append(int(counter.read_text(encoding="ascii").strip()) - 1)
        except (OSError, ValueError):
            pass
        return max(existing, default=0) + 1

    def _stored_bytes(self) -> int:
        return sum(path.stat().st_size for path in self.base_dir.glob("recordings/**/*.mp4") if path.is_file())

    def _prepare_frame(self, frame: Any) -> Any:
        height, width = frame.shape[:2]
        if width > self.max_width:
            scale = self.max_width / width
            return cv2.resize(frame, (self.max_width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
        return frame

    def _start_segment(self, frame: Any, captured_at: float) -> None:
        free_bytes = shutil.disk_usage(self.base_dir).free
        if free_bytes < self.min_free_bytes:
            raise OSError("Insufficient free disk space for CCTV recording.")
        if self._stored_bytes() >= self.max_local_bytes:
            raise OSError("The configured local CCTV recording storage limit has been reached.")

        height, width = frame.shape[:2]
        self.sequence = max(self.sequence, self._next_sequence())
        self.output_path = self.recording_dir / f"segment-{self.sequence:06d}.mp4"
        counter = self.recording_dir / "next-sequence.txt"
        temporary_counter = counter.with_suffix(".txt.tmp")
        temporary_counter.write_text(str(self.sequence + 1), encoding="ascii")
        temporary_counter.replace(counter)
        configured = os.getenv("CAMERA_RECORDING_FOURCC", "").strip()
        codecs = [configured] if len(configured) == 4 else ["avc1", "H264", "mp4v"]
        writer = None
        for codec in codecs:
            candidate = cv2.VideoWriter(
                str(self.output_path),
                cv2.VideoWriter_fourcc(*codec),
                self.fps,
                (int(width), int(height)),
            )
            if candidate.isOpened():
                writer = candidate
                self.logger.info("CCTV recorder opened session=%s codec=%s size=%sx%s fps=%s.", self.session_id, codec, width, height, self.fps)
                break
            candidate.release()
            self.output_path.unlink(missing_ok=True)
        if writer is None:
            self.output_path = None
            raise RuntimeError("No supported MP4 video encoder could be opened.")

        self.writer = writer
        self.segment_started_at = captured_at
        self.segment_last_frame_at = captured_at
        self.segment_frames = 0
        self.frame_width = int(width)
        self.frame_height = int(height)

    def write_frame(self, frame: Any, captured_at: float | None = None) -> bool:
        if frame is None:
            return False
        timestamp = time.time() if captured_at is None else captured_at
        resized = self._prepare_frame(frame)
        if self.writer is None:
            self._start_segment(resized, timestamp)
        elif timestamp - self.segment_started_at >= self.segment_seconds:
            self.finalize_segment()
            self._start_segment(resized, timestamp)

        if self.writer is None:
            return False
        self.writer.write(resized)
        self.segment_frames += 1
        self.segment_last_frame_at = timestamp
        return self.output_path is not None and self.output_path.exists() and self.output_path.stat().st_size > 0

    def finalize_segment(self) -> dict[str, Any] | None:
        writer = self.writer
        path = self.output_path
        frame_count = self.segment_frames
        started_at = self.segment_started_at
        ended_at = self.segment_last_frame_at
        self.writer = None
        self.output_path = None
        self.segment_frames = 0
        if writer is not None:
            writer.release()
        if path is None or frame_count < 1 or not path.exists() or path.stat().st_size < 1:
            if path is not None:
                path.unlink(missing_ok=True)
            return None

        metadata = {
            "session_id": self.session_id,
            "sequence": self.sequence,
            "started_at": iso_timestamp(started_at),
            "ended_at": iso_timestamp(ended_at),
            "duration_seconds": max(0.001, ended_at - started_at),
            "path": str(path),
            "file_size_bytes": path.stat().st_size,
            "video_format": "video/mp4",
            "frame_width": self.frame_width,
            "frame_height": self.frame_height,
            "frame_count": frame_count,
        }
        marker = path.with_suffix(".json")
        temporary = marker.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
        temporary.replace(marker)
        self.sequence += 1
        self.logger.info(
            "CCTV segment finalized session=%s sequence=%s frames=%s bytes=%s.",
            self.session_id,
            metadata["sequence"],
            frame_count,
            metadata["file_size_bytes"],
        )
        return metadata


class SessionRecordingWorker:
    def __init__(
        self,
        base_dir: str | Path,
        status_callback: Callable[[str, str, dict[str, Any]], bool | None],
        gap_callback: Callable[[str, str, str | None], str | None],
        stop_event: threading.Event,
        *,
        logger: logging.Logger | None = None,
    ) -> None:
        self.base_dir = Path(base_dir)
        self.status_callback = status_callback
        self.gap_callback = gap_callback
        self.stop_event = stop_event
        self.logger = logger or logging.getLogger("alpasfarm-camera-gateway.recorder")
        self.fps = setting_int("CAMERA_RECORDING_FPS", 10, 1, 15)
        self.max_width = setting_int("CAMERA_RECORDING_MAX_WIDTH", 960, 320, 1280)
        self.segment_seconds = setting_int("CAMERA_RECORDING_SEGMENT_SECONDS", 300, 30, 1800)
        self.max_local_bytes = setting_int("CAMERA_RECORDING_MAX_LOCAL_BYTES", 1_073_741_824, 64 * 1024 * 1024, 20 * 1024 * 1024 * 1024)
        self.min_free_bytes = setting_int("CAMERA_RECORDING_MIN_FREE_BYTES", 536_870_912, 64 * 1024 * 1024, 20 * 1024 * 1024 * 1024)
        self.frames: queue.Queue[tuple[str | None, Any | None, float]] = queue.Queue(maxsize=1)
        self._session_lock = threading.Lock()
        self._active_session_id: str | None = None
        self._last_submitted_at = 0.0
        self._thread: threading.Thread | None = None
        self._worker_stop = threading.Event()
        self._reported_status: dict[str, str] = {}

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="alpasfarm-session-video-recorder", daemon=True)
        self._thread.start()

    def set_active_session(self, session_id: str | None) -> None:
        with self._session_lock:
            if self._active_session_id == session_id:
                return
            self._active_session_id = session_id
        self._publish((session_id, None, time.time()))

    def submit_frame(self, frame: Any) -> None:
        now = time.time()
        if now - self._last_submitted_at < 1 / self.fps:
            return
        with self._session_lock:
            session_id = self._active_session_id
        if not session_id:
            return
        self._last_submitted_at = now
        self._publish((session_id, frame.copy(), now))

    def stop(self, timeout: float = 10.0) -> None:
        self.set_active_session(None)
        self._worker_stop.set()
        self._publish((None, None, time.time()))
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def _publish(self, item: tuple[str | None, Any | None, float]) -> None:
        try:
            self.frames.put_nowait(item)
            return
        except queue.Full:
            pass
        try:
            self.frames.get_nowait()
        except queue.Empty:
            pass
        try:
            self.frames.put_nowait(item)
        except queue.Full:
            pass

    def _post_status(self, session_id: str, status: str, **details: Any) -> None:
        if self._reported_status.get(session_id) == status:
            return
        try:
            confirmed = self.status_callback(session_id, status, details)
            if confirmed is not False:
                self._reported_status[session_id] = status
        except Exception:
            self.logger.exception("Could not update CCTV recording state for session %s.", session_id)

    def _run(self) -> None:
        recorder: SessionVideoRecorder | None = None
        active_id: str | None = None
        last_frame_at = 0.0
        gap_id: str | None = None
        paused = False

        def finish_session(finalize: bool) -> None:
            nonlocal recorder, active_id, gap_id, paused
            if not active_id or recorder is None:
                return
            recorder.finalize_segment()
            if gap_id:
                self.gap_callback(active_id, "close-gap", gap_id)
                gap_id = None
            if finalize:
                marker = recorder.recording_dir / "session-finalized.json"
                has_segments = recorder.sequence > 1 or any(recorder.recording_dir.glob("segment-*.json"))
                ended_at = iso_timestamp(time.time())
                marker.write_text(json.dumps({
                    "session_id": active_id,
                    "ended_at": ended_at,
                    "has_segments": has_segments,
                }), encoding="utf-8")
                self._post_status(active_id, "FINALIZING", ended_at=ended_at)
            recorder = None
            active_id = None
            paused = False

        while not self.stop_event.is_set() and not self._worker_stop.is_set():
            try:
                session_id, frame, captured_at = self.frames.get(timeout=1.0)
            except queue.Empty:
                if active_id and recorder and last_frame_at and time.time() - last_frame_at > 5.0 and not paused:
                    recorder.finalize_segment()
                    gap_id = self.gap_callback(active_id, "open-gap", None)
                    self._post_status(active_id, "PAUSED_DUE_TO_CAMERA_DISCONNECTION")
                    paused = True
                with self._session_lock:
                    desired_id = self._active_session_id
                if active_id and desired_id != active_id:
                    finish_session(finalize=True)
                continue

            if session_id != active_id:
                finish_session(finalize=True)
                active_id = session_id
                recorder = None
                last_frame_at = 0.0
                paused = False
                gap_id = None

            if not session_id:
                continue
            if frame is None:
                if recorder is None:
                    recorder = SessionVideoRecorder(
                        session_id,
                        self.base_dir,
                        fps=self.fps,
                        max_width=self.max_width,
                        segment_seconds=self.segment_seconds,
                        max_local_bytes=self.max_local_bytes,
                        min_free_bytes=self.min_free_bytes,
                        logger=self.logger,
                    )
                    self._post_status(session_id, "STARTING")
                if last_frame_at == 0:
                    last_frame_at = captured_at
                continue

            if recorder is None:
                recorder = SessionVideoRecorder(
                    session_id,
                    self.base_dir,
                    fps=self.fps,
                    max_width=self.max_width,
                    segment_seconds=self.segment_seconds,
                    max_local_bytes=self.max_local_bytes,
                    min_free_bytes=self.min_free_bytes,
                    logger=self.logger,
                )
                self._post_status(session_id, "STARTING")
            try:
                wrote = recorder.write_frame(frame, captured_at)
                last_frame_at = captured_at
                if paused:
                    if gap_id:
                        self.gap_callback(session_id, "close-gap", gap_id)
                    gap_id = None
                    paused = False
                if wrote:
                    self._post_status(
                        session_id,
                        "RECORDING",
                        frame_width=recorder.frame_width,
                        frame_height=recorder.frame_height,
                    )
            except (OSError, RuntimeError, cv2.error) as error:
                recorder.finalize_segment()
                self._post_status(session_id, "FAILED", error_status=str(error)[:200])
                self.logger.exception("CCTV recording failed for session %s.", session_id)
                recorder = None
                active_id = None

        finish_session(finalize=False)
