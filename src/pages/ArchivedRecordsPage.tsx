import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, AlertTriangle, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { FilterSelect, FilterToolbar } from '../components/FilterToolbar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

const ARCHIVE_TABLES = [
  { table: 'animals', label: 'Kambing at Tupa' },
  { table: 'health_records', label: 'Health' },
  { table: 'health_assessments', label: 'Legacy · Health Assessment' },
  { table: 'health_cases', label: 'Health Case' },
  { table: 'treatment_records', label: 'Treatment Records (Mga Tala ng Paggamot)' },
  { table: 'deworming_records', label: 'Legacy · Deworming' },
  { table: 'health_alerts', label: 'Health Alert' },
  { table: 'weight_records', label: 'Timbang' },
  { table: 'breeding_records', label: 'Breeding' },
  { table: 'vaccinations', label: 'Bakuna' },
  { table: 'inventory', label: 'Inventory' },
  { table: 'feed_records', label: 'Legacy · Pakain' },
  { table: 'milk_records', label: 'Legacy · Gatas' },
  { table: 'camera_health_screenings', label: 'Legacy · Camera Health Scan' },
] as const;

type ArchiveTable = typeof ARCHIVE_TABLES[number]['table'];
interface ArchivedRecord {
  id: string;
  user_id: string;
  table: ArchiveTable;
  label: string;
  name: string;
  archived_at: string;
  archived_by: string | null;
  archive_reason: string | null;
}

function recordName(row: Record<string, unknown>): string {
  const name = row.name ?? row.tag_id ?? row.vaccine_name ?? row.feed_type ?? row.animal_id ?? row.id;
  return String(name ?? 'Record');
}

