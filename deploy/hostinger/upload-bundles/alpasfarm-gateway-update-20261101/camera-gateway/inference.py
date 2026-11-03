from __future__ import annotations

import os
import sys
import json
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
from flow_counter import AggregateFlowCounter  # noqa: E402

logger = logging.getLogger("alpasfarm.camera_gateway")

FLOW_STATE_PATH = Path(os.getenv("CAMERA_FLOW_STATE_PATH", str(ROOT / "state" / "camera-flow-counts.json"))).expanduser()
if not FLOW_STATE_PATH.is_absolute():
    FLOW_STATE_PATH = (ROOT / FLOW_STATE_PATH).resolve()


def _load_flow_totals() -> tuple[int, int, int, int, int, int]:
    try:
        value = json.loads(FLOW_STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return 0, 0, 0, 0, 0, 0
        totals = [value.get(key, 0) for key in (
            "entries_total", "exits_total", "goat_entries_total", "goat_exits_total", "sheep_entries_total", "sheep_exits_total",
        )]
        return tuple(
            item if isinstance(item, int) and not isinstance(item, bool) and item >= 0 else 0
            for item in totals
        )
    except FileNotFoundError:
        return 0, 0, 0, 0, 0, 0
    except (OSError, json.JSONDecodeError):
        logger.warning("Could not read the saved aggregate camera flow totals; starting at zero.")
        return 0, 0, 0, 0, 0, 0


def _save_flow_totals(
    entries_total: int,
    exits_total: int,
    goat_entries_total: int,
    goat_exits_total: int,
    sheep_entries_total: int,
    sheep_exits_total: int,
) -> None:
    try:
        FLOW_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = FLOW_STATE_PATH.with_suffix(FLOW_STATE_PATH.suffix + ".tmp")
        temporary_path.write_text(
            json.dumps({
                "entries_total": entries_total,
                "exits_total": exits_total,
                "goat_entries_total": goat_entries_total,
                "goat_exits_total": goat_exits_total,
                "sheep_entries_total": sheep_entries_total,
                "sheep_exits_total": sheep_exits_total,
            }),
            encoding="utf-8",
        )
        temporary_path.replace(FLOW_STATE_PATH)
    except OSError:
        logger.exception("Could not save aggregate camera flow totals; counts remain active until restart.")


class LocalCameraCounter:
    """Count visible livestock and aggregate virtual-line flow without identity details."""

    def __init__(self) -> None:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f"Configured camera counter weights do not exist: {MODEL_PATH}")
        from app.species_detector import load_species_model

        load_species_model()
        totals = _load_flow_totals()
        self.flow_counter = AggregateFlowCounter(
            line_y=float(os.getenv("CAMERA_COUNT_LINE_Y", "0.55")),
            entry_flow=os.getenv("CAMERA_COUNT_ENTRY_FLOW", "top-to-bottom").strip().lower(),
            entries_total=totals[0],
            exits_total=totals[1],
            goat_entries_total=totals[2],
            goat_exits_total=totals[3],
            sheep_entries_total=totals[4],
            sheep_exits_total=totals[5],
        )

    def set_gate_settings(self, line_y: float, entry_flow: str) -> None:
        self.flow_counter.update_settings(line_y=line_y, entry_flow=entry_flow)

    def process(self, frame: Any) -> dict[str, Any]:
        encoded, jpeg = cv2.imencode(".jpg", frame)
        if not encoded:
            raise ValueError("Camera frame could not be encoded for counting.")
        image = decode_image(jpeg.tobytes(), "image/jpeg")
        result = detect(
            image,
            persist_tracking=True,
            device="cpu",
            include_identification=False,
        )
        previous_totals = (
            self.flow_counter.entries_total, self.flow_counter.exits_total,
            self.flow_counter.goat_entries_total, self.flow_counter.goat_exits_total,
            self.flow_counter.sheep_entries_total, self.flow_counter.sheep_exits_total,
        )
        entries_total, exits_total = self.flow_counter.observe(result["predictions"], image.height)
        current_totals = (
            entries_total, exits_total,
            self.flow_counter.goat_entries_total, self.flow_counter.goat_exits_total,
            self.flow_counter.sheep_entries_total, self.flow_counter.sheep_exits_total,
        )
        if current_totals != previous_totals:
            _save_flow_totals(*current_totals)
        return {
            "success": True,
            "animal_count": int(result["counts"]["total"]),
            "entries_total": entries_total,
            "exits_total": exits_total,
            "goat_entries_total": self.flow_counter.goat_entries_total,
            "goat_exits_total": self.flow_counter.goat_exits_total,
            "sheep_entries_total": self.flow_counter.sheep_entries_total,
            "sheep_exits_total": self.flow_counter.sheep_exits_total,
            "model_version": "camera-animal-counter",
            "inference_ms": result["inference_ms"],
            "image": result["image"],
            "predictions": [
                {
                    "class": prediction["class"],
                    "confidence": prediction["confidence"],
                    "bbox": prediction["bbox"],
                    **({"tracking_id": prediction["tracking_id"]} if prediction.get("tracking_id") is not None else {}),
                }
                for prediction in result["predictions"][:50]
                if prediction.get("class") in {"goat", "sheep"}
            ],
        }
