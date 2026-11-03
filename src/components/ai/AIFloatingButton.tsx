import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Bot, Sparkles } from 'lucide-react';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export const CORNER_KEY = 'alpasfarm_ai_corner';
const DRAG_THRESH = 8;
const BTN_SIZE = 48;
const BTN_SIZE_M = 44;
const MARGIN = 16;

export function loadCorner(): Corner {
  try {
    const v = localStorage.getItem(CORNER_KEY);
    if (v === 'tl' || v === 'tr' || v === 'bl' || v === 'br') return v;
  } catch {
    /* ignore */
  }
  return 'br';
}

export function storeCorner(c: Corner) {
  try {
    localStorage.setItem(CORNER_KEY, c);
  } catch {
    /* ignore */
  }
}

export function snapCorner(cx: number, cy: number): Corner {
  const mx = window.innerWidth / 2;
  const my = window.innerHeight / 2;
  if (cx < mx && cy < my) return 'tl';
  if (cx >= mx && cy < my) return 'tr';
  if (cx < mx && cy >= my) return 'bl';
  return 'br';
}

export interface AIFloatingButtonProps {
  isOpen: boolean;
  onToggle: () => void;
  statusDotColor?: string;
  icon?: ReactNode;
  badgeCount?: number;
}

export function AIFloatingButton({
  isOpen,
  onToggle,
  statusDotColor = '#43A047',
  icon,
  badgeCount,
}: AIFloatingButtonProps) {
  const [corner, setCorner] = useState<Corner>('br');
  const [mounted, setMounted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null);

  const didMove = useRef(false);
  const startPt = useRef({ px: 0, py: 0 });

  useEffect(() => {
    setCorner(loadCorner());
    setMounted(true);
  }, []);

  const size = typeof window !== 'undefined' && window.innerWidth <= 500 ? BTN_SIZE_M : BTN_SIZE;

  // ── Drag physics ──
  const onPointerDown = useCallback((clientX: number, clientY: number) => {
    didMove.current = false;
    startPt.current = { px: clientX, py: clientY };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const cx = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const dx = cx - startPt.current.px;
      const dy = cy - startPt.current.py;

      if (!didMove.current && Math.hypot(dx, dy) > DRAG_THRESH) {
        didMove.current = true;
        setDragging(true);
      }
      if (didMove.current) {
        setLivePos({
          x: Math.max(MARGIN, Math.min(window.innerWidth - size - MARGIN, cx - size / 2)),
          y: Math.max(MARGIN, Math.min(window.innerHeight - size - MARGIN, cy - size / 2)),
        });
      }
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);

      if (didMove.current) {
        const cx = 'changedTouches' in e ? (e as TouchEvent).changedTouches[0].clientX : (e as MouseEvent).clientX;
        const cy = 'changedTouches' in e ? (e as TouchEvent).changedTouches[0].clientY : (e as MouseEvent).clientY;
        const c = snapCorner(cx, cy);
        setCorner(c);
        storeCorner(c);
        setLivePos(null);
        setDragging(false);
      }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
  }, [size]);

  // Check if any modal is currently open in DOM to prevent overlap
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const checkModal = () => {
      const isModal =
        document.body.classList.contains('modal-open') ||
        document.body.getAttribute('data-modal-open') === 'true' ||
        Boolean(document.querySelector('.alpas-modal-overlay'));
      setModalOpen(isModal);
    };

    checkModal();
    const observer = new MutationObserver(checkModal);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-modal-open'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  if (!mounted || modalOpen) return null;

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const bottomOffset = isMobile ? 90 : MARGIN;

  // Compute position styles
  const getPositionStyles = (): React.CSSProperties => {
    if (livePos) {
      return {
        position: 'fixed',
        left: livePos.x,
        top: livePos.y,
        width: size,
        height: size,
        zIndex: 9999,
      };
    }

    const base: React.CSSProperties = {
      position: 'fixed',
      width: size,
      height: size,
      zIndex: 9999,
      transition: dragging ? 'none' : 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
    };

    switch (corner) {
      case 'tl': return { ...base, left: MARGIN, top: MARGIN };
      case 'tr': return { ...base, right: MARGIN, top: MARGIN };
      case 'bl': return { ...base, left: MARGIN, bottom: bottomOffset };
      case 'br': return { ...base, right: MARGIN, bottom: bottomOffset };
    }
  };

  return (
    <div
      className="alpas-floating-ai-btn"
      data-ai-launcher="true"
      data-ai-floating-btn="true"
      style={getPositionStyles()}
    >
      <button
        type="button"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          onPointerDown(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
        }}
        onClick={() => {
          if (!didMove.current) onToggle();
        }}
        aria-label="Toggle AI Farm Assistant"
        title="AlpasFarm AI Assistant"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: 'none',
          cursor: dragging ? 'grabbing' : 'pointer',
          background: 'var(--ai-gradient, linear-gradient(135deg, #43A047 0%, #42A5F5 100%))',
          boxShadow: isOpen
            ? '0 0 0 3px rgba(67, 160, 71, 0.4), 0 12px 32px rgba(67, 160, 71, 0.4)'
            : '0 12px 32px rgba(67, 160, 71, 0.35)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
          transform: dragging ? 'scale(1.1)' : 'scale(1)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
        }}
      >
        {icon || <Bot size={22} />}

        {/* Live Status Indicator Dot */}
        <span
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: statusDotColor,
            border: '2px solid #FFFFFF',
          }}
        />

        {/* Unread / Attention Badge */}
        {Boolean(badgeCount && badgeCount > 0) && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              background: 'var(--color-danger, #EF4444)',
              color: '#FFFFFF',
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 5px',
              borderRadius: '999px',
              lineHeight: 1,
              border: '2px solid #FFFFFF',
            }}
          >
            {badgeCount}
          </span>
        )}
      </button>
    </div>
  );
}
