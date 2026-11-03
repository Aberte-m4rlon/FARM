import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type CardVariant =
  | 'default'
  | 'elevated'
  | 'glass'
  | 'interactive'
  | 'danger'
  | 'warning'
  | 'success';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      children,
      variant = 'default',
      padding = 'md',
      interactive = false,
      className = '',
      style,
      ...props
    },
    ref
  ) => {
    const getVariantStyles = (): React.CSSProperties => {
      switch (variant) {
        case 'elevated':
          return {
            background: 'var(--color-surface-elevated, #FFFFFF)',
            border: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
            boxShadow: 'var(--shadow-elevated, 0 12px 36px rgba(15, 23, 42, 0.08))',
          };
        case 'glass':
          return {
            background: 'var(--glass-surface, rgba(255, 255, 255, 0.90))',
            border: '1px solid var(--glass-border, rgba(226, 232, 240, 0.95))',
            backdropFilter: 'var(--glass-blur, blur(20px))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(20px))',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(15, 23, 42, 0.06))',
          };
        case 'interactive':
          return {
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(15, 23, 42, 0.06))',
            cursor: 'pointer',
          };
        case 'danger':
          return {
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderLeft: '4px solid var(--color-danger, #EF4444)',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(239, 68, 68, 0.08))',
          };
        case 'warning':
          return {
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderLeft: '4px solid var(--color-warning, #F59E0B)',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(245, 158, 11, 0.08))',
          };
        case 'success':
          return {
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderLeft: '4px solid var(--color-success, #10B981)',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(16, 185, 129, 0.08))',
          };
        case 'default':
        default:
          return {
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
            boxShadow: 'var(--shadow-card, 0 6px 24px rgba(15, 23, 42, 0.06))',
          };
      }
    };

    const getPaddingStyles = (): React.CSSProperties => {
      switch (padding) {
        case 'none': return { padding: 0 };
        case 'sm':   return { padding: '12px 16px' };
        case 'lg':   return { padding: '24px 28px' };
        case 'md':
        default:     return { padding: '18px 20px' };
      }
    };

    return (
      <div
        ref={ref}
        className={`alpas-card alpas-card-${variant} ${interactive || variant === 'interactive' ? 'alpas-card-interactive' : ''} ${className}`}
        style={{
          borderRadius: 'var(--radius-xl, 24px)',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
          position: 'relative',
          overflow: 'hidden',
          ...getVariantStyles(),
          ...getPaddingStyles(),
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// ── CardHeader ────────────────────────────────────────────────────────────────
export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  children,
  className = '',
  style,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={`alpas-card-header ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '14px',
        ...style,
      }}
      {...props}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
        {icon && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md, 12px)',
              background: '#E8F5E9',
              color: '#2E7D32',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {title && (
            <h3
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--color-text-primary, #1F2933)',
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </h3>
          )}
          {subtitle && (
            <p
              style={{
                margin: '2px 0 0 0',
                fontSize: '12.5px',
                color: 'var(--color-text-muted, #667085)',
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

// ── CardContent ───────────────────────────────────────────────────────────────
export function CardContent({
  children,
  className = '',
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`alpas-card-content ${className}`} style={{ minWidth: 0, ...style }} {...props}>
      {children}
    </div>
  );
}

// ── CardFooter ───────────────────────────────────────────────────────────────
export function CardFooter({
  children,
  className = '',
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`alpas-card-footer ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '16px',
        paddingTop: '12px',
        borderTop: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.6))',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
