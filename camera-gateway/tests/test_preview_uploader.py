from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from typing import Callable
from unittest.mock import patch

from preview_uploader import (
    LatestFrameBuffer,
    PreviewUploadConfig,
    PreviewUploader,
    retry_after_seconds,
)
from runtime_lock import GatewayProcessLock


class FakeJpeg:
    def __init__(self, frame: object) -> None:
        self.frame = frame

    def tobytes(self) -> bytes:
        return str(self.frame).encode("utf-8")


class FakeResponse:
    def __init__(self, status_code: int, headers: dict[str, str] | None = None) -> None:
        self.status_code = status_code
        self.headers = headers or {}

    def close(self) -> None:
        pass


class PreviewUploadTests(unittest.TestCase):
    def test_latest_frame_slot_replaces_old_frames_without_queueing(self) -> None:
        frames = LatestFrameBuffer()
        self.assertEqual(frames.snapshot(), (0, None))

        self.assertEqual(frames.publish("first"), 1)
        self.assertEqual(frames.publish("latest"), 2)
        self.assertEqual(frames.snapshot(), (2, "latest"))

    def test_default_preview_rate_is_fifteen_and_caps_at_fifteen(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(PreviewUploadConfig.from_env().fps, 15)
        with patch.dict("os.environ", {"CAMERA_PREVIEW_UPLOAD_FPS": "99"}):
            self.assertEqual(PreviewUploadConfig.from_env().fps, 15)

    def test_http_200_is_a_successful_preview_response(self) -> None:
        accepted = threading.Event()

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
                accepted.set()
                return FakeResponse(200)

        frames = LatestFrameBuffer()
        stop_event = threading.Event()
        uploader = PreviewUploader(
            frames,
            "https://example.invalid/api/camera/gateway/frame",
            "private-token",
            stop_event,
            PreviewUploadConfig(fps=2),
            session_factory=FakeSession,
        )

        with patch("preview_uploader.cv2.imencode", side_effect=lambda *_args: (True, FakeJpeg(_args[1]))):
            worker = threading.Thread(target=uploader.run, daemon=True)
            worker.start()
            frames.publish("accepted-frame")
            self.assertTrue(accepted.wait(1))
            self._wait_for_count(lambda: uploader.http_200 == 1)
            stop_event.set()
            worker.join(1)

        self.assertFalse(worker.is_alive())
        self.assertEqual(uploader.uploaded, 1)

    def test_local_test_preview_marks_request_for_no_database_writes(self) -> None:
        received = threading.Event()
        request_headers: list[dict[str, str]] = []

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, *_args: object, headers: dict[str, str], **_kwargs: object) -> FakeResponse:
                request_headers.append(headers)
                received.set()
                return FakeResponse(204)

        frames = LatestFrameBuffer()
        stop_event = threading.Event()
        uploader = PreviewUploader(
            frames,
            "http://127.0.0.1:5173/api/camera/gateway/frame",
            "private-token",
            stop_event,
            PreviewUploadConfig(fps=2),
            test_only=True,
            session_factory=FakeSession,
        )
        with patch("preview_uploader.cv2.imencode", side_effect=lambda *_args: (True, FakeJpeg(_args[1]))):
            worker = threading.Thread(target=uploader.run, daemon=True)
            worker.start()
            frames.publish("test-frame")
            self.assertTrue(received.wait(1))
            stop_event.set()
            worker.join(1)

        self.assertFalse(worker.is_alive())
        self.assertEqual(request_headers[0]["X-Camera-Gateway-Test-Only"], "1")

    def test_retry_after_header_is_preferred_to_custom_hint(self) -> None:
        self.assertEqual(
            retry_after_seconds({"Retry-After": "1", "X-Camera-Retry-After-Ms": "100"}),
            0.1,
        )
        self.assertEqual(retry_after_seconds({"X-Camera-Retry-After-Ms": "250"}), 0.25)

    def test_429_backs_off_and_uploads_only_the_latest_frame_after_wait(self) -> None:
        first_request = threading.Event()
        second_request = threading.Event()
        uploaded_frames: list[bytes] = []

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, *_args: object, data: bytes, **_kwargs: object) -> FakeResponse:
                uploaded_frames.append(data)
                if len(uploaded_frames) == 1:
                    first_request.set()
                    return FakeResponse(429, {"Retry-After": "0.15"})
                second_request.set()
                return FakeResponse(204)

        frames = LatestFrameBuffer()
        stop_event = threading.Event()
        config = PreviewUploadConfig(
            fps=5,
            timeout_seconds=1,
            max_retries=0,
            backoff_initial_seconds=0.05,
            backoff_max_seconds=0.2,
            jpeg_quality=70,
        )
        uploader = PreviewUploader(
            frames,
            "https://example.invalid/api/camera/gateway/frame",
            "private-token",
            stop_event,
            config,
            session_factory=FakeSession,
        )

        with patch("preview_uploader.cv2.imencode", side_effect=lambda *_args: (True, FakeJpeg(_args[1]))):
            worker = threading.Thread(target=uploader.run, daemon=True)
            worker.start()
            frames.publish("frame-one")
            self.assertTrue(first_request.wait(1))
            self._wait_for_count(lambda: uploader.http_429 == 1)
            self.assertGreaterEqual(uploader.current_backoff_seconds, 0.15)
            frames.publish("frame-two")
            frames.publish("frame-three")
            self.assertFalse(second_request.wait(0.04), "429 retry happened before Retry-After/backoff")
            self.assertTrue(second_request.wait(1))
            stop_event.set()
            worker.join(1)

        self.assertFalse(worker.is_alive())
        self.assertEqual(uploaded_frames, [b"frame-one", b"frame-three"])
        self.assertEqual(uploader.http_429, 1)
        self.assertEqual(uploader.http_204, 1)
        self.assertEqual(uploader.uploaded, 1)
        self.assertEqual(uploader.skipped, 1)

    def test_repeated_429_uses_exponential_backoff_and_caps_delay(self) -> None:
        requests_seen = [threading.Event(), threading.Event(), threading.Event()]
        call_count = 0

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, *_args: object, **_kwargs: object) -> FakeResponse:
                nonlocal call_count
                call_count += 1
                requests_seen[min(call_count, len(requests_seen)) - 1].set()
                return FakeResponse(429)

        frames = LatestFrameBuffer()
        stop_event = threading.Event()
        uploader = PreviewUploader(
            frames,
            "https://example.invalid/api/camera/gateway/frame",
            "private-token",
            stop_event,
            PreviewUploadConfig(
                fps=5,
                timeout_seconds=1,
                max_retries=0,
                backoff_initial_seconds=0.2,
                backoff_max_seconds=0.5,
            ),
            session_factory=FakeSession,
        )

        with patch("preview_uploader.cv2.imencode", side_effect=lambda *_args: (True, FakeJpeg(_args[1]))):
            worker = threading.Thread(target=uploader.run, daemon=True)
            worker.start()
            frames.publish("one")
            self.assertTrue(requests_seen[0].wait(1))
            self._wait_for_count(lambda: uploader.http_429 == 1)
            self.assertAlmostEqual(uploader.current_backoff_seconds, 0.2, delta=0.03)

            frames.publish("two")
            self.assertTrue(requests_seen[1].wait(1))
            self._wait_for_count(lambda: uploader.http_429 == 2)
            self.assertAlmostEqual(uploader.current_backoff_seconds, 0.4, delta=0.03)

            frames.publish("three")
            self.assertTrue(requests_seen[2].wait(1))
            self._wait_for_count(lambda: uploader.http_429 == 3)
            self.assertAlmostEqual(uploader.current_backoff_seconds, 0.5, delta=0.03)
            stop_event.set()
            worker.join(1)

        self.assertFalse(worker.is_alive())

    @staticmethod
    def _wait_for_count(condition: Callable[[], bool]) -> None:
        deadline = threading.Event()
        for _ in range(100):
            if condition():
                return
            deadline.wait(0.005)
        raise AssertionError("Preview worker did not update the expected rate-limit state.")


class GatewayProcessLockTests(unittest.TestCase):
    def test_second_gateway_cannot_acquire_active_camera_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "state" / "gateway-worker.lock"
            active = GatewayProcessLock(path)
            duplicate = GatewayProcessLock(path)
            after_release = GatewayProcessLock(path)

            self.assertTrue(active.acquire())
            self.assertFalse(duplicate.acquire())
            active.release()
            self.assertTrue(after_release.acquire())
            after_release.release()


if __name__ == "__main__":
    unittest.main()
