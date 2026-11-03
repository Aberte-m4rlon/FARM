import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Baby, CalendarClock, CheckCircle2, CircleAlert, Plus, RotateCcw, Save, XCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { useFarmData } from '../../../lib/useFarmData';
import { useNotifications } from '../../../context/NotificationContext';
import { useToast } from '../../ui/Toast';
import { Button } from '../../ui/Button';
import { FormField, Input, Select } from '../../ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../../ui/Modal';
import { formatBreedingDate, localDateKey } from '../../../lib/breedingWorkflow';
import type { Animal, BreedingDueAlert, BreedingRecord, Sex, Species } from '../../../types';
import './BreedingDueAlertCenter.css';

type WorkflowStep = 'alert' | 'confirm' | 'success' | 'failed' | 'reschedule';

interface DueBreedingContext {
  due: BreedingDueAlert | null;
  breeding: BreedingRecord;
  mother: Animal;
  father: Animal | null;
}

interface NewbornDraft {
  name: string;
  sex: Sex;
  weight_kg: string;
  color_markings: string;
  notes: string;
}

const RESULT_OPTIONS = [
  { value: 'Animal Did Not Give Birth', label: 'Hindi pa nanganak' },
  { value: 'Pregnancy Loss', label: 'Nawala ang pagbubuntis' },
  { value: 'Failed', label: 'Iba pang failed na resulta' },
  { value: 'Other', label: 'Iba pa' },
];

function newNewborn(): NewbornDraft {
  return { name: '', sex: 'Female', weight_kg: '', color_markings: '', notes: '' };
}

function speciesLabel(species: Species): string {
  return species === 'Sheep' ? 'tupa' : 'kambing';
}

function breedingRequestError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (!error || typeof error !== 'object') return fallback;

  const requestError = error as { code?: unknown; message?: unknown };
  if (requestError.code === '42703' || requestError.code === 'PGRST204') {
    return 'May kulang na field sa database para ma-save ito. Pakisubukan muli pag na-update ang database.';
  }
  if (requestError.code === 'PGRST202') {
    return 'Hindi pa nakikita ng database ang kinakailangang function. I-refresh ang pahina at subukan muli.';
  }
  return typeof requestError.message === 'string' && requestError.message.trim()
    ? requestError.message
    : fallback;
}

function tomorrowKey(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDateKey(tomorrow);
}

