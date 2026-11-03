import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, defaultRouteForRole, SUPER_ADMIN_EMAILS_FALLBACK } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { AlpasFarmLogo } from '../components/common/AlpasFarmLogo';
import { HelpSupportModal } from '../components/auth/HelpSupportModal';
import { PrivacyTermsModal } from '../components/auth/PrivacyTermsModal';
import {
  Eye, EyeOff, User, Lock, ArrowRight, AlertCircle,
  Mail, CheckCircle2, UserPlus, LogIn, ArrowLeft
} from 'lucide-react';

// ─── Password Strength Evaluator ──────────────────────────────────────────────
function passwordStrength(pw: string): { score: number; label: string; color: string; checks: Record<string, boolean> } {
  const checks = {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const label = score <= 1 ? 'Mahina' : score <= 3 ? 'Katamtaman' : score <= 4 ? 'Maayos' : 'Malakas';
  const color = score <= 1 ? '#EF4444' : score <= 3 ? '#F59E0B' : score <= 4 ? '#238B45' : '#176B35';
  return { score, label, color, checks };
}

// ─── Shared Input Style ───────────────────────────────────────────────────────
function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '13px 14px 13px 44px',
    background: 'var(--input-bg, #FFFFFF)',
    border: `1px solid ${hasError ? '#EF4444' : 'var(--input-border, rgba(35, 139, 69, 0.20))'}`,
    borderRadius: '15px',
    color: 'var(--input-text, #174B2A)',
    fontSize: '14px',
    fontWeight: 500,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s, background-color 0.2s',
  };
}

