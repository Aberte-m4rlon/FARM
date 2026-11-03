import { type ReactNode } from 'react';
import { Button } from './Button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface ErrorStateProps {
  icon?: ReactNode;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  icon,
  title = 'Something went wrong',
  message = 'An unexpected error occurred while loading this section. Please try again.',
  onRetry,
  retryLabel = 'Try Again',
  className = '',
}: ErrorStateProps) {
  return (
    <div
      className={`alpas-error-state ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '36px 20px',
        borderRadius: 'var(--radius-xl, 24px)',
        background: 'rgba(239, 68, 68, 0.05)',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-lg, 20px)',
          background: 'rgba(239, 68, 68, 0.12)',
          color: 'var(--color-danger, #EF4444)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        {icon || <AlertTriangle size={24} />}
      </div>

      <h3
        style={{
          margin: '0 0 6px 0',
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--color-text-primary, #0F172A)',
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin: '0 0 18px 0',
          fontSize: '13px',
          color: 'var(--color-text-secondary, #475569)',
          maxWidth: '400px',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>

      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCw size={14} />}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
