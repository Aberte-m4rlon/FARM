from __future__ import annotations

import os
import queue
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import gateway
from gateway import (
    camera_stream_paths,
    camera_test_payload,
    is_loopback_http_url,
    publish_latest_result,
    run_gateway,
    run_camera_crossing_uploader,
    run_gateway_heartbeat,
)


class CameraStreamPathTests(unittest.TestCase):
    def test_default_stream_path_is_not_repeated_as_a_fallback(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(camera_stream_paths(), ["/stream1"])

    def test_slow_api_buffer_keeps_only_the_latest_result(self) -> None:
        results: queue.Queue[tuple[dict, float, float, float] | None] = queue.Queue(maxsize=1)
        publish_latest_result(results, ({"animal_count": 1}, 10.0, 20.0, 5.0))
        publish_latest_result(results, ({"animal_count": 3}, 5.0, 18.0, 6.0))

        latest = results.get_nowait()

        self.assertEqual(latest[0]["animal_count"], 3)

    def test_pure_opencv_inference_keeps_processing_while_api_upload_is_slow(self) -> None:
        processed_six = threading.Event()
        post_started = threading.Event()
        allow_post = threading.Event()
        crossing_post_started = threading.Event()
        allow_crossing_post = threading.Event()
        count_posts: list[dict] = []

        class FakeCounter:
            def __init__(self, **options: object) -> None:
                self.processed = 0
                self.options = options
                self.calls: list[dict[str, object]] = []
                self.crossing = {"event_key": "durable-event-1"}
                self.outbox = SimpleNamespace(items=[])
                self.outbox.pending = lambda limit=100: self.outbox.items[:limit]

            def process(self, _frame: object, **options: object) -> dict:
                self.processed += 1
                self.calls.append(options)
                if self.processed == 2:
                    post_started.wait(1.0)
                if self.processed == 6:
                    processed_six.set()
                if not self.outbox.items:
                    self.outbox.items.append(self.crossing)
                return {
                    "animal_count": 0,
                    "crossings": self.outbox.pending(100),
                    "inference_ms": 1.0,
                }

            def set_gate_settings(self, *_args: object) -> None:
                pass

            def acknowledge_crossings(self, _keys: list[str]) -> None:
                self.outbox.items.clear()

            def archive_unrecorded_crossings(self, _outcomes: list[dict[str, str]]) -> int:
                return 0

        class FakeResponse:
            status_code = 200
            text = ""

            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict:
                return {"gate_line_y": 0.55, "entry_flow": "top-to-bottom", "revision": 0}

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def get(self, *_args: object, **_kwargs: object) -> FakeResponse:
                return FakeResponse()

            def post(self, _url: str, **kwargs: object) -> FakeResponse:
                if _url.endswith("/crossings"):
                    crossing_post_started.set()
                    allow_crossing_post.wait(3.0)

                    class CrossingResponse(FakeResponse):
                        def json(self) -> dict:
                            return {
                                "acknowledged_crossing_keys": ["durable-event-1"],
                                "unrecorded_crossings": [],
                            }

                    return CrossingResponse()
                count_posts.append(kwargs["json"])
                post_started.set()
                allow_post.wait(3.0)
                return FakeResponse()

        detectors: list[FakeCounter] = []
        def create_counter(**options: object) -> FakeCounter:
            detector = FakeCounter(**options)
            detectors.append(detector)
            return detector

        frames: queue.Queue[object] = queue.Queue()
        for _ in range(6):
            frames.put((object(), 0.0))
        frames.put(None)
        fake_inference = SimpleNamespace(LocalCameraCounter=create_counter)
        worker = threading.Thread(
            target=gateway.run_inference_worker,
            args=(frames, "http://local/detections", "http://local/settings", "token"),
            kwargs={"crossings_url": "http://local/crossings"},
        )
        try:
            with patch.object(gateway, "stopping", False), \
                    patch.object(gateway.requests, "Session", side_effect=FakeSession), \
                    patch.dict("sys.modules", {"inference": fake_inference}):
                worker.start()
                self.assertTrue(post_started.wait(2.0))
                self.assertTrue(crossing_post_started.wait(2.0))
                self.assertTrue(processed_six.wait(2.0))
                self.assertEqual(detectors[0].processed, 6)
                self.assertFalse(detectors[0].options["hybrid_mode"])
                self.assertEqual(detectors[0].calls, [{}] * 6)
                self.assertNotIn("crossings", count_posts[0])
                allow_post.set()
                allow_crossing_post.set()
                worker.join(3.0)
                self.assertFalse(worker.is_alive())
        finally:
            allow_post.set()
            allow_crossing_post.set()
            if worker.is_alive():
                worker.join(3.0)

    def test_configured_species_worker_feeds_only_new_roboflow_snapshots_to_hybrid_tracker(self) -> None:
        import time

        from species_detection import DetectionSnapshot

        class FakeSpeciesWorker:
            def __init__(self):
                self.snapshot = None
                self.stopped = False

            def start(self):
                pass

            def submit(self, _frame, captured_at):
                if self.snapshot is None:
                    self.snapshot = DetectionSnapshot(
                        sequence=1,
                        captured_at=captured_at,
                        completed_at=time.monotonic(),
                        detections=({
                            "class": "goat",
                            "confidence": 0.91,
                            "bbox": {"x1": 10.0, "y1": 12.0, "x2": 40.0, "y2": 52.0},
                        },),
                        inference_ms=135.0,
                        model_version="animal-detect-8sepq/2",
                    )

            def latest_after(self, sequence):
                if self.snapshot is not None and self.snapshot.sequence > sequence:
                    return self.snapshot
                return None

            def diagnostics(self):
                return {"backend": "roboflow", "ready": True, "api_calls": 1, "failed": 0,
                        "p95_latency_ms": 135.0, "effective_interval_seconds": 1.0,
                        "observed_classes": ["goat"], "dropped_frames": 0}

            def stop(self, timeout=3.0):
                self.stopped = True

        class FakeCounter:
            def __init__(self, **options):
                self.options = options
                self.calls = []
                self.outbox = SimpleNamespace(pending=lambda limit=100: [])

            def process(self, _frame, **options):
                self.calls.append(options)
                return {"animal_count": 0, "crossings": [], "inference_ms": 1.0}

            def set_gate_settings(self, *_args):
                pass

        class FakeResponse:
            status_code = 200
            text = ""

            def raise_for_status(self):
                pass

            def json(self):
                return {"gate_line_y": 0.55, "entry_flow": "top-to-bottom", "revision": 0}

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            def get(self, *_args, **_kwargs):
                return FakeResponse()

            def post(self, *_args, **_kwargs):
                return FakeResponse()

        counters = []

        def create_counter(**options):
            counter = FakeCounter(**options)
            counters.append(counter)
            return counter

        fake_inference = SimpleNamespace(LocalCameraCounter=create_counter)
        species_workers = []

        def create_species_worker():
            result = FakeSpeciesWorker()
            species_workers.append(result)
            return result

        frames: queue.Queue[object] = queue.Queue()
        captured_at = time.monotonic()
        frames.put((object(), captured_at))
        frames.put((object(), captured_at + 0.01))
        frames.put(None)
        worker = threading.Thread(
            target=gateway.run_inference_worker,
            args=(frames, "http://local/detections", "http://local/settings", "token", True),
            kwargs={"species_worker_factory": create_species_worker},
        )
        with patch.object(gateway, "stopping", False), \
                patch.object(gateway.requests, "Session", side_effect=FakeSession), \
                patch.dict("sys.modules", {"inference": fake_inference}):
            worker.start()
            worker.join(5.0)

        self.assertFalse(worker.is_alive())
        self.assertTrue(counters[0].options["hybrid_mode"])
        self.assertEqual(len(counters[0].calls), 2)
        self.assertEqual(counters[0].calls[0]["species_detections"][0]["class"], "goat")
        self.assertEqual(counters[0].calls[1], {})
        self.assertTrue(species_workers[0].stopped)

    def test_explicit_distinct_fallback_is_preserved(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_STREAM_PATH": "/stream1",
            "CAMERA_FALLBACK_STREAM_PATH": "/stream2",
        }):
            self.assertEqual(camera_stream_paths(), ["/stream1", "/stream2"])

    def test_duplicate_fallback_is_removed(self) -> None:
        with patch.dict(os.environ, {
            "CAMERA_STREAM_PATH": "/stream1",
            "CAMERA_FALLBACK_STREAM_PATH": "/stream1",
        }):
            self.assertEqual(camera_stream_paths(), ["/stream1"])

    def test_crossing_delivery_retries_durable_event_outside_count_upload(self) -> None:
        event = {"event_key": "crossing-1", "tracking_id": "T-017", "direction": "entry"}
        worker_stop = threading.Event()
        crossing_available = threading.Event()
        crossing_available.set()
        delivered = threading.Event()
        requests_seen: list[dict] = []

        class FakeOutbox:
            def __init__(self) -> None:
                self.items = [event]

            def pending(self, limit: int = 100) -> list[dict]:
                return self.items[:limit]

        class FakeCounter:
            def __init__(self) -> None:
                self.outbox = FakeOutbox()
                self.acknowledged: list[str] = []

            def acknowledge_crossings(self, keys: list[str]) -> None:
                self.acknowledged.extend(keys)
                self.outbox.items = [item for item in self.outbox.items if item["event_key"] not in keys]
                delivered.set()
                worker_stop.set()

            def archive_unrecorded_crossings(self, _outcomes: list[dict[str, str]]) -> int:
                return 0

        counter = FakeCounter()

        class FakeResponse:
            def __init__(self, status_code: int) -> None:
                self.status_code = status_code
                self.text = "temporarily unavailable" if status_code != 200 else ""

            def json(self) -> dict:
                return {
                    "acknowledged_crossing_keys": [event["event_key"]],
                    "unrecorded_crossings": [],
                }

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                pass

            def post(self, url: str, **kwargs: object) -> FakeResponse:
                requests_seen.append({"url": url, **kwargs})
                return FakeResponse(503 if len(requests_seen) == 1 else 200)

        worker = threading.Thread(
            target=run_camera_crossing_uploader,
            args=("http://localhost/api/camera/gateway/crossings", "token", counter,
                  threading.Lock(), worker_stop, crossing_available),
        )
        with patch.object(gateway, "stopping", False), \
                patch.object(gateway.requests, "Session", return_value=FakeSession()):
            worker.start()
            self.assertTrue(delivered.wait(3.0))
            worker.join(2.0)

        self.assertFalse(worker.is_alive())
        self.assertEqual(counter.acknowledged, [event["event_key"]])
        self.assertEqual(len(requests_seen), 2)
        self.assertEqual(requests_seen[0]["url"], "http://localhost/api/camera/gateway/crossings")
        self.assertEqual(requests_seen[0]["json"], {"crossings": [event]})
        self.assertEqual(requests_seen[1]["json"], requests_seen[0]["json"])

    def test_local_test_payload_keeps_preview_data_but_withholds_database_events(self) -> None:
        source = {
            "animal_count": 2,
            "entries_total": 1,
            "crossings": [{"event_key": "test-crossing"}],
            "config_revision": 56,
        }

        payload = camera_test_payload(source)

        self.assertEqual(payload["animal_count"], 2)
        self.assertEqual(payload["entries_total"], 1)
        self.assertEqual(payload["crossings"], [])
        self.assertNotIn("config_revision", payload)
        self.assertEqual(len(source["crossings"]), 1)

    def test_test_mode_only_accepts_loopback_http_targets(self) -> None:
        self.assertTrue(is_loopback_http_url("http://localhost:5173"))
        self.assertTrue(is_loopback_http_url("http://127.0.0.1:5173"))
        self.assertTrue(is_loopback_http_url("http://[::1]:5173"))
        self.assertFalse(is_loopback_http_url("https://localhost"))
        self.assertFalse(is_loopback_http_url("http://localhost.example.com"))
        self.assertFalse(is_loopback_http_url("https://alpasfarm.site"))

    def test_local_test_mode_fails_closed_for_remote_api(self) -> None:
        valid_sha = "a" * 64
        with patch.dict(os.environ, {
            "ALPASFARM_API_URL": "https://alpasfarm.site",
            "CAMERA_GATEWAY_TOKEN": "t" * 64,
            "CAMERA_HYBRID_TEST_ONLY": "1",
            "CAMERA_HYBRID_DETECTOR_URL": "http://127.0.0.1:8000/api/v1/detect",
            "CAMERA_HYBRID_API_KEY": "local-key",
            "CAMERA_HYBRID_MODEL_SHA256": valid_sha,
        }, clear=True):
            self.assertEqual(run_gateway(SimpleNamespace(diagnostics=False)), 2)

    def test_offline_video_source_requires_local_test_mode(self) -> None:
        with patch.dict(os.environ, {
            "ALPASFARM_API_URL": "http://127.0.0.1:5173",
            "CAMERA_GATEWAY_TOKEN": "t" * 64,
            "CAMERA_HYBRID_TEST_ONLY": "0",
            "CAMERA_TEST_VIDEO_PATH": "C:/local/clip.mp4",
        }, clear=True):
            self.assertEqual(run_gateway(SimpleNamespace(diagnostics=False)), 2)


