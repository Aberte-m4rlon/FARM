from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np


Box = tuple[float, float, float, float]
Point = tuple[float, float]


@dataclass(frozen=True)
class MotionTrackerConfig:
    min_displacement_px: float = 1.25
    min_accumulated_movement_px: float = 8.0
    min_movement_duration_seconds: float = 0.65
    confirmation_frames: int = 3
    max_tracking_distance_px: float = 85.0
    min_motion_consistency: float = 0.35
    min_box_stability: float = 0.08
    box_smoothing: float = 0.6
    max_box_smoothing: float = 0.95
    slow_velocity_px_s: float = 30.0
    fast_velocity_px_s: float = 240.0
    max_adaptive_distance_multiplier: float = 2.5
    lost_track_timeout_seconds: float = 20.0
    occlusion_grace_seconds: float = 5.0
    candidate_timeout_seconds: float = 3.0
    stationary_grace_seconds: float = 2.5
    prediction_max_seconds: float = 0.5
    prediction_max_displacement_px: float = 85.0
    queue_wait_grace_seconds: float = 20.0
    queue_waiting_band_px: float = 28.0
    history_size: int = 10


@dataclass
class MotionTrack:
    tracking_id: str
    bbox: Box
    centroid: Point
    observed_centroid: Point
    created_at: float
    last_seen_at: float
    state: str = "DETECTED"
    confirmed: bool = False
    crossing_state: str | None = None
    species: str = "unknown"
    confidence: float = 0.0
    detector_hits: int = 0
    last_detector_at: float | None = None
    hits: int = 1
    movement_hits: int = 0
    accumulated_movement: float = 0.0
    movement_started_at: float | None = None
    last_movement_at: float | None = None
    vectors: deque[Point] = field(default_factory=deque)
    box_areas: deque[float] = field(default_factory=deque)
    history: deque[tuple[float, Box]] = field(default_factory=deque)
    movement_consistency: float = 0.0
    box_stability: float = 0.0
    displacement: float = 0.0
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    box_alpha: float = 0.0
    appearance: np.ndarray | None = None
    queue_direction: str | None = None
    last_queue_direction: str | None = None
    queue_position: int | None = None
    gate_distance_px: float | None = None
    signed_gate_distance_px: float | None = None
    time_to_gate_seconds: float | None = None
    movement_direction: str = "stationary"
    priority: bool = False
    identity_uncertain: bool = False
    reacquired: bool = False
    last_ambiguous_at: float | None = None
    kalman: Any | None = None


@dataclass(frozen=True)
class MotionObservation:
    tracking_id: str
    bbox: Box
    at: float
    movement: float
    state: str
    history: tuple[tuple[float, Box], ...] = ()
    movement_consistency: float = 0.0
    box_stability: float = 0.0
    observed: bool = True
    confirmed: bool = True
    species: str = "unknown"
    confidence: float = 0.0
    queue_direction: str | None = None
    queue_position: int | None = None
    gate_distance_px: float | None = None
    movement_direction: str = "stationary"
    priority: bool = False
    identity_uncertain: bool = False


@dataclass(frozen=True)
class MotionUpdate:
    active: tuple[MotionObservation, ...]
    displayed: tuple[MotionObservation, ...]
    newly_active: tuple[MotionObservation, ...]
    diagnostics: dict[str, Any]


def _centroid(box: Box) -> Point:
    return ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)


