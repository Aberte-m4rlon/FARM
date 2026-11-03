import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ClipboardList, Pill, Plus, Search } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { MedicationTreatmentModal } from '../components/domain/health/MedicationTreatmentModal';
import { useFarmData } from '../lib/useFarmData';

type TreatmentRow = {
  id: string;
  date: string;
  animalId: string;
  medicine: string;
  dosage: string;
  frequency: string;
  status: string;
  notes: string;
};

function statusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'ongoing' || normalized.includes('kasalukuyan')) return 'Kasalukuyan';
  if (normalized === 'scheduled' || normalized.includes('pending')) return 'Nakatakda';
  if (normalized === 'completed' || normalized.includes('tapos')) return 'Tapos na';
  if (normalized === 'discontinued') return 'Itinigil';
  if (normalized.includes('bantayan') || normalized.includes('monitor')) return 'Bantayan';
  return status || 'Naibigay';
}

export function TreatmentsPage() {
  const farmData = useFarmData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [treatmentModalOpen, setTreatmentModalOpen] = useState(false);
  const preselectedAnimalId = searchParams.get('animalId') || undefined;

  useEffect(() => {
    if (searchParams.get('action') !== 'add') return;
    setTreatmentModalOpen(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    nextParams.delete('animalId');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const rows = useMemo<TreatmentRow[]>(() => {
    const planned = farmData.treatmentRecords.map((record) => ({
      id: `treatment-${record.id}`,
      date: record.start_date,
      animalId: record.animal_id,
      medicine: record.medicine_name,
      dosage: `${record.dosage} ${record.unit}`.trim(),
      frequency: record.frequency,
      status: statusLabel(record.status),
      notes: record.treatment_notes || '',
    }));

    const administered = farmData.inventoryUsage.map((usage) => {
      const itemName = farmData.inventory.find((item) => item.id === usage.inventory_id)?.name;
      const notedMedicine = usage.notes?.match(/Gamot:\s*([^|]+)/i)?.[1]?.trim();
      return {
        id: `usage-${usage.id}`,
        date: usage.usage_date,
        animalId: usage.animal_id || '',
        medicine: itemName || notedMedicine || 'Gamot mula sa imbentaryo',
        dosage: usage.dosage || `${usage.quantity_used} ${usage.unit}`,
        frequency: usage.frequency || '—',
        status: statusLabel(usage.treatment_status || 'Naibigay'),
        notes: usage.notes || usage.reason || '',
      };
    });

    return [...planned, ...administered]
      .filter((row) => {
        if (!search.trim()) return true;
        const animal = farmData.animals.find((item) => item.id === row.animalId);
        const haystack = [row.medicine, row.dosage, row.status, row.notes, animal?.name, animal?.tag_id]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return haystack.includes(search.trim().toLocaleLowerCase());
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [farmData.animals, farmData.inventory, farmData.inventoryUsage, farmData.treatmentRecords, search]);

  const openModal = () => setTreatmentModalOpen(true);

  return (
    <div className="page-container" style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', color: '#238B45', background: 'rgba(35,139,69,.10)' }}>
            <Pill size={23} />
          </span>
          <div>
            <h1 style={{ margin: 0, color: 'var(--text)', fontSize: 24, fontWeight: 850 }}>Treatment Records (Mga Tala ng Paggamot)</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Tingnan at itala ang mga gamutang naibigay sa mga alaga.</p>
          </div>
        </div>
        <Button variant="primary" onClick={openModal} leftIcon={<Plus size={17} />}>Mag-record ng Gamutan</Button>
      </header>

      <section className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Search size={18} color="var(--text-secondary)" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Maghanap ng alaga o gamot..."
          aria-label="Maghanap ng alaga o gamot"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, color: 'var(--text)', background: 'transparent', font: 'inherit' }}
        />
      </section>

      {farmData.loadError && (
        <div role="alert" className="card" style={{ padding: 16, borderColor: '#ef4444', color: 'var(--text)' }}>
          Hindi makuha ang ilang tala sa gamutan. Subukan muli mamaya.
        </div>
      )}

      <section className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <ClipboardList size={18} color="#238B45" />
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Kasaysayan ng Gamutan</h2>
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 13 }}>{rows.length} tala</span>
        </div>

        {farmData.loading ? (
          <div role="status" style={{ padding: 28, color: 'var(--text-secondary)' }}>Kinukuha ang mga naitalang gamutan…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={<CalendarDays size={28} />}
              title={search ? 'Walang katugmang tala' : 'Wala pang naitatalang gamutan'}
              description={search ? 'Subukan ang ibang pangalan, eartag, o gamot.' : 'Kapag may gamot na naitala, lalabas dito ang aktuwal na treatment record.'}
            >
              {!search && <Button variant="secondary" onClick={openModal}>Mag-record ng Gamutan</Button>}
            </EmptyState>
          </div>
        ) : (
          <>
          <div className="table-wrap treatment-table-desktop">
            <table className="data-table">
              <thead>
                <tr><th>Petsa</th><th>Kambing / Tupa</th><th>Gamot</th><th>Dosis</th><th>Dalas</th><th>Status</th><th>Tala</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const animal = farmData.animals.find((item) => item.id === row.animalId);
                  return (
                    <tr key={row.id}>
                      <td>{row.date ? new Date(row.date).toLocaleDateString('fil-PH') : '—'}</td>
                      <td>{animal ? <Link to={`/animals/${animal.id}`} style={{ color: 'var(--color-primary, #238B45)', fontWeight: 700 }}>{animal.name || animal.tag_id} · {animal.tag_id}</Link> : 'Hindi naka-link sa alaga'}</td>
                      <td style={{ fontWeight: 700 }}>{row.medicine}</td>
                      <td>{row.dosage || '—'}</td>
                      <td>{row.frequency || '—'}</td>
                      <td>{row.status}</td>
                      <td style={{ maxWidth: 280, whiteSpace: 'normal' }}>{row.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="treatment-cards-mobile">
            {rows.map((row) => {
              const animal = farmData.animals.find((item) => item.id === row.animalId);
              return (
                <article className="treatment-mobile-card" key={row.id}>
                  <div className="treatment-mobile-heading">
                    <div><strong>{row.medicine}</strong><span>{animal?.name || animal?.tag_id || 'Hindi naka-link sa alaga'}</span></div>
                    <span>{row.status}</span>
                  </div>
                  <div className="treatment-mobile-details">
                    <span>Petsa: {row.date ? new Date(row.date).toLocaleDateString('fil-PH') : 'Walang petsa'}</span>
                    <span>Dosis: {row.dosage || 'Hindi nakatala'}</span>
                    <span>Dalas: {row.frequency || 'Hindi nakatala'}</span>
                    {row.notes && <span>Tala: {row.notes}</span>}
                  </div>
                  {animal && <Link to={`/animals/${animal.id}`} className="treatment-mobile-animal-link">Tingnan ang alaga</Link>}
                </article>
              );
            })}
          </div>
          </>
        )}
      </section>

      <MedicationTreatmentModal
        open={treatmentModalOpen}
        onClose={() => setTreatmentModalOpen(false)}
        preselectedAnimalId={preselectedAnimalId}
        animals={farmData.animals}
        onSuccess={() => { void farmData.refresh(); }}
      />
    </div>
  );
}
