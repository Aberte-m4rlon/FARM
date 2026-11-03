import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Animal, MortalityCause } from '../../../types';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../ui/Toast';
import { Button } from '../../ui/Button';
import { FormField, Input, Select, Textarea } from '../../ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader, ConfirmDialog } from '../../ui/Modal';
import { useFarmData } from '../../../lib/useFarmData';

interface MortalityRecordModalProps {
  animal: Animal;
  open: boolean;
  onClose: () => void;
}

interface MortalityForm {
  dateOfDeath: string;
  estimatedTime: string;
  cause: MortalityCause;
  causeDetails: string;
  symptoms: string;
  previousHealth: string;
  previousTreatment: string;
  notes: string;
}

function localDateValue(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

const INITIAL_FORM = (): MortalityForm => ({
  dateOfDeath: localDateValue(),
  estimatedTime: '',
  cause: 'unknown',
  causeDetails: '',
  symptoms: '',
  previousHealth: '',
  previousTreatment: '',
  notes: '',
});

const CAUSE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Hindi Alam / Unknown', value: 'unknown' },
  { label: 'Sakit / Disease', value: 'disease' },
  { label: 'Aksidente / Accident', value: 'accident' },
  { label: 'Panganganak / Birthing Complication', value: 'birthing_complication' },
  { label: 'Iba Pa / Other', value: 'other' },
];

function errorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/naibenta|sale record/i.test(message)) return 'Hindi maaaring itala o ibalik ang status ng hayop na may record ng benta.';
  if (/aktibo nang mortality|kasalukuyan nang tala/i.test(message)) return 'May kasalukuyan nang mortality record para sa hayop na ito.';
  if (/pahintulot|authorize|unauthorized/i.test(message)) return 'Wala kang pahintulot na magtala para sa hayop na ito.';
  if (/wastong petsa/i.test(message)) return 'Pumili ng petsang hindi lalampas sa araw na ito.';
  if (/ibang dahilan/i.test(message)) return 'Ilagay ang detalye ng ibang dahilan.';
  return 'Hindi na-save ang mortality record. Pakisubukan muli.';
}

