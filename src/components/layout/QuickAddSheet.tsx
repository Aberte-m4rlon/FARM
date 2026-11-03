import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  PlusCircle,
  DollarSign,
  Syringe,
  Package,
  Heart,
  Camera,
  ArrowRight,
} from 'lucide-react';
import { GoatIcon } from './GoatIcon';

export interface QuickAddSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  to: string;
  color: string;
  bgColor: string;
}

export function QuickAddSheet({ isOpen, onClose }: QuickAddSheetProps) {
  const navigate = useNavigate();

  // Close sheet on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const actions: QuickAction[] = [
    {
      id: 'add-animal',
      title: 'Magdagdag ng Kambing o Tupa',
      subtitle: 'Magrehistro ng bagong kambing o tupa',
      icon: <GoatIcon size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/animals?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'record-health',
      title: 'Camera Monitoring',
      subtitle: 'Subaybayan ang pagdaan at kilalanin sa QR ang hayop',
      icon: <Camera size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/livestock-monitoring',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'record-sale',
      title: 'Magbenta ng Kambing o Tupa',
      subtitle: 'Itala ang benta ng kambing o tupa at kita',
      icon: <DollarSign size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/sales?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'add-vaccination',
      title: 'Mag-record ng Bakuna',
      subtitle: 'Itala ang naibigay o susunod na bakuna',
      icon: <Syringe size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/vaccinations?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'add-inventory',
      title: 'Magdagdag ng Stock',
      subtitle: 'Magdagdag ng gamot, bakuna, o pangunahing pangangailangan ng alaga',
      icon: <Package size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/inventory?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'record-breeding',
      title: 'Mag-record ng Breeding',
      subtitle: 'Itala ang pagtatalik o inaasahang panganganak',
      icon: <Heart size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/breeding?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
    {
      id: 'record-treatment',
      title: 'Mag-record ng Gamutan',
      subtitle: 'Itala ang gamot at treatment para sa alaga',
      icon: <PlusCircle size={22} color="#238B45" strokeWidth={2.2} />,
      to: '/treatments?action=add',
      color: '#238B45',
      bgColor: '#EAF6ED',
    },
  ];

  const handleActionClick = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <div className="bottom-sheet-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Quick Add Menu">
      <div
        className="bottom-sheet-panel quick-add-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle */}
        <div className="bottom-sheet-handle" onClick={onClose} aria-hidden="true" />

        {/* Header */}
        <div className="bottom-sheet-header">
          <div>
            <h2 className="bottom-sheet-title">Mga Mabilisang Aksyon</h2>
            <p className="bottom-sheet-subtitle">Pumili ng nais gawin o i-record sa bukid</p>
          </div>
          <button
            type="button"
            className="bottom-sheet-close-btn"
            onClick={onClose}
            aria-label="Isara ang menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Actions Grid / List */}
        <div className="quick-add-grid">
          {actions.map((act) => (
            <button
              key={act.id}
              type="button"
              className="quick-add-item"
              onClick={() => handleActionClick(act.to)}
            >
              <div
                className="quick-add-icon-box"
                style={{ backgroundColor: act.bgColor }}
              >
                {act.icon}
              </div>
              <div className="quick-add-info">
                <span className="quick-add-item-title">{act.title}</span>
                <span className="quick-add-item-sub">{act.subtitle}</span>
              </div>
              <ArrowRight size={16} className="quick-add-arrow" />
            </button>
          ))}
        </div>

        {/* Cancel Button */}
        <div className="bottom-sheet-footer">
          <button
            type="button"
            className="bottom-sheet-cancel-btn"
            onClick={onClose}
          >
            Kanselahin
          </button>
        </div>
      </div>
    </div>
  );
}
