import React from 'react';

export type LogoSize =
  | 'hero'
  | 'login'
  | 'header'
  | 'mobile-header'
  | 'sidebar'
  | 'sidebar-collapsed'
  | 'sm'
  | 'md'
  | 'lg'
  | 'custom';

export interface AlpasFarmLogoProps {
  size?: LogoSize;
  variant?: 'full' | 'emblem';
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
}

const LOGO_SRC = '/alpasfarm-logo.png';
const DEFAULT_ALT = 'ALPASFARM – Smart Livestock Management System';

export const AlpasFarmLogo: React.FC<AlpasFarmLogoProps> = ({
  size = 'md',
  variant = 'full',
  alt = DEFAULT_ALT,
  className = '',
  style = {},
  onClick,
  role,
  tabIndex,
}) => {
  // Collapsed circular emblem for narrow sidebar state (40px)
  if (variant === 'emblem' || size === 'sidebar-collapsed') {
    return (
      <div
        className={`alpas-logo-emblem-wrap ${className}`}
        onClick={onClick}
        role={role || (onClick ? 'button' : undefined)}
        tabIndex={tabIndex ?? (onClick ? 0 : undefined)}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: onClick ? 'pointer' : 'default',
          userSelect: 'none',
          ...style,
        }}
        title={alt}
      >
        <img
          src={LOGO_SRC}
          alt={alt}
          loading="eager"
          decoding="async"
          style={{
            width: 76,
            height: 'auto',
            maxWidth: 'none',
            objectFit: 'contain',
            transform: 'translateY(-2px)',
          }}
        />
      </div>
    );
  }

  // Predefined responsive classes & styles based on location
  const sizeClasses: Record<LogoSize, string> = {
    hero: 'alpas-logo-hero',
    login: 'alpas-logo-login',
    header: 'alpas-logo-header',
    'mobile-header': 'alpas-logo-mobile-header',
    sidebar: 'alpas-logo-sidebar',
    'sidebar-collapsed': 'alpas-logo-sidebar-collapsed',
    sm: 'alpas-logo-sm',
    md: 'alpas-logo-md',
    lg: 'alpas-logo-lg',
    custom: '',
  };

  return (
    <div
      className={`alpas-logo-container ${sizeClasses[size] || ''} ${className}`}
      onClick={onClick}
      role={role || (onClick ? 'button' : undefined)}
      tabIndex={tabIndex ?? (onClick ? 0 : undefined)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        lineHeight: 0,
        ...style,
      }}
      title={alt}
    >
      <span className="alpas-logo-art">
        <img
          src={LOGO_SRC}
          alt={alt}
          className="alpas-official-logo-img"
          loading="eager"
          decoding="async"
          style={{
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
        <span className="alpas-official-logo-tagline" aria-hidden="true">
          SMART LIVESTOCK MANAGEMENT
        </span>
      </span>
    </div>
  );
};

export default AlpasFarmLogo;
