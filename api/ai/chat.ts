/**
 * AlpasFarm AI Chat API
 * POST /api/ai/chat
 *
 * Receives:  { messages: [{role, content, image?}, ...] }
 * Returns:   text/event-stream  →  data: {"token":"..."}\n\n  …  data: {"done":true}\n\n
 *
 * Environment variables (server-side only — NEVER with VITE_ prefix):
 *   GROQ_API_KEY   — required, your Groq API key
 *   GROQ_MODEL     — optional text model override
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import { authenticateSupabaseRequest } from '../_lib/supabaseAuth';
import { checkRateLimit } from '../_lib/rateLimit';
import * as https from 'https';

const GROQ_HOST = 'api.groq.com';
const GROQ_CHAT_PATH = '/openai/v1/chat/completions';
const GROQ_MODELS_PATH = '/openai/v1/models';

function uniqueModels(models: Array<string | undefined>): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter((model): model is string => !!model))];
}

const DEFAULT_VISION_MODELS = uniqueModels([
  process.env.GROQ_VISION_MODEL,
  'qwen/qwen3.8-27b',
]);

const DEFAULT_TEXT_MODELS = uniqueModels([
  process.env.GROQ_MODEL,
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
]);

function supportsVision(modelId: string): boolean {
  return modelId === 'qwen/qwen3.8-27b' || /vision/i.test(modelId);
}

function maxOutputTokens(): number {
  return 2048;
}

interface Message {
  role: string;
  content?: string | any[];
  image?: string;
}

function ensureDataUrl(input: string): string {
  if (!input) return '';
  if (input.startsWith('data:image/')) return input;
  return `data:image/jpeg;base64,${input}`;
}

// ── Tiny HTTPS helpers ────────────────────────────────────────────────────────
function httpsPost(
  hostname: string,
  path: string,
  headers: Record<string, string | number>,
  body: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(240_000, () => { req.destroy(); reject(new Error('Groq request timed out after 240s')); });
    req.write(body);
    req.end();
  });
}

function httpsGet(
  hostname: string,
  path: string,
  headers: Record<string, string | number>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Groq models lookup timed out')); });
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const rid = Math.random().toString(36).slice(2, 8);
  console.log(`[AlpasFarm AI] [${rid}] POST /api/ai/chat`);

  const auth = await authenticateSupabaseRequest(req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error, code: auth.status === 401 ? 'UNAUTHORIZED' : 'AUTH_UNAVAILABLE' });
    return;
  }

  const rate = checkRateLimit(`ai-chat:${auth.user.id}`, 8, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({ error: 'AI request limit reached. Please wait before trying again.', code: 'RATE_LIMIT' });
    return;
  }

  // ── Environment variable check ────────────────────────────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error(`[AlpasFarm AI] [${rid}] [ERROR] GROQ_API_KEY is not set in the server environment.`);
    res.status(503).json({
      error: 'AI assistant is unavailable because the AI provider is not configured. Ask your administrator to add GROQ_API_KEY in the hosting environment.',
      code: 'NO_API_KEY',
    });
    return;
  }

  // ── Parse body & clean messages ───────────────────────────────────────────
  let body: { messages?: Message[] };
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    res.status(400).json({ error: 'Invalid JSON request body.', code: 'INVALID_JSON' });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Request body must be an object.', code: 'INVALID_BODY' });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 3 * 1024 * 1024) {
    res.status(413).json({ error: 'AI request is too large. Reduce the image size or message history.', code: 'BODY_TOO_LARGE' });
    return;
  }

  const rawMessages = body.messages ?? [];
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 12) {
    res.status(400).json({ error: 'Request body must include 1 to 12 messages.', code: 'MISSING_MESSAGES' });
    return;
  }

  // Clean and sanitize messages
  const cleanMessages = rawMessages
    .filter((m) => m && ['user', 'assistant', 'system'].includes(m.role)
      && ((typeof m.content === 'string' && m.content.trim().length > 0) || m.image || Array.isArray(m.content)))
    .filter((m) => !(typeof m.content === 'string' && m.content.trim().startsWith('[WARN]')))
    .map((m) => {
      const role = m.role as 'user' | 'assistant' | 'system';
      let contentStr = '';
      if (typeof m.content === 'string') {
        contentStr = m.content.trim();
      } else if (Array.isArray(m.content)) {
        const textItem = m.content.find((c: any) => c?.type === 'text' && typeof c.text === 'string');
        contentStr = textItem?.text?.trim() || '';
      }
      return {
        role,
        content: contentStr,
        image: typeof m.image === 'string' && m.image.length > 20 ? m.image : undefined,
      };
    });

  const totalTextLength = cleanMessages.reduce((total, message) => total + message.content.length, 0);
  if (cleanMessages.length === 0
    || cleanMessages.some((message) => message.content.length > 16_000)
    || totalTextLength > 32_000) {
    res.status(400).json({ error: 'No valid user messages found in request.', code: 'INVALID_MESSAGES' });
    return;
  }

  const imageMessages = cleanMessages.filter((message) => message.image);
  if (imageMessages.length > 1 || imageMessages.some((message) => message.role !== 'user')) {
    res.status(400).json({ error: 'Attach at most one image to a user message.', code: 'INVALID_IMAGE' });
    return;
  }
  for (const { image } of imageMessages) {
    if (!image || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      res.status(400).json({ error: 'The attached image must be a JPEG, PNG, or WebP data URL.', code: 'INVALID_IMAGE' });
      return;
    }
    const base64 = image.slice(image.indexOf(',') + 1);
    if (Buffer.from(base64, 'base64').byteLength > 1_500_000) {
      res.status(413).json({ error: 'The attached image is too large.', code: 'IMAGE_TOO_LARGE' });
      return;
    }
  }

  const hasImage = cleanMessages.some((m) => !!m.image);
  console.log(`[AlpasFarm AI] [${rid}] Sending ${cleanMessages.length} sanitized message(s) to Groq (hasImage: ${hasImage})`);

  // ── Message formatting for Vision vs Text models ──────────────────────────
  function buildVisionMessages() {
    return cleanMessages.map((m) => {
      if (m.image) {
        return {
          role: m.role,
          content: [
            {
              type: 'text',
              text: m.content || 'Please analyze this livestock image (goat/sheep) for health, breed characteristics, symptoms, and condition.',
            },
            {
              type: 'image_url',
              image_url: { url: ensureDataUrl(m.image) },
            },
          ],
        };
      }
      return {
        role: m.role,
        content: m.content || 'Hello',
      };
    });
  }

  function buildTextMessages() {
    return cleanMessages.map((m) => {
      if (m.image) {
        return {
          role: m.role,
          content: `${m.content || 'Please analyze this livestock image.'}\n\n[User attached an image of a goat/sheep for veterinary visual assessment. Provide comprehensive guidance, common visual symptoms to check, and clinical first-aid recommendations.]`,
        };
      }
      return {
        role: m.role,
        content: m.content || 'Hello',
      };
    });
  }

  // ── Helper to execute chat completion ─────────────────────────────────────
  async function executeGroqChat(modelName: string, isVision: boolean) {
    const formattedMsgs = isVision ? buildVisionMessages() : buildTextMessages();
    const payload = JSON.stringify({
      model: modelName,
      messages: formattedMsgs,
      stream: false,
      temperature: 0.7,
      max_completion_tokens: maxOutputTokens(),
    });
    return httpsPost(
      GROQ_HOST,
      GROQ_CHAT_PATH,
      {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      payload,
    );
  }

  // ── Candidate Model Selection ─────────────────────────────────────────────
  let candidateQueue: Array<{ name: string; isVision: boolean }> = [];

  if (hasImage) {
    for (const vModel of DEFAULT_VISION_MODELS) {
      candidateQueue.push({ name: vModel, isVision: true });
    }
  }

  if (!hasImage) {
    for (const tModel of DEFAULT_TEXT_MODELS) {
      candidateQueue.push({ name: tModel, isVision: false });
    }
  }

  let selectedModel = candidateQueue[0]?.name || 'llama-3.1-8b-instant';
  let groqStatus = 0;
  let groqText = '';

  for (const candidate of candidateQueue) {
    selectedModel = candidate.name;
    try {
      console.log(`[AlpasFarm AI] [${rid}] Attempting model: ${candidate.name} (vision: ${candidate.isVision})`);
      ({ status: groqStatus, text: groqText } = await executeGroqChat(candidate.name, candidate.isVision));

      if (groqStatus === 200) {
        console.log(`[AlpasFarm AI] [${rid}] [OK] Model ${candidate.name} succeeded with HTTP 200`);
        break;
      }

      if (groqStatus === 401) {
        console.error(`[AlpasFarm AI] [${rid}] [ERROR] Groq rejected the API key (401).`);
        res.status(502).json({
          error: 'AI service configuration is invalid.',
          code: 'INVALID_KEY',
        });
        return;
      }

      console.warn(`[AlpasFarm AI] [${rid}] Model ${candidate.name} returned HTTP ${groqStatus}, checking next fallback...`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AlpasFarm AI] [${rid}] Network error on ${candidate.name}: ${msg}`);
    }
  }

  // If all default candidates failed with 404/400, dynamically discover active models from Groq
  if (groqStatus !== 200 && (groqStatus === 404 || groqStatus === 400 || groqStatus === 0)) {
    try {
      console.log(`[AlpasFarm AI] [${rid}] Querying /openai/v1/models for dynamically available models on Groq...`);
      const modelsResp = await httpsGet(
        GROQ_HOST,
        GROQ_MODELS_PATH,
        { 'Authorization': `Bearer ${apiKey}` },
      );

      if (modelsResp.status === 200) {
        const parsedModels = JSON.parse(modelsResp.text);
        const activeChatModels: string[] = (parsedModels?.data ?? [])
          .map((m: any) => m.id)
          .filter((id: string) => !id.includes('whisper') && !id.includes('guard') && !id.includes('tts') && !id.includes('embed'))
          .filter((id: string) => !hasImage || supportsVision(id));

        console.log(`[AlpasFarm AI] [${rid}] Discovered active compatible models:`, activeChatModels.slice(0, 5));

        for (const activeModel of activeChatModels) {
          selectedModel = activeModel;
          const isVision = hasImage && supportsVision(activeModel);
          ({ status: groqStatus, text: groqText } = await executeGroqChat(activeModel, isVision));
          if (groqStatus === 200) {
            console.log(`[AlpasFarm AI] [${rid}] [OK] Dynamic model ${activeModel} succeeded!`);
            break;
          }
        }
      }
    } catch (err: unknown) {
      console.warn(`[AlpasFarm AI] [${rid}] Dynamic model discovery error:`, err);
    }
  }

  // ── Handle error codes if still not 200 ────────────────────────────────────
  if (groqStatus === 429) {
    console.warn(`[AlpasFarm AI] [${rid}] [WARN] Groq rate limit exceeded (429).`);
    res.status(429).json({
      error: 'AI is temporarily busy (rate limit). Please wait a moment and try again.',
      code: 'RATE_LIMIT',
    });
    return;
  }

  if (groqStatus !== 200) {
    console.error(`[AlpasFarm AI] [${rid}] All models failed. Last status: ${groqStatus}. Response: ${groqText.slice(0, 300)}`);
    res.status(502).json({
      error: `AI provider error (${groqStatus || 'timeout'}). Please try again.`,
      code: 'PROVIDER_ERROR',
    });
    return;
  }

  // ── Parse Groq response ───────────────────────────────────────────────────
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(groqText);
  } catch {
    console.error(`[AlpasFarm AI] [${rid}] Failed to parse Groq JSON response.`);
    res.status(502).json({ error: 'Received an invalid response from the AI provider.', code: 'PARSE_ERROR' });
    return;
  }

  const content = parsed?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    console.warn(`[AlpasFarm AI] [${rid}] Groq returned empty content.`);
    res.status(502).json({ error: 'AI returned an empty response. Please try again.', code: 'EMPTY_RESPONSE' });
    return;
  }

  console.log(`[AlpasFarm AI] [${rid}] [OK] Success with [${selectedModel}] — ${content.length} chars → streaming SSE`);

  // ── Emit as SSE in the format the frontend expects ────────────────────────
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const words = content.split(' ');
  for (let i = 0; i < words.length; i++) {
    const token = (i === 0 ? '' : ' ') + words[i];
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}
