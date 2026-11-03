import { useEffect } from 'react';
import { AppSidebar } from './AppSidebar';

export interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  role: string | null;
  getBadge: (to: string) => number;
  onOpenAICloud?: () => void;
}

export function MobileSidebar({ open, onClose, role, getBadge, onOpenAICloud }: MobileSidebarProps) {
  // Lock scroll when mobile drawer is open
  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // Esc key listener
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`sidebar-overlay ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <AppSidebar
        role={role}
        getBadge={getBadge}
        open={open}
        onClose={onClose}
        isMobile={true}
        onOpenAICloud={() => {
          onClose();
          if (onOpenAICloud) onOpenAICloud();
          else window.dispatchEvent(new CustomEvent('alpas:open-ai-cloud'));
        }}
      />
    </>
  );
}
