/**
 * Firebase Email Authentication and Verification Helper
 * All email verification codes, passwordless sign-ins, and confirmations
 * are dispatched directly through Google Firebase (capston-909ec).
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  applyActionCode,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  type UserCredential,
  type User as FirebaseUser,
} from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from './firebase';

const EMAIL_FOR_SIGN_IN_KEY = 'alpasfarm_email_for_signin';

/**
 * Get action code settings for Firebase Email Link / Code delivery
 */
export function getActionCodeSettings(email?: string): {
  url: string;
  handleCodeInApp: boolean;
} {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://capstone-delta-jet.vercel.app';
  const url = email ? `${origin}/?email=${encodeURIComponent(email)}` : `${origin}/`;
  return {
    url,
    handleCodeInApp: true,
  };
}

/**
 * Send Firebase Email Verification Link / Code to user's email
 */
export async function sendFirebaseEmailSignInCode(email: string): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      message: 'Firebase configuration is missing or incomplete.',
      error: 'FIREBASE_NOT_CONFIGURED',
    };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    return {
      success: false,
      message: 'Please enter a valid email address.',
      error: 'INVALID_EMAIL',
    };
  }

  try {
    const actionCodeSettings = getActionCodeSettings(trimmedEmail);
    await sendSignInLinkToEmail(firebaseAuth, trimmedEmail, actionCodeSettings);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, trimmedEmail);
    }

    return {
      success: true,
      message: `Verification code sent to ${trimmedEmail}.`,
    };
  } catch (err: any) {
    console.error('[Firebase Email Auth] Send error:', err);

    let userFriendlyMessage = 'Failed to send verification code to email.';
    const hostName = typeof window !== 'undefined' ? window.location.hostname : 'your domain';

    if (err.code === 'auth/operation-not-allowed') {
      userFriendlyMessage = 'Email link (passwordless) sign-in is not enabled in Firebase Console. Please open Firebase Console > Authentication > Sign-in method, click "Email/Password", and check "Email link (passwordless sign-in)".';
    } else if (err.code === 'auth/unauthorized-domain') {
      userFriendlyMessage = `Domain "${hostName}" is not authorized in Firebase. Please add "${hostName}" to Firebase Console > Authentication > Settings > Authorized domains.`;
    } else if (err.code === 'auth/invalid-email') {
      userFriendlyMessage = 'The email address format is invalid.';
    } else if (err.code === 'auth/too-many-requests') {
      userFriendlyMessage = 'Too many requests. Please wait a few moments before trying again.';
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

/**
 * Send email verification to an existing authenticated Firebase user
 */
export async function sendFirebaseUserVerification(user: FirebaseUser): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    const actionCodeSettings = getActionCodeSettings(user.email || undefined);
    await sendEmailVerification(user, actionCodeSettings);
    return {
      success: true,
      message: `Verification email sent to ${user.email}.`,
    };
  } catch (err: any) {
    console.error('[Firebase Email Auth] sendEmailVerification error:', err);
    return {
      success: false,
      message: err.message || 'Failed to send verification email.',
      error: err.code || 'FIREBASE_ERROR',
    };
  }
}

/**
 * Sign up a new user with Email + Password via Firebase and send verification
 */
