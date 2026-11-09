from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import camera_recorder
import gateway
from camera_recorder import SessionVideoRecorder


class FakeFrame:
    shape = (480, 640, 3)


class FakeVideoWriter:
    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def isOpened(self) -> bool:
        return True

    def write(self, _frame: FakeFrame) -> None:
        with self.path.open("ab") as output:
            output.write(b"frame")

    def release(self) -> None:
        pass


class SessionVideoRecorderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.disk_usage_patch = patch.object(
            camera_recorder.shutil,
            "disk_usage",
            return_value=SimpleNamespace(free=10**9),
        )
        self.writer_patch = patch.object(
            camera_recorder.cv2,
            "VideoWriter",
            side_effect=lambda path, *_args: FakeVideoWriter(path),
        )
        self.fourcc_patch = patch.object(camera_recorder.cv2, "VideoWriter_fourcc", return_value=0)
        self.disk_usage_patch.start()
        self.writer_patch.start()
        self.fourcc_patch.start()

    def tearDown(self) -> None:
        self.fourcc_patch.stop()
        self.writer_patch.stop()
        self.disk_usage_patch.stop()

    def make_recorder(self, base_dir: str, *, segment_seconds: int = 300) -> SessionVideoRecorder:
        return SessionVideoRecorder(
            "session-1",
            base_dir,
            segment_seconds=segment_seconds,
            min_free_bytes=1,
        )

    def test_finalizes_mp4_segment_with_metadata_marker(self) -> None:
        with tempfile.TemporaryDirectory() as base_dir:
            recorder = self.make_recorder(base_dir)
            self.assertTrue(recorder.write_frame(FakeFrame(), 100.0))

            metadata = recorder.finalize_segment()

            self.assertIsNotNone(metadata)
            self.assertEqual(metadata["sequence"], 1)
            self.assertEqual(metadata["frame_count"], 1)
            self.assertTrue(Path(metadata["path"]).is_file())
            marker = Path(metadata["path"]).with_suffix(".json")
            self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["file_size_bytes"], 5)

    def test_rolls_to_next_segment_when_duration_limit_is_reached(self) -> None:
        with tempfile.TemporaryDirectory() as base_dir:
            recorder = self.make_recorder(base_dir, segment_seconds=1)
            recorder.write_frame(FakeFrame(), 100.0)
            recorder.write_frame(FakeFrame(), 101.0)

            first_segment = Path(base_dir) / "recordings" / "session-1" / "segment-000001.json"
            second = recorder.finalize_segment()

            self.assertTrue(first_segment.is_file())
            self.assertEqual(second["sequence"], 2)

    def test_refuses_to_start_when_local_disk_is_below_reserve(self) -> None:
        with tempfile.TemporaryDirectory() as base_dir:
            recorder = SessionVideoRecorder("session-1", base_dir, min_free_bytes=100)
            with patch.object(camera_recorder.shutil, "disk_usage", return_value=SimpleNamespace(free=99)):
                with self.assertRaisesRegex(OSError, "Insufficient free disk space"):
                    recorder.write_frame(FakeFrame(), 100.0)


class RecordingUploaderTests(unittest.TestCase):
    def test_uploads_segment_to_signed_url_and_keeps_retry_markers_until_completion(self) -> None:
        class FakeResponse:
            status_code = 200

            def __init__(self, payload: dict | None = None) -> None:
                self.payload = payload or {}

            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict:
                return self.payload

        class FakeSession:
            def __init__(self) -> None:
                self.posts: list[dict] = []
                self.puts: list[tuple[str, dict]] = []

            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, url: str, **kwargs: object) -> FakeResponse:
                body = kwargs["json"]
                self.posts.append(body)
                if body["action"] == "prepare-upload":
                    return FakeResponse({
                        "signed_url": "https://storage.example/upload?token=test-token",
                        "storage_path": "owner/session-1/000001.mp4",
                    })
                return FakeResponse()

            def put(self, url: str, **kwargs: object) -> FakeResponse:
                self.puts.append((url, kwargs["headers"]))
                return FakeResponse()

        class StopAfterOneWait(threading.Event):
            def wait(self, _timeout: float | None = None) -> bool:
                self.set()
                return True

        with tempfile.TemporaryDirectory() as base_dir:
            segment_dir = Path(base_dir) / "recordings" / "session-1"
            segment_dir.mkdir(parents=True)
            video = segment_dir / "segment-000001.mp4"
            video.write_bytes(b"video-data")
            marker = video.with_suffix(".json")
            marker.write_text(json.dumps({
                "session_id": "session-1",
                "sequence": 1,
                "started_at": "2026-11-09T00:00:00Z",
                "ended_at": "2026-11-09T00:00:05Z",
                "duration_seconds": 5,
                "path": str(video),
                "file_size_bytes": video.stat().st_size,
                "frame_width": 640,
                "frame_height": 480,
            }), encoding="utf-8")
            finalized = segment_dir / "session-finalized.json"
            finalized.write_text(json.dumps({
                "session_id": "session-1",
                "ended_at": "2026-11-09T00:00:05Z",
                "has_segments": True,
            }), encoding="utf-8")
            fake_session = FakeSession()
            stop_event = StopAfterOneWait()
            with patch.object(gateway.requests, "Session", return_value=fake_session), \
                    patch.object(gateway, "stopping", False):
                gateway.run_camera_recording_uploader(Path(base_dir), "https://api.example", "token", stop_event)

            self.assertEqual(fake_session.puts, [
                ("https://storage.example/upload?token=test-token", {"Content-Type": "video/mp4"}),
            ])
            self.assertEqual([body["action"] for body in fake_session.posts], [
                "prepare-upload", "complete-upload", "status",
            ])
            self.assertFalse(video.exists())
            self.assertFalse(marker.exists())
            self.assertFalse(finalized.exists())


if __name__ == "__main__":
    unittest.main()
