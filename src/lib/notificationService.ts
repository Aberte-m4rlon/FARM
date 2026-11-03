import { supabase } from './supabase';
import type {
  Notification,
  NotificationDelivery,
  NotificationPreferences,
  Priority,
  NotificationType,
} from '../types';
import type { DailyAlert } from './recommendations';

const MAX_DAILY_ALERT_NOTIFICATION_SYNC = 100;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  health_in_app: true,
  health_sms: true,
  health_email: true,
  inventory_in_app: true,
  inventory_sms: false,
  inventory_email: true,
  breeding_in_app: true,
  breeding_sms: false,
  breeding_email: true,
  vaccination_in_app: true,
  vaccination_sms: true,
  vaccination_email: true,
  medication_in_app: true,
  medication_sms: true,
  medication_email: true,
  sales_in_app: true,
  sales_sms: false,
  sales_email: true,
  system_in_app: true,
  system_sms: false,
  system_email: false,
  critical_bypass: true,
};

/**
 * Normalizes a database notification record to guarantee uniform
 * properties (read / is_read, link / action_url, description / message, deliveries).
 */
export function normalizeNotification(raw: any): Notification {
  const isRead = Boolean(raw.read ?? raw.is_read ?? false);
  const actionUrl = raw.action_url || raw.link || null;
  const description = raw.description || raw.message || null;

  return {
    id: raw.id,
    user_id: raw.user_id,
    type: (raw.type || 'System') as NotificationType,
    title: raw.title || 'Paalala',
    description,
    message: description,
    priority: (raw.priority || 'Normal') as Priority,
    severity: raw.severity || (raw.priority?.toLowerCase() === 'critical' ? 'critical' : 'normal'),
    link: actionUrl,
    action_url: actionUrl,
    animal_id: raw.animal_id || null,
    related_type: raw.related_type || null,
    related_id: raw.related_id || null,
    event_key: raw.event_key || null,
    read: isRead,
    is_read: isRead,
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
    read_at: raw.read_at || (isRead ? new Date().toISOString() : null),
    deliveries: Array.isArray(raw.deliveries) ? raw.deliveries : [],
  };
}

export interface DispatchNotificationPayload {
  userId: string;
  type: NotificationType | string;
  title: string;
  message: string;
  description?: string | null;
  priority?: Priority;
  severity?: 'critical' | 'warning' | 'normal' | 'info';
  link?: string | null;
  actionUrl?: string | null;
  animalId?: string | null;
  relatedType?: 'animal' | 'health' | 'inventory' | 'breeding' | 'vaccination' | 'sale' | 'system';
  relatedId?: string | null;
  eventKey?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  channels?: {
    inApp?: boolean;
    sms?: boolean;
    email?: boolean;
  };
}

