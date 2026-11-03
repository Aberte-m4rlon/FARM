import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { formatPhoneNumber } from './sms';
import { isFirebaseConfigured, firebaseAuth } from './firebase';
import { isSupabaseAuthUserId } from './supabaseIdentity';
import {
  sendFirebasePhoneOtp,
  verifyFirebasePhoneOtp,
  clearFirebasePhoneOtpCache,
} from './firebasePhoneAuth';
import {
  sendFirebaseEmailSignInCode,
  signUpWithFirebase,
  signInWithFirebase,
  verifyFirebaseEmailLinkOrCode,
  checkFirebaseIncomingEmailLink,
  sendFirebasePasswordReset,
} from './firebaseEmailAuth';
import { onAuthStateChanged } from 'firebase/auth';
import { recordAuthenticationActivity } from './authActivity';

const GOOGLE_PROVIDER_SETUP_MESSAGE = 'Hindi pa naka-enable ang Google sign-in sa Supabase. Sa Authentication > Sign In / Providers, i-enable ang Google at idagdag ang OAuth Client ID at Secret. Sa Google Cloud, gamitin ang Supabase callback URL na https://hhhagfydxhetspmudyrl.supabase.co/auth/v1/callback. Naka-configure na ang app redirect na https://alpasfarm.site/dashboard.';

async function getGoogleProviderSetupError(): Promise<string | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hhhagfydxhetspmudyrl.supabase.co';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return 'Hindi naka-configure ang Supabase para sa Google sign-in. Gamitin muna ang email at password o kontakin ang administrator.';
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      cache: 'no-store',
    });
    if (!response.ok) {
      return 'Hindi masuri ang Google sign-in configuration ng Supabase. Subukan muli o gamitin muna ang email at password.';
    }
    const settings = await response.json() as { external?: { google?: unknown } };
    return settings.external?.google === true ? null : GOOGLE_PROVIDER_SETUP_MESSAGE;
  } catch {
    return 'Hindi makakonekta sa Supabase para masuri ang Google sign-in. Suriin ang internet at subukan muli, o gamitin muna ang email at password.';
  }
}

// ─── Role definitions ─────────────────────────────────────────────────────────
export type UserRole = 'super_admin' | 'system_admin' | 'farm_manager';

/** Human-readable label for a role */
export function getRoleLabel(role: UserRole | null): string {
  if (role === 'super_admin') return 'Super Administrator';
  if (role === 'system_admin') return 'System Administrator';
  return 'Farm Manager';
}

/** Default landing route after sign-in */
export function defaultRouteForRole(role: UserRole | null): string {
  if (role === 'super_admin') return '/super-admin';
  if (role === 'system_admin') return '/admin';
  return '/dashboard';
}

/** Whether a role can access a given route */
export function canAccessRoute(role: UserRole | null, route: string): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true; // super admin can access everything
  if (role === 'system_admin') return route !== '/super-admin';
  return route !== '/admin' && route !== '/super-admin';
}

/** Check if a role is an administrative role */
export function isAdminRole(role: UserRole | null): boolean {
  return role === 'super_admin' || role === 'system_admin';
}

/** Check if a role can manage users */
export function canManageUsers(role: UserRole | null): boolean {
  return role === 'super_admin';
}

/** Role hierarchy — higher number = more authority */
export const ROLE_RANK: Record<UserRole, number> = {
  farm_manager: 1,
  system_admin: 2,
  super_admin: 3,
};

/** All assignable roles with labels */
export const ALL_ROLES: { value: UserRole; label: string }[] = [
  { value: 'farm_manager', label: 'Farm Manager' },
  { value: 'system_admin', label: 'System Administrator' },
  { value: 'super_admin', label: 'Super Administrator' },
];

export interface UserProfile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone?: string | null;
  is_active: boolean;
}

export const ADMIN_EMAILS_FALLBACK: string[] = ['marlonaberte00@gmail.com'];
/** These emails get super_admin when no profiles row exists */
export const SUPER_ADMIN_EMAILS_FALLBACK: string[] = ['marlonaberte00@gmail.com'];

