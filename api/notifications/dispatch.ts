import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from '../_lib/cors';
import { authenticateSupabaseRequest } from '../_lib/supabaseAuth';
import { checkRateLimit } from '../_lib/rateLimit';
import {
  dispatchSms,
  dispatchEmail,
  buildEmailTemplate,
  normalizePhoneNumber,
} from '../_lib/sender';

interface DispatchRequestBody {
  userId: string;
  type: string;
  title: string;
  message: string;
  description?: string;
  priority?: string;
  severity?: 'critical' | 'warning' | 'normal' | 'info';
  link?: string;
  actionUrl?: string;
  animalId?: string;
  relatedType?: string;
  relatedId?: string;
  eventKey?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  channels?: {
    inApp?: boolean;
    sms?: boolean;
    email?: boolean;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }
  const bodySize = Buffer.byteLength(
    typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
    'utf8',
  );
  if (bodySize > 64 * 1024) {
    res.status(413).json({ error: 'Notification request is too large.' });
    return;
  }

  const auth = await authenticateSupabaseRequest(req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const rate = checkRateLimit(`notification-dispatch:${auth.user.id}`, 20, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({ error: 'Notification dispatch limit reached. Please try again later.' });
    return;
  }

  const body = req.body as DispatchRequestBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !body.userId || !body.title || (!body.message && !body.description)) {
    res.status(400).json({
      error: 'Missing required parameters (userId, title, message are required).',
    });
    return;
  }
  if (body.userId !== auth.user.id) {
    res.status(403).json({ error: 'You may only dispatch notifications for your own account.' });
    return;
  }
  if (typeof body.title !== 'string' || body.title.trim().length > 160
    || typeof (body.message || body.description) !== 'string'
    || (body.message || body.description || '').trim().length === 0
    || (body.message || body.description || '').trim().length > 4000
    || (body.type !== undefined && (typeof body.type !== 'string' || body.type.length > 40))
    || (body.priority !== undefined && (typeof body.priority !== 'string' || body.priority.length > 20))
    || (body.animalId !== undefined && (typeof body.animalId !== 'string' || body.animalId.length > 80))
    || (body.relatedType !== undefined && (typeof body.relatedType !== 'string' || body.relatedType.length > 80))
    || (body.relatedId !== undefined && (typeof body.relatedId !== 'string' || body.relatedId.length > 160))
    || (body.eventKey !== undefined && (typeof body.eventKey !== 'string' || body.eventKey.length > 200))
    || ([body.link, body.actionUrl].some((value) => value !== undefined && value !== null
      && (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || value.startsWith('//'))))
    || (body.severity !== undefined && !['critical', 'warning', 'normal', 'info'].includes(body.severity))
    || (body.channels !== undefined && (!body.channels || typeof body.channels !== 'object'
      || Array.isArray(body.channels)
      || Object.values(body.channels).some((value) => typeof value !== 'boolean')))
    || (body.recipientEmail !== undefined
      && (typeof body.recipientEmail !== 'string' || body.recipientEmail.length > 320))
    || (body.recipientPhone !== undefined
      && (typeof body.recipientPhone !== 'string' || body.recipientPhone.length > 40))) {
    res.status(400).json({ error: 'Notification fields are invalid or exceed supported limits.' });
    return;
  }

  const email = auth.user.email_confirmed_at ? auth.user.email?.trim() || '' : '';
  const phone = auth.user.phone_confirmed_at ? auth.user.phone?.trim() || '' : '';
  if (body.recipientEmail && body.recipientEmail.trim().toLowerCase() !== email.toLowerCase()) {
    res.status(403).json({ error: 'Notifications may only be sent to the verified account email.' });
    return;
  }
  if (body.recipientPhone) {
    const requestedPhone = normalizePhoneNumber(body.recipientPhone);
    const verifiedPhone = normalizePhoneNumber(phone);
    if (!phone || !requestedPhone.valid || !verifiedPhone.valid || requestedPhone.e164 !== verifiedPhone.e164) {
      res.status(403).json({ error: 'Notifications may only be sent to the verified account phone number.' });
      return;
    }
  }

  const {
    userId,
    type = 'System',
    title,
    message = body.description || '',
    priority = 'Normal',
    link = body.actionUrl || null,
    animalId = null,
    relatedType = null,
    relatedId = null,
    eventKey = null,
    recipientPhone,
    recipientEmail,
    channels,
  } = body;

