import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from app import species_detector


class SpeciesDetectorValidationTests(unittest.TestCase):
    @staticmethod
    def image_bytes(image_format="JPEG", size=(64, 48)):
        output = io.BytesIO()
        Image.new("RGB", size, color=(90, 150, 80)).save(output, format=image_format)
        return output.getvalue()

    def test_accepts_jpeg_and_returns_rgb_image(self):
        image = species_detector.decode_image(self.image_bytes(), "image/jpeg")
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.size, (64, 48))

    def test_accepts_png_and_webp(self):
        for image_format, mime_type in (("PNG", "image/png"), ("WEBP", "image/webp")):
            with self.subTest(image_format=image_format):
                image = species_detector.decode_image(self.image_bytes(image_format), mime_type)
                self.assertEqual(image.mode, "RGB")

    def test_rejects_unsupported_mime_type(self):
        with self.assertRaises(species_detector.InvalidImage):
            species_detector.decode_image(self.image_bytes(), "image/gif")

    def test_rejects_mismatched_image_content(self):
        with self.assertRaises(species_detector.InvalidImage):
            species_detector.decode_image(self.image_bytes("PNG"), "image/jpeg")

    def test_rejects_corrupt_bytes_when_pillow_open_is_monkeypatched(self):
        original_open = species_detector._PIL_IMAGE_OPEN

        def patched_open(*args, **kwargs):
            try:
                return original_open(*args, **kwargs)
            except Exception as error:
                raise RuntimeError("optional image plugin unavailable") from error

        with patch.object(Image, "open", patched_open):
            with self.assertRaises(species_detector.InvalidImage):
                species_detector.decode_image(b"not-an-image", "image/jpeg")

    def test_rejects_upload_over_limit(self):
        with patch.object(species_detector, "MAX_IMAGE_BYTES", 12):
            with self.assertRaises(species_detector.InvalidImage):
                species_detector.decode_image(self.image_bytes(), "image/jpeg")

    def test_rejects_excessive_image_dimensions(self):
        with patch.object(species_detector, "MAX_IMAGE_PIXELS", 100):
            with self.assertRaises(species_detector.InvalidImage):
                species_detector.decode_image(self.image_bytes(size=(20, 20)), "image/jpeg")

    def test_missing_weights_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            missing_weights = Path(directory) / "best.pt"
            with patch.object(species_detector, "MODEL_PATH", missing_weights):
                with patch.object(species_detector, "_model", None):
                    with patch.object(species_detector, "_model_error", None):
                        self.assertFalse(species_detector.model_status()["weights_present"])
                        with self.assertRaises(species_detector.SpeciesModelUnavailable):
                            species_detector._load_model()

    def test_api_key_comes_from_environment_and_uses_constant_time_comparison(self):
        with patch.dict(os.environ, {"SPECIES_API_KEY": "unit-test-only-secret"}):
            species_detector.verify_species_api_key("unit-test-only-secret")
            with self.assertRaises(PermissionError):
                species_detector.verify_species_api_key("incorrect")
        with patch.dict(os.environ, {"SPECIES_API_KEY": ""}):
            with self.assertRaises(species_detector.SpeciesModelUnavailable):
                species_detector.verify_species_api_key("unit-test-only-secret")


class EartagOcrTests(unittest.TestCase):
    @staticmethod
    def fake_tesseract(output):
        return SimpleNamespace(
            Output=SimpleNamespace(DICT=object()),
            image_to_data=lambda *args, **kwargs: output,
        )

    @staticmethod
    def image():
        return Image.new("RGB", (120, 100), color=(90, 150, 80))

    def test_reads_only_a_complete_digits_only_eartag_number(self):
        data = {
            "text": ["0025", "A12", "1234567", "0"],
            "conf": ["88", "99", "99", "99"],
            "left": [20, 10, 5, 2],
            "top": [10, 5, 3, 1],
            "width": [30, 20, 40, 8],
            "height": [12, 10, 15, 8],
        }
        with patch.object(species_detector, "pytesseract", self.fake_tesseract(data)):
            result = species_detector._read_eartag_numbers_in_ear_region(self.image(), (20, 20, 100, 95))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["value"], "25")
        self.assertEqual(result[0]["confidence"], 88.0)
        self.assertGreater(result[0]["bbox"]["x2"], result[0]["bbox"]["x1"])

    def test_does_not_join_separate_ocr_fragments_into_a_guessed_number(self):
        data = {
            "text": ["1", "2"],
            "conf": ["87", "75"],
            "left": [12, 45],
            "top": [8, 8],
            "width": [10, 10],
            "height": [12, 12],
        }
        with patch.object(species_detector, "pytesseract", self.fake_tesseract(data)):
            result = species_detector._read_eartag_numbers_in_ear_region(self.image(), (20, 20, 100, 95))

        self.assertEqual([item["value"] for item in result], ["1"])


