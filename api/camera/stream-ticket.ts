import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { applyApiCors } from '../_lib/cors';
import {
  activeCameraFrame,
  authenticateCameraOwner,
  cameraGatewayConfigured,
  CAMERA_STREAM_COOKIE,
  CAMERA_STREAM_TICKET_TTL_MS,
  getCameraGatewayState,
  setCameraCorsHeaders,
} from '../_lib/cameraGateway';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!cameraGatewayConfigured()) {
    res.status(503).json({ error: 'Camera gateway is not configured.' });
    return;
  }
  const userId = await authenticateCameraOwner(req, res);
  if (!userId) return;
  if (!activeCameraFrame()) {
    res.status(503).json({ error: 'Camera connection is not active.' });
    return;
  }

  const state = getCameraGatewayState();
  const now = Date.now();
  for (const [ticket, entry] of state.tickets) {
    if (entry.expiresAt <= now) state.tickets.delete(ticket);
  }
  if (state.tickets.size >= 2_000) {
    res.status(503).json({ error: 'Camera stream capacity is unavailable.' });
    return;
  }
  const ticket = randomBytes(32).toString('base64url');
  state.tickets.set(ticket, { userId, expiresAt: now + CAMERA_STREAM_TICKET_TTL_MS });
  res.setHeader('Set-Cookie', `${CAMERA_STREAM_COOKIE}=${ticket}; Path=/api/camera/; Max-Age=${Math.floor(CAMERA_STREAM_TICKET_TTL_MS / 1_000)}; Secure; HttpOnly; SameSite=Strict`);
  res.status(200).json({ ready: true });
}
