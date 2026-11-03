import json
import tempfile
import unittest
import uuid
from pathlib import Path

from crossing_outbox import CrossingOutbox


def event(event_key: str | None = None) -> dict[str, object]:
    return {
        "session_id": None,
        "event_key": event_key or str(uuid.uuid4()),
        "tracking_id": "T-017",
        "animal_type": "goat",
        "direction": "entry",
        "confidence": 0.91,
        "config_revision": 4,
    }


class CrossingOutboxTests(unittest.TestCase):
    def test_enqueued_crossing_is_durable_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state" / "pending.json"
            item = event()
            CrossingOutbox(path).enqueue([item])
            restarted = CrossingOutbox(path)
            self.assertEqual(restarted.pending(), [item])

    def test_repeated_enqueue_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = CrossingOutbox(Path(directory) / "pending.json")
            item = event()
            queue.enqueue([item])
            queue.enqueue([item])
            self.assertEqual(len(queue), 1)

    def test_acknowledgement_removes_only_confirmed_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pending.json"
            queue = CrossingOutbox(path)
            first, second = event(), event()
            queue.enqueue([first, second])
            queue.acknowledge([first["event_key"]])
            self.assertEqual(queue.pending(), [second])
            self.assertEqual(CrossingOutbox(path).pending(), [second])

    def test_unknown_acknowledgement_does_not_change_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = CrossingOutbox(Path(directory) / "pending.json")
            item = event()
            queue.enqueue([item])
            queue.acknowledge([str(uuid.uuid4())])
            self.assertEqual(queue.pending(), [item])

    def test_pending_batch_respects_limit_and_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = CrossingOutbox(Path(directory) / "pending.json")
            items = [event() for _ in range(4)]
            queue.enqueue(items)
            self.assertEqual(queue.pending(2), items[:2])

    def test_full_queue_refuses_to_drop_crossings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = CrossingOutbox(Path(directory) / "pending.json", max_items=1)
            queue.enqueue([event()])
            with self.assertRaises(OverflowError):
                queue.enqueue([event()])
            self.assertEqual(len(queue), 1)

    def test_corrupt_outbox_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pending.json"
            path.write_text("not-json", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                CrossingOutbox(path)

    def test_saved_file_is_valid_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pending.json"
            queue = CrossingOutbox(path)
            queue.enqueue([event()])
            self.assertIsInstance(json.loads(path.read_text(encoding="utf-8")), list)

    def test_legacy_pending_events_are_rewritten_without_identity_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pending.json"
            key = str(uuid.uuid4())
            path.write_text(json.dumps([{
                "session_id": None,
                "event_key": key,
                "tracking_id": "T-017",
                "species_detected": "goat",
                "direction": "entry",
                "confidence": 0.91,
                "movement_observation": "normal",
                "config_revision": 4,
                "eartag_number": "25",
                "eartag_confidence": 0.99,
            }]), encoding="utf-8")

            queued = CrossingOutbox(path).pending()

            self.assertEqual(queued, [{
                "session_id": None,
                "event_key": key,
                "tracking_id": "T-017",
                "animal_type": "goat",
                "direction": "entry",
                "confidence": 0.91,
                "config_revision": 4,
            }])
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotIn("eartag_number", saved[0])
            self.assertNotIn("eartag_confidence", saved[0])


if __name__ == "__main__":
    unittest.main()
