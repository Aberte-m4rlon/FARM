from __future__ import annotations

import math
import re
import time
import uuid
from collections import deque
from typing import Any


class GateCrossingTracker:
    """Confirm directional crossings from stable, active centroid tracks."""

    def __init__(
        self,
        line_y: float = 0.55,
        entry_flow: str = "top-to-bottom",
        hysteresis: float = 0.03,
        max_gap_seconds: float = 6.0,
        duplicate_window_seconds: float = 0.75,
        track_ttl_seconds: float = 20.0,
        min_origin_hits: int = 2,
        min_candidate_hits: int = 2,
        min_displacement_px: float = 16.0,
        min_motion_consistency: float = 0.55,
        min_box_stability: float = 0.12,
    ) -> None:
        if not math.isfinite(line_y) or not 0.25 <= line_y <= 0.75:
            raise ValueError("GATE_LINE_Y must be between 0.25 and 0.75.")
        if entry_flow not in {"top-to-bottom", "bottom-to-top"}:
            raise ValueError("GATE_ENTRY_FLOW must be top-to-bottom or bottom-to-top.")
        if not math.isfinite(hysteresis) or not 0.01 <= hysteresis <= 0.15:
            raise ValueError("Gate crossing hysteresis must be between 0.01 and 0.15.")
        if max_gap_seconds <= 0 or track_ttl_seconds <= max_gap_seconds:
            raise ValueError("Track recovery timeout must exceed the maximum crossing gap.")
        if duplicate_window_seconds < 0 or min_displacement_px <= 0:
            raise ValueError("Crossing cooldown and minimum displacement must be non-negative.")
        if min_origin_hits < 1 or min_candidate_hits < 2:
            raise ValueError("Crossing confirmation requires stable observations on both sides.")
        if not 0 <= min_motion_consistency <= 1 or not 0 <= min_box_stability <= 1:
            raise ValueError("Track stability thresholds must be between 0 and 1.")

        self.line_y = line_y
        self.entry_flow = entry_flow
        self.hysteresis = hysteresis
        self.max_gap_seconds = max_gap_seconds
        self.duplicate_window_seconds = duplicate_window_seconds
        self.track_ttl_seconds = track_ttl_seconds
        self.min_origin_hits = min_origin_hits
        self.min_candidate_hits = min_candidate_hits
        self.min_displacement_px = min_displacement_px
        self.min_motion_consistency = min_motion_consistency
        self.min_box_stability = min_box_stability
        self._tracks: dict[str, dict[str, Any]] = {}
        self.last_diagnostics: list[dict[str, Any]] = []

    def _side(self, y: float) -> str | None:
        if y <= self.line_y - self.hysteresis:
            return "top"
        if y >= self.line_y + self.hysteresis:
            return "bottom"
        return None

    @staticmethod
    def _centroid(
        box: dict[str, Any],
        frame_width: int,
        frame_height: int,
    ) -> tuple[float, float] | None:
        coordinates = tuple(box.get(key) for key in ("x1", "y1", "x2", "y2"))
        if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in coordinates):
            return None
        x1, y1, x2, y2 = (float(value) for value in coordinates)
        if x2 <= x1 or y2 <= y1:
            return None
        return ((x1 + x2) / (2 * frame_width), (y1 + y2) / (2 * frame_height))

    def _reject(self, tracking_id: str | None, reason: str) -> None:
        self.last_diagnostics.append({
            "tracking_id": tracking_id,
            "rejection_reason": reason,
        })

    def observe(
        self,
        detections: list[dict[str, Any]],
        frame_height: int,
        now: float | None = None,
        frame_width: int | None = None,
    ) -> list[dict[str, Any]]:
        if frame_height <= 0:
            self.last_diagnostics = []
            return []
        width = frame_width if isinstance(frame_width, int) and frame_width > 0 else round(frame_height * 16 / 9)
        observed_at = time.monotonic() if now is None else now
        current_ids: set[str] = set()
        crossings: list[dict[str, Any]] = []
        self.last_diagnostics = []

        for prediction in detections:
            if not isinstance(prediction, dict):
                self._reject(None, "invalid-observation")
                continue
            tracking_id = prediction.get("tracking_id")
            if not isinstance(tracking_id, str) or not re.fullmatch(r"\d{1,12}", tracking_id):
                self._reject(None, "missing-or-invalid-tracking-id")
                continue
            if prediction.get("state") != "ACTIVE":
                self._reject(tracking_id, "track-not-active")
                continue

            animal_type = prediction.get("animal_type", prediction.get("class"))
            if animal_type not in {"goat", "sheep", "unknown"}:
                self._reject(tracking_id, "invalid-motion-class")
                continue
            box = prediction.get("bbox")
            centroid = self._centroid(box, width, frame_height) if isinstance(box, dict) else None
            if centroid is None:
                self._reject(tracking_id, "invalid-bounding-box")
                continue

            confidence = prediction.get("confidence")
            consistency = prediction.get("movement_consistency", confidence)
            stability = prediction.get("box_stability", 1.0)
            if (
                not isinstance(consistency, (int, float))
                or not math.isfinite(consistency)
                or consistency < self.min_motion_consistency
                or not isinstance(stability, (int, float))
                or not math.isfinite(stability)
                or stability < self.min_box_stability
            ):
                self._reject(tracking_id, "insufficient-track-stability")
                continue

            current_ids.add(tracking_id)
            side = self._side(centroid[1])
            previous = self._tracks.get(tracking_id)
            if previous is None:
                self._tracks[tracking_id] = {
                    "state": "ACTIVE",
                    "previous_centroid": centroid,
                    "current_centroid": centroid,
                    "side": side,
                    "origin_centroid": centroid if side is not None else None,
                    "origin_hits": 1 if side is not None else 0,
                    "candidate_side": None,
                    "candidate_hits": 0,
                    "candidate_origin": None,
                    "last_seen": observed_at,
                    "last_event_at": float("-inf"),
                    "last_crossing_at": None,
                    "movement_history": deque([(observed_at, centroid)], maxlen=20),
                    "event_history": deque(maxlen=20),
                }
                self.last_diagnostics.append({
                    "tracking_id": tracking_id,
                    "state": "ACTIVE",
                    "previous_side": None,
                    "current_side": side,
                    "rejection_reason": "initial-position-only",
                })
                continue

            time_gap = observed_at - previous["last_seen"]
            previous_centroid = previous["current_centroid"]
            previous["previous_centroid"] = previous_centroid
            previous["current_centroid"] = centroid
            previous["last_seen"] = observed_at
            previous["state"] = "ACTIVE"
            previous["movement_history"].append((observed_at, centroid))

            previous_side = previous["side"]
            diagnostic = {
                "tracking_id": tracking_id,
                "state": "ACTIVE",
                "previous_side": previous_side,
                "current_side": side,
                "previous_centroid": [round(value, 5) for value in previous_centroid],
                "current_centroid": [round(value, 5) for value in centroid],
            }

            if time_gap > self.max_gap_seconds:
                previous["side"] = side
                previous["origin_centroid"] = centroid if side is not None else None
                previous["origin_hits"] = 1 if side is not None else 0
                previous["candidate_side"] = None
                previous["candidate_hits"] = 0
                previous["candidate_origin"] = None
                diagnostic["rejection_reason"] = "track-gap-rebased"
                self.last_diagnostics.append(diagnostic)
                continue

            if side is None:
                previous["candidate_side"] = None
                previous["candidate_hits"] = 0
                previous["candidate_origin"] = None
                diagnostic["rejection_reason"] = "inside-hysteresis-band"
                self.last_diagnostics.append(diagnostic)
                continue

            if previous_side is None:
                previous["side"] = side
                previous["origin_centroid"] = centroid
                previous["origin_hits"] = 1
                diagnostic["rejection_reason"] = "initial-side-established"
                self.last_diagnostics.append(diagnostic)
                continue

            if side == previous_side:
                previous["origin_hits"] += 1
                previous["origin_centroid"] = centroid
                previous["candidate_side"] = None
                previous["candidate_hits"] = 0
                previous["candidate_origin"] = None
                diagnostic["rejection_reason"] = "no-side-crossing"
                self.last_diagnostics.append(diagnostic)
                continue

            if previous["candidate_side"] != side:
                previous["candidate_side"] = side
                previous["candidate_hits"] = 1
                previous["candidate_origin"] = previous["origin_centroid"]
            else:
                previous["candidate_hits"] += 1

            if previous["candidate_hits"] < self.min_candidate_hits:
                diagnostic["rejection_reason"] = "destination-side-not-stable"
                self.last_diagnostics.append(diagnostic)
                continue

            origin = previous["candidate_origin"]
            if previous["origin_hits"] < self.min_origin_hits or origin is None:
                diagnostic["rejection_reason"] = "origin-side-not-stable"
                self.last_diagnostics.append(diagnostic)
                continue

            displacement_px = math.hypot(
                (centroid[0] - origin[0]) * width,
                (centroid[1] - origin[1]) * frame_height,
            )
            diagnostic["displacement_px"] = round(displacement_px, 1)
            if displacement_px < self.min_displacement_px:
                diagnostic["rejection_reason"] = "insufficient-crossing-displacement"
                self.last_diagnostics.append(diagnostic)
                continue

            if observed_at - previous["last_event_at"] < self.duplicate_window_seconds:
                diagnostic["rejection_reason"] = "crossing-cooldown"
                self.last_diagnostics.append(diagnostic)
                continue

            top_to_bottom = previous_side == "top" and side == "bottom"
            enters = top_to_bottom == (self.entry_flow == "top-to-bottom")
            direction = "IN" if enters else "OUT"
            crossing_direction = "top-to-bottom" if top_to_bottom else "bottom-to-top"
            previous_point = previous["candidate_origin"]
            event: dict[str, Any] = {
                "event_id": str(uuid.uuid4()),
                "event_type": "ENTRY" if enters else "EXIT",
                "line_y": self.line_y,
                "gateway_id": "ALPASFARM-GATEWAY-01",
                "camera_id": "C320WS-01",
                "animal_type": animal_type,
                "direction": direction,
                "crossing_direction": crossing_direction,
                "validation_status": "confirmed",
                "confidence": round(float(confidence or consistency), 4),
                "tracking_id": tracking_id,
                "track_state": "ACTIVE",
                "origin_side": previous_side,
                "destination_side": side,
                "previous_centroid": {
                    "x": round(previous_point[0], 6),
                    "y": round(previous_point[1], 6),
                },
                "current_centroid": {
                    "x": round(centroid[0], 6),
                    "y": round(centroid[1], 6),
                },
                "displacement_px": round(displacement_px, 2),
                "minimum_displacement_px": self.min_displacement_px,
                "crossing_margin": self.hysteresis,
                "frame_width": width,
                "frame_height": frame_height,
                "detected_at": observed_at,
            }
            crossings.append(event)
            previous["last_event_at"] = observed_at
            previous["last_crossing_at"] = observed_at
            previous["event_history"].append({
                "event_id": event["event_id"],
                "direction": direction,
                "at": observed_at,
            })
            previous["side"] = side
            previous["origin_centroid"] = centroid
            previous["origin_hits"] = previous["candidate_hits"]
            previous["candidate_side"] = None
            previous["candidate_hits"] = 0
            previous["candidate_origin"] = None
            diagnostic.update({
                "crossing_direction": crossing_direction,
                "event_type": event["event_type"],
                "validation_status": "confirmed",
            })
            self.last_diagnostics.append(diagnostic)

        for tracking_id, track in list(self._tracks.items()):
            if tracking_id in current_ids:
                continue
            if observed_at - track["last_seen"] >= self.track_ttl_seconds:
                track["state"] = "EXPIRED"
                del self._tracks[tracking_id]
            else:
                track["state"] = "LOST"

        return crossings