class _FakeScalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class _FakeCoordinates:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


class _FakeBox:
    def __init__(self, class_id, confidence, coordinates):
        self.cls = [_FakeScalar(class_id)]
        self.conf = [_FakeScalar(confidence)]
        self.xyxy = [_FakeCoordinates(coordinates)]


class _FakeSpeciesModel:
    names = {0: "goat", 1: "sheep"}

    def __init__(self, boxes):
        self.boxes = boxes

    def predict(self, image, conf, imgsz, max_det, verbose):
        return [SimpleNamespace(boxes=self.boxes)]


class _FakeTrackingModel:
    names = {0: "goat", 1: "sheep"}

    def __init__(self, boxes):
        self.boxes = boxes
        self.track_options = None

    def track(self, image, **options):
        self.track_options = options
        return [SimpleNamespace(boxes=self.boxes)]


class _FakeBoxList(list):
    pass


class SpeciesDetectionResponseTests(unittest.TestCase):
    def test_goat_prediction_has_count_confidence_and_pixel_box(self):
        model = _FakeSpeciesModel([_FakeBox(0, 0.91, [2, 3, 40, 45])])
        before = species_detector.inference_diagnostics()
        with patch.object(species_detector, "_model", model), patch.object(species_detector, "_person_boxes", return_value=[]):
            result = species_detector.detect(Image.new("RGB", (64, 48)))
        self.assertEqual(result["counts"], {"goat": 1, "sheep": 0, "total": 1})
        self.assertEqual(result["predictions"][0]["class"], "goat")
        self.assertEqual(result["predictions"][0]["bbox"], {"x1": 2.0, "y1": 3.0, "x2": 40.0, "y2": 45.0})
        self.assertEqual(result["predictions"][0]["confidence"], 0.91)
        self.assertGreaterEqual(result["inference_ms"], 0)
        after = species_detector.inference_diagnostics()
        self.assertEqual(after["successful_inferences_total"], before["successful_inferences_total"] + 1)
        self.assertEqual(after["total_detections_by_class"]["goat"], before["total_detections_by_class"]["goat"] + 1)

    def test_sheep_prediction_is_not_reported_as_a_goat(self):
        model = _FakeSpeciesModel([_FakeBox(1, 0.88, [5, 6, 30, 38])])
        with patch.object(species_detector, "_model", model), patch.object(species_detector, "_person_boxes", return_value=[]):
            result = species_detector.detect(Image.new("RGB", (64, 48)))
        self.assertEqual(result["counts"], {"goat": 0, "sheep": 1, "total": 1})
        self.assertEqual(result["predictions"][0]["class"], "sheep")

    def test_empty_detection_returns_zero_counts(self):
        model = _FakeSpeciesModel([])
        with patch.object(species_detector, "_model", model), patch.object(species_detector, "_person_boxes", return_value=[]):
            result = species_detector.detect(Image.new("RGB", (64, 48)))
        self.assertEqual(result["counts"], {"goat": 0, "sheep": 0, "total": 0})
        self.assertEqual(result["predictions"], [])

    def test_identification_budget_targets_only_the_animal_nearest_the_counting_line(self):
        boxes = [
            _FakeBox(0, 0.99, [2, 2, 30, 22]),
            _FakeBox(1, 0.80, [4, 42, 34, 62]),
        ]
        model = _FakeSpeciesModel(boxes)
        with patch.object(species_detector, "_model", model), \
             patch.object(species_detector, "_person_boxes", return_value=[]), \
             patch.object(species_detector, "_read_eartag_numbers_in_ear_region", return_value=[]) as read_eartag:
            species_detector.detect(
                Image.new("RGB", (64, 100)),
                include_identification=True,
                identification_max_detections=1,
                identification_line_y=0.5,
            )
        self.assertEqual(read_eartag.call_count, 1)
        self.assertEqual(read_eartag.call_args.args[1], (4.0, 42.0, 34.0, 62.0))

    def test_local_tracking_uses_cpu_and_keeps_ids_aligned_with_boxes(self):
        boxes = _FakeBoxList([
            _FakeBox(1, 0.88, [1, 2, 20, 24]),
            _FakeBox(0, 0.91, [2, 3, 40, 45]),
        ])
        boxes.id = [_FakeScalar(14), _FakeScalar(27)]
        model = _FakeTrackingModel(boxes)
        with patch.object(species_detector, "_model", model), patch.object(species_detector, "_person_boxes", return_value=[]):
            result = species_detector.detect(Image.new("RGB", (64, 48)), persist_tracking=True, device="cpu")

        self.assertEqual(model.track_options["device"], "cpu")
        self.assertEqual(
            {prediction["class"]: prediction["tracking_id"] for prediction in result["predictions"]},
            {"sheep": "14", "goat": "27"},
        )


if __name__ == "__main__":
    unittest.main()
