import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, type UserRole } from './lib/auth';
import { ToastProvider, ErrorBoundary } from './components/ui';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { AnimalsPage } from './pages/AnimalsPage';
import { MortalityPage } from './pages/MortalityPage';
import { AnimalProfilePage } from './pages/AnimalProfilePage';
import { TreatmentsPage } from './pages/TreatmentsPage';
import { BreedingPage } from './pages/BreedingPage';
import { SalesPage } from './pages/SalesPage';
import { VaccinationsPage } from './pages/VaccinationsPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { DailyAlertsPage } from './pages/DailyAlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicAnimalPage } from './pages/PublicAnimalPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { ArchivedRecordsPage } from './pages/ArchivedRecordsPage';
import { AdminPage } from './pages/AdminPage';
import { MyAIPage } from './pages/MyAIPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { LivestockMonitoringPage } from './pages/LivestockMonitoringPage';
import { HealthScreeningPage } from './pages/HealthScreeningPage';
import { ShieldAlert } from 'lucide-react';

// ─── Route guards ──────────────────────────────────────────────────────────────

/**
 * Requires authentication. Unauthenticated users are redirected to /login.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Requires one of the allowed roles in addition to authentication.
 * Shows an "Access Denied" message if the role doesn't match instead of
 * silently redirecting, so the user knows why they can't access the page.
 */
function RequireRole({
  children,
  allowed,
}: {
  children: React.ReactNode;
  allowed: UserRole[];
}) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Super Admin has full permission to access all routes in the system
  if (role === 'super_admin') return <>{children}</>;

  if (!role || !allowed.includes(role)) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 16,
          textAlign: 'center',
          padding: 24,
        }}
      >
        <ShieldAlert size={52} color="#EF4444" />
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
          Access Denied
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 360 }}>
          You do not have permission to access this area. Contact the system administrator if
          you believe this is a mistake.
        </p>
        <Navigate to={
          role === 'system_admin' ? '/admin' : '/dashboard'
        } replace />
      </div>
    );
  }

  return <>{children}</>;
}

// ─── Route tree ───────────────────────────────────────────────────────────────

const ALL_FARM_ROLES: UserRole[] = ['farm_manager', 'super_admin', 'system_admin'];

function AppRoutes() {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  // Standalone public animal passport view (e.g. scanned via ear tag QR code)
  if (location.pathname.startsWith('/public/')) {
    return (
      <Routes>
        <Route path="/public/:id" element={<PublicAnimalPage />} />
      </Routes>
    );
  }

  // Public routes (no auth needed)
  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/forgot-password" element={<AuthPage />} />
        {/* Redirect unauthenticated requests to login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Authenticated routes
  return (
    <AppShell>
      <Routes>
        {/* ── Farm Management routes ── */}
        <Route path="/dashboard" element={<RequireRole allowed={ALL_FARM_ROLES}><Dashboard /></RequireRole>} />
        <Route path="/animals" element={<RequireRole allowed={ALL_FARM_ROLES}><AnimalsPage /></RequireRole>} />
        <Route path="/mortality" element={<RequireRole allowed={ALL_FARM_ROLES}><MortalityPage /></RequireRole>} />
        <Route path="/animals/:id" element={<RequireRole allowed={ALL_FARM_ROLES}><AnimalProfilePage /></RequireRole>} />
        <Route path="/treatments" element={<RequireRole allowed={ALL_FARM_ROLES}><TreatmentsPage /></RequireRole>} />
        <Route path="/health" element={<Navigate to="/treatments" replace />} />
        <Route path="/breeding" element={<RequireRole allowed={ALL_FARM_ROLES}><BreedingPage /></RequireRole>} />
        <Route path="/sales" element={<RequireRole allowed={ALL_FARM_ROLES}><SalesPage /></RequireRole>} />
        <Route path="/weights" element={<Navigate to="/animals" replace />} />
        <Route path="/vaccinations" element={<RequireRole allowed={ALL_FARM_ROLES}><VaccinationsPage /></RequireRole>} />
        <Route path="/feed" element={<Navigate to="/inventory" replace />} />
        <Route path="/inventory" element={<RequireRole allowed={ALL_FARM_ROLES}><InventoryPage /></RequireRole>} />
        <Route path="/analytics" element={<Navigate to="/reports" replace />} />
        <Route path="/reports" element={<RequireRole allowed={ALL_FARM_ROLES}><ReportsPage /></RequireRole>} />
        <Route path="/recommendations" element={<Navigate to="/myai" replace />} />
        <Route path="/daily-alerts" element={<RequireRole allowed={ALL_FARM_ROLES}><DailyAlertsPage /></RequireRole>} />
        <Route path="/notifications" element={<Navigate to="/daily-alerts" replace />} />
        <Route path="/scanner" element={<Navigate to="/livestock-monitoring" replace />} />
        <Route path="/activity-log" element={<RequireRole allowed={ALL_FARM_ROLES}><ActivityLogPage /></RequireRole>} />
        <Route path="/archived-records" element={<RequireRole allowed={ALL_FARM_ROLES}><ArchivedRecordsPage /></RequireRole>} />
        <Route path="/settings" element={<RequireRole allowed={ALL_FARM_ROLES}><SettingsPage /></RequireRole>} />
        <Route path="/myai" element={<RequireRole allowed={ALL_FARM_ROLES}><MyAIPage /></RequireRole>} />
        <Route path="/camera-screening" element={<RequireRole allowed={ALL_FARM_ROLES}><HealthScreeningPage /></RequireRole>} />
        <Route path="/health-screening" element={<RequireRole allowed={ALL_FARM_ROLES}><HealthScreeningPage /></RequireRole>} />
        <Route path="/livestock-monitoring" element={<RequireRole allowed={ALL_FARM_ROLES}><LivestockMonitoringPage /></RequireRole>} />

        {/* ── System Admin routes ── */}
        <Route path="/admin" element={<RequireRole allowed={['system_admin', 'super_admin']}><AdminPage /></RequireRole>} />

        {/* ── Super Admin routes ── */}
        <Route path="/super-admin" element={<RequireRole allowed={['super_admin']}><SuperAdminPage /></RequireRole>} />

        {/* ── Root redirect based on role ── */}
        <Route
          path="/"
          element={
            <Navigate to={
              role === 'super_admin' ? '/super-admin' :
              role === 'system_admin' ? '/admin' : '/dashboard'
            } replace />
          }
        />

        {/* ── Catch-all: redirect to role home ── */}
        <Route
          path="*"
          element={
            <Navigate to={
              role === 'super_admin' ? '/super-admin' :
              role === 'system_admin' ? '/admin' : '/dashboard'
            } replace />
          }
        />
      </Routes>
    </AppShell>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

import { NotificationProvider } from './context/NotificationContext';
import { FarmDataProvider } from './lib/useFarmData';
import { ThemeProvider } from './context/ThemeContext';
import { PwaProvider } from './context/PwaContext';
import { OfflineIndicator, UpdatePrompt } from './components/pwa';

export default function App() {
  return (
    <ErrorBoundary>
      <PwaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <NotificationProvider>
                <FarmDataProvider>
                  <BrowserRouter>
                    <OfflineIndicator />
                    <UpdatePrompt />
                    <AppRoutes />
                  </BrowserRouter>
                </FarmDataProvider>
              </NotificationProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </PwaProvider>
    </ErrorBoundary>
  );
}
