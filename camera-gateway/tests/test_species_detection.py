import time
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np

from species_detection import SpeciesDetectionWorker


FINGERPRINT = "a" * 64


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        return None

    def json(self):
        return self.body


class FakeSession:
    def __init__(self):
        self.health_body = {
            "status": "ready",
            "model_loaded": True,
            "classes": ["goat", "sheep"],
            "model_sha256": FINGERPRINT,
            "model_version": "test-model",
        }
        self.detection_body = {
            "success": True,
            "image": {"width": 80, "height": 60},
            "model_version": "test-model",
            "predictions": [
                {"class": "goat", "confidence": 0.91, "bbox": {"x1": 5, "y1": 8, "x2": 40, "y2": 50}},
                {"class": "person", "confidence": 0.99, "bbox": {"x1": 0, "y1": 0, "x2": 70, "y2": 59}},
                {"class": "sheep", "confidence": 0.8, "bbox": {"x1": 70, "y1": 40, "x2": 20, "y2": 55}},
            ],
        }

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def get(self, *_args, **_kwargs):
        return FakeResponse(self.health_body)

    def post(self, *_args, **_kwargs):
        return FakeResponse(self.detection_body)


class SpeciesDetectionWorkerTests(unittest.TestCase):
    def test_configuration_requires_a_pinned_private_model_endpoint(self):
        settings = {
            "CAMERA_HYBRID_DETECTOR_URL": "http://127.0.0.1:8000/api/v1/detect",
            "CAMERA_HYBRID_API_KEY": "private-key",
            "CAMERA_HYBRID_MODEL_SHA256": FINGERPRINT,
        }
        with patch.dict("os.environ", settings, clear=True):
            self.assertIsNotNone(SpeciesDetectionWorker.from_env())
        settings["CAMERA_HYBRID_DETECTOR_URL"] = "http://public.example.com/api/v1/detect"
        with patch.dict("os.environ", settings, clear=True):
            self.assertIsNone(SpeciesDetectionWorker.from_env())
        settings["CAMERA_HYBRID_DETECTOR_URL"] = "https://ml.example.com/api/v1/detect"
        settings["CAMERA_HYBRID_MODEL_SHA256"] = ""
        with patch.dict("os.environ", settings, clear=True):
            self.assertIsNone(SpeciesDetectionWorker.from_env())

    def test_roboflow_configuration_selects_hosted_backend_and_defaults_model(self):
        with patch.dict("os.environ", {
            "ROBOFLOW_API_KEY": "test-key",
            "ROBOFLOW_CONFIDENCE_THRESHOLD": "0.62",
        }, clear=True):
            worker = SpeciesDetectionWorker.from_env()

        self.assertIsNotNone(worker)
        self.assertEqual(worker.backend, "roboflow")
        self.assertEqual(worker.model_id, "animal-detect-8sepq/2")
        self.assertEqual(worker.detector_url, "https://serverless.roboflow.com")
        self.assertEqual(worker.confidence_threshold, 0.62)
        with patch.dict("os.environ", {"ROBOFLOW_API_KEY": "test-key"}, clear=True):
            self.assertTrue(SpeciesDetectionWorker.configuration_requested())

    def test_partial_roboflow_configuration_fails_closed(self):
        with patch.dict("os.environ", {"ROBOFLOW_MODEL_ID": "animal-detect-8sepq/2"}, clear=True):
            self.assertIsNone(SpeciesDetectionWorker.from_env())
            self.assertTrue(SpeciesDetectionWorker.configuration_requested())

        with patch.dict("os.environ", {
            "ROBOFLOW_API_KEY": "test-key",
            "ROBOFLOW_API_URL": "http://serverless.roboflow.com",
        }, clear=True):
            self.assertIsNone(SpeciesDetectionWorker.from_env())

    def test_default_tapo_background_region_is_active_when_unset(self):
        settings = {
            "CAMERA_HYBRID_DETECTOR_URL": "http://127.0.0.1:8000/api/v1/detect",
            "CAMERA_HYBRID_API_KEY": "private-key",
            "CAMERA_HYBRID_MODEL_SHA256": FINGERPRINT,
        }
        with patch.dict("os.environ", settings, clear=True):
            worker = SpeciesDetectionWorker.from_env()
        self.assertIsNotNone(worker)
        self.assertEqual(worker.excluded_regions, ((0.68, 0.05, 0.84, 0.38),))

    def test_model_fingerprint_and_classes_are_required_before_ready(self):
        session = FakeSession()
        worker = SpeciesDetectionWorker(
            "http://localhost:8000/api/v1/detect", "private-key", FINGERPRINT,
            interval_seconds=0.5, session_factory=lambda: session,
        )
        self.assertTrue(worker._check_model(session))
        session.health_body["model_sha256"] = "b" * 64
        self.assertFalse(worker._check_model(session))
        self.assertFalse(worker.ready)

    def test_normalizer_preserves_valid_labels_for_developer_filtering(self):
        session = FakeSession()
        worker = SpeciesDetectionWorker(
            "http://localhost:8000/api/v1/detect", "private-key", FINGERPRINT,
            session_factory=lambda: session,
        )
        normalized = worker._normalize_predictions(session.detection_body, 80, 60)
        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0]["class"], "goat")
        self.assertEqual(normalized[0]["bbox"]["x2"], 40.0)
        prepared, raw, rejected = worker._prepare_predictions(session.detection_body, 80, 60)
        self.assertEqual([item["class"] for item in prepared], ["goat"])
        self.assertIn("person", {item["class"] for item in raw})
        self.assertEqual(rejected[0]["rejection_reason"], "unrelated_class")

    def test_official_sdk_client_uses_header_authentication(self):
        captured = {}

        class FakeClient:
            def __init__(self, **kwargs):
                captured["client"] = kwargs

            def configure(self, configuration):
                captured["configuration"] = configuration
                return self

        sdk = types.ModuleType("inference_sdk")
        sdk.InferenceHTTPClient = FakeClient
        sdk.InferenceConfiguration = lambda **kwargs: kwargs
        worker = SpeciesDetectionWorker(
            "https://serverless.roboflow.com", "test-key", backend="roboflow",
            model_id="animal-detect-8sepq/2", confidence_threshold=0.55,
        )

        with patch.dict(sys.modules, {"inference_sdk": sdk}):
            worker._new_roboflow_client()

        self.assertEqual(captured["client"]["api_url"], "https://serverless.roboflow.com")
        self.assertEqual(captured["configuration"]["api_key_transport"], "header")
        self.assertEqual(captured["configuration"]["confidence_threshold"], 0.55)
        self.assertEqual(captured["configuration"]["max_concurrent_requests"], 1)

    def test_roboflow_response_maps_xywh_and_filters_to_goat_sheep(self):
        class FakeClient:
            def infer(self, image, *, model_id):
                self.image_shape = image.shape
                self.model_id = model_id
                return {
                    "model_version": "animal-detect-8sepq/2",
                    "image": {"width": 80, "height": 60},
                    "predictions": [
                        {"x": 10, "y": 10, "width": 8, "height": 6, "confidence": 0.92, "class": "goat"},
                        {"x": 40, "y": 30, "width": 20, "height": 18, "confidence": 0.88, "class": "Sheep"},
                        {"x": 20, "y": 20, "width": 10, "height": 10, "confidence": 0.99, "class": "person"},
                        {"x": 60, "y": 40, "width": 12, "height": 12, "confidence": 0.3, "class": "goat"},
                        {"x": 2, "y": 50, "width": 8, "height": 12, "confidence": 0.85, "class": "goat"},
                    ],
                }

        worker = SpeciesDetectionWorker(
            "https://serverless.roboflow.com", "test-key", backend="roboflow",
            model_id="animal-detect-8sepq/2", confidence_threshold=0.5,
            roboflow_client_factory=lambda *_args: FakeClient(),
        )
        worker._roboflow_client = FakeClient()
        session = FakeSession()
        with patch.object(worker, "_roboflow_infer", side_effect=lambda frame: worker._roboflow_client.infer(frame, model_id=worker.model_id)):
            worker._detect(session, np.zeros((60, 80), dtype=np.uint8), time.monotonic())

        snapshot = worker.latest_after(0)
        self.assertIsNotNone(snapshot)
        self.assertEqual([item["class"] for item in snapshot.detections], ["goat", "sheep", "goat"])
        self.assertEqual(snapshot.detections[0]["bbox"], {"x1": 6.0, "y1": 7.0, "x2": 14.0, "y2": 13.0})
        self.assertEqual(snapshot.detections[-1]["bbox"]["x1"], 0.0)
        self.assertIn("person", snapshot.observed_classes)
        self.assertEqual([item["rejection_reason"] for item in snapshot.rejected_detections], [
            "unrelated_class", "below_confidence_threshold",
        ])
        self.assertEqual(worker.diagnostics()["api_calls"], 0)

    def test_roboflow_request_uses_configured_http_timeout(self):
        seen = []

        class FakeSessionForSdk:
            def request(self, _method, _url, **kwargs):
                seen.append(kwargs.get("timeout"))

        sdk_session = FakeSessionForSdk()
        executors = types.ModuleType("inference_sdk.http.utils.executors")
        executors._get_thread_local_requests_session = lambda: sdk_session
        sdk = types.ModuleType("inference_sdk")
        sdk.__path__ = []
        http = types.ModuleType("inference_sdk.http")
        http.__path__ = []
        utils = types.ModuleType("inference_sdk.http.utils")
        utils.__path__ = []
        utils.executors = executors

        class FakeClient:
            def infer(self, _frame, *, model_id):
                sdk_session.request("POST", "https://serverless.roboflow.com/test/1")
                return {"predictions": [], "image": {"width": 8, "height": 8}}

        worker = SpeciesDetectionWorker(
            "https://serverless.roboflow.com", "test-key", backend="roboflow",
            model_id="test/1", request_timeout_seconds=6,
        )
        worker._roboflow_client = FakeClient()
        with patch.dict(sys.modules, {
            "inference_sdk": sdk,
            "inference_sdk.http": http,
            "inference_sdk.http.utils": utils,
            "inference_sdk.http.utils.executors": executors,
        }):
            worker._roboflow_infer(np.zeros((8, 8, 3), dtype=np.uint8))

        self.assertEqual(seen, [(2.0, 6.0)])
        self.assertEqual(worker.diagnostics()["api_calls"], 1)

    def test_camera_background_region_removes_the_beam_false_positive_only(self):
        session = FakeSession()
        session.detection_body["image"] = {"width": 640, "height": 360}
        session.detection_body["predictions"] = [
            {
                "class": "goat",
                "confidence": 0.7083,
                "bbox": {"x1": 450, "y1": 36, "x2": 506, "y2": 116},
            },
            {
                "class": "sheep",
                "confidence": 0.91,
                "bbox": {"x1": 320, "y1": 250, "x2": 610, "y2": 355},
            },
        ]
        worker = SpeciesDetectionWorker(
            "http://localhost:8000/api/v1/detect", "private-key", FINGERPRINT,
            excluded_regions=((0.68, 0.05, 0.84, 0.38),),
            session_factory=lambda: session,
        )

        worker._detect(session, np.zeros((360, 640, 3), dtype=np.uint8), time.monotonic())
        snapshot = worker.latest_after(0)

        self.assertIsNotNone(snapshot)
        self.assertEqual(len(snapshot.detections), 1)
        self.assertEqual(snapshot.detections[0]["class"], "sheep")
        self.assertEqual(snapshot.rejected_detections[0]["rejection_reason"], "static_background_region_1")
        self.assertEqual(worker.diagnostics()["excluded_detections"], 1)

    def test_exclusion_region_parser_rejects_invalid_boxes(self):
        with patch.dict("os.environ", {
            "CAMERA_HYBRID_DETECTOR_URL": "http://127.0.0.1:8000/api/v1/detect",
            "CAMERA_HYBRID_API_KEY": "private-key",
            "CAMERA_HYBRID_MODEL_SHA256": FINGERPRINT,
            "CAMERA_HYBRID_EXCLUDED_REGIONS": "0.68,0.05,0.84,0.38;bad;0.9,0.8,0.2,0.9",
        }, clear=True):
            worker = SpeciesDetectionWorker.from_env()

        self.assertIsNotNone(worker)
        self.assertEqual(worker.excluded_regions, ((0.68, 0.05, 0.84, 0.38),))

    def test_worker_publishes_latest_detector_snapshot(self):
        session = FakeSession()
        worker = SpeciesDetectionWorker(
            "http://localhost:8000/api/v1/detect", "private-key", FINGERPRINT,
            interval_seconds=0.5, session_factory=lambda: session,
        )
        worker.start()
        try:
            image = np.zeros((60, 80, 3), dtype=np.uint8)
            worker.submit(image, time.monotonic())
            deadline = time.monotonic() + 3.0
            snapshot = None
            while time.monotonic() < deadline and snapshot is None:
                snapshot = worker.latest_after(0)
                time.sleep(0.02)
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot.model_version, "test-model")
            self.assertEqual(len(snapshot.detections), 1)
            self.assertEqual(snapshot.detections[0]["class"], "goat")
            self.assertTrue(worker.ready)
        finally:
            worker.stop()


if __name__ == "__main__":
    unittest.main()
