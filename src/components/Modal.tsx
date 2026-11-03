import { type ReactNode, useEffect, useRef } from 'react';
import { Icons } from '../lib/icons';

// ── Types ─────────────────────────────────────────────────────────────────────
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

// ── Body scroll lock (Ref-counted for nested modals) ──────────────────────────
let openLegacyModalCount = 0;
let prevLegacyBodyOverflow = '';

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (openLegacyModalCount === 0) {
      prevLegacyBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('modal-open');
    }
    openLegacyModalCount++;

    return () => {
      openLegacyModalCount = Math.max(0, openLegacyModalCount - 1);
      if (openLegacyModalCount === 0) {
        document.body.style.overflow = prevLegacyBodyOverflow;
        document.body.classList.remove('modal-open');
      }
    };
  }, [active]);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useScrollLock(open);

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = `modal-${size}`;   // modal-sm / modal-md / modal-lg / modal-xl

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className={`modal ${sizeClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icons.X size={16} />
          </button>
        </div>

        {/* ── Body (scrolls) ── */}
        <div className="modal-body">
          {children}
        </div>

        {/* ── Footer ── */}
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger = true,
}: ConfirmDialogProps) {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="confirm-title">{title}</h3>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            <Icons.X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