def _area(box: Box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _iou(left: Box, right: Box) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = _area(left) + _area(right) - intersection
    return intersection / union if union > 0 else 0.0


def _linear_assignment(costs: np.ndarray) -> list[tuple[int, int]]:
    """Rectangular Hungarian assignment; deterministic and dependency-free."""
    if costs.ndim != 2 or not costs.size:
        return []
    rows, columns = costs.shape
    if rows > columns:
        raise ValueError("Assignment matrix must have at least as many columns as rows.")
    u = np.zeros(rows + 1, dtype=np.float64)
    v = np.zeros(columns + 1, dtype=np.float64)
    p = np.zeros(columns + 1, dtype=np.int32)
    way = np.zeros(columns + 1, dtype=np.int32)
    for i in range(1, rows + 1):
        p[0] = i
        j0 = 0
        minimum = np.full(columns + 1, np.inf, dtype=np.float64)
        used = np.zeros(columns + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta, j1 = np.inf, 0
            for j in range(1, columns + 1):
                if used[j]:
                    continue
                current = float(costs[i0 - 1, j - 1]) - u[i0] - v[j]
                if current < minimum[j]:
                    minimum[j], way[j] = current, j0
                if minimum[j] < delta:
                    delta, j1 = minimum[j], j
            for j in range(columns + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minimum[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return [(int(p[j] - 1), j - 1) for j in range(1, columns + 1) if p[j] > 0]


class SignificantMotionTracker:
    """Confirm motion once, then preserve identity through stops and brief occlusion."""

    def __init__(self, config: MotionTrackerConfig | None = None) -> None:
        self.config = config or MotionTrackerConfig()
        self._tracks: dict[str, MotionTrack] = {}
        self._next_id = 1
        self._recently_expired = 0
        self._recently_expired_details: list[dict[str, Any]] = []
        self._last_frame_height: int | None = None
        self._last_gate_line_y: float | None = None
        self._last_entry_flow = "top-to-bottom"

    def _new_track(self, box: Box, now: float) -> MotionTrack:
        center = _centroid(box)
        kalman = cv2.KalmanFilter(4, 2)
        kalman.transitionMatrix = np.array(
            [[1, 0, 0.1, 0], [0, 1, 0, 0.1], [0, 0, 1, 0], [0, 0, 0, 1]],
            dtype=np.float32,
        )
        kalman.measurementMatrix = np.array(
            [[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float32,
        )
        kalman.processNoiseCov = np.diag([0.3, 0.3, 8.0, 8.0]).astype(np.float32)
        kalman.measurementNoiseCov = np.diag([4.0, 4.0]).astype(np.float32)
        kalman.errorCovPost = np.diag([10.0, 10.0, 100.0, 100.0]).astype(np.float32)
        kalman.statePost = np.array(
            [[center[0]], [center[1]], [0.0], [0.0]], dtype=np.float32,
        )
        track = MotionTrack(
            tracking_id=str(self._next_id),
            bbox=box,
            centroid=center,
            observed_centroid=center,
            created_at=now,
            last_seen_at=now,
            vectors=deque(maxlen=self.config.history_size),
            box_areas=deque(maxlen=self.config.history_size),
            history=deque(maxlen=self.config.history_size),
            kalman=kalman,
        )
        self._next_id += 1
        track.box_areas.append(_area(box))
        track.history.append((now, box))
        self._tracks[track.tracking_id] = track
        return track

    def _reset_evidence(self, track: MotionTrack) -> None:
        track.movement_hits = 0
        track.accumulated_movement = 0.0
        track.movement_started_at = None
        track.last_movement_at = None
        track.vectors.clear()
        track.box_areas.clear()
        track.history.clear()
        track.movement_consistency = 0.0
        track.box_stability = 0.0
        track.velocity_x = 0.0
        track.velocity_y = 0.0
        track.box_alpha = 0.0
        track.appearance = None

    def _update_measurements(self, track: MotionTrack, box: Box, now: float) -> None:
        centroid = _centroid(box)
        previous_centroid = track.observed_centroid
        dx = centroid[0] - previous_centroid[0]
        dy = centroid[1] - previous_centroid[1]
        displacement = math.hypot(dx, dy)
        track.displacement = displacement

        elapsed = max(now - track.last_seen_at, 1e-3)
        if track.kalman is not None:
            dt = min(1.0, max(1.0 / 120.0, elapsed))
            track.kalman.transitionMatrix = np.array(
                [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]],
                dtype=np.float32,
            )
            track.kalman.predict()
            track.kalman.correct(np.array([[centroid[0]], [centroid[1]]], dtype=np.float32))
        velocity_x = dx / elapsed
        velocity_y = dy / elapsed
        velocity = math.hypot(velocity_x, velocity_y)
        previous_speed = math.hypot(track.velocity_x, track.velocity_y)
        turn_cosine = (
            (velocity_x * track.velocity_x + velocity_y * track.velocity_y)
            / (velocity * previous_speed)
            if velocity > 0 and previous_speed > 0
            else 1.0
        )
        velocity_weight = 0.85 if turn_cosine < 0.25 else 0.55
        track.velocity_x += (velocity_x - track.velocity_x) * velocity_weight
        track.velocity_y += (velocity_y - track.velocity_y) * velocity_weight

        speed_ratio = min(
            1.0,
            max(
                0.0,
                (velocity - self.config.slow_velocity_px_s)
                / max(self.config.fast_velocity_px_s - self.config.slow_velocity_px_s, 1e-3),
            ),
        )
        max_alpha = max(self.config.box_smoothing, self.config.max_box_smoothing)
        alpha = self.config.box_smoothing + (max_alpha - self.config.box_smoothing) * speed_ratio
        if track.priority:
            alpha = max(alpha, min(0.98, max_alpha))
        if turn_cosine < 0.25:
            alpha = max(alpha, max_alpha)
        alpha = min(1.0, max(0.0, alpha))
        track.box_alpha = alpha
        track.bbox = tuple(old + (new - old) * alpha for old, new in zip(track.bbox, box))  # type: ignore[assignment]
        track.centroid = _centroid(track.bbox)
        track.observed_centroid = centroid
        track.last_seen_at = now
        track.hits += 1
        track.box_areas.append(_area(box))
        track.history.append((now, box))

        if displacement >= self.config.min_displacement_px:
            if track.movement_started_at is None:
                track.movement_started_at = now
            track.movement_hits += 1
            track.accumulated_movement += displacement
            track.last_movement_at = now
            track.vectors.append((dx / displacement, dy / displacement))

        if track.vectors:
            vector_x = sum(vector[0] for vector in track.vectors)
            vector_y = sum(vector[1] for vector in track.vectors)
            track.movement_consistency = math.hypot(vector_x, vector_y) / len(track.vectors)
        if len(track.box_areas) >= 2:
            largest_area = max(track.box_areas)
            track.box_stability = min(track.box_areas) / largest_area if largest_area else 0.0
        elif track.box_areas:
            track.box_stability = 1.0
        speed = math.hypot(track.velocity_x, track.velocity_y)
        if speed < 5.0:
            track.movement_direction = "stationary"
        else:
            angle = (math.degrees(math.atan2(-track.velocity_y, track.velocity_x)) + 360.0) % 360.0
            directions = ("right", "up-right", "up", "up-left", "left", "down-left", "down", "down-right")
            track.movement_direction = directions[int((angle + 22.5) // 45.0) % 8]

    @staticmethod
    def _appearance_feature(gray_frame: np.ndarray | None, box: Box) -> np.ndarray | None:
        if gray_frame is None or gray_frame.ndim != 2:
            return None
        height, width = gray_frame.shape[:2]
        x1, y1 = max(0, int(box[0])), max(0, int(box[1]))
        x2, y2 = min(width, int(math.ceil(box[2]))), min(height, int(math.ceil(box[3])))
        if x2 - x1 < 12 or y2 - y1 < 12:
            return None
        crop = gray_frame[y1:y2, x1:x2]
        resized = cv2.resize(crop, (12, 12), interpolation=cv2.INTER_AREA).astype(np.float32)
        resized -= float(resized.mean())
        norm = float(np.linalg.norm(resized))
        if norm < 1.0:
            return None
        return resized.reshape(-1) / norm

    def _update_queue_priorities(
        self,
        now: float,
        frame_height: int | None,
        gate_line_y: float | None,
        entry_flow: str,
    ) -> None:
        if not frame_height or gate_line_y is None:
            return
        line_px = gate_line_y * frame_height
        entry_sign = 1 if entry_flow == "top-to-bottom" else -1
        queues: dict[str, list[MotionTrack]] = {"ENTRY": [], "EXIT": []}
        for track in self._tracks.values():
            track.queue_position = None
            track.priority = False
            if not track.confirmed:
                continue
            signed = line_px - track.observed_centroid[1]
            distance = abs(signed)
            track.signed_gate_distance_px = signed
            track.gate_distance_px = distance
            vertical_speed = track.velocity_y
            if abs(vertical_speed) >= 5.0:
                if signed * vertical_speed > 0:
                    direction = "ENTRY" if (1 if vertical_speed > 0 else -1) == entry_sign else "EXIT"
                    track.queue_direction = direction
                    track.last_queue_direction = direction
                elif abs(vertical_speed) >= 10.0:
                    track.queue_direction = None
                    track.last_queue_direction = None
            elif (
                distance <= self.config.queue_waiting_band_px
                and track.last_queue_direction
                and track.last_movement_at is not None
                and now - track.last_movement_at <= self.config.queue_wait_grace_seconds
            ):
                track.queue_direction = track.last_queue_direction
            elif (
                track.last_movement_at is not None
                and now - track.last_movement_at > self.config.queue_wait_grace_seconds
            ):
                track.queue_direction = None
            track.time_to_gate_seconds = (
                distance / abs(vertical_speed) if abs(vertical_speed) >= 5.0 else None
            )
            if track.queue_direction in queues and not track.identity_uncertain:
                queues[track.queue_direction].append(track)
        for queue in queues.values():
            queue.sort(key=lambda item: (
                0 if item.gate_distance_px is not None and item.gate_distance_px <= self.config.queue_waiting_band_px else 1,
                item.gate_distance_px if item.gate_distance_px is not None else float("inf"),
                item.time_to_gate_seconds if item.time_to_gate_seconds is not None else float("inf"),
                item.created_at,
            ))
            for position, track in enumerate(queue, start=1):
                track.queue_position = position
                track.priority = position == 1

    def _is_confirmed(self, track: MotionTrack, now: float) -> bool:
        if track.movement_started_at is None:
            return False
        duration = now - track.movement_started_at
        required_hits = max(2, self.config.confirmation_frames - 1)
        return (
            track.movement_hits >= required_hits
            and duration >= self.config.min_movement_duration_seconds
            and track.accumulated_movement >= self.config.min_accumulated_movement_px
            and track.movement_consistency >= self.config.min_motion_consistency
            and track.box_stability >= self.config.min_box_stability
        )

    def _observed_state(
        self,
        track: MotionTrack,
        frame_height: int | None,
        gate_line_y: float | None,
    ) -> str:
        if not track.confirmed:
            return "DETECTED"
        if track.crossing_state is not None:
            return track.crossing_state
        if frame_height and gate_line_y is not None:
            line_delta = gate_line_y * frame_height - track.observed_centroid[1]
            line_distance = abs(line_delta)
            waiting_band = max(12.0, frame_height * 0.035)
            if line_distance <= waiting_band and track.displacement < self.config.min_displacement_px:
                return "WAITING"
            if track.displacement >= self.config.min_displacement_px:
                return "APPROACHING_GATE" if track.velocity_y * line_delta > 0 else "MOVING"
        if track.displacement < self.config.min_displacement_px:
            return "TEMPORARILY_STATIONARY"
        return "APPROACHING_GATE"

    def mark_crossed(self, tracking_id: str, event_type: str) -> bool:
        """Keep the same visible track and record its last confirmed gate direction."""
        track = self._tracks.get(tracking_id)
        if track is None or not track.confirmed or event_type not in {"ENTRY", "EXIT"}:
            return False
        track.crossing_state = "CROSSED_ENTRY" if event_type == "ENTRY" else "CROSSED_EXIT"
        track.state = track.crossing_state
        track.queue_direction = None
        track.last_queue_direction = None
        self._update_queue_priorities(
            track.last_seen_at,
            self._last_frame_height,
            self._last_gate_line_y,
            self._last_entry_flow,
        )
        return True

    def expire_track(self, tracking_id: str, *, reason: str) -> bool:
        """Drop an impossible/static-background association immediately and safely."""
        track = self._tracks.pop(tracking_id, None)
        if track is None:
            return False
        track.state = "EXPIRED"
        self._recently_expired += 1
        self._recently_expired_details.append({
            "tracking_id": tracking_id,
            "last_reliable_bbox": [round(value, 1) for value in track.bbox],
            "final_location_uncertain": track.confirmed,
            "reason": reason,
        })
        return True

    def tracking_state(self) -> dict[str, Any]:
        """Expose bounded current boxes to the OpenCV optical-flow stage."""
        return {
            "tracks": [
                {
                    "tracking_id": track.tracking_id,
                    "bbox": [round(value, 1) for value in track.bbox],
                    "state": track.state,
                    "confirmed": track.confirmed,
                    "species": track.species,
                    "priority": track.priority,
                    "queue_direction": track.queue_direction,
                    "queue_position": track.queue_position,
                    "identity_uncertain": track.identity_uncertain,
                    "last_seen_at": track.last_seen_at,
                }
                for track in self._tracks.values()
            ]
        }

    def _predicted_bbox(self, track: MotionTrack, elapsed: float) -> Box:
        seconds = min(max(elapsed, 0.0), self.config.prediction_max_seconds)
        dx = track.velocity_x * seconds
        dy = track.velocity_y * seconds
        if track.kalman is not None:
            state = track.kalman.statePost.reshape(-1)
            dx = (float(state[0]) + float(state[2]) * seconds) - track.centroid[0]
            dy = (float(state[1]) + float(state[3]) * seconds) - track.centroid[1]
        distance = math.hypot(dx, dy)
        limit = max(0.0, self.config.prediction_max_displacement_px)
        if distance > limit > 0:
            scale = limit / distance
            dx *= scale
            dy *= scale
        elif limit == 0:
            dx = dy = 0.0
        return (track.bbox[0] + dx, track.bbox[1] + dy, track.bbox[2] + dx, track.bbox[3] + dy)

    def update(
        self,
        boxes: list[Box],
        now: float,
        *,
        frame_height: int | None = None,
        gate_line_y: float | None = None,
        entry_flow: str = "top-to-bottom",
        detector_observations: dict[int, dict[str, Any]] | None = None,
        detector_at: float | None = None,
        require_detector_confirmation: bool = False,
        single_hit_confidence: float = 1.1,
        gray_frame: np.ndarray | None = None,
        track_id_hints: dict[int, str] | None = None,
        ambiguous_track_ids: set[str] | None = None,
    ) -> MotionUpdate:
        self._last_frame_height = frame_height
        self._last_gate_line_y = gate_line_y
        self._last_entry_flow = entry_flow if entry_flow in {"top-to-bottom", "bottom-to-top"} else "top-to-bottom"
        self._update_queue_priorities(now, frame_height, gate_line_y, self._last_entry_flow)
        valid_boxes = [
            box for box in boxes
            if len(box) == 4 and all(math.isfinite(value) for value in box)
            and box[2] > box[0] and box[3] > box[1]
        ]
        ambiguous = set(ambiguous_track_ids or ())
        assignments: list[tuple[str, int]] = []
        matched_tracks: set[str] = set()
        matched_boxes: set[int] = set()
        for raw_index, tracking_id in (track_id_hints or {}).items():
            index = int(raw_index)
            if (
                0 <= index < len(valid_boxes)
                and tracking_id in self._tracks
                and tracking_id not in ambiguous
                and tracking_id not in matched_tracks
                and index not in matched_boxes
            ):
                assignments.append((tracking_id, index))
                matched_tracks.add(tracking_id)
                matched_boxes.add(index)

        track_ids = [
            tracking_id for tracking_id, track in self._tracks.items()
            if tracking_id not in matched_tracks and tracking_id not in ambiguous
            and now - track.last_seen_at <= (
                self.config.lost_track_timeout_seconds if track.confirmed
                else self.config.candidate_timeout_seconds
            )
        ]
        box_ids = [index for index in range(len(valid_boxes)) if index not in matched_boxes]
        if track_ids:
            unmatched_cost = 0.88
            costs = np.full((len(track_ids), len(box_ids) + len(track_ids)), unmatched_cost, dtype=np.float64)
            costs[:, :len(box_ids)] = 1e6
            for row, tracking_id in enumerate(track_ids):
                track = self._tracks[tracking_id]
                elapsed = max(0.0, now - track.last_seen_at)
                prediction_time = min(elapsed, self.config.prediction_max_seconds)
                predicted_center = (
                    track.centroid[0] + track.velocity_x * prediction_time,
                    track.centroid[1] + track.velocity_y * prediction_time,
                )
                if track.kalman is not None:
                    state = track.kalman.statePost.reshape(-1)
                    predicted_center = (
                        float(state[0]) + float(state[2]) * prediction_time,
                        float(state[1]) + float(state[3]) * prediction_time,
                    )
                speed = math.hypot(track.velocity_x, track.velocity_y)
                adaptive_distance = self.config.max_tracking_distance_px + min(
                    speed * elapsed * 1.5,
                    self.config.max_tracking_distance_px * (self.config.max_adaptive_distance_multiplier - 1.0),
                )
                for col, index in enumerate(box_ids):
                    box = valid_boxes[index]
                    distance = math.dist(predicted_center, _centroid(box))
                    if distance > adaptive_distance:
                        continue
                    area_ratio_penalty = (
                        min(1.0, abs(math.log(max(_area(box), 1.0) / max(_area(track.bbox), 1.0))))
                    )
                    if track.identity_uncertain and (
                        distance > min(38.0, max(18.0, adaptive_distance * 0.4))
                        or area_ratio_penalty > 0.75
                    ):
                        continue
                    cost = (
                        0.68 * distance / max(adaptive_distance, 1.0)
                        + 0.18 * (1.0 - _iou(track.bbox, box))
                        + 0.08 * area_ratio_penalty
                    )
                    candidate_appearance = self._appearance_feature(gray_frame, box)
                    if track.appearance is not None and candidate_appearance is not None:
                        appearance_distance = 1.0 - float(np.clip(np.dot(track.appearance, candidate_appearance), -1.0, 1.0))
                        cost += 0.06 * appearance_distance
                    costs[row, col] = cost + col * 1e-8 + row * 1e-10
                costs[row, len(box_ids):] += np.arange(len(track_ids)) * 1e-8
            for row, col in _linear_assignment(costs):
                if col < len(box_ids) and costs[row, col] < unmatched_cost:
                    tracking_id, index = track_ids[row], box_ids[col]
                    assignments.append((tracking_id, index))
                    matched_tracks.add(tracking_id)
                    matched_boxes.add(index)

        for index, box in enumerate(valid_boxes):
            if index not in matched_boxes:
                box_center = _centroid(box)
                shadowed_by_ambiguous_track = any(
                    track.confirmed and track.identity_uncertain
                    and (
                        _iou(track.bbox, box) >= 0.04
                        or math.dist(track.centroid, box_center) < self.config.max_tracking_distance_px * 0.55
                    )
                    for track in self._tracks.values()
                )
                if shadowed_by_ambiguous_track:
                    continue
                track = self._new_track(box, now)
                matched_tracks.add(track.tracking_id)
                matched_boxes.add(index)
                assignments.append((track.tracking_id, index))

        newly_active: list[MotionObservation] = []
        active: list[MotionObservation] = []
        displayed: list[MotionObservation] = []
        for tracking_id, index in assignments:
            track = self._tracks[tracking_id]
            previously_occluded = track.state in {"TEMPORARILY_OCCLUDED", "LOST", "AMBIGUOUS"}
            track.reacquired = previously_occluded or track.identity_uncertain
            track.identity_uncertain = False
            track.last_ambiguous_at = None
            candidate_displacement = math.dist(track.observed_centroid, _centroid(valid_boxes[index]))
            previous_motion_gap = (
                now - track.last_movement_at if track.last_movement_at is not None else float("inf")
            )
            if (
                not track.confirmed
                and candidate_displacement >= self.config.min_displacement_px
                and track.last_movement_at is not None
                and previous_motion_gap > self.config.stationary_grace_seconds
            ):
                self._reset_evidence(track)
                track.state = "DETECTED"
            if (
                not track.confirmed
                and track.last_movement_at is not None
                and now - track.last_movement_at > self.config.stationary_grace_seconds
            ):
                self._reset_evidence(track)
                track.state = "DETECTED"

            self._update_measurements(track, valid_boxes[index], now)
            appearance = self._appearance_feature(gray_frame, valid_boxes[index])
            if appearance is not None:
                track.appearance = appearance if track.appearance is None else (
                    0.8 * track.appearance + 0.2 * appearance
                )
                norm = float(np.linalg.norm(track.appearance))
                if norm > 0:
                    track.appearance /= norm
            metadata = (detector_observations or {}).get(index)
            if metadata is not None:
                species = metadata.get("class")
                confidence = metadata.get("confidence")
                if species in {"goat", "sheep"} and isinstance(confidence, (int, float)):
                    track.species = species
                    track.confidence = float(confidence)
                    if detector_at is not None and (
                        track.last_detector_at is None or detector_at > track.last_detector_at
                    ):
                        track.detector_hits += 1
                        track.last_detector_at = detector_at
            if require_detector_confirmation:
                candidate_confirmed = track.detector_hits >= 2 or (
                    track.detector_hits == 1 and track.confidence >= single_hit_confidence
                )
            else:
                candidate_confirmed = self._is_confirmed(track, now) or track.detector_hits >= 2
            if not track.confirmed and candidate_confirmed:
                track.confirmed = True
                track.state = self._observed_state(track, frame_height, gate_line_y)
                newly_active.append(self._observation(track, now, include_history=True))
            elif track.confirmed:
                track.state = self._observed_state(track, frame_height, gate_line_y)
            if track.reacquired and track.confirmed:
                track.state = "REACQUIRED"
            if not track.confirmed:
                continue
            observation = self._observation(track, now, observed=True)
            displayed.append(observation)
            if track.displacement >= self.config.min_displacement_px:
                active.append(observation)

        expired_now = 0
        for tracking_id, track in list(self._tracks.items()):
            if tracking_id in matched_tracks:
                continue
            visibility_age = max(0.0, now - track.last_seen_at)
            timeout = self.config.lost_track_timeout_seconds if track.confirmed else self.config.candidate_timeout_seconds
            if visibility_age >= timeout:
                track.state = "EXPIRED"
                expired_now += 1
                self._recently_expired += 1
                self._recently_expired_details.append({
                    "tracking_id": tracking_id,
                    "last_reliable_bbox": [round(value, 1) for value in track.bbox],
                    "final_location_uncertain": track.confirmed,
                    "reason": "ambiguous_identity" if tracking_id in ambiguous else "not_reacquired",
                })
                del self._tracks[tracking_id]
                continue
            if tracking_id in ambiguous:
                track.identity_uncertain = True
                track.last_ambiguous_at = now
                track.state = "AMBIGUOUS"
                if track.confirmed and visibility_age <= self.config.occlusion_grace_seconds:
                    displayed.append(self._observation(track, now, observed=False, bbox=track.bbox))
                continue
            if not track.confirmed:
                track.state = "DETECTED"
                continue
            if visibility_age <= self.config.occlusion_grace_seconds:
                track.state = "TEMPORARILY_OCCLUDED"
                displayed.append(self._observation(
                    track, now, observed=False, bbox=self._predicted_bbox(track, visibility_age),
                ))
            else:
                track.state = "LOST"

        self._update_queue_priorities(now, frame_height, gate_line_y, self._last_entry_flow)

        state_names = (
            "DETECTED", "APPROACHING_GATE", "MOVING", "WAITING", "WAITING_TO_CROSS", "REACQUIRED",
            "AMBIGUOUS", "CROSSED_ENTRY", "CROSSED_EXIT", "TEMPORARILY_STATIONARY",
            "TEMPORARILY_OCCLUDED", "LOST", "EXPIRED",
        )
        counts = {name: 0 for name in state_names}
        details: list[dict[str, Any]] = []
        for track in self._tracks.values():
            counts[track.state] = counts.get(track.state, 0) + 1
            details.append({
                "tracking_id": track.tracking_id,
                "state": track.state,
                "confirmed": track.confirmed,
                "species": track.species,
                "confidence": round(track.confidence, 4),
                "detector_hits": track.detector_hits,
                "displacement_px": round(track.displacement, 1),
                "velocity_x_px_s": round(track.velocity_x, 1),
                "velocity_y_px_s": round(track.velocity_y, 1),
                "speed_px_s": round(math.hypot(track.velocity_x, track.velocity_y), 1),
                "movement_direction": track.movement_direction,
                "queue_direction": track.queue_direction,
                "queue_position": track.queue_position,
                "gate_distance_px": round(track.gate_distance_px, 1) if track.gate_distance_px is not None else None,
                "signed_gate_distance_px": round(track.signed_gate_distance_px, 1) if track.signed_gate_distance_px is not None else None,
                "time_to_gate_seconds": round(track.time_to_gate_seconds, 2) if track.time_to_gate_seconds is not None else None,
                "priority": track.priority,
                "identity_uncertain": track.identity_uncertain,
                "box_smoothing": round(track.box_alpha, 3),
                "bbox_lag_px": round(math.dist(track.centroid, track.observed_centroid), 1),
                "accumulated_movement_px": round(track.accumulated_movement, 1),
                "movement_consistency": round(track.movement_consistency, 2),
                "box_stability": round(track.box_stability, 2),
                "movement_hits": track.movement_hits,
                "bbox": [round(value, 1) for value in track.bbox],
            })
        counts["EXPIRED"] = expired_now
        diagnostics = {
            "states": counts,
            "recently_expired": self._recently_expired,
            "recently_expired_tracks": list(self._recently_expired_details),
            "tracks": details,
            "leading_tracks": {
                direction.lower(): next((track.tracking_id for track in self._tracks.values()
                    if track.queue_direction == direction and track.queue_position == 1), None)
                for direction in ("ENTRY", "EXIT")
            },
        }
        self._recently_expired = 0
        self._recently_expired_details.clear()
        return MotionUpdate(tuple(active), tuple(displayed), tuple(newly_active), diagnostics)

    @staticmethod
    def _observation(
        track: MotionTrack,
        now: float,
        *,
        include_history: bool = False,
        observed: bool = True,
        bbox: Box | None = None,
    ) -> MotionObservation:
        return MotionObservation(
            tracking_id=track.tracking_id,
            bbox=track.bbox if bbox is None else bbox,
            at=now,
            movement=track.displacement,
            state=track.state,
            history=tuple(track.history) if include_history else (),
            movement_consistency=track.movement_consistency,
            box_stability=track.box_stability,
            observed=observed,
            confirmed=track.confirmed,
            species=track.species,
            confidence=track.confidence,
            queue_direction=track.queue_direction,
            queue_position=track.queue_position,
            gate_distance_px=track.gate_distance_px,
            movement_direction=track.movement_direction,
            priority=track.priority,
            identity_uncertain=track.identity_uncertain,
        )
