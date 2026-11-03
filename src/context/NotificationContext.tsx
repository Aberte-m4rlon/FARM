import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import {
  notificationService,
  normalizeNotification,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type DispatchNotificationPayload,
} from '../lib/notificationService';
import type {
  Notification,
  NotificationType,
  Priority,
  NotificationPreferences,
  NotificationDelivery,
} from '../types';
import type { DailyAlert } from '../lib/recommendations';

export interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  preferences: NotificationPreferences;
  refresh: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<boolean>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  handleNotificationClick: (
    notification: Notification,
    navigate?: (path: string) => void
  ) => Promise<void>;
  createNotification: (data: {
    type: NotificationType;
    title: string;
    description?: string | null;
    message?: string | null;
    priority?: Priority;
    link?: string | null;
    action_url?: string | null;
    animal_id?: string | null;
    event_key?: string | null;
  }) => Promise<Notification | null>;
  dispatchNotification: (
    payload: Omit<DispatchNotificationPayload, 'userId'>
  ) => Promise<{ success: boolean; notification?: Notification; deliveries?: NotificationDelivery[] }>;
  testChannel: (
    channel: 'sms' | 'email',
    recipient?: string
  ) => Promise<{ success: boolean; provider?: string; message?: string; error?: string }>;
  syncAlerts: (alerts: DailyAlert[]) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [loading, setLoading] = useState<boolean>(true);
  const isSyncingRef = useRef<boolean>(false);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  // Calculate unread count (always non-negative)
  const unreadCount = Math.max(
    0,
    notifications.filter((n) => !n.read && !n.is_read).length
  );

  // Refresh notifications from Supabase
  const refresh = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    const list = await notificationService.fetchNotifications(user.id);
    setNotifications(list);
    setLoading(false);
  }, [user]);

  // Refresh user preferences
  const refreshPreferences = useCallback(async () => {
    if (!user) return;
    const prefs = await notificationService.fetchPreferences(user.id);
    setPreferences(prefs);
  }, [user]);

  // Update preferences
  const updatePreferences = useCallback(
    async (newPrefs: Partial<NotificationPreferences>) => {
      if (!user) return false;
      setPreferences((prev) => ({ ...prev, ...newPrefs }));
      const res = await notificationService.updatePreferences(user.id, newPrefs);
      if (res.success) {
        toast('Nai-save ang mga kagustuhan sa notification.', 'success');
        return true;
      } else {
        toast(res.error || 'Hindi na-save ang notification settings.', 'error');
        await refreshPreferences();
        return false;
      }
    },
    [user, toast, refreshPreferences]
  );

  // Initial fetch and Realtime subscriptions
  useEffect(() => {
    refresh();
    refreshPreferences();

    if (!user) return;

    // Realtime Postgres subscription on notifications table
    const notifChannel = supabase
      .channel('public:notifications:' + user.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newNotif = normalizeNotification(payload.new);
            setNotifications((prev) => {
              if (prev.some((n) => n.id === newNotif.id)) return prev;
              return [newNotif, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = normalizeNotification(payload.new);
            setNotifications((prev) =>
              prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
            );
          } else if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id;
            if (oldId) {
              setNotifications((prev) => prev.filter((n) => n.id !== oldId));
            }
          }
        }
      )
      .subscribe();

    // Realtime Postgres subscription on notification_deliveries table
    const deliveryChannel = supabase
      .channel('public:notification_deliveries:' + user.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notification_deliveries',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const delivery = payload.new as NotificationDelivery;
            if (delivery.notification_id) {
              setNotifications((prev) =>
                prev.map((n) => {
                  if (n.id !== delivery.notification_id) return n;
                  const curDeliveries = n.deliveries || [];
                  const exists = curDeliveries.some((d) => d.id === delivery.id);
                  const updatedDelivs = exists
                    ? curDeliveries.map((d) => (d.id === delivery.id ? delivery : d))
                    : [...curDeliveries, delivery];
                  return { ...n, deliveries: updatedDelivs };
                })
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(deliveryChannel);
    };
  }, [user, refresh, refreshPreferences]);

  // Mark single notification as read (Optimistic UI)
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!notificationId) return;

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? {
                ...n,
                read: true,
                is_read: true,
                read_at: n.read_at || new Date().toISOString(),
              }
            : n
        )
      );

      await notificationService.markAsRead(notificationId, user?.id);
    },
    [user]
  );

  // Mark all notifications as read (Optimistic UI)
  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read && !n.is_read);
    if (unread.length === 0) return;

    const nowIso = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        read: true,
        is_read: true,
        read_at: n.read_at || nowIso,
      }))
    );

    toast('Lahat ng paalala ay minarkahan bilang nabasa.', 'success');
    await notificationService.markAllAsRead(user?.id);
  }, [notifications, user, toast]);

  // Delete notification (Optimistic UI)
  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!notificationId) return;
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      await notificationService.deleteNotification(notificationId, user?.id);
    },
    [user]
  );

  // Clear all notifications (Optimistic UI)
  const clearAll = useCallback(async () => {
    setNotifications([]);
    toast('Na-clear na ang lahat ng paalala.', 'success');
    await notificationService.clearAllNotifications(user?.id);
  }, [user, toast]);

  // Click handler with instant optimistic read + route navigation
  const handleNotificationClick = useCallback(
    async (notification: Notification, navigate?: (path: string) => void) => {
      if (!notification) return;

      if (!notification.read && !notification.is_read) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id
              ? {
                  ...n,
                  read: true,
                  is_read: true,
                  read_at: new Date().toISOString(),
                }
              : n
          )
        );

        notificationService.markAsRead(notification.id, user?.id).catch((err) => {
          console.warn('Failed to save read state in DB:', err);
        });
      }

      const targetUrl =
        notification.action_url ||
        notification.link ||
        (notification.animal_id ? `/animals/${notification.animal_id}` : null);

      if (targetUrl && navigate) {
        navigate(targetUrl);
      }
    },
    [user]
  );

  // Create notification helper (backward-compatible)
  const createNotification = useCallback(
    async (data: {
      type: NotificationType;
      title: string;
      description?: string | null;
      message?: string | null;
      priority?: Priority;
      link?: string | null;
      action_url?: string | null;
      animal_id?: string | null;
      event_key?: string | null;
    }) => {
      if (!user) return null;
      const created = await notificationService.createNotification(user.id, data);
      if (created) {
        setNotifications((prev) => [created, ...prev.filter((n) => n.id !== created.id)]);
      }
      return created;
    },
    [user]
  );

  // Unified multi-channel dispatcher (In-App + SMS + Email)
  const dispatchNotification = useCallback(
    async (payload: Omit<DispatchNotificationPayload, 'userId'>) => {
      if (!user) return { success: false };
      const res = await notificationService.dispatchNotification({
        ...payload,
        userId: user.id,
      });

      if (res.notification) {
        const notif = res.notification;
        setNotifications((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)]);
      }
      return res;
    },
    [user]
  );

  // Test SMS / Email channel
  const testChannel = useCallback(
    async (channel: 'sms' | 'email', recipient?: string) => {
      if (!user) {
        return { success: false, error: 'Hindi naka-login ang user.' };
      }
      return await notificationService.testChannel(user.id, channel, recipient);
    },
    [user]
  );

  // Sync daily alerts helper
  const syncAlerts = useCallback(
    async (alerts: DailyAlert[]) => {
      if (!user || isSyncingRef.current || !alerts.length) return;
      isSyncingRef.current = true;
      try {
        const synced = await notificationService.syncDailyAlerts(alerts, user.id, notificationsRef.current);
        notificationsRef.current = synced;
        setNotifications(synced);
      } finally {
        isSyncingRef.current = false;
      }
    },
    [user]
  );

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        preferences,
        refresh,
        refreshPreferences,
        updatePreferences,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAll,
        handleNotificationClick,
        createNotification,
        dispatchNotification,
        testChannel,
        syncAlerts,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
