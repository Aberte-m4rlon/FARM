import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { applyApiCors } from '../../_lib/cors';
import {
  authenticateCameraSettingsEditor,
  cameraGatewayConfigured,
  loadCameraGateSettings,
  saveCameraGateSettings,
  setCameraCorsHeaders,
  type CameraGateSettings,
} from '../../_lib/cameraGateway';

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate || candidate.length > 512) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validateSettings(value: unknown): Pick<CameraGateSettings, 'gate_line_y' | 'entry_flow'> | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['gate_line_y', 'entry_flow'].includes(key))) return null;
  if (typeof input.gate_line_y !== 'number' || !Number.isFinite(input.gate_line_y)
    || input.gate_line_y < 0.25 || input.gate_line_y > 0.75
    || input.entry_flow !== 'top-to-bottom') return null;
  return { gate_line_y: input.gate_line_y, entry_flow: 'top-to-bottom' };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!cameraGatewayConfigured()) {
    res.status(503).json({ error: 'Camera gateway is not configured.' });
    return;
  }

  const suppliedToken = req.headers['x-camera-gateway-token'];
  const isGateway = typeof suppliedToken === 'string'
    && tokenMatches(suppliedToken, (process.env.CAMERA_GATEWAY_TOKEN || '').trim());
  if (req.method === 'GET') {
    const userId = isGateway
      ? (process.env.CAMERA_OWNER_USER_ID || '').trim()
      : await authenticateCameraSettingsEditor(req, res);
    if (!userId) return;
    try {
      const settings = await loadCameraGateSettings(userId);
      res.status(200).json(settings);
    } catch (error) {
      console.error('Could not load persistent camera gate settings.', error);
      res.status(503).json({ error: 'Hindi makuha ang naka-save na pwesto ng gate.' });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const userId = await authenticateCameraSettingsEditor(req, res);
  if (!userId) return;
  const settings = validateSettings(req.body);
  if (!settings) { res.status(422).json({ error: 'Hindi wastong pwesto o direksyon ng counting line.' }); return; }
  try {
    const saved = await saveCameraGateSettings(userId, settings);
    res.status(200).json(saved);
  } catch (error) {
    console.error('Could not save persistent camera gate settings.', error);
    res.status(503).json({ error: 'Hindi ma-save sa database ang pwesto ng gate.' });
  }
}
