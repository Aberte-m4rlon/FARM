from __future__ import annotations

import os
import sys
import logging
from pathlib import Path
from typing import Any

import cv2


ROOT = Path(__file__).resolve().parent
ML_SERVER_ROOT = (ROOT / ".." / "ml-server").resolve()
DEFAULT_MODEL_PATH = ML_SERVER_ROOT / "models" / "active" / "best.pt"
MODEL_PATH = Path(os.getenv("CAMERA_MODEL_PATH", str(DEFAULT_MODEL_PATH))).expanduser()
if not MODEL_PATH.is_absolute():
    MODEL_PATH = (ROOT / MODEL_PATH).resolve()

os.environ.setdefault("YOLO_SPECIES_MODEL_PATH", str(MODEL_PATH))
os.environ.setdefault("YOLO_MODEL_VERSION", "camera-animal-counter")
sys.path.insert(0, str(ML_SERVER_ROOT))

from app.species_detector import decode_image, detect  # noqa: E402
from crossing_outbox import CrossingOutbox  # noqa: E402
from event_tracker import GateCrossingTracker  # noqa: E402

logger = logging.getLogger("alpasfarm.camera_gateway")

OUTBOX_PATH = Path(os.getenv("CAMERA_CROSSING_OUTBOX_PATH", str(ROOT / "state" / "camera-crossings-outbox.json"))).expanduser()
if not OUTBOX_PATH.is_absolute():
    OUTBOX_PATH = (ROOT / OUTBOX_PATH).resolve()


class LocalCameraCounter:
    """Detect livestock and queue track-based crossings until the database confirms them."""

    def __init__(self) -> None:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f"Configured camera counter weights do not exist: {MODEL_PATH}")
        from app.species_detector import load_species_model

        load_species_model()
        # The persisted backend settings are the only active counting config.
        # Detection may start immediately, but crossings stay disabled until
        # the gateway has fetched the saved line from the backend.
        self.line_y = 0.5
        self.entry_flow = "top-to-bottom"
        self.settings_ready = False
        self.config_revision = 0
        self.counting_session_id: str | None = None
        self.crossing_tracker = GateCrossingTracker(
            line_y=self.line_y,
            entry_flow=self.entry_flow,
        )
        self.outbox = CrossingOutbox(OUTBOX_PATH)

    def set_gate_settings(
        self,
        line_y: float,
        entry_flow: str,
        revision: int = 0,
        session_id: str | None = None,
    ) -> None:
        if isinstance(line_y, bool) or not isinstance(line_y, (int, float)):
            raise ValueError("The saved camera gate line is invalid.")
        if not isinstance(entry_flow, str):
            raise ValueError("The saved camera entry direction is invalid.")
        if entry_flow != "top-to-bottom":
            raise ValueError("Camera entry direction is fixed to top-to-bottom.")
        if not 0.25 <= float(line_y) <= 0.75:
            raise ValueError("The saved camera gate line is outside the supported range.")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("The saved camera settings revision is invalid.")
        if session_id is not None and (not isinstance(session_id, str) or not session_id):
            raise ValueError("The active camera counting session is invalid.")
        updated_line = float(line_y)
        if (updated_line, entry_flow, session_id) != (self.line_y, self.entry_flow, self.counting_session_id):
            # Relearn each track's side after a setting change so moving the
            # line cannot itself invent a crossing.
            self.crossing_tracker = GateCrossingTracker(line_y=updated_line, entry_flow=entry_flow)
            self.line_y = updated_line
            self.entry_flow = entry_flow
            self.counting_session_id = session_id
        self.config_revision = revision
        self.settings_ready = True

    def acknowledge_crossings(self, event_keys: list[str]) -> None:
        self.outbox.acknowledge(event_keys)

    def process(self, frame: Any) -> dict[str, Any]:
        encoded, jpeg = cv2.imencode(".jpg", frame)
        if not encoded:
            raise ValueError("Camera frame could not be encoded for counting.")
        image = decode_image(jpeg.tobytes(), "image/jpeg")
        # Give YOLO the complete decoded frame. The counting line is used only
        # after inference, when the tracker evaluates a movement crossing.
        result = detect(
            image,
            persist_tracking=True,
            device="cpu",
            include_identification=False,
        )
        predictions = [
            prediction for prediction in result["predictions"][:50]
            if prediction.get("class") in {"goat", "sheep"}
        ]
        new_events = self.crossing_tracker.observe(predictions, image.height) if self.settings_ready else []
        if os.getenv("CAMERA_GATEWAY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}:
            inside_side = "bottom" if self.entry_flow == "top-to-bottom" else "top"
            outside_count = 0
            inside_count = 0
            near_line_count = 0
            tracked = []
            for prediction in predictions:
                box = prediction.get("bbox", {})
                try:
                    center_y = (float(box["y1"]) + float(box["y2"])) / (2 * image.height)
                except (KeyError, TypeError, ValueError, ZeroDivisionError):
                    continue
                side = "top" if center_y < self.line_y - 0.035 else (
                    "bottom" if center_y > self.line_y + 0.035 else "line"
                )
                if side == "line":
                    near_line_count += 1
                elif side == inside_side:
                    inside_count += 1
                else:
                    outside_count += 1
                tracking_id = prediction.get("tracking_id")
                if isinstance(tracking_id, str):
                    tracked.append(f"{tracking_id}:{prediction['class']}:{side.upper()}")
            log.info(
                "Full-frame detections: goat=%s sheep=%s tracks=%s outside=%s inside=%s near_line=%s new_crossings=%s.",
                sum(prediction.get("class") == "goat" for prediction in predictions),
                sum(prediction.get("class") == "sheep" for prediction in predictions),
                ",".join(tracked) or "none",
                outside_count,
                inside_count,
                near_line_count,
                len(new_events),
            )
        queued_events: list[dict[str, Any]] = []
        for event in new_events:
            tracker_id = event.get("tracking_id")
            if not isinstance(tracker_id, str) or not tracker_id.isascii() or not tracker_id.isdigit():
                continue
            queued_events.append({
                "session_id": self.counting_session_id,
                "event_key": event["event_id"],
                "tracking_id": f"T-{int(tracker_id):03d}",
                "animal_type": event["animal_type"],
                "direction": "entry" if event["direction"] == "IN" else "exit",
                "confidence": event["confidence"],
                "config_revision": self.config_revision,
            })
        self.outbox.enqueue(queued_events)
        return {
            "success": True,
            "animal_count": int(result["counts"]["total"]),
            "entries_total": 0,
            "exits_total": 0,
            "goat_entries_total": 0,
            "goat_exits_total": 0,
            "sheep_entries_total": 0,
            "sheep_exits_total": 0,
            "model_version": "camera-animal-counter",
            "inference_ms": result["inference_ms"],
            "image": result["image"],
            "config_revision": self.config_revision,
            "crossings": self.outbox.pending(100),
            "predictions": [
                {
                    "class": prediction["class"],
                    "confidence": prediction["confidence"],
                    "bbox": prediction["bbox"],
                    **({"tracking_id": prediction["tracking_id"]} if prediction.get("tracking_id") is not None else {}),
                }
                for prediction in predictions
            ],
        }
