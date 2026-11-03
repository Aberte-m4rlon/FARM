import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/gateDomain.ts', import.meta.url), 'utf8');
const lifecycleSource = await readFile(new URL('../src/lib/animalLifecycle.ts', import.meta.url), 'utf8');
const lifecycleCompiled = ts.transpileModule(lifecycleSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lifecycleUrl = 'data:text/javascript;base64,' + Buffer.from(lifecycleCompiled).toString('base64');
const compiled = ts.transpileModule(source.replace("from './animalLifecycle'", `from '${lifecycleUrl}'`), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  getActiveAnimals,
  getGateAnimalSets,
  gateMovementDebounceKey,
  isGateScanDebounced,
  normalizeEartagNumber,
  resolveFarmAnimalEartag,
  resolveFarmAnimalQr,
  shouldPlayNewActiveAlertSound,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

const identitySource = await readFile(new URL('../src/lib/supabaseIdentity.ts', import.meta.url), 'utf8');
const identityCompiled = ts.transpileModule(identitySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isSupabaseAuthUserId } = await import(
  'data:text/javascript;base64,' + Buffer.from(identityCompiled).toString('base64')
);

const qrAssociationSource = await readFile(new URL('../src/lib/gateQrAssociation.ts', import.meta.url), 'utf8');
const qrAssociationCompiled = ts.transpileModule(qrAssociationSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { matchDetectionToTrack, matchQrToEarTrack } = await import(
  'data:text/javascript;base64,' + Buffer.from(qrAssociationCompiled).toString('base64')
);

const historySource = await readFile(new URL('../src/lib/gateDetectionHistory.ts', import.meta.url), 'utf8');
const historyCompiled = ts.transpileModule(historySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildGateDetectionHistory } = await import(
  'data:text/javascript;base64,' + Buffer.from(historyCompiled).toString('base64')
);

const animalQrSource = await readFile(new URL('../src/lib/animalQr.ts', import.meta.url), 'utf8');
const animalQrCompiled = ts.transpileModule(animalQrSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildAnimalQrPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(animalQrCompiled).toString('base64')
);

const farmId = 'farm-1';
const animals = [
  { id: 'animal-1', user_id: farmId, public_qr_token: '00000000-0000-4000-8000-000000000001', tag_id: 'G-001', eartag_number: 1, name: 'Maya', species: 'Goat' },
  { id: 'animal-2', user_id: farmId, public_qr_token: '00000000-0000-4000-8000-000000000002', tag_id: 'S-002', eartag_number: 10, name: 'Bituin', species: 'Sheep' },
  { id: 'animal-3', user_id: 'other-farm', public_qr_token: '00000000-0000-4000-8000-000000000003', tag_id: 'G-003', eartag_number: 1, name: 'Other farm', species: 'Goat' },
  { id: 'animal-4', user_id: farmId, tag_id: 'G-004', eartag_number: 4, name: 'Archived', species: 'Goat', archived: true },
  { id: 'animal-5', user_id: farmId, tag_id: 'G-005', eartag_number: 5, name: 'Sold', species: 'Goat', is_sold: true },
  { id: 'animal-6', user_id: farmId, tag_id: 'S-006', eartag_number: 6, name: 'Deceased', species: 'Sheep', status: 'Deceased' },
];
const eartagNumberExamples = [
  animals[0], animals[1],
  { id: 'number-9', user_id: farmId, tag_id: 'G-009', eartag_number: 9, name: 'Nine', species: 'Goat' },
  { id: 'number-25', user_id: farmId, tag_id: 'S-025', eartag_number: 25, name: 'Twenty Five', species: 'Sheep' },
  { id: 'number-100', user_id: farmId, tag_id: 'G-100', eartag_number: 100, name: 'One Hundred', species: 'Goat' },
  { id: 'number-1000', user_id: farmId, tag_id: 'S-1000', eartag_number: 1000, name: 'One Thousand', species: 'Sheep' },
];

test('normalizes eartag numbers without padding and resolves only exact numbers in the current farm', () => {
  assert.equal(normalizeEartagNumber('1'), '1');
  assert.equal(normalizeEartagNumber('001'), '1');
  assert.equal(normalizeEartagNumber('1000'), '1000');
  assert.equal(normalizeEartagNumber('0'), null);
  assert.equal(normalizeEartagNumber('I'), null);
  for (const number of ['1', '9', '10', '25', '100', '1000']) {
    assert.equal(resolveFarmAnimalEartag(number, farmId, eartagNumberExamples).animal.eartag_number, Number(number));
  }
  assert.equal(resolveFarmAnimalEartag('11', farmId, eartagNumberExamples).status, 'unknown');
  assert.equal(resolveFarmAnimalEartag('1', 'other-farm', animals).animal.id, 'animal-3');
});

test('accepts Supabase UUID identities and rejects Firebase UIDs before UUID database queries', () => {
  assert.equal(isSupabaseAuthUserId('9a3f51a0-0461-4ef0-a30b-42b93c54d20f'), true);
  assert.equal(isSupabaseAuthUserId('0oq1XXXO8VRm3wqUJVuMaqKrkHS2'), false);
  assert.equal(isSupabaseAuthUserId(null), false);
});

test('verifies a secure public-token QR JSON only against the current farm', () => {
  const result = resolveFarmAnimalQr(
    JSON.stringify({ type: 'alpasfarm_animal', publicToken: animals[0].public_qr_token }),
    farmId,
    animals,
  );
  assert.equal(result.status, 'verified');
  if (result.status === 'verified') assert.equal(result.animal.tag_id, 'G-001');
});

test('supports existing public URL and raw tag QR formats', () => {
  assert.equal(resolveFarmAnimalQr(`https://alpasfarm.vercel.app/public/${animals[1].public_qr_token}`, farmId, animals).status, 'verified');
  const rawTag = resolveFarmAnimalQr('g-001', farmId, animals);
  assert.equal(rawTag.status, 'verified');
  if (rawTag.status === 'verified') assert.equal(rawTag.animal.id, 'animal-1');
});

test('animal QR payload is a public profile URL that Lens can open and gate monitoring can verify', () => {
  const payload = buildAnimalQrPayload({ public_qr_token: animals[0].public_qr_token });
  const profileUrl = new URL(payload);
  assert.equal(profileUrl.origin, 'https://alpasfarm.site');
  assert.equal(profileUrl.pathname, `/public/${animals[0].public_qr_token}`);
  assert.equal(resolveFarmAnimalQr(payload, farmId, animals).status, 'verified');
});

test('rejects foreign-farm, archived, sold, malformed, and unknown QR values', () => {
  const foreign = resolveFarmAnimalQr(
    JSON.stringify({ type: 'alpasfarm_animal', animalId: 'animal-1', farmId: 'other-farm' }),
    farmId,
    animals,
  );
  assert.equal(foreign.status, 'unknown');
  assert.equal(resolveFarmAnimalQr('animal-3', farmId, animals).status, 'unknown');
  assert.equal(resolveFarmAnimalQr('animal-1', farmId, animals).status, 'unknown');
  assert.equal(resolveFarmAnimalQr('G-004', farmId, animals).status, 'unknown');
  assert.equal(resolveFarmAnimalQr('G-005', farmId, animals).status, 'unknown');
  assert.equal(resolveFarmAnimalQr('{broken', farmId, animals).status, 'unknown');
  assert.equal(resolveFarmAnimalQr('not-registered', farmId, animals).status, 'unknown');
});

test('active herd excludes archived, sold, and deceased animals', () => {
  assert.deepEqual(getActiveAnimals(animals).map((animal) => animal.id), ['animal-1', 'animal-2', 'animal-3']);
});

test('reconciliation returns verified identities, current inside set, and unaccounted IDs', () => {
  const { confirmed, inside, missing } = getGateAnimalSets(['animal-1', 'animal-2', 'animal-4'], [
    { animal_id: 'animal-1', direction: 'entry', qr_verified: true, created_at: '2026-10-02T10:00:00Z' },
    { animal_id: 'animal-2', direction: 'entry', qr_verified: true, created_at: '2026-10-02T10:01:00Z' },
    { animal_id: 'animal-2', direction: 'exit', qr_verified: true, created_at: '2026-10-02T10:02:00Z' },
    { animal_id: 'animal-4', direction: 'entry', qr_verified: false, created_at: '2026-10-02T10:03:00Z' },
  ]);
  assert.deepEqual([...confirmed].sort(), ['animal-1', 'animal-2']);
  assert.deepEqual([...inside], ['animal-1']);
  assert.deepEqual(missing, ['animal-4']);
});

test('five-animal return scenario accepts verified eartag or legacy QR entry', () => {
  const expected = ['bella', 'luna', 'coco', 'max', 'snow'];
  const returned = [
    { animal_id: 'bella', direction: 'entry', eartag_verified: true, eartag_number: '1', created_at: '2026-10-03T09:00:00Z' },
    { animal_id: 'luna', direction: 'entry', qr_verified: true, created_at: '2026-10-03T09:01:00Z' },
    { animal_id: 'max', direction: 'entry', qr_verified: true, created_at: '2026-10-03T09:02:00Z' },
    { animal_id: 'snow', direction: 'entry', qr_verified: true, created_at: '2026-10-03T09:03:00Z' },
  ];
  const firstPass = getGateAnimalSets(expected, returned);
  assert.equal(firstPass.confirmed.size, 4);
  assert.equal(firstPass.inside.size, 4);
  assert.deepEqual(firstPass.missing, ['coco']);

  const rescanned = getGateAnimalSets(expected, [
    ...returned,
    { animal_id: 'coco', direction: 'entry', qr_verified: true, created_at: '2026-10-03T09:10:00Z' },
  ]);
  assert.equal(rescanned.confirmed.size, 5);
  assert.equal(rescanned.inside.size, 5);
  assert.deepEqual(rescanned.missing, []);
});

test('QR scans are debounced without blocking a later scan', () => {
  assert.equal(isGateScanDebounced(10_000, 29_999, 20_000), true);
  assert.equal(isGateScanDebounced(10_000, 30_000, 20_000), false);
  assert.equal(isGateScanDebounced(undefined, 30_000, 20_000), false);
  assert.equal(isGateScanDebounced(30_000, 29_000, 20_000), false);
});

test('entry and exit for one animal remain separate movements in the same session', () => {
  const lastMovements = new Map([[gateMovementDebounceKey('animal-1', 'entry'), 10_000]]);
  assert.equal(isGateScanDebounced(lastMovements.get(gateMovementDebounceKey('animal-1', 'entry')), 11_000, 20_000), true);
  assert.equal(isGateScanDebounced(lastMovements.get(gateMovementDebounceKey('animal-1', 'exit')), 11_000, 20_000), false);
});

test('detection history merges eartag and legacy QR movements while retaining sightings', () => {
  const history = buildGateDetectionHistory(
    [
      {
        id: 'sighting-1', session_id: 'session-1', user_id: farmId, gate_id: 'gate-1',
        tracking_id: 'T-1001', species_detected: 'goat', confidence: 0.9,
        animal_id: 'animal-1', qr_verified: true,
        detected_at: '2026-10-03T09:00:00Z', last_seen_at: '2026-10-03T09:01:00Z',
      },
      {
        id: 'sighting-2', session_id: 'session-1', user_id: farmId, gate_id: 'gate-1',
        tracking_id: 'T-1002', species_detected: 'sheep', confidence: 0.85,
        animal_id: null, qr_verified: false,
        detected_at: '2026-10-03T09:02:00Z', last_seen_at: '2026-10-03T09:02:30Z',
      },
      {
        id: 'sighting-3', session_id: 'session-1', user_id: farmId, gate_id: 'gate-1',
        tracking_id: 'T-1003', species_detected: 'sheep', confidence: 0.9,
        animal_id: 'animal-2', eartag_verified: true, eartag_number: '10',
        detected_at: '2026-10-03T09:03:00Z', last_seen_at: '2026-10-03T09:03:20Z',
      },
    ],
    [
      {
        id: 'event-1', session_id: 'session-1', user_id: farmId, gate_id: 'gate-1',
        animal_id: 'animal-1', direction: 'entry', species_detected: 'goat',
        qr_verified: true, confidence: 0.9, tracking_id: 'T-1001',
        movement_observation: 'normal', created_at: '2026-10-03T09:00:15Z',
      },
      {
        id: 'event-2', session_id: 'session-1', user_id: farmId, gate_id: 'gate-1',
        animal_id: 'animal-2', direction: 'entry', species_detected: 'sheep',
        eartag_verified: true, eartag_number: '10', confidence: 0.9, tracking_id: 'T-1003',
        movement_observation: 'normal', created_at: '2026-10-03T09:03:15Z',
      },
    ],
    [
      {
        id: 'crossing-1', crossing_key: 'crossing-key', session_id: 'session-1',
        user_id: farmId, gate_id: 'gate-1', tracking_id: 'T-1001',
        species_detected: 'goat', direction: 'entry', confidence: 0.9,
        movement_observation: 'normal', animal_id: 'animal-1', event_id: 'event-1',
        qr_verified: true, created_at: '2026-10-03T09:00:16Z',
      },
      {
        id: 'crossing-2', crossing_key: 'crossing-key-2', session_id: 'session-1',
        user_id: farmId, gate_id: 'gate-1', tracking_id: 'T-1003',
        species_detected: 'sheep', direction: 'entry', confidence: 0.9,
        movement_observation: 'normal', animal_id: 'animal-2', event_id: 'event-2',
        eartag_verified: true, eartag_number: '10', created_at: '2026-10-03T09:03:16Z',
      },
    ],
    animals,
  );

  assert.equal(history.length, 5);
  assert.equal(history.filter((item) => item.source === 'movement').length, 0);
  const movement = history.find((item) => item.eventType === 'entry' && item.animalId === 'animal-1');
  assert.equal(movement.source, 'crossing');
  assert.equal(movement.animalName, 'Maya');
  assert.equal(movement.qrVerified, true);
  const eartagMovement = history.find((item) => item.eartagVerified);
  assert.equal(eartagMovement.animalName, 'Bituin');
  assert.equal(eartagMovement.eartagNumber, '10');
  assert.equal(history.find((item) => item.source === 'sighting' && item.id === 'sighting-2').eventType, 'seen');
});

test('sound is opt-in and only requests a tone for a new active alert', () => {
  const seen = new Set(['alert-old']);
  const alerts = [
    { id: 'alert-old', status: 'active' },
    { id: 'alert-new', status: 'active' },
    { id: 'alert-closed', status: 'resolved' },
  ];
  assert.equal(shouldPlayNewActiveAlertSound(false, seen, alerts), false);
  assert.equal(shouldPlayNewActiveAlertSound(true, seen, alerts), true);
  assert.equal(shouldPlayNewActiveAlertSound(true, new Set(['alert-old', 'alert-new']), alerts), false);
});

test('API CORS only reflects configured ALPASFARM origins', async () => {
  const corsSource = await readFile(new URL('../api/_lib/cors.ts', import.meta.url), 'utf8');
  const corsCompiled = ts.transpileModule(corsSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { applyApiCors } = await import(
    'data:text/javascript;base64,' + Buffer.from(corsCompiled).toString('base64')
  );
  const originalOrigins = process.env.ALLOWED_FRONTEND_ORIGINS;
  process.env.ALLOWED_FRONTEND_ORIGINS = 'https://alpasfarm.site, https://www.alpasfarm.site';
  try {
    const createResponse = () => {
      const headers = new Map();
      return { headers, setHeader: (name, value) => headers.set(name.toLowerCase(), value) };
    };
    const blocked = createResponse();
    applyApiCors({ headers: { origin: 'https://attacker.example' } }, blocked);
    assert.equal(blocked.headers.get('access-control-allow-origin'), undefined);
    assert.equal(blocked.headers.get('vary'), 'Origin');

    const allowed = createResponse();
    applyApiCors({ headers: { origin: 'https://www.alpasfarm.site' } }, allowed);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://www.alpasfarm.site');

    process.env.ALLOWED_FRONTEND_ORIGINS = '';
    const defaultAllowed = createResponse();
    applyApiCors({ headers: { origin: 'https://alpasfarm.site' } }, defaultAllowed);
    assert.equal(defaultAllowed.headers.get('access-control-allow-origin'), 'https://alpasfarm.site');
  } finally {
    if (originalOrigins === undefined) delete process.env.ALLOWED_FRONTEND_ORIGINS;
    else process.env.ALLOWED_FRONTEND_ORIGINS = originalOrigins;
  }
});

const trackerSource = await readFile(new URL('../src/lib/gateTracking.ts', import.meta.url), 'utf8');
const trackerCompiled = ts.transpileModule(trackerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { GateAnimalTracker } = await import(
  'data:text/javascript;base64,' + Buffer.from(trackerCompiled).toString('base64')
);

test('confirms entry only after tracked movement traverses the camera and remains absent past the grace period', () => {
  const tracker = new GateAnimalTracker('left-to-inside');
  const detection = (x) => ({
    species: 'goat', confidence: 0.91,
    box: [x - 0.08, 0.42, x + 0.08, 0.58],
  });
  assert.equal(tracker.update([detection(0.12)], 1_000).tracks.length, 0);
  const stable = tracker.update([detection(0.28)], 2_000);
  assert.equal(stable.tracks.length, 1);
  tracker.update([detection(0.44)], 3_000);
  tracker.update([detection(0.6)], 4_000);
  tracker.update([detection(0.76)], 5_000);
  const atCameraEdge = tracker.update([detection(0.9)], 6_000);
  assert.equal(atCameraEdge.crossings.length, 0);
  for (let time = 6_500; time <= 9_000; time += 500) {
    assert.equal(tracker.update([], time).crossings.length, 0);
  }
  const entry = tracker.update([], 9_500);
  assert.equal(entry.crossings.length, 1);
  assert.equal(entry.crossings[0].trackingId, stable.tracks[0].id);
  assert.equal(entry.crossings[0].direction, 'entry');
  assert.equal(tracker.update([], 10_000).crossings.length, 0);
});

test('does not count an animal that approaches the left exit and turns back', () => {
  const tracker = new GateAnimalTracker('left-to-inside');
  const detection = (x) => ({ species: 'goat', confidence: 0.91, box: [x - 0.08, 0.4, x + 0.08, 0.6] });
  [0.5, 0.32, 0.16, 0.28, 0.46].forEach((x, index) => tracker.update([detection(x)], 1_000 * (index + 1)));
  assert.equal(tracker.update([], 8_000).crossings.length, 0);
  assert.equal(tracker.update([], 10_000).crossings.length, 0);
});

test('cancels the disappearance timer when a briefly occluded animal reappears', () => {
  const tracker = new GateAnimalTracker('left-to-inside');
  const detection = (x) => ({ species: 'goat', confidence: 0.91, box: [x - 0.08, 0.4, x + 0.08, 0.6] });
  [0.12, 0.35, 0.6, 0.86].forEach((x, index) => tracker.update([detection(x)], 1_000 * (index + 1)));
  tracker.update([], 5_000);
  tracker.update([], 6_000);
  const reappeared = tracker.update([detection(0.75)], 7_000);
  assert.equal(reappeared.crossings.length, 0);
  assert.equal(tracker.update([], 10_000).crossings.length, 0);
});

test('uses fresh numeric track references after a tracker reset', () => {
  const tracker = new GateAnimalTracker();
  const detection = { species: 'goat', confidence: 0.9, box: [0.2, 0.2, 0.4, 0.5] };
  tracker.update([detection], 1_000);
  const firstId = tracker.update([detection], 2_000).tracks[0].id;
  tracker.reset();
  tracker.update([detection], 3_000);
  const secondId = tracker.update([detection], 4_000).tracks[0].id;
  assert.match(firstId, /^T-[0-9]{3,}$/);
  assert.match(secondId, /^T-[0-9]{3,}$/);
  assert.notEqual(firstId, secondId);
});

test('detects a reverse crossing as exit and preserves separate simultaneous tracks', () => {
  const tracker = new GateAnimalTracker('left-to-inside');
  const make = (species, x) => ({ species, confidence: 0.88, box: [x - 0.07, 0.3, x + 0.07, 0.5] });
  tracker.update([make('goat', 0.76), make('sheep', 0.1)], 1_000);
  tracker.update([make('goat', 0.58), make('sheep', 0.28)], 2_000);
  const stable = tracker.update([make('goat', 0.4), make('sheep', 0.46)], 3_000);
  assert.equal(stable.tracks.length, 2);
  tracker.update([make('goat', 0.22), make('sheep', 0.64)], 4_000);
  tracker.update([make('goat', 0.12), make('sheep', 0.82)], 5_000);
  tracker.update([], 6_000);
  tracker.update([], 8_000);
  const exited = tracker.update([], 9_000);
  assert.deepEqual(exited.crossings.map((crossing) => crossing.direction).sort(), ['entry', 'exit']);
  assert.equal(new Set(exited.tracks.map((track) => track.id)).size, 2);
});

test('supports the opposite camera orientation without changing the farmer-facing flow', () => {
  const tracker = new GateAnimalTracker('right-to-inside');
  const detection = (x) => ({ species: 'sheep', confidence: 0.9, box: [x - 0.08, 0.4, x + 0.08, 0.6] });
  [0.88, 0.68, 0.48, 0.3, 0.1].forEach((x, index) => tracker.update([detection(x)], 1_000 * (index + 1)));
  tracker.update([], 6_000);
  tracker.update([], 8_000);
  const entry = tracker.update([], 9_000);
  assert.equal(entry.crossings[0]?.direction, 'entry');
});

test('tracks top-to-bottom and bottom-to-top gate crossings for both species', () => {
  const runCrossing = (flow, species, positions) => {
    const tracker = new GateAnimalTracker(flow);
    const detection = (y) => ({ species, confidence: 0.91, box: [0.42, y - 0.08, 0.58, y + 0.08] });
    positions.forEach((y, index) => tracker.update([detection(y)], 1_000 * (index + 1)));
    let result = { crossings: [] };
    const lastDetectionAt = positions.length * 1_000;
    for (let at = lastDetectionAt + 500; at <= lastDetectionAt + 3_500; at += 500) {
      result = tracker.update([], at);
    }
    return result.crossings[0];
  };

  assert.equal(runCrossing('top-to-bottom', 'goat', [0.1, 0.28, 0.46, 0.64, 0.82, 0.9])?.direction, 'entry');
  assert.equal(runCrossing('bottom-to-top', 'sheep', [0.9, 0.72, 0.54, 0.36, 0.18, 0.1])?.direction, 'entry');
  assert.equal(runCrossing('top-to-bottom', 'sheep', [0.9, 0.72, 0.54, 0.36, 0.18, 0.1])?.direction, 'exit');
});

test('does not report a gate crossing when an animal only moves across the frame horizontally', () => {
  const tracker = new GateAnimalTracker('top-to-bottom');
  const detection = (x) => ({ species: 'goat', confidence: 0.9, box: [x - 0.08, 0.42, x + 0.08, 0.58] });
  [0.1, 0.28, 0.46, 0.64, 0.82, 0.9].forEach((x, index) => tracker.update([detection(x)], 1_000 * (index + 1)));
  let crossings = [];
  for (let at = 6_500; at <= 10_000; at += 500) crossings = tracker.update([], at).crossings;
  assert.equal(crossings.length, 0);
});

test('uses recent movement to keep same-species tracks through a crossing', () => {
  const tracker = new GateAnimalTracker();
  const make = (centerX) => ({
    species: 'goat', confidence: 0.9,
    box: [centerX - 0.06, 0.2, centerX + 0.06, 0.4],
  });
  tracker.update([make(0.25), make(0.75)], 1_000, 0.7, 'top-to-bottom');
  const stable = tracker.update([make(0.4), make(0.6)], 2_000, 0.7, 'top-to-bottom');
  const leftTrackId = stable.tracks.find((track) => track.center.x < 0.5)?.id;
  const rightTrackId = stable.tracks.find((track) => track.center.x > 0.5)?.id;
  tracker.update([make(0.6), make(0.4)], 3_000, 0.7, 'top-to-bottom');
  const passed = tracker.update([make(0.75), make(0.25)], 4_000, 0.7, 'top-to-bottom');
  assert.equal(passed.tracks.find((track) => track.center.x > 0.5)?.id, leftTrackId);
  assert.equal(passed.tracks.find((track) => track.center.x < 0.5)?.id, rightTrackId);
});

test('marks only a measured prolonged stop near the gate for caretaker review', () => {
  const tracker = new GateAnimalTracker();
  const detection = { species: 'sheep', confidence: 0.89, box: [0.4, 0.42, 0.58, 0.58] };
  for (let second = 1; second <= 9; second += 1) {
    const frame = tracker.update([detection], second * 1_000);
    if (second === 9) assert.equal(frame.tracks[0].observation, 'prolonged_stop');
    assert.equal(frame.crossings.length, 0);
  }
});

test('requires repeated movement before raising a stop-start anomaly', () => {
  const tracker = new GateAnimalTracker();
  const positions = [0.2, 0.2, 0.2, 0.3, 0.4, 0.4, 0.4, 0.5, 0.6, 0.6, 0.6];
  let lastTrack;
  positions.forEach((x, index) => {
    lastTrack = tracker.update([{
      species: 'goat', confidence: 0.9, box: [x - 0.025, 0.46, x + 0.025, 0.54],
    }], 1_000 * (index + 1)).tracks[0];
  });
  assert.equal(lastTrack.movementAnomaly, 'repeated_stop_start');
});

test('flags repeated meaningful reversals, but ignores detector-box jitter', () => {
  const makeTracker = () => new GateAnimalTracker();
  const detection = (x) => ({ species: 'sheep', confidence: 0.9, box: [x - 0.025, 0.46, x + 0.025, 0.54] });

  const reversalTracker = makeTracker();
  let reversalTrack;
  [0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2].forEach((x, index) => {
    reversalTrack = reversalTracker.update([detection(x)], 1_000 * (index + 1)).tracks[0];
  });
  assert.equal(reversalTrack.movementAnomaly, 'repeated_direction_change');

  const jitterTracker = makeTracker();
  let jitterTrack;
  for (let index = 0; index <= 24; index += 1) {
    const x = index % 2 === 0 ? 0.5 : 0.55;
    jitterTrack = jitterTracker.update([detection(x)], 1_000 + index * 500).tracks[0];
  }
  assert.equal(jitterTrack.movementAnomaly, 'none');
});

test('matches goat and sheep eartags to their own track when both animals are visible', () => {
  const tracks = [
    { id: 'T-1', species: 'goat', box: [0.05, 0.1, 0.45, 0.9], consecutiveMisses: 0 },
    { id: 'T-2', species: 'sheep', box: [0.55, 0.05, 0.95, 0.85], consecutiveMisses: 0 },
  ];
  assert.equal(matchDetectionToTrack(tracks[0].box, 'goat', tracks)?.id, 'T-1');
  assert.equal(matchDetectionToTrack(tracks[1].box, 'sheep', tracks)?.id, 'T-2');
  assert.equal(matchQrToEarTrack({ x1: 0.2, y1: 0.2, x2: 0.23, y2: 0.23 }, tracks)?.id, 'T-1');
  assert.equal(matchQrToEarTrack({ x1: 0.7, y1: 0.18, x2: 0.73, y2: 0.21 }, tracks)?.id, 'T-2');
});

test('leaves overlapping ear zones and QR-sized body regions unassigned', () => {
  const overlappingTracks = [
    { id: 'T-1', species: 'goat', box: [0.1, 0.1, 0.7, 0.9], consecutiveMisses: 0 },
    { id: 'T-2', species: 'goat', box: [0.3, 0.1, 0.8, 0.9], consecutiveMisses: 0 },
  ];
  assert.equal(matchQrToEarTrack({ x1: 0.44, y1: 0.18, x2: 0.47, y2: 0.21 }, overlappingTracks), undefined);
  assert.equal(matchQrToEarTrack({ x1: 0.2, y1: 0.72, x2: 0.55, y2: 0.87 }, overlappingTracks), undefined);
});