export const notificationService = {
  /**
   * Fetch all notifications for the user with delivery logs attached.
   */
  async fetchNotifications(userId?: string): Promise<Notification[]> {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('notificationService.fetchNotifications error:', error.message);
        return [];
      }

      const notifications = (data || []).map(normalizeNotification);

      // Fetch deliveries for these notifications to enrich the cards
      if (notifications.length > 0) {
        try {
          const ids = notifications.map((n) => n.id);
          const { data: delivs } = await supabase
            .from('notification_deliveries')
            .select('*')
            .in('notification_id', ids);

          if (delivs && delivs.length > 0) {
            const delivMap = new Map<string, NotificationDelivery[]>();
            for (const d of delivs) {
              const list = delivMap.get(d.notification_id) || [];
              list.push(d);
              delivMap.set(d.notification_id, list);
            }
            for (const n of notifications) {
              if (delivMap.has(n.id)) {
                n.deliveries = delivMap.get(n.id);
              }
            }
          }
        } catch (delivErr) {
          // Delivery fetch is non-blocking
          console.warn('Could not load deliveries for notifications:', delivErr);
        }
      }

      return notifications;
    } catch (err) {
      console.warn('notificationService.fetchNotifications caught:', err);
      return [];
    }
  },

  /**
   * Fetch delivery records for a specific notification.
   */
  async fetchDeliveries(notificationId: string): Promise<NotificationDelivery[]> {
    if (!notificationId) return [];
    try {
      const { data, error } = await supabase
        .from('notification_deliveries')
        .select('*')
        .eq('notification_id', notificationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('fetchDeliveries error:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('fetchDeliveries caught:', err);
      return [];
    }
  },

  /**
   * Mark a single notification as read permanently in Supabase.
   */
  async markAsRead(notificationId: string, userId?: string): Promise<boolean> {
    if (!notificationId) return false;
    try {
      let query = supabase
        .from('notifications')
        .update({
          read: true,
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;
      if (error) {
        console.warn('notificationService.markAsRead failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('notificationService.markAsRead exception:', err);
      return false;
    }
  },

  /**
   * Mark all unread notifications as read permanently in Supabase.
   */
  async markAllAsRead(userId?: string): Promise<boolean> {
    try {
      let query = supabase
        .from('notifications')
        .update({
          read: true,
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('read', false);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;
      if (error) {
        console.warn('notificationService.markAllAsRead failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('notificationService.markAllAsRead exception:', err);
      return false;
    }
  },

  /**
   * Delete a single notification.
   */
  async deleteNotification(notificationId: string, userId?: string): Promise<boolean> {
    if (!notificationId) return false;
    try {
      let query = supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;
      if (error) {
        console.warn('notificationService.deleteNotification failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('notificationService.deleteNotification exception:', err);
      return false;
    }
  },

  /**
   * Delete all notifications for the active user.
   */
  async clearAllNotifications(userId?: string): Promise<boolean> {
    try {
      let query = supabase
        .from('notifications')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;
      if (error) {
        console.warn('notificationService.clearAllNotifications failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('notificationService.clearAllNotifications exception:', err);
      return false;
    }
  },

  /**
   * Unified multi-channel dispatcher (In-App + SMS + Email).
   * Dispatches server-side with anti-duplicate eventKey check and preference enforcement.
   * Asynchronous: Will never throw or abort parent transactions.
   */
  async dispatchNotification(
    payload: DispatchNotificationPayload
  ): Promise<{ success: boolean; notification?: Notification; deliveries?: NotificationDelivery[] }> {
    let response: Response;
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session?.access_token) {
        console.warn('[notificationService.dispatchNotification] No Supabase session is available.');
        return { success: false };
      }

      response = await fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          message: payload.message || payload.description,
          description: payload.description || payload.message,
          priority: payload.priority || 'Normal',
          severity: payload.severity,
          link: payload.link || payload.actionUrl,
          animalId: payload.animalId,
          relatedType: payload.relatedType,
          relatedId: payload.relatedId,
          eventKey: payload.eventKey,
          recipientPhone: payload.recipientPhone,
          recipientEmail: payload.recipientEmail,
          channels: payload.channels,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          notification: data.notification ? normalizeNotification(data.notification) : undefined,
          deliveries: data.deliveries,
        };
      }
      console.warn('[notificationService.dispatchNotification] Backend rejected dispatch:', response.status);
      return { success: false };
    } catch (err) {
      console.warn('[notificationService.dispatchNotification] Backend dispatch network warning:', err);
    }

    // Keep an in-app notification available during network outages; RLS still enforces ownership.
    try {
      const fallbackPayload = {
        user_id: payload.userId,
        type: payload.type || 'System',
        title: payload.title,
        description: payload.description || payload.message,
        message: payload.message || payload.description,
        priority: payload.priority || 'Normal',
        link: payload.link || payload.actionUrl || null,
        animal_id: payload.animalId || null,
        related_type: payload.relatedType || null,
        related_id: payload.relatedId || null,
        event_key: payload.eventKey || null,
        read: false,
        is_read: false,
      };

      const { data: created, error } = await supabase
        .from('notifications')
        .insert(fallbackPayload)
        .select('*')
        .maybeSingle();

      if (error) {
        console.warn('[notificationService.dispatchNotification] Fallback insert failed:', error.message);
        return { success: false };
      }
      if (!created) {
        console.warn('[notificationService.dispatchNotification] Fallback insert returned no notification.');
        return { success: false };
      }
      return {
        success: true,
        notification: normalizeNotification(created),
      };
    } catch (fallbackErr) {
      console.warn('[notificationService.dispatchNotification] Fallback insert error:', fallbackErr);
      return { success: false };
    }
  },

  /**
   * Create an in-app notification (backward compatible wrapper around dispatchNotification).
   */
  async createNotification(
    userId: string,
    data: {
      type: NotificationType;
      title: string;
      description?: string | null;
      message?: string | null;
      priority?: Priority;
      link?: string | null;
      action_url?: string | null;
      animal_id?: string | null;
      read?: boolean;
      is_read?: boolean;
      event_key?: string | null;
    }
  ): Promise<Notification | null> {
    const res = await this.dispatchNotification({
      userId,
      type: data.type,
      title: data.title,
      message: data.message || data.description || '',
      description: data.description || data.message || '',
      priority: data.priority,
      link: data.link || data.action_url,
      animalId: data.animal_id,
      eventKey: data.event_key,
    });
    return res.notification || null;
  },

  /**
   * Synchronize system-generated daily alerts into notifications with event-key deduplication.
   */
  async syncDailyAlerts(
    alerts: DailyAlert[],
    userId: string,
    existingNotifications: Notification[]
  ): Promise<Notification[]> {
    if (!userId || !alerts.length) return existingNotifications;

    const todayStr = new Date().toISOString().slice(0, 10);
    const existingTitles = new Set(
      existingNotifications.map((n) => `${n.type}-${n.title}`)
    );
    const syncableAlerts = alerts.slice(0, MAX_DAILY_ALERT_NOTIFICATION_SYNC);
    const alertKeys = syncableAlerts.map((alert) => `alert_${alert.id}_${todayStr}`);
    const existingKeys = new Set<string>();
    for (let offset = 0; offset < alertKeys.length; offset += 100) {
      const { data, error } = await supabase
        .from('notifications')
        .select('event_key')
        .eq('user_id', userId)
        .in('event_key', alertKeys.slice(offset, offset + 100));
      if (error) {
        console.warn('notificationService.syncDailyAlerts could not check existing daily alert keys:', error.message);
        return existingNotifications;
      }
      for (const row of data ?? []) {
        if (typeof row.event_key === 'string') existingKeys.add(row.event_key);
      }
    }

    const rows = syncableAlerts.flatMap((alert) => {
      const titleKey = `${alert.type}-${alert.title}`;
      const eventKey = `alert_${alert.id}_${todayStr}`;
      if (existingTitles.has(titleKey) || existingKeys.has(eventKey)) return [];
      existingTitles.add(titleKey);
      existingKeys.add(eventKey);
      const severity = alert.priority === 'Critical' ? 'critical'
        : alert.priority === 'Warning' ? 'warning'
          : alert.priority === 'Success' ? 'info' : 'normal';
      return [{
        user_id: userId,
        type: alert.type,
        title: alert.title,
        description: alert.description,
        message: alert.description,
        priority: alert.priority,
        severity,
        link: alert.link,
        event_key: eventKey,
        read: false,
        is_read: false,
      }];
    });

    if (!rows.length) return existingNotifications;
    const newlyCreated: Notification[] = [];
    for (let offset = 0; offset < rows.length; offset += 100) {
      const { data, error } = await supabase
        .from('notifications')
        .insert(rows.slice(offset, offset + 100))
        .select('*');
      if (error) {
        console.warn('notificationService.syncDailyAlerts could not batch daily alerts:', error.message);
        break;
      }
      newlyCreated.push(...(data ?? []).map(normalizeNotification));
    }

    return [...newlyCreated, ...existingNotifications];
  },

  /**
   * Fetch user notification preferences.
   */
  async fetchPreferences(userId: string): Promise<NotificationPreferences> {
    if (!userId) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        return {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...data,
        };
      }
    } catch (err) {
      console.warn('fetchPreferences caught:', err);
    }
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  },

  /**
   * Save user notification preferences.
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<{ success: boolean; error?: string }> {
    if (!userId) return { success: false, error: 'User ID missing' };
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(
          {
            user_id: userId,
            ...preferences,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        console.warn('updatePreferences error:', error.message);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to save preferences' };
    }
  },

  /**
   * Send test notification (SMS or Email) to verify provider setup.
   */
  async testChannel(
    userId: string,
    channel: 'sms' | 'email',
    recipient?: string
  ): Promise<{ success: boolean; provider?: string; message?: string; error?: string }> {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session?.access_token) {
        return { success: false, error: 'Mag-login sa Supabase bago subukan ang notification channel.' };
      }
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId, channel, recipient }),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Network error calling test endpoint.',
      };
    }
  },
};
