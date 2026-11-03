import { Loader2 } from 'lucide-react';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  message?: string;
  text?: string;
  fullPage?: boolean;
  fullScreen?: boolean;
  color?: string;
  className?: string;
}

export function LoadingSpinner({
  size = 'md',
  message,
  text,
  fullPage = false,
  fullScreen = false,
  color = 'var(--color-primary, #43A047)',
  className = '',
}: LoadingSpinnerProps) {
  const displayMsg = message ?? text;
  const isFull = fullPage || fullScreen;

  const getPixelSize = (): number => {
    switch (size) {
      case 'sm': return 16;
      case 'lg': return 32;
      case 'xl': return 48;
      case 'md':
      default:   return 24;
    }
  };

  const spinner = (
    <div
      className={`alpas-loading-container ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
      }}
    >
      <Loader2
        size={getPixelSize()}
        className="animate-spin"
        style={{ color, animation: 'spin 1s linear infinite' }}
      />
      {displayMsg && (
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--color-text-muted, #667085)',
          }}
        >
          {displayMsg}
        </p>
      )}
    </div>
  );

  if (isFull) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--color-background, #F5F8F5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}
      >
        {spinner}
      </div>
    );
  }

  return spinner;
}
