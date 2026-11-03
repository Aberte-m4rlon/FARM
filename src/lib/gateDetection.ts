import { supabase } from './supabase';

export interface GateDetectorStatus {
  model_loaded: boolean;
  weights_present: boolean;
  classes: string[];
  model_version: string;
  model_error: string | null;
  model_sha256?: string | null;
  image_size?: number | null;
  confidence_threshold?: number | null;
  diagnostics?: {
    successful_inferences_total?: number;
    failed_inferences_total?: number;
    inferences_last_minute?: number;
    inference_fps_recent?: number;
    detections_last_minute?: number;
    total_detections_by_class?: { goat?: number; sheep?: number };
    last_detections_by_class?: { goat?: number; sheep?: number };
    last_success_at?: string | null;
    last_failure_at?: string | null;
    latency_ms_average_recent?: number | null;
    latency_ms_p95_recent?: number | null;
  } | null;
}

export interface GatePrediction {
  class: 'goat' | 'sheep';
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  tracking_id?: string;
  qr_codes?: Array<{
    value: string;
    bbox: { x1: number; y1: number; x2: number; y2: number };
  }>;
  eartag_numbers?: Array<{
    value: string;
    confidence?: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
  }>;
  eartag_number?: string | null;
}

export interface GateDetectionResult {
  success: true;
  counts: { goat: number; sheep: number; total: number };
  predictions: GatePrediction[];
  model_version: string;
  inference_ms?: number;
  image: { width: number; height: number };
  frame_sequence?: number;
  detected_at?: string;
}

export interface FarmCameraCountResult {
  success: true;
  animal_count: number;
  entries_total: number;
  exits_total: number;
  goat_entries_total: number;
  goat_exits_total: number;
  sheep_entries_total: number;
  sheep_exits_total: number;
  model_version: string;
  inference_ms: number;
  image: { width: number; height: number };
  predictions: Array<{
    class: 'goat' | 'sheep';
    confidence: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    tracking_id?: string;
  }>;
  recent_crossings?: FarmCameraCrossing[];
  frame_sequence: number;
  detected_at: string;
}

export interface FarmCameraCrossing {
  event_key: string;
  tracking_id: string;
  species_detected: 'goat' | 'sheep';
  direction: 'entry' | 'exit';
  confidence: number;
  config_revision?: number;
  created_at: string;
}

export interface FarmCameraGateSettings {
  gate_line_y: number;
  entry_flow: 'top-to-bottom';
  inside_side?: 'top' | 'bottom';
  revision?: number;
  acknowledged_revision?: number;
  gateway_seen_at?: string | null;
  gateway_acknowledged?: boolean;
  active_session_id?: string | null;
}

export type GateActivityLabel = 'grazing' | 'running' | 'sitting' | 'standing' | 'walking';

export interface GateActivityFrame {
  image: string;
  at_ms: number;
}

export interface GateActivityStatus {
  model_loaded: boolean;
  weights_present: boolean;
  classes: GateActivityLabel[];
  supported_species: string[];
  model_version: string;
  model_error: string | null;
}

export interface GateActivityResult {
  success: true;
  activity: GateActivityLabel;
  model_score: number;
  probabilities: Record<GateActivityLabel, number>;
  model_version: string;
  screening_only: true;
}

export class GateDetectionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) {
    super(message);
    this.name = 'GateDetectionRequestError';
  }
}

async function authenticatedRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error('Sign in again to use the livestock detector.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35_000);
  try {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return await fetch(path, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Livestock detection took too long. Try scanning again.');
    }
    throw new Error('Could not reach the private livestock detector.');
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = Number(retryAfterHeader);
    const retryAfterDate = retryAfterHeader ? Date.parse(retryAfterHeader) : Number.NaN;
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds * 1_000)
      : Number.isFinite(retryAfterDate) ? Math.max(0, retryAfterDate - Date.now()) : 0;
    throw new GateDetectionRequestError(
      typeof data.error === 'string' ? data.error : 'The livestock detector could not complete this scan.',
      response.status,
      retryAfterMs,
    );
  }
  return data as T;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Could not prepare a camera frame for livestock detection.'));
      else resolve(blob);
    }, 'image/jpeg', 0.70);
  });
}

