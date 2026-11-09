import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from camera_service import CameraService, local_route_ip


class CameraServiceTests(unittest.TestCase):
    def test_local_test_video_bypasses_rtsp_credentials_and_is_rate_limited(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "clip.mp4"
            clip.write_bytes(b"local test clip")
            fake_capture = MagicMock()
            fake_capture.isOpened.return_value = True
            fake_capture.get.return_value = 10.0
            fake_capture.read.return_value = (True, object())
            with patch.dict(os.environ, {
                "CAMERA_TEST_VIDEO_PATH": str(clip),
                "CAMERA_TEST_VIDEO_START_SECONDS": "12",
                "CAMERA_TEST_VIDEO_DURATION_SECONDS": "3",
                "CAMERA_TEST_VIDEO_SPEED": "2",
            }, clear=True), patch("camera_service.cv2.VideoCapture", return_value=fake_capture) as open_video:
                service = CameraService()
                self.assertEqual(service.stream_url("/stream2"), "offline-video://clip.mp4")
                self.assertIs(service.connect("/stream2"), fake_capture)
                self.assertEqual(service.test_video_speed, 2.0)
                self.assertEqual(service.test_video_duration_seconds, 3.0)
                self.assertTrue(service.get_stream()[0])

            open_video.assert_called_once_with(str(clip.resolve()))
            fake_capture.set.assert_called_once_with(0, 12_000)

    def test_route_source_is_selected_for_camera_address(self) -> None:
        route_socket = MagicMock()
        route_socket.__enter__.return_value = route_socket
        route_socket.getsockname.return_value = ("10.20.20.177", 0)
        with patch("camera_service.socket.socket", return_value=route_socket):
            self.assertEqual(local_route_ip("10.20.5.137", 554), "10.20.20.177")
        route_socket.connect.assert_called_once_with(("10.20.5.137", 554))

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

    def test_discovery_warns_when_configured_ip_has_a_different_mac(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_IP": "10.20.5.137",
            "CAMERA_MAC": "60-15-6F-20-4A-F0",
            "CAMERA_USERNAME": "user",
            "CAMERA_PASSWORD": "password",
        }), patch("camera_service.get_local_arp_table", return_value={
            "10.20.5.137": "dc:2c:6e:3b:e3:bd",
        }), patch("camera_service.probe_tcp", return_value=False), patch(
            "camera_service.socket.socket", side_effect=OSError,
        ), patch("camera_service.concurrent.futures.ThreadPoolExecutor") as executor:
            executor.return_value.__enter__.return_value.map.return_value = []
            service = CameraService()
            with self.assertLogs("alpasfarm-camera-gateway", level="WARNING") as captured:
                service.discover_camera(force=True)

        self.assertIn("may be proxy ARP", "\n".join(captured.output))
        self.assertIn("does not prove the camera IP is wrong", "\n".join(captured.output))


if __name__ == "__main__":
    unittest.main()
