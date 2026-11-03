/**
 * Client-side SMS Helper for AlpasFarm
 * Formats Philippine and International phone numbers, and manages SMS OTP communication.
 */

export interface PhoneFormatResult {
  e164: string;
  national: string;
  display: string;
  valid: boolean;
}

/**
 * Formats raw phone input to Philippine standard (09XX XXX XXXX / +63 9XX XXX XXXX)
 */
export function formatPhoneNumber(input: string): PhoneFormatResult {
  const cleaned = input.replace(/[^0-9+]/g, '');

  // Philippine formats:
  // Starts with '09' (11 digits): 09171234567
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    const e164 = '+63' + cleaned.slice(1);
    const national = cleaned;
    const display = `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    return { e164, national, display, valid: true };
  }

  // Starts with '639' (12 digits): 639171234567
  if (cleaned.startsWith('639') && cleaned.length === 12) {
    const e164 = '+' + cleaned;
    const national = '0' + cleaned.slice(2);
    const display = `+63 ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    return { e164, national, display, valid: true };
  }

  // Starts with '+639' (13 digits): +639171234567
  if (cleaned.startsWith('+639') && cleaned.length === 13) {
    const e164 = cleaned;
    const national = '0' + cleaned.slice(3);
    const display = `+63 ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    return { e164, national, display, valid: true };
  }

  // Starts with '9' (10 digits): 9171234567
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    const e164 = '+63' + cleaned;
    const national = '0' + cleaned;
    const display = `09${cleaned.slice(1, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    return { e164, national, display, valid: true };
  }

  // International format starting with '+'
  if (cleaned.startsWith('+') && cleaned.length >= 10 && cleaned.length <= 16) {
    return { e164: cleaned, national: cleaned.slice(1), display: cleaned, valid: true };
  }

  // Partial or non-standard format
  return {
    e164: cleaned,
    national: cleaned,
    display: cleaned,
    valid: false,
  };
}

export interface SendSmsOtpOptions {
  phone: string;
  fullName?: string;
  farmName?: string;
  farmLocation?: string;
}

export interface SendSmsOtpResult {
  success: boolean;
  message: string;
  phone?: string;
  provider?: string;
  smsDelivered?: boolean;
  error?: string;
}

export interface VerifySmsOtpResult {
  success: boolean;
  phone?: string;
  user?: {
    phone: string;
    fullName: string;
    farmName: string;
    farmLocation: string;
    role: string;
  };
  message?: string;
  error?: string;
}

/**
 * Dispatch real SMS verification code via /api/auth/sms
 */
export async function sendSmsOtp(opts: SendSmsOtpOptions): Promise<SendSmsOtpResult> {
  const formatted = formatPhoneNumber(opts.phone);
  if (!formatted.valid) {
    return {
      success: false,
      message: 'Please enter a valid Philippine mobile number (e.g. 0917 123 4567).',
      error: 'Invalid phone format',
    };
  }

  try {
    const res = await fetch('/api/auth/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        phone: formatted.e164,
        fullName: opts.fullName,
        farmName: opts.farmName,
        farmLocation: opts.farmLocation,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        message: data.error || 'Failed to send SMS code. Please try again.',
        error: data.code || 'API_ERROR',
      };
    }

    return {
      success: true,
      message: data.message || `SMS verification code sent to ${formatted.display}`,
      phone: formatted.e164,
      provider: data.provider,
      smsDelivered: data.smsDelivered,
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Network error while requesting SMS code. Please check your connection.',
      error: err?.message || 'NETWORK_ERROR',
    };
  }
}

/**
 * Verify received SMS OTP code
 */
export async function verifySmsOtp(phone: string, code: string): Promise<VerifySmsOtpResult> {
  const formatted = formatPhoneNumber(phone);
  const trimmedCode = code.trim();

  if (!trimmedCode || trimmedCode.length < 6) {
    return {
      success: false,
      error: 'Please enter the 6-digit verification code.',
    };
  }

  try {
    const res = await fetch('/api/auth/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify',
        phone: formatted.e164,
        code: trimmedCode,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: data.error || 'Invalid verification code. Please check your SMS and try again.',
      };
    }

    return {
      success: true,
      phone: formatted.e164,
      user: data.user,
      message: data.message,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error during SMS code verification.',
    };
  }
}