function validateDetectionResult(data: GateDetectionResult): GateDetectionResult {
  if (
    data.success !== true || !Array.isArray(data.predictions) || !data.counts ||
    !Number.isInteger(data.image?.width) || data.image.width < 1 ||
    !Number.isInteger(data.image?.height) || data.image.height < 1
  ) {
    throw new Error('The livestock detector returned an invalid response.');
  }

  const predictions = data.predictions.filter((item): item is GatePrediction =>
    (item.class === 'goat' || item.class === 'sheep') &&
    Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 &&
    [item.bbox?.x1, item.bbox?.y1, item.bbox?.x2, item.bbox?.y2].every(Number.isFinite),
  ).map((item) => ({
    ...item,
    ...(typeof item.tracking_id === 'string' && /^\d{1,12}$/.test(item.tracking_id)
      ? { tracking_id: item.tracking_id }
      : { tracking_id: undefined }),
    qr_codes: Array.isArray(item.qr_codes) ? item.qr_codes.filter((code) =>
      typeof code?.value === 'string' && code.value.length > 0 && code.value.length <= 2_048 &&
      [code.bbox?.x1, code.bbox?.y1, code.bbox?.x2, code.bbox?.y2].every(Number.isFinite) &&
      code.bbox.x2 > code.bbox.x1 && code.bbox.y2 > code.bbox.y1,
    ) : [],
    eartag_numbers: Array.isArray(item.eartag_numbers) ? item.eartag_numbers.filter((code) =>
      typeof code?.value === 'string' && /^[0-9]{1,6}$/.test(code.value) && Number(code.value) > 0 &&
      (code.confidence === undefined || (Number.isFinite(code.confidence) && code.confidence >= 45 && code.confidence <= 100)) &&
      [code.bbox?.x1, code.bbox?.y1, code.bbox?.x2, code.bbox?.y2].every(Number.isFinite) &&
      code.bbox.x2 > code.bbox.x1 && code.bbox.y2 > code.bbox.y1,
    ) : [],
    eartag_number: typeof item.eartag_number === 'string' ? item.eartag_number.trim() || null : null,
  }));
  return { ...data, predictions };
}

export async function getGateDetectorStatus(): Promise<GateDetectorStatus> {
  const response = await authenticatedRequest('/api/gate/detect');
  return readResponse<GateDetectorStatus>(response);
}

export async function getGateDetectorDiagnostics(): Promise<GateDetectorStatus> {
  const response = await authenticatedRequest('/api/gate/detect?task=diagnostics');
  const status = await readResponse<GateDetectorStatus>(response);
  if (
    typeof status.model_loaded !== 'boolean' || typeof status.model_version !== 'string' ||
    !status.diagnostics || typeof status.diagnostics !== 'object'
  ) throw new Error('The detector diagnostics response is invalid.');
  return status;
}

export async function waitForGateDetector(timeoutMs = 25_000): Promise<GateDetectorStatus> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await getGateDetectorStatus();
    if (!status.weights_present) {
      throw new Error('Hindi pa naibabalik sa ML service ang pribadong goat/sheep best.pt weights.');
    }
    if (status.model_error) {
      throw new Error(status.model_error.includes('exactly goat and sheep')
        ? 'Ang detector ay dapat may eksaktong goat at sheep classes.'
        : 'Nasa ML service ang weights pero hindi ma-load ang detector.');
    }
    if (status.model_loaded) {
      const classes = new Set(status.classes.map((name) => name.toLowerCase()));
      if (classes.size !== 2 || !classes.has('goat') || !classes.has('sheep')) {
        throw new Error('Ang detector ay dapat may eksaktong goat at sheep classes.');
      }
      return status;
    }
    if (Date.now() >= deadline) throw new Error('Masyadong matagal mag-load ang goat/sheep detector. Subukan muli.');
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
}

export async function detectGateLivestock(canvas: HTMLCanvasElement): Promise<GateDetectionResult> {
  if (!canvas.width || !canvas.height) throw new Error('No readable camera frame is available.');
  const image = await canvasToJpeg(canvas);
  const response = await authenticatedRequest('/api/gate/detect', {
    method: 'POST',
    headers: { 'Content-Type': image.type || 'image/jpeg' },
    body: image,
  });
  const data = await readResponse<GateDetectionResult>(response);
  return validateDetectionResult(data);
}