// ─── Field Helper Component ───────────────────────────────────────────────────
function Field({
  label,
  icon: Icon,
  children,
  badge,
  hint,
}: {
  label: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
  badge?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary, #174B2A)',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
        }}>
          {label}
        </label>
        {badge}
      </div>
      <div style={{ position: 'relative' }}>
        <Icon
          size={17}
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary, #607067)',
            pointerEvents: 'none',
          }}
        />
        {children}
      </div>
      {hint && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-secondary, #607067)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

type View = 'signin' | 'signup' | 'forgot';

export function AuthPage() {
  const {
    signIn,
    signUp,
    resetPassword,
    signInWithGoogle,
    role,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  // Determine initial view from URL
  const initialView: View = location.pathname === '/register'
    ? 'signup'
    : location.pathname === '/forgot-password'
      ? 'forgot'
      : 'signin';

  const [view, setView] = useState<View>(initialView);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-in Email state
  const [siEmail, setSiEmail] = useState('');
  const [siPassword, setSiPassword] = useState('');
  const [siShowPw, setSiShowPw] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Sign-up state
  const [suFullName, setSuFullName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirmPw, setSuConfirmPw] = useState('');
  const [suShowPw, setSuShowPw] = useState(false);
  const [suShowConfirmPw, setSuShowConfirmPw] = useState(false);
  const [suTerms, setSuTerms] = useState(false);

  const pwStr = passwordStrength(suPassword);

  // Synchronize view if route changes
  useEffect(() => {
    if (location.pathname === '/register' && view !== 'signup') {
      setView('signup');
    } else if (location.pathname === '/forgot-password' && view !== 'forgot') {
      setView('forgot');
    } else if (location.pathname === '/login' && view !== 'signin') {
      setView('signin');
    }
  }, [location.pathname]);

  const switchView = (v: View) => {
    setView(v);
    setError(null);
    if (v === 'signup') {
      window.history.replaceState(null, '', '/register');
    } else if (v === 'forgot') {
      window.history.replaceState(null, '', '/forgot-password');
    } else if (v === 'signin') {
      window.history.replaceState(null, '', '/login');
    }
  };

  // ── Help & Support / Privacy & Terms Modals ─────────────────────────────────
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms'>('privacy');

  const configuredAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim()
    || (SUPER_ADMIN_EMAILS_FALLBACK && SUPER_ADMIN_EMAILS_FALLBACK.length > 0 ? SUPER_ADMIN_EMAILS_FALLBACK[0] : '');
  const configuredAdminPhone = (import.meta.env.VITE_ADMIN_PHONE as string | undefined)?.trim() || '';

  const openLegalModal = (tab: 'privacy' | 'terms') => {
    setLegalTab(tab);
    setShowLegalModal(true);
  };

  const authModals = (
    <>
      <HelpSupportModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onSelectForgotPassword={() => {
          setError(null);
          switchView('forgot');
        }}
        adminEmail={configuredAdminEmail}
        adminPhone={configuredAdminPhone}
      />
      <PrivacyTermsModal
        open={showLegalModal}
        onClose={() => setShowLegalModal(false)}
        initialTab={legalTab}
        adminEmail={configuredAdminEmail}
      />
    </>
  );

  // ── Email Sign In ───────────────────────────────────────────────────────────
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const email = siEmail.trim();
    if (!email) {
      setError('Pakilagay ang iyong email address.');
      return;
    }
    if (!siPassword) {
      setError('Pakilagay ang iyong password.');
      return;
    }

    setError(null);
    setLoading(true);
    const { error: err } = await signIn(email, siPassword);
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    toast.success('Magandang araw! Naka-sign in ka na.');
    navigate(defaultRouteForRole(role), { replace: true });
  };

  // ── Google Sign In (Supabase redirects to Google and returns a DB session) ─
  const handleGoogleSignIn = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithGoogle();
    if (err) {
      setLoading(false);
      setError(err);
    }
  };

  // ── Forgot Password Request ─────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const email = forgotEmail.trim();
    if (!email) {
      setError('Pakilagay ang iyong email address.');
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      setError('Pakilagay ang wastong email address.');
      return;
    }

    setError(null);
    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    setForgotSuccess(true);
    toast.success('Ipinadala na ang link sa pag-reset ng password sa iyong email.');
  };

  // ── Email Sign Up ───────────────────────────────────────────────────────────
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const name = suFullName.trim();
    const email = suEmail.trim();

    if (!name) { setError('Pakilagay ang iyong buong pangalan.'); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) { setError('Pakilagay ang wastong email address.'); return; }
    if (suPassword.length < 8) { setError('Ang password ay dapat may hindi bababa sa 8 karakter.'); return; }
    if (suPassword !== suConfirmPw) { setError('Hindi magkatugma ang kumpirmasyon ng password.'); return; }
    if (!suTerms) { setError('Dapat sumang-ayon sa Mga Tuntunin at Patakaran sa Privacy upang gumawa ng account.'); return; }

    setLoading(true);
    const { error: err } = await signUp({
      email,
      password: suPassword,
      fullName: name,
    });
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    // Attempt automatic immediate sign-in with newly created credentials
    setLoading(true);
    const signInRes = await signIn(email, suPassword);
    setLoading(false);

    if (!signInRes.error) {
      toast.success('Maligayang pagdating sa ALPASFARM! Matagumpay na nagawa ang iyong account.');
      navigate(defaultRouteForRole(role || 'farm_manager'), { replace: true });
    } else {
      toast.success('Matagumpay na nagawa ang iyong account! Mangyaring mag-sign in gamit ang iyong email at password.');
      setSiEmail(email);
      setSiPassword('');
      switchView('signin');
    }
  };

  // ── Ambient Background Glows ────────────────────────────────────────────────
  const bg = (
    <>
      <div
        style={{
          position: 'fixed',
          width: '560px',
          height: '560px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(35, 139, 69, 0.08) 0%, transparent 70%)',
          top: '-120px',
          right: '-100px',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          width: '480px',
          height: '480px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(23, 107, 53, 0.06) 0%, transparent 70%)',
          bottom: '-100px',
          left: '-80px',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  );

  // ── Crisp Modern Glass Card Style ───────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--surface, rgba(255, 255, 255, 0.95))',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--border, rgba(35, 139, 69, 0.16))',
    borderRadius: '24px',
    boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(23, 107, 53, 0.10))',
    width: '100%',
    maxWidth: view === 'signup' ? '490px' : '450px',
    padding: 'clamp(24px, 5vw, 36px)',
    position: 'relative',
    zIndex: 1,
    boxSizing: 'border-box',
    transition: 'max-width 0.3s ease',
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ── VIEW: FORGOT PASSWORD ───────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  if (view === 'forgot') {
    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #F7FAF6)',
        padding: '20px',
        position: 'relative',
      }}>
        {bg}
        <div style={cardStyle} className="auth-card">
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              width: 68,
              height: 68,
              borderRadius: '9999px',
              background: 'linear-gradient(135deg, rgba(35, 139, 69, 0.12) 0%, rgba(23, 107, 53, 0.06) 100%)',
              border: '1px solid rgba(35, 139, 69, 0.20)',
              color: '#238B45',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
              boxShadow: '0 8px 20px rgba(23, 107, 53, 0.08)',
            }}>
              <Lock size={30} color="#238B45" strokeWidth={2.2} />
            </div>
            <h1 style={{
              fontSize: 'clamp(20px, 4vw, 24px)',
              fontWeight: 800,
              color: 'var(--text-primary, #174B2A)',
              letterSpacing: '-0.4px',
              margin: '0 0 6px',
            }}>
              I-reset ang Password
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #607067)', margin: 0 }}>
              Ilagay ang iyong rehistradong email upang makatanggap ng secure reset link.
            </p>
          </div>

          {/* Success Banner */}
          {forgotSuccess ? (
            <div style={{
              padding: '18px',
              borderRadius: 16,
              background: '#EAF6ED',
              border: '1px solid rgba(35, 139, 69, 0.25)',
              textAlign: 'center',
              marginBottom: 20,
            }}>
              <CheckCircle2 size={36} color="#238B45" style={{ margin: '0 auto 10px' }} />
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#176B35', margin: '0 0 6px' }}>
                Naipadala na ang Reset Link!
              </h3>
              <p style={{ fontSize: 13, color: '#174B2A', margin: '0 0 16px', lineHeight: 1.5 }}>
                Pakitingnan ang iyong inbox sa <strong>{forgotEmail}</strong> at sundin ang mga tagubilin para i-update ang iyong password.
              </p>
              <button
                type="button"
                onClick={() => switchView('signin')}
                style={{
                  padding: '10px 24px',
                  borderRadius: 9999,
                  background: 'linear-gradient(135deg, #238B45 0%, #176B35 100%)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(23, 107, 53, 0.20)',
                }}
              >
                Bumalik sa Mag-sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} noValidate>
              {error && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '11px 14px',
                  marginBottom: 16,
                  borderRadius: 14,
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#DC2626',
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{error}</span>
                </div>
              )}

              <Field label="Email Address" icon={Mail}>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => {
                    setForgotEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="halimbawa@alpasfarm.ph"
                  autoComplete="email"
                  autoFocus
                  disabled={loading}
                  style={inputStyle(!!error)}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#238B45';
                    e.target.style.boxShadow = '0 0 0 4px rgba(35, 139, 69, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.20)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </Field>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  height: 52,
                  padding: '0 20px',
                  background: loading ? 'rgba(35, 139, 69, 0.6)' : '#238B45',
                  border: 'none',
                  borderRadius: 9999,
                  color: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: loading ? 'none' : '0 6px 20px rgba(35, 139, 69, 0.25)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginTop: 10,
                  boxSizing: 'border-box',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.background = '#176B35';
                }}
                onMouseLeave={(e) => {
                  if (!loading) e.currentTarget.style.background = '#238B45';
                }}
              >
                {loading ? (
                  <>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.35)',
                      borderTopColor: '#FFFFFF',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    Ipinapadala ang Reset Link…
                  </>
                ) : (
                  <>
                    Ipadala ang Link sa Pag-reset <ArrowRight size={17} />
                  </>
                )}
              </button>

              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => switchView('signin')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#238B45',
                    fontSize: 13,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ArrowLeft size={14} /> Bumalik sa Mag-sign In
                </button>
              </div>

              {/* Help and Privacy Links */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 16,
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid rgba(35, 139, 69, 0.10)',
                fontSize: 12.5,
              }}>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #4B6F57)',
                    fontWeight: 600,
                    textDecoration: 'underline',
                    fontSize: 12.5,
                    padding: 0,
                  }}
                >
                  Kailangan ng Tulong?
                </button>
                <span style={{ color: 'rgba(35, 139, 69, 0.3)' }}>•</span>
                <button
                  type="button"
                  onClick={() => openLegalModal('privacy')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#607067',
                    fontWeight: 600,
                    textDecoration: 'underline',
                    fontSize: 12.5,
                    padding: 0,
                  }}
                >
                  Privacy & Terms
                </button>
              </div>
            </form>
          )}
        </div>
        {authModals}
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          .spin { animation: spin 0.8s linear infinite; }
          .auth-card input::placeholder { color: #7A8981 !important; opacity: 1 !important; }
          .auth-card input:focus { border-color: #238B45 !important; box-shadow: 0 0 0 3px rgba(35, 139, 69, 0.10) !important; outline: none !important; }
        `}</style>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── HEADER: OFFICIAL ALPASFARM LOGO & BRANDING ────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  const logoBlock = (
    <div style={{ textAlign: 'center', marginBottom: view === 'signup' ? 14 : 18 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
      }}>
        <AlpasFarmLogo size="login" />
      </div>
      <h1 style={{
        fontSize: 'clamp(20px, 4vw, 24px)',
        fontWeight: 800,
        color: 'var(--text-primary, #174B2A)',
        letterSpacing: '-0.5px',
        margin: '0 0 6px',
        lineHeight: 1.2,
      }}>
        {view === 'signup' ? 'Gumawa ng Account' : 'Magandang araw!'}
      </h1>
      <p style={{ fontSize: '13.5px', color: 'var(--text-secondary, #607067)', margin: 0, fontWeight: 500 }}>
        {view === 'signup'
          ? 'Magsimula sa ALPASFARM'
          : 'Mag-sign in sa iyong account'}
      </p>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // ── NAVIGATION CAPSULE TABS (Mag-sign In vs Mag-sign Up) ─────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  const tabBar = (
    <div style={{
      display: 'flex',
      background: 'rgba(35, 139, 69, 0.08)',
      borderRadius: 9999,
      padding: 4,
      marginBottom: 20,
      gap: 4,
      border: '1px solid rgba(35, 139, 69, 0.12)',
    }}>
      {([
        ['signin', <LogIn size={15} />, 'Mag-sign In'] as const,
        ['signup', <UserPlus size={15} />, 'Mag-sign Up'] as const
      ]).map(([v, icon, label]) => {
        const isActive = view === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => switchView(v as View)}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: isActive ? 700 : 600,
              border: isActive ? '1px solid rgba(35, 139, 69, 0.20)' : '1px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: isActive ? '#FFFFFF' : 'transparent',
              color: isActive ? '#176B35' : 'var(--text-secondary, #527060)',
              boxShadow: isActive ? '0 4px 12px rgba(23, 107, 53, 0.10)' : 'none',
            }}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #F7FAF6)',
      padding: '20px',
      overflowX: 'hidden',
      position: 'relative',
    }}>
      {bg}
      <div style={cardStyle} className="auth-card">
        <div style={{ position: 'relative' }}>
          {logoBlock}
          {tabBar}

          {/* Friendly Error Banner */}
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '11px 14px',
              marginBottom: 16,
              borderRadius: 14,
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#DC2626',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.4,
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── SIGN IN VIEW (Email + Password) ─────────────────────────────── */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          {view === 'signin' && (
            <form onSubmit={handleEmailSignIn} noValidate>
              <Field label="Email" icon={Mail}>
                <input
                  type="email"
                  value={siEmail}
                  onChange={(e) => {
                    setSiEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="halimbawa@alpasfarm.ph"
                  autoComplete="username"
                  disabled={loading}
                  style={inputStyle(!!error)}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#238B45';
                    e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.20)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </Field>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-primary, #174B2A)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                  }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => switchView('forgot')}
                    disabled={loading}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#238B45',
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    Nakalimutan ang Password?
                  </button>
                </div>

                <div style={{ position: 'relative' }}>
                  <Lock
                    size={17}
                    style={{
                      position: 'absolute',
                      left: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-secondary, #607067)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type={siShowPw ? 'text' : 'password'}
                    value={siPassword}
                    onChange={(e) => {
                      setSiPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Ilagay ang iyong password"
                    autoComplete="current-password"
                    disabled={loading}
                    style={{
                      ...inputStyle(!!error),
                      padding: '13px 44px 13px 44px',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#238B45';
                      e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.10)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.18)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSiShowPw((v) => !v)}
                    disabled={loading}
                    aria-label="Ipakita o itago ang password"
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#6A8173',
                      display: 'flex',
                      padding: 6,
                      borderRadius: 8,
                    }}
                  >
                    {siShowPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Primary Pill Button */}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    height: 52,
                    padding: '0 20px',
                    background: loading
                      ? 'rgba(35, 139, 69, 0.6)'
                      : '#238B45',
                    border: 'none',
                    borderRadius: 9999,
                    color: '#FFFFFF',
                    fontSize: 15,
                    fontWeight: 700,
                    boxShadow: loading ? 'none' : '0 6px 20px rgba(35, 139, 69, 0.25)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.background = '#176B35';
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) e.currentTarget.style.background = '#238B45';
                  }}
                >
                  {loading ? (
                    <>
                      <div style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.35)',
                        borderTopColor: '#FFFFFF',
                        animation: 'spin 0.7s linear infinite',
                      }} />
                      Pumapasok na…
                    </>
                  ) : (
                    <>
                      Mag-sign In <ArrowRight size={17} />
                    </>
                  )}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 2px' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(35, 139, 69, 0.15)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary, #4B6F57)', fontWeight: 600 }}>o mag-sign in gamit ang Gmail</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(35, 139, 69, 0.15)' }} />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  style={{
                    width: '100%',
                    height: 44,
                    padding: '0 16px',
                    background: 'var(--surface-elevated, #FFFFFF)',
                    border: '1px solid rgba(35, 139, 69, 0.25)',
                    borderRadius: 9999,
                    color: 'var(--text-primary, #174B2A)',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    boxSizing: 'border-box',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  Magpatuloy gamit ang Google
                </button>
              </div>

              {/* Bottom Quick Help & Legal Links */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 16,
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid rgba(35, 139, 69, 0.10)',
                fontSize: 12.5,
              }}>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #4B6F57)',
                    fontWeight: 600,
                    textDecoration: 'underline',
                    fontSize: 12.5,
                    padding: 0,
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#176B35')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #4B6F57)')}
                >
                  Kailangan ng Tulong?
                </button>
                <span style={{ color: 'rgba(35, 139, 69, 0.3)' }}>•</span>
                <button
                  type="button"
                  onClick={() => openLegalModal('privacy')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #607067)',
                    fontWeight: 600,
                    textDecoration: 'underline',
                    fontSize: 12.5,
                    padding: 0,
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#176B35')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #607067)')}
                >
                  Privacy & Terms
                </button>
              </div>
            </form>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── SIGN UP VIEW (Pangalan, Email, Password, Kumpirma, Checkbox) ── */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          {view === 'signup' && (
            <form onSubmit={handleEmailSignUp} noValidate>
              <Field label="Pangalan *" icon={User}>
                <input
                  type="text"
                  value={suFullName}
                  onChange={(e) => {
                    setSuFullName(e.target.value);
                    setError(null);
                  }}
                  placeholder="Juan dela Cruz"
                  autoComplete="name"
                  disabled={loading}
                  style={inputStyle(!!error)}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#238B45';
                    e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.20)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </Field>

              <Field label="Email *" icon={Mail}>
                <input
                  type="email"
                  value={suEmail}
                  onChange={(e) => {
                    setSuEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="halimbawa@alpasfarm.ph"
                  autoComplete="email"
                  disabled={loading}
                  style={inputStyle(!!error)}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#238B45';
                    e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.20)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </Field>

              {/* Password with strength indicator */}
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-primary, #174B2A)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                }}>
                  Password *
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={17}
                    style={{
                      position: 'absolute',
                      left: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-secondary, #607067)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type={suShowPw ? 'text' : 'password'}
                    value={suPassword}
                    onChange={(e) => {
                      setSuPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Hindi bababa sa 8 karakter"
                    autoComplete="new-password"
                    disabled={loading}
                    style={{ ...inputStyle(!!error), padding: '13px 44px 13px 44px' }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#238B45';
                      e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.10)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = error ? '#EF4444' : 'rgba(35, 139, 69, 0.18)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSuShowPw((v) => !v)}
                    aria-label="Ipakita o itago ang password"
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#6A8173',
                      display: 'flex',
                      padding: 6,
                    }}
                  >
                    {suShowPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {suPassword && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          style={{
                            flex: 1,
                            height: 4,
                            borderRadius: 2,
                            background: i <= pwStr.score ? pwStr.color : '#EAF6ED',
                            transition: 'background 0.2s',
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#607067' }}>
                      <span>Lakas ng Password: <strong style={{ color: pwStr.color }}>{pwStr.label}</strong></span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[['8+ karakter', pwStr.checks.length], ['Malaking titik', pwStr.checks.upper], ['Numero', pwStr.checks.number]].map(([l, ok]) => (
                          <span key={l as string} style={{ color: ok ? '#238B45' : '#607067', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            {ok ? <CheckCircle2 size={12} color="#238B45" /> : <span style={{ opacity: 0.5 }}>-</span>} {l}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-primary, #174B2A)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                }}>
                  Kumpirmahin ang Password *
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={17}
                    style={{
                      position: 'absolute',
                      left: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-secondary, #607067)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type={suShowConfirmPw ? 'text' : 'password'}
                    value={suConfirmPw}
                    onChange={(e) => {
                      setSuConfirmPw(e.target.value);
                      setError(null);
                    }}
                    placeholder="I-type muli ang password"
                    autoComplete="new-password"
                    disabled={loading}
                    style={{
                      ...inputStyle(!!error || (!!suConfirmPw && suPassword !== suConfirmPw)),
                      padding: '13px 44px 13px 44px',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#238B45';
                      e.target.style.boxShadow = '0 0 0 3px rgba(35, 139, 69, 0.10)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = (suConfirmPw && suPassword !== suConfirmPw) ? '#EF4444' : 'rgba(35, 139, 69, 0.18)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSuShowConfirmPw((v) => !v)}
                    aria-label="Ipakita o itago ang kumpirmasyon ng password"
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#6A8173',
                      display: 'flex',
                      padding: 6,
                    }}
                  >
                    {suShowConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {suConfirmPw && suPassword !== suConfirmPw && (
                  <p style={{ fontSize: 11, color: '#EF4444', marginTop: 5 }}>Hindi magkatugma ang kumpirmasyon ng password.</p>
                )}
              </div>

              {/* Required Terms/Privacy Checkbox */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18, cursor: 'pointer', userSelect: 'none' }}>
                <div
                  onClick={() => setSuTerms((v) => !v)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    flexShrink: 0,
                    marginTop: 1,
                    background: suTerms ? 'linear-gradient(135deg, #238B45 0%, #176B35 100%)' : '#FFFFFF',
                    border: `1.5px solid ${suTerms ? '#176B35' : 'rgba(35, 139, 69, 0.25)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {suTerms && <CheckCircle2 size={13} color="#FFFFFF" />}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #4B6F57)', lineHeight: 1.5 }}>
                  Sumasang-ayon ako sa{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openLegalModal('privacy');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#176B35',
                      fontWeight: 700,
                      padding: 0,
                      textDecoration: 'underline',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                    }}
                  >
                    Privacy Policy
                  </button>
                  {' '}at{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openLegalModal('terms');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#176B35',
                      fontWeight: 700,
                      padding: 0,
                      textDecoration: 'underline',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                    }}
                  >
                    Terms
                  </button>.
                </span>
              </label>

              {/* Pill Submit Button */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  height: 52,
                  padding: '0 20px',
                  background: loading
                    ? 'rgba(35, 139, 69, 0.6)'
                    : '#238B45',
                  border: 'none',
                  borderRadius: 9999,
                  color: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: loading ? 'none' : '0 6px 20px rgba(35, 139, 69, 0.25)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxSizing: 'border-box',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.background = '#176B35';
                }}
                onMouseLeave={(e) => {
                  if (!loading) e.currentTarget.style.background = '#238B45';
                }}
              >
                {loading ? (
                  <>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.35)',
                      borderTopColor: '#FFFFFF',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    Ginagawa ang account…
                  </>
                ) : (
                  <>
                    <UserPlus size={16} /> Mag-sign Up
                  </>
                )}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 8px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(35, 139, 69, 0.15)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary, #4B6F57)', fontWeight: 600 }}>o magrehistro gamit ang Gmail</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(35, 139, 69, 0.15)' }} />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                style={{
                  width: '100%',
                  height: 44,
                  padding: '0 16px',
                  background: 'var(--surface-elevated, #FFFFFF)',
                  border: '1px solid rgba(35, 139, 69, 0.25)',
                  borderRadius: 9999,
                  color: 'var(--text-primary, #174B2A)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  boxSizing: 'border-box',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s ease',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                </svg>
                Magrehistro gamit ang Google
              </button>

              {/* Already have an account switcher */}
              <div style={{
                textAlign: 'center',
                marginTop: 16,
                fontSize: 13,
                color: 'var(--text-secondary, #607067)',
              }}>
                May account na?{' '}
                <button
                  type="button"
                  onClick={() => switchView('signin')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#238B45',
                    fontWeight: 700,
                    textDecoration: 'underline',
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  Mag-sign In
                </button>
              </div>

              {/* Bottom Quick Help Links for Signup */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 16,
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid rgba(35, 139, 69, 0.10)',
                fontSize: 12.5,
              }}>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #4B6F57)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Kailangan ng Tulong?
                </button>
                <span style={{ color: 'rgba(35, 139, 69, 0.3)' }}>•</span>
                <button
                  type="button"
                  onClick={() => openLegalModal('privacy')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#607067',
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Privacy & Terms
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      {authModals}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        .auth-card input::placeholder { color: #7A8981 !important; opacity: 1 !important; }
        .auth-card input:focus { border-color: #238B45 !important; box-shadow: 0 0 0 3px rgba(35, 139, 69, 0.10) !important; outline: none !important; }
      `}</style>
    </div>
  );
}
