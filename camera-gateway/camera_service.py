from __future__ import annotations

import ipaddress
import os
import socket
import threading
import time
from typing import Any
from urllib.parse import quote

import cv2


def probe_tcp(host: str, port: int, timeout_seconds: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True
    except OSError:
        return False


class CameraService:
    """Small RTSP camera adapter; inference receives decoded frames only."""

    def __init__(self) -> None:
        if hasattr(cv2, "setLogLevel") and hasattr(cv2, "LOG_LEVEL_SILENT"):
            cv2.setLogLevel(cv2.LOG_LEVEL_SILENT)
        self.camera_ip = os.getenv("CAMERA_IP", "").strip()
        self.port = self._port()
        self.username = os.getenv("CAMERA_USERNAME", "").strip()
        self.password = os.getenv("CAMERA_PASSWORD", "")
        self._capture: cv2.VideoCapture | None = None
        self._last_frame_at = 0.0
        self._lock = threading.Lock()

    @staticmethod
    def _port() -> int:
        try:
            value = int(os.getenv("CAMERA_RTSP_PORT", "554"))
            if 1 <= value <= 65_535:
                return value
        except (TypeError, ValueError):
            pass
        return 554

    def stream_url(self, stream_path: str) -> str:
        if not self.username or not self.password or not self.camera_ip:
            raise ValueError("Set CAMERA_USERNAME, CAMERA_PASSWORD, and CAMERA_IP in camera-gateway/.env.")
        try:
            address = ipaddress.ip_address(self.camera_ip)
        except ValueError as error:
            raise ValueError("CAMERA_IP must be a private local IP address.") from error
        if not address.is_private:
            raise ValueError("CAMERA_IP must be a private local IP address.")
        if not stream_path.startswith("/") or any(character in stream_path for character in "?#\r\n"):
            raise ValueError("CAMERA_STREAM_PATH must be a simple RTSP path such as /stream1.")
        host = f"[{self.camera_ip}]" if address.version == 6 else self.camera_ip
        return f"rtsp://{quote(self.username, safe='')}:{quote(self.password, safe='')}@{host}:{self.port}{stream_path}"

    def connect(self, stream_path: str) -> cv2.VideoCapture:
        self.disconnect()
        url = self.stream_url(stream_path)
        parameters: list[int] = []
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8_000])
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8_000])
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG, parameters) if parameters else cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        with self._lock:
            self._capture = capture
        return capture

    def get_stream(self) -> tuple[bool, Any | None]:
        with self._lock:
            capture = self._capture
        if capture is None:
            return False, None
        received, frame = capture.read()
        if received and frame is not None:
            with self._lock:
                self._last_frame_at = time.monotonic()
        return bool(received), frame if received else None

    def is_online(self, timeout_seconds: float = 2.0) -> bool:
        return bool(self.camera_ip and probe_tcp(self.camera_ip, self.port, timeout_seconds))

    def get_status(self, stream_timeout_seconds: int = 90) -> dict[str, bool]:
        with self._lock:
            frame_is_recent = self._last_frame_at > 0 and time.monotonic() - self._last_frame_at <= stream_timeout_seconds
        reachable = self.is_online()
        return {
            "camera_reachable": reachable,
            "stream_available": reachable and frame_is_recent,
        }

    def disconnect(self) -> None:
        with self._lock:
            capture, self._capture = self._capture, None
        if capture is not None:
            capture.release()
