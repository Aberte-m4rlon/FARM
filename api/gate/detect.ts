import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyApiCors } from '../_lib/cors';
import { getSupabaseServer } from '../_lib/supabaseServer';

const parsedLimit = Number.parseInt(process.env.ML_MAX_IMAGE_BYTES || String(10 * 1024 * 1024), 10);
const MAX_IMAGE_BYTES = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10 * 1024 * 1024;
const MAX_ACTIVITY_JSON_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const API_TIMEOUT_MS = 30_000;
const MAX_REQUESTS_PER_MINUTE = 300;
const requestTimesByUser = new Map<string, number[]>();

export const config = { api: { bodyParser: false }, maxDuration: 30 };

function responseHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function getBearerToken(req: VercelRequest): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

async function authenticatedUserId(req: VercelRequest): Promise<string | null | undefined> {
  const token = getBearerToken(req);
  if (!token) return null;
  const client = getSupabaseServer();
  if (!client) return undefined;
  const { data, error } = await client.auth.getUser(token);
  return !error && data.user ? data.user.id : null;
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (requestTimesByUser.get(userId) ?? []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    requestTimesByUser.set(userId, recent);
    return true;
  }
  recent.push(now);
  requestTimesByUser.set(userId, recent);
  if (requestTimesByUser.size > 2_000) {
    for (const [key, timestamps] of requestTimesByUser) {
      if (!timestamps.some((timestamp) => now - timestamp < 60_000)) requestTimesByUser.delete(key);
    }
  }
  return false;
}

function getBackendUrl(): string | null {
  const configured = (process.env.ML_BACKEND_URL || '').trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const localHttp = process.env.NODE_ENV !== 'production'
      && process.env.VERCEL !== '1'
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname);
    // Hostinger's private Docker network keeps this HTTP hop off the public
    // internet. Only allow its fixed service name and port when explicitly set.
    const privateContainerHttp = process.env.HOSTINGER_PRIVATE_ML_BACKEND === '1'
      && url.protocol === 'http:'
      && url.hostname === 'ml-server'
      && url.port === '8000';
    if (url.protocol !== 'https:' && !localHttp && !privateContainerHttp) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function readImage(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_IMAGE_BYTES) throw new RangeError('Image exceeds the upload limit.');
    chunks.push(buffer);
  }
  if (!total) throw new TypeError('Image upload is empty.');
  return Buffer.concat(chunks, total);
}

function requestTask(req: VercelRequest): 'species' | 'activity' | 'diagnostics' | null {
  const task = req.query?.task;
  if (task === undefined) return 'species';
  if (task === 'species' || task === 'activity' || task === 'diagnostics') return task;
  return null;
}

async function isActiveAdministrator(userId: string, token: string): Promise<boolean | null> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || (!serviceRoleKey && !anonKey)) return null;
  const client = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const { data, error } = await client
    .from('profiles')
    .select('role, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && data.is_active !== false && ['system_admin', 'super_admin'].includes(data.role));
}

async function readJsonBody(req: VercelRequest): Promise<unknown> {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_ACTIVITY_JSON_BYTES) throw new RangeError('Activity request exceeds the upload limit.');
    chunks.push(buffer);
  }
  if (!total) throw new TypeError('Activity request is empty.');
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Activity request is not valid JSON.');
  }
}

function validateActivityPayload(payload: unknown): payload is {
  frames: Array<{ image: string; at_ms: number }>;
} {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).frames)) return false;
  const frames = (payload as any).frames as unknown[];
  if (frames.length !== 12) return false;
  let imageCharacters = 0;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') return false;
    const image = (frame as any).image;
    const atMs = (frame as any).at_ms;
    if (
      typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,') ||
      image.length > 350_000 || typeof atMs !== 'number' || !Number.isFinite(atMs)
    ) return false;
    imageCharacters += image.length;
  }
  return imageCharacters <= 2_850_000;
}

