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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    res.status(413).json({ success: false, error: 'Test notification request is too large.' });
    return;
  }

  const auth = await authenticateSupabaseRequest(req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ success: false, error: auth.error });
    return;
  }
  const rate = checkRateLimit(`notification-test:${auth.user.id}`, 5, 60 * 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({ success: false, error: 'Test notification limit reached. Please try again later.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { userId, channel, recipient } = body;
  if (userId !== auth.user.id) {
    res.status(403).json({ success: false, error: 'You may only test notification channels for your own account.' });
    return;
  }

  if (!channel || (channel !== 'sms' && channel !== 'email')) {
    res.status(400).json({ error: 'Channel must be "sms" or "email".' });
    return;
  }
  if (recipient !== undefined && typeof recipient !== 'string') {
    res.status(400).json({ success: false, error: 'Recipient must be a string.' });
    return;
  }
  if (typeof recipient === 'string' && recipient.length > 320) {
    res.status(400).json({ success: false, error: 'Recipient exceeds the supported length.' });
    return;
  }

  const supabase = auth.client;
  const verifiedEmail = auth.user.email_confirmed_at ? auth.user.email?.trim() || '' : '';
  const verifiedPhone = auth.user.phone_confirmed_at ? auth.user.phone?.trim() || '' : '';
  let targetRecipient = channel === 'email' ? verifiedEmail : verifiedPhone;
  if (recipient?.trim()) {
    if (channel === 'email' && recipient.trim().toLowerCase() !== verifiedEmail.toLowerCase()) {
      res.status(403).json({ success: false, error: 'Test messages may only be sent to the verified account email.' });
      return;
    }
    if (channel === 'sms') {
      const requestedPhone = normalizePhoneNumber(recipient);
      const accountPhone = normalizePhoneNumber(verifiedPhone);
      if (!accountPhone.valid || !requestedPhone.valid || requestedPhone.e164 !== accountPhone.e164) {
        res.status(403).json({ success: false, error: 'Test messages may only be sent to the verified account phone number.' });
        return;
      }
    }
  }

  if (!targetRecipient) {
    res.status(400).json({
      success: false,
      error:
        channel === 'sms'
          ? 'Walang nakitang numero ng telepono. Mangyaring maglagay ng valid na Philippine phone number (hal. 09171234567).'
          : 'Walang nakitang email address. Mangyaring maglagay ng valid na email address.',
    });
    return;
  }

  // ── Test SMS ──────────────────────────────────────────────────────────────
  if (channel === 'sms') {
    const norm = normalizePhoneNumber(targetRecipient);
    if (!norm.valid) {
      res.status(400).json({
        success: false,
        error: `Hindi valid ang numero ng telepono: "${targetRecipient}". Gamitin ang format na 09XXXXXXXXX o +639XXXXXXXXX.`,
      });
      return;
    }

    const testMessage =
      'ALPASFARM: Pagsubok sa SMS Notification. Matagumpay na nakakonekta ang SMS alert system ng iyong bukid!';

    const result = await dispatchSms(norm.e164, testMessage);

    if (supabase) {
      try {
        await supabase.from('notification_deliveries').insert({
          user_id: userId,
          channel: 'sms',
          recipient: norm.e164,
          status: result.success ? 'sent' : 'failed',
          provider_message_id: result.messageId || null,
          error_message: result.error || null,
          sent_at: result.success ? new Date().toISOString() : null,
        });
      } catch (logErr) {
        console.warn('[testNotification] Delivery log warning:', logErr);
      }
    }

    if (result.success) {
      res.status(200).json({
        success: true,
        channel: 'sms',
        recipient: norm.e164,
        provider: result.provider,
        messageId: result.messageId,
        message: `Matagumpay na naipadala ang test SMS sa ${norm.e164} gamit ang ${result.provider}!`,
      });
    } else {
      res.status(200).json({
        success: false,
        channel: 'sms',
        recipient: norm.e164,
        provider: result.provider,
        error: result.error,
        message: `Nabigo ang pagpapadala ng SMS: ${result.error}`,
      });
    }
    return;
  }

  // ── Test Email ────────────────────────────────────────────────────────────
  if (channel === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetRecipient)) {
      res.status(400).json({
        success: false,
        error: `Hindi valid ang format ng email: "${targetRecipient}".`,
      });
      return;
    }

    const testTitle = 'Pagsubok sa Email Notification (Test Alert)';
    const testBody =
      'Magandang araw mula sa ALPASFARM!\n\nIto ay pagsubok na mensahe upang kumpirmahin na aktibo at maayos na gumagana ang iyong email notification settings sa ALPASFARM.\n\nMakakatanggap ka rito ng mga paalala ukol sa kalusugan ng kambing at tupa, bakuna, pagbubuntis, at mababang imbentaryo.';

    const template = buildEmailTemplate({
      title: testTitle,
      message: testBody,
      severity: 'normal',
    });

    const result = await dispatchEmail(
      targetRecipient,
      `ALPASFARM - ${testTitle}`,
      template.html,
      template.text
    );

    if (supabase) {
      try {
        await supabase.from('notification_deliveries').insert({
          user_id: userId,
          channel: 'email',
          recipient: targetRecipient,
          status: result.success ? 'sent' : 'failed',
          provider_message_id: result.messageId || null,
          error_message: result.error || null,
          sent_at: result.success ? new Date().toISOString() : null,
        });
      } catch (logErr) {
        console.warn('[testNotification] Delivery log warning:', logErr);
      }
    }

    if (result.success) {
      res.status(200).json({
        success: true,
        channel: 'email',
        recipient: targetRecipient,
        provider: result.provider,
        messageId: result.messageId,
        message: `Matagumpay na naipadala ang test Email sa ${targetRecipient} gamit ang ${result.provider}!`,
      });
    } else {
      res.status(200).json({
        success: false,
        channel: 'email',
        recipient: targetRecipient,
        provider: result.provider,
        error: result.error,
        message: `Nabigo ang pagpapadala ng Email: ${result.error}`,
      });
    }
    return;
  }
}
