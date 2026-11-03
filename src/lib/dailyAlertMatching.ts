import type { Notification } from '../types';
import type { DailyAlert } from './recommendations';

export interface DailyAlertWithReadState extends DailyAlert {
  matchingNotif?: Notification;
  isRead: boolean;
}

export function matchDailyAlertsWithReadState(
  alerts: DailyAlert[],
  notifications: Notification[],
): DailyAlertWithReadState[] {
  const notificationByTitleAndType = new Map<string, Notification>();
  for (const notification of notifications) {
    const key = `${notification.type.toLowerCase()}\u0000${notification.title}`;
    if (!notificationByTitleAndType.has(key)) notificationByTitleAndType.set(key, notification);
  }

  return alerts.map((alert) => {
    const key = `${alert.type.toLowerCase()}\u0000${alert.title}`;
    const matchingNotif = notificationByTitleAndType.get(key);
    return {
      ...alert,
      matchingNotif,
      isRead: matchingNotif ? Boolean(matchingNotif.read || matchingNotif.is_read) : false,
    };
  });
}
