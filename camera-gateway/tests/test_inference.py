import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

import inference
from motion_tracker import MotionObservation, MotionUpdate


class CameraInferenceTests(unittest.TestCase):
    def make_counter(self, folder: str) -> inference.LocalCameraCounter:
        return inference.LocalCameraCounter(Path(folder) / "crossings.json")

    def test_merged_motion_blob_keeps_two_separate_flow_tracks(self) -> None:
        boxes, hints, ambiguous, rejected = inference.LocalCameraCounter._combine_motion_and_flow(
            [(100.0, 100.0, 240.0, 180.0)],
            [
                ("11", (105.0, 105.0, 160.0, 175.0)),
                ("12", (178.0, 105.0, 233.0, 175.0)),
            ],
        )
        self.assertEqual(len(boxes), 2)
        self.assertEqual(hints, {0: "11", 1: "12"})
        self.assertEqual(ambiguous, set())
        self.assertEqual(rejected, [])

    def test_indistinguishable_overlapping_flow_tracks_are_marked_ambiguous(self) -> None:
        boxes, hints, ambiguous, rejected = inference.LocalCameraCounter._combine_motion_and_flow(
            [(100.0, 100.0, 230.0, 180.0)],
            [
                ("21", (100.0, 100.0, 170.0, 170.0)),
                ("22", (115.0, 100.0, 185.0, 170.0)),
            ],
        )
        self.assertEqual(boxes, [])
        self.assertEqual(hints, {})
        self.assertEqual(ambiguous, {"21", "22"})
        self.assertEqual(rejected[0][4], "ambiguous-merged-tracks")

    def test_stationary_object_does_not_create_visible_boxes(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            black_frame = np.zeros((540, 960, 3), dtype=np.uint8)
            for _ in range(8):
                result = counter.process(black_frame)
            stationary = black_frame.copy()
            cv2.rectangle(stationary, (140, 180), (260, 330), (210, 210, 210), -1)
            for _ in range(20):
                result = counter.process(stationary)
            self.assertEqual(result["predictions"], [])

    def test_hybrid_empty_scene_never_uses_motion_fragments_as_animals(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            frame = np.zeros((240, 320, 3), dtype=np.uint8)
            for _ in range(12):
                result = counter.process(frame)
            self.assertEqual(result["predictions"], [])
            self.assertEqual(result["animal_count"], 0)
            self.assertTrue(counter._last_motion_diagnostics["hybrid_mode"])

    def test_hybrid_detection_confirms_class_and_keeps_same_id_between_updates(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            frame = np.zeros((240, 320, 3), dtype=np.uint8)
            cv2.rectangle(frame, (90, 70), (170, 160), (180, 180, 180), 2)
            for y in range(78, 156, 8):
                cv2.line(frame, (98, y), (160, y), (100 + y % 100, 40, 140), 2)
            detection = {"class": "sheep", "confidence": 0.93, "bbox": {"x1": 90, "y1": 70, "x2": 170, "y2": 160}}
            with patch.object(inference, "monotonic", side_effect=(1.0, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5)):
                counter.process(frame, species_detections=[detection], detector_timestamp=1.0)
                confirmed = counter.process(
                    frame,
                    species_detections=[detection],
                    detector_timestamp=2.0,
                )
                moved = np.zeros_like(frame)
                cv2.rectangle(moved, (96, 74), (176, 164), (180, 180, 180), 2)
                for y in range(82, 160, 8):
                    cv2.line(moved, (104, y), (166, y), (100 + y % 100, 40, 140), 2)
                followed = counter.process(moved)
                pauses = [counter.process(moved) for _ in range(4)]
            self.assertEqual(confirmed["animal_count"], 1)
            self.assertEqual(confirmed["predictions"][0]["class"], "sheep")
            self.assertEqual(confirmed["predictions"][0]["animal_type"], "sheep")
            tracking_id = confirmed["predictions"][0]["tracking_id"]

            self.assertEqual(followed["animal_count"], 1)
            self.assertEqual(followed["predictions"][0]["tracking_id"], tracking_id)
            self.assertEqual(followed["predictions"][0]["class"], "sheep")

            self.assertTrue(all(result["animal_count"] == 1 for result in pauses))
            self.assertTrue(all(result["predictions"][0]["tracking_id"] == tracking_id for result in pauses))

    def test_hybrid_single_strong_ml_detection_shows_box_without_counting(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            frame = np.zeros((240, 320, 3), dtype=np.uint8)
            result = counter.process(
                frame,
                species_detections=[{
                    "class": "goat", "confidence": 0.755,
                    "bbox": {"x1": 200, "y1": 150, "x2": 310, "y2": 235},
                }],
                detector_timestamp=inference.monotonic(),
            )

            self.assertEqual(result["animal_count"], 1)
            self.assertEqual(len(result["predictions"]), 1)
            self.assertTrue(result["predictions"][0]["confirmed"])
            self.assertEqual(result["predictions"][0]["class"], "goat")
            self.assertEqual(result["crossings"], [])

    def test_hybrid_occlusion_reacquires_the_same_identity(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            visible = np.zeros((240, 320, 3), dtype=np.uint8)
            cv2.rectangle(visible, (90, 70), (170, 160), (180, 180, 180), 2)
            for y in range(78, 156, 8):
                cv2.line(visible, (98, y), (160, y), (100 + y % 100, 40, 140), 2)
            detection = {"class": "goat", "confidence": 0.91, "bbox": {"x1": 90, "y1": 70, "x2": 170, "y2": 160}}
            with patch.object(inference, "monotonic", side_effect=(1.0, 2.0, 3.0, 4.0)):
                counter.process(visible, species_detections=[detection], detector_timestamp=1.0)
                confirmed = counter.process(visible, species_detections=[detection], detector_timestamp=2.0)
                tracking_id = confirmed["predictions"][0]["tracking_id"]
                with patch.object(counter, "_optical_flow_boxes", return_value=[]):
                    occluded = counter.process(np.zeros_like(visible))
                self.assertEqual(occluded["animal_count"], 1)
                self.assertEqual(occluded["predictions"][0]["tracking_state"], "TEMPORARILY_OCCLUDED")
                reacquired = counter.process(visible, species_detections=[detection], detector_timestamp=4.0)
            self.assertEqual(reacquired["animal_count"], 1)
            self.assertEqual(reacquired["predictions"][0]["tracking_id"], tracking_id)

    def test_hybrid_optical_flow_cannot_keep_a_false_track_forever(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            frame = np.zeros((240, 320, 3), dtype=np.uint8)
            detection = {
                "class": "goat", "confidence": 0.91,
                "bbox": {"x1": 90, "y1": 70, "x2": 170, "y2": 160},
            }
            times = [1.0, 2.0, *[float(value) for value in range(3, 13)]]
            with patch.object(inference, "monotonic", side_effect=times):
                counter.process(frame, species_detections=[detection], detector_timestamp=1.0)
                confirmed = counter.process(frame, species_detections=[detection], detector_timestamp=2.0)
                tracking_id = confirmed["predictions"][0]["tracking_id"]
                with patch.object(
                    counter,
                    "_optical_flow_boxes",
                    return_value=[(tracking_id, (90.0, 70.0, 170.0, 160.0))],
                ):
                    bridged = [counter.process(frame) for _ in range(10)]

            self.assertGreater(bridged[0]["animal_count"], 0)
            self.assertTrue(all(result["animal_count"] == 0 for result in bridged[8:]))
            expired = counter._last_motion_diagnostics["recently_expired_tracks"]
            self.assertEqual(expired[-1]["reason"], "detector_confirmation_timeout")

    def test_hybrid_tracks_two_animals_with_separate_classes_and_ids(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            frame = np.zeros((240, 360, 3), dtype=np.uint8)
            with patch.object(inference, "monotonic", side_effect=(1.0, 2.0)):
                counter.process(frame, species_detections=[
                    {"class": "goat", "confidence": 0.9, "bbox": {"x1": 40, "y1": 60, "x2": 110, "y2": 150}},
                    {"class": "sheep", "confidence": 0.92, "bbox": {"x1": 220, "y1": 60, "x2": 300, "y2": 150}},
                ], detector_timestamp=1.0)
                result = counter.process(frame, species_detections=[
                    {"class": "goat", "confidence": 0.91, "bbox": {"x1": 45, "y1": 64, "x2": 115, "y2": 154}},
                    {"class": "sheep", "confidence": 0.93, "bbox": {"x1": 215, "y1": 64, "x2": 295, "y2": 154}},
                ], detector_timestamp=2.0)
            self.assertEqual(result["animal_count"], 2)
            self.assertEqual({item["class"] for item in result["predictions"]}, {"goat", "sheep"})
            self.assertEqual(len({item["tracking_id"] for item in result["predictions"]}), 2)

    def test_hybrid_tracked_crossing_queues_one_species_event(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = inference.LocalCameraCounter(Path(folder) / "crossings.json", hybrid_mode=True)
            counter.set_gate_settings(0.5, "top-to-bottom")
            frame = np.zeros((400, 320, 3), dtype=np.uint8)
            results = []
            centers = (100, 140, 180, 220, 260, 300, 340)
            with patch.object(inference, "monotonic", side_effect=[1.0 + index * 0.5 for index in range(len(centers))]):
                for index, center_y in enumerate(centers):
                    box = {"x1": 120, "y1": center_y - 20, "x2": 180, "y2": center_y + 20}
                    result = counter.process(
                        frame,
                        species_detections=[{"class": "goat", "confidence": 0.9, "bbox": box}],
                        detector_timestamp=1.0 + index * 0.5,
                    )
                    results.append(result)
            events = results[-1]["crossings"]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["animal_type"], "goat")
            self.assertEqual(events[0]["direction"], "entry")

    def test_global_brightness_change_is_suppressed(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            dark = np.zeros((540, 960, 3), dtype=np.uint8)
            light = np.full((540, 960, 3), 220, dtype=np.uint8)
            for _ in range(8):
                counter.process(dark)
            result = counter.process(light)
            self.assertTrue(counter._last_motion_diagnostics["global_lighting_change"])
            self.assertEqual(result["predictions"], [])

    def test_sudden_and_gradual_global_exposure_changes_do_not_create_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            base = np.full((240, 320, 3), 90, dtype=np.uint8)
            cv2.rectangle(base, (30, 30), (100, 180), (70, 110, 150), -1)
            for _ in range(8):
                counter.process(base)

            results = []
            lighting_flags = []
            for delta in (50, 50, 50, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0):
                frame = cv2.convertScaleAbs(base, alpha=1.0, beta=delta)
                results.append(counter.process(frame))
                lighting_flags.append(counter._last_motion_diagnostics["global_lighting_change"])

            self.assertTrue(any(lighting_flags))
            self.assertTrue(all(result["animal_count"] == 0 for result in results))
            self.assertTrue(all(result["crossings"] == [] for result in results))
            self.assertEqual(counter._last_motion_diagnostics["states"]["APPROACHING_GATE"], 0)
            self.assertEqual(counter._last_motion_diagnostics["states"]["DETECTED"], 0)

    def test_moving_chromaticity_preserving_shadow_is_suppressed(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            base = np.full((240, 320, 3), (110, 130, 150), dtype=np.uint8)
            cv2.rectangle(base, (20, 20), (299, 219), (95, 120, 140), 3)
            for _ in range(8):
                counter.process(base)

            results = []
            for x in range(30, 170, 8):
                frame = base.copy()
                shadow = np.zeros(base.shape[:2], dtype=np.uint8)
                cv2.ellipse(shadow, (x, 120), (38, 65), 0, 0, 360, 255, -1)
                darkened = cv2.convertScaleAbs(frame, alpha=0.62)
                frame[shadow > 0] = darkened[shadow > 0]
                results.append(counter.process(frame))

            self.assertTrue(any(counter._last_motion_diagnostics["shadow_pixels"] > 0 for _ in results))
            self.assertTrue(all(result["animal_count"] == 0 for result in results))
            self.assertEqual(counter._last_motion_diagnostics["states"]["APPROACHING_GATE"], 0)
            self.assertEqual(counter._last_motion_diagnostics["states"]["DETECTED"], 0)

    def test_brief_exposure_change_keeps_an_existing_track_and_emits_no_crossing(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            background = np.zeros((240, 320, 3), dtype=np.uint8)
            timestamps = iter(index * 0.1 for index in range(28))
            results = []
            lighting_flags = []
            last_object_frame = background
            with patch.object(inference, "monotonic", side_effect=lambda: next(timestamps)):
                for _ in range(8):
                    counter.process(background)
                for step in range(16):
                    last_object_frame = np.zeros_like(background)
                    cv2.rectangle(
                        last_object_frame,
                        (80 + step * 2, 80),
                        (119 + step * 2, 119),
                        (150, 150, 150),
                        -1,
                    )
                    results.append(counter.process(last_object_frame))
                changed_light = cv2.convertScaleAbs(last_object_frame, alpha=1.0, beta=45)
                for _ in range(4):
                    results.append(counter.process(changed_light))
                    lighting_flags.append(counter._last_motion_diagnostics["global_lighting_change"])

            self.assertTrue(any(result["animal_count"] > 0 for result in results[:16]))
            self.assertTrue(any(lighting_flags))
            self.assertEqual(
                [prediction["tracking_id"] for prediction in results[-1]["predictions"]],
                ["1"],
            )
            self.assertEqual(results[-1]["crossings"], [])

    def test_slow_small_object_motion_produces_one_stable_opencv_track(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            background = np.zeros((240, 320, 3), dtype=np.uint8)
            results = []
            timestamps = iter(index * 0.1 for index in range(24))
            with patch.object(inference, "monotonic", side_effect=lambda: next(timestamps)):
                for _ in range(8):
                    results.append(counter.process(background))
                for step in range(16):
                    frame = np.zeros_like(background)
                    cv2.rectangle(
                        frame,
                        (80 + step * 2, 80),
                        (119 + step * 2, 119),
                        (150, 150, 150),
                        -1,
                    )
                    results.append(counter.process(frame))

            visible_counts = [result["animal_count"] for result in results]
            self.assertGreater(max(visible_counts), 0)
            self.assertLessEqual(max(visible_counts), 1)
            self.assertEqual(results[-1]["predictions"][0]["tracking_id"], "1")
            self.assertEqual(results[-1]["predictions"][0]["state"], "ACTIVE")

    def test_merges_elongated_motion_fragments_but_keeps_animal_sized_regions_separate(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            fragments = np.zeros((100, 140), dtype=np.uint8)
            cv2.rectangle(fragments, (10, 20), (19, 59), 255, -1)
            cv2.rectangle(fragments, (50, 20), (59, 59), 255, -1)
            merged_boxes, _, _ = counter._validated_contours(fragments)
            self.assertEqual(len(merged_boxes), 1)

            animals = np.zeros((100, 140), dtype=np.uint8)
            cv2.rectangle(animals, (10, 20), (39, 59), 255, -1)
            cv2.rectangle(animals, (50, 20), (79, 59), 255, -1)
            separate_boxes, _, _ = counter._validated_contours(animals)
            self.assertEqual(len(separate_boxes), 2)

    def test_motion_outputs_are_temporally_confirmed(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            frame = np.zeros((540, 960, 3), dtype=np.uint8)
            for _ in range(6):
                counter.process(frame)
            contour_boxes = [
                (100.0 + index * 8, 100.0, 180.0 + index * 8, 180.0)
                for index in range(6)
            ]
            with patch.object(
                counter,
                "_validated_contours",
                side_effect=[
                    ([box], [], {"too_small": 0, "too_large": 0, "fragmented": 0})
                    for box in contour_boxes
                ],
            ), patch.object(inference, "monotonic", side_effect=[float(value) for value in range(6, 12)]):
                results = [counter.process(frame) for _ in range(6)]
            self.assertTrue(any(result["predictions"] for result in results))
            first_visible = next(result for result in results if result["predictions"])
            self.assertEqual(first_visible["model_version"], "opencv-significant-motion")
            self.assertEqual(first_visible["predictions"][0]["tracking_id"], "1")

    def test_confirmed_trajectory_is_replayed_to_line_crossing_tracker(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            boxes = [(100.0, y - 15, 150.0, y + 15) for y in (200, 240, 275, 330, 350)]
            history = tuple((index * 0.5 + 1.0, box) for index, box in enumerate(boxes))
            activated = MotionObservation(
                tracking_id="1",
                bbox=boxes[-1],
                at=3.0,
                movement=20.0,
                state="ACTIVE",
                history=history,
                movement_consistency=0.9,
                box_stability=0.9,
            )
            update = MotionUpdate(
                active=(activated,),
                displayed=(activated,),
                newly_active=(activated,),
                diagnostics={"states": {"ACTIVE": 1}, "tracks": []},
            )
            with patch.object(counter, "_opencv_predictions", return_value=(
                [counter._prediction(activated)],
                update,
                {"width": 960, "height": 540},
            )):
                result = counter.process(np.zeros((540, 960, 3), dtype=np.uint8))
            self.assertEqual(len(result["crossings"]), 1)
            self.assertEqual(result["crossings"][0]["direction"], "entry")
            self.assertEqual(result["crossings"][0]["tracking_id"], "T-001")

    def test_stationary_wait_then_observed_crossing_counts_once_and_keeps_track(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            counter.set_gate_settings(0.5, "top-to-bottom")
            counter._frames_seen = counter._warmup_frames
            centers_y = (220, 232, 242, 250, 260, 260, 260, 260, 288, 300, 302)
            boxes = [
                (200.0, float(center_y - 20), 270.0, float(center_y + 20))
                for center_y in centers_y
            ]
            timestamps = iter(index * 0.5 for index in range(len(boxes)))
            contour_results = [
                ([box], [], {"too_small": 0, "too_large": 0, "fragmented": 0})
                for box in boxes
            ]
            frame = np.zeros((540, 960, 3), dtype=np.uint8)
            with patch.object(counter, "_validated_contours", side_effect=contour_results), \
                    patch.object(inference, "monotonic", side_effect=lambda: next(timestamps)):
                results = [counter.process(frame) for _ in boxes]

            crossing_batches = [result["crossings"] for result in results]
            recorded_by_key = {
                item["event_key"]: item for batch in crossing_batches for item in batch
            }
            recorded = list(recorded_by_key.values())
            self.assertEqual(len(recorded), 1)
            self.assertEqual(recorded[0]["direction"], "entry")
            self.assertEqual(recorded[0]["tracking_id"], "T-001")
            self.assertEqual(results[-1]["predictions"][0]["tracking_id"], "1")
            self.assertEqual(results[-1]["predictions"][0]["tracking_state"], "CROSSED_ENTRY")

    def test_occlusion_prediction_is_never_submitted_as_crossing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            counter.crossing_tracker.observe(
                [counter._prediction(MotionObservation(
                    tracking_id="1", bbox=(100, 100, 150, 150), at=1.0,
                    movement=20, state="APPROACHING_GATE", movement_consistency=0.9,
                    box_stability=0.9,
                ))],
                540, now=1.0, frame_width=960,
            )
            predicted = MotionObservation(
                tracking_id="1", bbox=(100, 350, 150, 400), at=2.0,
                movement=20, state="TEMPORARILY_OCCLUDED", movement_consistency=0.9,
                box_stability=0.9, observed=False,
            )
            update = MotionUpdate(
                active=(), displayed=(predicted,), newly_active=(),
                diagnostics={"states": {"TEMPORARILY_OCCLUDED": 1}, "tracks": []},
            )
            with patch.object(counter, "_opencv_predictions", return_value=(
                [counter._prediction(predicted)], update, {"width": 960, "height": 540},
            )):
                result = counter.process(np.zeros((540, 960, 3), dtype=np.uint8))

            self.assertEqual(result["crossings"], [])
            self.assertEqual(counter.crossing_tracker._tracks["1"]["side"], "top")

    def test_image_template_keeps_stationary_confirmed_animal_observed(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            counter._frames_seen = counter._warmup_frames
            positions = [40 + index * 8 for index in range(6)]
            frames = []
            for x in positions:
                frame = np.zeros((240, 320, 3), dtype=np.uint8)
                cv2.rectangle(frame, (x, 80), (x + 59, 139), (180, 180, 180), -1)
                cv2.line(frame, (x + 9, 89), (x + 50, 130), (25, 25, 25), 3)
                cv2.circle(frame, (x + 45, 94), 6, (245, 245, 245), -1)
                frames.append(frame)
            stationary = frames[-1]
            frames.extend([stationary.copy() for _ in range(20)])
            contour_boxes = [
                ([(float(x), 80.0, float(x + 60), 140.0)], [],
                 {"too_small": 0, "too_large": 0, "fragmented": 0})
                for x in positions
            ]
            contour_boxes.extend(
                ([], [], {"too_small": 0, "too_large": 0, "fragmented": 0})
                for _ in range(20)
            )
            timestamps = iter(index * 0.2 for index in range(len(frames)))
            with patch.object(counter, "_validated_contours", side_effect=contour_boxes), \
                    patch.object(inference, "monotonic", side_effect=lambda: next(timestamps)):
                results = [counter.process(frame) for frame in frames]

            stationary_results = results[6:]
            self.assertTrue(all(result["predictions"] for result in stationary_results))
            self.assertEqual(
                {result["predictions"][0]["tracking_id"] for result in stationary_results},
                {"1"},
            )
            self.assertTrue(all(result["predictions"][0]["observed"] for result in stationary_results))
            self.assertEqual(counter._last_motion_diagnostics["states"]["TEMPORARILY_STATIONARY"], 1)

    def test_rejects_non_opencv_frames_without_falling_back_to_ml(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            counter = self.make_counter(folder)
            with self.assertRaisesRegex(ValueError, "NumPy frame"):
                counter.process(object())


if __name__ == "__main__":
    unittest.main()
