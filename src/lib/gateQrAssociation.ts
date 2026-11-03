import type { GateTrack } from './gateTracking';

export interface GateImageBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function intersectionOverUnion(a: GateTrack['box'], b: GateTrack['box']): number {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return intersection / Math.max(Number.EPSILON, areaA + areaB - intersection);
}

/** Match a detector prediction to its current-frame temporary track. */
export function matchDetectionToTrack(
  detection: GateTrack['box'],
  species: GateTrack['species'],
  tracks: readonly GateTrack[],
): GateTrack | undefined {
  const matches = tracks.filter((track) =>
    track.species === species && track.consecutiveMisses === 0 && intersectionOverUnion(detection, track.box) >= 0.9,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Return a track only when the decoded QR center falls in that animal's upper
 * ear/tag zone and that zone is spatially unique in the current frame.
 */
export function matchQrToEarTrack(
  qrBox: GateImageBox,
  tracks: readonly GateTrack[],
): GateTrack | undefined {
  const qrCenterX = (qrBox.x1 + qrBox.x2) / 2;
  const qrCenterY = (qrBox.y1 + qrBox.y2) / 2;
  const qrArea = Math.max(0, qrBox.x2 - qrBox.x1) * Math.max(0, qrBox.y2 - qrBox.y1);
  const candidates = tracks.filter((track) => {
    if (track.consecutiveMisses !== 0 || qrArea <= 0) return false;
    const [x1, y1, x2, y2] = track.box;
    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) return false;
    const upperEarZoneBottom = y1 + height * 0.72;
    const centerIsInEarZone = qrCenterX >= x1 - width * 0.06 && qrCenterX <= x2 + width * 0.06 &&
      qrCenterY >= y1 - height * 0.03 && qrCenterY <= upperEarZoneBottom;
    const qrIsSmallRelativeToAnimal = qrArea / (width * height) <= 0.22 &&
      (qrBox.x2 - qrBox.x1) <= width * 0.55 && (qrBox.y2 - qrBox.y1) <= height * 0.55;
    return centerIsInEarZone && qrIsSmallRelativeToAnimal;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Match a numeric OCR box only when it belongs to one animal's upper tag zone. */
export function matchEartagNumberToEarTrack(
  numberBox: GateImageBox,
  tracks: readonly GateTrack[],
): GateTrack | undefined {
  return matchQrToEarTrack(numberBox, tracks);
}
