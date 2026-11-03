import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

export type CameraCountingStatus = 'ONGOING' | 'COMPLETE' | 'MISSING' | 'CANCELLED';

export interface CameraCountingReportRow {
  id: string;
  status: CameraCountingStatus;
  started_at: string;
  period_hours: number | null;
  period_ends_at: string | null;
  completed_at: string | null;
  ended_at: string | null;
  required_goats: number;
  entered_goats: number;
  missing_goats: number;
  required_sheep: number;
  entered_sheep: number;
  missing_sheep: number;
  entered_total: number;
  total_required: number;
  total_entered: number;
  total_missing: number;
  entry_event_count: number;
  exit_event_count: number;
  goat_entry_events: number;
  sheep_entry_events: number;
  camera_incomplete: boolean;
}

interface SessionRow {
  id: string;
  status: CameraCountingStatus;
  started_at: string;
  period_hours: number | null;
  period_ends_at: string | null;
  completed_at: string | null;
  ended_at: string | null;
  required_goats: number;
  required_total: number;
  entered_goats: number;
  entered_sheep: number;
  entered_total: number;
  exit_event_count: number;
  missing_goats: number;
  missing_sheep: number;
  missing_total: number;
  required_sheep: number;
  camera_incomplete: boolean;
}

export function useCameraCountingHistory() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<CameraCountingReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setSessions([]);
      setAvailable(true);
      setLoading(false);
      return;
    }
    try {
      const { data: sessionRows, error: sessionError } = await supabase.from('counting_sessions')
        .select('id,status,started_at,period_hours,period_ends_at,completed_at,ended_at,required_goats,required_sheep,required_total,entered_goats,entered_sheep,entered_total,exit_event_count,missing_goats,missing_sheep,missing_total,camera_incomplete')
        .eq('user_id', user.id)
        .eq('session_type', 'OVERNIGHT_RETURN')
        .order('started_at', { ascending: false })
        .limit(1000);
      if (sessionError) throw sessionError;
      const typedSessions = (sessionRows ?? []) as SessionRow[];
      const next = typedSessions.map((session): CameraCountingReportRow => {
        return {
          ...session,
          total_required: session.required_total,
          total_entered: session.entered_total,
          total_missing: session.missing_total,
          entry_event_count: session.entered_total,
          goat_entry_events: session.entered_goats,
          sheep_entry_events: session.entered_sheep,
        };
      });
      setSessions(next);
      setAvailable(true);
    } catch (error) {
      console.error('Could not load database-backed camera counting reports.', error);
      setSessions([]);
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setSessions([]);
    setLoading(Boolean(user));
    setAvailable(true);
    void refresh();
    if (!user) return;
    const channel = supabase
      .channel(`camera-counting-report-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_sessions', filter: `user_id=eq.${user.id}` }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_session_events', filter: `user_id=eq.${user.id}` }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, user]);

  return { sessions, loading, available, refresh };
}
