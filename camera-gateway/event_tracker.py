from __future__ import annotations

import re
import time
import uuid
from typing import Any


class GateCrossingTracker:
    """Converts sustained ByteTrack center-line crossings into directional events."""

    def __init__(
        self,
        line_y: float = 0.55,
        entry_flow: str = "top-to-bottom",
        hysteresis: float = 0.035,
        max_gap_seconds: float = 6.0,
        duplicate_window_seconds: float = 2.0,
        track_ttl_seconds: float = 20.0,
    ) -> None:
        if not 0.25 <= line_y <= 0.75:
            raise ValueError("GATE_LINE_Y must be between 0.25 and 0.75.")
        if entry_flow not in {"top-to-bottom", "bottom-to-top"}:
            raise ValueError("GATE_ENTRY_FLOW must be top-to-bottom or bottom-to-top.")
        if not 0.01 <= hysteresis <= 0.1:
            raise ValueError("Gate crossing hysteresis must be between 0.01 and 0.1.")
        self.line_y = line_y
        self.entry_flow = entry_flow
        self.hysteresis = hysteresis
        self.max_gap_seconds = max_gap_seconds
        self.duplicate_window_seconds = duplicate_window_seconds
        self.track_ttl_seconds = track_ttl_seconds
        self._tracks: dict[str, dict[str, Any]] = {}

    def observe(
        self,
        detections: list[dict[str, Any]],
        frame_height: int,
        now: float | None = None,
    ) -> list[dict[str, Any]]:
        if frame_height <= 0:
            return []
        observed_at = time.monotonic() if now is None else now
        current_ids: set[str] = set()
        crossings: list[dict[str, Any]] = []

        for prediction in detections:
            if not isinstance(prediction, dict):
                continue
            tracking_id = prediction.get("tracking_id")
            animal_type = prediction.get("class")
            box = prediction.get("bbox")
            if (
                not isinstance(tracking_id, str)
                or not re.fullmatch(r"\d{1,12}", tracking_id)
                or animal_type not in {"goat", "sheep"}
                or not isinstance(box, dict)
                or not all(isinstance(box.get(key), (int, float)) for key in ("y1", "y2"))
            ):
                continue

            current_ids.add(tracking_id)
            center_y = ((float(box["y1"]) + float(box["y2"])) / 2) / frame_height
            side = "top" if center_y < self.line_y - self.hysteresis else (
                "bottom" if center_y > self.line_y + self.hysteresis else None
            )
            previous = self._tracks.get(tracking_id)
            confidence = prediction.get("confidence")
            if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
                confidence = 0.0

            if side is not None and previous and previous["side"] != side:
                if observed_at - previous["last_seen"] > self.max_gap_seconds:
                    previous["side"] = side
                    previous["candidate_side"] = side
                    previous["candidate_hits"] = 0
                    previous["animal_type"] = animal_type
                    previous["last_seen"] = observed_at
                    continue
                if previous.get("candidate_side") == side:
                    previous["candidate_hits"] = int(previous.get("candidate_hits", 0)) + 1
                else:
                    previous["candidate_side"] = side
                    previous["candidate_hits"] = 1
                if previous["candidate_hits"] >= 2:
                    gap = observed_at - previous["last_seen"]
                    same_species = previous["animal_type"] == animal_type
                    last_event_at = previous.get("last_event_at", float("-inf"))
                    if gap <= self.max_gap_seconds and same_species and observed_at - last_event_at >= self.duplicate_window_seconds:
                        top_to_bottom = previous["side"] == "top" and side == "bottom"
                        enters = top_to_bottom == (self.entry_flow == "top-to-bottom")
                        event: dict[str, Any] = {
                            "event_id": str(uuid.uuid4()),
                            "event_type": "crossing",
                            "gateway_id": "ALPASFARM-GATEWAY-01",
                            "camera_id": "C320WS-01",
                            "animal_type": animal_type,
                            "direction": "IN" if enters else "OUT",
                            "confidence": round(float(confidence), 4),
                            "tracking_id": tracking_id,
                        }
                        crossings.append(event)
                        previous["last_event_at"] = observed_at
                    previous["side"] = side
                    previous["animal_type"] = animal_type
                    previous["candidate_side"] = side
                    previous["candidate_hits"] = 0
            elif previous and side is None:
                # Hysteresis band: retain the last stable side so box jitter at
                # the crossing line cannot invent an IN/OUT event.
                previous["candidate_side"] = None
                previous["candidate_hits"] = 0
            elif side is not None:
                self._tracks[tracking_id] = {
                    "side": side,
                    "animal_type": animal_type,
                    "last_seen": observed_at,
                    "last_event_at": previous.get("last_event_at", float("-inf")) if previous else float("-inf"),
                    "candidate_side": side,
                    "candidate_hits": 0,
                }

            current = self._tracks.get(tracking_id)
            if current:
                current["last_seen"] = observed_at

        self._tracks = {
            tracking_id: state for tracking_id, state in self._tracks.items()
            if tracking_id in current_ids or observed_at - state["last_seen"] <= self.track_ttl_seconds
        }
        return crossings
