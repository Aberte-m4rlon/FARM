import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function localApiPlugin() {
  return {
    name: 'local-api-handler',
    configureServer(server: any) {
      const localEnv = loadEnv(server.config.mode, process.cwd(), '');
      for (const name of [
        'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
        'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
        'ML_BACKEND_URL', 'ML_API_SECRET', 'ML_MAX_IMAGE_BYTES',
        'GROQ_API_KEY', 'GROQ_VISION_MODEL',
        'GEMINI_API_KEY', 'GEMINI_VISION_MODEL',
        'ALLOWED_FRONTEND_ORIGINS',
        'CAMERA_OWNER_USER_ID', 'CAMERA_GATEWAY_TOKEN',
      ]) {
        if (!process.env[name] && localEnv[name]) process.env[name] = localEnv[name];
      }
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const isGateDetector = req.url?.split('?')[0] === '/api/gate/detect';
        const isGateActivity = isGateDetector && new URL(req.url, 'http://localhost').searchParams.get('task') === 'activity';
        const isAdminUsers = req.url?.split('?')[0] === '/api/admin/users';
        const isAuthActivity = req.url?.split('?')[0] === '/api/activity/auth';
        const isHealthScreening = req.url?.split('?')[0] === '/api/health/screen';
        const cameraPath = req.url?.split('?')[0] ?? '';
        const isCameraGateway = cameraPath === '/api/camera/gateway/frame';
        const isCameraRoute = cameraPath === '/api/camera/stream-ticket'
          || cameraPath === '/api/camera/stream' || cameraPath === '/api/camera/status';
        if (
          req.url &&
          (isGateDetector ||
            isAdminUsers ||
            isAuthActivity ||
            isHealthScreening ||
            isCameraGateway ||
            isCameraRoute ||
            req.url.startsWith('/api/auth/sms') ||
            req.url.startsWith('/api/public-animal'))
        ) {
          try {
            let modulePath = '/api/auth/sms.ts';
            if (isGateDetector) {
              modulePath = '/api/gate/detect.ts';
            } else if (isAdminUsers) {
              modulePath = '/api/admin/users.ts';
            } else if (isAuthActivity) {
              modulePath = '/api/activity/auth.ts';
            } else if (isHealthScreening) {
              modulePath = '/api/health/screen.ts';
            } else if (isCameraGateway) {
              modulePath = '/api/camera/gateway/frame.ts';
            } else if (cameraPath === '/api/camera/stream-ticket') {
              modulePath = '/api/camera/stream-ticket.ts';
            } else if (cameraPath === '/api/camera/stream') {
              modulePath = '/api/camera/stream.ts';
            } else if (cameraPath === '/api/camera/status') {
              modulePath = '/api/camera/status.ts';
            } else if (req.url.startsWith('/api/auth/sms')) {
              modulePath = '/api/auth/sms.ts';
            }
            if (req.url.startsWith('/api/public-animal')) {
              modulePath = '/api/public-animal.ts';
            }
            const { default: handler } = await server.ssrLoadModule(modulePath);
            const queryString = req.url?.split('?')[1] ?? '';
            req.query = Object.fromEntries(new URLSearchParams(queryString).entries());
            const vercelRes = {
              get statusCode() { return res.statusCode; },
              set statusCode(code: number) { res.statusCode = code; },
              status(code: number) {
                res.statusCode = code;
                this.statusCode = code;
                return this;
              },
              setHeader(name: string, value: string) {
                res.setHeader(name, value);
                return this;
              },
              write(chunk: any) { return res.write(chunk); },
              on(event: string, listener: (...args: any[]) => void) {
                res.on(event, listener);
                return this;
              },
              json(obj: any) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(obj));
                return this;
              },
              end(chunk?: any) {
                res.end(chunk);
                return this;
              },
            };
            if (isCameraGateway || isCameraRoute) {
              req.body = {};
              await handler(req, vercelRes);
              return;
            }
            if (isGateDetector && !isGateActivity) {
              req.body = undefined;
              await handler(req, vercelRes);
              return;
            }

            let body = '';
            req.on('data', (chunk: any) => { body += chunk.toString(); });
            req.on('end', async () => {
              try {
                req.body = body ? JSON.parse(body) : {};
              } catch {
                req.body = {};
              }
              await handler(req, vercelRes);
            });
            return;
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || 'Local API Error' }));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  // Avoid resolving workspace files through realpath on Windows sandboxed drives.
  resolve: {
    preserveSymlinks: true,
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
