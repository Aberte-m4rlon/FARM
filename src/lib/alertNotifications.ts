import type { DailyAlert } from './recommendations';

/**
 * Generate and send browser push notifications for daily alerts.
 * Requires Notification API permission.
 */
export async function sendPushNotifications(alerts: DailyAlert[]): Promise<void> {
  if (!('Notification' in window)) {
    throw new Error('Browser does not support notifications');
  }

  // Request permission if not already granted
  if (Notification.permission === 'denied') {
    throw new Error('Notification permission denied');
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission not granted');
    }
  }

  // Filter to critical and warning only (not spammy)
  const urgentAlerts = alerts.filter((a) => a.priority === 'Critical' || a.priority === 'Warning').slice(0, 5);

  urgentAlerts.forEach((alert) => {
    const options: NotificationOptions = {
      icon: '/icon-192.png', // Would need favicon in public/
      badge: '/badge-72.png',
      tag: `daily-alert-${alert.id}`,
      requireInteraction: alert.priority === 'Critical',
      body: alert.description,
    };

    new Notification(`${alert.type}: ${alert.title}`, options);
  });
}

/**
 * Generate an SMS/email-style text summary of daily alerts.
 * Formatted for readability in SMS or email.
 */
export function generateAlertSummary(alerts: DailyAlert[], farmName: string = 'AlpasFarm'): string {
  if (alerts.length === 0) {
    return `AlpasFarm Daily Summary\n\nNo alerts today. Your farm is running smoothly!`;
  }

  const critical = alerts.filter((a) => a.priority === 'Critical');
  const warnings = alerts.filter((a) => a.priority === 'Warning');
  const normal = alerts.filter((a) => a.priority === 'Normal');

  let summary = `${farmName} Daily Alert Summary\n`;
  summary += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
  summary += `Total Alerts: ${alerts.length}\n`;
  summary += `\n${'='.repeat(50)}\n`;

  if (critical.length > 0) {
    summary += `\n[CRITICAL] (${critical.length}):\n`;
    critical.forEach((alert, i) => {
      summary += `${i + 1}. [${alert.type}] ${alert.title}\n`;
      summary += `   ${alert.description}\n`;
      summary += `   Due: ${alert.dueLabel}\n\n`;
    });
  }

  if (warnings.length > 0) {
    summary += `[WARNINGS] (${warnings.length}):\n`;
    warnings.forEach((alert, i) => {
      summary += `${i + 1}. [${alert.type}] ${alert.title}\n`;
      summary += `   ${alert.description}\n`;
      summary += `   Due: ${alert.dueLabel}\n\n`;
    });
  }

  if (normal.length > 0) {
    summary += `[REMINDERS] (${normal.length}):\n`;
    normal.forEach((alert, i) => {
      summary += `${i + 1}. [${alert.type}] ${alert.title}\n`;
      summary += `   Due: ${alert.dueLabel}\n\n`;
    });
  }

  summary += `${'='.repeat(50)}\n`;
  summary += `Reply to this message or visit Goat and Sheep Status (Katayuan ng Kambing at Tupa) to take action.\n`;

  return summary;
}

/**
 * Copy alert summary to clipboard
 */
export async function copyAlertSummaryToClipboard(alerts: DailyAlert[], farmName: string = 'AlpasFarm'): Promise<void> {
  const summary = generateAlertSummary(alerts, farmName);
  try {
    await navigator.clipboard.writeText(summary);
  } catch {
    throw new Error('Failed to copy to clipboard');
  }
}
