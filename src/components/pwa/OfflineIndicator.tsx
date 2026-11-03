import React from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { usePwa } from '../../context/PwaContext';

export function OfflineIndicator() {
  const { isOnline, recentlyReconnected } = usePwa();

  if (isOnline && !recentlyReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pwa-network-banner-container"
      style={{
        position: 'fixed',
        top: 'calc(12px + env(safe-area-inset-top, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        pointerEvents: 'none',
        width: 'auto',
        maxWidth: '92vw',
        animation: 'pwaSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {!isOnline ? (
        <div
          className="pwa-offline-pill"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 9999,
            background: 'rgba(239, 68, 68, 0.95)',
            color: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)',
            backdropFilter: 'blur(12px)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          <WifiOff size={16} strokeWidth={2.4} />
          <span>Walang internet connection</span>
        </div>
      ) : recentlyReconnected ? (
        <div
          className="pwa-online-pill"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 9999,
            background: 'rgba(35, 139, 69, 0.95)',
            color: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(35, 139, 69, 0.3)',
            backdropFilter: 'blur(12px)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          <Wifi size={16} strokeWidth={2.4} />
          <span>Online na ulit</span>
        </div>
      ) : null}
    </div>
  );
}
