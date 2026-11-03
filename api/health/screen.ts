import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyApiCors } from '../_lib/cors';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 60 };

const MAX_IMAGE_BYTES = 1024 * 1024;
interface VisionImage { mimeType: string; base64: string }
type VisibleStatus = 'healthy' | 'watch' | 'attention';
type VisionProvider = 'gemini' | 'groq';

class VisionApiError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number | null) {
    super(`Vision API returned HTTP ${status}.`);
    this.name = 'VisionApiError';
  }
}

function parseDurationSeconds(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi)];
  if (!parts.length) return null;
  const seconds = parts.reduce((total, part) => {
    const amount = Number(part[1]);
    const unit = part[2].toLowerCase();
    return total + amount * (unit === 'h' ? 3600 : unit === 'm' ? 60 : unit === 'ms' ? 0.001 : 1);
  }, 0);
  return seconds > 0 ? Math.ceil(seconds) : null;
}

function visionRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  const parsedRetryAfter = parseDurationSeconds(retryAfter);
  if (parsedRetryAfter) return parsedRetryAfter;
  if (retryAfter) {
    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.max(1, Math.ceil((retryDate - Date.now()) / 1000));
  }
  return parseDurationSeconds(response.headers.get('x-ratelimit-reset-requests'))
    ?? parseDurationSeconds(response.headers.get('x-ratelimit-reset-tokens'));
}

function toGroqJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalizeTypes = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeTypes);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      key === 'type' && typeof nested === 'string' ? nested.toLowerCase() : normalizeTypes(nested),
    ]));
  };
  return { ...(normalizeTypes(schema) as Record<string, unknown>), additionalProperties: false };
}

function respondVisionFailure(res: VercelResponse, stage: string, error: unknown, fallback: string): void {
  const errorMessage = error instanceof Error ? error.message : 'unknown error';
  if (error instanceof VisionApiError && error.status === 429) {
    const retryAfterSeconds = error.retryAfterSeconds ?? 60;
    console.warn(`[health-screen] Vision API rate limit during ${stage}; retry after ${retryAfterSeconds}s.`);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Naabot muna ang limit ng AI scanner. Susubok muli kapag available na.',
      retry_after_seconds: retryAfterSeconds,
    });
    return;
  }
  console.error(`[health-screen] Vision API ${stage} failed:`, errorMessage);
  respondError(res, 503, fallback);
}

function respondError(res: VercelResponse, status: number, message: string, code?: string): void {
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
}

function requiredText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[<>\u0000-\u001f]/g, '').trim();
  return clean && clean.length <= maximum ? clean : null;
}