export interface SignUpOptions {
  email: string;
  password: string;
  fullName: string;
  farmName?: string;
  farmLocation?: string;
}

export interface PhoneSignUpOptions {
  phone: string;
  fullName: string;
  farmName: string;
  farmLocation: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  role: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithEmailOtp: (email: string) => Promise<{ error: string | null; message?: string }>;
  signUp: (opts: SignUpOptions) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  verifyEmailOtp: (email: string, token: string, extraData?: { fullName?: string; farmName?: string }) => Promise<{ error: string | null }>;
  resendVerificationCode: (email: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null; message?: string }>;
  // ── SMS / Phone Auth Methods ──
  signInWithPhoneOtp: (phone: string) => Promise<{ error: string | null; message?: string }>;
  signUpWithPhoneOtp: (opts: PhoneSignUpOptions) => Promise<{ error: string | null; message?: string }>;
  verifyPhoneOtp: (phone: string, token: string, extraData?: { fullName?: string; farmName?: string; farmLocation?: string }) => Promise<{ error: string | null }>;
  resendPhoneOtp: (phone: string) => Promise<{ error: string | null; message?: string }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Fetch the profile row. Falls back gracefully if the table doesn't exist.
   * Email-based fallback always wins for SUPER_ADMIN_EMAILS_FALLBACK so the
   * super-admin account works even before the DB migration is run.
   */
  const fetchProfile = async (userId: string, userEmail?: string | null): Promise<UserProfile> => {
    const emailLower = userEmail?.trim().toLowerCase() ?? '';
    const isSuperAdminEmail = !!emailLower && SUPER_ADMIN_EMAILS_FALLBACK.includes(emailLower);

    // Super-admin email always gets super_admin role regardless of DB state
    const fallbackRole: UserRole = isSuperAdminEmail ? 'super_admin' : 'farm_manager';

    // Firebase UIDs are opaque strings, not Supabase auth.users UUIDs.
    // Never send one to a UUID-backed profiles.id column.
    if (!isSupabaseAuthUserId(userId)) {
      return { id: userId, role: fallbackRole, full_name: null, is_active: true };
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name, is_active')
        .eq('id', userId)
        .maybeSingle();

      // Table doesn't exist or any DB error → use email fallback
      if (error) {
        return { id: userId, role: fallbackRole, full_name: null, is_active: true };
      }

      if (!data) {
        // No row yet → try to insert a default profile row
        try {
          const { data: inserted } = await supabase
            .from('profiles')
            .insert({ id: userId, role: fallbackRole, full_name: null, is_active: true })
            .select('id, role, full_name, is_active')
            .maybeSingle();
          if (inserted) return inserted as UserProfile;
        } catch {
          // Insert failed (table may not exist) — fall through to fallback
        }
        return { id: userId, role: fallbackRole, full_name: null, is_active: true };
      }

      // Row exists in DB — but if this is the super-admin email, always honour super_admin
      // in case the DB row still has an old role value before the migration ran
      const resolvedRole: UserRole = isSuperAdminEmail && data.role !== 'super_admin'
        ? 'super_admin'
        : (data.role as UserRole);

      return { ...(data as UserProfile), role: resolvedRole };
    } catch {
      return { id: userId, role: fallbackRole, full_name: null, is_active: true };
    }
  };

  // ── Bootstrap: restore session on mount ─────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    // Check local storage for phone session fallback
    const savedPhoneSession = localStorage.getItem('alpas_phone_user');
    if (savedPhoneSession) {
      try {
        const parsed = JSON.parse(savedPhoneSession);
        if (parsed?.id) {
          setSession({
            user: {
              id: parsed.id,
              phone: parsed.phone,
              email: `${parsed.phone.replace(/[^0-9]/g, '')}@alpasfarm.local`,
              app_metadata: {},
              user_metadata: { full_name: parsed.full_name },
              aud: 'authenticated',
              created_at: new Date().toISOString(),
            } as any,
            access_token: 'local-token',
            refresh_token: 'local-refresh',
            expires_in: 86400,
            token_type: 'bearer',
          });
          setProfile({
            id: parsed.id,
            role: parsed.role || 'farm_manager',
            full_name: parsed.full_name,
            phone: parsed.phone,
            is_active: true,
          });
          setLoading(false);
        }
      } catch {
        localStorage.removeItem('alpas_phone_user');
      }
    }

