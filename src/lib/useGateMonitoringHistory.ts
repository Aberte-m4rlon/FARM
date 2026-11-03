import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';
import {
  listGateAlertsForUser,
  listGateCameraCrossingsForUser,
  listGateEventsForUser,
  listGateSessionsForUser,
  type GateAlert,
  type GateCameraCrossing,
  type GateEvent,
  type GateSession,
} from './gateMonitoring';

export function useGateMonitoringHistory() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<GateSession[]>([]);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [crossings, setCrossings] = useState<GateCameraCrossing[]>([]);
  const [alerts, setAlerts] = useState<GateAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setSessions([]);
      setEvents([]);
      setCrossings([]);
      setAlerts([]);
      setAvailable(true);
      setLoading(false);
      return;
    }
    try {
      const [nextSessions, nextEvents, nextCrossings, nextAlerts] = await Promise.all([
        listGateSessionsForUser(user.id),
        listGateEventsForUser(user.id),
        listGateCameraCrossingsForUser(user.id),
        listGateAlertsForUser(user.id),
      ]);
      setSessions(nextSessions);
      setEvents(nextEvents);
      setCrossings(nextCrossings);
      setAlerts(nextAlerts);
      setAvailable(true);
    } catch {
      setSessions([]);
      setEvents([]);
      setCrossings([]);
      setAlerts([]);
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setSessions([]);
    setEvents([]);
    setCrossings([]);
    setAlerts([]);
    setAvailable(true);
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const channel = supabase
      .channel('gate-history-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_sessions', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_events', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_camera_crossings', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_alerts', filter: 'user_id=eq.' + user.id }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, user]);

  return { sessions, events, crossings, alerts, loading, available };
}
