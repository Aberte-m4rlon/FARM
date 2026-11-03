import React, { useState } from 'react';
import { Download, CheckCircle2, Smartphone, Monitor } from 'lucide-react';
import { usePwa } from '../../context/PwaContext';

export interface InstallButtonProps {
  variant?: 'card' | 'button' | 'menuitem';
  className?: string;
  onSuccess?: () => void;
}

export function InstallButton({
  variant = 'card',
  className = '',
  onSuccess,
}: InstallButtonProps) {
  const { isInstallable, isInstalled, promptInstall } = usePwa();
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    setLoading(true);
    try {
      const accepted = await promptInstall();
      if (accepted && onSuccess) {
        onSuccess();
      }
    } finally {
      setLoading(false);
    }
  };

  // 1. Variant: Card (Used in Settings Page)
  if (variant === 'card') {
    return (
      <div
        className={`pwa-install-card ${className}`}
        style={{
          background: 'var(--color-surface, rgba(255, 255, 255, 0.70))',
          border: '1px solid var(--color-border, rgba(35, 139, 69, 0.12))',
          borderRadius: 18,
          padding: 20,
          marginBottom: 20,
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--color-primary-soft, #EAF6ED)',
                color: 'var(--color-primary, #238B45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Smartphone size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--color-text-primary, #174B2A)' }}>
                I-install ang ALPASFARM
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #50645A)' }}>
                Progressive Web App (PWA) para sa mobile at desktop
              </div>
            </div>
          </div>

          {isInstalled ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: 999,
                background: '#E8F5E9',
                color: '#2E7D32',
                border: '1px solid #C8E6C9',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <CheckCircle2 size={14} />
              Naka-install na
            </span>
          ) : isInstallable ? (
            <button
              type="button"
              onClick={handleInstall}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--color-primary, #238B45)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 10,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(35, 139, 69, 0.25)',
              }}
            >
              <Download size={15} />
              <span>{loading ? 'Binubuksan...' : 'I-install Ngayon'}</span>
            </button>
          ) : (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 12px',
                borderRadius: 999,
                background: 'var(--color-surface-elevated, #F1F5F9)',
                color: 'var(--color-text-muted, #64748B)',
              }}
            >
              Available sa browser install menu
            </span>
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #50645A)', lineHeight: 1.5, margin: 0 }}>
          Mas mabilis at mas maginhawang buksan ang ALPASFARM bilang app nang direkta mula sa iyong home screen o desktop. Hindi kailangang dumaan sa App Store o Play Store.
        </p>
      </div>
    );
  }

  // 2. Variant: Menuitem (For Profile Dropdown or Sidebar)
  if (variant === 'menuitem') {
    if (isInstalled || !isInstallable) {
      return null;
    }

    return (
      <button
        type="button"
        className={`pd-item ${className}`}
        onClick={handleInstall}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 14px',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--color-primary, #238B45)',
          fontWeight: 600,
          fontSize: 13,
          textAlign: 'left',
        }}
      >
        <Download size={16} />
        <span>I-install ang App</span>
      </button>
    );
  }

  // 3. Variant: Button
  if (!isInstallable) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleInstall}
      disabled={loading}
      className={`pwa-install-btn ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--color-primary, #238B45)',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 700,
        cursor: loading ? 'wait' : 'pointer',
      }}
    >
      <Download size={14} />
      <span>I-install</span>
    </button>
  );
}
