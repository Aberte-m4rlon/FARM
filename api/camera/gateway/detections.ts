import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { applyApiCors } from '../../_lib/cors';
import {
  cameraGatewayConfigured,
  acknowledgeCameraGateSettings,
  persistCameraCountingCrossings,
  saveCameraGatewayEventAlert,
  setCameraCorsHeaders,
  storeCameraCount,
  type CameraCountPayload,
} from '../../_lib/cameraGateway';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } }, maxDuration: 10 };

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate || candidate.length > 512) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validatePayload(value: unknown): CameraCountPayload | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const allowedFields = new Set(['success', 'animal_count', 'entries_total', 'exits_total', 'goat_entries_total', 'goat_exits_total', 'sheep_entries_total', 'sheep_exits_total', 'model_version', 'inference_ms', 'image', 'predictions', 'config_revision', 'crossings']);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) return null;
  const image = input.image;
  if (!image || typeof image !== 'object') return null;
  const dimensions = image as Record<string, unknown>;
  const width = dimensions.width;
  const height = dimensions.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (width as number) > 8192
    || (height as number) < 1 || (height as number) > 8192) return null;
  const predictions = input.predictions;
  if (predictions !== undefined && (!Array.isArray(predictions) || predictions.length > 50)) return null;
  const safePredictions: CameraCountPayload['predictions'] = [];
  for (const prediction of Array.isArray(predictions) ? predictions : []) {
    if (!prediction || typeof prediction !== 'object') return null;
    const item = prediction as Record<string, unknown>;
    const bbox = item.bbox;
    if (!bbox || typeof bbox !== 'object') return null;
    const box = bbox as Record<string, unknown>;
    const { x1, y1, x2, y2 } = box;
    if ((item.class !== 'goat' && item.class !== 'sheep')
      || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
      || ![x1, y1, x2, y2].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      || (x1 as number) < 0 || (y1 as number) < 0 || (x2 as number) <= (x1 as number) || (y2 as number) <= (y1 as number)
      || (x2 as number) > (width as number) || (y2 as number) > (height as number)
      || (item.tracking_id !== undefined && (typeof item.tracking_id !== 'string' || !/^\d{1,12}$/.test(item.tracking_id)))) return null;
    safePredictions.push({
      class: item.class,
      confidence: item.confidence,
      bbox: { x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number },
      ...(typeof item.tracking_id === 'string' ? { tracking_id: item.tracking_id } : {}),
    });
  }
  const configRevision = input.config_revision;
  if (configRevision !== undefined && (!Number.isSafeInteger(configRevision) || (configRevision as number) < 0)) return null;
  const crossingsInput = input.crossings;
  if (crossingsInput !== undefined && (!Array.isArray(crossingsInput) || crossingsInput.length > 100)) return null;
  const crossingKeys = new Set<string>();
  const crossings: NonNullable<CameraCountPayload['crossings']> = [];
  const allowedCrossingFields = new Set([
    'session_id', 'event_key', 'tracking_id', 'animal_type', 'direction', 'confidence', 'config_revision',
  ]);
  for (const crossing of Array.isArray(crossingsInput) ? crossingsInput : []) {
    if (!crossing || typeof crossing !== 'object') return null;
    const item = crossing as Record<string, unknown>;
    if (Object.keys(item).some((key) => !allowedCrossingFields.has(key))) return null;
    const sessionId = item.session_id;
    if (typeof item.event_key !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.event_key)
      || crossingKeys.has(item.event_key)
      || !(sessionId === null || (typeof sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)))
      || typeof item.tracking_id !== 'string' || !/^T-[0-9]{3,12}$/.test(item.tracking_id)
      || (item.animal_type !== 'goat' && item.animal_type !== 'sheep')
      || (item.direction !== 'entry' && item.direction !== 'exit')
      || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
      || !Number.isSafeInteger(item.config_revision) || (item.config_revision as number) < 0
      ) return null;
    crossingKeys.add(item.event_key);
    crossings.push({
      session_id: sessionId as string | null,
      event_key: item.event_key,
      tracking_id: item.tracking_id,
      animal_type: item.animal_type,
      direction: item.direction,
      confidence: item.confidence,
      config_revision: item.config_revision as number,
    });
  }
  if (input.success !== true || !Number.isInteger(input.animal_count)
    || (input.animal_count as number) < 0 || (input.animal_count as number) > 50
    || !Number.isSafeInteger(input.entries_total) || (input.entries_total as number) < 0
    || !Number.isSafeInteger(input.exits_total) || (input.exits_total as number) < 0
    || typeof input.model_version !== 'string' || input.model_version.length > 128
    || typeof input.inference_ms !== 'number' || !Number.isFinite(input.inference_ms)
    || input.inference_ms < 0 || input.inference_ms > 120_000) return null;
  const speciesTotals = ['goat_entries_total', 'goat_exits_total', 'sheep_entries_total', 'sheep_exits_total'] as const;
  for (const key of speciesTotals) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0)) return null;
  }

  return {
    success: true,
    animal_count: input.animal_count as number,
    entries_total: input.entries_total as number,
    exits_total: input.exits_total as number,
    goat_entries_total: (input.goat_entries_total as number | undefined) ?? 0,
    goat_exits_total: (input.goat_exits_total as number | undefined) ?? 0,
    sheep_entries_total: (input.sheep_entries_total as number | undefined) ?? 0,
    sheep_exits_total: (input.sheep_exits_total as number | undefined) ?? 0,
    model_version: input.model_version,
    inference_ms: input.inference_ms,
    image: { width: width as number, height: height as number },
    predictions: safePredictions,
    ...(configRevision !== undefined ? { config_revision: configRevision as number } : {}),
    crossings,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!cameraGatewayConfigured()) {
    res.status(503).json({ error: 'Camera gateway is not configured.' });
    return;
  }

  const expectedToken = (process.env.CAMERA_GATEWAY_TOKEN || '').trim();
  const suppliedToken = req.headers['x-camera-gateway-token'];
  if (typeof suppliedToken !== 'string' || !tokenMatches(suppliedToken, expectedToken)) {
    res.status(401).json({ error: 'Camera gateway authentication failed.' });
    return;
  }

  const payload = validatePayload(req.body);
  if (!payload) {
    const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
    if (ownerId) void saveCameraGatewayEventAlert(ownerId, 'invalid').catch((error) => {
      console.error('Could not persist the invalid camera event alert.', error);
    });
    res.status(422).json({ error: 'Camera count is invalid.' });
    return;
  }
  try {
    const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
    const acknowledgedCrossingKeys = await persistCameraCountingCrossings(ownerId, payload.crossings ?? []);
    if (payload.config_revision !== undefined) {
      await acknowledgeCameraGateSettings(ownerId, payload.config_revision);
    }
    storeCameraCount(payload);
    res.status(200).json({ acknowledged_crossing_keys: acknowledgedCrossingKeys });
  } catch (error) {
    console.error('Could not persist camera gate events before accepting the frame.', error);
    const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
    if (ownerId) void saveCameraGatewayEventAlert(ownerId, 'save-failed').catch((notificationError) => {
      console.error('Could not persist the camera event save-failure alert.', notificationError);
    });
    res.status(503).json({ error: 'Camera gate events could not be saved yet. The gateway should retry.' });
  }
}
