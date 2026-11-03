import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import {
  authenticateCameraOwner,
  finishCameraCountingSession,
  loadCameraCountingOverview,
  setCameraCorsHeaders,
  startCameraCountingSession,
} from '../_lib/cameraGateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  setCameraCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userId = await authenticateCameraOwner(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const requested = req.query.session_id;
    if (Array.isArray(requested) || (requested !== undefined && (typeof requested !== 'string' || !UUID_PATTERN.test(requested)))) {
      res.status(400).json({ error: 'Hindi wastong counting session.' });
      return;
    }
    try {
      const overview = await loadCameraCountingOverview(userId, requested as string | undefined);
      res.status(200).json(overview);
    } catch (error) {
      console.error('Could not load camera counting sessions.', error);
      res.status(503).json({ error: 'Hindi makuha ang counting session at history mula sa database.' });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  try {
    if (body.action === 'start'
      && Object.keys(body).every((key) => key === 'action' || key === 'period_hours')
      && Number.isInteger(body.period_hours) && Number(body.period_hours) >= 1 && Number(body.period_hours) <= 24) {
      const sessionId = await startCameraCountingSession(userId, Number(body.period_hours));
      const overview = await loadCameraCountingOverview(userId, sessionId);
      res.status(200).json({ created: overview.active_session?.id === sessionId, overview });
      return;
    }
    if (body.action === 'cancel'
      && Object.keys(body).every((key) => key === 'action' || key === 'session_id')
      && typeof body.session_id === 'string' && UUID_PATTERN.test(body.session_id)) {
      await finishCameraCountingSession(userId, body.session_id, 'CANCELLED');
      const overview = await loadCameraCountingOverview(userId, body.session_id);
      res.status(200).json({ overview });
      return;
    }
    res.status(422).json({ error: 'Hindi wastong aksyon para sa counting session.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Counting session was not saved.';
    if (/No active goats or sheep/i.test(message)) {
      res.status(422).json({ error: 'Magdagdag muna ng aktibong kambing o tupa bago magsimula ng bilang.' });
      return;
    }
    console.error('Could not update camera counting session.', error);
    res.status(503).json({ error: 'Hindi na-save ang counting session. Subukan muli kapag maayos ang koneksyon.' });
  }
}
