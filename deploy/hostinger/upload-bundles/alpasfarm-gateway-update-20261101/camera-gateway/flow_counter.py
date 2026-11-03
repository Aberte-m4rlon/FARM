from __future__ import annotations

import math
import re
import time
from typing import Any


class AggregateFlowCounter:
    """Count directional gate crossings without retaining animal identity or species."""

    def __init__(
        self,
        *,
        line_y: float = 0.55,
        entry_flow: str = "top-to-bottom",
        hysteresis: float = 0.035,
        max_gap_seconds: float = 6.0,
        duplicate_window_seconds: float = 2.0,
        track_ttl_seconds: float = 20.0,
        entries_total: int = 0,
        exits_total: int = 0,
        goat_entries_total: int = 0,
        goat_exits_total: int = 0,
        sheep_entries_total: int = 0,
        sheep_exits_total: int = 0,
    ) -> None:
        if not 0.25 <= line_y <= 0.75:
            raise ValueError("CAMERA_COUNT_LINE_Y must be between 0.25 and 0.75.")
        if entry_flow not in {"top-to-bottom", "bottom-to-top"}:
            raise ValueError("CAMERA_COUNT_ENTRY_FLOW must be top-to-bottom or bottom-to-top.")
        if not 0.01 <= hysteresis <= 0.1:
            raise ValueError("Camera count line hysteresis must be between 0.01 and 0.1.")
        self.line_y = line_y
        self.entry_flow = entry_flow
        self.hysteresis = hysteresis
        self.max_gap_seconds = max_gap_seconds
        self.duplicate_window_seconds = duplicate_window_seconds
        self.track_ttl_seconds = track_ttl_seconds
        self.entries_total = max(0, int(entries_total))
        self.exits_total = max(0, int(exits_total))
        self.goat_entries_total = max(0, int(goat_entries_total))
        self.goat_exits_total = max(0, int(goat_exits_total))
        self.sheep_entries_total = max(0, int(sheep_entries_total))
        self.sheep_exits_total = max(0, int(sheep_exits_total))
        self._tracks: dict[str, dict[str, Any]] = {}

    def update_settings(self, *, line_y: float, entry_flow: str) -> None:
        if isinstance(line_y, bool) or not isinstance(line_y, (int, float)) or not math.isfinite(line_y) or not 0.25 <= line_y <= 0.75:
            raise ValueError("Camera count line must be between 25% and 75%.")
        if entry_flow not in {"top-to-bottom", "bottom-to-top"}:
            raise ValueError("Camera count direction must be top-to-bottom or bottom-to-top.")
        if self.line_y == float(line_y) and self.entry_flow == entry_flow:
            return
        self.line_y = float(line_y)
        self.entry_flow = entry_flow
        # Relearn which side existing tracks are on after moving the line so a
        # setting change cannot create a phantom crossing.
        self._tracks.clear()

    def observe(
        self,
        detections: list[dict[str, Any]],
        frame_height: int,
        now: float | None = None,
    ) -> tuple[int, int]:
        if frame_height <= 0:
            return self.entries_total, self.exits_total

        observed_at = time.monotonic() if now is None else now
        current_ids: set[str] = set()
        for prediction in detections:
            if not isinstance(prediction, dict):
                continue
            tracking_id = prediction.get("tracking_id")
            box = prediction.get("bbox")
            if (
                not isinstance(tracking_id, str)
                or not re.fullmatch(r"\d{1,12}", tracking_id)
                or not isinstance(box, dict)
                or not all(isinstance(box.get(key), (int, float)) for key in ("y1", "y2"))
            ):
                continue

            y1 = float(box["y1"])
            y2 = float(box["y2"])
            if not math.isfinite(y1) or not math.isfinite(y2) or y2 < y1:
                continue

            current_ids.add(tracking_id)
            species = prediction.get("class") if prediction.get("class") in {"goat", "sheep"} else None
            center_y = ((y1 + y2) / 2) / frame_height
            side = "top" if center_y < self.line_y - self.hysteresis else (
                "bottom" if center_y > self.line_y + self.hysteresis else None
            )
            previous = self._tracks.get(tracking_id)

            if previous is None:
                if side is not None:
                    self._tracks[tracking_id] = {
                        "side": side,
                        "last_seen": observed_at,
                        "last_crossing": float("-inf"),
                        "species": species,
                    }
                continue

            if side is not None and previous["side"] != side:
                gap = observed_at - previous["last_seen"]
                since_crossing = observed_at - previous["last_crossing"]
                if gap <= self.max_gap_seconds and since_crossing >= self.duplicate_window_seconds:
                    top_to_bottom = previous["side"] == "top" and side == "bottom"
                    enters = top_to_bottom == (self.entry_flow == "top-to-bottom")
                    if enters:
                        self.entries_total += 1
                        if species == "goat" or previous.get("species") == "goat":
                            self.goat_entries_total += 1
                        elif species == "sheep" or previous.get("species") == "sheep":
                            self.sheep_entries_total += 1
                    else:
                        self.exits_total += 1
                        if species == "goat" or previous.get("species") == "goat":
                            self.goat_exits_total += 1
                        elif species == "sheep" or previous.get("species") == "sheep":
                            self.sheep_exits_total += 1
                    previous["last_crossing"] = observed_at
                previous["side"] = side

            previous["last_seen"] = observed_at
            if species:
                previous["species"] = species

        self._tracks = {
            tracking_id: state for tracking_id, state in self._tracks.items()
            if tracking_id in current_ids or observed_at - state["last_seen"] <= self.track_ttl_seconds
        }
        return self.entries_total, self.exits_total
