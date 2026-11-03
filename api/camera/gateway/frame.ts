import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { applyApiCors } from '../../_lib/cors';
import {
  CAMERA_FRAME_MAX_BYTES,
  cameraGatewayConfigured,
  getCameraGatewayState,
  persistCameraGatewayHeartbeat,
  setCameraCorsHeaders,
} from '../../_lib/cameraGateway';

export const config = { api: { bodyParser: false }, maxDuration: 10 };

async function readFrame(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > CAMERA_FRAME_MAX_BYTES) throw new RangeError('Camera frame is too large.');
    chunks.push(bytes);
  }
  if (!size) throw new TypeError('Camera frame is empty.');
  return Buffer.concat(chunks, size);
}

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate || candidate.length > 512) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
  const state = getCameraGatewayState();
  const sinceLastFrameMs = Date.now() - state.receivedAt;
  if (sinceLastFrameMs < 125) {
    res.setHeader('Retry-After', '1');
    res.setHeader('X-Camera-Retry-After-Ms', String(Math.max(25, 150 - sinceLastFrameMs)));
    res.status(429).json({ error: 'Camera frame rate is above the configured limit.' });
    return;
  }
  if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'image/jpeg') {
    res.status(415).json({ error: 'Camera gateway must send a JPEG frame.' });
    return;
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > CAMERA_FRAME_MAX_BYTES) {
    res.status(413).json({ error: 'Camera frame is too large.' });
    return;
  }

  let frame: Buffer;
  try {
    frame = await readFrame(req);
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    res.status(tooLarge ? 413 : 422).json({ error: tooLarge ? 'Camera frame is too large.' : 'Camera frame is empty.' });
    return;
  }
  if (
    frame.length < 4 ||
    frame[0] !== 0xff ||
    frame[1] !== 0xd8 ||
    frame[frame.length - 2] !== 0xff ||
    frame[frame.length - 1] !== 0xd9
  ) {
    res.status(422).json({ error: 'Camera frame is not a valid JPEG.' });
    return;
  }

  state.frame = frame;
  state.receivedAt = Date.now();
  state.sequence += 1;
  const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
  if (ownerId) {
    void persistCameraGatewayHeartbeat(ownerId).catch((error) => {
      console.error('Could not persist the Tapo camera heartbeat.', error);
    });
  }
  res.status(204).end();
}
