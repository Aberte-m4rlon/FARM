import unittest

from motion_tracker import MotionTrackerConfig, SignificantMotionTracker


class SignificantMotionTrackerTests(unittest.TestCase):
    def make_tracker(self, **overrides: object) -> SignificantMotionTracker:
        settings = {
            "min_displacement_px": 3.0,
            "min_accumulated_movement_px": 18.0,
            "min_movement_duration_seconds": 1.0,
            "confirmation_frames": 4,
            "max_tracking_distance_px": 80.0,
            "min_motion_consistency": 0.5,
            "min_box_stability": 0.1,
            "box_smoothing": 1.0,
            "lost_track_timeout_seconds": 3.0,
            "stationary_grace_seconds": 1.0,
        }
        settings.update(overrides)
        return SignificantMotionTracker(MotionTrackerConfig(**settings))

    @staticmethod
    def box(x: float, y: float = 100.0) -> tuple[float, float, float, float]:
        return (x, y, x + 70, y + 60)

    def test_pixel_jitter_does_not_promote_a_track(self) -> None:
        tracker = self.make_tracker()
        active = []
        for index, x in enumerate((100, 101, 100, 102, 101, 100, 102, 101)):
            update = tracker.update([self.box(x)], index * 0.5)
            active.extend(update.active)
        self.assertEqual(active, [])

    def test_hybrid_track_requires_two_model_observations_and_keeps_species(self) -> None:
        tracker = self.make_tracker()
        box = (100.0, 100.0, 170.0, 160.0)
        first = tracker.update(
            [box],
            1.0,
            detector_observations={0: {"class": "goat", "confidence": 0.91}},
            detector_at=1.0,
        )
        self.assertEqual(first.displayed, ())
        second = tracker.update(
            [box],
            2.0,
            detector_observations={0: {"class": "goat", "confidence": 0.94}},
            detector_at=2.0,
        )
        self.assertEqual(len(second.newly_active), 1)
        self.assertEqual(second.newly_active[0].tracking_id, "1")
        self.assertEqual(second.newly_active[0].species, "goat")
        self.assertEqual(second.newly_active[0].confidence, 0.94)
        paused = tracker.update([box], 2.5)
        self.assertEqual(paused.displayed[0].tracking_id, "1")
        self.assertEqual(paused.displayed[0].species, "goat")
        self.assertIsNotNone(tracker._tracks["1"].kalman)

    def test_hybrid_motion_alone_cannot_confirm_a_one_frame_model_candidate(self) -> None:
        tracker = self.make_tracker()
        tracker.update(
            [self.box(100)], 0.0,
            detector_observations={0: {"class": "sheep", "confidence": 0.9}},
            detector_at=0.0,
            require_detector_confirmation=True,
        )
        for index, x in enumerate((108, 116, 124, 132), start=1):
            update = tracker.update([self.box(x)], index * 0.5, require_detector_confirmation=True)
        self.assertEqual(update.displayed, ())
        confirmed = tracker.update(
            [self.box(140)], 2.5,
            detector_observations={0: {"class": "sheep", "confidence": 0.93}},
            detector_at=2.5,
            require_detector_confirmation=True,
        )
        self.assertEqual(len(confirmed.newly_active), 1)
        self.assertEqual(confirmed.newly_active[0].species, "sheep")

    def test_subthreshold_pixel_jitter_is_rejected_with_sensitive_defaults(self) -> None:
        tracker = SignificantMotionTracker(MotionTrackerConfig())
        active = []
        positions = (100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100)
        for index, x in enumerate(positions):
            update = tracker.update([self.box(x)], index * 0.1)
            active.extend(update.active)
        self.assertEqual(active, [])

    def test_inconsistent_direction_does_not_promote_a_track(self) -> None:
        tracker = self.make_tracker()
        active = []
        for index, x in enumerate((100, 110, 100, 110, 100, 110, 100, 110)):
            update = tracker.update([self.box(x)], index * 0.5)
            active.extend(update.active)
        self.assertEqual(active, [])

    def test_unstable_box_size_does_not_promote_a_track(self) -> None:
        tracker = self.make_tracker(min_box_stability=0.35)
        active = []
        for index in range(10):
            center_x = 150 + index * 8
            width = 30 if index % 2 else 100
            update = tracker.update(
                [(center_x - width / 2, 100, center_x + width / 2, 160)],
                index * 0.5,
            )
            active.extend(update.active)
        self.assertEqual(active, [])

    def test_sustained_consistent_displacement_promotes_to_active(self) -> None:
        tracker = self.make_tracker()
        activated = None
        for index in range(6):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
            if update.newly_active:
                activated = update.newly_active[0]
        self.assertIsNotNone(activated)
        self.assertEqual(activated.tracking_id, "1")
        self.assertGreaterEqual(len(activated.history), 4)
        self.assertTrue(update.active)

    def test_small_slow_motion_promotes_in_horizontal_vertical_and_diagonal_directions(self) -> None:
        trajectories = (
            [(100 + step * 2, 100) for step in range(10)],
            [(100, 100 + step * 2) for step in range(10)],
            [(100 + step * 2, 100 + step * 2) for step in range(10)],
            [(100 - step * 2, 100 + step * 2) for step in range(10)],
            [(100, 100), (102, 101), (103, 100), (105, 102), (106, 101),
             (108, 103), (109, 102), (111, 104), (112, 103), (114, 105)],
        )
        for trajectory in trajectories:
            with self.subTest(trajectory=trajectory[-1]):
                tracker = self.make_tracker(
                    min_displacement_px=1.25,
                    min_accumulated_movement_px=8.0,
                    min_movement_duration_seconds=0.65,
                    confirmation_frames=3,
                    min_motion_consistency=0.15,
                )
                activated = []
                for index, (x, y) in enumerate(trajectory):
                    update = tracker.update([self.box(x, y)], index * 0.1)
                    activated.extend(update.newly_active)
                self.assertEqual(len(activated), 1)
                self.assertEqual(activated[0].tracking_id, "1")

    def test_brief_stationary_pause_keeps_box_and_recovers_same_track_id(self) -> None:
        tracker = self.make_tracker(stationary_grace_seconds=2.5)
        activated = []
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
            activated.extend(update.newly_active)
        self.assertEqual(len(activated), 1)
        tracking_id = activated[0].tracking_id

        paused = tracker.update([self.box(100 + 7 * 8)], 4.0)
        self.assertEqual(paused.displayed[0].state, "TEMPORARILY_STATIONARY")
        self.assertEqual(paused.active, ())
        still_paused = tracker.update([self.box(100 + 7 * 8)], 5.0)
        self.assertEqual(still_paused.displayed[0].tracking_id, tracking_id)

        resumed = tracker.update([self.box(100 + 8 * 8)], 5.5)
        self.assertEqual(resumed.active[0].tracking_id, tracking_id)
        self.assertEqual(resumed.newly_active, ())

    def test_confirmed_track_keeps_its_box_after_stationary_grace(self) -> None:
        tracker = self.make_tracker()
        activation_time = None
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
            if update.newly_active:
                activation_time = index * 0.5
        self.assertIsNotNone(activation_time)
        self.assertTrue(update.displayed)

        tracking_id = update.displayed[0].tracking_id
        held_box = update.displayed[0].bbox
        for now in (4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0):
            update = tracker.update([self.box(100 + 7 * 8)], now)
        self.assertEqual(update.displayed[0].tracking_id, tracking_id)
        self.assertEqual(update.displayed[0].bbox, held_box)
        self.assertEqual(update.displayed[0].state, "TEMPORARILY_STATIONARY")
        self.assertEqual(update.diagnostics["states"]["TEMPORARILY_STATIONARY"], 1)

    def test_nearby_animals_keep_separate_tracking_ids(self) -> None:
        tracker = self.make_tracker(max_tracking_distance_px=70.0)
        for index in range(7):
            boxes = [
                self.box(100 + index * 8),
                self.box(250 + index * 8),
            ]
            update = tracker.update(boxes, index * 0.5)
        self.assertEqual(
            {track.tracking_id for track in update.active},
            {"1", "2"},
        )

    def test_global_assignment_preserves_ids_when_two_tracks_pass_each_other(self) -> None:
        tracker = self.make_tracker(max_tracking_distance_px=90.0)
        update = None
        for index in range(5):
            first_x = 100 + index * 40
            second_x = 300 - index * 40
            boxes = [self.box(first_x), self.box(second_x)]
            if index >= 3:
                boxes.reverse()
            update = tracker.update(boxes, index * 0.4)
        self.assertIsNotNone(update)
        tracks = {item["tracking_id"]: item for item in update.diagnostics["tracks"]}
        self.assertGreater(tracks["1"]["bbox"][0], tracks["2"]["bbox"][0])
        self.assertEqual(len(tracks), 2)

    def test_gate_queue_prioritizes_leader_and_keeps_opposite_direction_separate(self) -> None:
        tracker = self.make_tracker()
        update = None
        for index in range(8):
            leader_y = min(140 + index * 8, 180)
            boxes = [
                (100.0, 50.0 + index * 5, 170.0, 110.0 + index * 5),
                (260.0, leader_y, 330.0, leader_y + 60.0),
                (430.0, 300.0 - index * 8, 500.0, 360.0 - index * 8),
            ]
            update = tracker.update(
                boxes, index * 0.3, frame_height=400, gate_line_y=0.55,
                entry_flow="top-to-bottom",
            )
        self.assertIsNotNone(update)
        tracks = {item["tracking_id"]: item for item in update.diagnostics["tracks"]}
        self.assertEqual(tracks["2"]["queue_direction"], "ENTRY")
        self.assertEqual(tracks["2"]["queue_position"], 1)
        self.assertTrue(tracks["2"]["priority"])
        self.assertEqual(tracks["1"]["queue_position"], 2)
        self.assertEqual(tracks["3"]["queue_direction"], "EXIT")
        self.assertEqual(tracks["3"]["queue_position"], 1)

    def test_ambiguous_merged_motion_never_becomes_countable_observation(self) -> None:
        tracker = self.make_tracker()
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        tracking_id = update.displayed[0].tracking_id
        ambiguous = tracker.update(
            [], 4.0, frame_height=400, gate_line_y=0.55,
            ambiguous_track_ids={tracking_id},
        )
        self.assertEqual(ambiguous.displayed[0].state, "AMBIGUOUS")
        self.assertFalse(ambiguous.displayed[0].observed)
        self.assertTrue(ambiguous.displayed[0].identity_uncertain)
        self.assertEqual(ambiguous.active, ())

    def test_optical_flow_hint_reacquires_the_same_track_identity(self) -> None:
        tracker = self.make_tracker()
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        tracking_id = update.displayed[0].tracking_id
        tracker.update([], 4.0, ambiguous_track_ids={tracking_id})
        reacquired = tracker.update(
            [self.box(100 + 7 * 8)], 4.5,
            track_id_hints={0: tracking_id},
        )
        self.assertEqual(reacquired.displayed[0].tracking_id, tracking_id)
        self.assertEqual(reacquired.displayed[0].state, "REACQUIRED")
        self.assertTrue(reacquired.displayed[0].observed)

    def test_separated_contour_reacquires_ambiguous_track_without_new_id(self) -> None:
        tracker = self.make_tracker()
        for index in range(8):
            update = tracker.update(
                [self.box(100 + index * 8), self.box(300 + index * 8)], index * 0.5,
            )
        tracker.update([], 4.0, ambiguous_track_ids={"1", "2"})
        reacquired = tracker.update(
            [self.box(100 + 7 * 8), self.box(300 + 7 * 8)], 4.5,
        )
        self.assertEqual({item.tracking_id for item in reacquired.displayed}, {"1", "2"})
        self.assertEqual(len(tracker._tracks), 2)
        self.assertTrue(all(item.state == "REACQUIRED" for item in reacquired.displayed))

    def test_lost_tracks_expire_after_configured_timeout(self) -> None:
        tracker = self.make_tracker(candidate_timeout_seconds=1.0)
        tracker.update([self.box(100)], 0.0)
        update = tracker.update([], 1.1)
        self.assertEqual(update.diagnostics["states"]["DETECTED"], 0)
        self.assertEqual(update.diagnostics["recently_expired"], 1)

    def test_box_smoothing_adapts_to_speed_and_keeps_fast_boxes_near_observations(self) -> None:
        tracker = self.make_tracker(
            box_smoothing=0.5,
            max_box_smoothing=0.95,
            slow_velocity_px_s=10.0,
            fast_velocity_px_s=100.0,
        )
        tracker.update([self.box(100)], 0.0)
        slow = tracker.update([self.box(102)], 1.0)
        self.assertAlmostEqual(slow.diagnostics["tracks"][0]["box_smoothing"], 0.5)

        fast = tracker.update([self.box(162)], 1.1)
        track = fast.diagnostics["tracks"][0]
        self.assertGreater(track["box_smoothing"], 0.9)
        self.assertLess(track["bbox_lag_px"], 10.0)
        self.assertGreater(track["speed_px_s"], 100.0)

    def test_fast_association_uses_velocity_prediction_beyond_static_distance(self) -> None:
        tracker = self.make_tracker(
            max_tracking_distance_px=60.0,
            max_adaptive_distance_multiplier=2.5,
            slow_velocity_px_s=10.0,
            fast_velocity_px_s=100.0,
        )
        tracker.update([self.box(100)], 0.0)
        tracker.update([self.box(140)], 0.2)
        tracker.update([self.box(180)], 0.4)
        update = tracker.update([self.box(280)], 0.6)

        self.assertEqual(update.diagnostics["states"]["DETECTED"], 1)
        self.assertEqual(len(update.diagnostics["tracks"]), 1)
        self.assertEqual(update.diagnostics["tracks"][0]["tracking_id"], "1")
        self.assertGreater(update.diagnostics["tracks"][0]["velocity_x_px_s"], 0.0)

    def test_sharp_direction_change_gets_responsive_box_update(self) -> None:
        tracker = self.make_tracker(
            box_smoothing=0.5,
            max_box_smoothing=0.95,
            max_tracking_distance_px=60.0,
            slow_velocity_px_s=10.0,
            fast_velocity_px_s=100.0,
        )
        tracker.update([self.box(100)], 0.0)
        tracker.update([self.box(140)], 0.2)
        update = tracker.update([self.box(100)], 0.4)

        track = update.diagnostics["tracks"][0]
        self.assertEqual(track["tracking_id"], "1")
        self.assertGreater(track["box_smoothing"], 0.9)
        self.assertLess(track["bbox_lag_px"], 10.0)
        self.assertLess(track["velocity_x_px_s"], 0.0)

    def test_missing_detection_uses_only_limited_prediction_then_expires(self) -> None:
        tracker = self.make_tracker(lost_track_timeout_seconds=2.0, occlusion_grace_seconds=1.0)
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        held_box = update.displayed[0].bbox

        paused = tracker.update([], 4.0)
        self.assertFalse(paused.displayed[0].observed)
        self.assertEqual(paused.displayed[0].state, "TEMPORARILY_OCCLUDED")
        self.assertLessEqual(
            abs(paused.displayed[0].bbox[0] - held_box[0]),
            tracker.config.prediction_max_displacement_px,
        )
        stale = tracker.update([], 5.2)
        self.assertEqual(stale.displayed, ())
        self.assertEqual(stale.diagnostics["states"]["LOST"], 1)
        expired = tracker.update([], 5.5)
        self.assertEqual(expired.displayed, ())

    def test_reacquires_same_identity_after_brief_occlusion(self) -> None:
        tracker = self.make_tracker(lost_track_timeout_seconds=5.0, occlusion_grace_seconds=1.0)
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        self.assertEqual(update.displayed[0].tracking_id, "1")

        missing = tracker.update([], 4.0)
        self.assertEqual(missing.displayed[0].state, "TEMPORARILY_OCCLUDED")
        self.assertFalse(missing.displayed[0].observed)

        reacquired = tracker.update([self.box(100 + 7 * 8)], 4.5)
        self.assertEqual(reacquired.displayed[0].tracking_id, "1")
        self.assertTrue(reacquired.displayed[0].observed)
        self.assertEqual(reacquired.newly_active, ())

    def test_unreacquired_confirmed_track_becomes_lost_then_expires(self) -> None:
        tracker = self.make_tracker(
            lost_track_timeout_seconds=5.0,
            occlusion_grace_seconds=1.0,
        )
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        tracking_id = update.displayed[0].tracking_id

        lost = tracker.update([], 5.0)
        self.assertEqual(lost.displayed, ())
        self.assertEqual(lost.diagnostics["states"]["LOST"], 1)
        expired = tracker.update([], 8.6)
        self.assertEqual(expired.diagnostics["states"]["LOST"], 0)
        self.assertEqual(expired.diagnostics["states"]["EXPIRED"], 1)
        self.assertEqual(expired.diagnostics["recently_expired"], 1)
        self.assertTrue(expired.diagnostics["recently_expired_tracks"][0]["final_location_uncertain"])
        self.assertNotIn(tracking_id, tracker._tracks)

    def test_waiting_near_line_is_displayed_and_resumes_same_id(self) -> None:
        tracker = self.make_tracker()
        states = []
        for index in range(8):
            update = tracker.update(
                [self.box(100, 220 + index * 8)],
                index * 0.5,
                frame_height=540,
                gate_line_y=0.55,
            )
            states.extend(observation.state for observation in update.displayed)
        self.assertIn("APPROACHING_GATE", states)
        tracking_id = update.displayed[0].tracking_id
        waiting_box = self.box(100, 276)
        waiting = tracker.update([waiting_box], 4.0, frame_height=540, gate_line_y=0.55)
        self.assertEqual(waiting.displayed[0].state, "WAITING")
        self.assertEqual(waiting.displayed[0].tracking_id, tracking_id)

        resumed = tracker.update(
            [self.box(100, 284)], 4.5, frame_height=540, gate_line_y=0.55,
        )
        self.assertEqual(resumed.displayed[0].tracking_id, tracking_id)
        self.assertNotIn(resumed.displayed[0].state, {"DETECTED", "LOST"})

    def test_crossing_state_does_not_delete_visible_track(self) -> None:
        tracker = self.make_tracker()
        for index in range(8):
            update = tracker.update([self.box(100 + index * 8)], index * 0.5)
        self.assertTrue(tracker.mark_crossed(update.displayed[0].tracking_id, "ENTRY"))

        after_crossing = tracker.update([self.box(100 + 7 * 8)], 4.0)
        self.assertEqual(after_crossing.displayed[0].tracking_id, "1")
        self.assertEqual(after_crossing.displayed[0].state, "CROSSED_ENTRY")


if __name__ == "__main__":
    unittest.main()
