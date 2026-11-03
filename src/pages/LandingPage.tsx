import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui/Button';
import { AlpasFarmLogo } from '../components/common/AlpasFarmLogo';
import {
  PawPrint,
  HeartPulse,
  Heart,
  Syringe,
  Package,
  Scale,
  Bell,
  Bot,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Pill,
  Wheat,
  Wrench,
  Clock,
  QrCode,
  Phone,
  ArrowRight,
  ChevronDown,
  Sun,
  Moon,
  Menu,
  X,
  Layers,
  Activity,
  FileText,
  Eye,
  Check,
  Building2,
  User,
  Lock,
} from 'lucide-react';

export function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (user) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg, #F7FAF6)',
        color: 'var(--text, #174B2A)',
        fontFamily: 'inherit',
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      {/* ── 1. HEADER / NAVIGATION ────────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--surface, rgba(255, 255, 255, 0.85))',
          backdropFilter: 'var(--glass-blur, blur(16px))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(16px))',
          borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: '0 auto',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* Logo */}
          <div
            onClick={() => navigate('/')}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none',
              flexShrink: 0,
            }}
            aria-label="ALPASFARM Home"
          >
            <AlpasFarmLogo size="header" style={{ maxHeight: 38, width: 'auto' }} />
          </div>

          {/* Desktop Nav Links */}
          <nav
            style={{
              display: 'none',
              alignItems: 'center',
              gap: 22,
            }}
            className="landing-desktop-nav"
          >
            <button
              type="button"
              onClick={() => scrollToSection('mga-tampok')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Mga Tampok
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('kalusugan')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Treatment Records (Mga Tala ng Paggamot)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('inventory')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('magkakaugnay')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Magkakaugnay
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('qr-code')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              QR Code
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('farmer-first')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text, #174B2A)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              Para sa Farmer
            </button>
          </nav>

          {/* Desktop Right Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--surface, rgba(255, 255, 255, 0.70))',
                border: '1px solid var(--border, rgba(35, 139, 69, 0.14))',
                color: 'var(--text, #174B2A)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Palitan ang tema"
              title={darkMode ? 'Lumipat sa Light Mode' : 'Lumipat sa Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Desktop Auth Buttons */}
            <div
              style={{
                display: 'none',
                alignItems: 'center',
                gap: 10,
              }}
              className="landing-desktop-auth"
            >
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate('/login')}
                style={{
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 13,
                  padding: '9px 16px',
                }}
              >
                Mag-sign In
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/register')}
                style={{
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 13,
                  padding: '9px 18px',
                  background: 'var(--color-primary, #238B45)',
                  boxShadow: '0 4px 14px rgba(35, 139, 69, 0.28)',
                }}
              >
                Magsimula
              </Button>
            </div>

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'var(--surface, rgba(255, 255, 255, 0.70))',
                border: '1px solid var(--border, rgba(35, 139, 69, 0.14))',
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
              }}
              className="landing-mobile-menu-btn"
              aria-label="Buksan ang Menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div
            style={{
              padding: '16px 20px 24px',
              background: 'var(--surface, #ffffff)',
              borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <button
              type="button"
              onClick={() => scrollToSection('mga-tampok')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              Mga Tampok
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('kalusugan')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              Treatment Records (Mga Tala ng Paggamot)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('inventory')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('magkakaugnay')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              Magkakaugnay ang Talaan
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('qr-code')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              QR Code Profile
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('farmer-first')}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '10px 12px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text, #174B2A)',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              Para sa Farmer
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate('/login')}
                style={{ width: '100%', justifyContent: 'center', borderRadius: 12 }}
              >
                Mag-sign In
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/register')}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  borderRadius: 12,
                  background: 'var(--color-primary, #238B45)',
                }}
              >
                Magsimula
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* ── 2. HERO SECTION ────────────────────────────────────────────────── */}
      <section
        style={{
          padding: '64px 20px 84px',
          textAlign: 'center',
          position: 'relative',
          background: `linear-gradient(180deg, 
            rgba(35, 139, 69, 0.08) 0%, 
            rgba(23, 107, 53, 0.04) 60%, 
            transparent 100%)`,
        }}
      >
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          {/* Official ALPASFARM Logo */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <AlpasFarmLogo size="hero" />
          </div>

          {/* Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              borderRadius: 9999,
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--border, rgba(35, 139, 69, 0.18))',
              marginBottom: 24,
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.03)',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--color-primary, #238B45)',
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-primary, #238B45)',
                letterSpacing: '0.02em',
              }}
            >
              Matalinong Pamamahala ng Bukid
            </span>
          </div>

          {/* Headline */}
          <h1
            style={{
              fontSize: 'clamp(30px, 5.5vw, 54px)',
              fontWeight: 900,
              lineHeight: 1.15,
              color: 'var(--text, #174B2A)',
              letterSpacing: '-0.03em',
              margin: '0 auto 20px',
              maxWidth: 780,
            }}
          >
            Mas Maayos na Bukid.
            <br />
            Mas Madaling Pamamahala.
          </h1>

          {/* Subheadline */}
          <p
            style={{
              fontSize: 'clamp(15px, 2vw, 18px)',
              lineHeight: 1.65,
              color: 'var(--text-secondary, #50645A)',
              margin: '0 auto 32px',
              maxWidth: 680,
              fontWeight: 500,
            }}
          >
            ALPASFARM ang tumutulong sa iyo na pamahalaan ang iyong mga kambing at tupa, kalusugan, breeding, pagkain, gamit, at mga talaan sa iisang sistema.
          </p>

          {/* Hero Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              flexWrap: 'wrap',
              marginBottom: 24,
            }}
          >
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/register')}
              rightIcon={<ArrowRight size={18} />}
              style={{
                borderRadius: 14,
                fontWeight: 800,
                fontSize: 15,
                padding: '14px 28px',
                background: 'var(--color-primary, #238B45)',
                boxShadow: '0 6px 20px rgba(35, 139, 69, 0.32)',
                minHeight: 50,
              }}
            >
              Magsimula
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => scrollToSection('mga-tampok')}
              rightIcon={<ChevronDown size={18} />}
              style={{
                borderRadius: 14,
                fontWeight: 700,
                fontSize: 15,
                padding: '14px 24px',
                background: 'var(--surface, #ffffff)',
                border: '1px solid var(--border, rgba(35, 139, 69, 0.20))',
                color: 'var(--text, #174B2A)',
                minHeight: 50,
              }}
            >
              Alamin ang ALPASFARM
            </Button>
          </div>

          {/* Supporting Statement */}
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary, #64748b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ShieldCheck size={16} color="var(--color-primary, #238B45)" />
            Para sa mas simple, organisado, at mas madaling pamamahala ng iyong bukid.
          </div>
        </div>
      </section>

      {/* ── 3. CURRENT SYSTEM FEATURES ───────────────────────────────────────── */}
      <section
        id="mga-tampok"
        style={{
          padding: '80px 20px',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-primary, #238B45)',
              marginBottom: 8,
            }}
          >
            Sistema ng Pamamahala ng Kambing at Tupa
          </div>
          <h2
            style={{
              fontSize: 'clamp(26px, 4vw, 40px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              letterSpacing: '-0.02em',
              margin: '0 0 12px',
            }}
          >
            Mga Tampok ng ALPASFARM
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--text-secondary, #50645A)',
              maxWidth: 620,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Binuo upang matugunan ang aktwal na pangangailangan ng kawan mula sa araw-araw na pag-aalaga hanggang sa kumpletong talaan.
          </p>
        </div>

        {/* Features Grid (8 Clean Cards) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
          }}
        >
          {/* Feature 1 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PawPrint size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Pamamahala ng Kambing at Tupa
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Mag-record at madaling subaybayan ang impormasyon ng bawat kambing at tupa, kabilang ang ID, pangalan, lahi, kasarian, edad, at timbang.
            </p>
          </div>

          {/* Feature 2 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <HeartPulse size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Treatment Records (Mga Tala ng Paggamot)
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Subaybayan ang kalagayan ng bawat alaga gamit ang health records, observations, risk level, at mga rekomendasyon para sa susunod na hakbang.
            </p>
          </div>

          {/* Feature 3 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Heart size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Breeding
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Itala ang pagpapalahi, buntis na inahin, inaasahang panganganak, at iba pang breeding records ng kambing at tupa.
            </p>
          </div>

          {/* Feature 4 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Syringe size={24} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
                Mga Bakuna
              </h3>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: 'rgba(35, 139, 69, 0.08)', color: 'var(--color-primary, #238B45)' }}>
                Kalusugan
              </span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Itala ang mga bakunang naibigay at subaybayan ang mga susunod na schedule upang manatiling ligtas ang kawan sa sakit.
            </p>
          </div>

          {/* Feature 5 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Package size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Subaybayan ang pagkain, gamot, vitamins, bakuna, kagamitan, at iba pang gamit na mayroon sa bukid.
            </p>
          </div>

          {/* Feature 6 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Scale size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Mga Timbang
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Itala ang timbang ng bawat alaga at makita ang pagbabago ng timbang sa paglipas ng panahon upang masuri ang paglaki.
            </p>
          </div>

          {/* Feature 7 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bell size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              Mga Paalala
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Makita agad ang mahahalagang bagay na kailangang aksyunan tulad ng health concerns, gamot, breeding, mababang stock, at expiration.
            </p>
          </div>

          {/* Feature 8 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 18,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 24,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bot size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text, #174B2A)' }}>
              AI Farm Assistant
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.6, margin: 0 }}>
              Magtanong tungkol sa iyong bukid at makakuha ng sagot batay sa aktwal na impormasyon na nasa iyong system upang mapadali ang desisyon.
            </p>
          </div>
        </div>
      </section>

      {/* ── 4. HEALTH SECTION ──────────────────────────────────────────────── */}
      <section
        id="kalusugan"
        style={{
          padding: '80px 20px',
          background: 'var(--surface, rgba(255, 255, 255, 0.50))',
          borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
          borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-primary, #238B45)',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <HeartPulse size={16} />
              Pangangalaga sa Kawan
            </div>
            <h2
              style={{
                fontSize: 'clamp(24px, 3.8vw, 36px)',
                fontWeight: 900,
                color: 'var(--text, #174B2A)',
                margin: '0 0 12px',
                letterSpacing: '-0.02em',
              }}
            >
              Mas Madaling Subaybayan ang Kalusugan
            </h2>
            <p
              style={{
                fontSize: 15,
                color: 'var(--text-secondary, #50645A)',
                maxWidth: 620,
                margin: '0 auto',
                lineHeight: 1.6,
              }}
            >
              Makikita mo kung aling kambing o tupa ang maayos, kailangang bantayan, o nangangailangan ng karagdagang atensyon.
            </p>
          </div>

          {/* Health Status Cards (Ordered by System Priority) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
            }}
          >
            {/* 1. Kailangan ng Gamot */}
            <div
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 16,
                border: '1.5px solid rgba(239, 68, 68, 0.35)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#EF4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Pill size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#DC2626' }}>
                Kailangan ng Gamot
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                May iniinom o ituturok na gamot o gamutan na kailangang ibigay sa itinakdang oras.
              </div>
            </div>

            {/* 2. Kailangan ng Atensyon */}
            <div
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 16,
                border: '1.5px solid rgba(245, 158, 11, 0.35)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#D97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertTriangle size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#D97706' }}>
                Kailangan ng Atensyon
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                May naitalang sintomas o di-karaniwang kondisyon na kailangang personal na suriin.
              </div>
            </div>

            {/* 3. Mataas ang Risk */}
            <div
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 16,
                border: '1.5px solid rgba(220, 38, 38, 0.30)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(220, 38, 38, 0.10)',
                  color: '#DC2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShieldAlert size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#B91C1C' }}>
                Mataas ang Risk
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Nangangailangan ng maingat na pagtutok batay sa mga health observations at talaan.
              </div>
            </div>

            {/* 4. Bantayan */}
            <div
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 16,
                border: '1.5px solid rgba(35, 139, 69, 0.25)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(35, 139, 69, 0.10)',
                  color: 'var(--color-primary, #238B45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Eye size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text, #174B2A)' }}>
                Bantayan
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Mino-monitor pagkatapos manganak, bagong gamot, o sumasailalim sa observation.
              </div>
            </div>

            {/* 5. Maayos / Healthy */}
            <div
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 16,
                border: '1.5px solid rgba(22, 163, 74, 0.35)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(22, 163, 74, 0.12)',
                  color: '#16A34A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle2 size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#16A34A' }}>
                Maayos / Healthy
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Masigla, normal ang pagkain at pagtimbang, at walang anumang iniindang sakit.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. INVENTORY SECTION ───────────────────────────────────────────── */}
      <section
        id="inventory"
        style={{
          padding: '80px 20px',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--color-primary, #238B45)',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <Package size={16} />
            Mga Pangunahing Pangangailangan
          </div>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.8vw, 36px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}
          >
            Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--text-secondary, #50645A)',
              maxWidth: 640,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Makikita at mamamahalaan mo ang mga pagkain, gamot, vitamins, bakuna, kagamitan, at iba pang stock na ginagamit sa bukid.
          </p>
        </div>

        {/* Inventory 6 Highlight Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 18,
            marginBottom: 28,
          }}
        >
          {/* Card 1 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <PawPrint size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Kambing at Tupa
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Talaan ng kawan na siyang pinaglalaanan ng pagkain, gamot, at iba pang supplies ng bukid.
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Wheat size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Pagkain
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Subaybayan ang dami ng feeds, concentrates, damo, at iba pang sustansya para sa kawan.
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Pill size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Gamot at Health Supplies
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Talaan ng mga gamot, vitamins, bakuna, at first aid para laging handa kapag may nagkasakit.
              </div>
            </div>
          </div>

          {/* Card 4 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Wrench size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mga Kagamitan
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Pamahalaan ang mga gamit sa koral, inuman, pampatimbang, at mga gamit sa pag-aalaga.
              </div>
            </div>
          </div>

          {/* Card 5 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid rgba(245, 158, 11, 0.25)',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#D97706', marginBottom: 4 }}>
                Mababang Stock
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Alerto kapag malapit nang maubos ang supplies para makapag-replenish bago kapusin.
              </div>
            </div>
          </div>

          {/* Card 6 */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid rgba(239, 68, 68, 0.25)',
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#EF4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Clock size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#DC2626', marginBottom: 4 }}>
                Malapit nang Mag-expire
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Maagang paalala para sa mga gamot at bakunang malapit nang lumipas ang bisa.
              </div>
            </div>
          </div>
        </div>

        {/* Connected Inventory Explanation Banner */}
        <div
          style={{
            background: 'rgba(35, 139, 69, 0.06)',
            borderRadius: 16,
            border: '1px solid var(--border, rgba(35, 139, 69, 0.18))',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <CheckCircle2 size={20} color="var(--color-primary, #238B45)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 13.5, color: 'var(--text, #174B2A)', fontWeight: 600, lineHeight: 1.5 }}>
            Kapag gumamit ka ng gamot o pagkain, maayos itong naitatala sa inventory upang malaman ang natitirang stock at maiwasan ang biglaang pagkaubos.
          </div>
        </div>
      </section>

      {/* ── 6. CONNECTED SYSTEM SECTION ────────────────────────────────────── */}
      <section
        id="magkakaugnay"
        style={{
          padding: '80px 20px',
          background: 'var(--surface, rgba(255, 255, 255, 0.50))',
          borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
          borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-primary, #238B45)',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <Layers size={16} />
              Isang Buong Daloy ng Trabaho
            </div>
            <h2
              style={{
                fontSize: 'clamp(24px, 3.8vw, 36px)',
                fontWeight: 900,
                color: 'var(--text, #174B2A)',
                margin: '0 0 12px',
                letterSpacing: '-0.02em',
              }}
            >
              Magkakaugnay ang Iyong Mga Talaan
            </h2>
            <p
              style={{
                fontSize: 15,
                color: 'var(--text-secondary, #50645A)',
                maxWidth: 640,
                margin: '0 auto',
                lineHeight: 1.6,
              }}
            >
              Ang impormasyon ng iyong kambing at tupa, kalusugan, breeding, bakuna, timbang, inventory, mga paalala, at mga ulat ay magkakaugnay.
            </p>
          </div>

          {/* Sequential Step Flow */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              position: 'relative',
            }}
          >
            {[
              { step: 1, title: 'Kambing at Tupa', desc: 'Rehistro ng bawat kambing at tupa', icon: PawPrint },
              { step: 2, title: 'Treatment Records (Mga Tala ng Paggamot)', desc: 'Mga gamutan at obserbasyon para sa bawat alaga', icon: HeartPulse },
              { step: 3, title: 'Breeding', desc: 'Pagpapalahi at pagbubuntis', icon: Heart },
              { step: 4, title: 'Mga Bakuna', desc: 'Proteksyon at schedule ng turok', icon: Syringe },
              { step: 5, title: 'Mga Timbang', desc: 'Pagsukat at pagsubaybay sa paglaki', icon: Scale },
              { step: 6, title: 'Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)', desc: 'Suplay ng pagkain, gamot, at kagamitan', icon: Package },
              { step: 7, title: 'Mga Paalala', desc: 'Awtomatikong alerto sa kailangan gawin', icon: Bell },
              { step: 8, title: 'Mga Ulat', desc: 'Mga tala at pagsusuri para sa bukid', icon: FileText },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  background: 'var(--surface, #ffffff)',
                  borderRadius: 16,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.14))',
                  padding: 18,
                  boxShadow: '0 3px 12px rgba(0, 0, 0, 0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(35, 139, 69, 0.10)',
                      color: 'var(--color-primary, #238B45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <item.icon size={18} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--color-primary, #238B45)',
                      background: 'rgba(35, 139, 69, 0.08)',
                      padding: '2px 8px',
                      borderRadius: 9999,
                    }}
                  >
                    Hakbang {item.step}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text, #174B2A)' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. DASHBOARD PREVIEW ────────────────────────────────────────────── */}
      <section
        style={{
          padding: '80px 20px',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--color-primary, #238B45)',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <Activity size={16} />
            Goat and Sheep Status (Katayuan ng Kambing at Tupa)
          </div>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.8vw, 36px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}
          >
            A Clear View of Goat and Sheep Status (Isang Tinginan sa Katayuan ng Kambing at Tupa)
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--text-secondary, #50645A)',
              maxWidth: 680,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Sa Goat and Sheep Status (Katayuan ng Kambing at Tupa), makikita agad kung ilan ang iyong mga alaga, ang kanilang kalagayan, mga kailangang aksyunan, pagpaparami, mga pangunahing pangangailangan, at iba pang mahahalagang impormasyon.
          </p>
        </div>

        {/* Authentic Dashboard Mock Card */}
        <div
          style={{
            background: 'var(--surface, #ffffff)',
            borderRadius: 22,
            border: '1.5px solid var(--border, rgba(35, 139, 69, 0.16))',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden',
          }}
        >
          {/* Top Bar of Dashboard Preview */}
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(35, 139, 69, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlpasFarmLogo size="sm" />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #174B2A)' }}>
                Goat and Sheep Status (Katayuan ng Kambing at Tupa)
              </span>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                color: '#16A34A',
                background: 'rgba(22, 163, 74, 0.10)',
                padding: '3px 9px',
                borderRadius: 9999,
              }}
            >
              <CheckCircle2 size={12} />
              Aktibong Sistema
            </span>
          </div>

          {/* Inner Dashboard Content */}
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 4 Stat Overview Blocks */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 14,
              }}
            >
              {/* Stat 1 */}
              <div
                style={{
                  background: 'var(--bg, #F7FAF6)',
                  borderRadius: 14,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #50645A)' }}>
                  Kabuuan ng Kawan
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text, #174B2A)', marginTop: 4 }}>
                  Kambing at Tupa
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-primary, #238B45)', marginTop: 4, fontWeight: 600 }}>
                  Kumpletong talaan ng ID at lahi
                </div>
              </div>

              {/* Stat 2 */}
              <div
                style={{
                  background: 'var(--bg, #F7FAF6)',
                  borderRadius: 14,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #50645A)' }}>
                  Health Overview
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16A34A', marginTop: 4 }}>
                  Maayos / Nabantayan
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #50645A)', marginTop: 4 }}>
                  Naka-kategorya ayon sa kalagayan
                </div>
              </div>

              {/* Stat 3 */}
              <div
                style={{
                  background: 'var(--bg, #F7FAF6)',
                  borderRadius: 14,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #50645A)' }}>
                  Breeding &amp; Kidding
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text, #174B2A)', marginTop: 4 }}>
                  Buntis na Inahin
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #50645A)', marginTop: 4 }}>
                  May schedule ng panganganak
                </div>
              </div>

              {/* Stat 4 */}
              <div
                style={{
                  background: 'var(--bg, #F7FAF6)',
                  borderRadius: 14,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #50645A)' }}>
                  Mga Paalala
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#D97706', marginTop: 4 }}>
                  Kailangang Aksyunan
                </div>
                <div style={{ fontSize: 11, color: '#D97706', marginTop: 4, fontWeight: 600 }}>
                  Gamot, bakuna, mababang stock
                </div>
              </div>
            </div>

            {/* Quick Action Preview Rows */}
            <div
              style={{
                borderRadius: 14,
                border: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
                background: 'var(--bg, #F7FAF6)',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bell size={18} color="var(--color-primary, #238B45)" />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #174B2A)' }}>
                  Araw-araw na Paalala at Rekomendasyon para sa Tagapag-alaga
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/login')}
                style={{ borderRadius: 8, fontSize: 12, padding: '6px 14px' }}
              >
                Tingnan ang Kalagayan
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. QR CODE & PUBLIC ANIMAL PROFILE ─────────────────────────────── */}
      <section
        id="qr-code"
        style={{
          padding: '80px 20px',
          background: 'var(--surface, rgba(255, 255, 255, 0.50))',
          borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
          borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
        }}
      >
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 36,
              alignItems: 'center',
            }}
          >
            {/* Left Column: Information */}
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-primary, #238B45)',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <QrCode size={16} />
                Mabilisang Pag-access
              </div>
              <h2
                style={{
                  fontSize: 'clamp(24px, 3.8vw, 36px)',
                  fontWeight: 900,
                  color: 'var(--text, #174B2A)',
                  margin: '0 0 16px',
                  letterSpacing: '-0.02em',
                }}
              >
                QR Code para sa Bawat Alaga
              </h2>
              <p
                style={{
                  fontSize: 15,
                  color: 'var(--text-secondary, #50645A)',
                  lineHeight: 1.6,
                  margin: '0 0 18px',
                }}
              >
                Maaaring magkaroon ng sariling QR Code ang bawat alaga para mas madaling makita ang impormasyon nito.
              </p>
              <p
                style={{
                  fontSize: 14.5,
                  color: 'var(--text-secondary, #50645A)',
                  lineHeight: 1.6,
                  margin: '0 0 24px',
                }}
              >
                Kapag na-scan ang QR Code sa ear tag gamit ang camera, maaaring buksan ang public animal profile nang walang anumang app na kailangang i-install.
              </p>

              {/* Sub-block: Lost Animal Recovery */}
              <div
                style={{
                  background: 'rgba(35, 139, 69, 0.06)',
                  borderRadius: 16,
                  border: '1.5px dashed rgba(35, 139, 69, 0.35)',
                  padding: 18,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 6 }}>
                  Kapag May Nakakita sa Iyong Alaga
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.55 }}>
                  Sa pamamagitan ng QR Code, maaaring buksan ang public profile ng alaga. Makikita rito ang pangunahing impormasyon tungkol sa kambing o tupa at ang pampublikong contact information ng may-ari upang agad itong maibalik.
                </div>
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary, #64748b)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Lock size={14} color="var(--color-primary, #238B45)" />
                Ligtas ang iyong privacy: hindi inilalabas ang mga pribadong medical records o panloob na mga talaan.
              </div>
            </div>

            {/* Right Column: Public Profile Preview Mock Card */}
            <div>
              <div
                style={{
                  background: 'var(--surface, #ffffff)',
                  borderRadius: 20,
                  border: '1px solid var(--border, rgba(35, 139, 69, 0.16))',
                  boxShadow: '0 8px 28px rgba(0, 0, 0, 0.05)',
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: 'rgba(35, 139, 69, 0.12)',
                        color: 'var(--color-primary, #238B45)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <QrCode size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text, #174B2A)' }}>
                        Public Animal Profile
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>
                        ALPASFARM QR Passport
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 9999,
                      background: 'rgba(35, 139, 69, 0.08)',
                      color: '#16A34A',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    <ShieldCheck size={12} />
                    Beripikado
                  </span>
                </div>

                {/* Animal Details */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--bg, #F7FAF6)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>Tag ID</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text, #174B2A)' }}>GOAT-002</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>Lahi / Uri</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #174B2A)' }}>Kiko (Kambing)</div>
                  </div>
                </div>

                {/* Owner Information Section */}
                <div
                  style={{
                    border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary, #238B45)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Impormasyon ng May-ari
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <User size={16} color="var(--color-primary, #238B45)" />
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>May-ari</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text, #174B2A)' }}>Juan Dela Cruz</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Building2 size={16} color="var(--color-primary, #238B45)" />
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>Bukid at Lokasyon</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #174B2A)' }}>ALPASFARM Farm, Bongabong</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Phone size={16} color="var(--color-primary, #238B45)" />
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>Telepono</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-primary, #238B45)' }}>09123456789</div>
                    </div>
                  </div>
                </div>

                {/* CTA Button Mock */}
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => navigate('/login')}
                  leftIcon={<Phone size={15} />}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    borderRadius: 12,
                    fontWeight: 700,
                    background: 'var(--color-primary, #238B45)',
                  }}
                >
                  Makipag-ugnayan sa May-ari
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 9. FARMER-FIRST SECTION ────────────────────────────────────────── */}
      <section
        id="farmer-first"
        style={{
          padding: '80px 20px',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--color-primary, #238B45)',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <ShieldCheck size={16} />
            Praktikal at Maaasahan
          </div>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.8vw, 36px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}
          >
            Dinisenyo para sa Totoong Pangangailangan ng Farmer
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--text-secondary, #50645A)',
              maxWidth: 640,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Simple gamitin, madaling intindihin, at ginawa para makatulong sa pang-araw-araw na pamamahala ng kambing at tupa.
          </p>
        </div>

        {/* 5 Points Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 18,
          }}
        >
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Check size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mas organisadong records
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Lahat ng profile, lahi, at petsa ay nasa isang ligtas na sistema nang hindi nawawala o nababasa.
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Check size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mas madaling health monitoring
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Madaling malaman kung sino ang may sakit at ano ang kailangang gamot o gamutan.
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Check size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mas madaling inventory tracking
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Iwasan ang pagkasayang at maagang mapansin kung paubos na ang gamot o feeds sa bukid.
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Check size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mas mabilis makita ang mga kailangang aksyunan
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                May mga paalala para sa nakatakdang bakuna, inaasahang panganganak, at health check.
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
              padding: 20,
              display: 'flex',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(35, 139, 69, 0.10)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Check size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #174B2A)', marginBottom: 4 }}>
                Mas madaling makita ang kasaysayan ng bawat alaga
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', lineHeight: 1.5 }}>
                Kumpletong kasaysayan ng timbang, kalusugan, gamutan, at supling sa iisang pahina.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 10. SECURITY / PRIVACY ─────────────────────────────────────────── */}
      <section
        style={{
          padding: '70px 20px',
          background: 'var(--surface, rgba(255, 255, 255, 0.50))',
          borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
          borderBottom: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
        }}
      >
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: 'rgba(35, 139, 69, 0.12)',
              color: 'var(--color-primary, #238B45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <ShieldCheck size={28} />
          </div>
          <h2
            style={{
              fontSize: 'clamp(22px, 3.5vw, 32px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              margin: '0 0 14px',
              letterSpacing: '-0.02em',
            }}
          >
            Pribado ang Iyong Farm Data
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--text-secondary, #50645A)',
              lineHeight: 1.7,
              maxWidth: 680,
              margin: '0 auto',
            }}
          >
            Ang bawat user ay may sariling farm data. Hindi dapat makita o mapamahalaan ng ibang user ang mga alaga, records, inventory, at iba pang pribadong impormasyon na hindi kanila.
          </p>
        </div>
      </section>

      {/* ── 11. FINAL CTA ──────────────────────────────────────────────────── */}
      <section
        style={{
          padding: '80px 20px',
          textAlign: 'center',
          background: `linear-gradient(180deg, 
            transparent 0%, 
            rgba(35, 139, 69, 0.08) 100%)`,
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontSize: 'clamp(26px, 4.5vw, 42px)',
              fontWeight: 900,
              color: 'var(--text, #174B2A)',
              margin: '0 0 16px',
              letterSpacing: '-0.02em',
            }}
          >
            Handa Ka Na Bang Mas Ayusin ang Iyong Bukid?
          </h2>
          <p
            style={{
              fontSize: 16,
              color: 'var(--text-secondary, #50645A)',
              lineHeight: 1.6,
              margin: '0 auto 32px',
              maxWidth: 580,
            }}
          >
            Simulan ang mas organisado at mas madaling pamamahala ng iyong kambing at tupa gamit ang ALPASFARM.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/register')}
              rightIcon={<ArrowRight size={18} />}
              style={{
                borderRadius: 14,
                fontWeight: 800,
                fontSize: 15,
                padding: '14px 30px',
                background: 'var(--color-primary, #238B45)',
                boxShadow: '0 6px 20px rgba(35, 139, 69, 0.32)',
                minHeight: 50,
              }}
            >
              Magsimula
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('/login')}
              leftIcon={<User size={17} />}
              style={{
                borderRadius: 14,
                fontWeight: 700,
                fontSize: 15,
                padding: '14px 26px',
                background: 'var(--surface, #ffffff)',
                border: '1px solid var(--border, rgba(35, 139, 69, 0.20))',
                color: 'var(--text, #174B2A)',
                minHeight: 50,
              }}
            >
              Mag-sign In
            </Button>
          </div>
        </div>
      </section>

      {/* ── 12. FOOTER ─────────────────────────────────────────────────────── */}
      <footer
        style={{
          padding: '60px 20px 32px',
          background: 'var(--surface, #ffffff)',
          borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.12))',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* Top Footer Content */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 36,
              marginBottom: 44,
            }}
          >
            {/* Brand Column */}
            <div>
              <div
                onClick={() => navigate('/')}
                style={{ cursor: 'pointer', display: 'inline-block', marginBottom: 12 }}
              >
                <AlpasFarmLogo size="header" style={{ maxHeight: 36, width: 'auto' }} />
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-primary, #238B45)',
                  marginBottom: 10,
                }}
              >
                Matalinong Pamamahala ng Bukid
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary, #64748b)',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                Ang modernong sistema sa pamamahala ng kambing at tupa na dinisenyo para sa pang-araw-araw na pangangailangan ng mga magsasaka.
              </p>
            </div>

            {/* System Links Column */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #174B2A)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 14 }}>
                Mga Bahagi ng Sistema
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span onClick={() => navigate('/dashboard')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Goat and Sheep Status (Katayuan ng Kambing at Tupa)
                </span>
                <span onClick={() => navigate('/animals')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Kambing at Tupa
                </span>
                <span onClick={() => navigate('/treatments')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Treatment Records (Mga Tala ng Paggamot)
                </span>
                <span onClick={() => navigate('/breeding')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Breeding
                </span>
                <span onClick={() => navigate('/vaccinations')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Mga Bakuna
                </span>
                <span onClick={() => navigate('/inventory')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
                </span>
                <span onClick={() => navigate('/reports')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Mga Ulat
                </span>
                <span onClick={() => navigate('/myai')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  AI Farm Assistant
                </span>
              </div>
            </div>

            {/* Legal / Contact Column */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #174B2A)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 14 }}>
                Impormasyon at Suporta
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span onClick={() => scrollToSection('farmer-first')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Tungkol sa ALPASFARM
                </span>
                <span onClick={() => navigate('/login')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Privacy Policy
                </span>
                <span onClick={() => navigate('/login')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Mga Tuntunin
                </span>
                <span onClick={() => navigate('/login')} style={{ fontSize: 13, color: 'var(--text-secondary, #50645A)', cursor: 'pointer' }}>
                  Makipag-ugnayan
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Copyright */}
          <div
            style={{
              borderTop: '1px solid var(--border, rgba(35, 139, 69, 0.10))',
              paddingTop: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: 12,
              color: 'var(--text-secondary, #64748b)',
            }}
          >
            <div>
              &copy; 2026 ALPASFARM. Sistema ng Pamamahala ng Kambing at Tupa.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={14} color="var(--color-primary, #238B45)" />
              Ligtas at Beripikadong Farm Management
            </div>
          </div>
        </div>
      </footer>

      {/* Responsive CSS for Media Queries */}
      <style>{`
        @media (min-width: 900px) {
          .landing-desktop-nav {
            display: flex !important;
          }
          .landing-desktop-auth {
            display: flex !important;
          }
          .landing-mobile-menu-btn {
            display: none !important;
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
