import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseServer, getSupabaseServiceRole } from './supabaseServer';

export const CAMERA_FRAME_MAX_BYTES = 1_200_000;
export const CAMERA_FRAME_MAX_AGE_MS = 5_000;
export const CAMERA_STREAM_COOKIE = 'alpasfarm_camera_ticket';
export const CAMERA_STREAM_TICKET_TTL_MS = 20 * 60_000;
export const CAMERA_STREAM_BOUNDARY = 'alpasfarm-live-frame';

export interface CameraCountPayload {
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
  config_revision?: number;
  crossings?: CameraEventIngress[];
  frame_sequence?: number;
  detected_at?: string;
}

export interface CameraGateSettings {
  gate_line_y: number;
  entry_flow: 'top-to-bottom';
  inside_side: 'top' | 'bottom';
  revision: number;
  acknowledged_revision: number;
  gateway_seen_at: string | null;
  gateway_acknowledged: boolean;
  active_session_id: string | null;
}

export interface CameraCrossingInput {
  event_key: string;
  tracking_id: string;
  species_detected: 'goat' | 'sheep';
  direction: 'entry' | 'exit';
  confidence: number;
  movement_observation: 'normal' | 'slow_approach' | 'prolonged_stop';
  config_revision: number;
  created_at: string;
}

export interface CameraEventIngress {
  session_id: string | null;
  event_key: string;
  tracking_id: string;
  animal_type: 'goat' | 'sheep';
  direction: 'entry' | 'exit';
  confidence: number;
  config_revision: number;
}

export interface CameraCountingProgress {
  id: string;
  user_id: string;
  camera_id: string;
  status: 'ONGOING' | 'COMPLETE' | 'MISSING' | 'INCOMPLETE' | 'CANCELLED';
  session_type: 'OVERNIGHT_RETURN';
  started_at: string;
  period_hours: number | null;
  period_ends_at: string | null;
  completed_at: string | null;
  ended_at: string | null;
  required_goats: number;
  required_sheep: number;
  entered_goats: number;
  entered_sheep: number;
  entered_total: number;
  missing_goats: number;
  missing_sheep: number;
  required_total: number;
  missing_total: number;
  entry_event_count: number;
  exit_event_count: number;
  camera_incomplete: boolean;
}

export interface CameraCountingEvent {
  id: string;
  event_key: string;
  tracking_id: string;
  animal_type: 'goat' | 'sheep';
  direction: 'entry' | 'exit';
  confidence: number;
  detected_at: string;
  created_at: string;
}

export interface CameraCountingAlert {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  created_at: string;
  event_key: string | null;
}

export interface CameraCountingOutage {
  id: string;
  started_at: string;
  ended_at: string | null;
}

export interface CameraCountingOverview {
  active_session: CameraCountingProgress | null;
  selected_session_id: string | null;
  sessions: CameraCountingProgress[];
  events: CameraCountingEvent[];
  outages: CameraCountingOutage[];
  alerts: CameraCountingAlert[];
}

export interface CameraGateDailyMetrics {
  day: string;
  entry_count: number;
  exit_count: number;
  goat_entry_count: number;
  goat_exit_count: number;
  sheep_entry_count: number;
  sheep_exit_count: number;
  recent_crossings: Array<CameraCrossingInput>;
}

interface CameraGatewayState {
  frame: Buffer | null;
  receivedAt: number;
  sequence: number;
  count: CameraCountPayload | null;
  countReceivedAt: number;
  countSequence: number;
  lastHeartbeatPersistedAt: number;
  activeStreams: number;
  tickets: Map<string, { userId: string; expiresAt: number }>;
}

const runtimeGlobal = globalThis as typeof globalThis & { __alpasfarmCameraGatewayV2?: CameraGatewayState };

export function getCameraGatewayState(): CameraGatewayState {
  runtimeGlobal.__alpasfarmCameraGatewayV2 ??= {
    frame: null,
    receivedAt: 0,
    sequence: 0,
    count: null,
    countReceivedAt: 0,
    countSequence: 0,
    lastHeartbeatPersistedAt: 0,
    activeStreams: 0,
    tickets: new Map(),
  };
  return runtimeGlobal.__alpasfarmCameraGatewayV2;
}

function readDefaultGateLine(): number {
  const value = Number(process.env.CAMERA_COUNT_LINE_Y || 0.55);
  return Number.isFinite(value) && value >= 0.25 && value <= 0.75 ? value : 0.55;
}

