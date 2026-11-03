import { supabase } from './supabase';

export type GateDirection = 'entry' | 'exit';
export type GateSessionStatus = 'monitoring' | 'reconciled' | 'cancelled';
export type GateAlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface GateDevice {
  id: string;
  user_id: string;
  name: string;
  location: string | null;
  is_active: boolean;
}

export interface GateSession {
  id: string;
  user_id: string;
  gate_id: string;
  status: GateSessionStatus;
  expected_animal_ids: string[];
  expected_count: number;
  entered_count: number;
  exited_count: number;
  missing_count: number;
  max_visible_tracks: number;
  reconciliation_window_minutes: number;
  gate_line_y: number;
  entry_flow: 'top-to-bottom' | 'bottom-to-top';
  started_at: string;
  ended_at: string | null;
}

export interface GateEvent {
  id: string;
  session_id: string;
  user_id: string;
  gate_id: string;
  animal_id: string;
  direction: GateDirection;
  species_detected: 'goat' | 'sheep';
  qr_verified?: boolean;
  eartag_verified?: boolean;
  eartag_number?: string | null;
  confidence: number;
  tracking_id: string | null;
  movement_observation: 'normal' | 'slow_approach' | 'prolonged_stop';
  created_at: string;
}

export interface GateCameraCrossing {
  id: string;
  crossing_key: string;
  session_id: string;
  user_id: string;
  gate_id: string;
  tracking_id: string;
  species_detected: 'goat' | 'sheep';
  direction: GateDirection;
  confidence: number;
  movement_observation: GateEvent['movement_observation'];
  animal_id: string | null;
  event_id: string | null;
  qr_verified?: boolean;
  eartag_verified?: boolean;
  eartag_number?: string | null;
  created_at: string;
}

export interface GateDetectionSighting {
  id: string;
  session_id: string;
  user_id: string;
  gate_id: string;
  tracking_id: string;
  species_detected: 'goat' | 'sheep';
  confidence: number;
  animal_id: string | null;
  qr_verified?: boolean;
  eartag_verified?: boolean;
  eartag_number?: string | null;
  detected_at: string;
  last_seen_at: string;
}

export interface GateCameraMetrics {
  session_id: string;
  crossing_count: number;
  identified_crossing_count: number;
  unidentified_crossing_count: number;
  camera_entry_count: number;
  entry_goat_count?: number;
  entry_sheep_count?: number;
  camera_exit_count: number;
  verified_entry_count: number;
  verified_exit_count: number;
  live_track_count: number;
  live_goat_count: number;
  live_sheep_count: number;
}

export interface GateCameraDailyMetrics {
  day: string;
  goat_entry_count: number;
  sheep_entry_count: number;
  total_entry_count: number;
  goat_exit_count: number;
  sheep_exit_count: number;
  total_exit_count: number;
}

export interface GateLiveTrack {
  session_id: string;
  user_id: string;
  tracking_id: string;
  species_detected: 'goat' | 'sheep';
  confidence: number;
  last_seen_at: string;
}

export interface GateAlert {
  id: string;
  session_id: string;
  user_id: string;
  animal_id: string;
  alert_type: 'unaccounted' | 'movement_observation';
  message: string;
  status: GateAlertStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface FinishGateResult {
  success: boolean;
  session_id: string;
  expected_count: number;
  entered_count: number;
  exited_count: number;
  unaccounted_ids: string[];
  unaccounted_count: number;
}

export interface GateSessionSummary {
  session_id: string;
  expected_animal_ids: string[];
  confirmed_animal_ids: string[];
  inside_animal_ids: string[];
  unaccounted_animal_ids: string[];
}

export interface VerifiedGateQr {
  verified: boolean;
  verification_id?: string;
  animal_id?: string;
  farm_id?: string;
  message?: string;
}

function unwrap<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

function requireData<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error('The gate request returned no data.');
  return unwrap<T>(data);
}

export async function ensureMainGate(userId: string): Promise<GateDevice> {
  const { data, error } = await supabase
    .from('gate_devices')
    .upsert(
      { user_id: userId, name: 'Main Gate', location: 'Farm entrance', is_active: true },
      { onConflict: 'user_id,name' },
    )
    .select('id,user_id,name,location,is_active')
    .single();
  return requireData<GateDevice>(data, error);
}

export async function startGateSession(
  gateId: string,
  expectedAnimalIds: string[],
  windowMinutes: number,
  gateLineY = 0.55,
  entryFlow: 'top-to-bottom' | 'bottom-to-top' = 'top-to-bottom',
): Promise<GateSession> {
  const { data, error } = await supabase.rpc('start_gate_session', {
    p_gate_id: gateId,
    p_expected_animal_ids: [...new Set(expectedAnimalIds)],
    p_reconciliation_window_minutes: windowMinutes,
    p_gate_line_y: gateLineY,
    p_entry_flow: entryFlow,
  });
  return requireData<GateSession>(data, error);
}

