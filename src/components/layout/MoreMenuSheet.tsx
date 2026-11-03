import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { getNavItemsForRole } from './navigationConfig';

export interface MoreMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
  role: string | null;
  getBadge: (to: string) => number;
}

const PRIMARY_DESTINATIONS = new Set(['/dashboard', '/super-admin', '/animals', '/daily-alerts']);

const DESCRIPTIONS: Record<string, string> = {
  '/livestock-monitoring': 'Bilangin ang mga hayop na dumadaan sa gate',
  '/inventory': 'Gamot, bakuna, at iba pang gamit',
  '/breeding': 'Pagbubuntis at panganganak',
  '/vaccinations': 'Mga bakuna at petsa ng susunod na turok',
  '/treatments': 'Mga gamot na naibigay sa mga alaga',
  '/sales': 'Mga naibenta at kinita',
  '/reports': 'Mga buod ng tala sa bukid',
  '/myai': 'Magtanong tungkol sa bukid',
  '/activity-log': 'Mga pagbabagong ginawa sa talaan',
  '/admin': 'Mga taong may access sa bukid',
  '/settings': 'Account at detalye ng bukid',
  '/archived-records': 'Tingnan o ibalik ang mga itinagong tala',
};

export function MoreMenuSheet({ isOpen, onClose, role, getBadge }: MoreMenuSheetProps) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const menuItems = getNavItemsForRole(role).filter((item) => !PRIMARY_DESTINATIONS.has(item.to));
  const handleSelect = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <div className="bottom-sheet-overlay" onClick={onClose} role="presentation">
      <section
        className="bottom-sheet-panel more-menu-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Iba pang bahagi ng ALPASFARM"
      >
        <div className="bottom-sheet-handle" onClick={onClose} aria-hidden="true" />
        <div className="bottom-sheet-header">
          <div>
            <h2 className="bottom-sheet-title">Iba Pa</h2>
            <p className="bottom-sheet-subtitle">Mga module at setting ng bukid</p>
          </div>
          <button type="button" className="bottom-sheet-close-btn" onClick={onClose} aria-label="Isara ang menu">
            <X size={20} />
          </button>
        </div>

        <div className="more-menu-list">
          {menuItems.map((item) => {
            const badge = item.badgeKey ? getBadge(item.to) : 0;
            const isActive = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <button
                key={item.to}
                type="button"
                className={`more-menu-item ${isActive ? 'active' : ''}`}
                onClick={() => handleSelect(item.to)}
              >
                <div className="more-menu-icon-box">{item.icon}</div>
                <div className="more-menu-info">
                  <div className="more-menu-title-row">
                    <span className="more-menu-item-title">{item.label}</span>
                    {badge > 0 && <span className="more-menu-badge" aria-hidden="true">{badge}</span>}
                  </div>
                  <span className="more-menu-item-desc">{DESCRIPTIONS[item.to] ?? item.label}</span>
                </div>
                <ChevronRight size={18} className="more-menu-chevron" />
              </button>
            );
          })}
        </div>

        <div className="bottom-sheet-footer">
          <button type="button" className="bottom-sheet-cancel-btn" onClick={onClose}>Isara</button>
        </div>
      </section>
    </div>
  );
}