export function BreedingDueAlertCenter() {
  const { user } = useAuth();
  const farmData = useFarmData();
  const { refresh: refreshNotifications } = useNotifications();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<DueBreedingContext[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [current, setCurrent] = useState<DueBreedingContext | null>(null);
  const [step, setStep] = useState<WorkflowStep>('alert');
  const [newborns, setNewborns] = useState<NewbornDraft[]>([newNewborn()]);
  const [birthDate, setBirthDate] = useState(localDateKey());
  const [birthTime, setBirthTime] = useState('');
  const [resultDate, setResultDate] = useState(localDateKey());
  const [failedResult, setFailedResult] = useState('Animal Did Not Give Birth');
  const [notes, setNotes] = useState('');
  const [rescheduledDate, setRescheduledDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const handledLinkRef = useRef('');

  const dueCountLabel = useMemo(() => {
    const count = alerts.length;
    return count ? `${count} hayop na due ngayon` : '';
  }, [alerts.length]);

  const loadContext = useCallback(async (breedingId: string): Promise<DueBreedingContext | null> => {
    if (!user?.id) return null;
    const [breedingResult, dueResult] = await Promise.all([
      supabase.from('breeding_records').select('*').eq('id', breedingId).eq('user_id', user.id).maybeSingle(),
      supabase.from('breeding_due_alerts').select('*').eq('breeding_id', breedingId).eq('user_id', user.id).maybeSingle(),
    ]);
    if (breedingResult.error || !breedingResult.data) return null;
    const breeding = breedingResult.data as BreedingRecord;
    const animalIds = [breeding.animal_id, breeding.partner_id].filter((id): id is string => Boolean(id));
    const animalResult = await supabase.from('animals').select('*').eq('user_id', user.id).in('id', animalIds);
    if (animalResult.error) return null;
    const animals = (animalResult.data ?? []) as Animal[];
    const mother = animals.find((animal) => animal.id === breeding.animal_id);
    if (!mother) return null;
    return {
      due: (dueResult.data as BreedingDueAlert | null) ?? null,
      breeding,
      mother,
      father: animals.find((animal) => animal.id === breeding.partner_id) ?? null,
    };
  }, [user?.id]);

  const refreshDueAlerts = useCallback(async () => {
    if (!user?.id) return;
    const today = localDateKey();
    const { data, error } = await supabase
      .from('breeding_due_alerts')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true)
      .lte('expected_due_date', today)
      .order('expected_due_date', { ascending: true });
    if (error) {
      setAlertsLoaded(true);
      return;
    }
    const dueRows = (data ?? []) as BreedingDueAlert[];
    if (!dueRows.length) {
      setAlerts([]);
      setAlertsLoaded(true);
      return;
    }
    const breedingIds = dueRows.map((row) => row.breeding_id);
    const animalIds = [...new Set(dueRows.map((row) => row.animal_id))];
    const [breedingResult, animalResult] = await Promise.all([
      supabase.from('breeding_records').select('*').eq('user_id', user.id).in('id', breedingIds),
      supabase.from('animals').select('*').eq('user_id', user.id).in('id', animalIds),
    ]);
    if (breedingResult.error || animalResult.error) {
      setAlertsLoaded(true);
      return;
    }
    const breedingMap = new Map((breedingResult.data ?? []).map((row) => [row.id, row as BreedingRecord]));
    const animalMap = new Map((animalResult.data ?? []).map((row) => [row.id, row as Animal]));
    const fatherIds = [...new Set([...breedingMap.values()].map((row) => row.partner_id).filter((id): id is string => Boolean(id)))];
    const fatherResult = fatherIds.length
      ? await supabase.from('animals').select('*').eq('user_id', user.id).in('id', fatherIds)
      : { data: [], error: null };
    if (fatherResult.error) {
      setAlertsLoaded(true);
      return;
    }
    const fatherMap = new Map((fatherResult.data ?? []).map((row) => [row.id, row as Animal]));
    const nextAlerts = dueRows.flatMap((due) => {
      const breeding = breedingMap.get(due.breeding_id);
      const mother = animalMap.get(due.animal_id);
      if (!breeding || !mother) return [];
      return [{ due, breeding, mother, father: breeding.partner_id ? fatherMap.get(breeding.partner_id) ?? null : null }];
    });
    setAlerts(nextAlerts);
    setAlertsLoaded(true);
  }, [user?.id]);

  useEffect(() => {
    setAlerts([]);
    setAlertsLoaded(false);
    setCurrent(null);
    handledLinkRef.current = '';
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const initialize = async () => {
      // The persistent API worker runs this every minute; this call also makes first-page-load alerts prompt.
      await supabase.rpc('sync_breeding_due_alerts');
      if (active) await refreshDueAlerts();
    };
    void initialize();
    const poll = window.setInterval(() => { void refreshDueAlerts(); }, 15_000);
    const channel = supabase.channel(`breeding-due-alerts:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'breeding_due_alerts', filter: `user_id=eq.${user.id}` }, () => {
        void refreshDueAlerts();
      })
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshDueAlerts]);

  useEffect(() => {
    if (current || !alerts.length) return;
    const next = alerts.find((alert) => !alert.due?.acknowledged_at);
    if (next) {
      setCurrent(next);
      setStep('alert');
      setFormError('');
    }
  }, [alerts, current]);

  useEffect(() => {
    if (!alertsLoaded || !current?.due?.active) return;
    const latest = alerts.find((alert) => alert.breeding.id === current.breeding.id);
    if (!latest || (latest.due?.acknowledged_at && !current.due.acknowledged_at)) {
      setCurrent(null);
      return;
    }
    if (latest.due?.acknowledged_at && latest.due.acknowledged_at !== current.due.acknowledged_at) {
      setCurrent(latest);
    }
  }, [alerts, alertsLoaded, current]);

  useEffect(() => {
    const breedingId = new URLSearchParams(location.search).get('breedingId');
    if (!breedingId) {
      handledLinkRef.current = '';
      return;
    }
    if (!user?.id || handledLinkRef.current === breedingId) return;
    handledLinkRef.current = breedingId;
    void loadContext(breedingId).then((context) => {
      if (!context) {
        toast('Hindi makita ang tala ng breeding na iyon sa bukid na ito.', 'warning');
        return;
      }
      setCurrent(context);
      setBirthDate(context.breeding.actual_kidding_date || localDateKey());
      setResultDate(localDateKey());
      setNewborns([newNewborn()]);
      setNotes('');
      setRescheduledDate(context.breeding.expected_kidding_date || '');
      setReason('');
      setFormError('');
      setStep(context.due?.active || context.breeding.status === 'Pregnant' ? 'alert' : 'confirm');
    });
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, user?.id, loadContext, navigate, toast]);

  const startStep = (next: WorkflowStep) => {
    setFormError('');
    if (next === 'success') {
      setBirthDate(current?.breeding.actual_kidding_date || localDateKey());
      setBirthTime('');
      setNewborns([newNewborn()]);
      setNotes('');
    }
    if (next === 'failed') {
      setResultDate(localDateKey());
      setFailedResult('Animal Did Not Give Birth');
      setNotes('');
    }
    if (next === 'reschedule') {
      setRescheduledDate(current?.breeding.expected_kidding_date || '');
      setReason('');
    }
    setStep(next);
  };

  const acknowledge = async () => {
    if (!current) return;
    setSaving(true);
    setFormError('');
    try {
      if (current.due?.active) {
        const { error } = await supabase.rpc('acknowledge_breeding_due_alert', { p_breeding_id: current.breeding.id });
        if (error) throw error;
      }
      toast('Naitala ang iyong pag-check. Aktibo pa rin ang paalala sa Breeding.', 'success');
      const acknowledgedAt = new Date().toISOString();
      setAlerts((rows) => rows.map((row) => row.breeding.id === current.breeding.id
        ? { ...row, due: row.due ? { ...row.due, acknowledged_at: row.due.acknowledged_at || acknowledgedAt } : null }
        : row));
      setCurrent(null);
      await refreshDueAlerts();
      void refreshNotifications();
    } catch (error) {
      setFormError(breedingRequestError(error, 'Hindi ma-save ang pag-check. Subukan muli.'));
    } finally {
      setSaving(false);
    }
  };

  const reschedule = async () => {
    if (!current || !rescheduledDate) {
      setFormError('Pumili ng bagong petsa ng panganganak.');
      return;
    }
    if (rescheduledDate <= localDateKey()) {
      setFormError('Pumili ng petsa bukas o sa susunod.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const { error } = await supabase.rpc('reschedule_breeding_due_date', {
        p_breeding_id: current.breeding.id,
        p_due_date: rescheduledDate,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      toast('Na-update ang inaasahang petsa. Aktibo pa rin ang pagbubuntis.', 'success');
      setAlerts((rows) => rows.filter((row) => row.breeding.id !== current.breeding.id));
      setCurrent(null);
      await Promise.all([farmData.refresh(), refreshDueAlerts(), refreshNotifications()]);
    } catch (error) {
      setFormError(breedingRequestError(error, 'Hindi nabago ang petsa. Subukan muli.'));
    } finally {
      setSaving(false);
    }
  };

  const saveBirth = async (outcome: 'successful' | 'failed') => {
    if (!current) return;
    if (outcome === 'successful') {
      const invalidName = newborns.some((newborn) => !newborn.name.trim());
      const invalidWeight = newborns.some((newborn) => newborn.weight_kg && (!Number.isFinite(Number(newborn.weight_kg)) || Number(newborn.weight_kg) <= 0));
      if (invalidName) { setFormError('Ilagay ang pangalan ng bawat bagong silang.'); return; }
      if (invalidWeight) { setFormError('Ilagay ang wastong timbang o iwanang blangko.'); return; }
      if (!birthDate) { setFormError('Ilagay ang petsa ng panganganak.'); return; }
    } else if (!resultDate || !failedResult) {
      setFormError('Ilagay ang petsa at resulta ng pag-check.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const payload = {
        p_breeding_id: current.breeding.id,
        p_outcome: outcome,
        p_event_date: outcome === 'successful' ? birthDate : resultDate,
        p_birth_time: outcome === 'successful' && birthTime ? birthTime : null,
        p_result_label: outcome === 'successful' ? 'Matagumpay na Panganganak' : failedResult,
        p_notes: notes.trim() || null,
        p_newborns: outcome === 'successful' ? newborns.map((newborn) => ({
          name: newborn.name.trim(),
          sex: newborn.sex,
          weight_kg: newborn.weight_kg ? Number(newborn.weight_kg) : null,
          color_markings: newborn.color_markings.trim() || null,
          notes: newborn.notes.trim() || null,
        })) : [],
      };
      const { data, error } = await supabase.rpc('record_breeding_birth', payload);
      if (error) throw error;
      const result = data as { already_recorded?: boolean; outcome?: string; newborns?: Array<{ tag_id: string }>; newborn_count?: number };
      if (result?.already_recorded) {
        toast('Na-save na ang resulta noon. Hindi na gumawa ng dobleng newborn.', 'info');
      } else if (outcome === 'successful') {
        const ids = (result?.newborns ?? []).map((newborn) => newborn.tag_id).filter(Boolean).join(', ');
        toast(`Naitala ang panganganak${ids ? ` at ang bagong alaga (${ids})` : ''}.`, 'success');
      } else {
        toast('Naitala ang resulta. Walang ginawang bagong alaga.', 'success');
      }
      setAlerts((rows) => rows.filter((row) => row.breeding.id !== current.breeding.id));
      setCurrent(null);
      await Promise.all([farmData.refresh(), refreshDueAlerts(), refreshNotifications()]);
    } catch (error) {
      setFormError(breedingRequestError(error, 'Hindi na-save ang resulta. Pakisubukan muli.'));
    } finally {
      setSaving(false);
    }
  };

  if (!current) return null;

  const title = step === 'alert'
    ? 'Oras na ng Panganganak'
    : step === 'confirm'
      ? 'Na-check mo na ba ang panganganak?'
      : step === 'success'
        ? `Bagong Anak na ${current.mother.species === 'Sheep' ? 'Tupa' : 'Kambing'}`
        : step === 'failed'
          ? 'Resulta ng Panganganak'
          : 'Baguhin ang Due Date';

  return (
    <Modal
      open
      onClose={() => undefined}
      size="lg"
      className="breeding-due-alert-modal"
      closeOnEsc={false}
      closeOnOverlayClick={false}
      aria-label={title}
    >
      <ModalHeader
        title={title}
        subtitle={step === 'alert' ? dueCountLabel : 'Itatala ito sa kasaysayan ng alaga.'}
        icon={step === 'failed' ? <XCircle size={20} /> : step === 'success' ? <Baby size={20} /> : <CalendarClock size={20} />}
      />
      <ModalBody className="breeding-due-alert-body">
        <div className="breeding-due-animal-summary">
          <div className="breeding-due-animal-mark" aria-hidden="true">{current.mother.name?.trim()?.[0]?.toUpperCase() || 'A'}</div>
          <div className="breeding-due-animal-copy">
            <strong>{current.mother.name}</strong>
            <span>{current.mother.tag_id} · {current.mother.species === 'Sheep' ? 'Tupa' : 'Kambing'}</span>
            <span>Inaasahang panganganak: {formatBreedingDate(current.breeding.expected_kidding_date)}</span>
          </div>
          {current.father && (
            <div className="breeding-due-father">Barako: {current.father.name} ({current.father.tag_id})</div>
          )}
        </div>

        {step === 'alert' && (
          <div className="breeding-due-message">
            <AlertTriangle size={19} aria-hidden="true" />
            <p>Posibleng manganak na si {current.mother.name}. Pakitingnan ang kulungan at i-record ang aktuwal na resulta. Hindi pa itinuturing na nanganak hangga't hindi mo ito itinatala.</p>
          </div>
        )}

        {step === 'confirm' && (
          <div className="breeding-result-choice">
            <p>Itala lamang ang aktuwal na resulta pagkatapos mong tingnan ang alaga.</p>
            <div className="breeding-result-actions">
              <Button variant="primary" onClick={() => startStep('success')} leftIcon={<CheckCircle2 size={18} />}>
                Successful
              </Button>
              <Button variant="secondary" onClick={() => startStep('failed')} leftIcon={<XCircle size={18} />}>
                Failed
              </Button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="breeding-birth-form">
            <div className="breeding-birth-form-intro">Awtomatikong itatala ang {speciesLabel(current.mother.species)}, inahin, at barako kung mayroon.</div>
            <div className="breeding-birth-fields">
              <FormField label="Petsa ng Panganganak" required>
                <Input type="date" max={localDateKey()} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
              </FormField>
              <FormField label="Oras (opsyonal)">
                <Input type="time" value={birthTime} onChange={(event) => setBirthTime(event.target.value)} />
              </FormField>
            </div>
            {newborns.map((newborn, index) => (
              <section className="breeding-newborn-card" key={index}>
                <div className="breeding-newborn-heading">
                  <strong>Bagong silang {index + 1}</strong>
                  {newborns.length > 1 && (
                    <button type="button" className="breeding-remove-newborn" onClick={() => setNewborns((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Alisin ang bagong silang ${index + 1}`}>
                      Alisin
                    </button>
                  )}
                </div>
                <div className="breeding-birth-fields">
                  <FormField label="Pangalan" required>
                    <Input value={newborn.name} placeholder="Pangalan ng alaga" onChange={(event) => setNewborns((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} />
                  </FormField>
                  <FormField label="Kasarian" required>
                    <Select value={newborn.sex} onChange={(event) => setNewborns((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, sex: event.target.value as Sex } : row))} options={[
                      { value: 'Female', label: 'Babae' },
                      { value: 'Male', label: 'Lalaki' },
                    ]} />
                  </FormField>
                  <FormField label="Timbang sa kapanganakan (kg) · opsyonal">
                    <Input type="number" min="0.1" max="100" step="0.01" value={newborn.weight_kg} placeholder="Hal. 3.2" onChange={(event) => setNewborns((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, weight_kg: event.target.value } : row))} />
                  </FormField>
                  <FormField label="Kulay / marka · opsyonal">
                    <Input value={newborn.color_markings} placeholder="Kulay o natatanging marka" onChange={(event) => setNewborns((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, color_markings: event.target.value } : row))} />
                  </FormField>
                </div>
                <FormField label="Tala para sa bagong silang · opsyonal">
                  <Input value={newborn.notes} placeholder="Maikling tala" onChange={(event) => setNewborns((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} />
                </FormField>
              </section>
            ))}
            <Button variant="secondary" className="breeding-add-newborn" onClick={() => setNewborns((rows) => rows.length < 12 ? [...rows, newNewborn()] : rows)} disabled={newborns.length >= 12} leftIcon={<Plus size={16} />}>
              Add Newborn
            </Button>
            <FormField label="Tala sa panganganak · opsyonal">
              <textarea className="form-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Pangkalahatang tala tungkol sa panganganak" rows={3} />
            </FormField>
          </div>
        )}

        {step === 'failed' && (
          <div className="breeding-failed-form">
            <div className="breeding-failed-note"><CircleAlert size={17} /> Itatago ang resulta sa kasaysayan. Walang gagawing bagong hayop.</div>
            <div className="breeding-birth-fields">
              <FormField label="Resulta" required>
                <Select value={failedResult} onChange={(event) => setFailedResult(event.target.value)} options={RESULT_OPTIONS} />
              </FormField>
              <FormField label="Petsa ng pag-check" required>
                <Input type="date" max={localDateKey()} value={resultDate} onChange={(event) => setResultDate(event.target.value)} />
              </FormField>
            </div>
            <FormField label="Dahilan / Tala · opsyonal">
              <textarea className="form-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Isulat ang napansin, kung mayroon" rows={3} />
            </FormField>
          </div>
        )}

        {step === 'reschedule' && (
          <div className="breeding-reschedule-form">
            <p>Mananatiling buntis ang record. Pumili ng bagong petsa na susuriin ng system.</p>
            <FormField label="Bagong inaasahang petsa" required>
              <Input type="date" min={tomorrowKey()} value={rescheduledDate} onChange={(event) => setRescheduledDate(event.target.value)} />
            </FormField>
            <FormField label="Dahilan / Tala · opsyonal">
              <textarea className="form-textarea" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Hal. Hindi pa nagpapakita ng senyales ng panganganak" rows={3} />
            </FormField>
          </div>
        )}

        {formError && <div className="breeding-form-error" role="alert">{formError}</div>}
      </ModalBody>

      <ModalFooter className="breeding-due-alert-footer">
        {step === 'alert' && <>
          <Button variant="secondary" onClick={acknowledge} loading={saving} leftIcon={<CheckCircle2 size={16} />}>Hindi Pa</Button>
          <Button variant="secondary" onClick={() => startStep('reschedule')} leftIcon={<RotateCcw size={16} />}>Baguhin ang Due Date</Button>
          <Button variant="primary" onClick={() => startStep('confirm')} leftIcon={<Baby size={16} />}>May Panganganak</Button>
        </>}
        {step === 'confirm' && <>
          <Button variant="secondary" onClick={() => current.breeding.status === 'Pregnant' ? setStep('alert') : setCurrent(null)}>
            {current.breeding.status === 'Pregnant' ? 'Bumalik' : 'Isara'}
          </Button>
          {current.breeding.status === 'Pregnant' && <>
            <Button variant="secondary" onClick={acknowledge} loading={saving}>Hindi Pa</Button>
            <Button variant="secondary" onClick={() => startStep('reschedule')}>Baguhin ang Due Date</Button>
          </>}
        </>}
        {step === 'success' && <>
          <Button variant="secondary" onClick={() => setStep('confirm')} disabled={saving}>Bumalik</Button>
          <Button variant="primary" onClick={() => void saveBirth('successful')} loading={saving} leftIcon={<Save size={16} />}>I-save ang Panganganak</Button>
        </>}
        {step === 'failed' && <>
          <Button variant="secondary" onClick={() => setStep('confirm')} disabled={saving}>Bumalik</Button>
          <Button variant="primary" onClick={() => void saveBirth('failed')} loading={saving} leftIcon={<Save size={16} />}>I-save ang Resulta</Button>
        </>}
        {step === 'reschedule' && <>
          <Button variant="secondary" onClick={() => setStep('alert')} disabled={saving}>Bumalik</Button>
          <Button variant="primary" onClick={() => void reschedule()} loading={saving} leftIcon={<Save size={16} />}>I-save ang Bagong Petsa</Button>
        </>}
      </ModalFooter>
    </Modal>
  );
}
