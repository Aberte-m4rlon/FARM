import { type ReactNode } from 'react';
import { Button } from './Button';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  children?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
  children,
}: EmptyStateProps) {
  return (
    <div
      className={`alpas-empty-state ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        borderRadius: 'var(--radius-xl, 24px)',
        background: 'var(--color-surface, rgba(255, 255, 255, 0.04))',
        border: '1px dashed var(--color-border, rgba(226, 232, 240, 0.8))',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-lg, 16px)',
          background: '#E8F5E9',
          color: '#2E7D32',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        {icon || <Inbox size={26} />}
      </div>

      <h3
        style={{
          margin: '0 0 6px 0',
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--color-text-primary, #1F2933)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            margin: '0 0 20px 0',
            fontSize: '13.5px',
            color: 'var(--color-text-muted, #667085)',
            maxWidth: '420px',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {children}

      {(actionLabel || secondaryActionLabel) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="secondary" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
          {actionLabel && onAction && (
            <Button variant="primary" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
