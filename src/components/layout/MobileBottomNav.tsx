import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bell,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { GoatIcon } from './GoatIcon';
import { MobileNavItem } from './MobileNavItem';
import { QuickAddSheet } from './QuickAddSheet';
import { MoreMenuSheet } from './MoreMenuSheet';

export interface MobileBottomNavProps {
  role: string | null;
  getBadge: (to: string) => number;
}

export function MobileBottomNav({ role, getBadge }: MobileBottomNavProps) {
  const location = useLocation();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Close any open sheets when route changes
  useEffect(() => {
    setQuickAddOpen(false);
    setMoreMenuOpen(false);
  }, [location.pathname]);

  const isCameraRoute = location.pathname === '/livestock-monitoring';

  // Determine active states for the 4 standard slots
  const isDashboardActive = location.pathname === '/dashboard' || location.pathname === '/' || location.pathname === '/super-admin' || location.pathname === '/admin';
  const isAnimalsActive = location.pathname.startsWith('/animals');
  const isAlertsActive = location.pathname.startsWith('/daily-alerts') || location.pathname.startsWith('/notifications') || location.pathname.startsWith('/alerts');

  // Badge for Alerts slot
  const alertBadgeCount = getBadge('/daily-alerts') || getBadge('/notifications') || getBadge('/alerts');

  // Center button click toggle
  const handleToggleQuickAdd = () => {
    setMoreMenuOpen(false);
    setQuickAddOpen((prev) => !prev);
  };

  // More menu toggle
  const handleToggleMoreMenu = () => {
    setQuickAddOpen(false);
    setMoreMenuOpen((prev) => !prev);
  };

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
        {/* 1. Kalagayan */}
        <MobileNavItem
          to="/dashboard"
          label="Kalagayan"
          icon={<LayoutDashboard size={20} strokeWidth={2.2} />}
          isActive={isDashboardActive && !quickAddOpen && !moreMenuOpen}
        />

        {/* 2. Animals */}
        <MobileNavItem
          to="/animals"
          label="Kambing at Tupa"
          icon={<GoatIcon size={20} strokeWidth={2.2} />}
          isActive={isAnimalsActive && !quickAddOpen && !moreMenuOpen}
        />

        {/* 3. Elevated Center Add Button */}
        <div className="mobile-add-btn-wrapper">
          <button
            type="button"
            className={`mobile-add-button ${quickAddOpen ? 'open' : ''}`}
            onClick={handleToggleQuickAdd}
            aria-label={quickAddOpen ? 'Close quick add menu' : 'Open quick add menu'}
            aria-expanded={quickAddOpen}
          >
            <Plus
              size={24}
              strokeWidth={2.6}
              className={`mobile-add-icon ${quickAddOpen ? 'rotate' : ''}`}
            />
          </button>
        </div>

        {/* 4. Alerts */}
        <MobileNavItem
          to="/daily-alerts"
          label="Mga Paalala"
          icon={<Bell size={20} strokeWidth={2.2} />}
          badge={alertBadgeCount}
          isActive={isAlertsActive && !quickAddOpen && !moreMenuOpen}
        />

        {/* 5. More */}
        <MobileNavItem
          label="Iba Pa"
          icon={<MoreHorizontal size={22} strokeWidth={2.4} />}
          isActive={moreMenuOpen || isCameraRoute}
          onClick={handleToggleMoreMenu}
          ariaLabel="Open more farm features menu"
        />
      </nav>

      {/* Quick-Add Bottom Sheet */}
      <QuickAddSheet
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />

      {/* More Menu Bottom Sheet */}
      <MoreMenuSheet
        isOpen={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        role={role}
        getBadge={getBadge}
      />
    </>
  );
}
