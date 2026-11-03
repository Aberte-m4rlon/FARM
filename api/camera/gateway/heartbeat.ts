import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { applyApiCors } from '../../_lib/cors';
import {
  cameraGatewayConfigured,
  persistCameraServiceHeartbeat,
  setCameraCorsHeaders,
} from '../../_lib/cameraGateway';

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
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!cameraGatewayConfigured()) {
    res.status(503).json({ error: 'Camera gateway is not configured.' });
    return;
  }

  const suppliedToken = req.headers['x-camera-gateway-token'];
  const expectedToken = (process.env.CAMERA_GATEWAY_TOKEN || '').trim();
  if (typeof suppliedToken !== 'string' || !tokenMatches(suppliedToken, expectedToken)) {
    res.status(401).json({ error: 'Camera gateway authentication failed.' });
    return;
  }

  const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
  try {
    await persistCameraServiceHeartbeat(ownerId);
    res.status(204).end();
  } catch (error) {
    console.error('Could not persist the camera gateway service heartbeat.', error);
    res.status(503).json({ error: 'Hindi ma-save ang gateway heartbeat.' });
  }
}