export function getCameraGateSettings(): CameraGateSettings {
  const line = readDefaultGateLine();
  return {
    gate_line_y: line,
    entry_flow: 'top-to-bottom',
    inside_side: 'bottom',
    revision: 0,
    acknowledged_revision: 0,
    gateway_seen_at: null,
    gateway_acknowledged: false,
    active_session_id: null,
  };
}

function mapCameraGateSettings(row: Record<string, unknown>): CameraGateSettings {
  const revision = Number(row.revision || 0);
  const acknowledgedRevision = Number(row.acknowledged_revision || 0);
  const seenAt = typeof row.gateway_seen_at === 'string' ? row.gateway_seen_at : null;
  return {
    gate_line_y: Number(row.gate_line_y),
    entry_flow: 'top-to-bottom',
    inside_side: 'bottom',
    revision,
    acknowledged_revision: acknowledgedRevision,
    gateway_seen_at: seenAt,
    gateway_acknowledged: revision > 0 && acknowledgedRevision === revision,
    active_session_id: typeof row.active_session_id === 'string' ? row.active_session_id : null,
  };
}

export async function loadCameraGateSettings(userId: string): Promise<CameraGateSettings> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera settings database access is not configured.');
  const { data, error } = await client.from('camera_gate_settings')
    .select('gate_line_y,entry_flow,inside_side,revision,acknowledged_revision,gateway_seen_at')
    .eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const settings = data ? mapCameraGateSettings(data as Record<string, unknown>) : getCameraGateSettings();
  const { data: activeSession, error: sessionError } = await client.from('counting_sessions')
    .select('id').eq('user_id', userId).eq('camera_id', 'C320WS-01')
    .eq('session_type', 'OVERNIGHT_RETURN').eq('status', 'ONGOING').maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  return { ...settings, active_session_id: typeof activeSession?.id === 'string' ? activeSession.id : null };
}

export async function saveCameraGateSettings(
  userId: string,
  settings: Pick<CameraGateSettings, 'gate_line_y'>,
): Promise<CameraGateSettings> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera settings database access is not configured.');
  const { data, error } = await client.rpc('save_camera_gate_settings', {
    p_user_id: userId,
    p_gate_line_y: settings.gate_line_y,
    p_entry_flow: 'top-to-bottom',
  });
  if (error || !data) throw new Error(error?.message || 'Camera settings were not saved.');
  const row = Array.isArray(data) ? data[0] : data;
  return mapCameraGateSettings(row as Record<string, unknown>);
}