async function requestDetector(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  responseHeaders(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const task = requestTask(req);
  if (!task) {
    res.status(400).json({ error: 'Unknown livestock detection task.' });
    return;
  }

  let userId: string | null | undefined;
  const bearerToken = getBearerToken(req);
  try {
    userId = await authenticatedUserId(req);
    if (userId === undefined) {
      res.status(503).json({ error: 'Authentication service is not configured.' });
      return;
    }
    if (!userId) {
      res.status(401).json({ error: 'Sign in to use livestock detection.' });
      return;
    }
  } catch {
    res.status(503).json({ error: 'Could not verify the current session.' });
    return;
  }

  if (task === 'diagnostics') {
    let allowed: boolean | null;
    try {
      allowed = bearerToken ? await isActiveAdministrator(userId, bearerToken) : false;
    } catch {
      res.status(503).json({ error: 'Could not verify administrator access.' });
      return;
    }
    if (allowed === null) {
      res.status(503).json({ error: 'Administrator diagnostics are not configured.' });
      return;
    }
    if (!allowed) {
      res.status(403).json({ error: 'Administrator access is required for detector diagnostics.' });
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
  }

  const backendUrl = getBackendUrl();
  const apiSecret = (process.env.ML_API_SECRET || '').trim();
  if (!backendUrl || !apiSecret) {
    res.status(503).json({ error: 'The private livestock detector is not configured.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const healthPath = task === 'activity'
        ? '/api/v1/activity/health'
        : task === 'diagnostics' ? '/api/v1/detect/diagnostics' : '/api/v1/detect/health';
      const upstream = await requestDetector(`${backendUrl}${healthPath}`, { method: 'GET' });
      if (!upstream.ok) {
        res.status(503).json({ error: 'The private livestock detector is unavailable.' });
        return;
      }
      const data = await upstream.json() as Record<string, unknown>;
      if (task === 'diagnostics') {
        const diagnostics = data.diagnostics && typeof data.diagnostics === 'object'
          ? data.diagnostics as Record<string, unknown>
          : {};
        res.status(200).json({
          model_loaded: data.model_loaded === true,
          model_version: typeof data.model_version === 'string' ? data.model_version : 'unknown',
          model_sha256: typeof data.model_sha256 === 'string' ? data.model_sha256 : null,
          image_size: typeof data.image_size === 'number' ? data.image_size : null,
          confidence_threshold: typeof data.confidence_threshold === 'number' ? data.confidence_threshold : null,
          diagnostics,
        });
        return;
      }
      if (task === 'activity') {
        res.status(200).json({
          model_loaded: data.model_loaded === true,
          weights_present: data.weights_present === true,
          classes: Array.isArray(data.classes) ? data.classes : [],
          supported_species: Array.isArray(data.supported_species) ? data.supported_species : [],
          model_version: typeof data.model_version === 'string' ? data.model_version : 'unknown',
          model_error: typeof data.model_error === 'string' ? data.model_error : null,
        });
        return;
      }
      res.status(200).json({
        model_loaded: data.model_loaded === true,
        weights_present: data.weights_present === true,
        classes: Array.isArray(data.classes) ? data.classes : [],
        model_version: typeof data.model_version === 'string' ? data.model_version : 'unknown',
        model_error: typeof data.model_error === 'string' ? data.model_error : null,
        model_sha256: typeof data.model_sha256 === 'string' ? data.model_sha256 : null,
        image_size: typeof data.image_size === 'number' ? data.image_size : null,
        confidence_threshold: typeof data.confidence_threshold === 'number' ? data.confidence_threshold : null,
      });
    } catch {
      res.status(503).json({ error: 'The private livestock detector is unavailable.' });
    }
    return;
  }

  if (isRateLimited(userId)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Too many livestock scans. Wait a minute and try again.' });
    return;
  }

  if (task === 'activity') {
    const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      res.status(422).json({ error: 'Activity estimate requires a JSON camera clip.' });
      return;
    }
    let payload: unknown;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      const tooLarge = error instanceof RangeError;
      res.status(tooLarge ? 413 : 422).json({
        error: tooLarge ? 'Activity clip exceeds the upload limit.' : 'Activity clip is empty or invalid.',
      });
      return;
    }
    if (!validateActivityPayload(payload)) {
      res.status(422).json({ error: 'Activity clip must contain 12 small, timestamped JPEG frames.' });
      return;
    }
    const body = Buffer.from(JSON.stringify(payload));
    try {
      const upstream = await requestDetector(`${backendUrl}/api/v1/activity/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
          'X-API-Key': apiSecret,
        },
        body: body as any,
      });
      if (!upstream.ok) {
        const status = upstream.status === 422 ? 422 : 503;
        res.status(status).json({
          error: status === 422 ? 'The camera activity clip could not be validated.'
            : 'The sheep activity model is unavailable.',
        });
        return;
      }
      res.status(200).json(await upstream.json());
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      res.status(timedOut ? 504 : 503).json({
        error: timedOut ? 'Sheep activity estimate took too long.' : 'The sheep activity model is unavailable.',
      });
    }
    return;
  }

  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    res.status(422).json({ error: 'Upload a JPG, PNG, or WebP image.' });
    return;
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: 'Image exceeds the upload limit.' });
    return;
  }

  let image: Buffer;
  try {
    image = await readImage(req);
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    res.status(tooLarge ? 413 : 422).json({
      error: tooLarge ? 'Image exceeds the upload limit.' : 'Image upload is empty or unreadable.',
    });
    return;
  }

  const boundary = `AlpasFarmGate${Math.random().toString(16).slice(2)}`;
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="gate-frame.jpg"\r\nContent-Type: ${contentType}\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  try {
    const upstream = await requestDetector(`${backendUrl}/api/v1/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(multipart.length),
        'X-API-Key': apiSecret,
      },
      body: multipart as any,
    });
    if (!upstream.ok) {
      const status = upstream.status === 413 ? 413 : upstream.status === 422 ? 422 : 503;
      res.status(status).json({
        error: status === 413 ? 'Image exceeds the upload limit.'
          : status === 422 ? 'The camera frame could not be validated as an image.'
            : 'The private livestock detector could not complete this scan.',
      });
      return;
    }
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    res.status(timedOut ? 504 : 503).json({
      error: timedOut ? 'Livestock detection took too long. Try scanning again.' : 'The private livestock detector is unavailable.',
    });
  }
}