export async function getActiveGateSession(userId: string): Promise<GateSession | null> {
  const { data, error } = await supabase
    .from('gate_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'monitoring')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as GateSession | null;
}

export async function getLatestGateSession(userId: string): Promise<GateSession | null> {
  const { data, error } = await supabase
    .from('gate_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as GateSession | null;
}

export async function listGateSessionsForUser(userId: string): Promise<GateSession[]> {
  const { data, error } = await supabase
    .from('gate_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateSession[];
}

export async function getGateSession(sessionId: string): Promise<GateSession> {
  const { data, error } = await supabase
    .from('gate_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  return requireData<GateSession>(data, error);
}

export async function listGateEvents(sessionId: string): Promise<GateEvent[]> {
  const { data, error } = await supabase
    .from('gate_events')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateEvent[];
}

export async function listGateDetectionSightings(sessionId: string): Promise<GateDetectionSighting[]> {
  const { data, error } = await supabase
    .from('gate_detection_sightings')
    .select('id,session_id,user_id,gate_id,tracking_id,species_detected,confidence,animal_id,qr_verified,eartag_verified,eartag_number,detected_at,last_seen_at')
    .eq('session_id', sessionId)
    .order('detected_at', { ascending: false })
    .limit(250);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateDetectionSighting[];
}

export async function listGateCameraCrossings(sessionId: string): Promise<GateCameraCrossing[]> {
  const { data, error } = await supabase
    .from('gate_camera_crossings')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateCameraCrossing[];
}

export async function recordGateDetectionSighting(input: {
  sessionId: string;
  trackingId: string;
  species: 'goat' | 'sheep';
  confidence: number;
}): Promise<GateDetectionSighting> {
  const { data, error } = await supabase.rpc('record_gate_detection_sighting', {
    p_session_id: input.sessionId,
    p_tracking_id: input.trackingId,
    p_species_detected: input.species,
    p_confidence: input.confidence,
  });
  return requireData<GateDetectionSighting>(data, error);
}

export async function linkGateDetectionSightingQr(input: {
  sessionId: string;
  trackingId: string;
  species: 'goat' | 'sheep';
  confidence: number;
  verificationId: string;
}): Promise<GateDetectionSighting> {
  const { data, error } = await supabase.rpc('link_gate_detection_sighting_qr', {
    p_session_id: input.sessionId,
    p_tracking_id: input.trackingId,
    p_species_detected: input.species,
    p_confidence: input.confidence,
    p_verification_id: input.verificationId,
  });
  return requireData<GateDetectionSighting>(data, error);
}

export async function linkGateDetectionSightingEartag(input: {
  sessionId: string;
  trackingId: string;
  species: 'goat' | 'sheep';
  confidence: number;
  eartagNumber: string;
}): Promise<GateDetectionSighting> {
  const { data, error } = await supabase.rpc('link_gate_detection_sighting_eartag', {
    p_session_id: input.sessionId,
    p_tracking_id: input.trackingId,
    p_species_detected: input.species,
    p_confidence: input.confidence,
    p_eartag_number: input.eartagNumber,
  });
  return requireData<GateDetectionSighting>(data, error);
}

export async function listGateEventsForUser(userId: string): Promise<GateEvent[]> {
  const { data, error } = await supabase
    .from('gate_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1_000);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateEvent[];
}

export async function listGateCameraCrossingsForUser(userId: string): Promise<GateCameraCrossing[]> {
  const { data, error } = await supabase
    .from('gate_camera_crossings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1_000);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateCameraCrossing[];
}

export async function listGateAlertsForUser(userId: string): Promise<GateAlert[]> {
  const { data, error } = await supabase
    .from('gate_alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1_000);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateAlert[];
}

export async function listRecentGateLiveTracks(sessionId: string, ageMs = 10_000): Promise<GateLiveTrack[]> {
  const cutoff = new Date(Date.now() - ageMs).toISOString();
  const { data, error } = await supabase
    .from('gate_live_tracks')
    .select('session_id,user_id,tracking_id,species_detected,confidence,last_seen_at')
    .eq('session_id', sessionId)
    .gte('last_seen_at', cutoff)
    .order('last_seen_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateLiveTrack[];
}

export async function recordGateCameraCrossing(input: {
  sessionId: string;
  crossingKey: string;
  trackingId: string;
  species: 'goat' | 'sheep';
  direction: GateDirection;
  confidence: number;
  movementObservation: GateEvent['movement_observation'];
}): Promise<{ success: boolean; duplicate: boolean; crossing_id: string | null }> {
  const { data, error } = await supabase.rpc('record_gate_camera_crossing', {
    p_session_id: input.sessionId,
    p_crossing_key: input.crossingKey,
    p_tracking_id: input.trackingId,
    p_species_detected: input.species,
    p_direction: input.direction,
    p_confidence: input.confidence,
    p_movement_observation: input.movementObservation,
  });
  return requireData<{ success: boolean; duplicate: boolean; crossing_id: string | null }>(data, error);
}

export async function syncGateLiveTracks(
  sessionId: string,
  tracks: Array<{ trackingId: string; species: 'goat' | 'sheep'; confidence: number }>,
): Promise<void> {
  const { error } = await supabase.rpc('sync_gate_live_tracks', {
    p_session_id: sessionId,
    p_tracks: tracks,
  });
  if (error) throw new Error(error.message);
}

export async function clearGateLiveTracks(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_gate_live_tracks', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

export async function getGateSessionSummary(sessionId: string): Promise<GateSessionSummary> {
  const { data, error } = await supabase.rpc('get_gate_session_summary', {
    p_session_id: sessionId,
  });
  return requireData<GateSessionSummary>(data, error);
}

export async function getGateCameraMetrics(sessionId: string): Promise<GateCameraMetrics> {
  const { data, error } = await supabase.rpc('get_gate_camera_metrics', {
    p_session_id: sessionId,
  });
  return requireData<GateCameraMetrics>(data, error);
}

export async function getGateCameraDailyMetrics(): Promise<GateCameraDailyMetrics> {
  const { data, error } = await supabase.rpc('get_gate_camera_daily_metrics');
  return requireData<GateCameraDailyMetrics>(data, error);
}

export async function listGateAlerts(sessionId: string): Promise<GateAlert[]> {
  const { data, error } = await supabase
    .from('gate_alerts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GateAlert[];
}

export async function verifyGateQr(sessionId: string, qrPayload: string, trackingId?: string): Promise<VerifiedGateQr> {
  const { data, error } = await supabase.rpc('verify_gate_qr', {
    p_session_id: sessionId,
    p_qr_payload: qrPayload,
    ...(trackingId ? { p_tracking_id: trackingId } : {}),
  });
  return requireData<VerifiedGateQr>(data, error);
}

export async function recordGateMovement(input: {
  sessionId: string;
  verificationId: string;
  direction: GateDirection;
  species: 'goat' | 'sheep';
  confidence: number;
  trackingId: string;
  movementObservation: GateEvent['movement_observation'];
}): Promise<{ success: boolean; duplicate: boolean; event_id: string }> {
  const { data, error } = await supabase.rpc('record_gate_movement', {
    p_session_id: input.sessionId,
    p_verification_id: input.verificationId,
    p_direction: input.direction,
    p_species_detected: input.species,
    p_confidence: input.confidence,
    p_tracking_id: input.trackingId,
    p_movement_observation: input.movementObservation,
  });
  return requireData<{ success: boolean; duplicate: boolean; event_id: string }>(data, error);
}

export async function recordGateMovementEartag(input: {
  sessionId: string;
  trackingId: string;
  direction: GateDirection;
  species: 'goat' | 'sheep';
  confidence: number;
  eartagNumber: string;
  movementObservation: GateEvent['movement_observation'];
}): Promise<{ success: boolean; duplicate: boolean; event_id: string }> {
  const { data, error } = await supabase.rpc('record_gate_movement_eartag', {
    p_session_id: input.sessionId,
    p_tracking_id: input.trackingId,
    p_direction: input.direction,
    p_species_detected: input.species,
    p_confidence: input.confidence,
    p_eartag_number: input.eartagNumber,
    p_movement_observation: input.movementObservation,
  });
  return requireData<{ success: boolean; duplicate: boolean; event_id: string }>(data, error);
}

export async function recordGateMovementAlert(input: {
  sessionId: string;
  verificationId: string;
  trackingId: string;
  species: 'goat' | 'sheep';
  observation: 'repeated_stop_start' | 'repeated_direction_change';
}): Promise<{ success: boolean; alert_id: string }> {
  const { data, error } = await supabase.rpc('record_gate_movement_alert', {
    p_session_id: input.sessionId,
    p_verification_id: input.verificationId,
    p_tracking_id: input.trackingId,
    p_species_detected: input.species,
    p_observation: input.observation,
  });
  return requireData<{ success: boolean; alert_id: string }>(data, error);
}

export async function finishGateSession(sessionId: string): Promise<FinishGateResult> {
  const { data, error } = await supabase.rpc('finish_gate_session', { p_session_id: sessionId });
  return requireData<FinishGateResult>(data, error);
}

export async function setGateAlertStatus(
  alertId: string,
  status: Exclude<GateAlertStatus, 'active'>,
): Promise<void> {
  const { error } = await supabase.rpc('set_gate_alert_status', {
    p_alert_id: alertId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

export async function cancelGateSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_gate_session', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

export { getActiveAnimals, getGateAnimalSets } from './gateDomain';
