import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import {
  CAMERA_STREAM_BOUNDARY,
  CAMERA_STREAM_COOKIE,
  getCameraGatewayState,
  setCameraCorsHeaders,
} from '../_lib/cameraGateway';

function readTicket(req: VercelRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== CAMERA_STREAM_COOKIE) continue;
    const value = entry.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,64}$/.test(value) ? value : null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const ticket = readTicket(req);
  const state = getCameraGatewayState();
  const access = ticket ? state.tickets.get(ticket) : undefined;
  if (!access || access.expiresAt <= Date.now() || access.userId !== (process.env.CAMERA_OWNER_USER_ID || '').trim()) {
    res.status(401).json({ error: 'Sign in to view this camera.' });
    return;
  }
  if (state.activeStreams >= 5) {
    res.status(429).json({ error: 'Camera stream capacity is full.' });
    return;
  }
  state.activeStreams += 1;

  res.statusCode = 200;
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${CAMERA_STREAM_BOUNDARY}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Connection', 'keep-alive');

  let lastSequence = -1;
  let closed = false;
  let released = false;
  const writeNextFrame = () => {
    // Drop intermediate frames when a slow connection cannot drain the last
    // write. Otherwise Node queues old JPEGs and the viewer watches the camera
    // catch up in slow motion instead of seeing the newest frame.
    if (closed || res.writableEnded || res.writableNeedDrain) return;
    const frame = state.frame;
    if (!frame || Date.now() - state.receivedAt > 5_000 || state.sequence === lastSequence) return;
    try {
      const header = Buffer.from(`--${CAMERA_STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      const packet = Buffer.concat([header, frame, Buffer.from('\r\n')]);
      lastSequence = state.sequence;
      res.write(packet);
    } catch {
      close();
      if (!res.writableEnded) res.end();
    }
  };

  const interval = setInterval(writeNextFrame, 100);
  const close = () => {
    if (released) return;
    released = true;
    closed = true;
    state.activeStreams = Math.max(0, state.activeStreams - 1);
    clearInterval(interval);
  };
  res.on('close', close);
  res.on('finish', close);
  writeNextFrame();
  await new Promise<void>((resolve) => {
    res.on('close', resolve);
    res.on('finish', resolve);
  });
}
