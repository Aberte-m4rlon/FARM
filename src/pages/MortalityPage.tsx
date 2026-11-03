import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, RotateCcw } from 'lucide-react';
import type { MortalityCause, MortalityRecord } from '../types';
import { useFarmData } from '../lib/useFarmData';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/analytics';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { FilterDateRange, FilterSearch, FilterSelect, FilterToolbar } from '../components/FilterToolbar';
import { FormField, Textarea } from '../components/ui/Input';
import { ConfirmDialog, Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import './MortalityPage.css';

const CAUSE_LABELS: Record<MortalityCause, string> = {
  disease: 'Sakit / Disease',
  accident: 'Aksidente / Accident',
  birthing_complication: 'Panganganak / Birthing Complication',
  unknown: 'Hindi Alam / Unknown',
  other: 'Iba Pa / Other',
};

interface MortalityListItem {
  record: MortalityRecord;
  animal: ReturnType<typeof useFarmData>['animals'][number] | undefined;
}

export function MortalityPage() {
  const farmData = useFarmData();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [species, setSpecies] = useState('All');
  const [cause, setCause] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [correctionTarget, setCorrectionTarget] = useState<MortalityListItem | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [correcting, setCorrecting] = useState(false);

  const activeRecords = useMemo(() => farmData.mortalityRecords.filter((record) => !record.corrected_at), [farmData.mortalityRecords]);
  const records = useMemo<MortalityListItem[]>(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return activeRecords
      .map((record) => ({ record, animal: farmData.animals.find((animal) => animal.id === record.animal_id) }))
      .filter(({ animal }) => !species || species === 'All' || animal?.species === species)
      .filter(({ record }) => !cause || cause === 'All' || record.cause_of_death === cause)
      .filter(({ record }) => (!dateFrom || record.date_of_death >= dateFrom) && (!dateTo || record.date_of_death <= dateTo))
      .filter(({ animal, record }) => !normalizedSearch || [
        animal?.name,
        animal?.tag_id,
        animal?.eartag_number === null || animal?.eartag_number === undefined ? '' : String(animal.eartag_number),
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch)))
      .sort((a, b) => b.record.date_of_death.localeCompare(a.record.date_of_death));
  }, [activeRecords, farmData.animals, search, species, cause, dateFrom, dateTo]);

  const deceasedGoats = activeRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Goat').length;
  const deceasedSheep = activeRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Sheep').length;

  const openCorrection = (item: MortalityListItem) => {
    setCorrectionTarget(item);
    setCorrectionReason('');
    setConfirmCorrection(false);
  };

  const closeCorrection = () => {
    if (correcting) return;
    setCorrectionTarget(null);
    setCorrectionReason('');
    setConfirmCorrection(false);
  };

  const saveCorrection = async () => {
    if (!correctionTarget || !correctionReason.trim()) return;
    setCorrecting(true);
    try {
      const { error } = await supabase.rpc('correct_animal_death', {
        p_mortality_record_id: correctionTarget.record.id,
        p_correction_reason: correctionReason.trim(),
      });
      if (error) throw error;
      toast('Naibalik ang status. Nananatili ang dating mortality record sa profile at audit history.', 'success');
      setCorrectionTarget(null);
      setCorrectionReason('');
      setConfirmCorrection(false);
      await farmData.refresh();
    } catch (error) {
      console.error('Unable to correct mortality status:', error);
      toast('Hindi naitama ang status. I-refresh ang tala at subukan muli.', 'error');
    } finally {
      setCorrecting(false);
    }
  };

  const getCause = (record: MortalityRecord) => record.cause_of_death === 'other'
    ? `${CAUSE_LABELS.other}: ${record.cause_details || 'Hindi tinukoy'}`
    : CAUSE_LABELS[record.cause_of_death];

  return (
    <main className="mortality-page">
      <header className="mortality-heading">
        <div>
          <h1>Mga Namatay na Hayop</h1>
          <p>Mga naitalang kambing at tupa. Nananatili ang buong kasaysayan ng bawat hayop.</p>
        </div>
      </header>

      <section className="mortality-summary" aria-label="Kabuuang tala ng namatay na hayop">
        <Card padding="md"><span>Kambing</span><strong>{deceasedGoats}</strong><small>Namatay</small></Card>
        <Card padding="md"><span>Tupa</span><strong>{deceasedSheep}</strong><small>Namatay</small></Card>
        <Card padding="md"><span>Kabuuan</span><strong>{activeRecords.length}</strong><small>Namatay na hayop</small></Card>
      </section>

      <FilterToolbar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Maghanap ng pangalan, Animal ID, o eartag..." />
        <FilterSelect value={species} onChange={setSpecies} ariaLabel="Salain ayon sa uri" options={[
          { value: 'All', label: 'Kambing at Tupa' }, { value: 'Goat', label: 'Kambing' }, { value: 'Sheep', label: 'Tupa' },
        ]} />
        <FilterSelect value={cause} onChange={setCause} ariaLabel="Salain ayon sa dahilan" options={[
          { value: 'All', label: 'Lahat ng dahilan' }, ...Object.entries(CAUSE_LABELS).map(([value, label]) => ({ value, label })),
        ]} />
        <FilterDateRange fromValue={dateFrom} toValue={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
      </FilterToolbar>

      <Card padding="none" className="mortality-list-card">
        {records.length === 0 ? (
          <div className="mortality-empty">
            <EmptyState icon={<AlertTriangle size={34} />} title={activeRecords.length ? 'Walang tugmang mortality record' : 'Wala pang namatay na naitala'} description={activeRecords.length ? 'Baguhin ang paghahanap o mga filter.' : 'Kapag nagtala ka ng pagkamatay sa animal profile, lalabas dito ang rekord.'} />
          </div>
        ) : (
          <>
            <div className="mortality-table-wrap">
              <table className="mortality-table">
                <thead><tr><th>Hayop</th><th>Uri / Lahi</th><th>Petsa ng pagkamatay</th><th>Dahilan</th><th>Naitala ni</th><th>Aksyon</th></tr></thead>
                <tbody>
                  {records.map((item) => (
                    <tr key={item.record.id}>
                      <td><button className="mortality-animal-link" onClick={() => item.animal && navigate(`/animals/${item.animal.id}`)}>{item.animal?.name ?? 'Hindi nahanap'}<small>{item.animal?.tag_id ?? item.record.animal_id} · Eartag {item.animal?.eartag_number ?? '—'}</small></button></td>
                      <td>{item.animal?.species === 'Sheep' ? 'Tupa' : 'Kambing'}{item.animal?.breed ? <small>{item.animal.breed}</small> : null}</td>
                      <td>{formatDate(item.record.date_of_death)}</td>
                      <td>{getCause(item.record)}</td>
                      <td>{item.record.recorded_by_name || 'Farm user'}<small>{formatDate(item.record.recorded_at)}</small></td>
                      <td className="mortality-row-actions">
                        {item.animal && <Button size="sm" variant="outline" onClick={() => navigate(`/animals/${item.animal!.id}`)}>Profile</Button>}
                        {user?.id === item.record.user_id && <Button size="sm" variant="secondary" leftIcon={<RotateCcw size={14} />} onClick={() => openCorrection(item)}>Itama ang Status</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mortality-mobile-list">
              {records.map((item) => (
                <article className="mortality-mobile-card" key={item.record.id}>
                  <div className="mortality-mobile-heading">
                    <div>
                      <strong>{item.animal?.name ?? 'Hindi nahanap'}</strong>
                      <small>{item.animal?.tag_id ?? item.record.animal_id} · Eartag {item.animal?.eartag_number ?? '—'} · {item.animal?.species === 'Sheep' ? 'Tupa' : 'Kambing'}{item.animal?.breed ? ` · ${item.animal.breed}` : ''}</small>
                    </div>
                    <span>NAMATAY NA</span>
                  </div>
                  <div className="mortality-mobile-fields">
                    <div><span><CalendarDays size={14} /> Petsa</span><strong>{formatDate(item.record.date_of_death)}</strong></div>
                    <div><span>Dahilan</span><strong>{getCause(item.record)}</strong></div>
                    <div><span>Naitala ni</span><strong>{item.record.recorded_by_name || 'Farm user'}</strong></div>
                  </div>
                  <div className="mortality-mobile-actions">
                    {item.animal && <Button size="sm" variant="outline" onClick={() => navigate(`/animals/${item.animal!.id}`)}>Tingnan Profile</Button>}
                    {user?.id === item.record.user_id && <Button size="sm" variant="secondary" leftIcon={<RotateCcw size={14} />} onClick={() => openCorrection(item)}>Itama ang Status</Button>}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </Card>

      <Modal open={Boolean(correctionTarget) && !confirmCorrection} onClose={closeCorrection} size="md" closeOnOverlayClick={!correcting}>
        <ModalHeader title="Itama ang Status" subtitle="Ire-record ang paliwanag at pananatilihin ang orihinal na mortality history." onClose={closeCorrection} />
        <ModalBody>
          <p style={{ marginTop: 0, lineHeight: 1.5 }}>Ibabalik sa naunang status ang {correctionTarget?.animal?.name ?? 'hayop'} kapag nakumpirma ang pagwawasto.</p>
          <FormField label="Paliwanag sa pagwawasto" required helperText="Mananatili ito sa activity history.">
            <Textarea rows={4} maxLength={2000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Bakit kailangang itama ang status?" />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeCorrection} disabled={correcting}>Kanselahin</Button>
          <Button variant="warning" onClick={() => setConfirmCorrection(true)} disabled={!correctionReason.trim()}>Suriin at Kumpirmahin</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        open={confirmCorrection && Boolean(correctionTarget)}
        title="Kumpirmahin ang pagwawasto"
        message={<span>Sigurado ka bang ibabalik sa naunang status si <strong>{correctionTarget?.animal?.name ?? 'hayop'}</strong>? Hindi buburahin ang orihinal na mortality record. <br /><br /><strong>Paliwanag:</strong> {correctionReason}</span>}
        confirmLabel="Itama ang Status"
        cancelLabel="Bumalik"
        variant="warning"
        loading={correcting}
        onCancel={() => setConfirmCorrection(false)}
        onConfirm={saveCorrection}
      />
    </main>
  );
}
