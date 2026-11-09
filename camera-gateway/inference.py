from __future__ import annotations

import json
import logging
import math
import os
from collections import deque
from pathlib import Path
from time import monotonic, perf_counter
from typing import Any

import cv2
import numpy as np

from crossing_outbox import CrossingOutbox
from event_tracker import GateCrossingTracker
from motion_tracker import Box, MotionObservation, MotionTrackerConfig, MotionUpdate, SignificantMotionTracker


RejectedRegion = tuple[int, int, int, int, str]
ROOT = Path(__file__).resolve().parent
logger = logging.getLogger("alpasfarm.camera_gateway")
log = logger

OUTBOX_PATH = Path(os.getenv("CAMERA_CROSSING_OUTBOX_PATH", str(ROOT / "state" / "camera-crossings-outbox.json"))).expanduser()
if not OUTBOX_PATH.is_absolute():
    OUTBOX_PATH = (ROOT / OUTBOX_PATH).resolve()


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(value):
        return default
    return max(minimum, min(maximum, value))


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


class LocalCameraCounter:
    """Detect significant full-frame movement and queue confirmed line crossings."""

    def __init__(
        self,
        outbox_path: Path | None = None,
        *,
        hybrid_mode: bool = False,
        hybrid_excluded_regions: tuple[tuple[float, float, float, float], ...] = (),
    ) -> None:
        self.line_y = 0.55
        self.entry_flow = "top-to-bottom"
        self.settings_ready = True
        self.config_revision = 0
        self.counting_session_id: str | None = None
        self.crossing_tracker = self._new_crossing_tracker()
        self.outbox = CrossingOutbox(outbox_path or OUTBOX_PATH)

        self._background = cv2.createBackgroundSubtractorMOG2(
            history=_env_int("CAMERA_BACKGROUND_HISTORY", 240, 100, 2_000),
            varThreshold=_env_float("CAMERA_BG_VARIANCE_THRESHOLD", 36.0, 12.0, 100.0),
            detectShadows=True,
        )
        self._open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self._close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        self._frame_diff_threshold = _env_int("CAMERA_FRAME_DIFF_THRESHOLD", 12, 5, 40)
        self._frame_diff_history: deque[np.ndarray] = deque(
            maxlen=_env_int("CAMERA_FRAME_DIFF_HISTORY", 4, 2, 8),
        )
        self._frame_diff_min_hits = _env_int("CAMERA_FRAME_DIFF_MIN_HITS", 2, 1, 8)
        self._min_contour_area = _env_int("CAMERA_MIN_CONTOUR_AREA", 200, 100, 100_000)
        self._max_contour_area = _env_int("CAMERA_MAX_CONTOUR_AREA", 180_000, 10_000, 500_000)
        self._warmup_frames = _env_int("CAMERA_BACKGROUND_WARMUP_FRAMES", 6, 2, 60)
        self._global_light_delta = _env_float("CAMERA_GLOBAL_LIGHT_DELTA", 14.0, 5.0, 50.0)
        self._global_changed_pixel_ratio = _env_float("CAMERA_GLOBAL_CHANGED_PIXEL_RATIO", 0.35, 0.1, 0.9)
        self._motion_tracker = SignificantMotionTracker(MotionTrackerConfig(
            min_displacement_px=_env_float("CAMERA_MOTION_MIN_DISPLACEMENT", 1.25, 0.5, 30.0),
            min_accumulated_movement_px=_env_float("CAMERA_MOTION_MIN_ACCUMULATED", 8.0, 2.0, 250.0),
            min_movement_duration_seconds=_env_float("CAMERA_MOTION_MIN_DURATION", 0.65, 0.2, 10.0),
            confirmation_frames=_env_int("CAMERA_MOTION_CONFIRM_FRAMES", 3, 2, 20),
            max_tracking_distance_px=_env_float("CAMERA_MAX_TRACKING_DISTANCE", 85.0, 20.0, 300.0),
            min_motion_consistency=_env_float("CAMERA_MOTION_MIN_CONSISTENCY", 0.35, 0.1, 1.0),
            min_box_stability=_env_float("CAMERA_MOTION_MIN_BOX_STABILITY", 0.08, 0.03, 0.9),
            box_smoothing=_env_float("CAMERA_BOX_SMOOTHING", 0.6, 0.1, 0.9),
            max_box_smoothing=_env_float("CAMERA_BOX_MAX_SMOOTHING", 0.95, 0.5, 1.0),
            slow_velocity_px_s=_env_float("CAMERA_TRACK_SLOW_SPEED_PX_S", 30.0, 1.0, 500.0),
            fast_velocity_px_s=_env_float("CAMERA_TRACK_FAST_SPEED_PX_S", 240.0, 2.0, 2_000.0),
            max_adaptive_distance_multiplier=_env_float(
                "CAMERA_TRACK_MAX_DISTANCE_MULTIPLIER", 2.5, 1.0, 4.0,
            ),
            lost_track_timeout_seconds=_env_float("CAMERA_TRACK_TIMEOUT_SECONDS", 20.0, 1.0, 60.0),
            occlusion_grace_seconds=_env_float("CAMERA_OCCLUSION_GRACE_SECONDS", 5.0, 0.5, 30.0),
            candidate_timeout_seconds=_env_float("CAMERA_CANDIDATE_TIMEOUT_SECONDS", 3.0, 0.5, 15.0),
            stationary_grace_seconds=_env_float("CAMERA_STATIONARY_GRACE_SECONDS", 2.5, 0.3, 10.0),
        ))
        self.hybrid_mode = bool(hybrid_mode)
        self._hybrid_excluded_regions = hybrid_excluded_regions
        self._hybrid_max_detector_gap_seconds = _env_float(
            "CAMERA_HYBRID_MAX_DETECTOR_GAP_SECONDS", 8.0, 3.0, 30.0,
        )
        self._hybrid_single_hit_confidence = _env_float(
            "CAMERA_HYBRID_SINGLE_HIT_CONFIDENCE", 0.75, 0.65, 0.95,
        )
        self._frames_seen = 0
        self._previous_gray: np.ndarray | None = None
        self._previous_hsv: np.ndarray | None = None
        self._lighting_suppress_frames = 0
        self._debug_enabled = os.getenv("CAMERA_GATEWAY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
        self._debug_dir = ROOT / "state" / "hybrid-debug"
        self._last_debug_write_at = 0.0
        self._last_debug_masks: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None = None
        self._last_debug_rejected: list[RejectedRegion] = []
        self._last_motion_diagnostics: dict[str, Any] = {}
        self._track_templates: dict[str, np.ndarray] = {}
        self._last_template_match_at: dict[str, float] = {}

    def _in_hybrid_static_background(self, box: Box, width: int, height: int) -> bool:
        if width <= 0 or height <= 0:
            return False
        center_x = (box[0] + box[2]) / (2.0 * width)
        center_y = (box[1] + box[3]) / (2.0 * height)
        return any(
            x1 <= center_x <= x2 and y1 <= center_y <= y2
            for x1, y1, x2, y2 in self._hybrid_excluded_regions
        )

    def _new_crossing_tracker(self) -> GateCrossingTracker:
        track_timeout = _env_float("CAMERA_TRACK_TIMEOUT_SECONDS", 20.0, 1.0, 60.0)
        return GateCrossingTracker(
            line_y=self.line_y,
            entry_flow=self.entry_flow,
            hysteresis=_env_float("CAMERA_CROSSING_HYSTERESIS", 0.03, 0.01, 0.15),
            max_gap_seconds=min(
                _env_float("CAMERA_CROSSING_MAX_GAP_SECONDS", 6.0, 0.5, 30.0),
                track_timeout * 0.75,
            ),
            duplicate_window_seconds=_env_float("CAMERA_CROSSING_COOLDOWN_SECONDS", 0.75, 0.0, 30.0),
            track_ttl_seconds=track_timeout,
            min_origin_hits=_env_int("CAMERA_CROSSING_ORIGIN_FRAMES", 2, 1, 20),
            min_candidate_hits=_env_int("CAMERA_CROSSING_CONFIRM_FRAMES", 2, 2, 20),
            min_displacement_px=_env_float("CAMERA_CROSSING_MIN_DISPLACEMENT_PX", 16.0, 1.0, 250.0),
            min_motion_consistency=_env_float("CAMERA_MOTION_MIN_CONSISTENCY", 0.55, 0.2, 1.0),
            min_box_stability=_env_float("CAMERA_MOTION_MIN_BOX_STABILITY", 0.12, 0.05, 0.9),
        )

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
        if entry_flow not in {"top-to-bottom", "bottom-to-top"}:
            raise ValueError("Camera entry direction must be top-to-bottom or bottom-to-top.")
        if not 0.25 <= float(line_y) <= 0.75:
            raise ValueError("The saved camera gate line is outside the supported range.")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("The saved camera settings revision is invalid.")
        if session_id is not None and (not isinstance(session_id, str) or not session_id):
            session_id = None
        updated_line = float(line_y)
        if (updated_line, entry_flow, session_id) != (self.line_y, self.entry_flow, self.counting_session_id):
            self.line_y = updated_line
            self.entry_flow = entry_flow
            self.counting_session_id = session_id
            self.crossing_tracker = self._new_crossing_tracker()
        self.config_revision = revision
        self.settings_ready = True

    def acknowledge_crossings(self, event_keys: list[str]) -> None:
        self.outbox.acknowledge(event_keys)

    def archive_unrecorded_crossings(self, outcomes: list[dict[str, str]]) -> int:
        return self.outbox.archive_unrecorded(outcomes)

    @staticmethod
    def _prediction(observation: MotionObservation) -> dict[str, Any]:
        x1, y1, x2, y2 = observation.bbox
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        species = observation.species if observation.species in {"goat", "sheep"} else (
            "sheep" if area >= 13_000 else "goat"
        )
        return {
            "class": species,
            "animal_type": observation.species if observation.species in {"goat", "sheep"} else "unknown",
            "confidence": round(
                observation.confidence if observation.species in {"goat", "sheep"}
                else min(0.95, max(0.45, observation.movement_consistency)),
                4,
            ),
            "bbox": {"x1": max(0.0, x1), "y1": max(0.0, y1), "x2": x2, "y2": y2},
            "tracking_id": observation.tracking_id,
            # Keep the gateway/API's legacy confirmed state while exposing the
            # richer OpenCV lifecycle for local diagnostics and overlays.
            "state": "ACTIVE" if observation.confirmed else "DETECTED",
            "tracking_state": observation.state,
            "observed": observation.observed,
            "confirmed": observation.confirmed,
            "movement_consistency": observation.movement_consistency,
            "box_stability": observation.box_stability,
            "movement_px": observation.movement,
        }

    def _validated_contours(self, mask: np.ndarray) -> tuple[list[Box], list[RejectedRegion], dict[str, int]]:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes: list[Box] = []
        rejected: list[RejectedRegion] = []
        counts = {"too_small": 0, "too_large": 0, "fragmented": 0}
        for contour in contours:
            area = cv2.contourArea(contour)
            x, y, width, height = cv2.boundingRect(contour)
            box = (float(x), float(y), float(x + width), float(y + height))
            if area < self._min_contour_area:
                counts["too_small"] += 1
                rejected.append((x, y, width, height, "too-small"))
                continue
            if area > self._max_contour_area:
                counts["too_large"] += 1
                rejected.append((x, y, width, height, "too-large"))
                continue
            if min(width, height) < 5 or area / max(1.0, float(width * height)) < 0.06:
                counts["fragmented"] += 1
                rejected.append((x, y, width, height, "fragmented"))
                continue
            boxes.append(box)

        # Merge only elongated edge fragments whose shared span and bounded union
        # indicate one moving silhouette; ordinary neighboring boxes stay separate.
        merged: list[Box] = []
        for box in boxes:
            candidate = box
            index = 0
            while index < len(merged):
                existing = merged[index]
                overlap_x = max(0.0, min(candidate[2], existing[2]) - max(candidate[0], existing[0]))
                overlap_y = max(0.0, min(candidate[3], existing[3]) - max(candidate[1], existing[1]))
                candidate_width = candidate[2] - candidate[0]
                candidate_height = candidate[3] - candidate[1]
                existing_width = existing[2] - existing[0]
                existing_height = existing[3] - existing[1]
                horizontal_gap = max(0.0, max(candidate[0], existing[0]) - min(candidate[2], existing[2]))
                vertical_gap = max(0.0, max(candidate[1], existing[1]) - min(candidate[3], existing[3]))
                horizontal_fragments = (
                    overlap_y / min(candidate_height, existing_height) >= 0.7
                    and max(candidate_width / candidate_height, existing_width / existing_height) <= 0.35
                    and horizontal_gap <= 0.8 * min(candidate_height, existing_height)
                    and max(candidate[2], existing[2]) - min(candidate[0], existing[0])
                    <= 2.0 * max(candidate_height, existing_height)
                )
                vertical_fragments = (
                    overlap_x / min(candidate_width, existing_width) >= 0.7
                    and max(candidate_height / candidate_width, existing_height / existing_width) <= 0.35
                    and vertical_gap <= 0.8 * min(candidate_width, existing_width)
                    and max(candidate[3], existing[3]) - min(candidate[1], existing[1])
                    <= 2.0 * max(candidate_width, existing_width)
                )
                if horizontal_fragments or vertical_fragments:
                    candidate = (
                        min(candidate[0], existing[0]),
                        min(candidate[1], existing[1]),
                        max(candidate[2], existing[2]),
                        max(candidate[3], existing[3]),
                    )
                    merged.pop(index)
                    index = 0
                    continue
                index += 1
            merged.append(candidate)
        boxes = merged
        boxes.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)

        # Remove overlapping duplicate regions while keeping disjoint nearby animals separate.
        unique: list[Box] = []
        for box in boxes:
            duplicate = False
            for existing in unique:
                intersection_width = max(0.0, min(box[2], existing[2]) - max(box[0], existing[0]))
                intersection_height = max(0.0, min(box[3], existing[3]) - max(box[1], existing[1]))
                intersection = intersection_width * intersection_height
                smaller_area = min(
                    (box[2] - box[0]) * (box[3] - box[1]),
                    (existing[2] - existing[0]) * (existing[3] - existing[1]),
                )
                if smaller_area > 0 and intersection / smaller_area >= 0.7:
                    duplicate = True
                    break
            if not duplicate:
                unique.append(box)
        return unique, rejected, counts

    def _save_debug(
        self,
        frame: np.ndarray,
        raw: np.ndarray,
        shadow: np.ndarray,
        filtered: np.ndarray,
        rejected: list[RejectedRegion],
        now: float,
    ) -> None:
        if not self._debug_enabled or now - self._last_debug_write_at < 1.0:
            return
        debug_dir = ROOT / "state" / "motion-debug"
        debug_dir.mkdir(parents=True, exist_ok=True)

        rejected_frame = frame.copy()
        for x, y, width, height, reason in rejected:
            cv2.rectangle(rejected_frame, (x, y), (x + width, y + height), (0, 165, 255), 1)
            cv2.putText(
                rejected_frame,
                reason,
                (x, max(12, y - 3)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.35,
                (0, 165, 255),
                1,
                cv2.LINE_AA,
            )
        line_y = round(self.line_y * frame.shape[0])
        cv2.line(rejected_frame, (0, line_y), (frame.shape[1] - 1, line_y), (255, 160, 0), 2)
        cv2.putText(
            rejected_frame,
            f"Gate {self.entry_flow} @ {self.line_y:.3f}",
            (8, max(16, line_y - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 160, 0),
            1,
            cv2.LINE_AA,
        )
        diagnostics = self._last_motion_diagnostics
        cv2.putText(
            rejected_frame,
            (
                f"Illumination dV={diagnostics.get('illumination_delta', 0):.1f} "
                f"coherence={diagnostics.get('illumination_coherence', 0):.2f} "
                f"shadow={diagnostics.get('shadow_pixels', 0)} "
                f"global={diagnostics.get('global_lighting_change', False)}"
            ),
            (8, 18),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 255, 0),
            1,
            cv2.LINE_AA,
        )
        for track in self._last_motion_diagnostics.get("tracks", []):
            if not track.get("confirmed") or track.get("state") in {"LOST", "EXPIRED"}:
                continue
            if not isinstance(track.get("bbox"), list):
                continue
            x1, y1, x2, y2 = (int(value) for value in track["bbox"])
            color = (0, 200, 255) if track.get("state") in {
                "TEMPORARILY_STATIONARY", "WAITING", "WAITING_TO_CROSS",
                "TEMPORARILY_OCCLUDED", "AMBIGUOUS",
            } else (0, 255, 0)
            cv2.rectangle(rejected_frame, (x1, y1), (x2, y2), color, 2)
            center = ((x1 + x2) // 2, (y1 + y2) // 2)
            cv2.circle(rejected_frame, center, 4, color, -1)
            queue = (
                f" {track.get('queue_direction')}#{track.get('queue_position')}"
                if track.get("queue_position") is not None else ""
            )
            gate_distance = track.get("gate_distance_px")
            gate_text = f" {gate_distance:.0f}px" if isinstance(gate_distance, (int, float)) else ""
            if track.get("priority"):
                cv2.circle(rejected_frame, center, 8, (255, 255, 0), 2)
            cv2.putText(
                rejected_frame,
                f"T-{track['tracking_id']} {track['state']}{queue}{gate_text} {track.get('movement_direction', '')}",
                (x1, max(14, y1 - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.4,
                color,
                1,
                cv2.LINE_AA,
            )
        for filename, image in (
            ("original-frame.jpg", frame),
            ("raw-mask.jpg", raw),
            ("shadow-mask.jpg", shadow),
            ("filtered-mask.jpg", filtered),
            ("candidates.jpg", rejected_frame),
        ):
            success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 60])
            if success:
                temporary = debug_dir / f"{filename}.tmp"
                temporary.write_bytes(encoded.tobytes())
                temporary.replace(debug_dir / filename)
        temporary_json = debug_dir / "tracks.json.tmp"
        temporary_json.write_text(json.dumps(self._last_motion_diagnostics, separators=(",", ":")), encoding="utf-8")
        temporary_json.replace(debug_dir / "tracks.json")
        self._last_debug_write_at = now

    def _recover_stationary_tracks(
        self,
        gray: np.ndarray,
        boxes: list[Box],
        now: float,
    ) -> list[Box]:
        """Use each confirmed track's local image template to retain a visible animal.

        Motion contours disappear when a stationary animal is absorbed into the
        background model. A small, per-track template search provides a fresh
        visual observation in that case, without adding a second frame pipeline.
        """
        recovered: list[Box] = []
        base_distance = self._motion_tracker.config.max_tracking_distance_px
        search_radius = min(90, max(35, int(base_distance * 0.55)))
        match_interval = _env_float("CAMERA_TRACK_TEMPLATE_INTERVAL_SECONDS", 0.2, 0.08, 1.0)
        minimum_score = _env_float("CAMERA_TRACK_TEMPLATE_MIN_SCORE", 0.86, 0.65, 0.99)
        minimum_texture = _env_float("CAMERA_TRACK_TEMPLATE_MIN_TEXTURE", 7.0, 2.0, 40.0)

        for tracking_id, track in self._motion_tracker._tracks.items():
            if not track.confirmed or now - track.last_seen_at > self._motion_tracker.config.lost_track_timeout_seconds:
                continue
            predicted_seconds = min(max(now - track.last_seen_at, 0.0), 0.5)
            center_x = track.centroid[0] + track.velocity_x * predicted_seconds
            center_y = track.centroid[1] + track.velocity_y * predicted_seconds
            if any(
                math.dist(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), (center_x, center_y))
                <= base_distance
                for box in boxes
            ):
                continue
            template = self._track_templates.get(tracking_id)
            if template is None or template.size == 0:
                continue
            if float(np.std(template)) < minimum_texture:
                continue
            last_match_at = self._last_template_match_at.get(tracking_id, float("-inf"))
            if now - last_match_at + 1e-9 < match_interval:
                continue
            self._last_template_match_at[tracking_id] = now

            template_height, template_width = template.shape[:2]
            frame_height, frame_width = gray.shape[:2]
            left = max(0, int(center_x - search_radius - template_width / 2))
            top = max(0, int(center_y - search_radius - template_height / 2))
            right = min(frame_width, int(center_x + search_radius + template_width / 2))
            bottom = min(frame_height, int(center_y + search_radius + template_height / 2))
            search = gray[top:bottom, left:right]
            if search.shape[0] < template_height or search.shape[1] < template_width:
                continue
            match_map = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
            _minimum, maximum, _minimum_point, maximum_point = cv2.minMaxLoc(match_map)
            if maximum < minimum_score:
                continue
            x1 = float(left + maximum_point[0])
            y1 = float(top + maximum_point[1])
            candidate = (x1, y1, x1 + template_width, y1 + template_height)
            candidate_center = ((candidate[0] + candidate[2]) / 2, (candidate[1] + candidate[3]) / 2)
            if any(
                math.dist(candidate_center, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
                < min(template_width, template_height) * 0.45
                for box in boxes + recovered
            ):
                continue
            recovered.append(candidate)
        return recovered

    def _refresh_track_templates(self, gray: np.ndarray, now: float) -> None:
        live_ids = set(self._motion_tracker._tracks)
        for tracking_id in list(self._track_templates):
            if tracking_id not in live_ids:
                self._track_templates.pop(tracking_id, None)
                self._last_template_match_at.pop(tracking_id, None)
        frame_height, frame_width = gray.shape[:2]
        for tracking_id, track in self._motion_tracker._tracks.items():
            if not track.confirmed or abs(track.last_seen_at - now) > 1e-6:
                continue
            box_width = max(1, round(track.bbox[2] - track.bbox[0]))
            box_height = max(1, round(track.bbox[3] - track.bbox[1]))
            center_x, center_y = track.observed_centroid
            x1 = max(0, min(frame_width - 1, round(center_x - box_width / 2)))
            y1 = max(0, min(frame_height - 1, round(center_y - box_height / 2)))
            x2 = min(frame_width, x1 + box_width)
            y2 = min(frame_height, y1 + box_height)
            template = gray[y1:y2, x1:x2]
            if template.size and float(np.std(template)) >= 2.0:
                self._track_templates[tracking_id] = template.copy()

    def _optical_flow_boxes(
        self,
        previous_gray: np.ndarray | None,
        current_gray: np.ndarray,
        at: float,
    ) -> list[tuple[str, Box]]:
        if previous_gray is None or previous_gray.shape != current_gray.shape:
            return []
        flow_boxes: list[tuple[str, Box]] = []
        height, width = current_gray.shape[:2]
        tracks = [track for track in self._motion_tracker.tracking_state().get("tracks", [])
                  if track.get("confirmed")
                  and at - float(track.get("last_seen_at", at))
                  <= self._motion_tracker.config.occlusion_grace_seconds]
        for track in tracks:
            tracking_id = track.get("tracking_id")
            raw_box = track.get("bbox")
            if not isinstance(tracking_id, str) or not isinstance(raw_box, list) or len(raw_box) != 4:
                continue
            x1, y1, x2, y2 = (int(round(value)) for value in raw_box)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(width, x2), min(height, y2)
            if x2 - x1 < 12 or y2 - y1 < 12:
                continue
            roi_mask = np.zeros_like(previous_gray)
            roi_mask[y1:y2, x1:x2] = 255
            # Prevent a nearby track from borrowing the leader's feature points.
            for other in tracks:
                if other is track or not isinstance(other.get("bbox"), list):
                    continue
                ox1, oy1, ox2, oy2 = (int(round(value)) for value in other["bbox"])
                roi_mask[max(0, oy1):min(height, oy2), max(0, ox1):min(width, ox2)] = 0
            points = cv2.goodFeaturesToTrack(
                previous_gray,
                maxCorners=120 if track.get("priority") else 72,
                qualityLevel=0.01,
                minDistance=3 if track.get("priority") else 4,
                mask=roi_mask,
                blockSize=5,
            )
            if points is None or len(points) < 4:
                continue
            moved, status, errors = cv2.calcOpticalFlowPyrLK(
                previous_gray,
                current_gray,
                points,
                None,
                winSize=(21, 21),
                maxLevel=2,
                criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
            )
            if moved is None or status is None:
                continue
            valid = status.reshape(-1).astype(bool)
            if errors is not None:
                valid &= errors.reshape(-1) < 45.0
            if int(valid.sum()) < 4:
                continue
            offsets = moved.reshape(-1, 2)[valid] - points.reshape(-1, 2)[valid]
            dx, dy = (float(value) for value in np.median(offsets, axis=0))
            if math.hypot(dx, dy) > max(45.0, math.hypot(x2 - x1, y2 - y1) * 0.4):
                continue
            box = (
                max(0.0, min(width - 1.0, x1 + dx)),
                max(0.0, min(height - 1.0, y1 + dy)),
                max(1.0, min(float(width), x2 + dx)),
                max(1.0, min(float(height), y2 + dy)),
            )
            if box[2] > box[0] and box[3] > box[1]:
                flow_boxes.append((tracking_id, box))
        return flow_boxes

    @staticmethod
    def _combine_motion_and_flow(
        contours: list[Box],
        flow_boxes: list[tuple[str, Box]],
    ) -> tuple[list[Box], dict[int, str], set[str], list[RejectedRegion]]:
        """Use each established track's flow as a one-to-one contour hint.

        A single connected motion blob containing several established tracks is
        not allowed to replace them with one large box. Separate flow boxes are
        retained only while their visual trajectories remain distinguishable.
        """
        by_contour: dict[int, list[tuple[str, Box]]] = {}
        unused: list[tuple[str, Box]] = []
        for tracking_id, flow_box in flow_boxes:
            flow_center = ((flow_box[0] + flow_box[2]) / 2.0, (flow_box[1] + flow_box[3]) / 2.0)
            flow_diag = math.hypot(flow_box[2] - flow_box[0], flow_box[3] - flow_box[1])
            matches: list[tuple[float, int]] = []
            for index, contour in enumerate(contours):
                x1, y1 = max(flow_box[0], contour[0]), max(flow_box[1], contour[1])
                x2, y2 = min(flow_box[2], contour[2]), min(flow_box[3], contour[3])
                intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
                union = ((flow_box[2] - flow_box[0]) * (flow_box[3] - flow_box[1])
                         + (contour[2] - contour[0]) * (contour[3] - contour[1]) - intersection)
                overlap = intersection / union if union > 0 else 0.0
                contour_center = ((contour[0] + contour[2]) / 2.0, (contour[1] + contour[3]) / 2.0)
                distance = math.dist(flow_center, contour_center)
                if overlap >= 0.02 or distance <= max(24.0, flow_diag * 0.42):
                    matches.append((distance - overlap * flow_diag, index))
            if matches:
                _, index = min(matches)
                by_contour.setdefault(index, []).append((tracking_id, flow_box))
            else:
                unused.append((tracking_id, flow_box))

        result: list[Box] = []
        hints: dict[int, str] = {}
        ambiguous: set[str] = set()
        rejected: list[RejectedRegion] = []
        used_tracks: set[str] = set()
        for index, contour in enumerate(contours):
            members = by_contour.get(index, [])
            if not members:
                result.append(contour)
                continue
            if len(members) == 1:
                tracking_id, flow_box = members[0]
                contour_area = max(1.0, (contour[2] - contour[0]) * (contour[3] - contour[1]))
                flow_area = max(1.0, (flow_box[2] - flow_box[0]) * (flow_box[3] - flow_box[1]))
                chosen = flow_box if contour_area > flow_area * 2.5 else contour
                hints[len(result)] = tracking_id
                result.append(chosen)
                used_tracks.add(tracking_id)
                continue

            distinct = True
            for left_index, (left_id, left) in enumerate(members):
                for right_id, right in members[left_index + 1:]:
                    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
                    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
                    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
                    union = ((left[2] - left[0]) * (left[3] - left[1])
                             + (right[2] - right[0]) * (right[3] - right[1]) - inter)
                    overlap = inter / union if union > 0 else 0.0
                    left_center = ((left[0] + left[2]) / 2, (left[1] + left[3]) / 2)
                    right_center = ((right[0] + right[2]) / 2, (right[1] + right[3]) / 2)
                    min_diag = min(math.hypot(left[2] - left[0], left[3] - left[1]),
                                   math.hypot(right[2] - right[0], right[3] - right[1]))
                    if overlap >= 0.58 or math.dist(left_center, right_center) < max(8.0, min_diag * 0.22):
                        distinct = False
            if not distinct:
                ambiguous.update(tracking_id for tracking_id, _ in members)
                rejected.append((int(contour[0]), int(contour[1]),
                                 int(contour[2] - contour[0]), int(contour[3] - contour[1]),
                                 "ambiguous-merged-tracks"))
                continue
            for tracking_id, flow_box in members:
                hints[len(result)] = tracking_id
                result.append(flow_box)
                used_tracks.add(tracking_id)

        for tracking_id, flow_box in unused:
            if tracking_id in used_tracks or tracking_id in ambiguous:
                continue
            if any(
                min(flow_box[2], box[2]) > max(flow_box[0], box[0])
                and min(flow_box[3], box[3]) > max(flow_box[1], box[1])
                for box in result
            ):
                continue
            hints[len(result)] = tracking_id
            result.append(flow_box)
            used_tracks.add(tracking_id)
        return result, hints, ambiguous, rejected

    def _hybrid_predictions(
        self,
        frame: np.ndarray,
        blurred: np.ndarray,
        species_detections: list[dict[str, Any]] | None,
        detector_timestamp: float | None,
        original_width: int,
        original_height: int,
        width: int,
        height: int,
    ) -> tuple[list[dict[str, Any]], MotionUpdate, dict[str, Any]]:
        now = monotonic()
        scale_x = width / max(1, original_width)
        scale_y = height / max(1, original_height)
        detections: list[tuple[Box, dict[str, Any]]] = []
        static_detection_rejections = 0
        fresh = (
            species_detections is not None
            and detector_timestamp is not None
            and 0 <= now - detector_timestamp <= 2.5
        )
        if fresh:
            for detection in species_detections or []:
                if not isinstance(detection, dict) or detection.get("class") not in {"goat", "sheep"}:
                    continue
                confidence = detection.get("confidence")
                raw_box = detection.get("bbox")
                if not isinstance(confidence, (int, float)) or not isinstance(raw_box, dict):
                    continue
                try:
                    box = (
                        max(0.0, min(width - 1.0, float(raw_box["x1"]) * scale_x)),
                        max(0.0, min(height - 1.0, float(raw_box["y1"]) * scale_y)),
                        max(1.0, min(float(width), float(raw_box["x2"]) * scale_x)),
                        max(1.0, min(float(height), float(raw_box["y2"]) * scale_y)),
                    )
                except (KeyError, TypeError, ValueError, OverflowError):
                    continue
                if box[2] - box[0] < 8 or box[3] - box[1] < 8 or not all(math.isfinite(value) for value in box):
                    continue
                if self._in_hybrid_static_background(box, width, height):
                    static_detection_rejections += 1
                    continue
                detections.append((box, {
                    "class": detection["class"],
                    "confidence": min(1.0, max(0.0, float(confidence))),
                }))

        # A model frame is a complete detector snapshot. Do not mix flow boxes
        # into it: an overlapping flow and detector result could seed duplicate
        # IDs. Optical flow owns the frames between detector snapshots.
        # A confirmed animal box must not drift onto the known beam. Expire any
        # association already in a fixed background ROI before optical flow can
        # keep refreshing it from stationary wood texture.
        for track in list(self._motion_tracker.tracking_state().get("tracks", [])):
            raw_box = track.get("bbox")
            if isinstance(raw_box, list) and len(raw_box) == 4 and self._in_hybrid_static_background(
                tuple(float(value) for value in raw_box), width, height,
            ):
                self._motion_tracker.expire_track(
                    str(track.get("tracking_id")),
                    reason="static_background_region",
                )
        raw_flow_boxes = [] if detections else self._optical_flow_boxes(self._previous_gray, blurred, now)
        flow_boxes = []
        for tracking_id, flow_box in raw_flow_boxes:
            if self._in_hybrid_static_background(flow_box, width, height):
                self._motion_tracker.expire_track(tracking_id, reason="static_background_region")
                continue
            flow_boxes.append((tracking_id, flow_box))
        boxes: list[Box] = []
        detector_observations: dict[int, dict[str, Any]] = {}
        for box, metadata in detections:
            detector_observations[len(boxes)] = metadata
            boxes.append(box)
        for _tracking_id, flow_box in flow_boxes:
            boxes.append(flow_box)

        update = self._motion_tracker.update(
            boxes,
            now,
            frame_height=height,
            gate_line_y=self.line_y,
            detector_observations=detector_observations,
            detector_at=detector_timestamp if fresh else None,
            require_detector_confirmation=True,
            single_hit_confidence=self._hybrid_single_hit_confidence,
        )
        # Optical flow can keep finding stationary wood texture forever. In
        # hybrid mode it may bridge detector updates, but it cannot renew the
        # evidence that this is an animal. A confirmed track must receive a
        # fresh ML match within a bounded interval or it expires as uncertain.
        detector_timeout_ids: set[str] = set()
        for tracking_id, track in list(self._motion_tracker._tracks.items()):
            last_detector_at = track.last_detector_at
            if (
                track.confirmed
                and last_detector_at is not None
                and now - last_detector_at > self._hybrid_max_detector_gap_seconds
            ):
                self._motion_tracker.expire_track(
                    tracking_id,
                    reason="detector_confirmation_timeout",
                )
                detector_timeout_ids.add(tracking_id)
        if detector_timeout_ids:
            update = MotionUpdate(
                tuple(track for track in update.active if track.tracking_id not in detector_timeout_ids),
                tuple(track for track in update.displayed if track.tracking_id not in detector_timeout_ids),
                tuple(track for track in update.newly_active if track.tracking_id not in detector_timeout_ids),
                update.diagnostics,
            )
        self._previous_gray = blurred
        self._frames_seen += 1
        predictions = [self._prediction(track) for track in update.displayed]
        self._last_motion_diagnostics = {
            **update.diagnostics,
            "hybrid_mode": True,
            "detector_observations": len(detections),
            "optical_flow_tracks": len(flow_boxes),
            "static_background_rejections": static_detection_rejections,
            "detector_timeout_expirations": len(detector_timeout_ids),
            "detector_timestamp_age_ms": round(max(0.0, now - detector_timestamp) * 1000, 1)
            if fresh and detector_timestamp is not None else None,
        }
        self._save_hybrid_debug(frame, predictions, now)
        return predictions, update, {"width": width, "height": height}

    def _save_hybrid_debug(
        self,
        frame: np.ndarray,
        predictions: list[dict[str, Any]],
        now: float,
    ) -> None:
        if not self._debug_enabled or now - self._last_debug_write_at < 1.0:
            return
        debug_dir = self._debug_dir
        debug_dir.mkdir(parents=True, exist_ok=True)
        image = frame.copy()
        line_y = round(self.line_y * image.shape[0])
        cv2.line(image, (0, line_y), (image.shape[1] - 1, line_y), (255, 160, 0), 2)
        cv2.putText(
            image,
            f"Gate {self.entry_flow} @ {self.line_y:.3f}",
            (8, max(16, line_y - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 160, 0),
            1,
            cv2.LINE_AA,
        )
        for prediction in predictions:
            box = prediction.get("bbox")
            try:
                if isinstance(box, dict):
                    x1, y1, x2, y2 = (int(float(box[key])) for key in ("x1", "y1", "x2", "y2"))
                elif isinstance(box, list) and len(box) == 4:
                    x1, y1, x2, y2 = (int(value) for value in box)
                else:
                    continue
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            state = str(prediction.get("tracking_state", prediction.get("state", "TRACKED")))
            color = (0, 200, 255) if state in {
                "TEMPORARILY_STATIONARY", "WAITING_TO_CROSS", "TEMPORARILY_OCCLUDED",
            } else (0, 255, 0)
            cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                image,
                f"T-{prediction.get('tracking_id', '?')} {prediction.get('class', '?')} "
                f"{float(prediction.get('confidence', 0)):.2f} {state}",
                (x1, max(14, y1 - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.38,
                color,
                1,
                cv2.LINE_AA,
            )
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if ok:
            temporary = debug_dir / "tracking.jpg.tmp"
            temporary.write_bytes(encoded.tobytes())
            temporary.replace(debug_dir / "tracking.jpg")
        details = {
            **self._last_motion_diagnostics,
            "predictions": predictions,
            "gate_line_y": self.line_y,
            "entry_flow": self.entry_flow,
        }
        temporary_json = debug_dir / "tracking.json.tmp"
        temporary_json.write_text(json.dumps(details, separators=(",", ":")), encoding="utf-8")
        temporary_json.replace(debug_dir / "tracking.json")
        self._last_debug_write_at = now

    def _opencv_predictions(
        self,
        frame: Any,
        species_detections: list[dict[str, Any]] | None = None,
        detector_timestamp: float | None = None,
    ) -> tuple[list[dict[str, Any]], MotionUpdate, dict[str, Any]]:
        if not isinstance(frame, np.ndarray):
            raise ValueError("OpenCV-based counting requires a NumPy frame.")
        height, width = frame.shape[:2]
        original_height, original_width = height, width
        if height <= 0 or width <= 0:
            raise ValueError("Camera frame dimensions are invalid.")

        resized = frame
        if max(width, height) > 960:
            scale = 960 / float(max(width, height))
            resized = cv2.resize(frame, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
            height, width = resized.shape[:2]

        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        if self.hybrid_mode:
            return self._hybrid_predictions(
                resized,
                blurred,
                species_detections,
                detector_timestamp,
                original_width,
                original_height,
                width,
                height,
            )
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        if self._previous_gray is not None and self._previous_gray.shape != blurred.shape:
            self._previous_gray = None
            self._previous_hsv = None
            self._frame_diff_history.clear()
        previous_gray = self._previous_gray
        self._frames_seen += 1
        global_lighting_change = False
        difference: np.ndarray | None = None
        illumination_delta = 0.0
        illumination_coherence = 0.0
        if self._previous_gray is not None:
            signed_difference = blurred.astype(np.int16) - self._previous_gray.astype(np.int16)
            illumination_delta = float(np.median(signed_difference))
            illumination_coherence = float(np.mean(
                np.abs(signed_difference - illumination_delta)
                <= max(3.0, self._frame_diff_threshold / 3.0)
            ))
            compensated_difference = np.abs(signed_difference - illumination_delta).astype(np.uint8)
            difference = compensated_difference
            raw_difference = cv2.absdiff(blurred, self._previous_gray)
            global_lighting_change = (
                (
                    abs(illumination_delta) >= max(2.0, self._global_light_delta * 0.2)
                    and illumination_coherence >= 0.6
                )
                or (
                    float(np.mean(raw_difference)) >= self._global_light_delta
                    and float(np.mean(raw_difference >= 24)) >= self._global_changed_pixel_ratio
                )
            )
        if global_lighting_change:
            self._lighting_suppress_frames = 3

        lighting_recovery = self._lighting_suppress_frames > 0
        learning_rate = 0.35 if lighting_recovery else (
            0.2 if self._frames_seen <= self._warmup_frames else -1
        )
        foreground = self._background.apply(blurred, learningRate=learning_rate)
        raw_mask = foreground.copy()
        shadow_mask = cv2.inRange(foreground, 127, 127)
        if self._previous_hsv is not None:
            previous_hue = self._previous_hsv[:, :, 0].astype(np.int16)
            current_hue = hsv[:, :, 0].astype(np.int16)
            hue_delta = np.abs(current_hue - previous_hue)
            hue_delta = np.minimum(hue_delta, 180 - hue_delta)
            saturation_delta = cv2.absdiff(hsv[:, :, 1], self._previous_hsv[:, :, 1])
            value_delta = cv2.absdiff(hsv[:, :, 2], self._previous_hsv[:, :, 2])
            illumination_like = (
                (value_delta >= self._frame_diff_threshold)
                & (hue_delta <= 6)
                & (saturation_delta <= 12)
                & (foreground != 255)
            )
            shadow_mask[illumination_like] = 255
        filtered = cv2.threshold(foreground, 200, 255, cv2.THRESH_BINARY)[1]
        filtered = cv2.morphologyEx(filtered, cv2.MORPH_OPEN, self._open_kernel)
        if self._frames_seen <= self._warmup_frames or lighting_recovery:
            self._frame_diff_history.clear()
        elif difference is not None:
            subtle_motion = cv2.threshold(
                difference,
                self._frame_diff_threshold,
                255,
                cv2.THRESH_BINARY,
            )[1]
            subtle_motion[shadow_mask > 0] = 0
            self._frame_diff_history.append(subtle_motion)
        if self._frame_diff_history:
            motion_hits = np.zeros_like(self._frame_diff_history[0])
            for historical_difference in self._frame_diff_history:
                cv2.add(motion_hits, historical_difference // 255, dst=motion_hits)
            accumulated_difference = cv2.threshold(
                motion_hits,
                self._frame_diff_min_hits - 1,
                255,
                cv2.THRESH_BINARY,
            )[1]
            accumulated_difference = cv2.morphologyEx(
                accumulated_difference,
                cv2.MORPH_OPEN,
                self._open_kernel,
            )
            filtered = cv2.bitwise_or(filtered, accumulated_difference)
        if lighting_recovery:
            filtered = cv2.bitwise_and(filtered, cv2.bitwise_not(
                cv2.threshold(foreground, 200, 255, cv2.THRESH_BINARY)[1],
            ))
        filtered = cv2.morphologyEx(filtered, cv2.MORPH_CLOSE, self._close_kernel)
        self._previous_hsv = hsv

        now = monotonic()
        rejected: list[RejectedRegion] = []
        rejected_counts = {"too_small": 0, "too_large": 0, "fragmented": 0}
        flow_boxes: list[tuple[str, Box]] = []
        track_id_hints: dict[int, str] = {}
        ambiguous_track_ids: set[str] = set()
        flow_rejected: list[RejectedRegion] = []
        if self._frames_seen <= self._warmup_frames:
            boxes: list[Box] = []
            update = self._motion_tracker.update(
                [], now, frame_height=height, gate_line_y=self.line_y,
                entry_flow=self.entry_flow, gray_frame=blurred,
            )
        else:
            boxes, rejected, rejected_counts = self._validated_contours(filtered)
            boxes.extend(self._recover_stationary_tracks(blurred, boxes, now))
            if not global_lighting_change and not lighting_recovery:
                flow_boxes = self._optical_flow_boxes(previous_gray, blurred, now)
            boxes, track_id_hints, ambiguous_track_ids, flow_rejected = self._combine_motion_and_flow(
                boxes, flow_boxes,
            )
            update = self._motion_tracker.update(
                boxes,
                now,
                frame_height=height,
                gate_line_y=self.line_y,
                entry_flow=self.entry_flow,
                gray_frame=blurred,
                track_id_hints=track_id_hints,
                ambiguous_track_ids=ambiguous_track_ids,
            )
        self._previous_gray = blurred
        self._refresh_track_templates(blurred, now)
        if lighting_recovery and self._frames_seen > self._warmup_frames:
            self._lighting_suppress_frames -= 1

        displayed_predictions = [self._prediction(track) for track in update.displayed]
        self._last_debug_masks = (raw_mask, shadow_mask, filtered, resized.copy())
        rejected.extend(flow_rejected)
        self._last_debug_rejected = rejected
        self._last_motion_diagnostics = {
            **update.diagnostics,
            "raw_contours_rejected": rejected_counts,
            "accepted_regions": len(boxes),
            "optical_flow_tracks": len(flow_boxes),
            "flow_track_hints": len(track_id_hints),
            "ambiguous_track_ids": sorted(ambiguous_track_ids),
            "ambiguous_components": len(flow_rejected),
            "global_lighting_change": global_lighting_change,
            "illumination_delta": round(illumination_delta, 2),
            "illumination_coherence": round(illumination_coherence, 3),
            "brightness_change_score": round(abs(illumination_delta), 2),
            "lighting_recovery_frames": self._lighting_suppress_frames,
            "shadow_pixels": int(cv2.countNonZero(shadow_mask)),
        }
        return displayed_predictions, update, {"width": width, "height": height}

    def process(
        self,
        frame: Any,
        *,
        species_detections: list[dict[str, Any]] | None = None,
        detector_timestamp: float | None = None,
    ) -> dict[str, Any]:
        start = perf_counter()
        displayed_predictions, observations, image = self._opencv_predictions(
            frame,
            species_detections,
            detector_timestamp,
        )
        # When a track first becomes ACTIVE, replay its confirmed trajectory so
        # a crossing during the confirmation window is not silently discarded.
        newly_active_ids = {track.tracking_id for track in observations.newly_active}
        timeline: dict[float, list[dict[str, Any]]] = {}
        for track in observations.newly_active:
            for observed_at, box in track.history:
                sample = MotionObservation(
                    tracking_id=track.tracking_id,
                    bbox=box,
                    at=observed_at,
                    movement=track.movement,
                    state="ACTIVE",
                    movement_consistency=track.movement_consistency,
                    box_stability=track.box_stability,
                    species=track.species,
                    confidence=track.confidence,
                )
                timeline.setdefault(observed_at, []).append(self._prediction(sample))
        # Stationary but visually observed animals still refresh their side of
        # the line. Occlusion predictions remain display-only and never count.
        for track in observations.displayed:
            if not track.observed or not track.confirmed:
                continue
            if track.tracking_id not in newly_active_ids:
                timeline.setdefault(track.at, []).append(self._prediction(track))

        new_events: list[dict[str, Any]] = []
        if self.settings_ready:
            for observed_at in sorted(timeline):
                new_events.extend(self.crossing_tracker.observe(
                    timeline[observed_at],
                    image["height"],
                    observed_at,
                    image["width"],
                ))

        if new_events:
            crossed_by_id = {
                event["tracking_id"]: event["event_type"]
                for event in new_events
            }
            for tracking_id, event_type in crossed_by_id.items():
                self._motion_tracker.mark_crossed(tracking_id, event_type)
            for prediction in displayed_predictions:
                event_type = crossed_by_id.get(prediction.get("tracking_id"))
                if event_type:
                    prediction["tracking_state"] = (
                        "CROSSED_ENTRY" if event_type == "ENTRY" else "CROSSED_EXIT"
                    )

        self._last_motion_diagnostics["crossings"] = {
            "events": new_events,
            "observations": self.crossing_tracker.last_diagnostics,
        }
        if self._debug_enabled and self._last_debug_masks is not None:
            raw, shadow, filtered, debug_frame = self._last_debug_masks
            self._save_debug(
                debug_frame,
                raw,
                shadow,
                filtered,
                self._last_debug_rejected,
                monotonic(),
            )

        queued_events: list[dict[str, Any]] = []
        for event in new_events:
            tracker_id = event.get("tracking_id")
            if not isinstance(tracker_id, str) or not tracker_id.isascii() or not tracker_id.isdigit():
                continue
            valid_session_id = (
                self.counting_session_id
                if isinstance(self.counting_session_id, str) and len(self.counting_session_id) == 36
                else None
            )
            queued_events.append({
                "session_id": valid_session_id,
                "event_key": event["event_id"],
                "tracking_id": f"T-{int(tracker_id):03d}",
                "animal_type": event["animal_type"],
                "direction": "entry" if event["direction"] == "IN" else "exit",
                "event_type": event["event_type"],
                "crossing_direction": event["crossing_direction"],
                "previous_side": event["origin_side"],
                "current_side": event["destination_side"],
                "previous_centroid": event["previous_centroid"],
                "current_centroid": event["current_centroid"],
                "line_y": event["line_y"],
                "crossing_margin": event["crossing_margin"],
                "frame_width": event["frame_width"],
                "frame_height": event["frame_height"],
                "minimum_displacement_px": event["minimum_displacement_px"],
                "track_state": event["track_state"],
                "validation_status": event["validation_status"],
                "confidence": round(float(event["confidence"]), 4),
                "config_revision": int(self.config_revision),
            })
        self.outbox.enqueue(queued_events)
        elapsed_ms = (perf_counter() - start) * 1000.0
        return {
            "success": True,
            "animal_count": len(displayed_predictions),
            "entries_total": 0,
            "exits_total": 0,
            "goat_entries_total": 0,
            "goat_exits_total": 0,
            "sheep_entries_total": 0,
            "sheep_exits_total": 0,
            "model_version": "hybrid-ml-opencv" if self.hybrid_mode else "opencv-significant-motion",
            "inference_ms": float(elapsed_ms),
            "image": {"width": int(image["width"]), "height": int(image["height"])},
            "config_revision": self.config_revision,
            "crossings": self.outbox.pending(100),
            "predictions": displayed_predictions[:50],
        }
