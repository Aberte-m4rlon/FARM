import unittest
import uuid

from event_tracker import GateCrossingTracker


def prediction(center_y: float, animal_type: str = "goat", **extra: object) -> dict:
    return {
        "tracking_id": "17",
        "class": animal_type,
        "confidence": 0.91,
        "bbox": {"y1": center_y - 10, "y2": center_y + 10},
        **extra,
    }


class GateCrossingTrackerTests(unittest.TestCase):
    def test_top_to_bottom_maps_to_entry(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, entry_flow="top-to-bottom")
        tracker.observe([prediction(40)], 100, now=1.0)
        self.assertEqual(tracker.observe([prediction(60)], 100, now=2.0), [])
        events = tracker.observe([prediction(62)], 100, now=2.5)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["direction"], "IN")
        self.assertEqual(events[0]["animal_type"], "goat")
        self.assertTrue(uuid.UUID(events[0]["event_id"]))

    def test_bottom_to_top_maps_to_entry_when_configured(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, entry_flow="bottom-to-top")
        tracker.observe([prediction(60, "sheep")], 100, now=1.0)
        tracker.observe([prediction(40, "sheep")], 100, now=2.0)
        events = tracker.observe([prediction(38, "sheep")], 100, now=2.5)
        self.assertEqual(events[0]["direction"], "IN")
        self.assertEqual(events[0]["animal_type"], "sheep")

    def test_crossing_from_inside_to_outside_is_exit(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, entry_flow="top-to-bottom")
        tracker.observe([prediction(60)], 100, now=1.0)
        tracker.observe([prediction(40)], 100, now=2.0)
        events = tracker.observe([prediction(38)], 100, now=2.5)
        self.assertEqual(events[0]["direction"], "OUT")

    def test_hysteresis_band_does_not_create_jitter_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, hysteresis=0.05)
        tracker.observe([prediction(40)], 100, now=1.0)
        self.assertEqual(tracker.observe([prediction(50)], 100, now=2.0), [])
        self.assertEqual(tracker.observe([prediction(55)], 100, now=2.5), [])
        self.assertEqual(tracker.observe([prediction(56)], 100, now=3.0), [])
        self.assertEqual(len(tracker.observe([prediction(57)], 100, now=3.5)), 1)

    def test_crossing_keeps_only_species_and_temporary_tracking_identity(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(60)], 100, now=2.0)
        event = tracker.observe([prediction(62)], 100, now=2.5)[0]
        self.assertEqual(event["animal_type"], "goat")
        self.assertEqual(event["tracking_id"], "17")
        self.assertNotIn("animal_id", event)
        self.assertNotIn("eartag_number", event)
        self.assertNotIn("public_qr_token", event)

    def test_animal_near_the_line_does_not_count_without_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, hysteresis=0.05)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(50)], 100, now=2.0)
        tracker.observe([prediction(55)], 100, now=2.5)
        self.assertEqual(tracker.observe([prediction(54)], 100, now=3.0), [])

    def test_invalid_gate_configuration_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            GateCrossingTracker(line_y=0.9)
        with self.assertRaises(ValueError):
            GateCrossingTracker(entry_flow="left-to-right")

    def test_duplicate_crossing_is_suppressed_inside_cooldown(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, duplicate_window_seconds=2.0)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(60)], 100, now=2.0)
        first = tracker.observe([prediction(62)], 100, now=2.2)
        self.assertEqual(len(first), 1)
        tracker.observe([prediction(40)], 100, now=2.5)
        tracker.observe([prediction(38)], 100, now=2.7)
        tracker.observe([prediction(60)], 100, now=3.0)
        self.assertEqual(tracker.observe([prediction(62)], 100, now=3.2), [])

    def test_track_can_count_again_after_cooldown(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, duplicate_window_seconds=2.0)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(60)], 100, now=2.0)
        tracker.observe([prediction(62)], 100, now=2.2)
        tracker.observe([prediction(40)], 100, now=2.5)
        self.assertEqual(tracker.observe([prediction(38)], 100, now=4.4)[0]["direction"], "OUT")

    def test_reentry_is_counted_once_after_a_confirmed_exit(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, duplicate_window_seconds=2.0)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(60)], 100, now=2.0)
        first_entry = tracker.observe([prediction(62)], 100, now=2.5)
        self.assertEqual([event["direction"] for event in first_entry], ["IN"])
        tracker.observe([prediction(40)], 100, now=4.5)
        exit_event = tracker.observe([prediction(38)], 100, now=5.0)
        self.assertEqual([event["direction"] for event in exit_event], ["OUT"])
        tracker.observe([prediction(60)], 100, now=6.5)
        reentry = tracker.observe([prediction(62)], 100, now=7.0)
        self.assertEqual([event["direction"] for event in reentry], ["IN"])

    def test_long_gap_rebaselines_track_without_inventing_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, max_gap_seconds=6.0)
        tracker.observe([prediction(40)], 100, now=1.0)
        self.assertEqual(tracker.observe([prediction(60)], 100, now=9.0), [])
        self.assertEqual(tracker.observe([prediction(62)], 100, now=9.5), [])

    def test_two_tracks_are_counted_independently_in_same_frame(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        tracker.observe([prediction(40, tracking_id="17"), prediction(42, tracking_id="18", animal_type="sheep")], 100, now=1.0)
        tracker.observe([prediction(60, tracking_id="17"), prediction(58, tracking_id="18", animal_type="sheep")], 100, now=2.0)
        events = tracker.observe([prediction(62, tracking_id="17"), prediction(56, tracking_id="18", animal_type="sheep")], 100, now=2.5)
        self.assertEqual({event["tracking_id"] for event in events}, {"17", "18"})
        self.assertEqual({event["animal_type"] for event in events}, {"goat", "sheep"})

    def test_detection_without_track_id_cannot_create_event(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        no_id = prediction(40)
        no_id.pop("tracking_id")
        self.assertEqual(tracker.observe([no_id], 100, now=1.0), [])
        self.assertEqual(tracker.observe([prediction(60)], 100, now=2.0), [])
        self.assertEqual(tracker.observe([prediction(62)], 100, now=2.5), [])

    def test_species_change_during_track_does_not_create_crossing(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([prediction(60, "sheep")], 100, now=2.0)
        self.assertEqual(tracker.observe([prediction(62, "sheep")], 100, now=2.5), [])

    def test_expired_track_reappearance_establishes_a_new_side(self) -> None:
        tracker = GateCrossingTracker(line_y=0.5, track_ttl_seconds=2.0)
        tracker.observe([prediction(40)], 100, now=1.0)
        tracker.observe([], 100, now=2.0)
        tracker.observe([], 100, now=4.0)
        tracker.observe([prediction(60)], 100, now=5.0)
        self.assertEqual(tracker.observe([prediction(62)], 100, now=5.5), [])


if __name__ == "__main__":
    unittest.main()
