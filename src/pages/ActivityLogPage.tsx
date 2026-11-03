import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Download, HeartPulse, Milk, Package, PawPrint,
  Printer, RefreshCw, Scale, Syringe, Wheat, Heart, ShieldCheck, Camera,
  Bell, Settings, Users, ShoppingCart, Pill,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FilterDateRange, FilterResetButton, FilterSearch, FilterSelect, FilterToolbar } from '../components/FilterToolbar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

type ActivityCategory = 'Animals' | 'Health' | 'Treatment' | 'Weight' | 'Breeding' | 'Vaccination' | 'Feed' | 'Milk' | 'Inventory' | 'Sales' | 'Camera' | 'Alerts' | 'Authentication' | 'Users' | 'Settings' | 'System';
type ActivityStatus = 'success' | 'failure';

interface ActivityRecord {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
  module: ActivityCategory;
  action: string;
  entity_id: string | null;
  entity_name: string | null;
  status: ActivityStatus;
  details: Record<string, unknown> | null;
}

const CATEGORIES: ActivityCategory[] = ['Animals', 'Health', 'Treatment', 'Weight', 'Breeding', 'Vaccination', 'Feed', 'Milk', 'Inventory', 'Sales', 'Camera', 'Alerts', 'Authentication', 'Users', 'Settings', 'System'];
const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  Animals: 'Kambing at Tupa', Health: 'Kalusugan', Treatment: 'Gamot', Weight: 'Timbang',
  Breeding: 'Pagpaparami', Vaccination: 'Bakuna', Feed: 'Pakain', Milk: 'Gatas',
  Inventory: 'Gamot at gamit', Sales: 'Benta', Camera: 'Camera sa gate', Alerts: 'Mga Paalala',
  Authentication: 'Pagpasok sa account', Users: 'Mga miyembro', Settings: 'Mga Setting', System: 'Sistema',
};
const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  Animals: '#238B45', Health: '#176B35', Treatment: '#B45309', Weight: '#238B45',
  Breeding: '#7C3AED', Vaccination: '#0284C7', Feed: '#A16207', Milk: '#0D9488',
  Inventory: '#238B45', Sales: '#176B35', Camera: '#4F46E5', Alerts: '#C2410C',
  Authentication: '#475569', Users: '#9333EA', Settings: '#64748B', System: '#64748B',
};
const CATEGORY_ICONS = {
  Animals: PawPrint, Health: HeartPulse, Treatment: Pill, Weight: Scale, Breeding: Heart,
  Vaccination: Syringe, Feed: Wheat, Milk, Inventory: Package, Sales: ShoppingCart,
  Camera, Alerts: Bell, Authentication: ShieldCheck, Users, Settings, System: Activity,
};
const ACTION_LABELS: Record<string, string> = {
  unknown: 'Iba pang gawain',
  created: 'Nagdagdag', updated: 'Nag-edit', archived: 'In-archive', restored: 'Ibinalik',
  deleted: 'Nag-alis', login: 'Pumasok sa account', logout: 'Lumabas sa account',
  'QR eartag verified': 'Na-verify ang QR eartag',
  eartag_assigned: 'Itinalaga ang eartag number',
  eartag_changed: 'Binago ang eartag number',
  eartag_ocr_verified: 'Na-verify ang eartag number ng camera',
  unknown_eartag_detected: 'May nakitang hindi rehistradong eartag number',
  camera_eartag_entry: 'Pumasok sa gate · eartag number verified',
  camera_eartag_exit: 'Lumabas sa gate · eartag number verified',
  health_screened: 'Sinuri ang kalagayan ng hayop',
  monitoring_started: 'Sinimulan ang camera',
  monitoring_finished: 'Tinapos ang pagsubaybay sa camera',
  monitoring_cancelled: 'Kinansela ang pagsubaybay sa camera',
  gate_added: 'Nagdagdag ng camera gate',
  gate_updated: 'Binago ang camera gate',
  notification_settings_updated: 'Binago ang notification settings',
  due_alert_generated: 'Nagpaalala ng inaasahang panganganak',
  due_alert_acknowledged: 'Sinuri ang paalala ng panganganak',
  due_date_changed: 'Binago ang inaasahang petsa ng panganganak',
  birth_confirmed: 'Itinala ang resulta ng panganganak',
  birth_successful: 'Matagumpay na panganganak',
  birth_failed: 'Itinala ang failed na panganganak',
  newborn_registered: 'Nagdagdag ng bagong silang na alaga',
  multiple_newborns_registered: 'Nagdagdag ng maraming bagong silang na alaga',
  recorded_deceased: 'Itinala bilang namatay',
  corrected_deceased_status: 'Itinama ang status ng namatay na hayop',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fil-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function csvCell(value: string): string {
  const safe = /^[=+@\-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function activityEntityLabel(record: ActivityRecord): string {
  const entity = record.entity_name || (record.entity_id ? 'Tala ng bukid' : '—');
  const eartagNumber = record.details?.new_eartag_number ?? record.details?.eartag_number;
  return eartagNumber === undefined || eartagNumber === null ? entity : `${entity} · Eartag ${String(eartagNumber)}`;
}

export function ActivityLogPage() {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterUser, setFilterUser] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadActivity = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id,actor_id,actor_name,created_at,module,action,entity_id,entity_name,status,details')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) {
      setLoadError('Hindi mabuksan ang talaan ng gawain sa ngayon. Pakisubukan muli o humingi ng tulong sa tagapangasiwa.');
      setRecords([]);
    } else {
      setRecords(((data ?? []) as ActivityRecord[]).map((record) => ({
        ...record,
        actor_name: record.actor_name || (record.actor_id ? 'Miyembro ng bukid' : 'Sistema'),
        module: CATEGORY_LABELS[record.module] ? record.module : 'System',
        action: ACTION_LABELS[record.action] ? record.action : 'unknown',
      })));
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { void loadActivity(); }, [loadActivity]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const refreshQuietly = () => { void loadActivity(true); };
    const channel = supabase
      .channel('activity-log-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refreshQuietly, 180);
      })
      .subscribe();
    const fallbackRefresh = window.setInterval(refreshQuietly, 60_000);

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(fallbackRefresh);
      void supabase.removeChannel(channel);
    };
  }, [loadActivity]);

  const users = useMemo(() => {
    const names = new Map<string, string>();
    records.forEach((record) => {
      if (record.actor_id) names.set(record.actor_id, record.actor_name || 'Miyembro ng bukid');
    });
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records]);

  const filtered = useMemo(() => records.filter((record) => {
    const day = record.created_at.slice(0, 10);
    if (filterCategory !== 'All' && record.module !== filterCategory) return false;
    if (filterUser !== 'All' && record.actor_id !== filterUser) return false;
    if (filterStatus !== 'All' && record.status !== filterStatus) return false;
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    const haystack = [record.action, record.module, record.entity_name, record.actor_name, record.entity_id, JSON.stringify(record.details ?? {})].join(' ').toLowerCase();
    return !search || haystack.includes(search.toLowerCase());
  }), [records, filterCategory, filterUser, filterStatus, dateFrom, dateTo, search]);

  useEffect(() => { setPage(1); }, [filterCategory, filterUser, filterStatus, dateFrom, dateTo, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const categoryCounts = useMemo(() => records.reduce<Record<string, number>>((counts, record) => {
    counts[record.module] = (counts[record.module] ?? 0) + 1;
    return counts;
  }, {}), [records]);

  const resetFilters = () => {
    setFilterCategory('All'); setFilterUser('All'); setFilterStatus('All');
    setDateFrom(''); setDateTo(''); setSearch('');
  };

  const handleDownloadCSV = () => {
    const rows = [
      ['Petsa at Oras', 'User', 'Aksyon', 'Module', 'Record', 'Status'],
      ...filtered.map((record) => [
        formatDateTime(record.created_at), record.actor_name || record.actor_id || 'System',
        ACTION_LABELS[record.action] || record.action, CATEGORY_LABELS[record.module] || record.module,
        activityEntityLabel(record), record.status,
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alpasfarm-activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const rows = filtered.map((record) => `<tr><td>${escapeHtml(formatDateTime(record.created_at))}</td><td>${escapeHtml(record.actor_name || record.actor_id || 'System')}</td><td>${escapeHtml(ACTION_LABELS[record.action] || record.action)}</td><td>${escapeHtml(CATEGORY_LABELS[record.module] || record.module)}</td><td>${escapeHtml(activityEntityLabel(record))}</td><td>${escapeHtml(record.status)}</td></tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>ALPASFARM — Activity Log</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px;color:#1f2937}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}th{background:#f3f4f6}</style></head><body><h1>ALPASFARM — Activity Log</h1><p>${filtered.length} actual records · ${escapeHtml(new Date().toLocaleString())}</p><table><thead><tr><th>Date / Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close();
    win.print();
  };

  if (loading) return <LoadingSpinner fullScreen text="Ikinakarga ang totoong activity records..." />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Talaan ng mga Gawain (Activity Log)</h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>{filtered.length} sa {records.length} totoong event · pinakahuling 1,000 record</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => void loadActivity()} loading={loading} leftIcon={<RefreshCw size={15} />}>I-refresh</Button>
          <Button variant="secondary" onClick={handleDownloadCSV} leftIcon={<Download size={15} />}>I-download ang CSV</Button>
          <Button variant="primary" onClick={handlePrint} leftIcon={<Printer size={15} />}>I-print</Button>
        </div>
      </div>

      {loadError && <div role="alert" style={{ display: 'flex', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', marginBottom: 16 }}><AlertTriangle size={16} color="#EF4444" /><span style={{ fontSize: 13 }}>{loadError}</span></div>}

      {!loadError && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {CATEGORIES.filter((category) => categoryCounts[category]).map((category) => {
          const Icon = CATEGORY_ICONS[category];
          const selected = filterCategory === category;
          return <button key={category} type="button" onClick={() => setFilterCategory(selected ? 'All' : category)} style={{ padding: '8px 12px', borderRadius: 10, cursor: 'pointer', background: selected ? `${CATEGORY_COLORS[category]}20` : 'var(--color-surface-glass, rgba(255,255,255,0.04))', border: `1px solid ${selected ? CATEGORY_COLORS[category] : 'var(--border-light)'}`, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit' }}><Icon size={14} color={CATEGORY_COLORS[category]} /><span style={{ fontSize: 12, fontWeight: 600 }}>{CATEGORY_LABELS[category]}</span><span style={{ fontSize: 11 }}>{categoryCounts[category]}</span></button>;
        })}
      </div>}

      <FilterToolbar>
        <FilterSearch placeholder="Maghanap sa kasaysayan..." value={search} onChange={setSearch} />
        <FilterSelect value={filterCategory} onChange={setFilterCategory} options={[{ value: 'All', label: 'Lahat ng gawain' }, ...CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))]} ariaLabel="Salain ayon sa gawain" minWidth={160} />
        <FilterSelect value={filterUser} onChange={setFilterUser} options={[{ value: 'All', label: 'Lahat ng gumawa' }, ...users.map(([id, name]) => ({ value: id, label: name }))]} ariaLabel="Salain ayon sa gumawa" minWidth={160} />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} options={[{ value: 'All', label: 'Lahat ng status' }, { value: 'success', label: 'Tagumpay' }, { value: 'failure', label: 'Nabigo' }]} ariaLabel="Salain ayon sa status" minWidth={140} />
        <FilterDateRange fromValue={dateFrom} toValue={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        {(filterCategory !== 'All' || filterUser !== 'All' || filterStatus !== 'All' || dateFrom || dateTo || search) && <FilterResetButton onClick={resetFilters} />}
      </FilterToolbar>

      <Card variant="glass" padding="none">
        {loadError ? <EmptyState icon={<Activity size={32} />} title="Hindi mabuksan ang talaan" description="Pakisubukan muli o humingi ng tulong sa tagapangasiwa." /> : visible.length === 0 ? <EmptyState icon={<Activity size={32} />} title="Wala pang naitalang gawain" description="Lalabas dito ang mga kamakailang pagbabago sa bukid." /> : (
          <>
          <div className="activity-table-desktop" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 850, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--color-text-secondary, #475569)' }}><th style={{ padding: '12px 16px' }}>Petsa / Oras</th><th style={{ padding: '12px 16px' }}>Gumawa</th><th style={{ padding: '12px 16px' }}>Gawain</th><th style={{ padding: '12px 16px' }}>Bahagi</th><th style={{ padding: '12px 16px' }}>Tala</th><th style={{ padding: '12px 16px' }}>Resulta</th></tr></thead>
              <tbody>{visible.map((record) => {
                const category = CATEGORY_LABELS[record.module] || record.module;
                const color = CATEGORY_COLORS[record.module] || '#64748B';
                const Icon = CATEGORY_ICONS[record.module] || Activity;
                return <tr key={record.id} style={{ borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.05))' }}><td style={{ padding: '12px 16px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary, #475569)', fontSize: 12 }}>{formatDateTime(record.created_at)}</td><td style={{ padding: '12px 16px', fontSize: 12 }}>{record.actor_name || (record.actor_id ? `${record.actor_id.slice(0, 8)}…` : 'System')}</td><td style={{ padding: '12px 16px', fontWeight: 600 }}>{ACTION_LABELS[record.action] || record.action}</td><td style={{ padding: '12px 16px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontSize: 11, fontWeight: 700 }}><Icon size={12} />{category}</span></td><td style={{ padding: '12px 16px', fontSize: 12 }}>{activityEntityLabel(record)}</td><td style={{ padding: '12px 16px', fontSize: 12, color: record.status === 'success' ? '#16A34A' : '#DC2626' }}>{record.status === 'success' ? 'Tagumpay' : 'Nabigo'}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className="activity-cards-mobile">
            {visible.map((record) => {
              const category = CATEGORY_LABELS[record.module] || record.module;
              const Icon = CATEGORY_ICONS[record.module] || Activity;
              return (
                <article className="activity-mobile-card" key={record.id}>
                  <div className="activity-mobile-card-heading">
                    <strong>{ACTION_LABELS[record.action] || record.action}</strong>
                    <span className={record.status === 'success' ? 'is-success' : 'is-failure'}>{record.status === 'success' ? 'Tagumpay' : 'Nabigo'}</span>
                  </div>
                  <div className="activity-mobile-card-meta"><span><Icon size={14} /> {category}</span><time>{formatDateTime(record.created_at)}</time></div>
                  <div className="activity-mobile-card-details">
                    <span>{activityEntityLabel(record)}</span>
                    <span>Gumawa: {record.actor_name || 'System'}</span>
                  </div>
                </article>
              );
            })}
          </div>
          </>
        )}
      </Card>

      {!loadError && filtered.length > pageSize && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Nakaraan</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Susunod</Button></div>}
    </div>
  );
}
