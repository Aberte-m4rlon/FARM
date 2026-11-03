import type { GateDirection } from './gateMonitoring';

export type GateSpecies = 'goat' | 'sheep';
export type GateFlow = 'top-to-bottom' | 'bottom-to-top';
export type GateCameraOrientation = 'left-to-inside' | 'right-to-inside' | GateFlow;
export type GateMovementObservation = 'normal' | 'slow_approach' | 'prolonged_stop';
export type GateMovementAnomaly = 'none' | 'repeated_stop_start' | 'repeated_direction_change';

export interface GateDetectionBox {
  species: GateSpecies;
  confidence: number;
  box: [number, number, number, number];
}

export interface GateTrack {
  id: string;
  species: GateSpecies;
  confidence: number;
  /** Latest detector box, used for exact-frame QR matching and association. */
  box: [number, number, number, number];
  /** Smoothed visual box, kept separate so display smoothing cannot weaken QR matching. */
  displayBox: [number, number, number, number];
  center: { x: number; y: number };
  history: Array<{ x: number; y: number; at: number }>;
  disappearanceStartedAt: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  confirmed: boolean;
  consecutiveHits: number;
  consecutiveMisses: number;
  speed: number;
  stationaryMs: number;
  movement: 'normal' | 'slow' | 'stopped';
  movementAnomaly: GateMovementAnomaly;
  observation: GateMovementObservation;
  lastCrossing: {
    direction: GateDirection;
    at: number;
    confidence: number;
    observation: GateMovementObservation;
  } | null;
  previousCenter: { x: number; y: number; at: number } | null;
}

export interface GateCrossing {
  trackingId: string;
  species: GateSpecies;
  direction: GateDirection;
  confidence: number;
  at: number;
  observation: GateMovementObservation;
}

export interface GateTrackingResult {
  tracks: GateTrack[];
  crossings: GateCrossing[];
}

const TRACK_MATCH_TTL_MS = 4_000;
const TRACK_EVENT_RETENTION_MS = 25_000;
const MAX_DISPLAY_MISSES = 4;
const DISPLAY_BOX_SMOOTHING = 0.68;
const MAX_CENTER_DISTANCE = 0.22;
const MIN_IOU_FOR_MATCH = 0.015;
const TRACK_CONFIRMATION_HITS = 2;
const CROSSING_COOLDOWN_MS = 2_000;
const DISAPPEARANCE_GRACE_MS = 3_000;
const ENTRY_APPROACH_MAX_POSITION = 0.3;
const INTERIOR_MIN_POSITION = 0.3;
const CAMERA_EDGE_POSITION = 0.22;
const CROSSING_EVIDENCE_RETENTION_MS = 20_000;
const ANOMALY_WINDOW_MS = 12_000;
const MIN_ANOMALY_OBSERVATION_MS = 8_000;
const MIN_DIRECTION_LEG_DISTANCE = 0.08;
let trackingEpochSequence = 0;

function createTrackingEpoch(): number {
  return Date.now() * 1_000 + trackingEpochSequence++;
}

interface MotionState {
  stableState: 'moving' | 'still' | null;
  candidateState: 'moving' | 'still' | null;
  candidateStateHits: number;
  stateChangesAt: number[];
  direction: { x: number; y: number } | null;
  directionLegDistance: number;
  reverseLegDistance: number;
  reversalsAt: number[];
}

