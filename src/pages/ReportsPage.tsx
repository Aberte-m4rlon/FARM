import { useState, useMemo } from 'react';
import { useFarmData } from '../lib/useFarmData';
import { FilterToolbar, FilterSelect, FilterSearch, FilterDateRange } from '../components/FilterToolbar';
import { inventoryStatus } from '../lib/analytics';
import { Printer, FileBarChart, Download, PawPrint, Pill, Package, DollarSign, AlertTriangle, Clock3 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useGateMonitoringHistory } from '../lib/useGateMonitoringHistory';
import { isAnimalActive } from '../lib/animalLifecycle';
import { useCameraCountingHistory } from '../lib/useCameraCountingHistory';

type ReportType =
  | 'animal'
  | 'treatment'
  | 'breeding'
  | 'sales'
  | 'vaccination'
  | 'inventory'
  | 'ledger'
  | 'gate'
  | 'counting'
  | 'mortality';

const REPORT_LABELS: Record<ReportType, string> = {
  animal: 'Ulat ng Kambing at Tupa',
  treatment: 'Ulat sa Gamot at Treatment',
  breeding: 'Ulat sa Pagpapalahi (Breeding)',
  sales: 'Ulat ng Pagbebenta (Animal Sales)',
  vaccination: 'Ulat sa Pagbabakuna',
  inventory: 'Ulat sa Imbentaryo (Balance)',
  ledger: 'Talaan ng Paggalaw ng Imbentaryo (Ledger)',
  gate: 'Ulat sa Camera Monitoring',
  counting: 'CCTV Counting Sessions',
  mortality: 'Ulat sa Namatay na Hayop',
};

const reportMobileLabel = (key: string) => {
  const labels: Record<string, string> = {
    tag_id: 'Animal ID', animal_id: 'Animal ID', eartag_number: 'Eartag', name: 'Pangalan', species: 'Uri', breed: 'Lahi', sex: 'Kasarian', weight: 'Timbang',
    status: 'Kalagayan', date: 'Petsa', animal: 'Alaga', reasons: 'Dahilan', expected: 'Inaasahang panganganak',
    notes: 'Tala', gain: 'Dagdag na timbang bawat araw', vaccine: 'Bakuna', nextDue: 'Susunod na bakuna',
    vet: 'Beterinaryo', category: 'Kategorya', qty: 'Dami', unit: 'Yunit', min: 'Minimum na stock',
    expiry: 'Petsa ng pag-expire', type: 'Uri', cost: 'Halaga', treatment: 'Gamot o lunas',
    recommendation: 'Iskedyul', item: 'Gamit', previous_stock: 'Dating stock', new_stock: 'Bagong stock',
    current_balance: 'Kasalukuyang stock', total_in: 'Kabuuang pumasok', total_consumed: 'Kabuuang nagamit',
    cost_per_unit: 'Presyo bawat yunit', sold_weight: 'Timbang noong ibenta', selling_price: 'Presyo ng benta',
    cause: 'Dahilan', cause_details: 'Detalye ng dahilan', symptoms: 'Sintomas bago namatay', previous_health_status: 'Dating kalusugan', previous_treatment: 'Dating gamutan', recorded_by: 'Naitala ni', recorded_at: 'Petsa ng pagtatala',
    price_per_kg: 'Presyo bawat kilo', buyer: 'Bumibili', amount_received: 'Halagang natanggap',
    remaining_balance: 'Natitirang bayad', event: 'Kaganapan', identification: 'Pagkilala sa hayop', movement: 'Obserbasyon sa galaw',
    reference: 'Talaan', gate: 'Gate', session: 'Pagsubaybay', session_expected: 'Inaasahang bilang',
    camera_crossings: 'Mga tawid sa camera', max_visible_tracks: 'Pinakamaraming hayop na nakita sabay-sabay',
    required_goats: 'Kinakailangang kambing', entered_goats: 'Nabilang na kambing na pumasok', missing_goats: 'Kulang na kambing',
    required_sheep: 'Kinakailangang tupa', entered_sheep: 'Nabilang na tupa na pumasok', missing_sheep: 'Kulang na tupa',
    total_required: 'Kabuuang kailangan', total_entered: 'Kabuuang naibilang', total_missing: 'Kabuuang kulang',
    entry_event_count: 'Bilang ng entry events', exit_event_count: 'Bilang ng exit events',
    goat_entry_events: 'Entry events ng kambing', sheep_entry_events: 'Entry events ng tupa', start_time: 'Oras ng pagsisimula', end_time: 'Oras ng pagtatapos',
  };
  return labels[key] ?? key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
};