    // 2. Listen to Firebase Auth state changes
    let fbUnsubscribe: (() => void) | null = null;
    if (isFirebaseConfigured() && firebaseAuth) {
      fbUnsubscribe = onAuthStateChanged(firebaseAuth, async (fbUser) => {
        if (!mounted) return;
        if (fbUser) {
          const email = fbUser.email || (fbUser.phoneNumber ? `${fbUser.phoneNumber.replace(/[^0-9]/g, '')}@phone.alpasfarm.local` : null);

          // Email/password sign-in can authenticate the same person in both
          // Firebase and Supabase. Prefer the real Supabase UUID session when
          // it matches, so database queries and RLS use auth.users.id.
          const { data: authData } = await supabase.auth.getSession();
          const supabaseSession = authData.session;
          const supabaseEmail = supabaseSession?.user.email?.trim().toLowerCase();
          const firebaseEmail = fbUser.email?.trim().toLowerCase();
          const supabasePhone = supabaseSession?.user.phone?.replace(/\D/g, '');
          const firebasePhone = fbUser.phoneNumber?.replace(/\D/g, '');
          const sameAccount = Boolean(
            (supabaseEmail && firebaseEmail && supabaseEmail === firebaseEmail) ||
            (supabasePhone && firebasePhone && supabasePhone === firebasePhone),
          );

          if (supabaseSession && isSupabaseAuthUserId(supabaseSession.user.id) && sameAccount) {
            const p = await fetchProfile(supabaseSession.user.id, supabaseSession.user.email);
            if (mounted) {
              setProfile(p);
              setSession(supabaseSession);
              setLoading(false);
            }
            return;
          }

          const p = await fetchProfile(fbUser.uid, email);
          if (mounted) {
            setProfile(p);
            setSession({
              user: {
                id: fbUser.uid,
                email: email || undefined,
                phone: fbUser.phoneNumber || undefined,
                app_metadata: {},
                user_metadata: { full_name: fbUser.displayName || p.full_name || 'Farm Manager' },
                aud: 'authenticated',
                created_at: fbUser.metadata.creationTime || new Date().toISOString(),
              } as any,
              access_token: await fbUser.getIdToken().catch(() => `fb_${fbUser.uid}`),
              refresh_token: fbUser.refreshToken || `refresh_${fbUser.uid}`,
              expires_in: 3600,
              token_type: 'bearer',
            });
            setLoading(false);
          }
        }
      });

      // 3. Check if user opened the page from a Firebase email sign-in link
      const { isEmailLink, savedEmail } = checkFirebaseIncomingEmailLink();
      if (isEmailLink) {
        let emailToUse = savedEmail;
        if (!emailToUse && typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search);
          emailToUse = urlParams.get('email');
        }
        if (emailToUse) {
          verifyFirebaseEmailLinkOrCode(emailToUse, window.location.href)
            .then(async (res) => {
              if (res.success && res.user && mounted) {
                const p = await fetchProfile(res.user.uid, res.user.email);
                setProfile(p);
              }
            })
            .catch(() => {});
        }
      }
    }

    // 4. Supabase session listener (for legacy accounts)
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        const sess = data.session;
        if (sess) {
          setSession(sess);
          if (sess?.user) {
            const p = await fetchProfile(sess.user.id, sess.user.email);
            if (mounted) setProfile(p);
          }
        }
        if (mounted) setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && newSession?.access_token) {
        void recordAuthenticationActivity(newSession.access_token, 'login');
      }
      if (newSession) {
        setSession(newSession);
        if (newSession?.user) {
          const p = await fetchProfile(newSession.user.id, newSession.user.email);
          if (mounted) setProfile(p);
        }
      } else {
        const hasPhoneSession = localStorage.getItem('alpas_phone_user');
        const hasFbUser = firebaseAuth?.currentUser;
        if (!hasPhoneSession && !hasFbUser) {
          setProfile(null);
          setSession(null);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (fbUnsubscribe) fbUnsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sign up with Email (Firebase + DB sync) ─────────────────────────────────
  const signUp = async (opts: SignUpOptions): Promise<{ error: string | null; needsConfirmation: boolean }> => {
    const email = opts.email.trim().toLowerCase();
    const password = opts.password.trim();
    const fullName = opts.fullName.trim();
    const farmName = opts.farmName?.trim() || (fullName ? `${fullName}'s Farm` : 'My Farm');
    const farmLocation = opts.farmLocation?.trim() || '';

    if (!email || !password || !fullName) {
      return { error: 'Pakilagay ang lahat ng kinakailangang impormasyon.', needsConfirmation: false };
    }

    if (password.length < 8) {
      return { error: 'Ang password ay dapat may sapat na haba (hindi bababa sa 8 karakter).', needsConfirmation: false };
    }

    // 1. Create account & send verification via Firebase
    const fbSignUp = await signUpWithFirebase(email, password);

    // 2. Create in DB / Supabase for backend schema consistency
    let dbUserId: string | null = fbSignUp.user?.uid || null;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error && !fbSignUp.success) {
      const msg = error.message?.toLowerCase() ?? '';
      if (msg.includes('already registered') || msg.includes('user already exists') || msg.includes('already been registered')) {
        return { error: 'May gumagamit na ng email na ito. Mangyaring mag-sign in.', needsConfirmation: false };
      }
      if (msg.includes('password') || msg.includes('weak')) {
        return { error: 'Ang password ay dapat may sapat na haba (hindi bababa sa 8 karakter).', needsConfirmation: false };
      }
      if (msg.includes('invalid') && msg.includes('email')) {
        return { error: 'Pakilagay ang wastong email address.', needsConfirmation: false };
      }
      return { error: 'Hindi makagawa ng account sa ngayon. Pakisubukang muli mamaya.', needsConfirmation: false };
    }

    if (data?.user?.id) {
      dbUserId = data.user.id;
    }

    if (dbUserId) {
      try {
        await supabase.from('profiles').upsert({
          id: dbUserId,
          role: 'farm_manager' as UserRole,
          full_name: fullName,
          is_active: true,
          email,
        }, { onConflict: 'id' });
      } catch {
        // Non-fatal
      }

      if (farmName) {
        try {
          await supabase.from('settings').upsert({
            user_id: dbUserId,
            farm_name: farmName,
            target_weight_kg: 40,
            gestation_days: 150,
            expiry_warning_days: 15,
            vaccine_due_days: 30,
            breeding_min_age_months: 8,
            breeding_min_weight_kg: 25,
          }, { onConflict: 'user_id' });
        } catch {
          // Non-fatal
        }
      }
    }

    // Needs email confirmation if Firebase or Supabase requires verification
    return { error: null, needsConfirmation: true };
  };

  // ── Sign in with Email + Password (Firebase + Supabase fallback) ────────────
  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      return { error: '❌ Hindi tama ang email o password.' };
    }

    try {
      // 1. Try Firebase Authentication first
      const fbRes = await signInWithFirebase(trimmedEmail, trimmedPassword);
      if (fbRes.success && fbRes.user) {
        // Also sign in to Supabase so that Supabase RLS policies receive the authenticated user's JWT
        await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        }).catch(() => {});

        const p = await fetchProfile(fbRes.user.uid, fbRes.user.email);
        if (!p.is_active) {
          await signOut();
          return { error: '❌ Hindi aktibo ang iyong account. Makipag-ugnayan sa administrator.' };
        }
        setProfile(p);
        return { error: null };
      }

      // 2. Fallback to Supabase for pre-existing accounts
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (error) {
        const msg = error.message?.toLowerCase() ?? '';
        if (
          msg.includes('invalid') ||
          msg.includes('credentials') ||
          msg.includes('password') ||
          msg.includes('not found') ||
          msg.includes('email')
        ) {
          return { error: '❌ Hindi tama ang email o password.' };
        }
        if (msg.includes('not confirmed') || msg.includes('email_not_confirmed')) {
          return { error: 'Pakikumpirma muna ang iyong email address bago mag-sign in.' };
        }
        return { error: fbRes.error || '❌ Hindi tama ang email o password.' };
      }

      if (!data.user) {
        return { error: '❌ Hindi tama ang email o password.' };
      }

      const p = await fetchProfile(data.user.id, data.user.email);

      if (!p.is_active) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        return {
          error: '❌ Hindi aktibo ang iyong account. Makipag-ugnayan sa administrator.',
        };
      }

      setProfile(p);
      return { error: null };
    } catch {
      return { error: 'Hindi makakonekta sa authentication server. Pakisubukang muli mamaya.' };
    }
  };

  // ── Sign in with Email OTP (Firebase Link/Code) ─────────────────────────────
  const signInWithEmailOtp = async (email: string): Promise<{ error: string | null; message?: string }> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return { error: 'Pakilagay ang iyong email address.' };

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(trimmedEmail)) return { error: 'Pakilagay ang wastong email address.' };

    try {
      const fbRes = await sendFirebaseEmailSignInCode(trimmedEmail);
      if (!fbRes.success) {
        return { error: fbRes.message || 'Hindi maipadala ang verification mula sa Firebase.' };
      }

      return {
        error: null,
        message: fbRes.message || `Ipinadala na ang verification link/code sa iyong email (${trimmedEmail}). Pakitingnan ang iyong inbox o i-click ang link.`,
      };
    } catch (err: any) {
      return { error: err?.message || 'Hindi maipadala ang verification code sa email.' };
    }
  };

  // ── Verify Email OTP / Code (Firebase) ──────────────────────────────────────
  const verifyEmailOtp = async (
    email: string,
    token: string,
    extraData?: { fullName?: string; farmName?: string; farmLocation?: string },
  ): Promise<{ error: string | null }> => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedToken = token.trim();

    if (!trimmedEmail) return { error: 'Email address is required.' };
    if (!trimmedToken) return { error: 'Please enter the verification code or click the email link.' };

    try {
      // Primary: Google Firebase verification
      const fbVerify = await verifyFirebaseEmailLinkOrCode(trimmedEmail, trimmedToken);
      if (fbVerify.success && fbVerify.user) {
        const uid = fbVerify.user.uid;
        const p = await fetchProfile(uid, trimmedEmail);

        if (extraData?.fullName && (!p.full_name || p.full_name === '')) {
          try {
            await supabase.from('profiles').upsert({
              id: uid,
              role: p.role || 'farm_manager',
              full_name: extraData.fullName,
              is_active: true,
              email: trimmedEmail,
            }, { onConflict: 'id' });
            p.full_name = extraData.fullName;
          } catch { /* ignore */ }
        }

        if (extraData?.farmName) {
          try {
            await supabase.from('settings').upsert({
              user_id: uid,
              farm_name: extraData.farmName,
              target_weight_kg: 40,
              gestation_days: 150,
              expiry_warning_days: 15,
              vaccine_due_days: 30,
              breeding_min_age_months: 8,
              breeding_min_weight_kg: 25,
            }, { onConflict: 'user_id' });
          } catch { /* ignore */ }
        }

        setProfile(p);
        return { error: null };
      }

      // Fallback for legacy 6-digit numeric OTP code if sent prior
      const { data: supaData, error: supaErr } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: trimmedToken,
        type: 'email',
      });
      if (!supaErr && supaData?.user) {
        const p = await fetchProfile(supaData.user.id, supaData.user.email);
        setProfile(p);
        return { error: null };
      }

      return { error: fbVerify.error || 'Hindi ma-verify ang verification code. Pakisuri ang iyong email o mag-resend.' };
    } catch (err: any) {
      return { error: err?.message || 'Network error habang nagve-verify. Pakisubukang muli.' };
    }
  };

  // ── Resend Email Verification Code ──────────────────────────────────────────
  const resendVerificationCode = async (email: string): Promise<{ error: string | null; message?: string }> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return { error: 'Pakilagay ang iyong email address.' };

    try {
      const fbRes = await sendFirebaseEmailSignInCode(trimmedEmail);
      if (!fbRes.success) {
        return { error: fbRes.message || 'Hindi maipadala muli ang code. Pakisubukang muli mamaya.' };
      }
      return { error: null, message: `Muling ipinadala ang verification code/link sa ${trimmedEmail}.` };
    } catch (err: any) {
      return { error: err?.message || 'Network error habang muling nagpapadala ng verification code.' };
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ── FIREBASE PHONE AUTHENTICATION (REAL SMS OTP) ────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  // ── Send SMS OTP for Sign In (Firebase Phone Auth) ──────────────────────────
  const signInWithPhoneOtp = async (
    phone: string,
  ): Promise<{ error: string | null; message?: string }> => {
    const formatted = formatPhoneNumber(phone);
    if (!formatted.valid) {
      return { error: 'Pakilagay ang wastong Philippine mobile number (hal. 0917 123 4567).' };
    }

    try {
      const fbRes = await sendFirebasePhoneOtp(formatted.e164);
      if (!fbRes.success) {
        return { error: fbRes.message || 'Hindi maipadala ang SMS verification code mula sa Firebase.' };
      }

      return {
        error: null,
        message: fbRes.message,
      };
    } catch (err: any) {
      return { error: err?.message || 'Hindi maipadala ang SMS verification code.' };
    }
  };

  // ── Send SMS OTP for Sign Up (Firebase Phone Auth) ──────────────────────────
  const signUpWithPhoneOtp = async (
    opts: PhoneSignUpOptions,
  ): Promise<{ error: string | null; message?: string }> => {
    const formatted = formatPhoneNumber(opts.phone);
    const fullName = opts.fullName.trim();
    const farmName = opts.farmName.trim();

    if (!formatted.valid) {
      return { error: 'Pakilagay ang wastong Philippine mobile number (hal. 0917 123 4567).' };
    }
    if (!fullName) {
      return { error: 'Pakilagay ang iyong buong pangalan.' };
    }
    if (!farmName) {
      return { error: 'Pakilagay ang pangalan ng iyong farm.' };
    }

    try {
      const fbRes = await sendFirebasePhoneOtp(formatted.e164);
      if (!fbRes.success) {
        return { error: fbRes.message || 'Hindi maipadala ang SMS verification code mula sa Firebase.' };
      }

      return {
        error: null,
        message: fbRes.message,
      };
    } catch (err: any) {
      return { error: err?.message || 'Error sa pag-dispatch ng SMS verification code mula sa Firebase.' };
    }
  };

  // ── Verify SMS OTP (Firebase Phone Auth) ────────────────────────────────────
  const verifyPhoneOtp = async (
    phone: string,
    token: string,
    extraData?: { fullName?: string; farmName?: string; farmLocation?: string },
  ): Promise<{ error: string | null }> => {
    const formatted = formatPhoneNumber(phone);
    const trimmedToken = token.trim();

    if (!formatted.valid) return { error: 'Maling mobile number format.' };
    if (!trimmedToken) return { error: 'Pakilagay ang 6-digit SMS verification code.' };

    try {
      const fbRes = await verifyFirebasePhoneOtp(trimmedToken);
      if (!fbRes.success || !fbRes.user) {
        return { error: fbRes.message || 'Maling verification code o nag-expire na ito.' };
      }

      const fbUser = fbRes.user;
      const cleanDigits = (fbUser.phoneNumber || formatted.e164).replace(/[^0-9]/g, '');
      const userId = fbUser.uid;
      const fullName = extraData?.fullName || fbUser.displayName || 'Farm Manager';
      const farmName = extraData?.farmName || 'My Farm';

      const userProfile: UserProfile = {
        id: userId,
        role: 'farm_manager',
        full_name: fullName,
        phone: fbUser.phoneNumber || formatted.e164,
        is_active: true,
      };

      // Persist profile to Supabase database
      try {
        await supabase.from('profiles').upsert({
          id: userId,
          role: 'farm_manager' as UserRole,
          full_name: fullName,
          is_active: true,
          email: `${cleanDigits}@phone.alpasfarm.local`,
        }, { onConflict: 'id' });
      } catch {
        // non-fatal
      }

      // Initialize farm settings
      if (farmName) {
        try {
          await supabase.from('settings').upsert({
            user_id: userId,
            farm_name: farmName,
            target_weight_kg: 40,
            gestation_days: 150,
            expiry_warning_days: 15,
            vaccine_due_days: 30,
            breeding_min_age_months: 8,
            breeding_min_weight_kg: 25,
          }, { onConflict: 'user_id' });
        } catch {
          // non-fatal
        }
      }

      const syntheticSession: any = {
        user: {
          id: userId,
          phone: fbUser.phoneNumber || formatted.e164,
          email: `${cleanDigits}@phone.alpasfarm.local`,
          app_metadata: {},
          user_metadata: { full_name: fullName },
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
        access_token: await fbUser.getIdToken().catch(() => `fb_${userId}`),
        refresh_token: fbUser.refreshToken || `refresh_${cleanDigits}`,
        expires_in: 604800,
        token_type: 'bearer',
      };

      localStorage.setItem('alpas_phone_user', JSON.stringify({
        id: userId,
        phone: fbUser.phoneNumber || formatted.e164,
        full_name: fullName,
        role: 'farm_manager',
      }));

      setSession(syntheticSession);
      setProfile(userProfile);

      return { error: null };
    } catch (err: any) {
      return { error: err?.message || 'Error sa pag-verify ng Firebase SMS code.' };
    }
  };

  // ── Resend Phone OTP (Firebase Phone Auth) ──────────────────────────────────
  const resendPhoneOtp = async (phone: string): Promise<{ error: string | null; message?: string }> => {
    const formatted = formatPhoneNumber(phone);
    if (!formatted.valid) return { error: 'Maling mobile number format.' };

    try {
      const fbRes = await sendFirebasePhoneOtp(formatted.e164);
      if (!fbRes.success) {
        return { error: fbRes.message || 'Hindi maipadala muli ang SMS mula sa Firebase.' };
      }
      return { error: null, message: fbRes.message };
    } catch (err: any) {
      return { error: err?.message || 'Network error habang muling nagpapadala ng SMS.' };
    }
  };

  // ── Reset Password (Firebase Auth) ──────────────────────────────────────────
  const resetPassword = async (email: string): Promise<{ error: string | null; message?: string }> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      return { error: 'Pakilagay ang iyong email address.' };
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(trimmedEmail)) {
      return { error: 'Pakilagay ang wastong email address.' };
    }

    try {
      const fbRes = await sendFirebasePasswordReset(trimmedEmail);
      if (fbRes.success) {
        return { error: null, message: fbRes.message };
      }
      // Try fallback to Supabase
      await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/login`,
      });
      return {
        error: null,
        message: 'Ipinadala na ang link sa pag-reset ng password sa iyong email kung ito ay nakarehistro.',
      };
    } catch {
      return {
        error: null,
        message: 'Ipinadala na ang link sa pag-reset ng password sa iyong email kung ito ay nakarehistro.',
      };
    }
  };

  // ── Sign In With Google through Supabase so farm records use an Auth UUID ──
  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    try {
      const setupError = await getGoogleProviderSetupError();
      if (setupError) return { error: setupError };

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      return { error: error?.message ?? null };
    } catch (err: any) {
      return { error: err?.message || 'Nabigo ang Google sign-in.' };
    }
  };

  // ── Sign out ─────────────────────────────────────────────────────────────────
  const signOut = async () => {
    const token = session?.access_token;
    if (token) await recordAuthenticationActivity(token, 'logout');
    localStorage.removeItem('alpas_phone_user');
    setProfile(null);
    setSession(null);
    clearFirebasePhoneOtpCache();
    if (firebaseAuth) {
      try {
        await firebaseAuth.signOut();
      } catch {}
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // Local state already cleared
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: profile?.role ?? null,
        loading,
        signIn,
        signInWithEmailOtp,
        signUp,
        verifyEmailOtp,
        resendVerificationCode,
        resetPassword,
        signInWithPhoneOtp,
        signUpWithPhoneOtp,
        verifyPhoneOtp,
        resendPhoneOtp,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
