/**
 * Firebase Phone Authentication Helper
 * Real SMS OTP dispatch using Google Firebase (10,000 Free SMS / month)
 */

import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from './firebase';

let confirmationResultCache: ConfirmationResult | null = null;
let recaptchaVerifierCache: RecaptchaVerifier | null = null;

/**
 * Initializes or resets the reCAPTCHA verifier widget
 */
export function getOrCreateRecaptchaVerifier(containerId: string = 'recaptcha-container'): RecaptchaVerifier | null {
  if (!firebaseAuth) return null;

  try {
    if (recaptchaVerifierCache) {
      return recaptchaVerifierCache;
    }

    let container = document.getElementById(containerId);
    if (!container && typeof document !== 'undefined') {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }

    recaptchaVerifierCache = new RecaptchaVerifier(firebaseAuth, containerId, {
      size: 'invisible',
      callback: () => {
        // reCAPTCHA solved automatically
      },
      'expired-callback': () => {
        if (recaptchaVerifierCache) {
          try {
            recaptchaVerifierCache.clear();
          } catch {}
          recaptchaVerifierCache = null;
        }
      },
    });

    return recaptchaVerifierCache;
  } catch (err) {
    console.error('[Firebase Auth] Failed to initialize RecaptchaVerifier:', err);
    return null;
  }
}

export function hasPendingFirebasePhoneOtp(): boolean {
  return confirmationResultCache !== null;
}

export function clearFirebasePhoneOtpCache(): void {
  confirmationResultCache = null;
  if (recaptchaVerifierCache) {
    try {
      recaptchaVerifierCache.clear();
    } catch {}
    recaptchaVerifierCache = null;
  }
}

export interface FirebasePhoneSendResult {
  success: boolean;
  message: string;
  error?: string;
  confirmationResult?: ConfirmationResult;
}

/**
 * Send real 6-digit SMS OTP via Firebase Phone Auth
 */
export async function sendFirebasePhoneOtp(
  phoneNumberE164: string,
  containerId: string = 'recaptcha-container'
): Promise<FirebasePhoneSendResult> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      message: 'Firebase configuration is missing or incomplete.',
      error: 'FIREBASE_NOT_CONFIGURED',
    };
  }

  try {
    // Reset any old verifier to avoid stale widget state
    if (recaptchaVerifierCache) {
      try {
        recaptchaVerifierCache.clear();
      } catch {}
      recaptchaVerifierCache = null;
    }

    const verifier = getOrCreateRecaptchaVerifier(containerId);
    if (!verifier) {
      return {
        success: false,
        message: 'Could not initialize security verification widget. Please refresh and try again.',
        error: 'RECAPTCHA_FAILED',
      };
    }

    const confirmationResult = await signInWithPhoneNumber(firebaseAuth, phoneNumberE164, verifier);
    confirmationResultCache = confirmationResult;

    return {
      success: true,
      message: 'SMS verification code sent to ' + phoneNumberE164 + '.',
      confirmationResult,
    };
  } catch (err: any) {
    console.error('[Firebase Phone Auth] Send error:', err);

    // Reset verifier on error so subsequent attempts can re-render cleanly
    if (recaptchaVerifierCache) {
      try {
        recaptchaVerifierCache.clear();
      } catch {}
      recaptchaVerifierCache = null;
    }

    let userFriendlyMessage = 'Failed to send SMS verification code.';
    const hostName = typeof window !== 'undefined' ? window.location.hostname : 'your domain';

    if (err.code === 'auth/unauthorized-domain') {
      userFriendlyMessage = 'Domain "' + hostName + '" is not authorized in Firebase. Please add "' + hostName + '" to Firebase Console > Authentication > Settings > Authorized domains.';
    } else if (err.code === 'auth/operation-not-allowed' || (err.message && err.message.toLowerCase().includes('region'))) {
      userFriendlyMessage = 'Hindi pa naka-enable ang Phone Sign-In o SMS Region Policy sa Firebase Console. Mangyaring pumunta sa Firebase Console > Authentication > Sign-in method at i-enable ang "Phone", at sa Settings > "SMS region policy" i-check ang Philippines (+63).';
    } else if (err.code === 'auth/invalid-app-credential') {
      userFriendlyMessage = 'reCAPTCHA verification failed. Please verify that "' + hostName + '" is added to Firebase Console > Authentication > Settings > Authorized domains.';
    } else if (err.code === 'auth/invalid-phone-number') {
      userFriendlyMessage = 'The phone number format is invalid. Please use Philippine mobile format: 09XXXXXXXXX or +639XXXXXXXXX.';
    } else if (err.code === 'auth/too-many-requests') {
      userFriendlyMessage = 'Too many requests from this device. Please wait a few minutes before trying again.';
    } else if (err.code === 'auth/quota-exceeded') {
      userFriendlyMessage = 'SMS quota limit reached. Please try again later or contact admin.';
    } else if (err.code === 'auth/captcha-check-failed') {
      userFriendlyMessage = 'Security verification check failed. Please refresh the page and try again.';
    } else if (err.message) {
      userFriendlyMessage = err.message;
    }

    return {
      success: false,
      message: userFriendlyMessage,
      error: err.code || 'FIREBASE_ERROR',
    };
  }
}

export interface FirebasePhoneVerifyResult {
  success: boolean;
  message: string;
  error?: string;
  user?: any;
}

/**
 * Confirm 6-digit OTP code sent via Firebase Phone Auth
 */
export async function verifyFirebasePhoneOtp(code: string): Promise<FirebasePhoneVerifyResult> {
  if (!confirmationResultCache) {
    return {
      success: false,
      message: 'No pending SMS verification. Please request a new verification code.',
      error: 'NO_CONFIRMATION_RESULT',
    };
  }

  try {
    const userCredential = await confirmationResultCache.confirm(code.trim());
    return {
      success: true,
      message: 'Phone number verified successfully.',
      user: userCredential.user,
    };
  } catch (err: any) {
    console.error('[Firebase Phone Auth] Confirm error:', err);

    let userFriendlyMessage = 'Incorrect verification code.';
    if (err.code === 'auth/invalid-verification-code') {
      userFriendlyMessage = 'The verification code entered is incorrect. Please check your SMS messages.';
    } else if (err.code === 'auth/code-expired') {
      userFriendlyMessage = 'This verification code has expired. Please click "Resend SMS".';
    }

    return {
      success: false,
      message: userFriendlyMessage,
      error: err.code || 'INVALID_CODE',
    };
  }
}
