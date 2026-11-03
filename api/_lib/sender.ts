/**
 * AlpasFarm Server-Side Notification Dispatcher
 * Handles real SMS delivery (Twilio / Semaphore) and Email delivery (SMTP / Resend / SendGrid).
 * All credentials remain securely on the server.
 */

import * as https from 'https';

// ── Phone Number Normalization ──────────────────────────────────────────────
export interface PhoneNormalizationResult {
  e164: string;
  national: string;
  valid: boolean;
}

export function normalizePhoneNumber(rawPhone: string): PhoneNormalizationResult {
  const cleaned = rawPhone.replace(/[^0-9+]/g, '');

  // Philippine format: 09XXXXXXXXX (11 digits)
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    return { e164: '+63' + cleaned.slice(1), national: cleaned, valid: true };
  }
  // Philippine format: 639XXXXXXXXX (12 digits)
  if (cleaned.startsWith('639') && cleaned.length === 12) {
    return { e164: '+' + cleaned, national: '0' + cleaned.slice(2), valid: true };
  }
  // Philippine format: +639XXXXXXXXX (13 digits)
  if (cleaned.startsWith('+639') && cleaned.length === 13) {
    return { e164: cleaned, national: '0' + cleaned.slice(3), valid: true };
  }
  // Philippine format: 9XXXXXXXXX (10 digits)
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    return { e164: '+63' + cleaned, national: '0' + cleaned, valid: true };
  }

  // Generic international format
  if (cleaned.startsWith('+') && cleaned.length >= 10 && cleaned.length <= 16) {
    return { e164: cleaned, national: cleaned.slice(1), valid: true };
  }

  return { e164: cleaned, national: cleaned, valid: false };
}

// ── SMS Sender Result ───────────────────────────────────────────────────────
export interface DispatchResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

// ── Helper: POST Request ────────────────────────────────────────────────────
function postRequest(
  urlStr: string,
  headers: Record<string, string | number>,
  body: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('Gateway request timed out'));
    });
    req.write(body);
    req.end();
  });
}

// ── Twilio SMS Dispatcher (Pure REST API) ───────────────────────────────────
export async function sendTwilioSms(
  to: string,
  message: string,
  retryCount: number = 1
): Promise<DispatchResult> {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const fromNumber = (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER || '').trim();

  if (!accountSid || !authToken || !fromNumber) {
    return {
      success: false,
      provider: 'Twilio',
      error: 'Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER missing).',
    };
  }

  const authHeader = 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64');
  const postData = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: message,
  }).toString();

  let lastError = '';
  for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
    try {
      const res = await postRequest(
        'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json',
        {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        postData
      );

      let parsed: any = {};
      try {
        parsed = JSON.parse(res.data);
      } catch {
        parsed = { raw: res.data };
      }

      if (res.status >= 200 && res.status < 300 && parsed.sid) {
        return {
          success: true,
          provider: 'Twilio',
          messageId: parsed.sid,
        };
      }

      lastError = parsed.message || parsed.detail || `Twilio HTTP ${res.status}`;
      console.warn(`[Twilio SMS] Attempt ${attempt} failed:`, lastError);
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.warn(`[Twilio SMS] Attempt ${attempt} error:`, lastError);
    }

    if (attempt <= retryCount) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    success: false,
    provider: 'Twilio',
    error: lastError || 'Twilio send failed',
  };
}

// ── Semaphore SMS Dispatcher (Philippine Direct Gateway) ────────────────────
export async function sendSemaphoreSms(
  to: string,
  message: string
): Promise<DispatchResult> {
  const apiKey = (process.env.SEMAPHORE_API_KEY || '').trim();
  const senderName = (process.env.SEMAPHORE_SENDER_NAME || '').trim();

  if (!apiKey) {
    return {
      success: false,
      provider: 'Semaphore',
      error: 'Semaphore API key not configured.',
    };
  }

  const cleanNumber = to.replace(/[^0-9]/g, '');
  const phNumber = cleanNumber.startsWith('63') ? '0' + cleanNumber.slice(2) : cleanNumber;

  const payloadObj: Record<string, string> = {
    apikey: apiKey,
    number: phNumber,
    message,
  };
  if (senderName) payloadObj.sendername = senderName;

  const payload = JSON.stringify(payloadObj);

  try {
    const res = await postRequest(
      'https://api.semaphore.co/api/v4/messages',
      {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      payload
    );

    let parsed: any = null;
    try {
      parsed = JSON.parse(res.data);
    } catch {
      parsed = null;
    }

    if (res.status >= 200 && res.status < 300) {
      const first = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      return {
        success: true,
        provider: 'Semaphore',
        messageId: first?.message_id ? String(first.message_id) : 'SEMAPHORE_SENT',
      };
    }

    const errDetail = parsed?.message || parsed?.error || res.data;
    return {
      success: false,
      provider: 'Semaphore',
      error: `Semaphore error HTTP ${res.status}: ${errDetail}`,
    };
  } catch (err: any) {
    return {
      success: false,
      provider: 'Semaphore',
      error: err?.message || 'Semaphore network failure',
    };
  }
}

// ── Unified SMS Dispatcher ─────────────────────────────────────────────────
export async function dispatchSms(to: string, message: string): Promise<DispatchResult> {
  const norm = normalizePhoneNumber(to);
  if (!norm.valid) {
    return {
      success: false,
      provider: 'None',
      error: `Invalid Philippine or international phone number format: "${to}". Expected 09XXXXXXXXX or +639XXXXXXXXX.`,
    };
  }

  // 1. Try Twilio first if configured
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilioResult = await sendTwilioSms(norm.e164, message);
    if (twilioResult.success) return twilioResult;
    console.warn('[dispatchSms] Twilio failed, checking fallback...', twilioResult.error);
  }

  // 2. Try Semaphore fallback if configured
  if (process.env.SEMAPHORE_API_KEY) {
    const semResult = await sendSemaphoreSms(norm.e164, message);
    if (semResult.success) return semResult;
    console.warn('[dispatchSms] Semaphore failed:', semResult.error);
  }

  // 3. No active provider configured
  return {
    success: false,
    provider: 'None',
    error: 'No SMS provider configured. Set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER or SEMAPHORE_API_KEY in environment.',
  };
}

