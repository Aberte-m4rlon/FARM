import React, { useState, useEffect } from 'react';
import {
  X, ShieldCheck, FileText, Lock, Users, Database,
  AlertTriangle, CheckCircle2, ChevronRight, Mail
} from 'lucide-react';

export interface PrivacyTermsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'privacy' | 'terms';
  adminEmail?: string;
}

export function PrivacyTermsModal({
  open,
  onClose,
  initialTab = 'privacy',
  adminEmail = '',
}: PrivacyTermsModalProps) {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>(initialTab);

  // Sync initialTab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-terms-title"
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
          maxWidth: '680px',
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
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2
                id="privacy-terms-title"
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#174B2A',
                  letterSpacing: '-0.3px',
                }}
              >
                Privacy & Terms
              </h2>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 12.5,
                  color: '#50645A',
                  lineHeight: 1.4,
                }}
              >
                Patakaran sa Privacy at Mga Tuntunin ng Paggamit ng ALPASFARM
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

        {/* Tab Selector Capsule */}
        <div
          style={{
            padding: '12px 24px 0',
            background: '#FFFFFF',
          }}
        >
          <div
            style={{
              display: 'flex',
              background: 'rgba(35, 139, 69, 0.08)',
              borderRadius: 9999,
              padding: 4,
              gap: 4,
              border: '1px solid rgba(35, 139, 69, 0.12)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              style={{
                flex: 1,
                padding: '9px 16px',
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: activeTab === 'privacy' ? 700 : 600,
                border: activeTab === 'privacy' ? '1px solid rgba(35, 139, 69, 0.20)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                background: activeTab === 'privacy' ? '#FFFFFF' : 'transparent',
                color: activeTab === 'privacy' ? '#176B35' : '#527060',
                boxShadow: activeTab === 'privacy' ? '0 4px 12px rgba(23, 107, 53, 0.10)' : 'none',
              }}
            >
              <ShieldCheck size={15} /> Patakaran sa Privacy (Privacy Policy)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('terms')}
              style={{
                flex: 1,
                padding: '9px 16px',
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: activeTab === 'terms' ? 700 : 600,
                border: activeTab === 'terms' ? '1px solid rgba(35, 139, 69, 0.20)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                background: activeTab === 'terms' ? '#FFFFFF' : 'transparent',
                color: activeTab === 'terms' ? '#176B35' : '#527060',
                boxShadow: activeTab === 'terms' ? '0 4px 12px rgba(23, 107, 53, 0.10)' : 'none',
              }}
            >
              <FileText size={15} /> Mga Tuntunin ng Paggamit (Terms of Use)
            </button>
          </div>
        </div>

        {/* Scrollable Document Content */}
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
            gap: 18,
            fontSize: 13.5,
            color: '#174B2A',
            lineHeight: 1.6,
          }}
        >
          {activeTab === 'privacy' ? (
            /* ══════════════════════════════════════════════════════════════════ */
            /* ── TAB 1: PRIVACY POLICY ───────────────────────────────────────── */
            /* ══════════════════════════════════════════════════════════════════ */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Highlight Banner: User Data Isolation */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(234, 246, 237, 0.9) 0%, rgba(255, 255, 255, 0.9) 100%)',
                  border: '1.5px solid rgba(35, 139, 69, 0.25)',
                  borderRadius: 14,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <Lock size={20} color="#176B35" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#174B2A' }}>
                    Proteksyon at Paghihiwalay ng Datos (Tenant Data Isolation)
                  </h4>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#3E5748', lineHeight: 1.5 }}>
                    <strong>Ang farm records ng bawat user ay mahigpit na hiwalay at hindi maaaring makita o pamahalaan ng ibang normal na user.</strong> Ang bawat may-ari ng bukid ay may sariling ligtas na espasyo sa system.
                  </p>
                </div>
              </div>

              {/* Section 1 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  1. Anong Impormasyon ang Kinokolekta
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  Kinokolekta lamang ng ALPASFARM ang impormasyong kinakailangan para sa pamamahala ng iyong bukid:
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, color: '#4B6053' }}>
                  <li><strong>Impormasyon sa Account:</strong> Pangalan, email address, numero ng telepono, farm name, lalawigan/lokasyon, at role sa system.</li>
                  <li><strong>Talaan ng Kambing at Tupa (Livestock Records):</strong> Tag ID, pangalan, lahi (breed), kasarian, petsa ng kapanganakan, timbang, at kategorya ng kambing o tupa.</li>
                  <li><strong>Treatment at mga obserbasyon:</strong> Bakuna, gamot, mga tala ng magsasaka, at treatment na nakakabit sa alaga.</li>
                  <li><strong>Imbentaryo:</strong> Dami at paggalaw ng gamot, bakuna, kagamitan, at iba pang supplies sa bukid.</li>
                  <li><strong>Talaan ng Pagpapalahi (Breeding):</strong> Kasaysayan ng breeding at pagsilang ng mga supling.</li>
                  <li><strong>System Activity:</strong> Timestamp ng pag-login at mga transaksyon para sa seguridad ng account.</li>
                </ul>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#687E70', fontStyle: 'italic' }}>
                  * Paalala: Ang ALPASFARM ay <strong>hindi</strong> nangongolekta ng video stream o thermal imaging camera data.
                </p>
              </div>

              {/* Section 2 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  2. Paano Ginagamit ang Impormasyon
                </h3>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, color: '#4B6053' }}>
                  <li>Para sa operasyon ng bukid (pagsubaybay sa kalusugan, iskedyul ng bakuna, at pagsubaybay sa imbentaryo).</li>
                  <li>Para sa pagtukoy ng maagang babala sa kalusugan (Early Illness Risk detection) batay sa mga klinikal na obserbasyon.</li>
                  <li>Para sa pagbuo ng opisyal na ulat at summaries na magagamit ng may-ari ng bukid.</li>
                  <li>Para sa pagpapatunay ng iyong pagkakakilanlan (sign-in) at pag-iwas sa pandaraya.</li>
                </ul>
              </div>

              {/* Section 3 & 4 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  3. Farm and Animal Records & Account Information
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Ang lahat ng data na inilalagay mo patungkol sa iyong mga kambing, tupa, imbentaryo, at operasyon ay nakatago para sa kapakinabangan ng iyong bukid. Ang iyong login credentials (email, mobile number) ay protektado at hindi kailanman isisiwalat sa publiko.
                </p>
              </div>

              {/* Section 5 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  5. Seguridad ng Datos (Data Security)
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Ipinapatupad ng ALPASFARM ang industriyal na pamantayan sa seguridad: naka-encrypt ang lahat ng data transmission gamit ang TLS/HTTPS, at ang database ay pinoprotektahan ng Row-Level Security (RLS) policies sa antas ng database upang matiyak na tanging ang may-ari o awtorisadong admin lamang ang may pahintulot.
                </p>
              </div>

              {/* Section 6 & 7 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  6. Pagbabahagi at Pagmamay-ari ng Datos
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  <strong>Pagmamay-ari Mo ang Iyong Datos:</strong> Ikaw ang nagmamay-ari ng lahat ng impormasyong inilalagay mo sa ALPASFARM.
                </p>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  <strong>Walang Pagbebenta ng Datos:</strong> Hindi namin ibinebenta, ipinaparenta, o ibinabahagi ang iyong impormasyon sa mga advertiser o third-party companies.
                </p>
              </div>

              {/* Section 8 & 9 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  8. Pagpapanatili ng Datos at Mga Karapatan ng User (User Rights)
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  Mananatili ang iyong mga talaan hangga't aktibo ang iyong account. May karapatan kang:
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, color: '#4B6053' }}>
                  <li>Tingnan at baguhin ang iyong profile at mga talaan ng bukid anumang oras.</li>
                  <li>Mag-export ng mga ulat (CSV o PDF) ng iyong kambing at tupa at imbentaryo.</li>
                  <li>Humiling ng pagbura o pag-deactivate ng iyong account sa pamamagitan ng pakikipag-ugnayan sa Administrator.</li>
                </ul>
              </div>

              {/* Section 10 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  10. Impormasyon sa Pakikipag-ugnayan (Contact Information)
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Para sa anumang katanungan ukol sa Patakaran sa Privacy o pamamahala ng iyong personal na datos, makipag-ugnayan sa ALPASFARM System Administrator{adminEmail ? ` sa ${adminEmail}` : ' sa pamamagitan ng Help & Support modal'}.
                </p>
              </div>
            </div>
          ) : (
            /* ══════════════════════════════════════════════════════════════════ */
            /* ── TAB 2: TERMS OF USE ─────────────────────────────────────────── */
            /* ══════════════════════════════════════════════════════════════════ */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Highlight Banner: Veterinary / AI Disclaimer */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.7) 0%, rgba(255, 255, 255, 0.9) 100%)',
                  border: '1.5px solid #F59E0B',
                  borderRadius: 14,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <AlertTriangle size={20} color="#D97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#92400E' }}>
                    Health & AI Farm Assistant Disclaimer (Kritikal na Paalala)
                  </h4>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#78350F', lineHeight: 1.5 }}>
                    <strong>Ang health information at AI-generated recommendations sa ALPASFARM ay para sa farm monitoring at decision support lamang. Hindi nito pinapalitan ang pagsusuri, diagnosis, o payo ng isang lisensyadong beterinaryo (licensed veterinarian).</strong>
                  </p>
                </div>
              </div>

              {/* Section 1 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  1. Paggamit ng ALPASFARM
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Ang ALPASFARM ay isang plataporma para sa pamamahala ng mga kambing at tupa (small ruminants). Sa paggawa ng account o paggamit ng platform, sumasang-ayon ka na susundin ang mga tuntuning nakasaad dito.
                </p>
              </div>

              {/* Section 2 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  2. Responsibilidad sa Account (User Account Responsibility)
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Responsibilidad ng bawat rehistradong user na pangalagaan ang pagiging lihim ng kanilang login credentials, kabilang ang password, email code, at SMS OTP. Huwag ibahagi ang iyong access sa mga hindi awtorisadong indibidwal.
                </p>
              </div>

              {/* Section 3 & 4 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  3. Responsibilidad sa Datos ng Bukid at Kawastuhan (Farm Data Responsibility)
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Ang kawastuhan ng mga ulat at alerto sa kalusugan ay nakasalalay sa katumpakan ng mga datos na inilalagay mo sa system (hal. timbang, dami ng pakain, mga gamot, at sintomas). Hikayat ang paglalagay ng makatotohanang talaan.
                </p>
              </div>

              {/* Section 5 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  5. Ipinagbabawal na Paggamit (Prohibited Use)
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  Ipinagbabawal sa ilalim ng mga tuntuning ito ang:
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, color: '#4B6053' }}>
                  <li>Pagtatangkang i-hack, sirain, o guluhin ang operasyon ng server o database.</li>
                  <li>Paggamit ng mga automated bot upang kumuha ng datos ng ibang users nang walang pahintulot.</li>
                  <li>Paggamit ng ALPASFARM para sa anumang ilegal o mapanlinlang na aktibidad.</li>
                </ul>
              </div>

              {/* Section 6 & 7 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  6. Seguridad ng Account at System Availability
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  Kung may hinala kang may ibang nakapasok sa iyong account, agad itong ipagbigay-alam sa Administrator.
                </p>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Sinisikap ng ALPASFARM na panatilihing aktibo ang system 24/7, subalit maaaring magkaroon ng panandaliang paghinto para sa system updates o database maintenance.
                </p>
              </div>

              {/* Section 8 & 9 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  8. Mga Ulat, Talaan, at Tungkulin ng Administrator
                </h3>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Ang mga opisyal na ulat at metrics na nililikha ng system ay nagsisilbing gabay sa pamamahala. Ang mga administrators ay may pananagutan na tiyakin ang maayos na serbisyo at tugunan ang mga teknikal na suporta ng mga magsasaka.
                </p>
              </div>

              {/* Section 10 & 11 */}
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#174B2A', margin: '0 0 6px' }}>
                  10. Mga Pagbabago sa Tuntunin at Pakikipag-ugnayan
                </h3>
                <p style={{ margin: '0 0 6px', color: '#4B6053' }}>
                  Maaaring i-update ang Mga Tuntunin ng Paggamit anumang oras upang mapabuti ang serbisyo. Ang anumang mahahalagang pagbabago ay ipaaalam sa mga user sa pamamagitan ng notice sa login screen.
                </p>
                <p style={{ margin: 0, color: '#4B6053' }}>
                  Para sa mga katanungan o kumpirmasyon, makipag-ugnayan sa Administrator{adminEmail ? ` sa ${adminEmail}` : ''}.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid rgba(35, 139, 69, 0.12)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#FFFFFF',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, color: '#687E70' }}>
            ALPASFARM Smart Livestock Management
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 9999,
              background: '#238B45',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 4px 12px rgba(35, 139, 69, 0.20)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#176B35';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#238B45';
            }}
          >
            Naiintindihan Ko / Isara
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
