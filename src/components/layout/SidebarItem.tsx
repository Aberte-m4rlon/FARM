import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export interface SidebarItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  compact?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function SidebarItem({
  to,
  label,
  icon,
  badge = 0,
  compact = false,
  onClick,
  style,
}: SidebarItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `alpas-nav-item ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}`
      }
      style={style}
      aria-label={badge > 0 ? `${label}, may kailangang tingnan` : label}
    >
      {/* Center Icon with optional notification badge */}
      <span className="alpas-nav-icon">
        {icon}
        {badge > 0 && (
          <span className="alpas-nav-badge alpas-nav-badge-collapsed" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>

      {/* Label (visible in mobile drawer, hidden in desktop pill navbar) */}
      <span className="alpas-nav-label">
        {label}
      </span>

      {/* Right Notification Badge (expanded state in mobile drawer) */}
      {badge > 0 && (
        <span className="alpas-nav-badge-expanded" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      {/* Floating Glass Tooltip on Hover */}
      <span className="alpas-nav-tooltip" role="tooltip">
        {label}
      </span>
    </NavLink>
  );
}