export function ArchivedRecordsPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const [records, setRecords] = useState<ArchivedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tableFilter, setTableFilter] = useState('All');
  const [reloadKey, setReloadKey] = useState(0);
  const isSuperAdmin = role === 'super_admin';

  const loadArchived = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [grouped, salesResult] = await Promise.all([
        Promise.all(ARCHIVE_TABLES.map(async (definition) => {
        let query = (supabase.from(definition.table as any) as any)
          .select('*')
          .not('archived_at', 'is', null)
          .order('archived_at', { ascending: false });
        if (!isSuperAdmin) query = query.eq('user_id', user.id);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          user_id: String(row.user_id),
          table: definition.table,
          label: definition.label,
          name: recordName(row),
          archived_at: String(row.archived_at),
          archived_by: typeof row.archived_by === 'string' ? row.archived_by : null,
          archive_reason: typeof row.archive_reason === 'string' ? row.archive_reason : null,
        } satisfies ArchivedRecord));
        })),
        (() => {
          let salesQuery = supabase.from('animal_sales').select('animal_id');
          if (!isSuperAdmin) salesQuery = salesQuery.eq('user_id', user.id);
          return salesQuery;
        })(),
      ]);
      if (salesResult.error) throw salesResult.error;
      const soldIds = new Set((salesResult.data ?? []).map((sale) => sale.animal_id));
      setRecords(grouped.flat().filter((record) => record.table !== 'animals' || !soldIds.has(record.id)).sort((a, b) => b.archived_at.localeCompare(a.archived_at)));
    } catch (error) {
      console.error('Failed to load archived records:', error);
      setLoadError('Hindi mabuksan ang mga naka-archive sa ngayon. Pakisubukan muli o humingi ng tulong sa tagapangasiwa.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin]);

  useEffect(() => { void loadArchived(); }, [loadArchived, reloadKey]);

  const filtered = useMemo(() => records.filter((record) => {
    if (tableFilter !== 'All' && record.table !== tableFilter) return false;
    const query = search.toLowerCase();
    return !query || `${record.label} ${record.name} ${record.archive_reason ?? ''}`.toLowerCase().includes(query);
  }), [records, tableFilter, search]);

  const restoreRecord = async (record: ArchivedRecord) => {
    if (!user || restoringId) return;
    setRestoringId(record.id);
    try {
      const update: Record<string, unknown> = { archived_at: null, archived_by: null, archive_reason: null };
      if (record.table === 'animals') update.archived = false;
      let query = (supabase.from(record.table as any) as any).update(update).eq('id', record.id);
      if (!isSuperAdmin) query = query.eq('user_id', user.id);
      const { error } = await query;
      if (error) throw error;
      toast('Naibalik ang record sa aktibong listahan.', 'success');
      setRecords((current) => current.filter((entry) => entry.id !== record.id || entry.table !== record.table));
    } catch {
      toast('Hindi naibalik ang record. Pakisubukan muli.', 'danger');
    } finally {
      setRestoringId(null);
    }
  };

  if (loading) return <LoadingSpinner fullScreen text="Ikinakarga ang mga naka-archive..." />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 23, fontWeight: 850, margin: 0 }}><Archive size={22} color="#238B45" /> Mga Naka-archive</h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 5 }}>Nananatili ang mga record at maaari mong ibalik ang mga ito anumang oras.</p>
        </div>
        <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)} loading={loading} leftIcon={<RefreshCw size={15} />}>I-refresh</Button>
      </div>

      {loadError && <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '13px 15px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)', marginBottom: 16 }}><AlertTriangle size={16} color="#DC2626" /><span style={{ fontSize: 13 }}>{loadError}</span></div>}

      <FilterToolbar>
        <div style={{ position: 'relative', minWidth: 220, flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--color-text-secondary, #64748B)' }} />
          <input className="filter-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Maghanap sa archive..." aria-label="Maghanap sa archived records" style={{ paddingLeft: 34, width: '100%' }} />
        </div>
        <FilterSelect value={tableFilter} onChange={setTableFilter} ariaLabel="Salain ayon sa record type" options={[{ value: 'All', label: 'Lahat ng record' }, ...ARCHIVE_TABLES.map((item) => ({ value: item.table, label: item.label }))]} minWidth={180} />
      </FilterToolbar>

      <Card variant="glass" padding="none">
        {loadError ? <EmptyState icon={<Archive size={32} />} title="Hindi mabuksan ang archive" description="Pakisubukan muli o humingi ng tulong sa tagapangasiwa." /> : filtered.length === 0 ? <EmptyState icon={<Archive size={32} />} title="Walang naka-archive" description="Kapag nag-archive ka ng record, makikita at maibabalik mo ito rito." /> : (
          <>
          <div className="archive-table-desktop" style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 780 }}>
              <thead><tr><th>Record</th><th>Uri</th><th>Petsa ng Archive</th><th>In-archive ni</th><th>Dahilan</th><th>Katayuan</th><th>Aksyon</th></tr></thead>
              <tbody>{filtered.map((record) => <tr key={`${record.table}-${record.id}`}>
                <td style={{ fontWeight: 700 }}>{record.name}</td>
                <td>{record.label}</td>
                <td>{new Date(record.archived_at).toLocaleString('fil-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td>{record.archived_by === user?.id ? 'Ikaw' : record.archived_by ? 'Tagapangasiwa' : 'Awtomatiko'}</td>
                <td>{record.archive_reason || '—'}</td>
                <td><Badge variant="warning" size="sm">Naka-archive</Badge></td>
                <td><Button variant="secondary" size="sm" disabled={!!restoringId} loading={restoringId === record.id} onClick={() => void restoreRecord(record)} leftIcon={<RotateCcw size={14} />}>Ibalik</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="archive-cards-mobile">
            {filtered.map((record) => (
              <article className="archive-mobile-card" key={`${record.table}-${record.id}`}>
                <div className="archive-mobile-card-heading">
                  <strong>{record.name}</strong>
                  <Badge variant="warning" size="sm">Naka-archive</Badge>
                </div>
                <div className="archive-mobile-card-details">
                  <span>{record.label} · {new Date(record.archived_at).toLocaleDateString('fil-PH', { dateStyle: 'medium' })}</span>
                  <span>{record.archive_reason || 'Walang nakatalang dahilan'}</span>
                  <span>In-archive ni: {record.archived_by === user?.id ? 'Ikaw' : record.archived_by ? 'Tagapangasiwa' : 'Awtomatiko'}</span>
                </div>
                <Button variant="secondary" size="sm" disabled={!!restoringId} loading={restoringId === record.id} onClick={() => void restoreRecord(record)} leftIcon={<RotateCcw size={14} />}>Ibalik</Button>
              </article>
            ))}
          </div>
          </>
        )}
      </Card>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-secondary, #64748B)' }}>{filtered.length} naka-archive na record</div>
    </div>
  );
}
