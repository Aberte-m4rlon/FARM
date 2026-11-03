import { type ReactNode, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useFarmData } from '../../lib/useFarmData';
import { isAnimalActive } from '../../lib/animalLifecycle';
import { useNotifications } from '../../context/NotificationContext';
import { AppSidebar } from './AppSidebar';
import { MobileSidebar } from './MobileSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { AppHeader } from './AppHeader';
import { FloatingAICloud } from '../FloatingAICloud';
import { BreedingDueAlertCenter } from '../domain/breeding/BreedingDueAlertCenter';

export const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/dashboard':        { title: 'Kalagayan ng Bukid', subtitle: 'Tingnan ang mga kailangang asikasuhin para sa mga alaga.' },
  '/animals':          { title: 'Kambing at Tupa',      subtitle: 'Pamamahala ng mga kambing at tupa sa bukid' },
  '/mortality':        { title: 'Mga Namatay na Hayop', subtitle: 'Kasaysayan ng mga kambing at tupang namatay.' },
  '/treatments':       { title: 'Mga Gamutan', subtitle: 'Mga naitalang gamot para sa bawat alaga.' },
  '/breeding':         { title: 'Pagpaparami', subtitle: 'Pagbubuntis at panganganak ng kambing at tupa.' },
  '/sales':            { title: 'Benta ng Kambing at Tupa', subtitle: 'Pamamahala sa pagbebenta ng kambing at tupa at kita' },
  '/vaccinations':     { title: 'Mga Bakuna',           subtitle: 'Iskedyul ng bakuna at mga paalala' },
  '/inventory':        { title: 'Gamot at Gamit', subtitle: 'Tingnan ang natitirang gamot at gamit sa bukid.' },
  '/reports':          { title: 'Mga Ulat',             subtitle: 'Mga ulat sa kalusugan, bakuna, at bukid' },
  '/daily-alerts':     { title: 'Mga Paalala',          subtitle: 'Mga alerto at paalala sa bukid' },
  '/activity-log':     { title: 'Kasaysayan ng Bukid', subtitle: 'Mga pagbabagong ginawa sa talaan ng bukid.' },
  '/archived-records': { title: 'Mga Naka-archive', subtitle: 'Tingnan o ibalik ang mga itinagong tala.' },
  '/myai':             { title: 'Katulong sa Bukid', subtitle: 'Magtanong tungkol sa mga tala ng bukid.' },
  '/livestock-monitoring': { title: 'Camera sa Gate', subtitle: 'Bilang at pagdaan ng mga hayop.' },
  '/health-screening': { title: 'Suriin ang Hayop', subtitle: 'Tingnan ang mga nakikitang senyales sa kambing o tupa.' },
  '/admin':            { title: 'Mga Miyembro', subtitle: 'Pamahalaan ang mga taong may access sa bukid.' },
  '/super-admin':      { title: 'Super Admin',          subtitle: 'Pangkalahatang kontrol sa system' },
  '/settings':         { title: 'Mga Setting',          subtitle: 'Mga setting at detalye ng bukid' },
};

const PAGES_WITH_OWN_HEADING = new Set([
  '/dashboard', '/animals', '/treatments', '/breeding', '/sales', '/vaccinations',
  '/inventory', '/reports', '/daily-alerts', '/activity-log', '/archived-records',
  '/livestock-monitoring', '/health-screening', '/admin', '/super-admin', '/settings',
]);

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, role, signOut } = useAuth();
  const location = useLocation();
  const farmData = useFarmData();
  const { notifications, unreadCount, refresh: refreshNotifications } = useNotifications();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const isFarmManager = role === 'farm_manager' || (role !== 'system_admin' && role !== 'super_admin');

  const pathKey = Object.keys(PAGE_TITLES).find((k) => location.pathname.startsWith(k)) ?? '/dashboard';
  const pageTitle = PAGE_TITLES[pathKey] ?? { title: 'AlpasFarm', subtitle: '' };
  const pageOwnsTitle = PAGES_WITH_OWN_HEADING.has(pathKey) && !(pathKey === '/animals' && location.pathname !== '/animals');

  // ── Badges ──────────────────────────────────────────────────────────────────
  const unreadNotifs = unreadCount;
  const overdueVacc  = farmData.animals.filter((a) => a.vaccination_status === 'Overdue' && isAnimalActive(a)).length;
  const lowStock     = farmData.inventory.filter((i) => Number(i.quantity) <= Number(i.minimum_stock)).length;

  function getBadge(to: string): number {
    if (to === '/notifications' || to === '/daily-alerts' || to === '/alerts') return unreadNotifs;
    if (to === '/vaccinations')  return overdueVacc;
    if (to === '/inventory')     return lowStock;
    return 0;
  }

  const handleCombinedRefresh = () => {
    farmData.refresh();
    refreshNotifications();
  };

  return (
    <div className="app-layout">
      {/* Desktop Sidebar */}
      <AppSidebar role={role} getBadge={getBadge} user={user} signOut={signOut} />

      {/* Mobile Drawer Sidebar */}
      <MobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        role={role}
        getBadge={getBadge}
      />

      {/* Main Area */}
      <div className="main-area">
        <AppHeader
          title={pageTitle.title}
          subtitle={pageTitle.subtitle}
          showPageTitle={!pageOwnsTitle}
          onOpenMobileNav={() => setMobileSidebarOpen(true)}
          user={user}
          role={role}
          signOut={signOut}
          notifications={notifications}
          animals={farmData.animals}
          inventory={farmData.inventory}
          vaccinations={farmData.vaccinations}
          breedingRecords={farmData.breedingRecords}
          onRefreshData={handleCombinedRefresh}
        />

        <main className="content">{children}</main>
      </div>

      {/* Hide the floating assistant on camera monitoring so it does not cover the live preview. */}
      {location.pathname !== '/livestock-monitoring' && <FloatingAICloud />}

      {/* Mobile Fixed Bottom Navigation (<= 768px) */}
      <MobileBottomNav role={role} getBadge={getBadge} />

      {/* Database-backed birth reminders stay available across authenticated pages. */}
      <BreedingDueAlertCenter />
    </div>
  );
}
