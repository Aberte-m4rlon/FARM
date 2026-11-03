import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';
import {
  getActiveGateSession,
  getGateCameraMetrics,
  getGateCameraDailyMetrics,
  getGateSessionSummary,
  getLatestGateSession,
  listGateAlerts,
  listGateCameraCrossings,
  listGateEvents,
  listRecentGateLiveTracks,
  type GateAlert,
  type GateCameraCrossing,
  type GateCameraMetrics,
  type GateCameraDailyMetrics,
  type GateEvent,
  type GateLiveTrack,
  type GateSession,
  type GateSessionSummary,
} from './gateMonitoring';

export function useGateMonitoringSummary() {
  const { user } = useAuth();
  const [session, setSession] = useState<GateSession | null>(null);
  const [summary, setSummary] = useState<GateSessionSummary | null>(null);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [crossings, setCrossings] = useState<GateCameraCrossing[]>([]);
  const [cameraMetrics, setCameraMetrics] = useState<GateCameraMetrics | null>(null);
  const [dailyMetrics, setDailyMetrics] = useState<GateCameraDailyMetrics | null>(null);
  const [liveTracks, setLiveTracks] = useState<GateLiveTrack[]>([]);
  const [alerts, setAlerts] = useState<GateAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const requestGenerationRef = useRef(0);
  const sessionRef = useRef<GateSession | null>(null);

  const refresh = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    if (!user) {
      setSession(null);
      setSummary(null);
      setEvents([]);
      setCrossings([]);
      setCameraMetrics(null);
      setDailyMetrics(null);
      setLiveTracks([]);
      setAlerts([]);
      setAvailable(true);
      setLoading(false);
      return;
    }
    try {
      const latest = await getActiveGateSession(user.id) ?? await getLatestGateSession(user.id);
      if (requestGeneration !== requestGenerationRef.current) return;
      if (!latest) {
        const today = await getGateCameraDailyMetrics();
        if (requestGeneration !== requestGenerationRef.current) return;
        setSession(null);
        setSummary(null);
        setEvents([]);
        setCrossings([]);
        setCameraMetrics(null);
        setDailyMetrics(today);
        setLiveTracks([]);
        setAlerts([]);
        setAvailable(true);
        return;
      }
      const [nextSummary, nextEvents, nextAlerts, nextCrossings, nextLiveTracks, nextCameraMetrics, nextDailyMetrics] = await Promise.all([
        getGateSessionSummary(latest.id),
        listGateEvents(latest.id),
        listGateAlerts(latest.id),
        listGateCameraCrossings(latest.id),
        latest.status === 'monitoring' ? listRecentGateLiveTracks(latest.id) : Promise.resolve([]),
        getGateCameraMetrics(latest.id),
        getGateCameraDailyMetrics(),
      ]);
      if (requestGeneration !== requestGenerationRef.current) return;
      setSession(latest);
      setSummary(nextSummary);
      setEvents(nextEvents);
      setAlerts(nextAlerts);
      setCrossings(nextCrossings);
      setCameraMetrics(nextCameraMetrics);
      setDailyMetrics(nextDailyMetrics);
      setLiveTracks(nextLiveTracks);
      setAvailable(true);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setSession(null);
      setSummary(null);
      setEvents([]);
      setCrossings([]);
      setCameraMetrics(null);
      setDailyMetrics(null);
      setLiveTracks([]);
      setAlerts([]);
      setAvailable(false);
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [user]);

  const refreshLiveTracks = useCallback(async (sessionId: string) => {
    const requestGeneration = requestGenerationRef.current;
    try {
      const [next, metrics] = await Promise.all([
        listRecentGateLiveTracks(sessionId),
        getGateCameraMetrics(sessionId),
      ]);
      if (requestGeneration === requestGenerationRef.current) {
        setLiveTracks(next);
        setCameraMetrics(metrics);
      }
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setLiveTracks([]);
      setCameraMetrics(null);
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    sessionRef.current = null;
    setSession(null);
    setSummary(null);
    setEvents([]);
    setCrossings([]);
    setCameraMetrics(null);
    setDailyMetrics(null);
    setLiveTracks([]);
    setAlerts([]);
    setAvailable(true);
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const subscriptionId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`dashboard-gate-summary-${user.id}-${subscriptionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_sessions', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_events', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_alerts', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_camera_crossings', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_live_tracks', filter: 'user_id=eq.' + user.id }, () => {
        const activeSessionId = sessionRef.current?.id;
        if (activeSessionId) void refreshLiveTracks(activeSessionId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, refreshLiveTracks, user]);

  useEffect(() => {
    if (!session || session.status !== 'monitoring') return;
    const timer = window.setInterval(() => { void refreshLiveTracks(session.id); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshLiveTracks, session?.id, session?.status]);

  return { session, summary, events, crossings, cameraMetrics, dailyMetrics, liveTracks, alerts, loading, available };
}
