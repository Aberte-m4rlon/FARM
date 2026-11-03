import React, { useState, useEffect } from 'react';
import {
  X, Mail, Phone, HelpCircle, CheckCircle2, ChevronDown, ChevronUp,
  Copy, ExternalLink, KeyRound, AlertCircle, ShieldCheck, UserPlus,
  LogIn, Layers, RefreshCw
} from 'lucide-react';

export interface HelpSupportModalProps {
  open: boolean;
  onClose: () => void;
  onSelectForgotPassword: () => void;
  onSelectVerifyHelp?: () => void;
  adminEmail?: string;
  adminPhone?: string;
}

interface FaqItem {
  id: string;
  question: string;
  answer: React.ReactNode;
}

export function HelpSupportModal({
  open,
  onClose,
  onSelectForgotPassword,
  onSelectVerifyHelp,
  adminEmail = '',
  adminPhone = '',
}: HelpSupportModalProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);

  // Handle ESC key to close
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const handleCopyEmail = () => {
    if (!adminEmail) return;
    navigator.clipboard.writeText(adminEmail);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2500);
  };

  const toggleFaq = (id: string) => {
    setExpandedFaq(prev => prev === id ? null : id);
  };

  const faqs: FaqItem[] = [
    {
      id: 'faq-signin',
      question: 'Paano mag-sign in?',
      answer: (
        <div>
          <p style={{ margin: '0 0 6px' }}>May dalawang mabilis na paraan upang makapasok sa ALPASFARM:</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li><strong>Email at Password:</strong> I-type ang iyong rehistradong email at password sa sign-in form.</li>
            <li><strong>Google Sign-In:</strong> Pindutin ang <em>"Magpatuloy gamit ang Google"</em> para sa mabilis at ligtas na one-click login gamit ang iyong Gmail account.</li>
          </ol>
        </div>
      ),
    },
    {
      id: 'faq-password',
      question: 'Paano mag-reset ng password?',
      answer: (
        <div>
          <p style={{ margin: '0 0 8px' }}>
            Nakalimutan mo ba ang iyong password? Madali itong ma-recover:
          </p>
          <div style={{
            background: '#F4FAF5',
            border: '1px solid rgba(35, 139, 69, 0.18)',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 10,
            fontSize: 12.5,
          }}>
            Pindutin ang <strong>"Problema sa Password"</strong> sa ibaba o ang <em>"Nakalimutan ang Password?"</em> link sa ilalim ng password box, ilagay ang iyong email, at magpapadala kami ng secure password reset link.
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectForgotPassword();
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 9999,
              background: '#238B45',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <KeyRound size={13} /> Buksan ang Forgot Password Form
          </button>
        </div>
      ),
    },
    {
      id: 'faq-reset-link',
      question: 'Hindi ko natatanggap ang password reset link.',
      answer: (
        <div>
          <p style={{ margin: '0 0 6px' }}>Kung hindi agad dumarating ang password reset email sa iyong inbox:</p>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li><strong>Spam / Junk folder:</strong> Siguraduhing tingnan ang Spam, Promotions, o Updates folder sa iyong email.</li>
            <li><strong>Maling Email:</strong> Tiyaking tama ang baybay ng iyong rehistradong email address sa ALPASFARM.</li>
            <li><strong>Muling Paghiling:</strong> Maghintay ng ilang sandali bago muling magsumite ng kahilingan sa pag-reset.</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'faq-google',
      question: 'Hindi gumagana ang Google Sign-In.',
      answer: (
        <div>
          <p style={{ margin: 0 }}>
            Tiyaking pinapayagan ng iyong browser ang third-party cookies at pop-up windows para sa Google authentication. Kung gumagamit ka ng Private/Incognito browser o may ad-blocker, pansamantalang i-disable ito o gamitin ang regular na Email at Password sign-in.
          </p>
        </div>
      ),
    },
    {
      id: 'faq-account',
      question: 'May problema sa account ko.',
      answer: (
        <div>
          <p style={{ margin: '0 0 6px' }}>
            Kung naka-lock ang iyong account, hindi ma-access ang iyong farm records, o kailangan ng pagbabago sa iyong account role (halimbawa: mula Farm Manager patungo sa System Administrator):
          </p>
          <p style={{ margin: 0, fontWeight: 600, color: '#176B35' }}>
            Makipag-ugnayan agad sa ALPASFARM Administrator gamit ang "Email ang Admin" button sa itaas para sa kagyat na asistensya.
          </p>
        </div>
      ),
    },
  ];

  const systemServices = [
    { title: 'Account Registration', desc: 'Humingi ng tulong kung hindi makapag-register ng account.', icon: UserPlus },
    { title: 'Sign In', desc: 'Tulong sa pag-log in gamit ang email at password.', icon: LogIn },
    { title: 'Google Sign-In', desc: 'Mabilis na one-click sign in gamit ang Gmail.', icon: ShieldCheck },
    { title: 'Password Reset', desc: 'I-reset ang password kung nakalimutan mo ito.', icon: KeyRound },
    { title: 'Account Access', desc: 'Tulong kung naka-lock o may limitasyon ang account.', icon: ShieldCheck },
    { title: 'Farm Data Access', desc: 'Makipag-ugnayan sa admin kung may problema sa access ng farm records.', icon: Layers },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10, 30, 18, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'alpasFadeIn 0.2s ease-out',
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '580px',
          maxHeight: 'calc(100dvh - 24px)',
          background: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(35, 139, 69, 0.20)',
          borderRadius: '24px',
          boxShadow: '0 24px 60px rgba(23, 107, 53, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'alpasSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(35, 139, 69, 0.12)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            background: 'inherit',
            flexShrink: 0,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #238B45 0%, #176B35 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                boxShadow: '0 4px 12px rgba(23, 107, 53, 0.20)',
                flexShrink: 0,
              }}
            >
              <HelpCircle size={24} />
            </div>
            <div>
              <h2
                id="help-modal-title"
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#174B2A',
                  letterSpacing: '-0.3px',
                }}
              >
                Kailangan ng Tulong?
              </h2>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 12.5,
                  color: '#50645A',
                  lineHeight: 1.4,
                }}
              >
                May problema sa pag-sign in o paggamit ng ALPASFARM? Narito ang mga paraan para makakuha ng tulong.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Isara"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '1px solid rgba(35, 139, 69, 0.15)',
              background: '#FFFFFF',
              color: '#50645A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#EAF6ED';
              e.currentTarget.style.color = '#176B35';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#FFFFFF';
              e.currentTarget.style.color = '#50645A';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div
          style={{
            padding: '20px 24px max(24px, env(safe-area-inset-bottom, 24px))',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            fontSize: 13.5,
            color: '#174B2A',
          }}
        >
          {/* SECTION 1: CONTACT ADMIN */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(234, 246, 237, 0.7) 0%, rgba(255, 255, 255, 0.9) 100%)',
              border: '1.5px solid rgba(35, 139, 69, 0.25)',
              borderRadius: 18,
              padding: '18px 20px',
              boxShadow: '0 4px 16px rgba(23, 107, 53, 0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: '#238B45',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShieldCheck size={16} />
              </div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#174B2A' }}>
                Makipag-ugnayan sa Admin
              </h3>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#50645A', lineHeight: 1.45 }}>
              Kung may problema sa account, verification, password, o access sa system, makipag-ugnayan sa ALPASFARM Admin.
            </p>

            {adminEmail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#FFFFFF',
                    border: '1px solid rgba(35, 139, 69, 0.20)',
                    borderRadius: 12,
                    padding: '8px 14px',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Mail size={16} color="#238B45" />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#174B2A',
                        wordBreak: 'break-all',
                      }}
                    >
                      {adminEmail}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: copiedEmail ? '#238B45' : '#50645A',
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      borderRadius: 6,
                    }}
                  >
                    {copiedEmail ? (
                      <>
                        <CheckCircle2 size={14} color="#238B45" /> Nakopya!
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> Kopyahin
                      </>
                    )}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <a
                    href={`mailto:${adminEmail}?subject=ALPASFARM%20Tulong%20sa%20Account&body=Magandang%20araw%20Admin,%0A%0ANais%20ko%20pong%20humingi%20ng%20tulong%20patungkol%20sa%20aking%20ALPASFARM%20account.%0A%0APangalan:%0AEmail/Phone:%0AIssue:%0A`}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      height: 44,
                      padding: '0 18px',
                      background: '#238B45',
                      color: '#FFFFFF',
                      borderRadius: 9999,
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: 13.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: '0 4px 14px rgba(35, 139, 69, 0.25)',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#176B35')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#238B45')}
                  >
                    <Mail size={16} /> Email ang Admin
                  </a>

                  {adminPhone && (
                    <a
                      href={`tel:${adminPhone}`}
                      style={{
                        height: 44,
                        padding: '0 18px',
                        background: '#FFFFFF',
                        color: '#176B35',
                        border: '1.5px solid rgba(35, 139, 69, 0.25)',
                        borderRadius: 9999,
                        textDecoration: 'none',
                        fontWeight: 700,
                        fontSize: 13.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <Phone size={15} /> Tawagan ang Admin
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#F9FAFB',
                  border: '1px dashed #CBD5E1',
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <AlertCircle size={18} color="#64748B" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                    Hindi pa naka-set ang contact information ng Admin.
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    Makipag-ugnayan sa system administrator.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2: ACCOUNT HELP ACTIONS (REAL ACTIONABLE BUTTONS) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <KeyRound size={17} color="#238B45" />
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: '#174B2A' }}>
                Tulong sa Account
              </h3>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              {/* Option 1: Problema sa Password */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSelectForgotPassword();
                }}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: '#FFFFFF',
                  border: '1px solid rgba(35, 139, 69, 0.18)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#238B45';
                  e.currentTarget.style.background = '#F4FAF5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(35, 139, 69, 0.18)';
                  e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#174B2A' }}>
                    🔑 Problema sa Password
                  </span>
                  <ExternalLink size={13} color="#238B45" />
                </div>
                <span style={{ fontSize: 11.5, color: '#50645A', lineHeight: 1.35 }}>
                  Buksan ang Forgot Password flow upang mai-reset ang password gamit ang email.
                </span>
              </button>

              {/* Option 2: Hindi natanggap ang reset link */}
              <button
                type="button"
                onClick={() => toggleFaq('faq-reset-link')}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: '#FFFFFF',
                  border: '1px solid rgba(35, 139, 69, 0.18)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#238B45';
                  e.currentTarget.style.background = '#F4FAF5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(35, 139, 69, 0.18)';
                  e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#174B2A' }}>
                    ✉️ Walang Natanggap na Link
                  </span>
                  <ChevronDown size={14} color="#238B45" />
                </div>
                <span style={{ fontSize: 11.5, color: '#50645A', lineHeight: 1.35 }}>
                  Tulong kung hindi natatanggap ang email link sa pag-reset ng password.
                </span>
              </button>

              {/* Option 3: Problema sa Sign In */}
              <button
                type="button"
                onClick={() => toggleFaq('faq-signin')}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: '#FFFFFF',
                  border: '1px solid rgba(35, 139, 69, 0.18)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#238B45';
                  e.currentTarget.style.background = '#F4FAF5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(35, 139, 69, 0.18)';
                  e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#174B2A' }}>
                    🚪 Problema sa Sign In
                  </span>
                  <ChevronDown size={14} color="#238B45" />
                </div>
                <span style={{ fontSize: 11.5, color: '#50645A', lineHeight: 1.35 }}>
                  Mga tagubilin sa pagsusuri ng email, password, at alternatibong sign-in methods.
                </span>
              </button>

              {/* Option 4: Problema sa Account */}
              <button
                type="button"
                onClick={() => {
                  if (adminEmail) {
                    window.location.href = `mailto:${adminEmail}?subject=ALPASFARM%20Account%20Access%20Issue`;
                  } else {
                    toggleFaq('faq-account');
                  }
                }}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: '#FFFFFF',
                  border: '1px solid rgba(35, 139, 69, 0.18)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#238B45';
                  e.currentTarget.style.background = '#F4FAF5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(35, 139, 69, 0.18)';
                  e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#174B2A' }}>
                    🛡️ Problema sa Account / Access
                  </span>
                  <ExternalLink size={13} color="#238B45" />
                </div>
                <span style={{ fontSize: 11.5, color: '#50645A', lineHeight: 1.35 }}>
                  Makipag-ugnayan sa Administrator para sa lockouts o permission changes.
                </span>
              </button>
            </div>
          </div>

          {/* SECTION 3: SYSTEM SERVICES */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Layers size={17} color="#238B45" />
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: '#174B2A' }}>
                Mga Serbisyo
              </h3>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: 8,
              }}
            >
              {systemServices.map((svc, idx) => {
                const Icon = svc.icon;
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      background: '#FFFFFF',
                      border: '1px solid rgba(35, 139, 69, 0.12)',
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: '#EAF6ED',
                        color: '#176B35',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={15} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#174B2A' }}>
                        {svc.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#607067', marginTop: 2, lineHeight: 1.3 }}>
                        {svc.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 4: FAQ / QUICK HELP */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <HelpCircle size={17} color="#238B45" />
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: '#174B2A' }}>
                Mabilis na Tulong (FAQ)
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {faqs.map((faq) => {
                const isExpanded = expandedFaq === faq.id;
                return (
                  <div
                    key={faq.id}
                    style={{
                      border: `1px solid ${isExpanded ? '#238B45' : 'rgba(35, 139, 69, 0.16)'}`,
                      borderRadius: 12,
                      background: isExpanded ? '#FBFDFB' : '#FFFFFF',
                      overflow: 'hidden',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(faq.id)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: 'none',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        textAlign: 'left',
                        gap: 12,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: isExpanded ? '#176B35' : '#174B2A',
                        }}
                      >
                        {faq.question}
                      </span>
                      {isExpanded ? (
                        <ChevronUp size={16} color="#238B45" />
                      ) : (
                        <ChevronDown size={16} color="#607067" />
                      )}
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          padding: '0 14px 14px',
                          fontSize: 12.5,
                          color: '#415549',
                          lineHeight: 1.5,
                          borderTop: '1px solid rgba(35, 139, 69, 0.08)',
                          paddingTop: 10,
                        }}
                      >
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid rgba(35, 139, 69, 0.12)',
            display: 'flex',
            justifyContent: 'flex-end',
            background: '#FFFFFF',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 9999,
              background: '#EAF6ED',
              color: '#176B35',
              border: '1px solid rgba(35, 139, 69, 0.20)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#238B45';
              e.currentTarget.style.color = '#FFFFFF';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#EAF6ED';
              e.currentTarget.style.color = '#176B35';
            }}
          >
            Isara
          </button>
        </div>
      </div>

      <style>{`
        @keyframes alpasFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes alpasSlideUp {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
