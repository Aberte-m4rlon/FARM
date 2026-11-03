import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import inference


class CameraInferenceTests(unittest.TestCase):
    def test_counter_disables_identification_and_preserves_full_frame_animals_on_both_sides(self) -> None:
        counter = inference.LocalCameraCounter.__new__(inference.LocalCameraCounter)
        counter.line_y = 0.55
        counter.entry_flow = "top-to-bottom"
        counter.settings_ready = True
        counter.config_revision = 4
        counter.counting_session_id = None
        counter.crossing_tracker = MagicMock()
        counter.crossing_tracker.observe.return_value = []
        counter.outbox = MagicMock()
        counter.outbox.pending.return_value = []
        outside_goat = {
            "class": "goat",
            "confidence": 0.9,
            "bbox": {"x1": 1, "y1": 5, "x2": 20, "y2": 30},
            "tracking_id": "17",
            "eartag_numbers": [{"value": "25", "confidence": 99}],
        }
        inside_sheep = {
            "class": "sheep",
            "confidence": 0.88,
            "bbox": {"x1": 70, "y1": 65, "x2": 98, "y2": 95},
            "tracking_id": "18",
        }
        detection_result = {
            "predictions": [outside_goat, inside_sheep],
            "counts": {"total": 2},
            "inference_ms": 12.0,
            "image": {"width": 100, "height": 100},
        }

        encoded_image = MagicMock()
        encoded_image.tobytes.return_value = b"jpeg"
        decoded_image = SimpleNamespace(width=100, height=100)
        with patch.object(inference.cv2, "imencode", return_value=(True, encoded_image)), \
             patch.object(inference, "decode_image", return_value=decoded_image), \
             patch.object(inference, "detect", return_value=detection_result) as detect:
            result = counter.process(object())

        self.assertIs(detect.call_args.args[0], decoded_image)
        self.assertFalse(detect.call_args.kwargs["include_identification"])
        self.assertNotIn("identification_max_detections", detect.call_args.kwargs)
        self.assertEqual(
            result["predictions"],
            [
                {"class": "goat", "confidence": 0.9, "bbox": outside_goat["bbox"], "tracking_id": "17"},
                {"class": "sheep", "confidence": 0.88, "bbox": inside_sheep["bbox"], "tracking_id": "18"},
            ],
        )
        counter.crossing_tracker.observe.assert_called_once_with([outside_goat, inside_sheep], 100)
        self.assertEqual(result["crossings"], [])


if __name__ == "__main__":
    unittest.main()
