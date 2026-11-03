import React from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  Bot,
  DollarSign,
  Heart,
  HeartCrack,
  HeartPulse,
  History,
  LayoutDashboard,
  Package,
  ScanLine,
  Settings as SettingsIcon,
  Syringe,
  Users,
} from 'lucide-react';
import { GoatIcon } from './GoatIcon';

export interface NavItemConfig {
  to: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: 'notifications' | 'vaccinations' | 'inventory' | 'alerts';
  roles: ('farm_manager' | 'system_admin' | 'super_admin')[];
}

const FARM_ROLES: NavItemConfig['roles'] = ['farm_manager', 'system_admin', 'super_admin'];
const ADMIN_ROLES: NavItemConfig['roles'] = ['system_admin', 'super_admin'];

/** One source of truth for the active AlpasFarm navigation modules. */
export function getNavItemsForRole(role: string | null): NavItemConfig[] {
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'system_admin' || isSuperAdmin;
  const items: NavItemConfig[] = [
    {
      to: isSuperAdmin ? '/super-admin' : '/dashboard',
      label: isSuperAdmin ? 'System Status' : 'Kalagayan',
      icon: <LayoutDashboard size={20} strokeWidth={2.2} />,
      roles: isSuperAdmin ? ['super_admin'] : FARM_ROLES,
    },
    { to: '/animals', label: 'Mga Hayop', icon: <GoatIcon size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/mortality', label: 'Mga Namatay na Hayop', icon: <HeartCrack size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/livestock-monitoring', label: 'Camera sa Gate', icon: <ScanLine size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/health-screening', label: 'Suriin ang Hayop', icon: <HeartPulse size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/inventory', label: 'Gamot at Gamit', icon: <Package size={20} strokeWidth={2.2} />, badgeKey: 'inventory', roles: FARM_ROLES },
    { to: '/breeding', label: 'Pagpaparami', icon: <Heart size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/vaccinations', label: 'Bakuna', icon: <Syringe size={20} strokeWidth={2.2} />, badgeKey: 'vaccinations', roles: FARM_ROLES },
    { to: '/treatments', label: 'Gamutan', icon: <HeartPulse size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/sales', label: 'Benta', icon: <DollarSign size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/daily-alerts', label: 'Mga Paalala', icon: <Bell size={20} strokeWidth={2.2} />, badgeKey: 'alerts', roles: FARM_ROLES },
    { to: '/reports', label: 'Mga Ulat', icon: <BarChart3 size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/myai', label: 'Katulong sa Bukid', icon: <Bot size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/activity-log', label: 'Kasaysayan', icon: <History size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
  ];

  if (isAdmin) {
    items.push({ to: '/admin', label: 'Users', icon: <Users size={20} strokeWidth={2.2} />, roles: ADMIN_ROLES });
  }

  items.push(
    { to: '/settings', label: 'Settings', icon: <SettingsIcon size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
    { to: '/archived-records', label: 'Naka-archive', icon: <Archive size={20} strokeWidth={2.2} />, roles: FARM_ROLES },
  );

  return items;
}
