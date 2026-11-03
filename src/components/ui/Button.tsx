import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'warning'
  | 'icon'
  | 'floating';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = '',
      style,
      type = 'button',
      ...props
    },
    ref
  ) => {
    // ── Variant style mappings ──
    const getVariantStyles = (): React.CSSProperties => {
      switch (variant) {
        case 'primary':
          return {
            background: 'var(--alpafarm-primary-button)',
            color: '#FFFFFF',
            border: 'none',
            boxShadow: '0 3px 8px rgba(45, 91, 64, 0.16)',
          };
        case 'secondary':
          return {
            background: 'var(--alpafarm-surface)',
            color: 'var(--alpafarm-primary-strong)',
            border: '1px solid var(--alpafarm-border-strong)',
          };
        case 'outline':
          return {
            background: 'transparent',
            color: 'var(--alpafarm-primary-strong)',
            border: '1px solid var(--alpafarm-border-strong)',
          };
        case 'ghost':
          return {
            background: 'var(--alpafarm-primary-soft)',
            color: 'var(--alpafarm-primary-strong)',
            border: 'none',
          };
        case 'danger':
          return {
            background: 'var(--alpafarm-danger-button)',
            color: '#FFFFFF',
            border: 'none',
            boxShadow: 'none',
          };
        case 'success':
          return {
            background: 'var(--alpafarm-success-button)',
            color: '#FFFFFF',
            border: 'none',
            boxShadow: 'none',
          };
        case 'warning':
          return {
            background: 'var(--alpafarm-warning-button)',
            color: '#FFFFFF',
            border: 'none',
            boxShadow: 'none',
          };
        case 'icon':
          return {
            background: 'var(--alpafarm-surface)',
            color: 'var(--alpafarm-primary-strong)',
            border: '1px solid var(--alpafarm-border)',
          };
        case 'floating':
          return {
            background: 'var(--alpafarm-primary-button)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '50%',
            boxShadow: 'var(--shadow-floating)',
            padding: 0,
          };
        default:
          return {};
      }
    };

    // ── Size style mappings ──
    const getSizeStyles = (): React.CSSProperties => {
      if (variant === 'icon' || variant === 'floating') {
        switch (size) {
          case 'sm': return { width: 34, height: 34, minWidth: 34, minHeight: 34 };
          case 'lg': return { width: 48, height: 48, minWidth: 48, minHeight: 48 };
          case 'md':
          default:   return { width: 40, height: 40, minWidth: 40, minHeight: 40 };
        }
      }

      switch (size) {
        case 'sm':
          return {
            padding: '6px 14px',
            fontSize: '12px',
            borderRadius: 'var(--radius-sm, 10px)',
            minHeight: '34px',
          };
        case 'lg':
          return {
            padding: '12px 24px',
            fontSize: '15px',
            borderRadius: 'var(--radius-md, 14px)',
            minHeight: '48px',
          };
        case 'md':
        default:
          return {
            padding: '9px 18px',
            fontSize: '13.5px',
            borderRadius: 'var(--radius-md, 14px)',
            minHeight: '40px',
          };
      }
    };

    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`alpas-btn alpas-btn-${variant} alpas-btn-${size} ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.6 : 1,
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          outline: 'none',
          userSelect: 'none',
          width: fullWidth ? '100%' : undefined,
          ...getVariantStyles(),
          ...getSizeStyles(),
          ...style,
        }}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
            {children && <span>{children}</span>}
          </>
        ) : (
          <>
            {leftIcon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{leftIcon}</span>}
            {children && <span>{children}</span>}
            {rightIcon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