function center(box: [number, number, number, number]) {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

function axisPosition(position: { x: number; y: number }, orientation: GateCameraOrientation): number {
  return orientation === 'top-to-bottom' || orientation === 'bottom-to-top' ? position.y : position.x;
}

function positiveMovementIsEntry(orientation: GateCameraOrientation): boolean {
  return orientation === 'left-to-inside' || orientation === 'top-to-bottom';
}

function smoothBox(
  previous: [number, number, number, number],
  current: [number, number, number, number],
): [number, number, number, number] {
  return current.map((value, index) =>
    previous[index] * (1 - DISPLAY_BOX_SMOOTHING) + value * DISPLAY_BOX_SMOOTHING,
  ) as [number, number, number, number];
}

function inferTrackDirection(
  history: Array<{ x: number; y: number; at: number }>,
  orientation: GateCameraOrientation,
): GateDirection | null {
  const movementHistory: Array<{ x: number; y: number; at: number }> = [];
  for (const position of history) {
    const previous = movementHistory[movementHistory.length - 1];
    if (!previous || Math.hypot(position.x - previous.x, position.y - previous.y) >= 0.03) {
      movementHistory.push(position);
    }
  }
  if (movementHistory.length < 3) return null;
  const recent = movementHistory.slice(-6);
  const axisDelta = axisPosition(recent[recent.length - 1], orientation) - axisPosition(recent[0], orientation);
  if (Math.abs(axisDelta) < 0.08) return null;
  return (axisDelta > 0) === positiveMovementIsEntry(orientation) ? 'entry' : 'exit';
}

function hasTraversedCameraView(
  history: Array<{ x: number; y: number; at: number }>,
  direction: GateDirection | null,
  orientation: GateCameraOrientation,
): boolean {
  if (history.length < 3 || !direction) return false;
  const positions = history.map((position) => axisPosition(position, orientation));
  const endPosition = positions[positions.length - 1];
  const entryMovesPositive = positiveMovementIsEntry(orientation);
  if (direction === 'entry') {
    return entryMovesPositive
      ? positions.some((position) => position <= ENTRY_APPROACH_MAX_POSITION) &&
        positions.some((position) => position >= INTERIOR_MIN_POSITION) && endPosition >= 1 - CAMERA_EDGE_POSITION
      : positions.some((position) => position >= 1 - ENTRY_APPROACH_MAX_POSITION) &&
        positions.some((position) => position <= 1 - INTERIOR_MIN_POSITION) && endPosition <= CAMERA_EDGE_POSITION;
  }
  return entryMovesPositive
    ? positions.some((position) => position >= INTERIOR_MIN_POSITION) && endPosition <= CAMERA_EDGE_POSITION
    : positions.some((position) => position <= 1 - INTERIOR_MIN_POSITION) && endPosition >= 1 - CAMERA_EDGE_POSITION;
}

function intersectionOverUnion(a: GateTrack['box'], b: GateDetectionBox['box']): number {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return intersection / Math.max(Number.EPSILON, areaA + areaB - intersection);
}

/**
 * Short-lived camera tracker for the current gate view. Tracks are temporary,
 * species-scoped, and never count as registered animal identities.
 */
export class GateAnimalTracker {
  private tracks = new Map<string, GateTrack>();
  private motionStates = new Map<string, MotionState>();
  private nextTrackNumber = 1;
  private trackingEpoch = createTrackingEpoch();

  constructor(private readonly orientation: GateCameraOrientation = 'top-to-bottom') {}

  private updateMovementAnomaly(track: GateTrack, deltaX: number, deltaY: number, speed: number, at: number): void {
    const state = this.motionStates.get(track.id) ?? {
      stableState: null,
      candidateState: null,
      candidateStateHits: 0,
      stateChangesAt: [],
      direction: null,
      directionLegDistance: 0,
      reverseLegDistance: 0,
      reversalsAt: [],
    };
    const currentState = speed >= 0.065 ? 'moving' : speed <= 0.02 ? 'still' : null;
    if (!currentState || currentState === state.stableState) {
      state.candidateState = null;
      state.candidateStateHits = 0;
    } else {
      if (state.candidateState === currentState) state.candidateStateHits += 1;
      else {
        state.candidateState = currentState;
        state.candidateStateHits = 1;
      }
      if (state.candidateStateHits >= 2) {
        if (state.stableState) state.stateChangesAt.push(at);
        state.stableState = currentState;
        state.candidateState = null;
        state.candidateStateHits = 0;
      }
    }

    const distance = Math.hypot(deltaX, deltaY);
    if (distance >= 0.035 && speed >= 0.055) {
      const direction = { x: deltaX / distance, y: deltaY / distance };
      if (!state.direction) {
        state.direction = direction;
        state.directionLegDistance = distance;
      } else {
        const alignment = direction.x * state.direction.x + direction.y * state.direction.y;
        if (alignment >= 0.35) {
          state.directionLegDistance += distance;
          state.reverseLegDistance = 0;
        } else if (alignment <= -0.55) {
          state.reverseLegDistance += distance;
          if (
            state.directionLegDistance >= MIN_DIRECTION_LEG_DISTANCE &&
            state.reverseLegDistance >= MIN_DIRECTION_LEG_DISTANCE
          ) {
            state.reversalsAt.push(at);
            state.direction = direction;
            state.directionLegDistance = state.reverseLegDistance;
            state.reverseLegDistance = 0;
          }
        } else {
          // A turn that is not a clear reversal starts a new direction leg.
          state.direction = direction;
          state.directionLegDistance = distance;
          state.reverseLegDistance = 0;
        }
      }
    }

    const cutoff = at - ANOMALY_WINDOW_MS;
    state.stateChangesAt = state.stateChangesAt.filter((time) => time >= cutoff);
    state.reversalsAt = state.reversalsAt.filter((time) => time >= cutoff);
    this.motionStates.set(track.id, state);

    if (at - track.firstSeenAt < MIN_ANOMALY_OBSERVATION_MS) {
      track.movementAnomaly = 'none';
    } else if (state.reversalsAt.length >= 3) {
      track.movementAnomaly = 'repeated_direction_change';
    } else if (state.stateChangesAt.length >= 4) {
      track.movementAnomaly = 'repeated_stop_start';
    } else {
      track.movementAnomaly = 'none';
    }
  }

  update(detections: readonly GateDetectionBox[], at: number): GateTrackingResult {
    const live = [...this.tracks.values()].filter((track) => at - track.lastSeenAt <= TRACK_EVENT_RETENTION_MS);
    const candidates: Array<{ track: GateTrack; detectionIndex: number; score: number }> = [];

    for (const track of live) {
      if (at - track.lastSeenAt > TRACK_MATCH_TTL_MS) continue;
      for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex += 1) {
        const detection = detections[detectionIndex];
        if (track.species !== detection.species) continue;
        const nextCenter = center(detection.box);
        const elapsed = Math.max(0, (at - track.lastSeenAt) / 1_000);
        const previous = track.previousCenter;
        const previousElapsed = previous ? Math.max(0.001, (track.lastSeenAt - previous.at) / 1_000) : 0;
        const predictionScale = previous && elapsed <= 2 ? Math.min(1, elapsed / previousElapsed) : 0;
        const predictedCenter = previous
          ? {
              x: track.center.x + (track.center.x - previous.x) * predictionScale,
              y: track.center.y + (track.center.y - previous.y) * predictionScale,
            }
          : track.center;
        const distance = Math.hypot(nextCenter.x - predictedCenter.x, nextCenter.y - predictedCenter.y);
        const overlap = intersectionOverUnion(track.box, detection.box);
        if (distance > MAX_CENTER_DISTANCE && overlap < MIN_IOU_FOR_MATCH) continue;
        // Short-term motion prediction reduces ID swaps when similar animals pass.
        // Box overlap still helps through slow movement; this is not visual re-identification.
        candidates.push({ track, detectionIndex, score: distance * 0.95 + (1 - overlap) * 0.05 });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const assignedTracks = new Set<string>();
    const assignedDetections = new Set<number>();
    const matched = new Map<string, number>();
    for (const candidate of candidates) {
      if (assignedTracks.has(candidate.track.id) || assignedDetections.has(candidate.detectionIndex)) continue;
      assignedTracks.add(candidate.track.id);
      assignedDetections.add(candidate.detectionIndex);
      matched.set(candidate.track.id, candidate.detectionIndex);
    }

    const crossings: GateCrossing[] = [];
    for (const track of live) {
      const detectionIndex = matched.get(track.id);
      if (detectionIndex === undefined) {
        track.consecutiveMisses += 1;
        track.consecutiveHits = 0;
        track.disappearanceStartedAt ??= at;
        const direction = inferTrackDirection(track.history, this.orientation);
        const cooldownComplete = !track.lastCrossing ||
          (track.lastCrossing.direction !== direction && at - track.lastCrossing.at >= CROSSING_COOLDOWN_MS);
        if (
          track.confirmed &&
          direction &&
          cooldownComplete &&
          at - track.disappearanceStartedAt >= DISAPPEARANCE_GRACE_MS &&
          hasTraversedCameraView(track.history, direction, this.orientation)
        ) {
          const observation = track.observation !== 'normal' ? track.observation : 'normal';
          track.lastCrossing = { direction, at, confidence: track.confidence, observation };
          crossings.push({
            trackingId: track.id,
            species: track.species,
            direction,
            confidence: track.confidence,
            at,
            observation,
          });
        }
        continue;
      }

      const detection = detections[detectionIndex];
      const nextCenter = center(detection.box);
      const previous = { ...track.center, at: track.lastSeenAt };
      const elapsedSeconds = Math.max(0.001, (at - track.lastSeenAt) / 1_000);
      const missedFrames = track.consecutiveMisses;
      const distance = Math.hypot(nextCenter.x - track.center.x, nextCenter.y - track.center.y);
      track.speed = distance / elapsedSeconds;
      this.updateMovementAnomaly(track, nextCenter.x - track.center.x, nextCenter.y - track.center.y, track.speed, at);
      track.stationaryMs = track.speed < 0.018
        ? track.stationaryMs + at - track.lastSeenAt
        : 0;
      track.movement = track.stationaryMs >= 5_000 ? 'stopped' : track.speed < 0.045 ? 'slow' : 'normal';
      track.observation = track.stationaryMs >= 8_000
        ? 'prolonged_stop'
        : track.stationaryMs >= 5_000
          ? 'slow_approach'
          : 'normal';

      track.previousCenter = previous;
      track.center = nextCenter;
      track.box = detection.box;
      track.displayBox = smoothBox(track.displayBox, detection.box);
      track.confidence = detection.confidence;
      track.history = [...track.history, { x: nextCenter.x, y: nextCenter.y, at }].slice(-30);
      track.disappearanceStartedAt = null;
      track.lastSeenAt = at;
      track.consecutiveHits = missedFrames > 0 ? 1 : track.consecutiveHits + 1;
      track.confirmed = track.confirmed || track.consecutiveHits >= TRACK_CONFIRMATION_HITS;
      track.consecutiveMisses = 0;
    }

    for (let index = 0; index < detections.length; index += 1) {
      if (assignedDetections.has(index)) continue;
      const detection = detections[index];
      const point = center(detection.box);
      const id = `T-${this.trackingEpoch}${String(this.nextTrackNumber++).padStart(3, '0')}`;
      this.tracks.set(id, {
        id,
        species: detection.species,
        confidence: detection.confidence,
        box: detection.box,
        displayBox: [...detection.box],
        center: point,
        history: [{ x: point.x, y: point.y, at }],
        disappearanceStartedAt: null,
        firstSeenAt: at,
        lastSeenAt: at,
        confirmed: false,
        consecutiveHits: 1,
        consecutiveMisses: 0,
        speed: 0,
        stationaryMs: 0,
        movement: 'normal',
        movementAnomaly: 'none',
        observation: 'normal',
        lastCrossing: null,
        previousCenter: null,
      });
    }

    for (const [id, track] of this.tracks) {
      if (at - track.lastSeenAt > TRACK_EVENT_RETENTION_MS) {
        this.tracks.delete(id);
        this.motionStates.delete(id);
      }
    }

    return {
      tracks: [...this.tracks.values()]
        .filter((track) =>
          track.confirmed && (
            track.consecutiveMisses <= MAX_DISPLAY_MISSES ||
            Boolean(track.lastCrossing && at - track.lastCrossing.at <= CROSSING_EVIDENCE_RETENTION_MS)
          ),
        )
        .map((track) => ({
          ...track,
          box: [...track.box] as GateTrack['box'],
          displayBox: [...track.displayBox] as GateTrack['displayBox'],
          center: { ...track.center },
          history: track.history.map((position) => ({ ...position })),
        })),
      crossings,
    };
  }

  reset(): void {
    this.tracks.clear();
    this.motionStates.clear();
    this.nextTrackNumber = 1;
    this.trackingEpoch = createTrackingEpoch();
  }
}
