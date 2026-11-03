import { type ReactNode, type HTMLAttributes } from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'default';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  icon,
  className = '',
  style,
  ...props
}: BadgeProps) {
  const getVariantStyles = (): { bg: string; text: string; border: string; dotColor: string } => {
    switch (variant) {
      case 'primary':
      case 'success':
      case 'info':
        return {
          bg: '#EAF6ED',
          text: '#176B35',
          border: 'rgba(35, 139, 69, 0.25)',
          dotColor: '#238B45',
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.12)',
          text: '#D97706',
          border: 'rgba(245, 158, 11, 0.28)',
          dotColor: '#F59E0B',
        };
      case 'danger':
        return {
          bg: 'rgba(239, 68, 68, 0.12)',
          text: '#DC2626',
          border: 'rgba(239, 68, 68, 0.28)',
          dotColor: '#EF4444',
        };
      case 'default':
      case 'neutral':
      default:
        return {
          bg: 'rgba(80, 100, 90, 0.08)',
          text: '#50645A',
          border: 'rgba(35, 139, 69, 0.15)',
          dotColor: '#78877F',
        };
    }
  };

  const { bg, text, border, dotColor } = getVariantStyles();

  const isSmall = size === 'sm';

  return (
    <span
      className={`alpas-badge alpas-badge-${variant} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: isSmall ? '2px 8px' : '4px 10px',
        fontSize: isSmall ? '11px' : '12px',
        fontWeight: 700,
        lineHeight: 1,
        borderRadius: 'var(--radius-pill, 9999px)',
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        ...style,
      }}
      {...props}
    >
      {dot && (
        <span
          style={{
            width: isSmall ? 5 : 6,
            height: isSmall ? 5 : 6,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
      )}
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
