import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer, loadEnv } from 'vite';

const root = process.cwd();
const env = loadEnv('development', root, '');
for (const [name, value] of Object.entries(env)) {
  if (!process.env[name]) process.env[name] = value;
}
process.env.ML_BACKEND_URL = 'http://127.0.0.1:8000';
process.env.ALLOWED_FRONTEND_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174';

const routes = new Map([
  ['/api/activity/auth', '/api/activity/auth.ts'],
  ['/api/admin/users', '/api/admin/users.ts'],
  ['/api/ai/chat', '/api/ai/chat.ts'],
  ['/api/auth/sms', '/api/auth/sms.ts'],
  ['/api/camera/gateway/detections', '/api/camera/gateway/detections.ts'],
  ['/api/camera/gateway/settings', '/api/camera/gateway/settings.ts'],
  ['/api/camera/detections', '/api/camera/detections.ts'],
  ['/api/camera/counting-sessions', '/api/camera/counting-sessions.ts'],
  ['/api/gate/detect', '/api/gate/detect.ts'],
  ['/api/health/screen', '/api/health/screen.ts'],
  ['/api/notifications/dispatch', '/api/notifications/dispatch.ts'],
  ['/api/notifications/test', '/api/notifications/test.ts'],
  ['/api/public-animal', '/api/public-animal.ts'],
]);
const rawBodyRoutes = new Set(['/api/gate/detect']);
const maxJsonBodyBytes = 20 * 1024 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxJsonBodyBytes) {
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

function makeResponse(response) {
  const adapter = {
    get statusCode() { return response.statusCode; },
    set statusCode(code) { response.statusCode = code; },
    get headersSent() { return response.headersSent; },
    status(code) {
      response.statusCode = code;
      return adapter;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return adapter;
    },
    json(value) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(value));
      return adapter;
    },
    write(chunk) { return response.write(chunk); },
    end(chunk) {
      if (!response.writableEnded) response.end(chunk);
      return adapter;
    },
  };
  return adapter;
}

const vite = await createViteServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
});

const server = createHttpServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const modulePath = routes.get(url.pathname);
  if (!modulePath) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'API route not found.' }));
    return;
  }

  try {
    request.query = Object.fromEntries(url.searchParams.entries());
    if (!rawBodyRoutes.has(url.pathname)) request.body = await readJsonBody(request);
    const { default: handler } = await vite.ssrLoadModule(modulePath);
    if (typeof handler !== 'function') throw new Error('API handler is unavailable.');
    await handler(request, makeResponse(response));
    if (!response.writableEnded && !response.headersSent) response.end();
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const status = Number(error?.statusCode) || 500;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: status === 500 ? 'The API request could not be completed.' : error.message }));
  }
});

const port = Number(process.env.LOCAL_API_PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`ALPASFARM local API listening at http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await vite.close();
    process.exit(0);
  }));
}
