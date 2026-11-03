import type { Animal } from '../types';
import type { GateCameraCrossing, GateDetectionSighting, GateEvent } from './gateMonitoring';

export type GateHistoryEventType = 'seen' | 'entry' | 'exit';
export type GateHistorySource = 'sighting' | 'crossing' | 'movement';

export interface GateDetectionHistoryItem {
  id: string;
  sessionId: string;
  trackingId: string | null;
  gateId: string;
  animalId: string | null;
  animalName: string | null;
  animalTagId: string | null;
  eartagNumber: string | null;
  species: 'goat' | 'sheep';
  eventType: GateHistoryEventType;
  qrVerified: boolean;
  eartagVerified?: boolean;
  createdAt: string;
  lastSeenAt: string;
  source: GateHistorySource;
}

function findMatchingEvent(crossing: GateCameraCrossing, events: readonly GateEvent[]): GateEvent | undefined {
  if (crossing.event_id) {
    const linkedEvent = events.find((event) => event.id === crossing.event_id);
    if (linkedEvent) return linkedEvent;
  }
  return events
    .filter((event) =>
      event.session_id === crossing.session_id &&
      event.tracking_id === crossing.tracking_id &&
      event.direction === crossing.direction &&
      Math.abs(new Date(event.created_at).getTime() - new Date(crossing.created_at).getTime()) <= 20_000,
    )
    .sort((a, b) =>
      Math.abs(new Date(a.created_at).getTime() - new Date(crossing.created_at).getTime()) -
      Math.abs(new Date(b.created_at).getTime() - new Date(crossing.created_at).getTime()),
    )[0];
}

export function buildGateDetectionHistory(
  sightings: readonly GateDetectionSighting[],
  events: readonly GateEvent[],
  crossings: readonly GateCameraCrossing[],
  animals: readonly Animal[],
): GateDetectionHistoryItem[] {
  const animalsById = new Map(animals.map((animal) => [animal.id, animal]));
  const history: GateDetectionHistoryItem[] = [];
  const matchedEventIds = new Set<string>();
  const addAnimal = (animalId: string | null) => {
    const animal = animalId ? animalsById.get(animalId) : undefined;
    return {
      animalId,
      animalName: animal?.name ?? null,
      animalTagId: animal?.tag_id ?? null,
      eartagNumber: animal?.eartag_number == null ? null : String(animal.eartag_number),
    };
  };

  for (const crossing of crossings) {
    const movement = findMatchingEvent(crossing, events);
    if (movement) matchedEventIds.add(movement.id);
    const verified = Boolean(crossing.qr_verified || crossing.eartag_verified || movement?.qr_verified || movement?.eartag_verified);
    history.push({
      id: crossing.id,
      sessionId: crossing.session_id,
      trackingId: crossing.tracking_id,
      gateId: crossing.gate_id,
      ...addAnimal(movement?.animal_id ?? crossing.animal_id),
      species: crossing.species_detected,
      eventType: crossing.direction,
      qrVerified: verified,
      eartagVerified: Boolean(crossing.eartag_verified || movement?.eartag_verified),
      eartagNumber: movement?.eartag_number ?? crossing.eartag_number ?? addAnimal(movement?.animal_id ?? crossing.animal_id).eartagNumber,
      createdAt: movement?.created_at ?? crossing.created_at,
      lastSeenAt: movement?.created_at ?? crossing.created_at,
      source: 'crossing',
    });
  }

  for (const event of events) {
    if (matchedEventIds.has(event.id)) continue;
    const verified = Boolean(event.qr_verified || event.eartag_verified);
    history.push({
      id: event.id,
      sessionId: event.session_id,
      trackingId: event.tracking_id,
      gateId: event.gate_id,
      ...addAnimal(event.animal_id),
      species: event.species_detected,
      eventType: event.direction,
      qrVerified: verified,
      eartagVerified: Boolean(event.eartag_verified),
      eartagNumber: event.eartag_number ?? addAnimal(event.animal_id).eartagNumber,
      createdAt: event.created_at,
      lastSeenAt: event.created_at,
      source: 'movement',
    });
  }

  for (const sighting of sightings) {
    const verified = Boolean(sighting.qr_verified || sighting.eartag_verified);
    history.push({
      id: sighting.id,
      sessionId: sighting.session_id,
      trackingId: sighting.tracking_id,
      gateId: sighting.gate_id,
      ...addAnimal(sighting.animal_id),
      species: sighting.species_detected,
      eventType: 'seen',
      qrVerified: verified,
      eartagVerified: Boolean(sighting.eartag_verified),
      eartagNumber: sighting.eartag_number ?? addAnimal(sighting.animal_id).eartagNumber,
      createdAt: sighting.detected_at,
      lastSeenAt: sighting.last_seen_at,
      source: 'sighting',
    });
  }

  return history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
