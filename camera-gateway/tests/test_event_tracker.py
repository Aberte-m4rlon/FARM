import unittest
import uuid

from event_tracker import GateCrossingTracker


def prediction(
    center_y: float,
    animal_type: str = "unknown",
    tracking_id: str = "17",
    center_x: float = 50.0,
    state: str = "ACTIVE",
    **extra: object,
) -> dict:
    return {
        "tracking_id": tracking_id,
        "class": animal_type,
        "animal_type": animal_type,
        "state": state,
        "confidence": 0.91,
        "movement_consistency": 0.9,
        "box_stability": 0.85,
        "bbox": {
            "x1": center_x - 8,
            "x2": center_x + 8,
            "y1": center_y - 10,
            "y2": center_y + 10,
        },
        **extra,
    }


def establish_origin(tracker: GateCrossingTracker, tracking_id: str = "17", now: float = 1.0) -> None:
    tracker.observe([prediction(35, tracking_id=tracking_id)], 100, now=now, frame_width=200)
    tracker.observe([prediction(37, tracking_id=tracking_id)], 100, now=now + 0.5, frame_width=200)


def cross_down(
    tracker: GateCrossingTracker,
    tracking_id: str = "17",
    now: float = 2.0,
) -> list[dict]:
    tracker.observe([prediction(60, tracking_id=tracking_id)], 100, now=now, frame_width=200)
    return tracker.observe(
        [prediction(63, tracking_id=tracking_id)],
        100,
        now=now + 0.5,
        frame_width=200,
    )


