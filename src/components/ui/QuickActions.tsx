import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

export interface QuickActionItem {
  label: string;
  onClick?: () => void;
  to?: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'accent' | 'default';
  disabled?: boolean;
}

export interface QuickActionsProps {
  actions?: QuickActionItem[];
  children?: ReactNode;
  className?: string;
}

/**
 * Reusable Responsive QuickActions Component
 * - Desktop: Compact flex-wrap or multi-column grid depending on space
 * - Mobile: Exact TWO-COLUMN GRID with no overflow and text truncation
 */
export function QuickActions({ actions, children, className = '' }: QuickActionsProps) {
  const navigate = useNavigate();

  if (children) {
    return (
      <div className={`quick-actions quick-actions-grid-container ${className}`}>
        {children}
      </div>
    );
  }

  if (!actions || actions.length === 0) return null;

  return (
    <div className={`quick-actions quick-actions-grid-container ${className}`} role="toolbar" aria-label="Quick Actions">
      {actions.map((action, index) => {
        const handleClick = () => {
          if (action.disabled) return;
          if (action.onClick) {
            action.onClick();
          } else if (action.to) {
            navigate(action.to);
          }
        };

        const isPrimary = action.variant === 'primary' || action.variant === 'accent';

        return (
          <button
            key={`${action.label}-${index}`}
            type="button"
            onClick={handleClick}
            disabled={action.disabled}
            className={`quick-action-btn ${isPrimary ? 'quick-action-btn-primary' : ''}`}
            title={action.label}
          >
            <span className="qa-icon-wrapper">
              {action.icon ?? <Plus size={14} className="qa-plus-icon" />}
            </span>
            <span className="qa-btn-label">
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