export async function persistCameraCrossings(userId: string, crossings: CameraCrossingInput[]): Promise<string[]> {
  if (!crossings.length) return [];
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera crossing database access is not configured.');
  const { error } = await client.from('camera_gate_events').upsert(
    crossings.map((crossing) => ({ ...crossing, user_id: userId })),
    { onConflict: 'user_id,event_key', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return crossings.map((crossing) => crossing.event_key);
}

export async function persistCameraCountingCrossings(userId: string, crossings: CameraEventIngress[]): Promise<string[]> {
  if (!crossings.length) return [];
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera counting database access is not configured.');
  const { data, error } = await client.rpc('record_camera_counting_events', {
    p_user_id: userId,
    p_events: crossings,
    p_camera_id: 'C320WS-01',
  });
  if (error || !Array.isArray(data)) throw new Error(error?.message || 'Camera counting events were not confirmed.');
  return data
    .filter((result: unknown) => result && typeof result === 'object'
      && typeof (result as Record<string, unknown>).event_key === 'string')
    .map((result: Record<string, unknown>) => result.event_key as string);
}

export async function persistCameraGatewayHeartbeat(userId: string): Promise<void> {
  const state = getCameraGatewayState();
  const now = Date.now();
  if (now - state.lastHeartbeatPersistedAt < 30_000) return;
  state.lastHeartbeatPersistedAt = now;
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera heartbeat database access is not configured.');
  const { error } = await client.rpc('record_camera_gateway_heartbeat', { p_user_id: userId });
  if (error) {
    throw new Error(error.message);
  }
}

export async function persistCameraServiceHeartbeat(userId: string): Promise<void> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera gateway heartbeat database access is not configured.');
  const { error } = await client.rpc('record_camera_service_heartbeat', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function markCameraGatewayOffline(userId: string): Promise<void> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera status database access is not configured.');
  const { error } = await client.rpc('mark_camera_gateway_offline', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function loadCameraLastConnectedAt(userId: string): Promise<string | null> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera status database access is not configured.');
  const { data, error } = await client.from('camera_gate_settings')
    .select('gateway_seen_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.gateway_seen_at === 'string' ? data.gateway_seen_at : null;
}

export async function loadCameraGatewayLastSeenAt(userId: string): Promise<string | null> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera gateway status database access is not configured.');
  const { data, error } = await client.from('camera_gate_settings')
    .select('gateway_service_seen_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.gateway_service_seen_at === 'string' ? data.gateway_service_seen_at : null;
}

export async function saveCameraOfflineNotification(userId: string, lastConnectedAt: string): Promise<void> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera notification database access is not configured.');
  const { error } = await client.from('notifications').insert({
    user_id: userId,
    type: 'Camera Counting',
    title: 'Camera offline',
    description: `Hindi maaabot ang camera. Huling koneksyon: ${new Date(lastConnectedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`,
    priority: 'Warning',
    link: '/livestock-monitoring',
    event_key: `camera-offline:${lastConnectedAt}`,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function saveCameraGatewayEventAlert(
  userId: string,
  kind: 'invalid' | 'save-failed',
): Promise<void> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera event alert database access is not configured.');
  const minute = Math.floor(Date.now() / 60_000);
  const invalid = kind === 'invalid';
  const { error } = await client.from('notifications').insert({
    user_id: userId,
    type: 'Camera Counting',
    title: invalid ? 'Invalid camera event ignored' : 'Camera event could not be saved',
    description: invalid
      ? 'May crossing data na hindi tinanggap dahil hindi ito pasado sa validation.'
      : 'Hindi makumpirma ang database save. Naka-queue pa ang event sa camera gateway at susubukan muli.',
    priority: 'Warning',
    link: '/livestock-monitoring',
    event_key: `camera-count-${kind}:${minute}`,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function loadCameraCountingOverview(
  userId: string,
  requestedSessionId?: string,
): Promise<CameraCountingOverview> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera counting database access is not configured.');
  const { error: finalizeError } = await client.rpc('finalize_overdue_camera_counting_sessions', { p_user_id: userId });
  if (finalizeError) throw new Error(finalizeError.message);
  const { data, error: sessionsError } = await client.rpc('list_camera_counting_session_progress', {
    p_user_id: userId,
    p_limit: 30,
  });
  if (sessionsError) throw new Error(sessionsError.message);
  if (!Array.isArray(data)) throw new Error('Counting session history is unavailable.');
  const progress = data as CameraCountingProgress[];
  const activeSession = progress.find((session) => session.status === 'ONGOING') ?? null;
  const selectedSession = progress.find((session) => session.id === requestedSessionId)
    ?? activeSession
    ?? progress[0]
    ?? null;

  let events: CameraCountingEvent[] = [];
  let outages: CameraCountingOutage[] = [];
  if (selectedSession) {
    const { data, error } = await client.from('counting_session_events')
      .select('id,event_key,tracking_id,animal_type,direction,confidence,detected_at,created_at')
      .eq('user_id', userId)
      .eq('session_id', selectedSession.id)
      .order('detected_at', { ascending: false })
      .limit(250);
    if (error) throw new Error(error.message);
    events = (data ?? []) as CameraCountingEvent[];

    const { data: outageRows, error: outageError } = await client.from('counting_session_camera_outages')
      .select('id,started_at,ended_at')
      .eq('user_id', userId)
      .eq('session_id', selectedSession.id)
      .order('started_at', { ascending: true });
    if (outageError) throw new Error(outageError.message);
    outages = (outageRows ?? []) as CameraCountingOutage[];
  }

  const { data: alertRows, error: alertsError } = await client.from('notifications')
    .select('id,title,description,priority,created_at,event_key')
    .eq('user_id', userId)
    .like('event_key', 'camera-count-%')
    .order('created_at', { ascending: false })
    .limit(25);
  if (alertsError) throw new Error(alertsError.message);

  return {
    active_session: activeSession,
    selected_session_id: selectedSession?.id ?? null,
    sessions: progress,
    events,
    outages,
    alerts: (alertRows ?? []) as CameraCountingAlert[],
  };
}

export async function startCameraCountingSession(userId: string, periodHours: number): Promise<string> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera counting database access is not configured.');
  const { data, error } = await client.rpc('start_camera_counting_session', {
    p_user_id: userId,
    p_camera_id: 'C320WS-01',
    p_period_hours: periodHours,
  });
  const sessionId = data && typeof data === 'object' ? (data as Record<string, unknown>).session_id : null;
  if (error || typeof sessionId !== 'string') throw new Error(error?.message || 'Counting session was not created.');
  return sessionId;
}

export async function finishCameraCountingSession(
  userId: string,
  sessionId: string,
  status: 'CANCELLED',
): Promise<void> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera counting database access is not configured.');
  const { error } = await client.rpc('finish_camera_counting_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

export async function acknowledgeCameraGateSettings(userId: string, revision: number): Promise<void> {
  if (!Number.isSafeInteger(revision) || revision < 1) return;
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera settings database access is not configured.');
  const { error } = await client.from('camera_gate_settings').update({
    acknowledged_revision: revision,
  }).eq('user_id', userId).eq('revision', revision);
  if (error) throw new Error(error.message);
}

export async function loadCameraGateDailyMetrics(userId: string): Promise<CameraGateDailyMetrics> {
  const client = getSupabaseServiceRole();
  if (!client) throw new Error('Camera crossing database access is not configured.');
  const { data, error } = await client.rpc('get_camera_gate_daily_metrics', { p_user_id: userId });
  if (error || !data || typeof data !== 'object') throw new Error(error?.message || 'Camera crossing totals are unavailable.');
  return data as CameraGateDailyMetrics;
}

function readBearerToken(req: VercelRequest): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return null;
  return authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
}

export async function authenticateCameraOwner(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
  if (!ownerId) {
    res.status(503).json({ error: 'Camera access is not configured.' });
    return null;
  }

  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sign in to view this camera.' });
    return null;
  }

  try {
    const client = getSupabaseServer();
    if (!client) {
      res.status(503).json({ error: 'Camera access is not configured.' });
      return null;
    }
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Sign in to view this camera.' });
      return null;
    }
    if (data.user.id !== ownerId) {
      res.status(403).json({ error: 'This camera is not available to this account.' });
      return null;
    }
    return data.user.id;
  } catch {
    res.status(503).json({ error: 'Could not verify camera access.' });
    return null;
  }
}

export async function authenticateCameraSettingsEditor(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const ownerId = (process.env.CAMERA_OWNER_USER_ID || '').trim();
  if (!ownerId) {
    res.status(503).json({ error: 'Camera access is not configured.' });
    return null;
  }

  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sign in to manage camera counting settings.' });
    return null;
  }

  try {
    const client = getSupabaseServer();
    if (!client) {
      res.status(503).json({ error: 'Camera access is not configured.' });
      return null;
    }
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Sign in to manage camera counting settings.' });
      return null;
    }
    if (data.user.id === ownerId) return ownerId;

    const serviceClient = getSupabaseServiceRole();
    if (!serviceClient) {
      res.status(503).json({ error: 'Camera access is not configured.' });
      return null;
    }
    const { data: profile, error: profileError } = await serviceClient
      .from('profiles').select('role').eq('id', data.user.id).maybeSingle();
    if (profileError) {
      res.status(503).json({ error: 'Could not verify camera settings permission.' });
      return null;
    }
    if (profile?.role === 'system_admin' || profile?.role === 'super_admin') return ownerId;
    res.status(403).json({ error: 'Only the camera owner or an administrator can edit these settings.' });
    return null;
  } catch {
    res.status(503).json({ error: 'Could not verify camera settings permission.' });
    return null;
  }
}

export function cameraGatewayConfigured(): boolean {
  return (process.env.CAMERA_GATEWAY_TOKEN || '').trim().length >= 32
    && Boolean((process.env.CAMERA_OWNER_USER_ID || '').trim());
}

export function setCameraCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Camera-Gateway-Token');
}

export function activeCameraFrame(): Buffer | null {
  const state = getCameraGatewayState();
  return state.frame && Date.now() - state.receivedAt <= CAMERA_FRAME_MAX_AGE_MS ? state.frame : null;
}

export function storeCameraCount(count: CameraCountPayload): void {
  const state = getCameraGatewayState();
  const { crossings: _crossings, config_revision: _configRevision, ...visibleCount } = count;
  state.count = visibleCount;
  state.countReceivedAt = Date.now();
  state.countSequence += 1;
}

export function activeCameraCount(): CameraCountPayload | null {
  const state = getCameraGatewayState();
  return state.count && Date.now() - state.countReceivedAt <= CAMERA_FRAME_MAX_AGE_MS * 2
    ? {
      ...state.count,
      frame_sequence: state.countSequence,
      detected_at: new Date(state.countReceivedAt).toISOString(),
    }
    : null;
}
