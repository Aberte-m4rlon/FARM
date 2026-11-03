import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Moon,
  Sun,
  Search,
  Bell,
  Settings,
  LogOut,
  User,
  X,
  CheckCircle2,
  HeartPulse,
  Syringe,
  Heart,
  Scale,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { AlpasFarmLogo } from '../common/AlpasFarmLogo';
import { InstallButton } from '../pwa';
import { isAnimalActive } from '../../lib/animalLifecycle';
import type { Animal, InventoryItem, Vaccination, BreedingRecord, Notification } from '../../types';

export interface SearchResult {
  type: string;
  label: string;
  sub: string;
  link: string;
}

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showPageTitle?: boolean;
  onOpenMobileNav?: () => void;
  user: any;
  role: string | null;
  signOut: () => Promise<void>;
  notifications?: Notification[];
  animals?: Animal[];
  inventory?: InventoryItem[];
  vaccinations?: Vaccination[];
  breedingRecords?: BreedingRecord[];
  onRefreshData?: () => void;
}

export function AppHeader({
  title,
  subtitle,
  showPageTitle = true,
  onOpenMobileNav,
  user,
  role,
  signOut,
  animals = [],
  inventory = [],
  vaccinations = [],
  breedingRecords = [],
}: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    notifications,
    unreadCount,
    handleNotificationClick,
    markAllAsRead,
  } = useNotifications();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const searchRef       = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const profileRef      = useRef<HTMLDivElement>(null);
  const notifRef        = useRef<HTMLDivElement>(null);

  // ── Theme context ─────────────────────────────────────────────────────────
  const { darkMode, toggleTheme } = useTheme();

  // ── Search logic ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim() || (searchQuery.trim().length < 2 && !/^\d+$/.test(searchQuery.trim()))) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const q = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    const activeAnimals = animals.filter(isAnimalActive);
    const exactNumberMatches = /^\d+$/.test(q)
      ? activeAnimals.filter((animal) => String(animal.eartag_number ?? '') === String(Number(q)))
      : [];
    const matchingAnimals = exactNumberMatches.length > 0
      ? exactNumberMatches
      : activeAnimals.filter((a) => String(a.eartag_number ?? '') === q || a.name.toLowerCase().includes(q) || a.tag_id.toLowerCase().includes(q) || (a.breed ?? '').toLowerCase().includes(q));

    matchingAnimals
      .sort((a, b) => Number(String(b.eartag_number ?? '') === q) - Number(String(a.eartag_number ?? '') === q))
      .slice(0, 5)
      .forEach((a) =>
        results.push({
          type: 'Kambing at Tupa',
          label: `${a.eartag_number != null ? `Eartag ${a.eartag_number}` : ''} — ${a.name}`,
          sub: `${a.species === 'Goat' ? 'Kambing' : 'Tupa'} · ${a.breed ?? 'Walang lahi'}`,
          link: `/animals/${a.id}`,
        })
      );

    inventory
      .filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
      .slice(0, 3)
      .forEach((i) =>
        results.push({
          type: 'Gamot at Gamit',
          label: i.name,
          sub: `${i.category} · ${i.quantity} ${i.unit}`,
          link: '/inventory',
        })
      );

    vaccinations
      .filter((v) => v.vaccine_name.toLowerCase().includes(q))
      .slice(0, 3)
      .forEach((v) => {
        const animal = animals.find((a) => a.id === v.animal_id);
        results.push({
          type: 'Mga Bakuna',
          label: v.vaccine_name,
          sub: animal ? `${animal.name} · ${v.date_given}` : v.date_given,
          link: '/vaccinations',
        });
      });

    breedingRecords
      .filter((b) => b.status.toLowerCase().includes(q))
      .slice(0, 3)
      .forEach((b) => {
        const animal = animals.find((a) => a.id === b.animal_id);
        results.push({
          type: 'Breeding',
          label: animal ? animal.name : 'Breeding record',
          sub: `${b.status} · ${b.mating_date}`,
          link: '/breeding',
        });
      });

    setSearchResults(results);
    setSearchOpen(results.length > 0);
  }, [searchQuery, animals, inventory, vaccinations, breedingRecords]);

  // ── Close dropdowns on outside tap/click or Escape ────────────────────────
  useEffect(() => {
    const pointerHandler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        searchRef.current && !searchRef.current.contains(target) &&
        (!mobileSearchRef.current || !mobileSearchRef.current.contains(target))
      ) {
        setSearchOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (notifRef.current   && !notifRef.current.contains(target))   setNotifOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setProfileOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('pointerdown', pointerHandler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('pointerdown', pointerHandler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  // Menus should never stay open after navigating to another page.
  useEffect(() => {
    setSearchOpen(false);
    setProfileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    setProfileOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const getNotificationIcon = (type: string) => {
    const t = (type || '').toLowerCase();
    switch (t) {
      case 'health':
        return <HeartPulse size={16} color="#EF4444" />;
      case 'expiry':
        return <AlertTriangle size={16} color="#F59E0B" />;
      case 'vaccination':
      case 'vaccine':
        return <Syringe size={16} color="#238B45" />;
      case 'breeding':
        return <Heart size={16} color="#238B45" />;
      case 'weight':
        return <Scale size={16} color="#238B45" />;
      case 'inventory':
        return <Package size={16} color="#238B45" />;
      default:
        return <Bell size={16} color="#238B45" />;
    }
  };

  const initials  = user?.email ? user.email[0].toUpperCase() : 'F';
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const groupedResults = searchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const renderSearchDropdown = () => {
    if (!searchOpen || searchResults.length === 0) return null;
    return (
      <div className="search-dropdown">
        {Object.entries(groupedResults).map(([group, items]) => (
          <div key={group} className="search-group">
            <span className="search-group-title">{group}</span>
            {items.map((res, i) => (
              <div
                key={i}
                className="search-result-item"
                onClick={() => {
                  navigate(res.link);
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
              >
                <span className="search-res-label">{res.label}</span>
                <span className="search-res-sub">{res.sub}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="topbar-wrapper">
      <header className="topbar">
        {/* ── 1. Logo Section (Desktop Brand with Divider / Mobile Brand) ── */}
        <div className="logo-section">
          {/* Mobile Header Branding: Official ALPASFARM Logo (Compact, Vertically Centered, No hamburger menu) */}
          <div
            className="topbar-mobile-brand"
            onClick={() => navigate(role === 'super_admin' ? '/super-admin' : '/dashboard')}
            role="button"
            tabIndex={0}
            aria-label="AlpasFarm Home"
          >
            <AlpasFarmLogo size="mobile-header" />
          </div>

          {/* Desktop Header Branding: Official ALPASFARM Logo with Subtle Divider */}
          <div
            className="topbar-desktop-brand"
            onClick={() => navigate(role === 'super_admin' ? '/super-admin' : '/dashboard')}
            role="button"
            tabIndex={0}
            aria-label="AlpasFarm Home"
          >
            <AlpasFarmLogo size="header" />
          </div>
        </div>

        {/* ── 2. Page Title Section ── */}
        {showPageTitle && <div className="page-title-section">
          <h1 className="topbar-title">{title}</h1>
          {subtitle && <p className="topbar-sub">{subtitle}</p>}
        </div>}

        {/* ── 3. Search Section: Flexible Non-Clipping Search (Desktop Only) ── */}
        <div className="search-section desktop-search-only" ref={searchRef}>
          <div className="search-box">
            <Search size={17} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Maghanap ng alaga, tag ID, gamit, o record..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              aria-label="Global search"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchOpen(false);
                }}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {renderSearchDropdown()}
        </div>

        {/* ── 4. Actions Section: Theme, Notifications, Profile ── */}
        <div className="actions-section topbar-right">
        {/* Dark Mode Toggle */}
        <button
          type="button"
          className="topbar-icon-btn theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={darkMode ? 'Lumipat sa light mode' : 'Lumipat sa dark mode'}
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        {/* Notifications Dropdown */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="topbar-icon-btn notif-bell-btn"
            onClick={() => setNotifOpen((open) => !open)}
            aria-label={unreadCount > 0 ? `Mga paalala, may kailangang tingnan` : 'Mga paalala'}
            aria-haspopup="dialog"
            aria-expanded={notifOpen}
            aria-controls="notification-dropdown"
            title="Mga paalala"
          >
            <Bell size={19} />
            {unreadCount > 0 && (
              <span className="notif-badge" aria-hidden="true">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div id="notification-dropdown" className="profile-dropdown notif-dropdown" role="dialog" aria-label="Mga Paalala">
              <div className="pd-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 13.5, margin: 0, color: 'var(--color-text-primary)' }}>Mga Paalala</p>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {unreadCount > 0 ? 'May bagong paalala' : 'Walang bagong paalala'}
                  </span>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      markAllAsRead();
                    }}
                    style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, borderRadius: 8 }}
                  >
                    <CheckCircle2 size={13} />
                    I-marka bilang nabasa
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {notifications.length === 0 && (
                  <div className="search-empty" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                    Wala pang paalala.
                  </div>
                )}
                {notifications.slice(0, 10).map((n) => {
                  const isUnread = !n.read && !n.is_read;
                  return (
                    <button
                      type="button"
                      key={n.id}
                      className={`pd-item notif-dropdown-item ${isUnread ? 'notif-item-unread' : 'notif-item-read'}`}
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 3,
                        padding: '10px 14px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border-light, rgba(0,0,0,0.05))',
                        background: isUnread ? 'rgba(67, 160, 71, 0.08)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      onClick={() => {
                        handleNotificationClick(n, navigate);
                        setNotifOpen(false);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          {getNotificationIcon(n.type)}
                        </div>
                        <span
                          className={`badge badge-${
                            n.priority === 'Critical' || n.priority === 'critical'
                              ? 'red'
                              : n.priority === 'Warning' || n.priority === 'high'
                              ? 'orange'
                              : n.priority === 'Success'
                              ? 'green'
                              : 'green'
                          }`}
                          style={{ fontSize: 10, padding: '1px 6px' }}
                        >
                          {n.type}
                        </span>
                        {isUnread && (
                          <span
                            className="notif-unread-dot"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: '#238B45',
                              flexShrink: 0,
                              marginLeft: 'auto',
                            }}
                          />
                        )}
                      </div>
                      <span
                        style={{
                          fontWeight: isUnread ? 700 : 500,
                          fontSize: 12.5,
                          color: 'var(--color-text-primary, #0f172a)',
                          lineHeight: 1.3,
                        }}
                      >
                        {n.title}
                      </span>
                      {(n.description || n.message) && (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary, #667085)',
                            lineHeight: 1.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {n.description || n.message}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="pd-item"
                style={{
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 12,
                  color: 'var(--color-primary, #43A047)',
                  borderTop: '1px solid var(--border-light, rgba(0,0,0,0.06))',
                  marginTop: 2,
                  padding: '10px 14px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  navigate('/daily-alerts');
                  setNotifOpen(false);
                }}
              >
                Tingnan ang lahat ng paalala
              </button>
            </div>
          )}
        </div>

        {/* User Profile Menu */}
        <div className="profile-menu" ref={profileRef}>
          <div
            className="profile-avatar"
            onClick={() => setProfileOpen(!profileOpen)}
            role="button"
            aria-label="User profile"
            title={user?.user_metadata?.full_name || user?.email || 'User Profile'}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          {profileOpen && (
            <div className="profile-dropdown">
              <div className="pd-header">
                <p>{user?.user_metadata?.full_name || user?.email || 'User'}</p>
                <span>{role ? role.replace('_', ' ').toUpperCase() : 'FARM USER'}</span>
              </div>
              <button
                type="button"
                className="pd-item"
                onClick={() => {
                  navigate('/settings');
                  setProfileOpen(false);
                }}
              >
                <User size={16} />
                <span>Aking Profile</span>
              </button>
              <button
                type="button"
                className="pd-item"
                onClick={() => {
                  navigate('/settings');
                  setProfileOpen(false);
                }}
              >
                <Settings size={16} />
                <span>Mga Setting</span>
              </button>
              <InstallButton variant="menuitem" onSuccess={() => setProfileOpen(false)} />
              <button type="button" className="pd-item text-danger" onClick={handleSignOut}>
                <LogOut size={16} />
                <span>Mag-logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* ── Mobile Separate Global Search Bar (9999px Glass Pill) ── */}
    <div className="topbar-mobile-search" ref={mobileSearchRef}>
      <div className="search-box">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Maghanap ng alaga, tag ID, gamit, o record..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
          aria-label="Mobile global search"
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => {
              setSearchQuery('');
              setSearchResults([]);
              setSearchOpen(false);
            }}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {renderSearchDropdown()}
    </div>
  </div>
  );
}
