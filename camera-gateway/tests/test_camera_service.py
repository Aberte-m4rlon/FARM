import os
import time
import unittest
from unittest.mock import patch

from camera_service import CameraService


class CameraServiceTests(unittest.TestCase):
    def test_builds_credential_encoded_private_rtsp_url(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_IP": "10.20.6.237",
            "CAMERA_RTSP_PORT": "554",
            "CAMERA_USERNAME": "camera user",
            "CAMERA_PASSWORD": "p@ss:word",
        }):
            service = CameraService()
            self.assertEqual(
                service.stream_url("/stream1"),
                "rtsp://camera%20user:p%40ss%3Aword@10.20.6.237:554/stream1",
            )

    def test_rejects_public_camera_addresses_and_unsafe_paths(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_IP": "8.8.8.8",
            "CAMERA_USERNAME": "user",
            "CAMERA_PASSWORD": "password",
        }):
            service = CameraService()
            with self.assertRaisesRegex(ValueError, "private local IP"):
                service.stream_url("/stream1")

        with patch.dict(os.environ, {
            "CAMERA_IP": "10.20.6.237",
            "CAMERA_USERNAME": "user",
            "CAMERA_PASSWORD": "password",
        }):
            with self.assertRaisesRegex(ValueError, "simple RTSP path"):
                CameraService().stream_url("/stream1?user=bad")

    def test_reports_camera_reachability_and_recent_decoded_stream_separately(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_IP": "10.20.6.237",
            "CAMERA_USERNAME": "user",
            "CAMERA_PASSWORD": "password",
        }):
            service = CameraService()
            with patch("camera_service.probe_tcp", return_value=True):
                self.assertEqual(service.get_status(), {"camera_reachable": True, "stream_available": False})
                service._last_frame_at = time.monotonic()
                self.assertEqual(service.get_status(), {"camera_reachable": True, "stream_available": True})

    def test_stream_status_becomes_stale_without_a_new_decoded_frame(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_IP": "10.20.6.237",
            "CAMERA_USERNAME": "user",
            "CAMERA_PASSWORD": "password",
        }), patch("camera_service.probe_tcp", return_value=True):
            service = CameraService()
            service._last_frame_at = time.monotonic() - 100
            self.assertEqual(service.get_status(), {"camera_reachable": True, "stream_available": False})


if __name__ == "__main__":
    unittest.main()