// ── Email HTML Template Builder ─────────────────────────────────────────────
export function buildEmailTemplate(opts: {
  title: string;
  message: string;
  relatedType?: string;
  actionUrl?: string;
  severity?: string;
}): { html: string; text: string } {
  const { title, message, actionUrl, severity = 'normal' } = opts;

  const severityColor =
    severity === 'critical'
      ? '#DC2626'
      : severity === 'warning'
      ? '#D97706'
      : '#238B45';

  const severityBadge =
    severity === 'critical'
      ? 'Kailangan ng Aksyon (Critical)'
      : severity === 'warning'
      ? 'Mahalagang Paalala'
      : 'Impormasyon';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #166534 0%, #238B45 100%); padding: 20px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">ALPASFARM</h1>
                    <p style="color: rgba(255,255,255,0.85); margin: 3px 0 0; font-size: 12px;">Goat & Sheep Farm Management System</p>
                  </td>
                  <td align="right">
                    <span style="background-color: rgba(255,255,255,0.2); color: #ffffff; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                      ${severityBadge}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 28px 24px;">
              <h2 style="margin: 0 0 12px; font-size: 17px; font-weight: 700; color: #0f172a; line-height: 1.4;">
                ${title}
              </h2>
              <div style="border-left: 4px solid ${severityColor}; background-color: #f8fafc; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 22px;">
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-line;">
                  ${message}
                </p>
              </div>

              ${
                actionUrl
                  ? `<div style="text-align: center; margin-top: 24px;">
                      <a href="${actionUrl}" style="background-color: #238B45; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 13.5px; display: inline-block;">
                        Buksan ang ALPASFARM
                      </a>
                    </div>`
                  : ''
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 18px 24px; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #64748b; text-align: center;">
              Ipinadala ito ng ALPASFARM Automatic Alert System.<br>
              Kung nais mong baguhin ang iyong mga notification settings, pumunta sa <strong>Mga Setting</strong> sa iyong ALPASFARM account.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
ALPASFARM - ${title}
[${severityBadge}]

${message}

${actionUrl ? `Buksan ang ALPASFARM para makita ang detalye: ${actionUrl}\n` : ''}
---
Ipinadala ito ng ALPASFARM Automatic Alert System.
  `.trim();

  return { html, text };
}

// ── Email Dispatcher ────────────────────────────────────────────────────────
export async function dispatchEmail(
  to: string,
  subject: string,
  htmlContent: string,
  textContent: string
): Promise<DispatchResult> {
  const mailFrom = (process.env.MAIL_FROM_ADDRESS || 'notifications@alpasfarm.ph').trim();
  const mailFromName = (process.env.MAIL_FROM_NAME || 'ALPASFARM').trim();

  // 1. Try Resend if configured
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendApiKey) {
    try {
      const payload = JSON.stringify({
        from: `${mailFromName} <${mailFrom}>`,
        to: [to],
        subject,
        html: htmlContent,
        text: textContent,
      });

      const res = await postRequest(
        'https://api.resend.com/emails',
        {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        payload
      );

      const parsed = JSON.parse(res.data);
      if (res.status >= 200 && res.status < 300 && parsed.id) {
        return {
          success: true,
          provider: 'Resend',
          messageId: parsed.id,
        };
      }
      return {
        success: false,
        provider: 'Resend',
        error: parsed.message || res.data,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: 'Resend',
        error: err?.message || 'Resend network error',
      };
    }
  }

  // 2. Try SendGrid if configured
  const sendgridApiKey = (process.env.SENDGRID_API_KEY || '').trim();
  if (sendgridApiKey) {
    try {
      const payload = JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: mailFrom, name: mailFromName },
        subject,
        content: [
          { type: 'text/plain', value: textContent },
          { type: 'text/html', value: htmlContent },
        ],
      });

      const res = await postRequest(
        'https://api.sendgrid.com/v3/mail/send',
        {
          Authorization: `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        payload
      );

      if (res.status >= 200 && res.status < 300) {
        return {
          success: true,
          provider: 'SendGrid',
          messageId: 'SENDGRID_SENT',
        };
      }
      return {
        success: false,
        provider: 'SendGrid',
        error: `SendGrid HTTP ${res.status}: ${res.data}`,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: 'SendGrid',
        error: err?.message || 'SendGrid network error',
      };
    }
  }

  return {
    success: false,
    provider: 'None',
    error: 'No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY in environment.',
  };
}
