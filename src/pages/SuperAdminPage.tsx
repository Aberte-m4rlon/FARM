/**
 * SuperAdminPage — Full system control for super_admin role.
 *
 * DATA STRATEGY:
 * - Reads profile and farm records using the signed-in browser session and RLS.
 * - The browser never receives a Supabase service-role key; cross-account admin
 *   actions must go through a separately authenticated server endpoint.
 *
 * Cross-account data and mutations are served by /api/admin/users after the
 * server verifies the caller's session and administrator role.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { adminApi } from '../lib/adminApi';
import { useToast } from '../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import {
  Users, PawPrint, ShieldAlert, ShieldCheck, RefreshCw,
  CheckCircle, Mail, Crown, UserCog, Database,
  Activity, AlertTriangle, X, LayoutDashboard,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { FormField, Select } from '../components/ui/Input';
import { FilterToolbar, FilterSearch, FilterSelect } from '../components/FilterToolbar';
import { formatDate } from '../lib/analytics';
import { type UserRole, ALL_ROLES, getRoleLabel } from '../lib/auth';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  animal_count: number;
  farm_name: string | null;
  role: UserRole;
  is_active: boolean;
  full_name: string | null;
}

type Tab = 'dashboard' | 'users' | 'system';

// ── Role badge colours ─────────────────────────────────────────────────────────
function roleBadge(role: UserRole) {
  if (role === 'super_admin') return { bg: '#EAF6ED', color: '#176B35', border: 'rgba(23,107,53,0.25)', label: 'Super Admin' };
  if (role === 'system_admin') return { bg: '#DDF0E2', color: '#238B45', border: 'rgba(35,139,69,0.25)', label: 'System Admin' };
  return { bg: '#F4FAF5', color: '#50645A', border: 'rgba(80,100,90,0.20)', label: 'Farm Manager' };
}

// ── Component ──────────────────────────────────────────────────────────────────
export function SuperAdminPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('dashboard');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [stats, setStats] = useState({
    totalUsers: 0, totalAnimals: 0,
    superAdmins: 0, sysAdmins: 0, farmManagers: 0, activeUsers: 0,
  });
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editRoleUser, setEditRoleUser] = useState<UserRow | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('farm_manager');
  const [savingRole, setSavingRole] = useState(false);

  const isSuperAdmin = role === 'super_admin';


  useEffect(() => {
    if (isSuperAdmin) loadUsers();
  }, [isSuperAdmin]);

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16, textAlign: 'center', padding: 24 }}>
        <ShieldAlert size={52} color="#EF4444" />
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Walang Pahintulot</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 360 }}>
          Kinakailangan ang pahintulot ng Super Administrator upang mabuksan ang pahinang ito.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>Bumalik sa Goat and Sheep Status (Katayuan ng Kambing at Tupa)</button>
      </div>
    );
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { users: rows } = await adminApi<{ users: UserRow[] }>('/api/admin/users');

      setUsers(rows);
      setStats({
        totalUsers: rows.length,
        totalAnimals: rows.reduce((sum, row) => sum + row.animal_count, 0),
        superAdmins: rows.filter(u => u.role === 'super_admin').length,
        sysAdmins: rows.filter(u => u.role === 'system_admin').length,
        farmManagers: rows.filter(u => u.role === 'farm_manager').length,
        activeUsers: rows.filter(u => u.is_active).length,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users.';
      console.error('[SuperAdmin] loadUsers error:', err);
      setLoadError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  };

  // ── Role change ───────────────────────────────────────────────────────────
  const handleRoleChange = async () => {
    if (!editRoleUser || !newRole) return;
    if (editRoleUser.role === 'super_admin' && newRole !== 'super_admin') {
      const superAdminCount = users.filter(u => u.role === 'super_admin').length;
      if (superAdminCount <= 1) {
        toast('Cannot remove the last Super Administrator. Promote another user first.', 'danger');
        return;
      }
    }
    if (editRoleUser.id === user?.id && newRole !== 'super_admin') {
      toast('You cannot change your own Super Admin role.', 'danger');
      return;
    }
    setSavingRole(true);
    try {
      await adminApi('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'role', userId: editRoleUser.id, role: newRole }),
      });
      toast(`Role updated to ${getRoleLabel(newRole)} for ${editRoleUser.email}.`, 'success');
      setEditRoleUser(null);
      loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update role.', 'danger');
    } finally {
      setSavingRole(false);
    }
  };

  // ── Toggle active ─────────────────────────────────────────────────────────
  const toggleActive = async (u: UserRow) => {
    if (u.id === user?.id) { toast('You cannot deactivate your own account.', 'danger'); return; }
    if (u.role === 'super_admin' && u.is_active) {
      const activeSupers = users.filter(x => x.role === 'super_admin' && x.is_active).length;
      if (activeSupers <= 1) {
        toast('Cannot deactivate the last active Super Administrator.', 'danger');
        return;
      }
    }
    try {
      await adminApi('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'active', userId: u.id, isActive: !u.is_active }),
      });
      toast(`Account ${!u.is_active ? 'activated' : 'deactivated'}.`, 'success');
      loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update account status.', 'danger');
    }
  };

  const sendReset = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast(`Password reset sent to ${email}.`, 'success');
    } catch {
      toast('Failed to send reset email.', 'danger');
    }
  };

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      u.email.toLowerCase().includes(q) ||
      (u.farm_name ?? '').toLowerCase().includes(q) ||
      (u.full_name ?? '').toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '9px 20px', borderRadius: 999, fontSize: 13, fontWeight: 700,
    cursor: 'pointer', border: 'none', whiteSpace: 'nowrap', transition: 'all 0.18s',
    background: tab === t ? '#238B45' : 'transparent',
    color: tab === t ? '#fff' : 'var(--text-secondary)',
    boxShadow: tab === t ? '0 4px 12px rgba(35,139,69,0.30)' : 'none',
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1300, margin: '0 auto', width: '100%', minWidth: 0 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>
            <Crown size={22} color="#238B45" /> Super Admin Panel (Buong Kontrol sa Sistema)
          </h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>
            Buong pamamahala at kontrol sa sistema — <strong style={{ color: 'var(--color-text-primary, #0f172a)' }}>{user?.email}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={loadUsers} loading={loading} leftIcon={<RefreshCw size={14} />}>
          I-refresh
        </Button>
      </div>

      {/* Error banner */}
      {loadError && (
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', marginBottom: 20 }}>
          <AlertTriangle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#EF4444' }}>Pumalya ang pag-load ng datos</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{loadError}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--glass-surface)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid var(--glass-border)', borderRadius: 999, padding: 5, width: 'fit-content', flexWrap: 'wrap' }}>
        {(['dashboard', 'users', 'system'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>
            {t === 'dashboard' ? 'Kalagayan ng Sistema' : t === 'users' ? 'Pamamahala ng mga User' : 'Kalagayan ng Sistema'}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {tab === 'dashboard' && (
        <>
          <div className="dashboard-stats stats-grid" style={{ marginBottom: 24 }}>
            <StatCard icon={<Users size={18} />} accentColor="green" value={loading ? '—' : stats.totalUsers} label="Kabuuang mga User" />
            <StatCard icon={<Crown size={18} />} accentColor="green" value={loading ? '—' : stats.superAdmins} label="Super Admins" />
            <StatCard icon={<ShieldCheck size={18} />} accentColor="green" value={loading ? '—' : stats.sysAdmins} label="System Admins" />
            <StatCard icon={<CheckCircle size={18} />} accentColor="green" value={loading ? '—' : stats.farmManagers} label="Farm Managers" />
            <StatCard icon={<PawPrint size={18} />} accentColor="green" value={loading ? '—' : stats.totalAnimals} label="Kabuuang Kambing at Tupa" />
          </div>

          {/* Role distribution */}
          <Card variant="glass" padding="lg" style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCog size={16} color="#238B45" /> Distribusyon ng mga Tungkulin (Roles)
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { r: 'super_admin' as UserRole, count: stats.superAdmins },
                { r: 'system_admin' as UserRole, count: stats.sysAdmins },
                { r: 'farm_manager' as UserRole, count: stats.farmManagers },
              ].map(({ r, count }) => {
                const b = roleBadge(r);
                return (
                  <div key={r} style={{ flex: '1 1 160px', padding: '16px 20px', borderRadius: 14, background: b.bg, border: `1px solid ${b.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: b.color, lineHeight: 1 }}>{loading ? '—' : count}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: b.color }}>{b.label}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Recent users */}
          <Card variant="glass" padding="none">
            <div style={{ fontWeight: 800, fontSize: 15, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-light)' }}>
              <Users size={16} color="#238B45" /> Lahat ng Nakarehistrong User
            </div>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : users.length === 0 ? (
              <EmptyState
                icon={<Users size={32} />}
                title="Walang nahanap na user"
                description="Suriin ang profiles table at RLS access. Huwag ilagay ang service-role key sa browser o sa VITE_ variable."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Email</th><th>Tungkulin</th><th>Katayuan</th><th>Bukid</th><th>Petsa ng Pagrehistro</th><th>Huling Pag-login</th></tr></thead>
                  <tbody>
                    {[...users].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(u => {
                      const b = roleBadge(u.role);
                      return (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 600, fontSize: 13 }}>{u.email}</td>
                          <td><span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 999, background: b.bg, border: `1px solid ${b.border}`, color: b.color, fontSize: 11, fontWeight: 700 }}>{b.label}</span></td>
                          <td>
                            <Badge variant={u.is_active ? 'success' : 'danger'} size="sm">
                              {u.is_active ? 'Aktibo' : 'Hindi Aktibo'}
                            </Badge>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.farm_name ?? '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.created_at ? formatDate(u.created_at) : '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'Wala pa'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── USER MANAGEMENT TAB ── */}
      {tab === 'users' && (
        <>
          <FilterToolbar rightAction={
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', fontWeight: 600 }}>{filtered.length} sa {users.length} mga user</span>
          }>
            <FilterSearch placeholder="Maghanap ng email, pangalan, bukid..." value={search} onChange={setSearch} minWidth={220} />
            <FilterSelect
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: 'all', label: 'Lahat ng Tungkulin' },
                { value: 'super_admin', label: 'Super Admin' },
                { value: 'system_admin', label: 'System Admin' },
                { value: 'farm_manager', label: 'Farm Manager' },
              ]}
              ariaLabel="Lahat ng Tungkulin"
              minWidth={170}
            />
          </FilterToolbar>

          <Card variant="glass" padding="none">
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Users size={32} />} title="Walang nahanap na user" description="Subukan ang ibang filter o search." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>User</th><th>Tungkulin</th><th>Katayuan</th><th>Bukid</th><th>Kambing at Tupa</th><th>Petsa ng Pagrehistro</th><th>Huling Pag-login</th><th>Mga Aksyon</th></tr></thead>
                  <tbody>
                    {filtered.map(u => {
                      const b = roleBadge(u.role);
                      const isMe = u.id === user?.id;
                      const isExp = expandedUser === u.id;
                      return (
                        <>
                          <tr key={u.id} style={{ cursor: 'pointer', opacity: u.is_active ? 1 : 0.55 }} onClick={() => setExpandedUser(isExp ? null : u.id)}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13 }}>{u.full_name || u.email}</div>
                                  {u.full_name && <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #475569)' }}>{u.email}</div>}
                                  {isMe && <Badge variant="primary" size="sm">Ikaw</Badge>}
                                </div>
                              </div>
                            </td>
                            <td><span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 999, background: b.bg, border: `1px solid ${b.border}`, color: b.color, fontSize: 11, fontWeight: 700 }}>{b.label}</span></td>
                            <td>
                              <Badge variant={u.is_active ? 'success' : 'danger'} size="sm">
                                {u.is_active ? 'Aktibo' : 'Hindi Aktibo'}
                              </Badge>
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.farm_name ?? '—'}</td>
                            <td style={{ textAlign: 'center', fontWeight: u.animal_count > 0 ? 700 : 400 }}>{u.animal_count}</td>
                            <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.created_at ? formatDate(u.created_at) : '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'Wala pa'}</td>
                            <td onClick={e => e.stopPropagation()}>
                              <div className="row-actions">
                                <Button variant="ghost" size="sm" title="Palitan ang role" onClick={() => { setEditRoleUser(u); setNewRole(u.role); }}>
                                  <UserCog size={13} />
                                </Button>
                                <Button variant="ghost" size="sm" title={u.is_active ? 'I-deactivate' : 'I-activate'} onClick={() => toggleActive(u)} style={{ color: u.is_active ? '#F59E0B' : '#16A34A' }}>
                                  {u.is_active ? <X size={13} /> : <CheckCircle size={13} />}
                                </Button>
                                <Button variant="ghost" size="sm" title="Magpadala ng password reset" onClick={() => sendReset(u.email)}>
                                  <Mail size={13} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExp && (
                            <tr key={`${u.id}-exp`}>
                              <td colSpan={8} style={{ background: 'var(--color-surface-elevated, rgba(255,255,255,0.03))', padding: '12px 20px' }}>
                                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                                  <span><strong>ID:</strong> <code style={{ fontSize: 11, opacity: 0.7 }}>{u.id.slice(0, 20)}…</code></span>
                                  {u.farm_name && <span><strong>Bukid:</strong> {u.farm_name}</span>}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── SYSTEM TAB ── */}
      {tab === 'system' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card variant="glass" padding="lg">
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} color="#238B45" /> Kalusugan ng Sistema (System Health)
            </div>
            {[
              { label: 'Authentication (aktibong session)', status: user ? 'May aktibong session' : 'Walang session', ok: Boolean(user) },
              { label: 'Database (profiles at talaan)', status: loading ? 'Sinusuri' : loadError ? 'May Problema' : 'Konektado', ok: loading ? null : !loadError },
              { label: 'Application (Web Client)', status: 'Maayos / Umaandar', ok: true },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: s.ok === null ? '#F59E0B' : s.ok ? '#16A34A' : '#EF4444' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />{s.status}
                </span>
              </div>
            ))}
          </Card>

          <Card variant="glass" padding="lg">
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={16} color="#238B45" /> Antas ng mga Tungkulin (Role Hierarchy)
            </div>
            {[
              { r: 'super_admin' as UserRole, desc: 'Buong access sa sistema. Namamahala sa lahat ng user, tungkulin, at mga setting ng buong platform.' },
              { r: 'system_admin' as UserRole, desc: 'Namamahala sa mga rehistradong user at sumusuri sa datos ng mga bukid sa buong sistema.' },
              { r: 'farm_manager' as UserRole, desc: 'Namamahala sa sariling bukid — mga alaga, kalusugan, breeding, at imbentaryo.' },
            ].map(({ r, desc }) => {
              const b = roleBadge(r);
              return (
                <div key={r} style={{ padding: '12px 16px', borderRadius: 12, background: b.bg, border: `1px solid ${b.border}`, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: b.color, fontSize: 13, marginBottom: 4 }}>{b.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{desc}</div>
                </div>
              );
            })}
          </Card>

          <Card variant="glass" padding="lg">
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={16} color="#238B45" /> Impormasyon ng Database
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <span><strong>User table:</strong> public.profiles</span>
              <span><strong>Kabuuang profiles:</strong> {loading ? '…' : users.length}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginTop: 12, lineHeight: 1.6 }}>
              Kailangan ang <code>SUPABASE_SERVICE_ROLE_KEY</code> sa server environment para gumana ang ligtas na
              user-management API. Mananatili ito sa server at hindi ilalagay sa browser.
            </p>
          </Card>

        </div>
      )}

      {/* ── Role change modal ── */}
      {editRoleUser && (
        <Modal open={!!editRoleUser} onClose={() => setEditRoleUser(null)} size="md">
          <ModalHeader
            title="Palitan ang Tungkulin"
            subtitle={editRoleUser.email}
            icon={<UserCog size={18} color="#238B45" />}
          />
          <ModalBody>
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Kasalukuyang Tungkulin</label>
              <div style={{ fontSize: 13, fontWeight: 700, color: roleBadge(editRoleUser.role).color }}>
                {roleBadge(editRoleUser.role).label}
              </div>
            </div>
            <FormField label="Bagong Tungkulin" required>
              <Select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)}>
                {ALL_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </FormField>
            {newRole === 'super_admin' && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#EAF6ED', border: '1px solid rgba(35,139,69,0.25)', marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary, #475569)', display: 'flex', gap: 8 }}>
                <AlertTriangle size={14} color="#238B45" style={{ flexShrink: 0, marginTop: 1 }} />
                Ang Super Admin ay may buong kontrol sa buong platform. Ipagkaloob lamang ito sa mga pinagkakatiwalaang kawani.
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setEditRoleUser(null)}>Kanselahin</Button>
            <Button variant="primary" onClick={handleRoleChange} loading={savingRole} disabled={savingRole || newRole === editRoleUser.role}>
              Kumpirmahin ang Pagbabago
            </Button>
          </ModalFooter>
        </Modal>
      )}

    </div>
  );
}