async function requestVisionJson(args: {
  provider: VisionProvider;
  apiKey: string;
  model: string;
  images: VisionImage[];
  instruction: string;
  prompt: string;
  signal: AbortSignal;
  maxTokens: number;
  responseSchema?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const isGemini = args.provider === 'gemini';
  const body = JSON.stringify(isGemini
    ? {
      systemInstruction: { parts: [{ text: args.instruction }] },
      contents: [{ role: 'user', parts: [
        { text: args.prompt },
        ...args.images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
      ] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: args.maxTokens,
        responseMimeType: 'application/json',
        ...(args.responseSchema ? { responseSchema: args.responseSchema } : {}),
      },
    }
    : {
      model: args.model,
      temperature: 0.1,
      max_tokens: args.maxTokens,
      ...(args.responseSchema ? {
        tools: [{
          type: 'function',
          function: {
            name: 'return_health_screening',
            description: 'Return the required structured visual health screening result for the goat or sheep in the image.',
            parameters: toGroqJsonSchema(args.responseSchema),
          },
        }],
        tool_choice: { type: 'function', function: { name: 'return_health_screening' } },
      } : {}),
      messages: [
        { role: 'system', content: args.instruction },
        {
          role: 'user',
          content: [
            { type: 'text', text: args.prompt },
            ...args.images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
          ],
        },
      ],
    });
  const url = isGemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`
    : 'https://api.groq.com/openai/v1/chat/completions';
  const headers = isGemini
    ? { 'x-goog-api-key': args.apiKey, 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' };
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    response = await fetch(url, { method: 'POST', headers, signal: args.signal, body });
    if (response.ok || attempt >= 1 || ![500, 502, 503, 504].includes(response.status)) break;
    console.warn(`[health-screen] Vision API returned HTTP ${response.status}; retrying once.`);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  if (!response.ok) throw new VisionApiError(response.status, visionRetryAfter(response));
  const payload = await response.json() as {
    choices?: Array<{ message?: {
      content?: unknown;
      tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }>;
    } }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  const groqMessage = payload.choices?.[0]?.message;
  const screeningTool = groqMessage?.tool_calls?.find((call) => call.function?.name === 'return_health_screening');
  const content = isGemini
    ? payload.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === 'string' ? part.text : '').join('').trim()
    : typeof screeningTool?.function?.arguments === 'string'
      ? screeningTool.function.arguments
      : screeningTool?.function?.arguments && typeof screeningTool.function.arguments === 'object'
        ? JSON.stringify(screeningTool.function.arguments)
        : groqMessage?.content;
  if (typeof content !== 'string') throw new Error('Vision API returned no structured result.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Vision API returned malformed JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Vision API returned an invalid result.');
  return parsed as Record<string, unknown>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { respondError(res, 405, 'Hindi suportado ang request na ito.'); return; }

  const token = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1]
    : null;
  if (!token) { respondError(res, 401, 'Mag-sign in para magamit ang Health Camera.'); return; }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey) {
    respondError(res, 503, 'Hindi available ang Health Camera sa ngayon.');
    return;
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) { respondError(res, 401, 'Nag-expire ang session. Mag-sign in muli.'); return; }

    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { animalId?: unknown; image?: unknown };
    const animalId = requiredText(body?.animalId, 64);
    if (!animalId) { respondError(res, 400, 'Pumili muna ng Kambing o Tupa sa listahan.'); return; }
    const dataUrl = typeof body?.image === 'string' ? body.image : '';
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) { respondError(res, 400, 'Kailangan ng isang malinaw na larawan ng hayop.'); return; }
    const imageBytes = Buffer.from(match[2], 'base64');
    if (!imageBytes.length || imageBytes.length > MAX_IMAGE_BYTES) {
      respondError(res, 413, 'Masyadong malaki ang larawan. Kunan muli nang mas mababa ang resolution.');
      return;
    }
    const images: VisionImage[] = [{ mimeType: match[1].toLowerCase(), base64: match[2] }];

    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('is_active').eq('id', authData.user.id).maybeSingle();
    if (profileError || !profile || profile.is_active === false) {
      respondError(res, 403, 'Hindi aktibo o hindi mapatunayan ang account.');
      return;
    }

    const { data: animal, error: animalError } = await supabase
      .from('animals')
      .select('id,name,species,archived')
      .eq('id', animalId)
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (animalError || !animal || animal.archived) {
      respondError(res, 404, 'Hindi mahanap ang napiling Kambing/Tupa sa inyong talaan.');
      return;
    }

    const expectedSpecies = String(animal.species).toLowerCase().includes('sheep')
      ? 'sheep'
      : String(animal.species).toLowerCase().includes('goat')
        ? 'goat'
        : null;
    if (!expectedSpecies) {
      respondError(res, 422, 'Kambing o tupa lang ang puwedeng i-scan dito.');
      return;
    }

    const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    const visionProviders: Array<{ provider: VisionProvider; apiKey: string; model: string }> = [];
    if (geminiApiKey) visionProviders.push({
      provider: 'gemini',
      apiKey: geminiApiKey,
      model: process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-3.6-flash',
    });
    if (groqApiKey) visionProviders.push({
      provider: 'groq',
      apiKey: groqApiKey,
      model: process.env.GROQ_VISION_MODEL?.trim() || 'qwen/qwen3.8-27b',
    });
    if (!visionProviders.length) {
      respondError(res, 503, 'Hindi mabuksan ang AI scan ngayon. Subukan muli mamaya.');
      return;
    }

    const conditions = [
      'eye_concern',
      'eye_redness_or_discharge',
      'nasal_discharge',
      'excess_salivation',
      'breathing_concern',
      'skin_concern',
      'hoof_or_injury_concern',
      'wound_or_swelling',
      'body_condition_concern',
    ];
    const responseSchema = {
      type: 'OBJECT',
      properties: {
        animal_visible: { type: 'BOOLEAN' },
        species: { type: 'STRING', enum: ['goat', 'sheep', 'other', 'unknown'] },
        image_clear: { type: 'BOOLEAN' },
        single_target_visible: { type: 'BOOLEAN' },
        target_large_enough: { type: 'BOOLEAN' },
        status: { type: 'STRING', enum: ['healthy', 'watch', 'attention', 'not_assessable'] },
        affected_area: { type: 'STRING' },
        concern: { type: 'STRING' },
        possible_condition: { type: 'STRING' },
        possible_conditions: { type: 'ARRAY', items: { type: 'STRING', enum: conditions } },
        recommendation: { type: 'STRING' },
      },
      required: ['animal_visible', 'species', 'image_clear', 'single_target_visible', 'target_large_enough', 'status', 'affected_area', 'concern', 'possible_condition', 'possible_conditions', 'recommendation'],
    };
    let result: Record<string, unknown> | null = null;
    let activeVision: { provider: VisionProvider; model: string } | null = null;
    let lastVisionError: unknown;
    for (let index = 0; index < visionProviders.length; index += 1) {
      const candidate = visionProviders[index];
      try {
        result = await requestVisionJson({
          ...candidate,
          images,
          signal: AbortSignal.timeout(25_000),
          maxTokens: 2048,
          responseSchema,
          instruction: 'Inspect this single clear camera image of one goat or sheep for directly visible appearance concerns. First confirm that exactly one goat or sheep is visible, clear, and large enough to inspect; if not, set status to not_assessable and leave concern, possible_condition, affected_area, recommendation empty and possible_conditions empty. Inspect only visible features in this image: eyes, nose, mouth, breathing posture, visible skin, legs/hooves, wounds, swelling, and body condition. Check for red or irritated eyes, eye discharge, nasal discharge/runny nose, excessive drooling, clearly visible labored breathing, skin lesions/hair loss, hoof or leg abnormality, wounds/swelling, and clearly low body condition. Do not infer symptoms hidden from this view, diagnose a specific disease, infer internal illness, prescribe medicine, or invent findings. Always return every required JSON field. For a clearly non-goat/non-sheep subject, set species to other and status to not_assessable. If the animal or image is unclear, set species to unknown (unless another animal is clearly visible), status to not_assessable, and leave concern, possible_condition, affected_area, recommendation empty and possible_conditions empty. For a suitable goat or sheep image, choose status from visible findings: healthy only when no obvious concern is visible; watch for one mild or uncertain visible sign; attention for multiple clear signs or an obviously severe visible sign. Write concern in concise, plain Filipino and name only visible signs. In possible_condition, describe only a cautious, non-definitive visible-condition category supported by the signs (for example, "posibleng iritasyon sa mata"); do not name a specific disease or make unsupported guesses. For healthy animals set possible_condition empty. Write affected_area in concise Filipino. If no concern is visible, use empty concern and affected_area. Give a short, practical recommendation in Filipino based on the visible evidence. Do not recommend medicine or a treatment protocol. Codes: eye_concern, eye_redness_or_discharge, nasal_discharge, excess_salivation, breathing_concern, skin_concern, hoof_or_injury_concern, wound_or_swelling, body_condition_concern. Use codes only for clearly visible signs.',
          prompt: `Inspect this single image and report only directly visible signs on the goat or sheep. If the animal is too small, unclear, obscured, or not visible, return not_assessable. Do not guess about body parts or symptoms not visible in this image. The selected animal on record is a ${expectedSpecies}.`,
        });
        activeVision = { provider: candidate.provider, model: candidate.model };
        break;
      } catch (error) {
        lastVisionError = error;
        const nextProvider = visionProviders[index + 1];
        if (nextProvider) {
          const reason = error instanceof VisionApiError ? `HTTP ${error.status}` : 'request error';
          console.warn(`[health-screen] ${candidate.provider} failed (${reason}); trying configured ${nextProvider.provider} vision fallback.`);
        }
      }
    }
    if (!result || !activeVision) {
      respondVisionFailure(res, 'all configured vision providers', lastVisionError, 'Pansamantalang abala ang mga AI provider. Susubok muli.');
      return;
    }

    const detectedSpecies = result.species === 'goat' || result.species === 'sheep'
      ? result.species
      : result.species === 'other' ? 'other' : 'unknown';
    if (result.animal_visible !== true || result.image_clear !== true || result.single_target_visible !== true || result.target_large_enough !== true
      || detectedSpecies === 'unknown') {
      const noAnimal = result.animal_visible !== true || detectedSpecies === 'unknown';
      respondError(res, 422, noAnimal
        ? 'Ilapit o iposisyon ang Kambing/Tupa sa camera.'
        : 'Hindi malinaw ang larawan. Pakikuha muli ng malinaw na larawan ng Kambing o Tupa.', noAnimal ? 'NO_ANIMAL' : 'UNCLEAR_IMAGE');
      return;
    }
    if (detectedSpecies === 'other') {
      respondError(res, 422, 'Ang nakikita sa camera ay hindi Kambing o Tupa.', 'NON_TARGET');
      return;
    }
    if (detectedSpecies !== expectedSpecies) {
      respondError(res, 422, 'Hindi tugma ang hayop sa napili sa talaan. Piliin ang tamang Kambing o Tupa at subukan muli.', 'SPECIES_MISMATCH');
      return;
    }
    if (result.status === 'not_assessable') {
      respondError(res, 422, 'Hindi sapat ang nakikitang ebidensya para sa maaasahang pagsusuri. Kunan muli sa maliwanag na lugar at ipakita nang malinaw ang hayop.', 'NOT_ASSESSABLE');
      return;
    }
    if (!['healthy', 'watch', 'attention'].includes(String(result.status))) {
      respondError(res, 503, 'Hindi maunawaan ang resulta ng scan. Subukan muli.');
      return;
    }
    let status: VisibleStatus = result.status as VisibleStatus;
    const conditionLabels: Record<string, string> = {
      eye_concern: 'May napansing pagbabago sa mata',
      eye_redness_or_discharge: 'Namumula o may muta ang mata',
      nasal_discharge: 'May sipon o discharge sa ilong',
      excess_salivation: 'Labis ang paglalaway',
      breathing_concern: 'May nakikitang ubo o hirap sa paghinga',
      skin_concern: 'May sugat, pantal, o pagkalagas ng balahibo',
      hoof_or_injury_concern: 'May pilay o pagbabago sa paa o kuko',
      wound_or_swelling: 'May sugat o pamamaga',
      body_condition_concern: 'Kapansin-pansing payat',
    };
    const possibleConditions = Array.isArray(result.possible_conditions)
      ? [...new Set(result.possible_conditions.filter((value): value is string => typeof value === 'string' && value in conditionLabels))]
        .map((value) => conditionLabels[value])
      : [];
    const observedConcern = requiredText(result.concern, 240);
    const concern = possibleConditions.length ? possibleConditions.join(', ') : observedConcern;
    if (status !== 'healthy' && !concern) {
      respondError(res, 503, 'Hindi nagtugma ang antas ng resulta at ang nakitang senyales. Pakisubukan muli ang scan.');
      return;
    }
    const affectedArea = concern ? requiredText(result.affected_area, 120) : null;
    if (status === 'healthy' && concern) status = 'watch';
    const possibleCondition = requiredText(result.possible_condition, 240);
    const recommendation = requiredText(result.recommendation, 500);
    if (!recommendation) {
      respondError(res, 503, 'Hindi nakabuo ng malinaw na rekomendasyon ang scan. Pakisubukan muli.');
      return;
    }

    res.status(200).json({
      species: expectedSpecies,
      status,
      concern,
      possible_condition: possibleCondition,
      possible_conditions: possibleConditions,
      affected_area: affectedArea,
      recommendation,
      analysis_model: `${activeVision.provider}:${activeVision.model}`,
    });
  } catch (error) {
    console.error('[health-screen] Request failed:', error instanceof Error ? error.message : 'unknown error');
    if (error instanceof SyntaxError) { respondError(res, 400, 'Hindi mabasa ang request.'); return; }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      respondError(res, 503, 'Nagtagal ang scan. Susubok muli.');
      return;
    }
    respondError(res, 503, 'Hindi available ang scan sa ngayon. Susubok muli.');
  }
}
