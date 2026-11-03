import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'danger';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

export interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// ── Toast Icon Component ──────────────────────────────────────────────────────
function ToastIcon({ type }: { type: 'success' | 'error' | 'warning' | 'info' }) {
  const bg =
    type === 'success'
      ? 'var(--color-success, #238B45)'
      : type === 'error'
      ? 'var(--color-danger, #EF4444)'
      : type === 'warning'
      ? 'var(--color-warning, #F59E0B)'
      : 'var(--color-info, #238B45)';

  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: '50%',
        flexShrink: 0,
        background: bg,
        color: '#FFFFFF',
      }}
    >
      {type === 'success' && <Check size={13} strokeWidth={3} />}
      {type === 'error' && <X size={13} strokeWidth={3} />}
      {type === 'warning' && <AlertTriangle size={13} strokeWidth={3} />}
      {type === 'info' && <Info size={13} strokeWidth={3} />}
    </span>
  );
}

// ── Single Toast Item ─────────────────────────────────────────────────────────
function ToastItem({ toast: t, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const border =
    t.type === 'success'
      ? 'rgba(35, 139, 69, 0.35)'
      : t.type === 'error'
      ? 'rgba(239, 68, 68, 0.35)'
      : t.type === 'warning'
      ? 'rgba(245, 158, 11, 0.35)'
      : 'rgba(35, 139, 69, 0.35)';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 'var(--radius-lg, 16px)',
        background: 'var(--color-surface, #FFFFFF)',
        border: `1px solid ${border}`,
        boxShadow: 'var(--shadow-lg, 0 16px 36px rgba(15, 23, 42, 0.16))',
        backdropFilter: 'var(--glass-blur, blur(16px))',
        WebkitBackdropFilter: 'var(--glass-blur, blur(16px))',
        color: 'var(--color-text-primary, #0F172A)',
        fontSize: '13.5px',
        fontWeight: 600,
        minWidth: 260,
        maxWidth: 420,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.96)',
        transition: 'all 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <ToastIcon type={t.type} />
      <span style={{ flex: 1, lineHeight: 1.4, wordBreak: 'break-word' }}>{t.message}</span>
      <button
        onClick={onRemove}
        aria-label="Close notification"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted, #94A3B8)',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
          marginTop: -1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ── Toast Provider ────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const normalizedType = type === 'danger' ? 'error' : type;
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type: normalizedType }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast]);
  const error = useCallback((msg: string) => toast(msg, 'error'), [toast]);
  const warning = useCallback((msg: string) => toast(msg, 'warning'), [toast]);
  const info = useCallback((msg: string) => toast(msg, 'info'), [toast]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 'min(400px, calc(100vw - 32px))',
          width: 'max-content',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export type ToastHook = ((message: string, type?: ToastType) => void) & ToastContextValue;

export function useToast(): ToastHook {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    const fallbackFn = ((msg: string, type?: ToastType) => {
      console.warn('[Toast]', type, msg);
    }) as ToastHook;
    fallbackFn.toast = (msg: string, type?: ToastType) => console.warn('[Toast]', type, msg);
    fallbackFn.success = (msg: string) => console.warn('[Toast success]', msg);
    fallbackFn.error = (msg: string) => console.warn('[Toast error]', msg);
    fallbackFn.warning = (msg: string) => console.warn('[Toast warning]', msg);
    fallbackFn.info = (msg: string) => console.warn('[Toast info]', msg);
    return fallbackFn;
  }

  const fn = ((message: string, type?: ToastType) => {
    ctx.toast(message, type);
  }) as ToastHook;

  fn.toast = ctx.toast;
  fn.success = ctx.success;
  fn.error = ctx.error;
  fn.warning = ctx.warning;
  fn.info = ctx.info;

  return fn;
}