export async function getFarmCameraCount(): Promise<FarmCameraCountResult> {
  const response = await authenticatedRequest('/api/camera/detections');
  const data = await readResponse<FarmCameraCountResult>(response);
  if (
    data.success !== true || !Number.isInteger(data.animal_count) || data.animal_count < 0 ||
    !Number.isSafeInteger(data.entries_total) || data.entries_total < 0 ||
    !Number.isSafeInteger(data.exits_total) || data.exits_total < 0 ||
    !Number.isSafeInteger(data.goat_entries_total) || data.goat_entries_total < 0 ||
    !Number.isSafeInteger(data.goat_exits_total) || data.goat_exits_total < 0 ||
    !Number.isSafeInteger(data.sheep_entries_total) || data.sheep_entries_total < 0 ||
    !Number.isSafeInteger(data.sheep_exits_total) || data.sheep_exits_total < 0 ||
    !Number.isInteger(data.frame_sequence) || data.frame_sequence < 1 ||
    typeof data.model_version !== 'string' || typeof data.inference_ms !== 'number' || !Number.isFinite(data.inference_ms) ||
    !Number.isInteger(data.image?.width) || data.image.width < 1 ||
    !Number.isInteger(data.image?.height) || data.image.height < 1 ||
    typeof data.detected_at !== 'string' || !Number.isFinite(Date.parse(data.detected_at)) ||
    !Array.isArray(data.predictions) || data.predictions.length > 50 || data.predictions.some((prediction) =>
      (prediction.class !== 'goat' && prediction.class !== 'sheep') ||
      !Number.isFinite(prediction.confidence) || prediction.confidence < 0 || prediction.confidence > 1 ||
      ![prediction.bbox?.x1, prediction.bbox?.y1, prediction.bbox?.x2, prediction.bbox?.y2].every(Number.isFinite) ||
      prediction.bbox.x1 < 0 || prediction.bbox.y1 < 0 || prediction.bbox.x2 <= prediction.bbox.x1 ||
      prediction.bbox.y2 <= prediction.bbox.y1 || prediction.bbox.x2 > data.image.width ||
      prediction.bbox.y2 > data.image.height
    ) || (data.recent_crossings !== undefined && (!Array.isArray(data.recent_crossings) || data.recent_crossings.length > 20 || data.recent_crossings.some((crossing) =>
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(crossing.event_key) ||
      !/^T-[0-9]{3,12}$/.test(crossing.tracking_id) ||
      (crossing.species_detected !== 'goat' && crossing.species_detected !== 'sheep') ||
      (crossing.direction !== 'entry' && crossing.direction !== 'exit') ||
      !Number.isFinite(crossing.confidence) || crossing.confidence < 0 || crossing.confidence > 1 ||
      (crossing.config_revision !== undefined && (!Number.isSafeInteger(crossing.config_revision) || crossing.config_revision < 0)) ||
      !Number.isFinite(Date.parse(crossing.created_at))
    )))
  ) throw new Error('Hindi wastong bilang ang ibinalik ng CCTV.');
  return data;
}

export async function getFarmCameraGateSettings(): Promise<FarmCameraGateSettings> {
  const response = await authenticatedRequest('/api/camera/gateway/settings');
  const settings = await readResponse<FarmCameraGateSettings>(response);
  if (!Number.isFinite(settings.gate_line_y) || settings.gate_line_y < 0.25 || settings.gate_line_y > 0.75 ||
    settings.entry_flow !== 'top-to-bottom' ||
    (settings.inside_side !== undefined && settings.inside_side !== 'top' && settings.inside_side !== 'bottom') ||
    (settings.revision !== undefined && (!Number.isSafeInteger(settings.revision) || settings.revision < 0)) ||
    (settings.gateway_acknowledged !== undefined && typeof settings.gateway_acknowledged !== 'boolean')) {
    throw new Error('Hindi wastong pwesto ng counting line.');
  }
  return settings;
}

export async function saveFarmCameraGateSettings(settings: FarmCameraGateSettings): Promise<FarmCameraGateSettings> {
  const response = await authenticatedRequest('/api/camera/gateway/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return readResponse<FarmCameraGateSettings>(response);
}

export async function getGateActivityStatus(): Promise<GateActivityStatus> {
  const response = await authenticatedRequest('/api/gate/detect?task=activity');
  const status = await readResponse<GateActivityStatus>(response);
  if (
    !Array.isArray(status.classes) || !Array.isArray(status.supported_species) ||
    typeof status.model_loaded !== 'boolean' || typeof status.weights_present !== 'boolean'
  ) throw new Error('The activity model returned an invalid status.');
  return status;
}

export async function captureGateActivityFrame(
  source: HTMLCanvasElement,
  atMs: number,
): Promise<GateActivityFrame> {
  const sample = document.createElement('canvas');
  sample.width = 160;
  sample.height = 90;
  const context = sample.getContext('2d');
  if (!context) throw new Error('Could not prepare a camera frame for activity screening.');
  context.drawImage(source, 0, 0, sample.width, sample.height);
  const image = await new Promise<Blob>((resolve, reject) => {
    sample.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode an activity frame.')), 'image/jpeg', 0.55);
  });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read an activity frame.'));
    reader.onerror = () => reject(new Error('Could not read an activity frame.'));
    reader.readAsDataURL(image);
  });
  return { image: dataUrl, at_ms: atMs };
}

export async function predictGateActivity(frames: GateActivityFrame[]): Promise<GateActivityResult> {
  const response = await authenticatedRequest('/api/gate/detect?task=activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames }),
  });
  const result = await readResponse<GateActivityResult>(response);
  const labels = ['grazing', 'running', 'sitting', 'standing', 'walking'];
  if (
    result.success !== true || !labels.includes(result.activity) ||
    typeof result.model_score !== 'number' || !result.probabilities ||
    result.screening_only !== true || typeof result.model_version !== 'string'
  ) throw new Error('The activity model returned an invalid estimate.');
  return result;
}