export function ReportsPage() {
  const farmData = useFarmData();
  const gateHistory = useGateMonitoringHistory();
  const cameraCountingHistory = useCameraCountingHistory();
  const [reportType, setReportType] = useState<ReportType>('animal');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const activeAnimals = farmData.animals.filter(isAnimalActive);
  const mortalityRecords = farmData.mortalityRecords.filter((record) => !record.corrected_at);
  const currentMonthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date());
  const currentYearKey = currentMonthKey.slice(0, 4);
  const mortalityThisMonth = mortalityRecords.filter((record) => record.date_of_death.slice(0, 7) === currentMonthKey).length;
  const mortalityThisYear = mortalityRecords.filter((record) => record.date_of_death.slice(0, 4) === currentYearKey).length;
  const mortalityByCause = Object.entries(mortalityRecords.reduce<Record<string, number>>((counts, record) => {
    counts[record.cause_of_death] = (counts[record.cause_of_death] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);
  const mortalityMonthlyTrend = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (11 - index));
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return {
      key: monthKey,
      label: date.toLocaleDateString('fil-PH', { month: 'short' }),
      value: mortalityRecords.filter((record) => record.date_of_death.slice(0, 7) === monthKey).length,
    };
  });

  const inDateRange = (date: string) => {
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    return true;
  };

  const reportData = useMemo(() => {
    const animalName = (id: string) => farmData.animals.find((a) => a.id === id)?.name ?? 'Walang Pangalan';

    switch (reportType) {
      case 'animal':
        return activeAnimals
          .filter((a) => !search || (a.name ?? '').toLowerCase().includes(search.toLowerCase()) || a.tag_id.toLowerCase().includes(search.toLowerCase()) || String(a.eartag_number ?? '').includes(search.trim()))
          .map((a) => ({
            eartag_number: a.eartag_number ?? '—',
            tag_id: a.tag_id,
            name: a.name || 'Walang Pangalan',
            species: a.species === 'Goat' ? 'Kambing' : 'Tupa',
            breed: a.breed || '—',
            sex: a.sex === 'Male' ? 'Lalaki' : 'Babae',
            weight: a.weight_kg ? `${a.weight_kg} kg` : '—',
            status: a.archived ? 'Archived' : 'Active / Kasalukuyan',
          }));
      case 'treatment':
        return [
          ...farmData.treatmentRecords
            .filter((r) => inDateRange(r.start_date))
            .filter((r) => !search || animalName(r.animal_id).toLowerCase().includes(search.toLowerCase()) || r.medicine_name.toLowerCase().includes(search.toLowerCase()))
            .map((r) => ({ source_id: r.id, date: r.start_date, animal: animalName(r.animal_id), treatment: `${r.medicine_name} — ${r.dosage} ${r.unit}`, recommendation: `${r.status} · ${r.frequency}`, notes: r.treatment_notes || '—' })),
          ...farmData.inventoryUsage
            .filter((r) => inDateRange(r.usage_date.slice(0, 10)))
            .filter((r) => !search || animalName(r.animal_id || '').toLowerCase().includes(search.toLowerCase()) || (r.notes || '').toLowerCase().includes(search.toLowerCase()))
            .map((r) => ({ source_id: r.id, date: r.usage_date, animal: animalName(r.animal_id || ''), treatment: r.notes?.match(/Gamot:\s*([^|]+)/i)?.[1]?.trim() || r.reason || 'Gamot mula sa imbentaryo', recommendation: `${r.treatment_status || 'Naibigay'} · ${r.dosage || `${r.quantity_used} ${r.unit}`}`, notes: r.notes || '—' })),
        ];
      case 'breeding':
        return farmData.breedingRecords
          .filter((r) => inDateRange(r.mating_date))
          .filter((r) => !search || animalName(r.animal_id).toLowerCase().includes(search.toLowerCase()))
          .map((r) => ({ date: r.mating_date, animal: animalName(r.animal_id), expected: r.expected_kidding_date, status: r.status, notes: r.notes }));
      case 'sales':
        return (farmData.sales || [])
          .filter((s) => inDateRange(s.sale_date))
          .filter(
            (s) =>
              !search ||
              animalName(s.animal_id).toLowerCase().includes(search.toLowerCase()) ||
              (s.buyer_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
              (s.notes ?? '').toLowerCase().includes(search.toLowerCase())
          )
          .map((s) => {
            const an = farmData.animals.find((a) => a.id === s.animal_id);
            return {
              date: s.sale_date,
              eartag_number: an?.eartag_number ?? '—',
              tag_id: an?.tag_id || '—',
              animal: an?.name || 'Walang Pangalan',
              species: an?.species === 'Goat' ? 'Kambing' : an?.species === 'Sheep' ? 'Tupa' : '—',
              sold_weight: `${s.sold_weight} kg`,
              selling_price: `₱${s.selling_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              price_per_kg: s.price_per_kg ? `₱${s.price_per_kg.toFixed(2)}/kg` : '—',
              buyer: s.buyer_name || 'Hindi tinukoy',
              status: s.payment_status,
              amount_received: `₱${(s.amount_received || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              remaining_balance: `₱${(s.remaining_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            };
          });
      case 'vaccination':
        return farmData.vaccinations
          .filter((r) => inDateRange(r.date_given))
          .filter((r) => !search || animalName(r.animal_id).toLowerCase().includes(search.toLowerCase()) || r.vaccine_name.toLowerCase().includes(search.toLowerCase()))
          .map((r) => ({ date: r.date_given, animal: animalName(r.animal_id), vaccine: r.vaccine_name, nextDue: r.next_due_date, vet: r.veterinarian }));
      case 'mortality':
        return mortalityRecords
          .filter((record) => inDateRange(record.date_of_death))
          .filter((record) => {
            if (!search) return true;
            const animal = farmData.animals.find((row) => row.id === record.animal_id);
            const haystack = [animal?.name, animal?.tag_id, animal?.eartag_number, record.cause_of_death, record.cause_details, record.symptoms_before_death]
              .map((value) => String(value ?? '').toLowerCase());
            return haystack.some((value) => value.includes(search.toLowerCase().trim()));
          })
          .map((record) => {
            const animal = farmData.animals.find((row) => row.id === record.animal_id);
            return {
              date: record.date_of_death,
              animal: animal?.name || 'Hindi nahanap',
              animal_id: animal?.tag_id || record.animal_id,
              eartag_number: animal?.eartag_number ?? '—',
              species: animal?.species === 'Sheep' ? 'Tupa' : 'Kambing',
              breed: animal?.breed || '—',
              cause: record.cause_of_death === 'other'
                ? `Iba Pa / Other: ${record.cause_details || 'Hindi tinukoy'}`
                : ({ disease: 'Sakit / Disease', accident: 'Aksidente / Accident', birthing_complication: 'Komplikasyon sa Panganganak / Birthing Complication', unknown: 'Hindi Alam / Unknown' } as Record<string, string>)[record.cause_of_death] ?? 'Hindi Alam / Unknown',
              cause_details: record.cause_details || '—',
              symptoms: record.symptoms_before_death || '—',
              previous_health_status: record.previous_health_status || '—',
              previous_treatment: record.previous_treatment || '—',
              recorded_by: record.recorded_by_name || 'Farm user',
              recorded_at: record.recorded_at,
              notes: record.notes || '—',
              status: 'NAMATAY NA',
            };
          });
      case 'inventory':
        return farmData.inventory
          .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.category ?? '').toLowerCase().includes(search.toLowerCase()))
          .map((r) => {
            const txs = farmData.inventoryTransactions.filter((tx) => tx.inventory_item_id === r.id);
            const totalIn = txs.filter((tx) => tx.type === 'STOCK_IN' || tx.type === 'RETURN').reduce((s, tx) => s + (tx.quantity || 0), 0);
            const totalOut = txs.filter((tx) => tx.type === 'CONSUMPTION').reduce((s, tx) => s + (tx.quantity || 0), 0);
            return {
              name: r.name,
              category: r.category,
              current_balance: `${r.quantity} ${r.unit}`,
              total_in: `${totalIn} ${r.unit}`,
              total_consumed: `${totalOut} ${r.unit}`,
              min: r.minimum_stock ? `${r.minimum_stock} ${r.unit}` : '—',
              cost_per_unit: r.cost ? `₱${r.cost}` : '—',
              expiry: r.expiry_date || 'Walang Expiry',
              status: inventoryStatus(r, farmData.settings?.expiry_warning_days ?? 15).label,
            };
          });
      case 'ledger':
        return farmData.inventoryTransactions
          .filter((tx) => !tx.created_at || inDateRange(tx.created_at.split('T')[0]))
          .filter((tx) => {
            const itemName = farmData.inventory.find((i) => i.id === tx.inventory_item_id)?.name ?? 'Kagamitan';
            return !search || itemName.toLowerCase().includes(search.toLowerCase()) || (tx.reason ?? '').toLowerCase().includes(search.toLowerCase()) || (tx.notes ?? '').toLowerCase().includes(search.toLowerCase());
          })
          .map((tx) => {
            const item = farmData.inventory.find((i) => i.id === tx.inventory_item_id);
            const itemName = item?.name ?? 'Kagamitan';
            const unit = tx.unit || item?.unit || '';
            const typeLabel =
              tx.type === 'STOCK_IN'
                ? 'Pasok (Stock In)'
                : tx.type === 'CONSUMPTION'
                ? 'Nagamit (Consumption)'
                : tx.type === 'ADJUSTMENT_IN' || tx.type === 'ADJUSTMENT_OUT'
                ? 'Pagwawasto (Adjustment)'
                : tx.type === 'REMOVAL'
                ? 'Tinatanggal (Removal)'
                : tx.type === 'RETURN'
                ? 'Binalik (Return)'
                : tx.type;
            return {
              date: tx.created_at ? tx.created_at.split('T')[0] : '—',
              item: itemName,
              type: typeLabel,
              qty: `${tx.quantity} ${unit}`,
              previous_stock: `${tx.previous_stock ?? '—'} ${unit}`,
              new_stock: `${tx.new_stock ?? '—'} ${unit}`,
              reason: tx.reason || '—',
              notes: tx.notes || '—',
            };
          });
      case 'gate': {
        const animalsById = new Map(farmData.animals.map((animal) => [animal.id, animal]));
        const sessionsById = new Map(gateHistory.sessions.map((session) => [session.id, session]));
        const crossingsBySession = new Map<string, number>();
        gateHistory.crossings.forEach((crossing) => crossingsBySession.set(crossing.session_id, (crossingsBySession.get(crossing.session_id) ?? 0) + 1));
        const matches = (animalId: string, eartagNumber?: string | null) => {
          const animal = animalsById.get(animalId);
          const haystack = `${animal?.name ?? ''} ${animal?.tag_id ?? ''} ${animal?.eartag_number ?? ''} ${eartagNumber ?? ''} ${animalId}`.toLowerCase();
          return !search || haystack.includes(search.toLowerCase());
        };
        const eventRows = gateHistory.events
          .filter((event) => inDateRange(event.created_at.slice(0, 10)))
          .filter((event) => matches(event.animal_id, event.eartag_number))
          .map((event) => {
            const animal = animalsById.get(event.animal_id);
            return {
              date: event.created_at,
              event: event.direction === 'entry' ? 'Pagpasok sa gate' : 'Paglabas sa gate',
              animal: animal?.name ?? 'Hindi na aktibo sa talaan',
              eartag_number: event.eartag_number ?? animal?.eartag_number ?? '—',
              animal_id: animal?.tag_id ?? event.animal_id,
              gate: event.gate_id,
              session: event.session_id,
              session_expected: sessionsById.get(event.session_id)?.expected_count ?? '—',
              camera_crossings: crossingsBySession.get(event.session_id) ?? 0,
              max_visible_tracks: sessionsById.get(event.session_id)?.max_visible_tracks ?? 0,
              species: event.species_detected === 'goat' ? 'Kambing' : 'Tupa',
              identification: event.eartag_verified ? `Eartag ${event.eartag_number ?? animal?.eartag_number ?? ''} · Na-verify` : event.qr_verified ? 'Legacy QR · Na-verify' : 'Hindi pa na-verify',
              movement: event.movement_observation === 'slow_approach'
                ? 'Mabagal na paglapit — tingnan ang hayop'
                : event.movement_observation === 'prolonged_stop'
                  ? 'Matagal na paghinto — tingnan ang hayop'
                  : 'Walang naiulat na kakaibang galaw',
              reference: event.tracking_id ?? '—',
              status: sessionsById.get(event.session_id)?.status ?? '—',
            };
          });
        const crossingRows = gateHistory.crossings
          .filter((crossing) => inDateRange(crossing.created_at.slice(0, 10)))
          .filter((crossing) => matches(crossing.animal_id ?? crossing.tracking_id, crossing.eartag_number))
          .map((crossing) => {
            const animal = crossing.animal_id ? animalsById.get(crossing.animal_id) : undefined;
            const session = sessionsById.get(crossing.session_id);
            return {
              date: crossing.created_at,
              event: 'Tumawid sa camera',
              animal: animal?.name ?? (crossing.eartag_number ? `Hindi kilalang eartag ${crossing.eartag_number}` : 'Hindi pa nakikilala'),
              eartag_number: crossing.eartag_number ?? animal?.eartag_number ?? '—',
              animal_id: animal?.tag_id ?? crossing.tracking_id,
              gate: crossing.gate_id,
              session: crossing.session_id,
              session_expected: session?.expected_count ?? '—',
              camera_crossings: crossingsBySession.get(crossing.session_id) ?? 0,
              max_visible_tracks: session?.max_visible_tracks ?? 0,
              species: crossing.species_detected === 'goat' ? 'Kambing' : 'Tupa',
              identification: crossing.eartag_verified ? `Eartag ${crossing.eartag_number ?? animal?.eartag_number ?? ''} · Na-verify` : crossing.qr_verified ? 'Legacy QR · Na-verify' : crossing.eartag_number ? 'Hindi kilalang eartag' : 'Hindi pa nakikilala',
              movement: crossing.movement_observation === 'slow_approach'
                ? 'Mabagal na paglapit — tingnan ang hayop'
                : crossing.movement_observation === 'prolonged_stop'
                  ? 'Matagal na paghinto — tingnan ang hayop'
                  : 'Walang naiulat na kakaibang galaw',
              reference: crossing.tracking_id,
              status: session?.status ?? '—',
            };
          });
        const alertRows = gateHistory.alerts
          .filter((alert) => inDateRange(alert.created_at.slice(0, 10)))
          .filter((alert) => matches(alert.animal_id))
          .map((alert) => {
            const animal = animalsById.get(alert.animal_id);
            const session = sessionsById.get(alert.session_id);
            return {
              date: alert.created_at,
              event: alert.alert_type === 'movement_observation'
                ? 'Obserbasyon sa galaw'
                : alert.status === 'resolved' ? 'Na-verify pagkatapos ng rescanning' : 'Hindi pa nakumpirma sa loob',
              animal: animal?.name ?? 'Hindi na aktibo sa talaan',
              eartag_number: animal?.eartag_number ?? '—',
              animal_id: animal?.tag_id ?? alert.animal_id,
              gate: session?.gate_id ?? '—',
              session: alert.session_id,
              session_expected: session?.expected_count ?? '—',
              camera_crossings: crossingsBySession.get(alert.session_id) ?? 0,
              max_visible_tracks: session?.max_visible_tracks ?? 0,
              species: animal?.species === 'Sheep' ? 'Tupa' : 'Kambing',
              identification: '—',
              movement: alert.message,
              reference: 'Alert',
              status: alert.status,
            };
          });
        return [...eventRows, ...crossingRows, ...alertRows].sort((a, b) => b.date.localeCompare(a.date));
      }
      case 'counting':
        return cameraCountingHistory.sessions
          .filter((session) => inDateRange(session.started_at.slice(0, 10)))
          .filter((session) => !search || session.id.toLowerCase().includes(search.toLowerCase()) || session.status.toLowerCase().includes(search.toLowerCase()))
          .map((session) => ({
            date: session.started_at.slice(0, 10),
            session: session.id,
            start_time: new Date(session.started_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }),
            end_time: session.ended_at ? new Date(session.ended_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }) : '—',
            status: session.status,
            required_goats: session.required_goats,
            entered_goats: session.entered_goats,
            missing_goats: session.missing_goats,
            required_sheep: session.required_sheep,
            entered_sheep: session.entered_sheep,
            missing_sheep: session.missing_sheep,
            total_required: session.total_required,
            total_entered: session.total_entered,
            total_missing: session.total_missing,
            goat_entry_events: session.goat_entry_events,
            sheep_entry_events: session.sheep_entry_events,
            entry_event_count: session.entry_event_count,
            exit_event_count: session.exit_event_count,
          }));
      default:
        return [];
    }
  }, [reportType, dateFrom, dateTo, search, farmData, activeAnimals, gateHistory.sessions, gateHistory.events, gateHistory.crossings, gateHistory.alerts, cameraCountingHistory.sessions]);

  const selectedCountingSessions = cameraCountingHistory.sessions.filter((session) => inDateRange(session.started_at.slice(0, 10)));
  const completedCountingSessions = selectedCountingSessions.filter((session) => session.status === 'COMPLETE');
  const averageCountingMinutes = completedCountingSessions.length
    ? Math.round(completedCountingSessions.reduce((sum, session) => sum + (Date.parse(session.completed_at || '') - Date.parse(session.started_at)) / 60_000, 0) / completedCountingSessions.length)
    : null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const headers = Object.keys(reportData[0] as Record<string, unknown>);
    const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = reportData.map((r) => headers.map((h) => csvCell((r as Record<string, unknown>)[h])).join(','));
    const csv = [headers.map(csvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportType}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const headers = reportData.length > 0 ? Object.keys(reportData[0] as Record<string, unknown>) : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Mga Ulat</h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>
            Pangkalahatang ulat at talaan ng bukid para sa pagsusuri at pag-export
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            onClick={handleExportCSV}
            disabled={reportData.length === 0}
            leftIcon={<Download size={16} />}
          >
            I-download (CSV)
          </Button>
          <Button
            variant="primary"
            onClick={handlePrint}
            disabled={reportData.length === 0}
            leftIcon={<Printer size={16} />}
          >
            I-print
          </Button>
        </div>
      </div>

      {/* 3-Column Summary Cards: Animals | Treatment | Inventory */}
      <div className="mobile-stats-grid-3" style={{ marginBottom: 16 }}>
        {/* Animals */}
        <div
          onClick={() => setReportType('animal')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: reportType === 'animal' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Kambing at Tupa
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PawPrint size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {activeAnimals.length}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Talaan ng kambing at tupa
            </div>
          </div>
        </div>

        {/* Treatment */}
        <div
          onClick={() => setReportType('treatment')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: reportType === 'treatment' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Treatment Records (Mga Tala ng Paggamot)
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Pill size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {farmData.treatmentRecords.length + farmData.inventoryUsage.length}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Naitalang gamutan at paggamit ng gamot
            </div>
          </div>
        </div>

        {/* Inventory */}
        <div
          onClick={() => setReportType('inventory')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: reportType === 'inventory' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Imbentaryo
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {farmData.inventory.length}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Talaan ng gamit
            </div>
          </div>
        </div>

        {/* Sales */}
        <div
          onClick={() => setReportType('sales')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: reportType === 'sales' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Benta ng Kambing at Tupa
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {(farmData.sales || []).length}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Naibentang kambing at tupa
            </div>
          </div>
        </div>

        {/* Mortality */}
        <div
          onClick={() => setReportType('mortality')}
          className="stat-card"
          style={{ cursor: 'pointer', border: reportType === 'mortality' ? '2px solid #b42318' : undefined }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>Mga Namatay na Hayop</span>
            <div className="stat-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff0ef', color: '#9f2d25' }}><AlertTriangle size={15} /></div>
          </div>
          <div>
            <div className="stat-card-value">{mortalityRecords.length}</div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>Mga aktibong mortality record</div>
          </div>
        </div>
      </div>

      <FilterToolbar>
        <FilterSelect
          value={reportType}
          onChange={(val) => setReportType(val as ReportType)}
          options={Object.entries(REPORT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          ariaLabel="Select Report Type"
          minWidth={200}
        />
        <FilterDateRange
          fromValue={dateFrom}
          toValue={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
        />
        <FilterSearch
          placeholder="Maghanap ng record..."
          value={search}
          onChange={setSearch}
        />
      </FilterToolbar>

      {reportType === 'counting' && (
        <>
          {!cameraCountingHistory.available && (
            <div role="alert" style={{ margin: '12px 0', padding: 12, borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--text)' }}>
              Hindi pa available ang database counting history. Ilapat ang camera counting migration bago gamitin ang report.
            </div>
          )}
          <div className="mobile-stats-grid-3" style={{ margin: '12px 0' }}>
            <div className="stat-card"><span className="stat-card-label">Counting sessions</span><strong className="stat-card-value">{cameraCountingHistory.loading ? '—' : selectedCountingSessions.length}</strong></div>
            <div className="stat-card"><span className="stat-card-label">Complete / Missing</span><strong className="stat-card-value">{completedCountingSessions.length} / {selectedCountingSessions.filter((session) => session.status === 'MISSING').length}</strong></div>
            <div className="stat-card"><span className="stat-card-label">Average counting period</span><strong className="stat-card-value">{averageCountingMinutes === null ? '—' : `${Math.round(averageCountingMinutes / 60)} hrs`}</strong><Clock3 size={16} /></div>
            <div className="stat-card"><span className="stat-card-label">Goat entry events</span><strong className="stat-card-value">{selectedCountingSessions.reduce((sum, session) => sum + session.goat_entry_events, 0)}</strong></div>
            <div className="stat-card"><span className="stat-card-label">Sheep entry events</span><strong className="stat-card-value">{selectedCountingSessions.reduce((sum, session) => sum + session.sheep_entry_events, 0)}</strong></div>
            <div className="stat-card"><span className="stat-card-label">Total returned / unaccounted</span><strong className="stat-card-value">{selectedCountingSessions.reduce((sum, session) => sum + session.total_entered, 0)} / {selectedCountingSessions.reduce((sum, session) => sum + session.total_missing, 0)}</strong></div>
          </div>
        </>
      )}

      {reportType === 'gate' && !gateHistory.available && (
        <div role="alert" style={{ margin: '12px 0', padding: 12, borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--text)' }}>
          Hindi mabuksan ang tala mula sa camera sa ngayon. Subukang muli mamaya o humingi ng tulong sa tagapangasiwa.
        </div>
      )}
      {reportType === 'mortality' && (
        <Card padding="md" style={{ margin: '12px 0', border: '1px solid var(--border, #dce8df)' }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 16 }}>Buod at buwanang trend ng pagkamatay</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
            <div><strong style={{ display: 'block', fontSize: 22 }}>{mortalityRecords.length}</strong><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Kabuuang tala</span></div>
            <div><strong style={{ display: 'block', fontSize: 22 }}>{mortalityThisMonth}</strong><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Ngayong buwan</span></div>
            <div><strong style={{ display: 'block', fontSize: 22 }}>{mortalityThisYear}</strong><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Ngayong taon</span></div>
            <div><strong style={{ display: 'block', fontSize: 22 }}>{mortalityRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Goat').length}</strong><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Kambing</span></div>
            <div><strong style={{ display: 'block', fontSize: 22 }}>{mortalityRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Sheep').length}</strong><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Tupa</span></div>
          </div>
          {mortalityByCause.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {mortalityByCause.map(([causeKey, count]) => <span key={causeKey} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, color: 'var(--text)' }}>{causeKey.replace(/_/g, ' ')} · {count}</span>)}
          </div>}
          <div aria-label="Bilang ng namatay bawat buwan sa nakaraang 12 buwan" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', alignItems: 'end', gap: 5, height: 104, marginTop: 18, borderBottom: '1px solid var(--border)' }}>
            {mortalityMonthlyTrend.map((month) => {
              const maximum = Math.max(1, ...mortalityMonthlyTrend.map((item) => item.value));
              return <div key={month.key} title={`${month.label}: ${month.value}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 4 }}>
                <small style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{month.value || ''}</small>
                <div style={{ width: '100%', maxWidth: 26, height: `${Math.max(4, (month.value / maximum) * 62)}px`, borderRadius: '5px 5px 0 0', background: 'linear-gradient(180deg, #dc7068, #a9362d)' }} />
                <small style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{month.label}</small>
              </div>;
            })}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-secondary)' }}>Ang buod ay mula sa hindi naitamang mortality records. Hindi itinuturing na tiyak na sakit ang “Hindi Alam”.</p>
        </Card>
      )}
      {reportType === 'gate' && gateHistory.sessions[0] && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', margin: '8px 0 12px' }}>
          Hanggang 100 pinakabagong session · nagsimula ang huli {new Date(gateHistory.sessions[0].started_at).toLocaleString('fil-PH')} · inaasahan sa huling session: {gateHistory.sessions[0].expected_count}
        </p>
      )}

      <Card variant="glass" padding="none">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.08))' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{REPORT_LABELS[reportType]}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginTop: 2 }}>{reportData.length} talaan</div>
          </div>
          <FileBarChart size={20} color="var(--color-text-secondary, #475569)" />
        </div>
        {reportData.length === 0 ? (
          <EmptyState
            icon={<FileBarChart size={32} />}
            title="Walang datos para sa ulat na ito"
            description="Subukang baguhin ang mga filter o magdagdag ng mga bagong talaan."
          />
        ) : (
          <>
          <div className="report-table-desktop" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.08))', color: 'var(--color-text-secondary, #475569)' }}>
                  {headers.filter((h) => h !== 'source_id').map((h) => {
                    const colMap: Record<string, string> = {
                      tag_id: 'Tag ng hayop',
                      eartag_number: 'Eartag Number',
                      name: 'Pangalan',
                      species: 'Species',
                      breed: 'Breed',
                      sex: 'Kasarian',
                      weight: 'Timbang',
                      status: 'Status',
                      date: 'Petsa',
                      animal: 'Kambing / Tupa',
                      reasons: 'Dahilan',
                      expected: 'Inaasahang Panganganak',
                      notes: 'Mga Tala',
                      change: 'Pagbabago',
                      gain: 'Arawang Dagdag (kg)',
                      vaccine: 'Pangalan ng Bakuna',
                      nextDue: 'Susunod na Iskedyul',
                      vet: 'Beterinaryo',
                      category: 'Kategorya',
                      qty: 'Dami',
                      unit: 'Yunit',
                      min: 'Min Stock',
                      expiry: 'Expiry Date',
                      type: 'Uri',
                      cost: 'Halaga',
                      treatment: 'Gamot / Lunas',
                      recommendation: 'Dalas / Tagubilin',
                      item: 'Kagamitan',
                      previous_stock: 'Dating Stock',
                      new_stock: 'Bagong Stock',
                      current_balance: 'Kasalukuyang Stock',
                      total_in: 'Kabuuang Pumasok',
                      total_consumed: 'Kabuuang Nagamit',
                      cost_per_unit: 'Presyo bawat Yunit',
                      reason: 'Dahilan',
                      sold_weight: 'Timbang Bago Ibenta',
                      selling_price: 'Presyo ng Benta',
                      price_per_kg: 'Presyo / kg',
                      buyer: 'Bumibili',
                      amount_received: 'Halagang Natanggap',
                      remaining_balance: 'Natitirang Balanse',
                      event: 'Kaganapan',
                      identification: 'Animal Identification',
                      movement: 'Obserbasyon sa galaw',
                      reference: 'Reference',
                      gate: 'Gate ID',
                      session: 'Monitoring Session',
                      session_expected: 'Inaasahan sa Session',
                      camera_crossings: 'Mga Tawid sa Camera',
                      max_visible_tracks: 'Pinakamaraming Nakita Sabay',
                    };
                    const colName = h === 'source_id' ? '' : colMap[h] || reportMobileLabel(h);
                    return (
                      <th key={h} style={{ padding: '12px 16px', fontWeight: 600 }}>{colName}</th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {reportData.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.04))' }}>
                    {headers.filter((h) => h !== 'source_id').map((h) => {
                      const val = (row as Record<string, unknown>)[h];
                      return <td key={h} style={{ padding: '12px 16px' }}>{val === null || val === undefined ? '—' : String(val)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="report-cards-mobile">
            {reportData.map((row, i) => {
              const values = row as Record<string, unknown>;
              const visibleHeaders = headers.filter((key) => key !== 'source_id');
              const titleKey = visibleHeaders[0];
              return (
                <article className="report-mobile-card" key={i}>
                  <h3>{String(values[titleKey] ?? 'Ulat')}</h3>
                  <dl>
                    {visibleHeaders.filter((key) => key !== titleKey).map((key) => (
                      <div key={key}><dt>{reportMobileLabel(key)}</dt><dd>{values[key] === null || values[key] === undefined || values[key] === '' ? '—' : String(values[key])}</dd></div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
