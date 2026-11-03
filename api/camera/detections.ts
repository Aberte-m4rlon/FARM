import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import {
  activeCameraCount,
  authenticateCameraOwner,
  loadCameraGateDailyMetrics,
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
  const count = activeCameraCount();
  if (!count) {
    res.status(503).json({ error: 'Camera count is not available.' });
    return;
  }
  try {
    const metrics = await loadCameraGateDailyMetrics(userId);
    res.status(200).json({
      ...count,
      entries_total: metrics.entry_count,
      exits_total: metrics.exit_count,
      goat_entries_total: metrics.goat_entry_count,
      goat_exits_total: metrics.goat_exit_count,
      sheep_entries_total: metrics.sheep_entry_count,
      sheep_exits_total: metrics.sheep_exit_count,
      recent_crossings: metrics.recent_crossings,
    });
  } catch (error) {
    console.error('Could not load database-backed camera gate counts.', error);
    res.status(503).json({ error: 'Hindi makuha ang na-save na bilang ng pagpasok at paglabas.' });
  }
}
