import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const routeFiles = new Map([
  ['/api/ai/chat', 'ai/chat.mjs'],
  ['/api/auth/sms', 'auth/sms.mjs'],
  ['/api/activity/auth', 'activity/auth.mjs'],
  ['/api/admin/users', 'admin/users.mjs'],
  ['/api/gate/detect', 'gate/detect.mjs'],
  ['/api/health/screen', 'health/screen.mjs'],
  ['/api/camera/gateway/frame', 'camera/gateway/frame.mjs'],
  ['/api/camera/gateway/detections', 'camera/gateway/detections.mjs'],
  ['/api/camera/gateway/settings', 'camera/gateway/settings.mjs'],
  ['/api/camera/gateway/heartbeat', 'camera/gateway/heartbeat.mjs'],
  ['/api/camera/detections', 'camera/detections.mjs'],
  ['/api/camera/counting-sessions', 'camera/counting-sessions.mjs'],
  ['/api/camera/stream-ticket', 'camera/stream-ticket.mjs'],
  ['/api/camera/stream', 'camera/stream.mjs'],
  ['/api/camera/status', 'camera/status.mjs'],
  ['/api/notifications/dispatch', 'notifications/dispatch.mjs'],
  ['/api/notifications/test', 'notifications/test.mjs'],
  ['/api/public-animal', 'public-animal.mjs'],
]);
const MAX_JSON_BODY_BYTES = 20 * 1024 * 1024;

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body exceeds the server limit.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function makeVercelResponse(res) {
  const adapter = {
    get statusCode() { return res.statusCode; },
    set statusCode(code) { res.statusCode = code; },
    get headersSent() { return res.headersSent; },
    get writableNeedDrain() { return res.writableNeedDrain; },
    status(code) {
      res.statusCode = code;
      return adapter;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return adapter;
    },
    json(value) {
      sendJson(res, res.statusCode || 200, value);
      return adapter;
    },
    write(chunk) { return res.write(chunk); },
    on(event, listener) {
      res.on(event, listener);
      return adapter;
    },
    end(chunk) {
      if (!res.writableEnded) res.end(chunk);
      return adapter;
    },
  };
  return adapter;
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const routeFile = routeFiles.get(requestUrl.pathname);
  if (!routeFile) {
    sendJson(res, 404, { error: 'API route not found.' });
    return;
  }

  try {
    req.query = Object.fromEntries(requestUrl.searchParams.entries());
    const isRawLivestockImage = requestUrl.pathname === '/api/gate/detect'
      && requestUrl.searchParams.get('task') !== 'activity';
    const isRawCameraFrame = requestUrl.pathname === '/api/camera/gateway/frame';
    const isGatewayDetection = requestUrl.pathname === '/api/camera/gateway/detections';
    if (!isRawLivestockImage && !isRawCameraFrame) {
      const maxBodyBytes = isGatewayDetection || requestUrl.pathname.startsWith('/api/notifications/') ? 64 * 1024
          : requestUrl.pathname === '/api/ai/chat' ? 4 * 1024 * 1024
            : MAX_JSON_BODY_BYTES;
      req.body = await parseJsonBody(req, maxBodyBytes);
    }
    const moduleUrl = pathToFileURL(join(root, 'hostinger-api', routeFile)).href;
    const { default: handler } = await import(moduleUrl);
    if (typeof handler !== 'function') throw new Error('API handler is unavailable.');
    await handler(req, makeVercelResponse(res));
    if (!res.writableEnded && !res.headersSent) sendJson(res, 204, {});
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const status = Number(error?.statusCode) || 500;
    sendJson(res, status, {
      error: status === 500 ? 'The API request could not be completed.' : error.message,
    });
  }
});

const port = Number(process.env.PORT || 3000);
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
let lastBreedingSyncWarning = '';
let lastOvernightCountSyncWarning = '';

async function syncBreedingDueAlerts() {
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_breeding_due_alerts`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const warning = `Breeding due-alert sync returned HTTP ${response.status}.`;
      if (warning !== lastBreedingSyncWarning) console.warn(warning);
      lastBreedingSyncWarning = warning;
      return;
    }
    lastBreedingSyncWarning = '';
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Breeding due-alert sync failed.';
    if (warning !== lastBreedingSyncWarning) console.warn('Breeding due-alert sync failed:', warning);
    lastBreedingSyncWarning = warning;
  }
}

async function syncOvernightCameraCounting() {
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_overnight_camera_counting_sessions`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const warning = `Overnight camera-count sync returned HTTP ${response.status}.`;
      if (warning !== lastOvernightCountSyncWarning) console.warn(warning);
      lastOvernightCountSyncWarning = warning;
      return;
    }
    lastOvernightCountSyncWarning = '';
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Overnight camera-count sync failed.';
    if (warning !== lastOvernightCountSyncWarning) console.warn('Overnight camera-count sync failed:', warning);
    lastOvernightCountSyncWarning = warning;
  }
}

server.listen(port, '0.0.0.0', () => {
  console.log(`AlpasFarm API server listening on ${port}.`);
  void syncBreedingDueAlerts();
  void syncOvernightCameraCounting();
});
const breedingDueSyncTimer = setInterval(() => void syncBreedingDueAlerts(), 60_000);
breedingDueSyncTimer.unref?.();
const overnightCameraCountSyncTimer = setInterval(() => void syncOvernightCameraCounting(), 60_000);
overnightCameraCountSyncTimer.unref?.();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(breedingDueSyncTimer);
    clearInterval(overnightCameraCountSyncTimer);
    server.close(() => process.exit(0));
  });
}
