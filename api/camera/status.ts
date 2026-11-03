import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import {
  activeCameraFrame,
  authenticateCameraOwner,
  getCameraGatewayState,
  loadCameraGatewayLastSeenAt,
  loadCameraLastConnectedAt,
  markCameraGatewayOffline,
  saveCameraOfflineNotification,
  setCameraCorsHeaders,
} from '../_lib/cameraGateway';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const userId = await authenticateCameraOwner(req, res);
  if (!userId) return;
  try {
    const state = getCameraGatewayState();
    const connected = Boolean(activeCameraFrame());
    const lastFrameAt = connected && state.receivedAt
      ? new Date(state.receivedAt).toISOString()
      : await loadCameraLastConnectedAt(userId);
    const gatewayLastSeenAt = await loadCameraGatewayLastSeenAt(userId);
    if (!connected && lastFrameAt && Date.now() - Date.parse(lastFrameAt) > 60_000) {
      await markCameraGatewayOffline(userId).catch((error) => {
        console.warn('Could not record camera interruption for the overnight count.', error);
      });
      await saveCameraOfflineNotification(userId, lastFrameAt);
    }
    res.status(200).json({
      active: connected,
      camera_reachable: connected,
      stream_connected: connected,
      frames_received: state.sequence,
      last_frame_at: lastFrameAt,
      gateway_online: Boolean(gatewayLastSeenAt && Date.now() - Date.parse(gatewayLastSeenAt) <= 60_000),
      gateway_last_seen_at: gatewayLastSeenAt,
    });
  } catch (error) {
    console.error('Could not load the persisted camera connection time.', error);
    res.status(503).json({ error: 'Hindi makuha ang huling koneksyon ng camera.' });
  }
}