class GatewayHeartbeatTests(unittest.TestCase):
    class FailingSession:
        def __enter__(self) -> "GatewayHeartbeatTests.FailingSession":
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def post(self, *_args: object, **_kwargs: object) -> None:
            raise gateway.requests.ConnectionError("connection refused")

    class StopAfterAttempt:
        def wait(self, _timeout: float) -> None:
            gateway.stopping = True

    def run_once_with_connection_failure(self, monotonic_values: list[float]):
        with (
            patch.object(gateway, "stopping", False),
            patch.object(gateway, "stop_event", self.StopAfterAttempt()),
            patch.object(gateway.requests, "Session", return_value=self.FailingSession()),
            patch.object(gateway.time, "monotonic", side_effect=monotonic_values),
            patch.object(gateway.log, "warning") as warning,
        ):
            run_gateway_heartbeat("https://example.invalid/heartbeat", "token")
        return warning

    def test_startup_connection_failure_is_given_a_grace_period(self) -> None:
        warning = self.run_once_with_connection_failure([100.0, 115.0])
        warning.assert_not_called()

    def test_persistent_startup_failure_logs_the_connection_error(self) -> None:
        warning = self.run_once_with_connection_failure([100.0, 160.0])
        warning.assert_called_once()
        self.assertIn("connection refused", str(warning.call_args.args[1]))


if __name__ == "__main__":
    unittest.main()