class GateCrossingTrackerTests(unittest.TestCase):
    def test_approaching_line_without_crossing_does_not_count(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        tracker.observe([prediction(30)], 100, now=1.0, frame_width=200)
        for index, center_y in enumerate((35, 40, 44, 45, 50, 54), start=1):
            events = tracker.observe(
                [prediction(center_y)],
                100,
                now=1.0 + index * 0.25,
                frame_width=200,
            )
            self.assertEqual(events, [])

    def test_moving_parallel_to_line_does_not_count(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        observations = [
            prediction(35, center_x=center_x)
            for center_x in (40, 55, 70, 85, 100, 115)
        ]
        events = []
        for index, observation in enumerate(observations):
            events.extend(tracker.observe(
                [observation], 100, now=1.0 + index * 0.25, frame_width=200,
            ))
        self.assertEqual(events, [])
        self.assertEqual(tracker._tracks["17"]["side"], "top")

    def test_above_to_below_is_one_entry_with_centroid_evidence(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        establish_origin(tracker)

        events = cross_down(tracker)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["direction"], "IN")
        self.assertEqual(event["event_type"], "ENTRY")
        self.assertEqual(event["crossing_direction"], "top-to-bottom")
        self.assertEqual(event["validation_status"], "confirmed")
        self.assertEqual(event["track_state"], "ACTIVE")
        self.assertEqual(event["animal_type"], "unknown")
        self.assertEqual(event["origin_side"], "top")
        self.assertEqual(event["destination_side"], "bottom")
        self.assertLess(event["previous_centroid"]["y"], 0.5)
        self.assertGreater(event["current_centroid"]["y"], 0.5)
        self.assertTrue(uuid.UUID(event["event_id"]))

    def test_below_to_above_is_exit_not_entry(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        tracker.observe([prediction(65)], 100, now=1.0, frame_width=200)
        tracker.observe([prediction(63)], 100, now=1.5, frame_width=200)
        tracker.observe([prediction(40)], 100, now=2.0, frame_width=200)

        events = tracker.observe([prediction(37)], 100, now=2.5, frame_width=200)

        self.assertEqual([event["direction"] for event in events], ["OUT"])
        self.assertEqual(events[0]["event_type"], "EXIT")
        self.assertEqual(events[0]["crossing_direction"], "bottom-to-top")

    def test_near_line_jitter_without_crossing_does_not_count(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        establish_origin(tracker)
        for index, center_y in enumerate((46, 52, 54, 51, 48, 54, 50), start=1):
            events = tracker.observe(
                [prediction(center_y)],
                100,
                now=2.0 + index * 0.25,
                frame_width=200,
            )
            self.assertEqual(events, [])

    def test_crossing_jitter_does_not_duplicate_entry(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        establish_origin(tracker)
        self.assertEqual(len(cross_down(tracker, now=2.0)), 1)

        jitter = []
        for index, center_y in enumerate((54, 57, 55, 59, 54, 58), start=1):
            jitter.extend(tracker.observe(
                [prediction(center_y)],
                100,
                now=3.0 + index * 0.1,
                frame_width=200,
            ))
        self.assertEqual(jitter, [])

    def test_two_independent_active_tracks_create_two_events(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        for center_y, tracking_id in ((35, "17"), (37, "18")):
            tracker.observe(
                [prediction(center_y, tracking_id=tracking_id)],
                100,
                now=1.0,
                frame_width=200,
            )
        tracker.observe(
            [prediction(37, tracking_id="17"), prediction(39, tracking_id="18")],
            100,
            now=1.5,
            frame_width=200,
        )
        tracker.observe(
            [prediction(60, tracking_id="17"), prediction(62, tracking_id="18")],
            100,
            now=2.0,
            frame_width=200,
        )
        events = tracker.observe(
            [prediction(63, tracking_id="17"), prediction(65, tracking_id="18")],
            100,
            now=2.5,
            frame_width=200,
        )
        self.assertEqual({event["tracking_id"] for event in events}, {"17", "18"})
        self.assertEqual({event["event_type"] for event in events}, {"ENTRY"})

    def test_temporary_loss_and_recovery_inside_does_not_duplicate_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        establish_origin(tracker)
        self.assertEqual(len(cross_down(tracker, now=2.0)), 1)
        tracker.observe([], 100, now=3.0, frame_width=200)
        tracker.observe([prediction(64)], 100, now=4.0, frame_width=200)

        events = tracker.observe([prediction(66)], 100, now=4.5, frame_width=200)

        self.assertEqual(events, [])
        self.assertEqual(tracker._tracks["17"]["state"], "ACTIVE")

    def test_new_inside_track_never_invents_an_entry(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)

        first = tracker.observe([prediction(70)], 100, now=1.0, frame_width=200)
        second = tracker.observe([prediction(72)], 100, now=1.5, frame_width=200)

        self.assertEqual(first, [])
        self.assertEqual(second, [])

    def test_unconfirmed_or_unstable_track_cannot_cross(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        establish_origin(tracker)
        events = tracker.observe(
            [prediction(63, state="CANDIDATE")],
            100,
            now=2.0,
            frame_width=200,
        )
        self.assertEqual(events, [])
        self.assertEqual(tracker.last_diagnostics[-1]["rejection_reason"], "track-not-active")

        unstable = prediction(63, movement_consistency=0.1)
        self.assertEqual(tracker.observe([unstable], 100, now=2.5, frame_width=200), [])
        self.assertEqual(tracker.last_diagnostics[-1]["rejection_reason"], "insufficient-track-stability")

    def test_line_hysteresis_requires_stable_destination_observations(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, hysteresis=0.05)
        establish_origin(tracker)
        self.assertEqual(
            tracker.observe([prediction(55)], 100, now=2.0, frame_width=200),
            [],
        )
        events = tracker.observe([prediction(56)], 100, now=2.5, frame_width=200)
        self.assertEqual(len(events), 1)

    def test_crossing_cooldown_does_not_block_a_later_real_exit(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, duplicate_window_seconds=0.75)
        establish_origin(tracker)
        self.assertEqual(len(cross_down(tracker, now=2.0)), 1)
        tracker.observe([prediction(40)], 100, now=3.0, frame_width=200)
        events = tracker.observe([prediction(37)], 100, now=3.5, frame_width=200)
        self.assertEqual([event["direction"] for event in events], ["OUT"])

    def test_long_gap_rebaselines_without_inventing_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, max_gap_seconds=2.0, track_ttl_seconds=5.0)
        establish_origin(tracker)
        events = tracker.observe([prediction(65)], 100, now=5.0, frame_width=200)
        self.assertEqual(events, [])

    def test_geometry_uses_actual_frame_width_for_centroid(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        first = prediction(35, center_x=170)
        second = prediction(37, center_x=170)
        tracker.observe([first], 100, now=1.0, frame_width=400)
        tracker.observe([second], 100, now=1.5, frame_width=400)
        tracker.observe([prediction(60, center_x=170)], 100, now=2.0, frame_width=400)
        event = tracker.observe(
            [prediction(63, center_x=170)],
            100,
            now=2.5,
            frame_width=400,
        )[0]
        self.assertAlmostEqual(event["current_centroid"]["x"], 0.425)


if __name__ == "__main__":
    unittest.main()