export async function signUpWithFirebase(
  email: string,
  password: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  user?: FirebaseUser;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      error: 'Firebase is not configured.',
    };
  }

  try {
    const userCredential: UserCredential = await createUserWithEmailAndPassword(
      firebaseAuth,
      email.trim().toLowerCase(),
      password
    );

    // Automatically send Firebase email verification
    try {
      await sendFirebaseUserVerification(userCredential.user);
    } catch (e) {
      console.warn('[Firebase Email Auth] Could not send verification on signup:', e);
    }

    return {
      success: true,
      user: userCredential.user,
      message: `Verification email sent to ${email.trim().toLowerCase()}.`,
    };
  } catch (err: any) {
    console.error('[Firebase Email Auth] Sign up error:', err);
    let msg = 'Failed to create account with email.';
    if (err.code === 'auth/operation-not-allowed') {
      msg = 'Hindi pa naka-enable ang Email/Password sign-up sa Firebase Console. Mangyaring pumunta sa Firebase Console > Authentication > Sign-in method at i-enable ang "Email/Password".';
    } else if (err.code === 'auth/email-already-in-use') {
      msg = 'An account with this email already exists. Please sign in instead.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Please enter a valid email address.';
    } else if (err.code === 'auth/weak-password') {
      msg = 'Password is too weak. Please use at least 6 characters.';
    } else if (err.message) {
      msg = err.message;
    }

    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Sign in with Email + Password via Firebase
 */
export async function signInWithFirebase(
  email: string,
  password: string
): Promise<{
  success: boolean;
  error?: string;
  user?: FirebaseUser;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      error: 'Firebase is not configured.',
    };
  }

  try {
    const userCredential: UserCredential = await signInWithEmailAndPassword(
      firebaseAuth,
      email.trim().toLowerCase(),
      password
    );

    return {
      success: true,
      user: userCredential.user,
    };
  } catch (err: any) {
    console.error('[Firebase Email Auth] Sign in error:', err);
    let msg = 'Invalid email or password.';
    if (err.code === 'auth/operation-not-allowed') {
      msg = 'Hindi pa naka-enable ang Email/Password sign-in sa Firebase Console. Mangyaring pumunta sa Firebase Console > Authentication > Sign-in method at i-enable ang "Email/Password".';
    } else if (
      err.code === 'auth/user-not-found' ||
      err.code === 'auth/wrong-password' ||
      err.code === 'auth/invalid-credential'
    ) {
      msg = 'Invalid email or password.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Too many failed login attempts. Please try again later.';
    } else if (err.message) {
      msg = err.message;
    }

    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Verify Firebase Email Sign-in link or action code
 */
export async function verifyFirebaseEmailLinkOrCode(
  email: string,
  codeOrUrl: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  user?: FirebaseUser;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      error: 'Firebase is not configured.',
    };
  }

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedCode = codeOrUrl.trim();

  // If codeOrUrl looks like a URL or current page URL contains email link
  const urlToCheck = trimmedCode.startsWith('http')
    ? trimmedCode
    : typeof window !== 'undefined'
    ? window.location.href
    : '';

  if (urlToCheck && isSignInWithEmailLink(firebaseAuth, urlToCheck)) {
    try {
      const res = await signInWithEmailLink(firebaseAuth, trimmedEmail, urlToCheck);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
      }
      return {
        success: true,
        user: res.user,
        message: 'Email verified and signed in successfully.',
      };
    } catch (err: any) {
      console.error('[Firebase Email Auth] signInWithEmailLink error:', err);
      return {
        success: false,
        error: err.message || 'Invalid or expired email sign-in link.',
      };
    }
  }

  // If it is an action code (oobCode)
  try {
    await applyActionCode(firebaseAuth, trimmedCode);
    return {
      success: true,
      message: 'Email verified successfully.',
    };
  } catch (err: any) {
    console.error('[Firebase Email Auth] applyActionCode error:', err);
    return {
      success: false,
      error: 'Invalid or expired verification code.',
    };
  }
}

/**
 * Check if the current window URL has a Firebase email sign-in link
 */
export function checkFirebaseIncomingEmailLink(): {
  isEmailLink: boolean;
  savedEmail: string | null;
} {
  if (!isFirebaseConfigured() || !firebaseAuth || typeof window === 'undefined') {
    return { isEmailLink: false, savedEmail: null };
  }

  const isEmailLink = isSignInWithEmailLink(firebaseAuth, window.location.href);
  const savedEmail = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
  return { isEmailLink, savedEmail };
}

/**
 * Sign in with Google via Firebase Authentication
 */
export async function signInWithGoogleFirebase(): Promise<{
  success: boolean;
  user?: FirebaseUser;
  error?: string;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      error: 'Firebase is not configured.',
    };
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const userCredential = await signInWithPopup(firebaseAuth, provider);
    return {
      success: true,
      user: userCredential.user,
    };
  } catch (err: any) {
    console.error('[Firebase Google Auth] Sign in error:', err);
    if (err.code === 'auth/operation-not-allowed') {
      return {
        success: false,
        error: 'Hindi pa naka-enable ang Google Sign-In sa Firebase Console. Mangyaring pumunta sa Firebase Console > Authentication > Sign-in method at i-enable ang "Google".',
      };
    }
    if (err.code === 'auth/popup-closed-by-user') {
      return {
        success: false,
        error: 'Kinansela ang Google sign-in.',
      };
    }
    return {
      success: false,
      error: err?.message || 'Nabigo ang Google sign-in.',
    };
  }
}

/**
 * Send password reset email directly via Google Firebase
 */
export async function sendFirebasePasswordReset(email: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!isFirebaseConfigured() || !firebaseAuth) {
    return {
      success: false,
      error: 'Firebase is not configured.',
    };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    return {
      success: false,
      error: 'Pakilagay ang iyong email address.',
    };
  }

  try {
    const actionCodeSettings = getActionCodeSettings(trimmedEmail);
    await sendPasswordResetEmail(firebaseAuth, trimmedEmail, actionCodeSettings);
    return {
      success: true,
      message: 'Ipinadala na ang password reset link sa iyong email (' + trimmedEmail + ').',
    };
  } catch (err: any) {
    console.error('[Firebase Password Reset] Error:', err);
    return {
      success: false,
      error: err?.message || 'Hindi maipadala ang password reset email.',
    };
  }
}
