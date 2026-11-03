import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { Users, PawPrint, ShieldAlert, RefreshCw, UserMinus, UserRoundCheck, BarChart3, CheckCircle, Mail, ChevronDown, ChevronRight, Syringe, AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/Modal';
import { FilterToolbar, FilterSearch } from '../components/FilterToolbar';
import { formatDate } from '../lib/analytics';
import { type UserRole } from '../lib/auth';
import { adminApi } from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import { isAnimalActive } from '../lib/animalLifecycle';

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  animal_count: number;
  farm_name: string | null;
  role: UserRole;
  is_active: boolean;
}

interface FarmDetail {
  animals: any[];
  weightRecords: any[];
  vaccinations: any[];
  settings: any | null;
}

export function AdminPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ totalUsers: 0, totalAnimals: 0, activeFarms: 0 });
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [farmDetails, setFarmDetails] = useState<Record<string, FarmDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const isAdmin = role === 'system_admin' || role === 'super_admin';
  const canManageAccounts = role === 'super_admin';

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const loadUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { users: rows } = await adminApi<{ users: UserRow[] }>('/api/admin/users');

      setUsers(rows);
      setStats({
        totalUsers: rows.length,
        totalAnimals: rows.reduce((sum, row) => sum + row.animal_count, 0),
        activeFarms: rows.filter(u => u.animal_count > 0).length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hindi ma-load ang mga user.';
      setLoadError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const toggleAccountStatus = async () => {
    if (!confirmDeactivate) return;
    try {
      await adminApi('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'active', userId: confirmDeactivate.id, isActive: !confirmDeactivate.is_active }),
      });
      toast(`Na${confirmDeactivate.is_active ? '-deactivate' : '-activate'} ang account ni ${confirmDeactivate.email}. Nananatili ang farm records.`, 'success');
      setConfirmDeactivate(null);
      loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete user.', 'danger');
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast(`Password reset email sent to ${email}.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send reset email.', 'danger');
    }
  };

  const toggleFarmDetail = async (userId: string) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (farmDetails[userId]) return; // already loaded
    setLoadingDetail(userId);
    try {
      const details = await adminApi<FarmDetail>(`/api/admin/users?userId=${encodeURIComponent(userId)}`);
      setFarmDetails(prev => ({ ...prev, [userId]: details }));
    } catch (err) {
      toast('Failed to load farm details.', 'danger');
    } finally {
      setLoadingDetail(null);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <ShieldAlert size={48} color="#EF4444" />
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Walang Pahintulot</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Wala kang pahintulot bilang administrator upang ma-access ang pahinang ito.</p>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>Bumalik sa Goat and Sheep Status (Katayuan ng Kambing at Tupa)</button>
      </div>
    );
  }

  const filtered = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.farm_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Role badge helper
  const roleBadgeStyle = (r: UserRole) => {
    if (r === 'super_admin') return { bg: '#EAF6ED', color: '#176B35', label: 'Super Admin' };
    if (r === 'system_admin') return { bg: '#DDF0E2', color: '#238B45', label: 'System Admin' };
    return { bg: '#F4FAF5', color: '#50645A', label: 'Farm Manager' };
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={22} color="#238B45" /> Admin Panel (Pamamahala ng mga User)
          </h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>
            Pamahalaan ang mga nakarehistrong user — naka-login bilang <strong>{user?.email}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={loadUsers} loading={loading} leftIcon={<RefreshCw size={15} />}>
          I-refresh
        </Button>
      </div>

      {/* Error banner */}
      {loadError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', marginBottom: 16 }}>
          <AlertTriangle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#EF4444', marginBottom: 2 }}>Pumalya ang pag-load ng mga user</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{loadError}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #475569)', marginTop: 4 }}>
              Suriin ang Supabase URL, anon key, at RLS access para sa account na ito. Huwag maglagay ng service-role key sa browser.
            </div>
          </div>
        </div>
      )}

      {/* Stats — 3 Columns across */}
      <div className="mobile-stats-grid-3" style={{ marginBottom: 20 }}>
        <StatCard
          icon={<Users size={20} />}
          accentColor="green"
          value={stats.totalUsers}
          label="Mga User"
          subtext="Nakarehistrong account"
        />
        <StatCard
          icon={<PawPrint size={20} />}
          accentColor="green"
          value={stats.totalAnimals}
          label="Kambing at Tupa"
          subtext="Sa lahat ng bukid"
        />
        <StatCard
          icon={<CheckCircle size={20} />}
          accentColor="green"
          value={stats.activeFarms}
          label="Aktibong Bukid"
          subtext="May nakatalang alaga"
        />
      </div>

      {/* Search Filter Toolbar */}
      <FilterToolbar
        rightAction={
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', fontWeight: 600 }}>
            {filtered.length} sa {users.length} mga user
          </span>
        }
      >
        <FilterSearch
          placeholder="Maghanap ng email o bukid..."
          value={search}
          onChange={setSearch}
          minWidth={260}
        />
      </FilterToolbar>

      {/* Table */}
      <Card variant="glass" padding="none">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={32} />}
            title="Walang nahanap na user"
            description={search ? 'Subukang maghanap ng ibang termino.' : 'Wala pang mga nakarehistrong user.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Tungkulin</th>
                  <th>Pangalan ng Bukid</th>
                  <th style={{ textAlign: 'center' }}>Kambing at Tupa</th>
                  <th>Petsa ng Pagrehistro</th>
                  <th>Huling Pag-login</th>
                  <th>Mga Aksyon</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const isMe = u.email === user?.email;
                  const isExpanded = expandedUser === u.id;
                  const detail = farmDetails[u.id];
                  const animalName = (id: string) => detail?.animals.find((a: any) => a.id === id)?.name ?? 'Hindi nakilalang hayop';
                  const rb = roleBadgeStyle(u.role);
                  return (
                    <>
                      <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => toggleFarmDetail(u.id)}>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {u.email}
                            {isMe && <Badge variant="danger" size="sm">You</Badge>}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: rb.bg, color: rb.color }}>
                            {rb.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.farm_name ?? '—'}</td>
                        <td style={{ textAlign: 'center', fontWeight: u.animal_count > 0 ? 700 : 400 }}>{u.animal_count}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{formatDate(u.created_at)}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'Never'}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="row-actions">
                            <Button variant="ghost" size="sm" title="Ipadala ang password reset" onClick={() => sendPasswordReset(u.email)}>
                              <Mail size={14} />
                            </Button>
                            {canManageAccounts && !isMe && (
                              <Button variant="ghost" size="sm" title={u.is_active ? 'I-deactivate ang account' : 'I-activate ang account'} onClick={() => setConfirmDeactivate(u)} style={{ color: u.is_active ? '#F59E0B' : '#16A34A' }}>
                                {u.is_active ? <UserMinus size={14} /> : <UserRoundCheck size={14} />}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* ── Expanded farm detail row ── */}
                      {isExpanded && (
                        <tr key={`${u.id}-detail`}>
                          <td colSpan={7} style={{ background: 'var(--color-surface-elevated, rgba(255,255,255,0.03))', padding: '12px 20px' }}>
                            {loadingDetail === u.id ? (
                              <div style={{ textAlign: 'center', padding: 16 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
                            ) : detail ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                {/* Farm Settings */}
                                {detail.settings && (
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text-secondary, #475569)', textTransform: 'uppercase', marginBottom: 6 }}>Mga Setting ng Bukid</div>
                                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                                      <span><strong>Bukid:</strong> {detail.settings.farm_name}</span>
                                      <span><strong>Target na Timbang:</strong> {detail.settings.target_weight_kg} kg</span>
                                      <span><strong>Gestation:</strong> {detail.settings.gestation_days} araw</span>
                                    </div>
                                  </div>
                                )}
                                {/* Animals */}
                                {detail.animals.length > 0 && (
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text-secondary, #475569)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <PawPrint size={12} /> Kambing at Tupa ({detail.animals.filter((a: any) => isAnimalActive(a)).length} aktibo)
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {detail.animals.filter((a: any) => isAnimalActive(a)).map((a: any) => (
                                        <span key={a.id} style={{
                                          padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                          background: '#F4FAF5',
                                          color: '#238B45',
                                        }}>
                                          {a.name} ({a.tag_id}) · {a.species}
                                          {a.weight_kg ? ` · ${a.weight_kg}kg` : ''}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {/* Vaccinations */}
                                {detail.vaccinations.length > 0 && (
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text-secondary, #475569)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <Syringe size={12} /> Kamakailang mga Bakuna
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {detail.vaccinations.slice(0, 5).map((v: any) => (
                                        <span key={v.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#F0FDF4', color: '#15803D' }}>
                                          {animalName(v.animal_id)}: {v.vaccine_name} noong {formatDate(v.date_given)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {detail.animals.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>Wala pang naitalang datos ng bukid.</p>}
                              </div>
                            ) : null}
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

      {/* Deactivation confirm */}
      <ConfirmDialog
        open={!!confirmDeactivate}
        title={confirmDeactivate?.is_active ? 'I-deactivate ang account?' : 'I-activate ang account?'}
        message={confirmDeactivate?.is_active ? `Mawawalan ng access si ${confirmDeactivate.email}, pero mananatili ang kanilang farm records at maaari pang maibalik ang account.` : `Maibabalik ang access ni ${confirmDeactivate?.email} sa ALPASFARM.`}
        confirmLabel={confirmDeactivate?.is_active ? 'I-deactivate' : 'I-activate'}
        danger={!!confirmDeactivate?.is_active}
        onConfirm={toggleAccountStatus}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </div>
  );
}