  const normalizedSeverity: 'critical' | 'warning' | 'normal' | 'info' =
    body.severity ||
    (priority.toLowerCase() === 'critical'
      ? 'critical'
      : priority.toLowerCase() === 'warning' || priority.toLowerCase() === 'high'
      ? 'warning'
      : 'normal');

  const supabase = auth.client;
  const deliveries: Array<{
    channel: string;
    recipient: string;
    status: 'sent' | 'delivered' | 'failed' | 'skipped';
    providerMessageId?: string;
    error?: string;
  }> = [];

  // ── 1. Idempotency / Duplicate Check via eventKey ─────────────────────────
  if (eventKey && supabase) {
    try {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id, user_id, title, message, description, created_at')
        .eq('user_id', userId)
        .eq('event_key', eventKey)
        .maybeSingle();

      if (existing) {
        // Already recorded and dispatched, prevent spamming
        res.status(200).json({
          success: true,
          duplicate: true,
          message: 'Notification with this eventKey was already recorded and dispatched.',
          notification: existing,
          deliveries: [],
        });
        return;
      }
    } catch (checkErr) {
      console.warn('[dispatch] Idempotency check error:', checkErr);
    }
  }

  // ── 2. Determine User Contact Information ─────────────────────────────────
  // ── 3. Determine User Notification Preferences ────────────────────────────
  // Default preferences
  const categoryKey = type.toLowerCase();
  let prefInApp = true;
  let prefSms = false;
  let prefEmail = false;
  let criticalBypass = true;

  if (categoryKey.includes('health') || categoryKey.includes('medication')) {
    prefSms = true;
    prefEmail = true;
  } else if (categoryKey.includes('vaccin')) {
    prefSms = true;
    prefEmail = true;
  } else if (categoryKey.includes('inventory') || categoryKey.includes('expiry')) {
    prefEmail = true;
  } else if (categoryKey.includes('breeding')) {
    prefEmail = true;
  } else if (categoryKey.includes('sale')) {
    prefEmail = true;
  }

  if (supabase) {
    try {
      const { data: prefRow } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (prefRow) {
        criticalBypass = prefRow.critical_bypass ?? true;
        if (categoryKey.includes('health')) {
          prefInApp = prefRow.health_in_app ?? true;
          prefSms = prefRow.health_sms ?? true;
          prefEmail = prefRow.health_email ?? true;
        } else if (categoryKey.includes('medication')) {
          prefInApp = prefRow.medication_in_app ?? true;
          prefSms = prefRow.medication_sms ?? true;
          prefEmail = prefRow.medication_email ?? true;
        } else if (categoryKey.includes('vaccin')) {
          prefInApp = prefRow.vaccination_in_app ?? true;
          prefSms = prefRow.vaccination_sms ?? true;
          prefEmail = prefRow.vaccination_email ?? true;
        } else if (categoryKey.includes('inventory') || categoryKey.includes('expiry')) {
          prefInApp = prefRow.inventory_in_app ?? true;
          prefSms = prefRow.inventory_sms ?? false;
          prefEmail = prefRow.inventory_email ?? true;
        } else if (categoryKey.includes('breeding')) {
          prefInApp = prefRow.breeding_in_app ?? true;
          prefSms = prefRow.breeding_sms ?? false;
          prefEmail = prefRow.breeding_email ?? true;
        } else if (categoryKey.includes('sale')) {
          prefInApp = prefRow.sales_in_app ?? true;
          prefSms = prefRow.sales_sms ?? false;
          prefEmail = prefRow.sales_email ?? true;
        } else {
          prefInApp = prefRow.system_in_app ?? true;
          prefSms = prefRow.system_sms ?? false;
          prefEmail = prefRow.system_email ?? false;
        }
      }
    } catch (prefErr) {
      console.warn('[dispatch] Preferences lookup error:', prefErr);
    }
  }

  // Emergency override: Critical alerts bypass disabled channels unless explicit in request
  const isCritical = normalizedSeverity === 'critical';
  if (isCritical && criticalBypass) {
    prefSms = true;
    prefEmail = true;
  }

  // Apply explicit request channel overrides if supplied
  const shouldSendInApp = channels?.inApp !== undefined ? channels.inApp : prefInApp;
  const shouldSendSms = channels?.sms !== undefined ? channels.sms : prefSms;
  const shouldSendEmail = channels?.email !== undefined ? channels.email : prefEmail;

