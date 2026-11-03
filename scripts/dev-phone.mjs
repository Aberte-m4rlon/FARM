import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, loadEnv } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mlRoot = path.join(root, 'ml-server');
const certDir = path.join(tmpdir(), 'alpasfarm-phone-cam');
const certPath = path.join(certDir, 'phone.crt');
const keyPath = path.join(certDir, 'phone.key');
const mlPort = 8001;
const isWindows = process.platform === 'win32';
const pythonPath = path.join(mlRoot, '.venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
const localEnv = loadEnv('development', root, '');

const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? [])
    .filter((address) => !address.internal && (address.family === 'IPv4' || address.family === 4))
    .map((address) => ({ name, address: address.address })),
);
const lanAddress = interfaces.find(({ name }) => /wi-?fi|wireless/i.test(name))?.address
  ?? interfaces.find(({ address }) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))?.address;

if (!lanAddress) throw new Error('Hindi makita ang Wi-Fi address ng computer. Ikonekta ito sa parehong Wi-Fi at subukan muli.');
if (!existsSync(pythonPath)) throw new Error('Hindi makita ang lokal na ML Python environment sa ml-server/.venv.');
if (!existsSync(certPath) || !existsSync(keyPath)) {
  throw new Error('Wala na ang pansamantalang HTTPS certificate. Kailangan itong gawin muli bago gamitin ang phone camera.');
}
if (!localEnv.ML_API_SECRET) throw new Error('Walang ML_API_SECRET sa .env.local; hindi makakakonekta ang camera sa detector.');

const origin = `https://${lanAddress}:5173`;
const frontendEnv = {
  ...process.env,
  ML_BACKEND_URL: `http://127.0.0.1:${mlPort}`,
  ALLOWED_FRONTEND_ORIGINS: origin,
  ALPASFARM_DEV_TLS_CERT: certPath,
  ALPASFARM_DEV_TLS_KEY: keyPath,
};
Object.assign(process.env, frontendEnv);
const mlEnv = {
  ...process.env,
  SPECIES_API_KEY: localEnv.ML_API_SECRET,
  ALLOWED_ORIGINS: origin,
};

function localGateApiPlugin() {
  return {
    name: 'phone-local-gate-api',
    configureServer(server) {
      const localEnv = loadEnv('development', root, '');
      for (const name of [
        'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
        'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'ML_BACKEND_URL',
        'ML_API_SECRET', 'ML_MAX_IMAGE_BYTES', 'ALLOWED_FRONTEND_ORIGINS',
      ]) {
        if (!process.env[name] && localEnv[name]) process.env[name] = localEnv[name];
      }
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/gate/detect') return next();
        try {
          const url = new URL(req.url, 'http://localhost');
          req.query = Object.fromEntries(url.searchParams.entries());
          const { default: handler } = await server.ssrLoadModule('/api/gate/detect.ts');
          const response = {
            get statusCode() { return res.statusCode; },
            set statusCode(code) { res.statusCode = code; },
            get headersSent() { return res.headersSent; },
            status(code) { res.statusCode = code; return this; },
            setHeader(name, value) { res.setHeader(name, value); return this; },
            json(value) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(value));
              return this;
            },
            write(chunk) { return res.write(chunk); },
            end(chunk) { if (!res.writableEnded) res.end(chunk); return this; },
          };
          if (url.searchParams.get('task') !== 'activity') {
            req.body = undefined;
            await handler(req, response);
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          try {
            req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            req.body = {};
          }
          await handler(req, response);
        } catch (error) {
          if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return; }
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Local camera API could not complete the request.' }));
        }
      });
    },
  };
}

const children = [];
let stopping = false;
function start(name, executable, args, options) {
  const child = spawn(executable, args, { stdio: 'inherit', ...options });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    void stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} stopped${signal ? ` (${signal})` : ` (exit ${code ?? 0})`}.`);
    void stop(code || 1);
  });
  return child;
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

console.log(`Phone camera URL: ${origin}`);
console.log('Panatilihing bukas ang app at ML detector habang ginagamit ang live monitoring. Pindutin ang Ctrl+C para ihinto.');
console.log(`Starting this workspace's detector on 127.0.0.1:${mlPort}.`);
start('ML detector', pythonPath, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(mlPort)], {
  cwd: mlRoot,
  env: mlEnv,
});

try {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'spa',
    plugins: [react(), localGateApiPlugin()],
    server: {
      host: lanAddress,
      port: 5173,
      strictPort: true,
      https: { cert: readFileSync(certPath), key: readFileSync(keyPath) },
      fs: { allow: [root] },
    },
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'react/jsx-runtime'],
    },
    ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
  });
  children.push({ kill: () => void server.close(), exitCode: null });
  await server.listen();
  console.log('Camera app is ready over HTTPS on the local Wi-Fi.');
} catch (error) {
  console.error(`Phone web app failed to start: ${error instanceof Error ? error.message : 'unknown error'}`);
  await stop(1);
}