export function MortalityRecordModal({ animal, open, onClose }: MortalityRecordModalProps) {
  const toast = useToast();
  const farmData = useFarmData();
  const [form, setForm] = useState<MortalityForm>(INITIAL_FORM);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const speciesLabel = animal.species === 'Goat' ? 'Kambing' : 'Tupa';
  const today = useMemo(() => localDateValue(), []);

  const close = () => {
    if (saving) return;
    setShowConfirmation(false);
    setFormError('');
    onClose();
  };

  const submitForConfirmation = () => {
    setFormError('');
    if (!form.dateOfDeath || form.dateOfDeath > today) {
      setFormError('Pumili ng petsang hindi lalampas sa araw na ito.');
      return;
    }
    if (form.cause === 'other' && !form.causeDetails.trim()) {
      setFormError('Ilagay ang detalye ng ibang dahilan.');
      return;
    }
    setShowConfirmation(true);
  };

  const recordDeath = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_animal_death', {
        p_animal_id: animal.id,
        p_date_of_death: form.dateOfDeath,
        p_estimated_time: form.estimatedTime || null,
        p_cause_of_death: form.cause,
        p_cause_details: form.causeDetails.trim() || null,
        p_symptoms_before_death: form.symptoms.trim() || null,
        p_previous_health_status: form.previousHealth.trim() || null,
        p_previous_treatment: form.previousTreatment.trim() || null,
        p_notes: form.notes.trim() || null,
      });
      if (error) throw error;
      toast(`${speciesLabel} naitala na bilang namatay.`, 'success');
      setShowConfirmation(false);
      onClose();
      await farmData.refresh();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={close} size="lg" closeOnOverlayClick={!saving}>
        <ModalHeader
          title="I-record bilang Namatay"
          subtitle={`${animal.name} · ${speciesLabel} · Animal ID ${animal.tag_id} · Eartag ${animal.eartag_number ?? '—'}`}
          onClose={close}
        />
        <ModalBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0 14px' }}>
            <FormField label="Petsa ng Pagkamatay" required>
              <Input type="date" max={today} value={form.dateOfDeath} onChange={(event) => setForm((current) => ({ ...current, dateOfDeath: event.target.value }))} />
            </FormField>
            <FormField label="Tinatayang Oras" helperText="Opsyonal">
              <Input type="time" value={form.estimatedTime} onChange={(event) => setForm((current) => ({ ...current, estimatedTime: event.target.value }))} />
            </FormField>
            <FormField label="Dahilan ng Pagkamatay" required>
              <Select value={form.cause} options={CAUSE_OPTIONS} onChange={(event) => setForm((current) => ({ ...current, cause: event.target.value as MortalityCause }))} />
            </FormField>
            {form.cause === 'other' && (
              <FormField label="Detalye ng Iba Pa" required>
                <Input maxLength={500} value={form.causeDetails} onChange={(event) => setForm((current) => ({ ...current, causeDetails: event.target.value }))} placeholder="Ilarawan ang dahilan" />
              </FormField>
            )}
            <FormField label="Kalagayan ng Kalusugan Bago Namatay" helperText="Opsyonal">
              <Input maxLength={500} value={form.previousHealth} onChange={(event) => setForm((current) => ({ ...current, previousHealth: event.target.value }))} placeholder="Hal. may sakit o maayos" />
            </FormField>
            <FormField label="Dating Gamutan" helperText="Opsyonal">
              <Input maxLength={500} value={form.previousTreatment} onChange={(event) => setForm((current) => ({ ...current, previousTreatment: event.target.value }))} placeholder="Gamot o treatment na naitala dati" />
            </FormField>
            <FormField label="Mga Sintomas Bago Namatay" helperText="Opsyonal" style={{ gridColumn: '1 / -1' }}>
              <Textarea rows={3} maxLength={3000} value={form.symptoms} onChange={(event) => setForm((current) => ({ ...current, symptoms: event.target.value }))} placeholder="Mga napansing sintomas, kung mayroon" />
            </FormField>
            <FormField label="Karagdagang Tala" helperText="Opsyonal" style={{ gridColumn: '1 / -1' }}>
              <Textarea rows={3} maxLength={3000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Iba pang impormasyong dapat mapanatili" />
            </FormField>
          </div>
          {formError && <p role="alert" style={{ margin: '0 0 12px', color: 'var(--color-danger, #b42318)', fontSize: 13 }}>{formError}</p>}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, background: 'rgba(245, 158, 11, .10)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5 }}>
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1, color: '#9a6700' }} />
            <span>Hindi kailangang maghula ng sanhi. Puwedeng piliin ang <strong>Hindi Alam / Unknown</strong>.</span>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={close} disabled={saving}>Kanselahin</Button>
          <Button variant="danger" onClick={submitForConfirmation}>Ituloy</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        open={showConfirmation}
        title="Kumpirmahin ang mortality record"
        message={(
          <div>
            <p style={{ marginTop: 0 }}><strong>Sigurado ka bang itatala bilang namatay ang hayop na ito?</strong></p>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              <li>Hindi na ito isasama sa bilang at pagpili ng mga aktibong hayop.</li>
              <li>Mananatili ang dating health, treatment, breeding, benta, at iba pang kasaysayan.</li>
              <li>Lalabas ang tala sa Mga Namatay na Hayop.</li>
              <li>Hindi mababago ang animal ID at hindi buburahin ang profile.</li>
            </ul>
          </div>
        )}
        confirmLabel="Oo, itala bilang namatay"
        cancelLabel="Bumalik"
        variant="danger"
        loading={saving}
        onCancel={() => setShowConfirmation(false)}
        onConfirm={recordDeath}
      />
    </>
  );
}
