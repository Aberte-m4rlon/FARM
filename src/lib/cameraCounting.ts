import { supabase } from './supabase';

export type CountingSessionStatus = 'ONGOING' | 'COMPLETE' | 'MISSING' | 'CANCELLED';

export interface CameraCountingSession {
  id: string;
  user_id: string;
  camera_id: string;
  session_type: 'OVERNIGHT_RETURN';
  status: CountingSessionStatus;
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
  active_session: CameraCountingSession | null;
  selected_session_id: string | null;
  sessions: CameraCountingSession[];
  events: CameraCountingEvent[];
  outages: CameraCountingOutage[];
  alerts: CameraCountingAlert[];
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Mag-sign in muli para pamahalaan ang bilang ng hayop.');
  return data.session.access_token;
}

async function request<T>(method: 'GET' | 'POST', body?: Record<string, string | number>, sessionId?: string): Promise<T> {
  const token = await getAccessToken();
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const response = await fetch(`/api/camera/counting-sessions${query}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'Hindi ma-update ang counting session.';
    throw new Error(message);
  }
  return payload;
}

export async function loadFarmCountingOverview(sessionId?: string): Promise<CameraCountingOverview> {
  return request<CameraCountingOverview>('GET', undefined, sessionId);
}

export async function startFarmCountingSession(periodHours: number): Promise<CameraCountingOverview> {
  const response = await request<{ overview: CameraCountingOverview }>('POST', { action: 'start', period_hours: periodHours });
  return response.overview;
}

export async function cancelFarmCountingSession(sessionId: string): Promise<CameraCountingOverview> {
  const response = await request<{ overview: CameraCountingOverview }>('POST', { action: 'cancel', session_id: sessionId });
  return response.overview;
}
