import { isAnimalActive } from './animalLifecycle';

export type DomainGateDirection = 'entry' | 'exit';

export interface DomainGateEvent {
  animal_id: string;
  direction: DomainGateDirection;
  qr_verified?: boolean;
  eartag_verified?: boolean;
  created_at: string;
}

export interface FarmAnimalQrRecord {
  id: string;
  user_id: string;
  public_qr_token?: string | null;
  tag_id: string;
  name: string;
  species: string;
  eartag_number?: number | null;
  archived?: boolean | null;
  is_sold?: boolean | null;
  status?: string | null;
}

export type FarmQrResolution<T extends FarmAnimalQrRecord = FarmAnimalQrRecord> =
  | { status: 'verified'; animal: T }
  | { status: 'unknown'; message: string };

export function getActiveAnimals<T extends {
  id: string;
  archived?: boolean | null;
  is_sold?: boolean | null;
  status?: string | null;
}>(animals: T[]): T[] {
  return animals.filter(isAnimalActive);
}

export function isGateScanDebounced(priorScanAt: number | undefined, now: number, debounceMs: number): boolean {
  return priorScanAt !== undefined && now >= priorScanAt && now - priorScanAt < debounceMs;
}

export function gateMovementDebounceKey(animalId: string, direction: DomainGateDirection): string {
  return `${animalId}:${direction}`;
}

export function shouldPlayNewActiveAlertSound(
  soundEnabled: boolean,
  seenAlertIds: ReadonlySet<string>,
  alerts: readonly { id: string; status: string }[],
): boolean {
  return soundEnabled && alerts.some((alert) => alert.status === 'active' && !seenAlertIds.has(alert.id));
}

export function normalizeEartagNumber(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const rawValue = typeof value === 'number' ? String(value) : String(value).trim();
  if (!rawValue) return null;

  if (!/^[0-9]{1,6}$/.test(rawValue)) return null;
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return String(parsed);
}

export function getAnimalEartagNumber(tagId: string | null | undefined): string | null {
  if (!tagId) return null;
  return normalizeEartagNumber(tagId);
}

export function isValidEartagNumber(value: string | number | null | undefined): boolean {
  return normalizeEartagNumber(value) !== null;
}

export function normalizeEartagCode(value: string | number | null | undefined): string | null {
  return normalizeEartagNumber(value);
}

export function resolveFarmAnimalEartag<T extends FarmAnimalQrRecord>(
  rawValue: string,
  farmId: string,
  farmAnimals: T[],
): FarmQrResolution<T> {
  const decoded = rawValue.trim();
  if (!decoded) {
    return { status: 'unknown', message: 'Walang nabasang eartag number.' };
  }

  let normalizedReference: string;
  try {
    normalizedReference = decodeURIComponent(decoded).trim();
  } catch {
    return { status: 'unknown', message: 'Hindi mabasa ang eartag number.' };
  }
  const candidateNumber = normalizeEartagNumber(normalizedReference);
  if (!candidateNumber) {
    return { status: 'unknown', message: 'Hindi valid ang eartag number.' };
  }

  const animal = getActiveAnimals(farmAnimals).find((candidate) => {
    if (candidate.user_id !== farmId) return false;
    return normalizeEartagNumber(candidate.eartag_number) === candidateNumber;
  });

  if (!animal) {
    return { status: 'unknown', message: 'Hindi ma-verify ang eartag number sa mga aktibong hayop ng bukid na ito.' };
  }

  return { status: 'verified', animal };
}

export function getGateAnimalSets(expectedIds: string[], events: readonly DomainGateEvent[]) {
  const hasVerifiedIdentity = (event: DomainGateEvent) => Boolean(event.qr_verified || event.eartag_verified);
  const confirmed = new Set(events.filter(hasVerifiedIdentity).map((event) => event.animal_id));
  const latestDirection = new Map<string, DomainGateDirection>();
  for (const event of events.filter(hasVerifiedIdentity).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    latestDirection.set(event.animal_id, event.direction);
  }
  const inside = new Set(
    [...latestDirection.entries()].filter(([, direction]) => direction === 'entry').map(([id]) => id),
  );
  const missing = expectedIds.filter((id) => !confirmed.has(id));
  return { confirmed, inside, missing };
}

export function resolveAnimalByEartag<T extends FarmAnimalQrRecord>(
  rawValue: string,
  farmId: string,
  farmAnimals: T[],
): FarmQrResolution<T> {
  return resolveFarmAnimalEartag(rawValue, farmId, farmAnimals);
}

export function resolveFarmAnimalQr<T extends FarmAnimalQrRecord>(
  rawValue: string,
  farmId: string,
  farmAnimals: T[],
): FarmQrResolution<T> {
  const decoded = rawValue.trim();
  if (!decoded) return { status: 'unknown', message: 'Walang nabasang QR content.' };

  let reference: string;
  if (decoded.startsWith('{')) {
    try {
      const payload = JSON.parse(decoded) as {
        type?: unknown;
        publicToken?: unknown;
      };
      if (
        payload.type !== 'alpasfarm_animal' ||
        typeof payload.publicToken !== 'string'
      ) {
        return { status: 'unknown', message: 'Hindi valid na AlpasFarm animal QR.' };
      }
      reference = payload.publicToken;
    } catch {
      return { status: 'unknown', message: 'Hindi mabasa ang animal QR.' };
    }
  } else {
    const urlReference = decoded.match(/\/public\/([^/?#]+)/i)?.[1];
    try {
      reference = decodeURIComponent(urlReference ?? decoded);
    } catch {
      return { status: 'unknown', message: 'Hindi mabasa ang animal QR reference.' };
    }
  }

  const normalizedReference = reference.toLowerCase();
  const numericReference = normalizeEartagNumber(reference);
  const animal = getActiveAnimals(farmAnimals).find((candidate) =>
    candidate.user_id === farmId &&
    (candidate.public_qr_token?.toLowerCase() === normalizedReference ||
      candidate.tag_id.trim().toLowerCase() === normalizedReference ||
      (numericReference !== null && normalizeEartagNumber(candidate.tag_id) === numericReference)),
  );
  if (animal) {
    return { status: 'verified', animal };
  }

  const eartagResolution = resolveFarmAnimalEartag(decoded, farmId, farmAnimals);
  if (eartagResolution.status === 'verified') {
    return eartagResolution;
  }

  return { status: 'unknown', message: 'Hindi ma-verify ang QR sa mga aktibong hayop ng bukid na ito.' };
}
