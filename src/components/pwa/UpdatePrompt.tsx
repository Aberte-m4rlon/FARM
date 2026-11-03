import React, { useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { usePwa } from '../../context/PwaContext';

export function UpdatePrompt() {
  const { hasUpdate, applyUpdate } = usePwa();
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!hasUpdate || dismissed) {
    return null;
  }

  const handleUpdate = () => {
    setUpdating(true);
    applyUpdate();
  };

  return (
    <aside
      aria-label="PWA Update Notification"
      className="pwa-update-card"
      style={{
        position: 'fixed',
        bottom: 'calc(74px + env(safe-area-inset-bottom, 0px))',
        right: '20px',
        zIndex: 99998,
        maxWidth: 380,
        width: 'calc(100% - 40px)',
        background: 'var(--color-surface-elevated, #FFFFFF)',
        border: '1px solid var(--color-border, rgba(35, 139, 69, 0.2))',
        borderRadius: 16,
        padding: '14px 16px',
        boxShadow: '0 12px 36px rgba(23, 107, 53, 0.18)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        animation: 'pwaSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--color-primary-soft, #EAF6ED)',
              color: 'var(--color-primary, #238B45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary, #174B2A)' }}>
              May bagong update sa ALPASFARM
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #50645A)', marginTop: 2 }}>
              I-update ang app para makuha ang mga pinakabagong feature at pagpapahusay.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted, #78877F)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Dismiss update notification"
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-secondary, #50645A)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '6px 12px',
          }}
        >
          Mamaya
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={updating}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--color-primary, #238B45)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 8,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 700,
            cursor: updating ? 'wait' : 'pointer',
            boxShadow: '0 4px 12px rgba(35, 139, 69, 0.25)',
          }}
        >
          <RefreshCw size={14} className={updating ? 'spin' : ''} />
          <span>{updating ? 'Ina-update...' : 'I-update'}</span>
        </button>
      </div>
    </aside>
  );
}
