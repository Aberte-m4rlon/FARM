import { useEffect, Children, isValidElement, type ReactNode, type HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnEsc?: boolean;
  closeOnOverlayClick?: boolean;
  className?: string;
  role?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

// ── Body Scroll Lock & Modal State Tracking (Ref-counted for nested modals) ─
let openModalCount = 0;
let prevBodyOverflow = '';
let prevBodyPaddingRight = '';

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (openModalCount === 0) {
      prevBodyOverflow = document.body.style.overflow;
      prevBodyPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = 'hidden';
      document.body.classList.add('modal-open');
      document.body.setAttribute('data-modal-open', 'true');

      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }
    openModalCount++;

    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = prevBodyOverflow;
        document.body.style.paddingRight = prevBodyPaddingRight;
        document.body.classList.remove('modal-open');
        document.body.removeAttribute('data-modal-open');
      }
    };
  }, [active]);
}

// ── Main Modal Component ──────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  closeOnEsc = true,
  closeOnOverlayClick = true,
  className = '',
}: ModalProps) {
  useScrollLock(open);

  // Keyboard Escape Handler
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  const getMaxWidth = (): string => {
    switch (size) {
      case 'sm': return '420px';
      case 'lg': return '720px';
      case 'xl': return '900px';
      case 'full': return '96vw';
      case 'md':
      default:   return '560px';
    }
  };

  // Inspect children to determine if caller already provided compound elements
  const hasCompoundContent = Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    const type = child.type as any;
    return (
      type === ModalHeader ||
      type === ModalBody ||
      type === ModalFooter ||
      type?.name === 'ModalHeader' ||
      type?.name === 'ModalBody' ||
      type?.name === 'ModalFooter' ||
      (child.props && typeof child.props === 'object' && (
        (child.props as any).className?.includes('alpas-modal-body') ||
        (child.props as any).className?.includes('alpas-modal-header')
      ))
    );
  });

  return (
    <div
      className="alpas-modal-overlay"
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(6, 18, 32, 0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(8px, env(safe-area-inset-top, 8px)) max(8px, env(safe-area-inset-right, 8px)) max(8px, env(safe-area-inset-bottom, 8px)) max(8px, env(safe-area-inset-left, 8px))',
        animation: 'fadeIn 0.2s ease-out',
        boxSizing: 'border-box',
      }}
    >
      <div
        className={`alpas-modal alpas-modal-${size} ${className}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: getMaxWidth(),
          maxHeight: 'min(92dvh, calc(100dvh - 24px))',
          background: 'var(--color-surface, #FFFFFF)',
          border: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
          borderRadius: 'clamp(16px, 3.5vw, 24px)',
          boxShadow: 'var(--shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.25))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* If title or subtitle prop is supplied, render standard props-driven layout */}
        {(title || subtitle) ? (
          <>
            <ModalHeader onClose={onClose} subtitle={subtitle}>
              {title}
            </ModalHeader>
            <ModalBody>{children}</ModalBody>
            {footer && <ModalFooter>{footer}</ModalFooter>}
          </>
        ) : hasCompoundContent ? (
          /* Compound components already contain ModalHeader, ModalBody, ModalFooter as direct flex children */
          children
        ) : (
          /* Simple children without title/compound headers */
          <>
            <ModalBody>{children}</ModalBody>
            {footer && <ModalFooter>{footer}</ModalFooter>}
          </>
        )}
      </div>
    </div>
  );
}

// ── ModalHeader ───────────────────────────────────────────────────────────────
export interface ModalHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  children,
  onClose,
  className = '',
  style,
  ...props
}: ModalHeaderProps) {
  const displayTitle = title ?? children;

  return (
    <div
      className={`alpas-modal-header ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.8))',
        position: 'sticky',
        top: 0,
        background: 'var(--color-surface, #FFFFFF)',
        flexShrink: 0,
        zIndex: 20,
        ...style,
      }}
      {...props}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, paddingRight: 10 }}>
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-sm, 10px)',
              background: 'var(--alpafarm-primary-soft)',
              color: 'var(--alpafarm-primary-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--color-text-primary, #1F2933)',
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
            }}
          >
            {displayTitle}
          </h3>
          {subtitle && (
            <p
              style={{
                margin: '2px 0 0 0',
                fontSize: '12px',
                color: 'var(--color-text-muted, #667085)',
                lineHeight: 1.35,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Isara"
          style={{
            minWidth: 36,
            minHeight: 36,
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-sm, 10px)',
            background: 'var(--color-surface, rgba(148, 163, 184, 0.12))',
            border: 'none',
            color: 'var(--color-text-secondary, #475569)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

// ── ModalBody ─────────────────────────────────────────────────────────────────
export function ModalBody({
  children,
  className = '',
  style,
  onFocusCapture,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  // Mobile virtual keyboard auto-centering
  const handleFocusCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    onFocusCapture?.(e);
    const target = e.target as HTMLElement;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      setTimeout(() => {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }, 300);
    }
  };

  return (
    <div
      className={`alpas-modal-body ${className}`}
      onFocusCapture={handleFocusCapture}
      style={{
        padding: '16px 18px max(28px, env(safe-area-inset-bottom, 28px))',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        overscrollBehavior: 'contain',
        flex: '1 1 auto',
        minHeight: 0,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

// ── ModalFooter ───────────────────────────────────────────────────────────────
export function ModalFooter({
  children,
  className = '',
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`alpas-modal-footer ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
        padding: '12px 18px max(14px, env(safe-area-inset-bottom, 14px))',
        borderTop: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.8))',
        background: 'var(--color-surface, #FFFFFF)',
        flexShrink: 0,
        position: 'sticky',
        bottom: 0,
        zIndex: 20,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Reusable Confirm Dialog ───────────────────────────────────────────────────
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'primary';
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Kumpirmahin',
  cancelLabel = 'Huwag Muna',
  onConfirm,
  onCancel,
  variant,
  danger,
  loading = false,
}: ConfirmDialogProps) {
  const effectiveVariant = danger ? 'danger' : (variant ?? 'danger');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={effectiveVariant}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-secondary, #475569)' }}>
        {message}
      </div>
    </Modal>
  );
}