  // ── 4. Create In-App Notification Record ──────────────────────────────────
  let createdNotification: any = null;

  if (shouldSendInApp && supabase) {
    try {
      const payload: Record<string, any> = {
        user_id: userId,
        type,
        title,
        description: message,
        message,
        priority,
        severity: normalizedSeverity,
        link,
        animal_id: animalId,
        related_type: relatedType,
        related_id: relatedId,
        event_key: eventKey,
        read: false,
        is_read: false,
      };

      const { data: notifData, error: notifErr } = await supabase
        .from('notifications')
        .insert(payload)
        .select('*')
        .single();

      if (!notifErr && notifData) {
        createdNotification = notifData;
        deliveries.push({
          channel: 'in_app',
          recipient: userId,
          status: 'delivered',
        });

        // Record delivery
        await supabase.from('notification_deliveries').insert({
          user_id: userId,
          notification_id: notifData.id,
          channel: 'in_app',
          recipient: userId,
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        });
      } else {
        console.warn('[dispatch] In-app insert warning:', notifErr?.message);
      }
    } catch (inAppErr: any) {
      console.warn('[dispatch] In-app caught:', inAppErr?.message);
    }
  }

  const notificationId = createdNotification?.id || null;

  // ── 5. Dispatch SMS (if enabled and phone available) ──────────────────────
  if (shouldSendSms) {
    if (!phone) {
      deliveries.push({
        channel: 'sms',
        recipient: '',
        status: 'skipped',
        error: 'User has no phone number configured in profile.',
      });
    } else {
      const normalized = normalizePhoneNumber(phone);
      if (!normalized.valid) {
        const errMsg = `Invalid Philippine or international phone format: ${phone}`;
        deliveries.push({
          channel: 'sms',
          recipient: phone,
          status: 'failed',
          error: errMsg,
        });

        if (supabase) {
          await supabase.from('notification_deliveries').insert({
            user_id: userId,
            notification_id: notificationId,
            channel: 'sms',
            recipient: phone,
            status: 'failed',
            error_message: errMsg,
          });
        }
      } else {
        // Format farmer-friendly SMS message
        const smsContent = `ALPASFARM: ${title}. ${message}`;
        const smsResult = await dispatchSms(normalized.e164, smsContent);

        deliveries.push({
          channel: 'sms',
          recipient: normalized.e164,
          status: smsResult.success ? 'sent' : 'failed',
          providerMessageId: smsResult.messageId,
          error: smsResult.error,
        });

        if (supabase) {
          await supabase.from('notification_deliveries').insert({
            user_id: userId,
            notification_id: notificationId,
            channel: 'sms',
            recipient: normalized.e164,
            status: smsResult.success ? 'sent' : 'failed',
            provider_message_id: smsResult.messageId || null,
            error_message: smsResult.error || null,
            sent_at: smsResult.success ? new Date().toISOString() : null,
          });
        }
      }
    }
  }

  // ── 6. Dispatch Email (if enabled and email available) ────────────────────
  if (shouldSendEmail) {
    if (!email) {
      deliveries.push({
        channel: 'email',
        recipient: '',
        status: 'skipped',
        error: 'User has no email address configured in profile.',
      });
    } else {
      const emailSubject = `ALPASFARM - ${title}`;
      const fullActionUrl = link
        ? link.startsWith('http')
          ? link
          : `https://alpasfarm.ph${link}`
        : undefined;

      const template = buildEmailTemplate({
        title,
        message,
        relatedType: relatedType || undefined,
        actionUrl: fullActionUrl,
        severity: normalizedSeverity,
      });

      const emailResult = await dispatchEmail(
        email,
        emailSubject,
        template.html,
        template.text
      );

      deliveries.push({
        channel: 'email',
        recipient: email,
        status: emailResult.success ? 'sent' : 'failed',
        providerMessageId: emailResult.messageId,
        error: emailResult.error,
      });

      if (supabase) {
        await supabase.from('notification_deliveries').insert({
          user_id: userId,
          notification_id: notificationId,
          channel: 'email',
          recipient: email,
          status: emailResult.success ? 'sent' : 'failed',
          provider_message_id: emailResult.messageId || null,
          error_message: emailResult.error || null,
          sent_at: emailResult.success ? new Date().toISOString() : null,
        });
      }
    }
  }

  res.status(200).json({
    success: true,
    notification: createdNotification,
    deliveries,
  });
}
