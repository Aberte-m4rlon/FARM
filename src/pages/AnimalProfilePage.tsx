import { Fragment, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useFarmData } from '../lib/useFarmData';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/auth';
import { Icons } from '../lib/icons';
import { Modal, ModalHeader, ModalBody, ModalFooter, ConfirmDialog } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input, Select, FormField } from '../components/ui/Input';
import { compressImageFile, streamChat } from '../lib/myai';
import {
  ageLabel,
  formatDate,
  daysUntil,
} from '../lib/analytics';
import { Line } from 'react-chartjs-2';
import {
  ArrowLeft,
  CheckCircle2,
  QrCode,
  Camera,
  Pencil,
  Archive,
  Plus,
  Heart,
  Scale,
  Syringe,
  AlertTriangle,
  Activity,
  Package,
  DollarSign,
  Info,
  Pill,
  Stethoscope,
  ClipboardList,
  LogIn,
  LogOut,
  Bell,
  History,
  RotateCcw,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import type { Animal, BreedingBirthEvent, Species, Sex } from '../types';
import { MortalityRecordModal } from '../components/domain/animals/MortalityRecordModal';
import { isAnimalActive, isAnimalDeceased } from '../lib/animalLifecycle';
import {
  MedicationTreatmentModal,
  AnimalQRCardModal,
  HealthCaseModal,
} from '../components/domain/health';

type AnimalGateEvent = {
  id: string;
  session_id: string;
  gate_id: string;
  direction: 'entry' | 'exit';
  species_detected: string;
  qr_verified: boolean;
  eartag_verified?: boolean;
  eartag_number?: string | null;
  confidence: number;
  tracking_id: string | null;
  movement_observation?: 'normal' | 'slow_approach' | 'prolonged_stop';
  created_at: string;
};

type AnimalGateCrossing = {
  id: string;
  session_id: string;
  gate_id: string;
  tracking_id: string;
  species_detected: string;
  direction: 'entry' | 'exit';
  confidence: number;
  movement_observation: 'normal' | 'slow_approach' | 'prolonged_stop';
  created_at: string;
  animal_id: string | null;
  qr_verified: boolean;
  eartag_verified?: boolean;
  eartag_number?: string | null;
};

type AnimalGateAlert = {
  id: string;
  session_id: string;
  alert_type: string;
  message: string;
  status: 'active' | 'acknowledged' | 'resolved';
  created_at: string;
  resolved_at: string | null;
};

type AnimalActivity = {
  id: string;
  actor_name: string | null;
  module: string;
  action: string;
  entity_id: string | null;
  entity_name: string | null;
  status: 'success' | 'failure';
  details: Record<string, unknown>;
  created_at: string;
};

type AnimalCameraHealthScreening = {
  id: string;
  visible_status: 'healthy' | 'watch' | 'attention' | null;
  detected_species: string | null;
  observed_concern: string | null;
  affected_area: string | null;
  recommendation: string | null;
  created_at: string;
};

// ─── Status helpers ────────────────────────────────────────────────────────────
// ─── Reusable StatRow ──────────────────────────────────────────────────────────
function StatRow({ label, value, valueStyle, variant = 'row' }: {
  label: string;
  value: React.ReactNode;
  valueStyle?: React.CSSProperties;
  variant?: 'row' | 'tile';
}) {
  if (variant === 'tile') {
    return (
      <div className="animal-profile-stat-tile">
        <span className="animal-profile-stat-label">{label}</span>
        <span className="animal-profile-stat-value" style={valueStyle}>{value}</span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid var(--border-light)',
      gap: 12, minWidth: 0,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textAlign: 'right', minWidth: 0, wordBreak: 'break-word', ...valueStyle }}>
        {value}
      </span>
    </div>
  );
}

function formatCameraHistoryTime(value: string | null | undefined): string {
  if (!value) return '0';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '0' : new Intl.DateTimeFormat('fil-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatFarmerLastSeen(value: string | null | undefined): string {
  if (!value) return 'Hindi pa nakikita';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Hindi pa nakikita';
  return date.toDateString() === new Date().toDateString() ? 'Ngayon' : formatCameraHistoryTime(value);
}

// ─── Glass Card ───────────────────────────────────────────────────────────────
function GlassCard({
  children, style, gridSpan,
}: { children: React.ReactNode; style?: React.CSSProperties; gridSpan?: number }) {
  return (
    <div style={{
      background: 'var(--glass-surface)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      padding: '20px 22px',
      position: 'relative' as const,
      overflow: 'hidden',
      minWidth: 0,
      gridColumn: gridSpan ? `span ${gridSpan}` : undefined,
      ...style,
    }}>
      {/* Specular highlight */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: 'var(--glass-border-specular)', pointerEvents: 'none',
      }} />
      {children}
    </div>
  );
}

// ─── Card Title ───────────────────────────────────────────────────────────────
function CardTitle({ icon: Icon, title }: { icon?: React.ComponentType<any>; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {Icon && (
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(35,139,69,0.18), rgba(23,107,53,0.12))',
          border: '1px solid rgba(35,139,69,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={16} color="#238B45" />
        </div>
      )}
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>{title}</span>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 11px', borderRadius: 999,
      background: bg, border: `1px solid ${color}44`,
      fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' as const,
      letterSpacing: '0.3px',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function AnimalProfileRecordSection({ title, count, children }: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details style={{
      border: '1px solid var(--glass-border)',
      borderRadius: 14,
      background: 'var(--glass-surface)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      <summary style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        cursor: 'pointer',
        color: 'var(--text)',
        fontWeight: 800,
        listStyle: 'none',
      }}>
        <span>{title}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>{count}</span>
      </summary>
      <div style={{ padding: '0 12px 12px' }}>{children}</div>
    </details>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AnimalProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const toast = useToast();
  const isSuperAdmin = profile?.role === 'super_admin';

  const requestedTab = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<'overview' | 'camera' | 'health' | 'breeding' | 'vaccination' | 'inventory' | 'records' | 'sales' | 'report'>(requestedTab === 'health' ? 'health' : 'overview');
  const [animalQRModalOpen, setAnimalQRModalOpen] = useState(false);
  const [healthCaseModalOpen, setHealthCaseModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [administerModalOpen, setAdministerModalOpen] = useState(false);
  const [mortalityModalOpen, setMortalityModalOpen] = useState(false);
  const [cameraHistory, setCameraHistory] = useState<AnimalGateEvent[]>([]);
  const [cameraCrossings, setCameraCrossings] = useState<AnimalGateCrossing[]>([]);
  const [gateAlerts, setGateAlerts] = useState<AnimalGateAlert[]>([]);
  const [cameraHealthScreenings, setCameraHealthScreenings] = useState<AnimalCameraHealthScreening[]>([]);
  const [cameraHealthScreeningsUnavailable, setCameraHealthScreeningsUnavailable] = useState(false);
  const [profileActivity, setProfileActivity] = useState<AnimalActivity[]>([]);
  const [breedingBirthEvents, setBreedingBirthEvents] = useState<BreedingBirthEvent[]>([]);
  const [activeCameraSession, setActiveCameraSession] = useState<{ id: string; gate_id: string; started_at: string } | null>(null);
  const [cameraHistoryState, setCameraHistoryState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [activityHistoryState, setActivityHistoryState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [gateAlertsState, setGateAlertsState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [cameraLastSeen, setCameraLastSeen] = useState<string | null>(null);
  const [cameraLastQr, setCameraLastQr] = useState<string | null>(null);
  const [cameraLastEartag, setCameraLastEartag] = useState<string | null>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);

  const [editForm, setEditForm] = useState({
    tag_id: '', eartag_number: '', name: '', species: 'Goat' as Species, breed: '', sex: 'Female' as Sex,
    date_of_birth: '', weight_kg: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoInspection, setPhotoInspection] = useState('');
  const [photoInspected, setPhotoInspected] = useState(false);
  const [inspectingPhoto, setInspectingPhoto] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const photoCheckGenerationRef = useRef(0);
  const photoAnalysisAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => photoAnalysisAbortRef.current?.abort(), []);

  const animal = farmData.animals.find((a) => a.id === id);

  const animalHealth = useMemo(() => farmData.healthRecords.filter((r) => r.animal_id === id), [farmData.healthRecords, id]);
  const animalHealthCases = useMemo(() => farmData.healthCases.filter((r) => r.animal_id === id), [farmData.healthCases, id]);
  const animalTreatments = useMemo(() => farmData.treatmentRecords.filter((r) => r.animal_id === id), [farmData.treatmentRecords, id]);
  const animalTreatmentUsage = useMemo(() => farmData.inventoryUsage
    .filter((row) => row.animal_id === id)
    .map((row) => ({
      id: `usage-${row.id}`,
      medicine_name: farmData.inventory.find((item) => item.id === row.inventory_id)?.name || row.notes?.match(/Gamot:\s*([^|]+)/i)?.[1]?.trim() || 'Gamot mula sa imbentaryo',
      status: row.treatment_status || 'Naibigay',
      dosage: row.dosage || String(row.quantity_used),
      unit: row.unit,
      frequency: row.frequency || '—',
      route: '—',
      start_date: row.usage_date,
      end_date: row.next_due_date || null,
      administering_person: null,
      inventory_id: row.inventory_id,
      case_id: null,
      treatment_notes: row.notes || row.reason || null,
    })), [farmData.inventory, farmData.inventoryUsage, id]);
  const animalHealthAlerts = useMemo(() => farmData.healthAlerts.filter((r) => r.animal_id === id), [farmData.healthAlerts, id]);

  useEffect(() => {
    if (!animal?.id || !animal.user_id) return;
    let active = true;
    void supabase
      .from('camera_health_screenings')
      .select('id,visible_status,detected_species,observed_concern,affected_area,recommendation,created_at')
      .eq('animal_id', animal.id)
      .eq('user_id', animal.user_id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!active) return;
        setCameraHealthScreenings(error ? [] : (data ?? []) as AnimalCameraHealthScreening[]);
        setCameraHealthScreeningsUnavailable(Boolean(error));
      });
    return () => { active = false; };
  }, [animal?.id, animal?.user_id]);
  const animalWeights = useMemo(() => farmData.weightRecords.filter((r) => r.animal_id === id), [farmData.weightRecords, id]);
  const animalBreedings = useMemo(() => farmData.breedingRecords.filter((r) => r.animal_id === id || r.partner_id === id), [farmData.breedingRecords, id]);
  const animalNewborns = useMemo(() => farmData.animals.filter((row) => row.mother_animal_id === id), [farmData.animals, id]);
  const animalVaccinations = useMemo(() => farmData.vaccinations.filter((r) => r.animal_id === id), [farmData.vaccinations, id]);
  const animalSale = useMemo(() => {
    return (farmData.sales || []).find((s) => s.animal_id === id) ?? null;
  }, [farmData.sales, id]);
  const animalMortalityHistory = useMemo(
    () => farmData.mortalityRecords.filter((record) => record.animal_id === id).sort((a, b) => b.date_of_death.localeCompare(a.date_of_death)),
    [farmData.mortalityRecords, id],
  );
  const activeMortalityRecord = animalMortalityHistory.find((record) => !record.corrected_at) ?? null;
  // Sales are the source of truth for sold status. Do not rely on optional legacy animal columns.
  const isSold = Boolean(animalSale);
  const isArchived = Boolean(animal?.archived);
  const isDeceased = Boolean(activeMortalityRecord) || isAnimalDeceased(animal ?? {});
  const isUnavailable = isSold || isArchived || isDeceased;

  useEffect(() => {
    if (!animal?.id || !animal.user_id) {
      setBreedingBirthEvents([]);
      return;
    }
    let active = true;
    const loadBirthEvents = async () => {
      const { data, error } = await supabase.from('breeding_birth_events').select('*')
        .eq('mother_id', animal.id).eq('user_id', animal.user_id).order('event_date', { ascending: false });
      if (active) setBreedingBirthEvents(error ? [] : (data as BreedingBirthEvent[] ?? []));
    };
    void loadBirthEvents();
    const channel = supabase.channel(`animal-birth-events:${animal.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'breeding_birth_events', filter: `mother_id=eq.${animal.id}` }, () => {
        void loadBirthEvents();
      })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [animal?.id, animal?.user_id]);

  const loadAnimalContext = useCallback(async () => {
    if (!animal?.id || !animal.user_id) {
      setCameraHistory([]);
      setCameraCrossings([]);
      setGateAlerts([]);
      setProfileActivity([]);
      setCameraHistoryState('ready');
      setGateAlertsState('ready');
      setActivityHistoryState('ready');
      return;
    }
    setCameraHistoryState('loading');
    setGateAlertsState('loading');
    setActivityHistoryState('loading');
    try {
      const [eventsResult, crossingsResult, alertsResult, activityResult, sessionResult, animalResult] = await Promise.all([
        supabase.from('gate_events').select('id,session_id,gate_id,direction,species_detected,qr_verified,eartag_verified,eartag_number,confidence,tracking_id,movement_observation,created_at')
          .eq('animal_id', animal.id).eq('user_id', animal.user_id).order('created_at', { ascending: false }).limit(25),
        supabase.from('gate_camera_crossings').select('id,session_id,gate_id,tracking_id,species_detected,direction,confidence,movement_observation,created_at,animal_id,qr_verified,eartag_verified,eartag_number')
          .eq('animal_id', animal.id).eq('user_id', animal.user_id).order('created_at', { ascending: false }).limit(25),
        supabase.from('gate_alerts').select('id,session_id,alert_type,message,status,created_at,resolved_at')
          .eq('animal_id', animal.id).eq('user_id', animal.user_id).order('created_at', { ascending: false }).limit(25),
        supabase.from('activity_logs').select('id,actor_name,module,action,entity_id,entity_name,status,details,created_at')
          .eq('animal_id', animal.id).eq('farm_user_id', animal.user_id).order('created_at', { ascending: false }).limit(50),
        supabase.from('gate_sessions').select('id,gate_id,started_at').eq('user_id', animal.user_id).eq('status', 'monitoring')
          .contains('expected_animal_ids', [animal.id]).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('animals').select('camera_last_seen_at,camera_last_qr_at,camera_last_eartag_at').eq('id', animal.id).eq('user_id', animal.user_id).maybeSingle(),
      ]);

      setCameraHistory((eventsResult.data ?? []) as AnimalGateEvent[]);
      setCameraCrossings((crossingsResult.data ?? []) as AnimalGateCrossing[]);
      setGateAlerts((alertsResult.data ?? []) as AnimalGateAlert[]);
      setProfileActivity((activityResult.data ?? []) as AnimalActivity[]);
      setActiveCameraSession(sessionResult.data as { id: string; gate_id: string; started_at: string } | null);
      setCameraLastSeen((animalResult.data as { camera_last_seen_at?: string | null } | null)?.camera_last_seen_at ?? null);
      setCameraLastQr((animalResult.data as { camera_last_qr_at?: string | null } | null)?.camera_last_qr_at ?? null);
      setCameraLastEartag((animalResult.data as { camera_last_eartag_at?: string | null } | null)?.camera_last_eartag_at ?? null);
      setCameraHistoryState(eventsResult.error || crossingsResult.error || sessionResult.error || animalResult.error ? 'unavailable' : 'ready');
      setGateAlertsState(alertsResult.error ? 'unavailable' : 'ready');
      setActivityHistoryState(activityResult.error ? 'unavailable' : 'ready');
    } catch {
      setCameraHistory([]);
      setCameraCrossings([]);
      setGateAlerts([]);
      setProfileActivity([]);
      setActiveCameraSession(null);
      setCameraLastSeen(null);
      setCameraLastQr(null);
      setCameraHistoryState('unavailable');
      setGateAlertsState('unavailable');
      setActivityHistoryState('unavailable');
    }
  }, [animal?.id, animal?.user_id]);

  useEffect(() => {
    if (!animal?.id || !user?.id) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (!cancelled) void loadAnimalContext(); }, 250);
    };
    void loadAnimalContext();
    const channel = supabase.channel('animal-profile-context-' + animal.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_events', filter: 'animal_id=eq.' + animal.id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_camera_crossings', filter: 'animal_id=eq.' + animal.id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_alerts', filter: 'animal_id=eq.' + animal.id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs', filter: 'animal_id=eq.' + animal.id }, refresh)
      .subscribe();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [animal?.id, user?.id, loadAnimalContext]);

  const animalInventoryUsage = useMemo(() => {
    return farmData.inventoryTransactions
      .filter((tx) => tx.reference_type === 'animal' && tx.reference_id === animal?.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [farmData.inventoryTransactions, animal?.id]);

  // Show only saved notes and treatments; do not turn legacy scanner fields into diagnoses.
  const sortedHealth = useMemo(() => {
    return [...animalHealth]
      .filter((record) => !String(record.reasons ?? '').startsWith('Gamot / Lunas:'))
      .sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
  }, [animalHealth]);

  const latestHealthRecord = sortedHealth[0] ?? null;
  const sortedTreatments = useMemo(
    () => [...animalTreatments, ...animalTreatmentUsage].sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()),
    [animalTreatments, animalTreatmentUsage],
  );
  const activeTreatment = sortedTreatments.find((treatment) => /ongoing|kasalukuyang ginagamot|kailangan ng gamot|bantayan/i.test(treatment.status)) ?? null;
  const nextTreatment = sortedTreatments.find((treatment) => /scheduled|nakatakda/i.test(treatment.status)) ?? null;

  const activeMedicine = useMemo(() => {
    if (!activeTreatment) return null;
    return {
      name: activeTreatment.medicine_name,
      dosage: `${activeTreatment.dosage} ${activeTreatment.unit}`.trim(),
      frequency: activeTreatment.frequency,
      status: activeTreatment.status,
    };
  }, [activeTreatment]);

  const hulingCheckDate = latestHealthRecord ? formatDate(latestHealthRecord.record_date) : '0';

  // Latest weight (preserving weight records without separate tab)
  const latestWeight = useMemo(() => {
    if (animalWeights.length > 0) {
      const sorted = [...animalWeights].sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
      return sorted[0].weight_kg;
    }
    return animal?.weight_kg || null;
  }, [animalWeights, animal?.weight_kg]);

  // Observations
  const latestObservations = useMemo(() => {
    if (!latestHealthRecord) return 'Wala pang health observation.';
    return latestHealthRecord.notes?.trim() || 'May nakaraang tala pero walang note na nailagay.';
  }, [latestHealthRecord]);

  // Reminders
  const activeReminders = useMemo(() => {
    const list: string[] = [];
    if (animal?.next_vaccine_date) {
      list.push(`Nakatakdang bakuna sa ${formatDate(animal.next_vaccine_date)}`);
    }
    if (animal?.expected_kidding_date && animal.breeding_status === 'Pregnant') {
      const days = daysUntil(animal.expected_kidding_date);
      list.push(`Inaasahang ${animal.species === 'Goat' ? 'manganak' : 'magluwal'} sa ${formatDate(animal.expected_kidding_date)}${days !== null && days >= 0 ? ` (${days} araw na lang)` : ''}`);
    }
    if (activeMedicine) {
      list.push(`Gamot: ${activeMedicine.name} (${activeMedicine.dosage}) — ${activeMedicine.frequency}`);
    }
    if (nextTreatment) list.push(`Nakatakdang treatment: ${nextTreatment.medicine_name} sa ${formatDate(nextTreatment.start_date)}`);
    return list;
  }, [animal, activeMedicine, nextTreatment]);

  const latestCameraEvent = cameraHistory[0] ?? null;
  const latestQrEvent = cameraHistory.find((event) => event.qr_verified) ?? null;
  const latestEartagEvent = cameraHistory.find((event) => event.eartag_verified) ?? null;
  const cameraLastSeenAt = [cameraLastSeen, latestCameraEvent?.created_at].filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const cameraLastQrAt = [cameraLastQr, latestQrEvent?.created_at].filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const cameraLastEartagAt = [cameraLastEartag, latestEartagEvent?.created_at].filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

  useEffect(() => {
    if (animal) {
      setEditForm({
        tag_id: animal.tag_id, eartag_number: animal.eartag_number == null ? '' : String(animal.eartag_number), name: animal.name, species: animal.species,
        breed: animal.breed ?? '', sex: animal.sex,
        date_of_birth: animal.date_of_birth ?? '',
        weight_kg: animal.weight_kg ? String(animal.weight_kg) : '', notes: animal.notes ?? '',
      });
    }
  }, [animal]);

  if (farmData.loading) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  if (farmData.loadError) {
    return (
      <div className="empty-state" role="alert">
        <h4>May problema sa pagkuha ng animal records.</h4>
        <p>{farmData.loadError}</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void farmData.refresh()}>
          Subukan muli
        </button>
      </div>
    );
  }

  const isUnauthorized = Boolean(animal && user && !isSuperAdmin && animal.user_id !== user.id);

  if (!animal || isUnauthorized) {
    return (
      <div className="empty-state">
        <h4>Hindi Nahanap ang Alaga o Walang Pahintulot</h4>
        <p>Ang talaang ito ay maaaring nabura na o pag-aari ng ibang bukid.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/animals')}>
          Bumalik sa Kambing at Tupa
        </button>
      </div>
    );
  }

  const isSheep = animal.species === 'Sheep';
  const speciesLabel = isSheep ? 'Tupa' : 'Kambing';

  const closeEdit = () => {
    photoCheckGenerationRef.current += 1;
    photoAnalysisAbortRef.current?.abort();
    photoAnalysisAbortRef.current = null;
    setEditOpen(false);
    setProfilePhoto(null);
    setPhotoInspection('');
    setPhotoInspected(false);
    setInspectingPhoto(false);
    setProcessingPhoto(false);
  };

  const handleProfilePhotoChange = async (file?: File) => {
    const photoGeneration = ++photoCheckGenerationRef.current;
    photoAnalysisAbortRef.current?.abort();
    photoAnalysisAbortRef.current = null;
    setProfilePhoto(null);
    setPhotoInspection('');
    setPhotoInspected(false);
    setInspectingPhoto(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Pumili ng JPG, PNG, o WebP na larawan.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Hanggang 10 MB lamang ang maaaring larawan.', 'error');
      return;
    }
    try {
      setProcessingPhoto(true);
      const compressedPhoto = await compressImageFile(file, 1200, 0.85);
      if (photoCheckGenerationRef.current === photoGeneration) setProfilePhoto(compressedPhoto);
    } catch (error) {
      if (photoCheckGenerationRef.current === photoGeneration) {
        toast(error instanceof Error ? `Hindi mabuksan ang larawan: ${error.message}` : 'Hindi mabuksan ang larawan.', 'error');
      }
    } finally {
      if (photoCheckGenerationRef.current === photoGeneration) setProcessingPhoto(false);
    }
  };

  const inspectProfilePhoto = async () => {
    if (!profilePhoto || inspectingPhoto || processingPhoto) return;
    const checkGeneration = ++photoCheckGenerationRef.current;
    const controller = new AbortController();
    photoAnalysisAbortRef.current = controller;
    setInspectingPhoto(true);
    setPhotoInspected(false);
    setPhotoInspection('');
    let response = '';
    try {
      for await (const _ of streamChat([{
        role: 'user',
        content: `Suriin ang larawang ito para sa profile ng ${editForm.species === 'Sheep' ? 'tupa' : 'kambing'} na si ${editForm.name || animal.name}. Ilarawan lamang ang nakikitang hitsura, kondisyon ng balahibo/balat, tindig, at kung malinaw at angkop ang larawan. Sabihin kung hindi makita nang maayos ang hayop o mukhang ibang species. Huwag magbigay ng diagnosis o maghinuha ng sakit; banggitin na visual observation lamang ito at kailangang kumpirmahin ng tao/beterinaryo.`,
        image: profilePhoto,
      }], (token) => {
        response += token;
        if (photoCheckGenerationRef.current === checkGeneration) setPhotoInspection(response);
      }, controller.signal)) { /* consume streamed tokens */ }
      if (photoCheckGenerationRef.current !== checkGeneration) return;
      if (!response.trim()) throw new Error('Walang natanggap na pagsusuri mula sa AI.');
      setPhotoInspected(true);
    } catch (error) {
      if (photoCheckGenerationRef.current !== checkGeneration) return;
      setPhotoInspected(false);
      toast(error instanceof Error ? `Hindi masuri ang larawan: ${error.message}` : 'Hindi masuri ang larawan. Subukan muli.', 'error');
    } finally {
      if (photoCheckGenerationRef.current === checkGeneration) {
        photoAnalysisAbortRef.current = null;
        setInspectingPhoto(false);
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!animal || !user) return;
    if (profilePhoto && !photoInspected) {
      toast('Suriin muna ang bagong larawan gamit ang AI bago ito i-save.', 'error');
      return;
    }
    const rawEartag = editForm.eartag_number.trim();
    if (rawEartag && !/^[0-9]{1,6}$/.test(rawEartag)) {
      toast('Numero ng eartag ay dapat 1 hanggang 6 na numero.', 'error');
      return;
    }
    const eartagNumber = rawEartag ? Number(rawEartag) : null;
    if (eartagNumber !== null && eartagNumber <= 0) {
      toast('Numero ng eartag ay dapat higit sa zero.', 'error');
      return;
    }
    const duplicateEartag = eartagNumber !== null && farmData.animals.some((candidate) =>
      candidate.id !== animal.id && candidate.user_id === animal.user_id && isAnimalActive(candidate) &&
      Number(candidate.eartag_number) === eartagNumber,
    );
    if (duplicateEartag) {
      toast('May aktibong alaga na sa bukid na gumagamit ng numerong ito.', 'error');
      return;
    }
    setSaving(true);
    let uploadedPhotoPath: string | null = null;
    try {
      let photoUrl = animal.photo_url;
      if (profilePhoto) {
        if (animal.user_id !== user.id) {
          throw new Error('Ang may-ari lamang ng hayop ang maaaring magpalit ng profile photo.');
        }
        uploadedPhotoPath = `${user.id}/${animal.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('animal-profile-photos')
          .upload(uploadedPhotoPath, await (await fetch(profilePhoto)).blob(), {
            contentType: 'image/jpeg',
            cacheControl: '0',
            upsert: true,
          });
        if (uploadError) throw uploadError;
        const { data: publicPhoto } = supabase.storage.from('animal-profile-photos').getPublicUrl(uploadedPhotoPath);
        photoUrl = `${publicPhoto.publicUrl}?v=${Date.now()}`;
      }
      let query = supabase.from('animals').update({
        tag_id: editForm.tag_id.trim(), eartag_number: eartagNumber, name: editForm.name.trim(),
        species: editForm.species, breed: editForm.breed.trim() || null, sex: editForm.sex,
        date_of_birth: editForm.date_of_birth || null,
        weight_kg: editForm.weight_kg !== '' && editForm.weight_kg !== null && Number(editForm.weight_kg) > 0 ? Number(editForm.weight_kg) : null,
        notes: editForm.notes.trim() || null,
        ...(profilePhoto ? { photo_url: photoUrl } : {}),
      }).eq('id', animal.id);

      if (!isSuperAdmin) {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query.select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Walang record na nabago.');
      toast(`Matagumpay na na-update ang impormasyon ng ${speciesLabel.toLowerCase()}.`, 'success');
      closeEdit();
      await farmData.refresh();
    } catch (error) {
      if (uploadedPhotoPath) {
        const { error: cleanupError } = await supabase.storage.from('animal-profile-photos').remove([uploadedPhotoPath]);
        if (cleanupError) console.error('[animal-profile] Failed to clean up an unsaved profile photo:', cleanupError.message);
      }
      const message = error instanceof Error && /duplicate key|idx_animals_user_eartag_number_unique_active|unique constraint/i.test(error.message)
        ? 'May aktibong alaga na sa bukid na gumagamit ng numerong ito.'
        : error instanceof Error
          ? `Hindi mai-save ang mga pagbabago: ${error.message}`
          : 'Hindi mai-save ang mga pagbabago. Pakisubukan muli.';
      toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!animal || !user) return;
    try {
      let query = supabase.from('animals').update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: user.id,
      }).eq('id', animal.id);
      if (!isSuperAdmin) {
        query = query.eq('user_id', user.id);
      }
      const { data, error } = await query.select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Hindi nahanap ang active animal record.');
      await farmData.refresh();
      toast(`Na-archive ang ${speciesLabel.toLowerCase()}. Maaari itong ibalik sa Archived Records.`, 'success');
      navigate('/animals');
    } catch {
      toast(`Hindi ma-archive ang ${speciesLabel.toLowerCase()}. Pakisubukan muli.`, 'error');
    }
  };

  const handleRestore = async () => {
    if (!animal || !user || isSold) return;
    try {
      let query = supabase.from('animals').update({
        archived: false,
        archived_at: null,
        archived_by: null,
        archive_reason: null,
      }).eq('id', animal.id).eq('archived', true);
      if (!isSuperAdmin) query = query.eq('user_id', user.id);
      const { data, error } = await query.select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Hindi naibalik ang record.');
      await farmData.refresh();
      toast(`Naibalik si ${animal.name} sa active herd.`, 'success');
    } catch {
      toast('Hindi maibalik ang alaga. Pakisubukan muli.', 'error');
    }
  };

  const openAnimalCamera = (intent: 'monitor' | 'scan-qr') => {
    navigate('/livestock-monitoring', { state: { animalId: animal.id, cameraIntent: intent } });
  };

  const askAssistantAboutAnimal = () => {
    const recordList = (label: string, rows: string[]) => `${label}: ${rows.length ? rows.join(' || ') : 'Wala sa available na profile records.'}`;
    const profileContext = [
      `Exact animal internal ID: ${animal.id}; eartag number: ${animal.eartag_number ?? 'not recorded'}; animal tag: ${animal.tag_id}; name: ${animal.name}; species: ${animal.species}; breed: ${animal.breed || 'not recorded'}; sex: ${animal.sex}; birth date: ${animal.date_of_birth || 'not recorded'}; record status: ${isSold ? 'sold' : isArchived ? 'archived' : 'active'}; archived: ${Boolean(animal.archived)}; sold: ${isSold}.`,
      `Latest saved weight: ${latestWeight ? `${latestWeight} kg` : 'not recorded'}. Last seen: ${cameraLastSeenAt || 'not recorded'}. Last eartag OCR: ${cameraLastEartagAt || 'not recorded'}. Legacy QR scan: ${cameraLastQrAt || 'not recorded'}.`,
      `Camera history query: ${cameraHistoryState}. ${cameraHistory.slice(0, 12).map((event) => `${event.created_at} | ${event.direction} | ${event.eartag_verified ? `eartag ${event.eartag_number} verified` : event.qr_verified ? 'legacy QR verified' : 'not identified'} | gate ${event.gate_id} | session ${event.session_id} | ${event.movement_observation || 'no movement note'}`).join(' || ') || 'No event currently available.'}`,
      `Movement crossings query: ${cameraHistoryState}. ${cameraCrossings.slice(0, 12).map((event) => `${event.created_at} | ${event.direction} | ${event.eartag_verified ? `eartag ${event.eartag_number} verified` : event.qr_verified ? 'legacy QR verified' : 'not identified'} | ${event.movement_observation} | gate ${event.gate_id} | session ${event.session_id}`).join(' || ') || 'No crossing currently available.'}`,
      `Gate alert history: ${gateAlertsState}. ${gateAlerts.slice(0, 8).map((alert) => `${alert.created_at} | ${alert.alert_type} | ${alert.status} | ${alert.message}`).join(' || ') || 'No gate alert currently available.'}`,
      recordList('Farmer observation notes', sortedHealth.slice(0, 10).map((row) => `${row.record_date} | ${row.notes || 'legacy record; no note available'}`)),
      recordList('Health cases', animalHealthCases.slice(0, 10).map((row) => `${row.date_reported} | ${row.suspected_condition} | ${row.case_status}`)),
      recordList('Treatments and medicine usage', sortedTreatments.slice(0, 10).map((row) => `${row.medicine_name} | ${row.status} | ${row.dosage} ${row.unit} | ${row.frequency} | ${row.start_date}–${row.end_date || 'no end date'}`)),
      recordList('Vaccinations', animalVaccinations.slice(0, 10).map((row) => `${row.date_given} | ${row.vaccine_name} | next due ${row.next_due_date || 'not recorded'}`)),
      recordList('Breeding records', animalBreedings.slice(0, 10).map((row) => `${row.mating_date} | ${row.status} | expected ${row.expected_kidding_date || 'not recorded'} | partner ID ${row.animal_id === animal.id ? row.partner_id || 'not recorded' : row.animal_id}`)),
      recordList('Weight records', animalWeights.slice(0, 10).map((row) => `${row.record_date} | ${row.weight_kg} kg`)),
      recordList('Inventory use linked to this animal', animalInventoryUsage.slice(0, 10).map((row) => `${row.created_at} | ${row.reason} | ${row.quantity} ${row.unit}`)),
      recordList('Sale record', animalSale ? [`${animalSale.sale_date} | ${animalSale.sold_weight} kg | ${animalSale.selling_price} | received ${animalSale.amount_received} | ${animalSale.payment_status}`] : []),
      `Activity history query: ${activityHistoryState}. ${profileActivity.slice(0, 12).map((row) => `${row.created_at} | ${row.action} | ${row.module} | ${row.status}`).join(' || ') || 'No activity currently available.'}`,
      `Active monitoring session for this animal: ${activeCameraSession ? `${activeCameraSession.id} | gate ${activeCameraSession.gate_id} | started ${activeCameraSession.started_at}` : 'none currently found'}.`,
      'Use only these records for this animal. A blank or unavailable section means the record is unavailable or not saved; do not infer a diagnosis, QR scan, movement, or history.',
    ].join('\n');
    window.dispatchEvent(new CustomEvent('alpas:consult-vet-ai', {
      detail: {
        prompt: `Gamitin lamang ang aktuwal na records para sa ${animal.name} (${animal.tag_id}, internal ID ${animal.id}). I-summarize ang latest gate/QR activity, kalusugan/treatment, alerts at sale status. Tukuyin kung may kulang na tala; huwag manghula o mag-diagnose.`,
        profileContext,
      },
    }));
  };

  const openAnimalModule = (path: string, action = 'add') => {
    navigate(`${path}?action=${action}&animalId=${encodeURIComponent(animal.id)}`);
  };

  // Weight chart for the Ulat / Reports tab
  const sortedWeights = [...animalWeights].sort((a, b) => new Date(a.record_date).getTime() - new Date(b.record_date).getTime());
  const weightChartData = {
    labels: sortedWeights.map((w) => formatDate(w.record_date)),
    datasets: [{
      label: 'Timbang (kg)',
      data: sortedWeights.map((w) => Number(w.weight_kg)),
      borderColor: '#238B45',
      backgroundColor: 'rgba(35, 139, 69, 0.15)',
      fill: true, tension: 0.3, pointRadius: 4,
      pointBackgroundColor: '#238B45',
    }],
  };

  // Keep the animal profile focused; group secondary history inside Records.
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'camera', label: 'Camera' },
    { key: 'health', label: 'Health' },
    { key: 'records', label: 'Records' },
  ] as const;


  return (
    <>
      {/* Ambient background glows */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-120px', left: '-80px', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(35,139,69,0.06) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', bottom: '-100px', right: '-60px', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(23,107,53,0.05) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      </div>

      {/* Page wrapper */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1400, margin: '0 auto', width: '100%', boxSizing: 'border-box', minWidth: 0 }}>

        {/* ── Back button ── */}
        <button
          onClick={() => navigate('/animals')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '7px 16px',
            fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
            cursor: 'pointer', marginBottom: 20, transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--color-primary, #238B45)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <ArrowLeft size={15} /> Bumalik sa Kambing at Tupa
        </button>

        {/* ── Animal Header (Identity + Record Status) ── */}
        <div style={{
          background: 'var(--glass-surface)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow)',
          padding: 'clamp(18px, 3vw, 28px)',
          marginBottom: 16,
          position: 'relative' as const,
          overflow: showMoreActions ? 'visible' : 'hidden',
          zIndex: showMoreActions ? 40 : undefined,
        }}>
          {/* Specular top line */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'var(--glass-border-specular)' }} />

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 'clamp(14px,2.5vw,24px)',
            flexWrap: 'wrap' as const, width: '100%', minWidth: 0,
          }}>
            {/* Animal photo, falling back to an initial only when no photo is saved */}
            {animal.photo_url ? (
              <img
                src={animal.photo_url}
                alt={`${animal.name} (${animal.tag_id})`}
                style={{ width: 'clamp(64px,10vw,96px)', height: 'clamp(64px,10vw,96px)', borderRadius: 16, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)', background: 'var(--surface)' }}
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div style={{
                width: 'clamp(64px,10vw,96px)', height: 'clamp(64px,10vw,96px)',
                borderRadius: 16,
                background: 'linear-gradient(135deg, #238B45, #176B35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'clamp(22px,4vw,28px)', fontWeight: 900, color: '#fff',
                boxShadow: '0 8px 24px rgba(35,139,69,0.25)',
                flexShrink: 0, border: '1px solid rgba(255,255,255,0.25)', letterSpacing: '-1px',
              }}>
                {animal.name[0]?.toUpperCase()}
              </div>
            )}

            {/* Info block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{
                fontSize: 'clamp(22px,3.5vw,32px)', fontWeight: 900, color: 'var(--text)',
                letterSpacing: '-0.7px', margin: '0 0 4px', lineHeight: 1.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
              }}>
                {animal.name}
              </h1>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8, display: 'flex', flexWrap: 'wrap' as const, gap: '4px 8px', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-primary, #238B45)', fontWeight: 700 }}>Eartag {animal.eartag_number ?? '—'}</span>
                <span style={{ opacity: 0.4 }}>•</span>
                <span>{animal.species === 'Goat' ? 'Kambing' : 'Tupa'}</span>
                <span style={{ opacity: 0.4 }}>•</span>
                <span>{animal.sex === 'Female' ? 'Babae' : 'Lalaki'}</span>
                <span style={{ opacity: 0.4 }}>•</span>
                <span>{ageLabel(animal.date_of_birth)}</span>
              </div>

              {/* Status + actions row */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 10, marginTop: 4 }}>
                {!isUnavailable && <StatusBadge label="Aktibo" color="#176B35" bg="rgba(35,139,69,0.12)" />}
                {isSold && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    background: '#EAF6ED',
                    color: '#238B45',
                    border: '1px solid #C7E9C0',
                    fontWeight: 700,
                    fontSize: 13,
                  }}>
                    <CheckCircle2 size={14} /> Nabenta
                  </span>
                )}
                {isDeceased && !isSold && <StatusBadge label="NAMATAY NA" color="#9f2d25" bg="rgba(220, 38, 38, .10)" />}
                {isArchived && !isSold && <span style={{ padding: '4px 12px', borderRadius: 9999, background: '#F1F5F9', color: '#475569', fontSize: 12, fontWeight: 700 }}>Naka-archive</span>}
                <div className="animal-profile-main-actions">
                  {!isUnavailable && <ActionBtn icon={<Pencil size={14} />} label="I-edit" onClick={() => setEditOpen(true)} variant="neutral" />}
                  {!isUnavailable && <ActionBtn icon={<Pill size={14} />} label="Mag-record ng gamutan" onClick={() => setAdministerModalOpen(true)} variant="neutral" />}
                  <div className="animal-profile-more-actions" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => setShowMoreActions((open) => !open)}
                      aria-expanded={showMoreActions}
                      aria-haspopup="menu"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        background: showMoreActions ? 'rgba(35, 139, 69, 0.12)' : 'var(--surface)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        padding: '8px 12px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span>Iba pang aksyon</span>
                      <ChevronDown size={14} style={{ transform: showMoreActions ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                    </button>
                    {showMoreActions && (
                      <div className="animal-profile-more-actions-menu" role="menu" aria-label="Iba pang aksyon">
                        {!isArchived && <ActionBtn icon={<QrCode size={14} />} label="QR code" onClick={() => { setAnimalQRModalOpen(true); setShowMoreActions(false); }} variant="neutral" />}
                        {!isUnavailable && <ActionBtn icon={<Archive size={14} />} label="I-archive" onClick={() => { setConfirmDelete(true); setShowMoreActions(false); }} variant="neutral" />}
                        {isAnimalActive(animal) && animal.user_id === user?.id && <ActionBtn icon={<AlertTriangle size={14} />} label="I-record bilang Namatay" onClick={() => { setMortalityModalOpen(true); setShowMoreActions(false); }} variant="neutral" />}
                        {isArchived && !isSold && <ActionBtn icon={<RotateCcw size={14} />} label="Ibalik sa bukid" onClick={() => { void handleRestore(); setShowMoreActions(false); }} variant="green" />}
                        <ActionBtn icon={<Info size={14} />} label="Magtanong sa AI" onClick={() => { askAssistantAboutAnimal(); setShowMoreActions(false); }} variant="neutral" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="animal-profile-tabs-wrap">
          <div style={{
            display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0,
            background: 'var(--glass-surface)',
            backdropFilter: 'var(--glass-blur-sm)',
            WebkitBackdropFilter: 'var(--glass-blur-sm)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-pill)',
            padding: 5,
            boxShadow: 'var(--shadow-sm)',
          }} className="animal-profile-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '8px 18px', borderRadius: 'var(--radius-pill)',
                  fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' as const,
                  cursor: 'pointer', border: 'none', transition: 'all 0.2s ease',
                  background: tab === t.key
                    ? 'linear-gradient(135deg, #238B45, #176B35)'
                    : 'transparent',
                  color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                  boxShadow: tab === t.key ? '0 4px 14px rgba(35,139,69,0.35)' : 'none',
                  letterSpacing: tab === t.key ? '0.2px' : '0',
                }}
                onMouseEnter={(e) => { if (tab !== t.key) e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { if (tab !== t.key) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ── */}

        {/* 1. KALAGAYAN NG ALAGA */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18, width: '100%', minWidth: 0 }} className="ap-grid">
            {animalMortalityHistory.length > 0 && (
              <GlassCard gridSpan={3} style={{ borderColor: 'rgba(220, 38, 38, .35)' }}>
                <CardTitle icon={AlertTriangle} title="Kasaysayan ng Pagkamatay" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {animalMortalityHistory.map((record) => (
                    <Fragment key={record.id}>
                      <StatRow label="Katayuan" value={record.corrected_at ? 'Itinama ang status' : 'NAMATAY NA'} />
                      <StatRow label="Petsa ng pagkamatay" value={formatDate(record.date_of_death)} />
                      <StatRow label="Dahilan" value={{ disease: 'Sakit / Disease', accident: 'Aksidente / Accident', birthing_complication: 'Panganganak / Birthing Complication', unknown: 'Hindi Alam / Unknown', other: record.cause_details || 'Iba Pa / Other' }[record.cause_of_death]} />
                      <StatRow label="Naitala ni" value={record.recorded_by_name || 'Farm user'} />
                      <StatRow label="Petsa ng pagtatala" value={formatCameraHistoryTime(record.recorded_at)} />
                      {record.estimated_time && <StatRow label="Tinatayang oras" value={record.estimated_time.slice(0, 5)} />}
                      {record.previous_health_status && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Dating kalagayan ng kalusugan" value={record.previous_health_status} /></div>}
                      {record.previous_treatment && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Dating gamutan" value={record.previous_treatment} /></div>}
                      {record.symptoms_before_death && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Sintomas bago namatay" value={record.symptoms_before_death} /></div>}
                      {record.notes && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Karagdagang tala" value={record.notes} /></div>}
                      {record.corrected_at && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Paliwanag sa pagwawasto" value={record.correction_reason || 'Walang paliwanag'} /></div>}
                    </Fragment>
                  ))}
                </div>
                <p style={{ margin: '12px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>Nananatiling makikita ang dating health, treatment, breeding, birth, timbang, camera, at sales history ng hayop.</p>
              </GlassCard>
            )}
            <GlassCard gridSpan={3}>
              <CardTitle icon={Activity} title="Mabilis na buod" />
              <div className="animal-profile-quick-stats">
                <StatRow variant="tile" label="Kalagayan" value={activeReminders.length || animalHealthAlerts.some((alert) => !alert.is_resolved) ? 'May paalala' : 'Walang paalala'} />
                <StatRow variant="tile" label="Timbang" value={latestWeight ? `${latestWeight} kg` : 'Wala'} />
                <StatRow variant="tile" label="Huling nakita" value={formatFarmerLastSeen(cameraLastSeenAt)} />
              </div>
              {(activeReminders.length > 0 || animalHealthAlerts.some((alert) => !alert.is_resolved)) && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-hover)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5 }}>
                  <Bell size={16} style={{ color: '#B7791F', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{activeReminders[0] || 'May paalala sa kalusugan'}</strong>
                    {activeReminders.length > 1 && <span style={{ color: 'var(--text-secondary)' }}> · at {activeReminders.length - 1} pang paalala</span>}
                    <button type="button" onClick={() => setTab('health')} style={{ display: 'block', padding: 0, marginTop: 4, border: 0, background: 'transparent', color: 'var(--color-primary, #238B45)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>Tingnan ang kalusugan at mga tala</button>
                  </div>
                </div>
              )}
              {latestHealthRecord?.notes?.trim() && (
                <p style={{ margin: '12px 0 0', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                  <strong style={{ color: 'var(--text)' }}>Huling obserbasyon:</strong> {latestHealthRecord.notes.trim().length > 180 ? `${latestHealthRecord.notes.trim().slice(0, 180)}…` : latestHealthRecord.notes.trim()}
                </p>
              )}
            </GlassCard>

            {isSold && (
              <GlassCard gridSpan={3} style={{ border: '1px solid #C7E9C0', background: 'linear-gradient(180deg, #F0FDF4 0%, #FFFFFF 100%)' }}>
                <CardTitle icon={DollarSign} title="Nabenta" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
                  <StatRow label="Presyo" value={`₱${(animalSale?.selling_price || 0).toLocaleString('en-US')}`} />
                  <StatRow label="Natanggap" value={`₱${(animalSale?.amount_received ?? animalSale?.selling_price ?? 0).toLocaleString('en-US')}`} />
                  <StatRow label="Petsa" value={animalSale?.sale_date ? formatDate(animalSale.sale_date) : '—'} />
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {tab === 'camera' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <GlassCard>
              <div className="animal-profile-camera-actions">
                <CardTitle icon={Camera} title="Camera Monitoring" />
                {!isUnavailable && (
                  <div className="animal-profile-camera-action-buttons">
                    <Button variant="primary" onClick={() => openAnimalCamera('monitor')} leftIcon={<Camera size={15} />}>Buksan ang live camera</Button>
                  </div>
                )}
              </div>
              <div className="animal-profile-quick-stats">
                <StatRow variant="tile" label="Huling Nakita" value={formatFarmerLastSeen(cameraLastSeenAt)} />
                <StatRow variant="tile" label="Eartag Number" value={cameraLastEartagAt ? 'Nakilala sa camera' : 'Hindi pa nakikilala'} />
                <StatRow variant="tile" label="Huling Galaw" value={latestCameraEvent ? (latestCameraEvent.direction === 'entry' ? 'Bumalik sa kulungan' : 'Lumabas') : 'Wala pang tala'} />
              </div>
              <p style={{ margin: '12px 0 0', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Binabasa ng camera ang numero sa eartag sa magkakasunod na kuha. Kung hindi malinaw ang numero, hindi huhulaan ang pagkakakilanlan.
              </p>
            </GlassCard>

            <GlassCard>
              <CardTitle icon={LogIn} title="Mga Naitalang Galaw" />
              {cameraHistoryState === 'loading' ? <p style={{ color: 'var(--text-secondary)' }}>Kinukuha ang mga tala…</p>
                : cameraHistoryState === 'unavailable' ? <p role="status" style={{ color: 'var(--text-secondary)' }}>Hindi makuha ang mga tala ngayon. Subukang muli mamaya.</p>
                : cameraHistory.length === 0 ? <div className="animal-profile-zero-state">0</div>
                : <div style={{ display: 'grid', gap: 10 }}>
                  {cameraHistory.map((event) => (
                    <div key={event.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      {event.direction === 'entry' ? <LogIn size={18} color="#238B45" /> : <LogOut size={18} color="#B7791F" />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <strong>{event.direction === 'entry' ? 'Pumasok / bumalik sa kulungan' : 'Lumabas sa gate'}</strong>
                          <time style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatCameraHistoryTime(event.created_at)}</time>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 }}>
                          <span>{event.eartag_verified ? `Number ${event.eartag_number} · Number Verified` : event.qr_verified ? 'Legacy QR Nakilala' : 'Hindi Nakilala'}</span>
                          {event.movement_observation && event.movement_observation !== 'normal' && <span>Kailangan ng Atensyon</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>}
            </GlassCard>

            <GlassCard>
              <CardTitle icon={Activity} title="Mga Paalala sa Galaw" />
              {cameraHistoryState === 'loading' ? <p style={{ color: 'var(--text-secondary)' }}>Kinukuha ang mga paalala…</p>
                : cameraCrossings.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>Walang paalala sa galaw sa ngayon.</p>
                : <div style={{ display: 'grid', gap: 10 }}>
                  {cameraCrossings.map((crossing) => (
                    <div key={crossing.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <strong>{crossing.direction === 'entry' ? 'Pumasok' : 'Lumabas'} · {crossing.eartag_verified ? `Number ${crossing.eartag_number} · Number Verified` : crossing.qr_verified ? 'Legacy QR Nakilala' : 'Hindi Nakilala'}</strong>
                        <time style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatCameraHistoryTime(crossing.created_at)}</time>
                      </div>
                      <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>
                        {crossing.movement_observation === 'normal' ? 'Walang kailangang tingnan sa galaw na ito.' : 'May napansing hindi karaniwang galaw. Mainam na tingnan ito nang personal.'}
                      </p>
                    </div>
                  ))}
                </div>}
              {gateAlertsState === 'loading' ? <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>Kinukuha ang alerts…</p>
                : gateAlertsState === 'unavailable' ? <p role="status" style={{ color: 'var(--text-secondary)', marginTop: 12 }}>Hindi makuha ang mga paalala ngayon.</p>
                : gateAlerts.length > 0 && <div style={{ marginTop: 14 }}>
                  <CardTitle icon={Bell} title="Mga Paalala" />
                  <div style={{ display: 'grid', gap: 8 }}>
                    {gateAlerts.map((alert) => (
                      <div key={alert.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                        <strong>{alert.alert_type === 'unaccounted' ? 'May hayop na hindi pa nakikita' : 'Kailangan ng Atensyon'}</strong>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                          {alert.alert_type === 'unaccounted' ? 'Mainam na tingnan ang kulungan.' : 'May napansing hindi karaniwang galaw. Mainam na tingnan ito nang personal.'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>}
            </GlassCard>
          </div>
        )}

        {/* Kalusugan at Gamot: persisted observations and treatment records only */}
        {tab === 'health' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <GlassCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <CardTitle icon={Pill} title={'Gamot at Observations · ' + animal.name} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!isUnavailable && <Button variant="primary" size="sm" onClick={() => setAdministerModalOpen(true)} leftIcon={<Pill size={14} />}>Magtala ng treatment</Button>}
                  {!isUnavailable && <Button variant="secondary" size="sm" onClick={() => setHealthCaseModalOpen(true)} leftIcon={<Plus size={14} />}>Magtala ng health case</Button>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-hover)' }}>
                <strong>Saved records only</strong>
                <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 12 }}>Huling tala: {hulingCheckDate}</span>
              </div>              <div style={{ marginTop: 12 }}>
                <StatRow label="Pinakahuling observation" value={latestObservations} />
                <StatRow label="Naitalang treatment" value={activeTreatment ? activeTreatment.medicine_name + ' · ' + activeTreatment.status + ' · ' + activeTreatment.dosage + ' ' + activeTreatment.unit : 'Walang kasalukuyang active treatment'} />
              </div>
            </GlassCard>

            <GlassCard>
              <CardTitle icon={ClipboardList} title="Mga Tala sa Obserbasyon" />
              {sortedHealth.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>Wala pang health observation na naitala para sa hayop na ito.</p>
                : <div style={{ display: 'grid', gap: 10 }}>
                  {sortedHealth.map((record) => (
                    <article key={record.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <strong>{formatDate(record.record_date)}</strong>
                      </div>
                      {record.notes && <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{record.notes}</p>}
                      {!record.notes && <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>Walang note sa lumang record na ito.</p>}
                    </article>
                  ))}
                </div>}
            </GlassCard>

            <GlassCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <CardTitle icon={Camera} title="Suriin ang kalagayan" />
                {!isUnavailable && <Button variant="primary" size="sm" onClick={() => navigate('/health-screening', { state: { animalId: animal.id } })} leftIcon={<Camera size={14} />}>Buksan ang Health Camera</Button>}
              </div>
              {cameraHealthScreeningsUnavailable
                ? <p role="status" style={{ color: 'var(--text-secondary)' }}>Hindi mabasa ang history ngayon. Ilapat ang pinakabagong database migration at subukan muli.</p>
                : cameraHealthScreenings.length === 0
                  ? <p style={{ color: 'var(--text-secondary)' }}>Wala pang naitalang pagsusuri para sa hayop na ito.</p>
                  : <div style={{ display: 'grid', gap: 9 }}>
                    {cameraHealthScreenings.map((record) => {
                      const label = record.visible_status === 'attention' ? 'Kailangan ng Atensyon' : record.visible_status === 'watch' ? 'Bantayan' : 'Maayos ang nakikitang bahagi';
                      const color = record.visible_status === 'attention' ? '#b42318' : record.visible_status === 'watch' ? '#a15c00' : '#176b39';
                      return (
                        <article key={record.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                          <strong style={{ color }}>{label}</strong>
                          <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>{formatCameraHistoryTime(record.created_at)}</div>
                          {record.observed_concern && <p style={{ margin: '7px 0 0', fontSize: 13 }}>{record.affected_area ? `${record.affected_area}: ` : ''}{record.observed_concern}</p>}
                          {record.recommendation && <p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{record.recommendation}</p>}
                          <small style={{ display: 'block', marginTop: 6, color: 'var(--text-secondary)' }}>Paunang visual screening lamang; hindi diagnosis.</small>
                        </article>
                      );
                    })}
                  </div>}
            </GlassCard>

            <GlassCard>
              <CardTitle icon={Pill} title="Gamot at Treatment History" />
              {sortedTreatments.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>Wala pang treatment record na nakakabit sa animal ID na ito.</p>
                : <div style={{ display: 'grid', gap: 10 }}>
                  {sortedTreatments.map((treatment) => (
                    <article key={treatment.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <strong>{treatment.medicine_name}</strong>
                        <StatusBadge label={treatment.status} color={/ongoing|kasalukuyang ginagamot|kailangan ng gamot/i.test(treatment.status) ? '#176B35' : '#64748B'} bg={/ongoing|kasalukuyang ginagamot|kailangan ng gamot/i.test(treatment.status) ? 'rgba(35,139,69,0.12)' : 'var(--surface-hover)'} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 6, marginTop: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
                        <span>Dosis: {treatment.dosage} {treatment.unit}</span>
                        <span>Dalas: {treatment.frequency}</span>
                        <span>Paraan: {treatment.route}</span>
                        <span>Simula: {formatDate(treatment.start_date)}</span>
                        <span>Hanggang: {formatDate(treatment.end_date ?? null)}</span>
                        <span>Nagbigay: {treatment.administering_person || 'Hindi nakatala'}</span>
                      </div>
                      {treatment.treatment_notes && <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{treatment.treatment_notes}</p>}
                    </article>
                  ))}
                </div>}
            </GlassCard>

            <GlassCard>
              <CardTitle icon={AlertTriangle} title="Health Cases at Alerts" />
              {animalHealthCases.length === 0 && animalHealthAlerts.length === 0
                ? <p style={{ color: 'var(--text-secondary)' }}>Wala pang health case o health alert para sa hayop na ito.</p>
                : <div style={{ display: 'grid', gap: 10 }}>
                  {animalHealthCases.map((healthCase) => (
                    <article key={healthCase.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <strong>{healthCase.suspected_condition}</strong>
                      <div style={{ marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 }}>
                        {healthCase.case_status} · {healthCase.severity} · {formatDate(healthCase.date_reported)}
                        {healthCase.confirmed_diagnosis ? ' · Kumpirmadong diagnosis: ' + healthCase.confirmed_diagnosis : ''}
                        {healthCase.follow_up_date ? ' · Follow-up: ' + formatDate(healthCase.follow_up_date) : ''}
                      </div>
                      {healthCase.clinical_notes && <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{healthCase.clinical_notes}</p>}
                    </article>
                  ))}
                  {animalHealthAlerts.map((alert) => (
                    <article key={alert.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <strong>{alert.message}</strong>
                      <div style={{ marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 }}>
                        {alert.is_resolved ? 'Resolved' : 'Active'} · {alert.severity} · {formatCameraHistoryTime(alert.created_at)}
                      </div>
                    </article>
                  ))}
                </div>}
            </GlassCard>
          </div>
        )}
        {tab === 'records' && (
          <AnimalProfileRecordSection title="Breeding history" count={animalBreedings.length}>
          <GlassCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 10 }}>
              <CardTitle icon={Heart} title="Talaan ng Pagpaparami (Breeding)" />
              <button className="btn btn-primary btn-sm" onClick={() => openAnimalModule('/breeding')} disabled={isUnavailable}>
                <Plus size={15} /> Magdagdag ng Record
              </button>
            </div>
            {animalBreedings.length === 0 ? (
              <div className="empty-state">
                <div className="es-icon"><Heart size={24} /></div>
                <h4>Walang talaan ng breeding</h4>
                <p>Magtala ng pagpaparis upang masubaybayan ang inaasahang panganganak.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Petsa ng Pagpaparis</th>
                      <th>Inaasahang Panganganak</th>
                      <th>Katayuan</th>
                      <th>Natitirang Araw</th>
                      <th>Resulta / Bagong Alaga</th>
                    </tr>
                  </thead>
                  <tbody>
                    {animalBreedings.map((b) => {
                      const days = b.expected_kidding_date ? daysUntil(b.expected_kidding_date) : null;
                      const birthEvent = breedingBirthEvents.find((event) => event.breeding_id === b.id);
                      const newborns = birthEvent ? animalNewborns.filter((newborn) => newborn.birth_event_id === birthEvent.id) : [];
                      const isDue = b.status === 'Pregnant' && days !== null && days <= 0;
                      return (
                        <tr key={b.id}>
                          <td>{formatDate(b.mating_date)}</td>
                          <td>{formatDate(b.expected_kidding_date ?? null)}</td>
                          <td>
                            <span className={`badge badge-${isDue ? 'orange' : b.status === 'Pregnant' ? 'blue' : b.status === 'Kidded' ? 'green' : 'gray'}`}>
                              {isDue ? 'Due na manganak' : b.status === 'Pregnant' ? 'Buntis' : b.status === 'Kidded' ? 'Nanganak na' : b.status === 'Failed' ? 'Nabigo' : b.status}
                            </span>
                          </td>
                          <td>{days !== null && days >= 0 ? `${days} araw` : '—'}</td>
                          <td>
                            {birthEvent ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 145 }}>
                                <strong>{birthEvent.outcome === 'successful' ? 'Matagumpay na Panganganak' : birthEvent.result_label || 'Naitala ang resulta'}</strong>
                                <span>{formatDate(birthEvent.actual_birth_date || birthEvent.event_date)}</span>
                                {newborns.length > 0 && <span>Bagong alaga: {newborns.map((newborn) => newborn.tag_id).join(', ')}</span>}
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
          </AnimalProfileRecordSection>
        )}

        {tab === 'health' && (
          <AnimalProfileRecordSection title="Vaccination records" count={animalVaccinations.length}>
          <GlassCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 10 }}>
              <CardTitle icon={Syringe} title={`Mga Bakuna ng ${speciesLabel}`} />
              <button className="btn btn-primary btn-sm" onClick={() => openAnimalModule('/vaccinations')} disabled={isUnavailable}>
                <Plus size={15} /> Magdagdag ng Bakuna
              </button>
            </div>
            {animalVaccinations.length === 0 ? (
              <div className="empty-state">
                <div className="es-icon"><Syringe size={24} /></div>
                <h4>Walang talaan ng bakuna</h4>
                <p>Magtala ng bakuna upang mapanatiling ligtas ang {speciesLabel.toLowerCase()} sa mga sakit.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Pangalan ng Bakuna</th>
                      <th>Petsa ng Pagbigay</th>
                      <th>Susunod na Bakuna</th>
                      <th>Beterinaryo / Nagbakuna</th>
                    </tr>
                  </thead>
                  <tbody>
                    {animalVaccinations.map((v) => (
                      <tr key={v.id}>
                        <td style={{ fontWeight: 600 }}>{v.vaccine_name}</td>
                        <td>{formatDate(v.date_given)}</td>
                        <td>{formatDate(v.next_due_date)}</td>
                        <td>{v.veterinarian ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
          </AnimalProfileRecordSection>
        )}

        {tab === 'health' && (
          <AnimalProfileRecordSection title="Medicine and supplies used" count={animalInventoryUsage.length}>
          <GlassCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <CardTitle icon={Package} title="Mga Gamot at Gamit mula sa Imbentaryo" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary, #238B45)' }}>
                  {animalInventoryUsage.length} naitalang gamit
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => {
                    if (isUnavailable) {
                      toast(isSold
                        ? `Hindi maaaring bigyan ng gamot ang nabentang ${speciesLabel.toLowerCase()}.`
                        : 'Ibalik muna sa Archived Records bago magtala ng bagong gamutan.', 'error');
                      return;
                    }
                    setAdministerModalOpen(true);
                  }}
                  disabled={isUnavailable}
                >
                  Bigyan ng Gamot / Gamit
                </Button>
              </div>
            </div>

            {/* Active Medication Card */}
            {activeMedicine && (
              <div style={{
                background: 'rgba(220, 38, 38, 0.08)',
                border: '1.5px solid rgba(220, 38, 38, 0.35)',
                borderRadius: 12,
                padding: '14px 16px',
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626', fontWeight: 800, fontSize: 14 }}>
                  <Pill size={18} /> Kasalukuyang Gamot: {activeMedicine.name}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text)' }}>
                  Dosis: <strong>{activeMedicine.dosage}</strong> • Dalas: <strong>{activeMedicine.frequency}</strong> • Katayuan: <span style={{ color: '#DC2626', fontWeight: 700 }}>{activeMedicine.status}</span>
                </div>
              </div>
            )}

            {animalInventoryUsage.length === 0 ? (
              <div className="empty-state">
                <div className="es-icon"><Package size={24} /></div>
                <h4>Walang gamit o gamot na naitala</h4>
                <p>Kusang maitatala rito ang mga bakuna, gamot, o supplies na ibinawas mula sa imbentaryo para kay {animal.name}.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Petsa (Date)</th>
                      <th>Dami / Yunit</th>
                      <th>Gamot o Gamit</th>
                      <th>Detalye / Tala</th>
                      <th>Halaga (Cost)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {animalInventoryUsage.map((tx) => (
                      <tr key={tx.id}>
                        <td>{formatDate(tx.created_at)}</td>
                        <td style={{ fontWeight: 700, color: 'var(--text)' }}>
                          {tx.quantity} {tx.unit}
                        </td>
                        <td>
                          <span className="badge badge-info" style={{ fontSize: 11 }}>
                            {tx.reason || tx.type}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          {tx.notes || '—'}
                        </td>
                        <td style={{ fontWeight: 600, color: '#10B981' }}>
                          {tx.cost_per_unit ? `₱${(tx.quantity * tx.cost_per_unit).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
          </AnimalProfileRecordSection>
        )}

        {tab === 'records' && (
          <AnimalProfileRecordSection title="Sale record" count={animalSale ? 1 : 0}>
          <GlassCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <CardTitle icon={DollarSign} title={`Sales History · ${animal.tag_id}`} />
              {!isUnavailable && <Button variant="primary" onClick={() => openAnimalModule('/sales')} leftIcon={<Plus size={14} />}>Ibenta ang hayop na ito</Button>}
              <Button variant="secondary" onClick={() => navigate('/sales')}>Buksan ang Sales</Button>
            </div>
            {animalSale ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                <StatRow label="Status" value="Sold" />
                <StatRow label="Petsa ng benta" value={formatDate(animalSale.sale_date)} />
                <StatRow label="Timbang noong nabenta" value={`${animalSale.sold_weight} kg`} />
                <StatRow label="Selling price" value={`₱${Number(animalSale.selling_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`} />
                <StatRow label="Amount received" value={`₱${Number(animalSale.amount_received).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`} />
                <StatRow label="Natitirang balanse" value={`₱${Number(animalSale.remaining_balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`} />
                <StatRow label="Payment status" value={animalSale.payment_status} />
                <StatRow label="Buyer" value={animalSale.buyer_name || 'Hindi nakatala'} />
                <StatRow label="Buyer contact" value={animalSale.buyer_contact || 'Hindi nakatala'} />
                <StatRow label="Sale reference" value={animalSale.id} />
                {animalSale.notes && <div style={{ gridColumn: '1 / -1' }}><StatRow label="Notes" value={animalSale.notes} /></div>}
              </div>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>{isArchived ? 'Naka-archive ang animal record na ito at wala pang sale record.' : 'Wala pang sale record para sa permanenteng animal ID na ito.'}</p>
            )}
            <p style={{ margin: '14px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>
              Magkakasamang naitatala rito ang benta at huling timbang ng alaga.
            </p>
          </GlassCard>
          </AnimalProfileRecordSection>
        )}

        {tab === 'records' && (
          <AnimalProfileRecordSection title="Activity and alerts" count={profileActivity.length + gateAlerts.length + animalHealthAlerts.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <GlassCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <CardTitle icon={History} title={`Activity History · ${animal.tag_id}`} />
                <Button variant="secondary" onClick={() => void loadAnimalContext()} leftIcon={<RotateCcw size={14} />}>I-refresh ang records</Button>
              </div>
              {activityHistoryState === 'loading' ? <p style={{ color: 'var(--text-secondary)' }}>Kinukuha ang activity history…</p>
                : activityHistoryState === 'unavailable' ? <div role="alert" style={{ color: 'var(--text-secondary)' }}>
                  Hindi mabuksan ang talaan ng gawain sa ngayon. I-refresh mamaya o humingi ng tulong sa tagapangasiwa.
                </div>
                : profileActivity.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>Wala pang activity log na naka-link sa internal animal ID na ito.</p>
                : <div style={{ display: 'grid', gap: 9 }}>
                  {profileActivity.map((entry) => (
                    <article key={entry.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <strong>{entry.module} · {entry.action}</strong>
                        <time style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatCameraHistoryTime(entry.created_at)}</time>
                      </div>
                      <div style={{ marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 }}>
                        Gumawa: {entry.actor_name || 'System / User'} · Resulta: {entry.status}
                        {entry.entity_id ? ' · Reference: ' + entry.entity_id : ''}
                        {entry.entity_name ? ' · ' + entry.entity_name : ''}
                      </div>
                    </article>
                  ))}
                </div>}
            </GlassCard>
            <GlassCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <CardTitle icon={Bell} title="Mga Alert para sa Hayop na Ito" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="secondary" size="sm" onClick={() => setTab('camera')}>Camera alerts</Button>
                  <Button variant="secondary" size="sm" onClick={() => setTab('health')}>Health alerts</Button>
                </div>
              </div>
              {[...gateAlerts.map((alert) => ({ id: alert.id, message: alert.message, status: alert.status, created_at: alert.created_at, source: 'Camera' })),
                ...animalHealthAlerts.map((alert) => ({ id: alert.id, message: alert.message, status: alert.is_resolved ? 'resolved' : 'active', created_at: alert.created_at, source: 'Health' }))]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).length === 0
                ? <p style={{ color: 'var(--text-secondary)' }}>Walang alert record na naka-link sa hayop na ito.</p>
                : <div style={{ display: 'grid', gap: 8 }}>
                  {[...gateAlerts.map((alert) => ({ id: alert.id, message: alert.message, status: alert.status, created_at: alert.created_at, source: 'Camera' })),
                    ...animalHealthAlerts.map((alert) => ({ id: alert.id, message: alert.message, status: alert.is_resolved ? 'resolved' : 'active', created_at: alert.created_at, source: 'Health' }))]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((alert) => (
                      <div key={alert.source + alert.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                        <strong>{alert.message}</strong>
                        <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>{alert.source} · {alert.status} · {formatCameraHistoryTime(alert.created_at)}</div>
                      </div>
                    ))}
                </div>}
            </GlassCard>
          </div>
          </AnimalProfileRecordSection>
        )}

        {tab === 'records' && (
          <AnimalProfileRecordSection title="Weight and health summary" count={animalWeights.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Weight Progression Chart & Full Weight Records (Preserved here without standalone main tab) */}
            <GlassCard>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 10 }}>
                <CardTitle icon={Scale} title="Kasaysayan ng Timbang (Weight History)" />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {animalWeights.length} naitalang timbang
                </span>
              </div>
              {animalWeights.length === 0 ? (
                <div className="empty-state">
                  <div className="es-icon"><Scale size={24} /></div>
                  <h4>Walang talaan ng timbang</h4>
                  <p>Maaaring maglagay ng timbang tuwing nag-e-edit ng alaga o kapag nagtitimbang sa bukid.</p>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 20, borderRadius: 12, overflow: 'hidden', padding: '4px 0' }}>
                    <Line data={weightChartData} options={{
                      responsive: true,
                      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(6,18,32,0.92)', bodyColor: '#fff', titleColor: '#238B45' } },
                      scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-secondary)' as any } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-secondary)' as any } },
                      },
                    }} />
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Petsa</th>
                          <th>Timbang</th>
                          <th>Pagbabago</th>
                          <th>Dagdag bawat Araw</th>
                          <th>Mga Tala</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...animalWeights].sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime()).map((w) => {
                          return (
                            <tr key={w.id}>
                              <td>{formatDate(w.record_date)}</td>
                              <td><strong>{w.weight_kg} kg</strong></td>
                              <td style={{ color: w.weight_change_kg !== null && w.weight_change_kg < 0 ? '#EF4444' : w.weight_change_kg !== null && w.weight_change_kg > 0 ? '#238B45' : 'inherit', fontWeight: 600 }}>
                                {w.weight_change_kg !== null ? `${w.weight_change_kg > 0 ? '+' : ''}${w.weight_change_kg} kg` : '—'}
                              </td>
                              <td>{w.daily_gain_kg !== null ? `${w.daily_gain_kg} kg/day` : '—'}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </GlassCard>

            {/* Summary Statistics of all Records */}
            <GlassCard>
              <CardTitle icon={ClipboardList} title={`Mga Naitala sa ${speciesLabel}`} />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 14,
                marginBottom: 16,
              }}>
                <div style={{ padding: '14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Mga Tala sa Obserbasyon</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginTop: 4 }}>{animalHealth.length}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bakuna</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginTop: 4 }}>{animalVaccinations.length}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Gamot / Gamit</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginTop: 4 }}>{animalInventoryUsage.length}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tala ng Timbang</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginTop: 4 }}>{animalWeights.length}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => setAnimalQRModalOpen(true)} leftIcon={<QrCode size={15} />}>
                  Buksan ang QR ID card
                </Button>
              </div>
            </GlassCard>
          </div>
          </AnimalProfileRecordSection>
        )}

        {/* Spacing at bottom */}
        <div style={{ height: 40 }} />
      </div>

      {/* ── Responsive grid CSS ── */}
      <style>{`
        .animal-profile-quick-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .animal-profile-stat-tile {
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid var(--border-light);
          border-radius: 13px;
          background: var(--surface);
        }
        .animal-profile-stat-label {
          display: block;
          margin-bottom: 5px;
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 700;
          line-height: 1.35;
        }
        .animal-profile-stat-value {
          display: block;
          min-width: 0;
          color: var(--text);
          font-size: 14px;
          font-weight: 700;
          line-height: 1.45;
          text-align: left;
          overflow-wrap: anywhere;
        }
        .animal-profile-zero-state {
          display: grid;
          min-height: 112px;
          place-items: center;
          color: var(--text-secondary);
          font-size: 28px;
          font-weight: 800;
        }
        .animal-profile-camera-actions {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 8px;
        }
        .animal-profile-camera-actions > div:first-child { margin-bottom: 0 !important; }
        .animal-profile-camera-action-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .animal-profile-main-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          position: relative;
          z-index: 10;
        }
        .animal-profile-more-actions {
          position: relative;
          display: inline-flex;
          z-index: 20;
        }
        .animal-profile-more-actions-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 190px;
          width: max-content;
          padding: 8px;
          border: 1px solid var(--glass-border);
          border-radius: 14px;
          background: var(--glass-surface);
          backdrop-filter: var(--glass-blur);
          -webkit-backdrop-filter: var(--glass-blur);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
          z-index: 30;
        }
        .animal-profile-tabs-wrap {
          width: 100%;
          max-width: 100%;
          margin-bottom: 16px;
          overflow: hidden;
        }
        .animal-profile-tabs {
          flex-wrap: nowrap !important;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .animal-profile-tabs::-webkit-scrollbar { display: none; }
        .animal-profile-tabs > button { flex: 0 0 auto; }
        .ap-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        }
        @media (max-width: 1100px) {
          .ap-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .animal-profile-quick-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .ap-grid > div[style*="span 2"],
          .ap-grid > div[style*="span 3"] {
            grid-column: span 2 !important;
          }
        }
        @media (max-width: 640px) {
          .ap-grid {
            grid-template-columns: 1fr !important;
          }
          .animal-profile-quick-stats {
            grid-template-columns: 1fr;
          }
          .animal-profile-camera-actions {
            align-items: stretch;
          }
          .animal-profile-camera-action-buttons {
            width: 100%;
          }
          .animal-profile-camera-action-buttons > button {
            flex: 1 1 180px;
          }
          .ap-grid > div[style*="span 2"],
          .ap-grid > div[style*="span 3"] {
            grid-column: span 1 !important;
          }
        }
        /* Hide scrollbar on tab nav */
        div[style*="overflow-x: auto"]::-webkit-scrollbar { display: none; }
        div[style*="overflow-x: auto"] { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `}</style>

      {/* ── Edit Modal ── */}
      <Modal open={editOpen} onClose={closeEdit} size="md">
        <ModalHeader title={`I-edit ang ${speciesLabel}`} onClose={closeEdit} />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {animal.user_id === user?.id && (
              <FormField label="Bagong profile photo" helperText="JPG, PNG, o WebP hanggang 10 MB. Kailangan ang AI appearance check bago i-save ang bagong larawan.">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={processingPhoto || inspectingPhoto}
                  onChange={(event) => {
                    void handleProfilePhotoChange(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  style={{ width: '100%', color: 'var(--text-secondary)' }}
                />
                {profilePhoto && (
                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    <img
                      src={profilePhoto}
                      alt="Preview ng bagong profile photo"
                      style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 10, background: 'var(--surface-secondary, #f3f5f4)' }}
                    />
                    <Button
                      variant="secondary"
                      leftIcon={<Sparkles size={16} />}
                      loading={inspectingPhoto}
                      disabled={saving || processingPhoto}
                      onClick={() => void inspectProfilePhoto()}
                    >
                      {photoInspected ? 'Suriin Muli gamit ang AI' : 'Suriin ang Hitsura gamit ang AI'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={saving || inspectingPhoto || processingPhoto}
                      onClick={() => {
                        photoCheckGenerationRef.current += 1;
                        setProfilePhoto(null);
                        setPhotoInspection('');
                        setPhotoInspected(false);
                      }}
                    >
                      Alisin ang bagong larawan
                    </Button>
                    {photoInspection && (
                      <div role="status" style={{ padding: 12, borderRadius: 10, background: 'var(--surface-secondary, #f3f5f4)', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>
                        <strong>Paunang visual observation</strong>
                        <p style={{ margin: '6px 0 0' }}>{photoInspection}</p>
                      </div>
                    )}
                    <small style={{ color: 'var(--text-secondary)' }}>
                      Visual observation lamang ito, hindi diagnosis. Nasa public image storage ang larawan at makikita ng sinumang may link; lalabas din ito sa QR profile kung naka-enable.
                    </small>
                  </div>
                )}
              </FormField>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Pangalan" required>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </FormField>
              <FormField label="Numero ng Eartag" helperText="Numero sa eartag na makikita ng camera.">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={editForm.eartag_number}
                  onChange={(e) => setEditForm({ ...editForm, eartag_number: e.target.value })}
                  placeholder="Hal. 1, 10, 25"
                />
              </FormField>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <FormField label="Species">
                <Select
                  value={editForm.species}
                  onChange={(e) => {
                    setEditForm({ ...editForm, species: e.target.value as Species });
                    if (profilePhoto) {
                      photoCheckGenerationRef.current += 1;
                      photoAnalysisAbortRef.current?.abort();
                      photoAnalysisAbortRef.current = null;
                      setInspectingPhoto(false);
                      setPhotoInspected(false);
                      setPhotoInspection('');
                    }
                  }}
                  options={[{ value: 'Goat', label: 'Goat / Kambing' }, { value: 'Sheep', label: 'Sheep / Tupa' }]}
                />
              </FormField>
              <FormField label="Sex">
                <Select
                  value={editForm.sex}
                  onChange={(e) => setEditForm({ ...editForm, sex: e.target.value as Sex })}
                  options={[{ value: 'Female', label: 'Female / Babae' }, { value: 'Male', label: 'Male / Lalaki' }]}
                />
              </FormField>
              <FormField label="Breed">
                <Input value={editForm.breed} onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })} />
              </FormField>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Birth Date">
                <Input type="date" value={editForm.date_of_birth} onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} />
              </FormField>
              <FormField label="Weight (kg) (Optional)" helperText="Maaaring laktawan kung wala pang timbang">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={editForm.weight_kg}
                  onChange={(e) => setEditForm({ ...editForm, weight_kg: e.target.value })}
                  placeholder="Opsyonal (hal. 35.5)"
                />
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea
                className="form-textarea"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                style={{ minHeight: 80 }}
              />
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeEdit}>Kanselahin</Button>
          <Button variant="primary" onClick={handleSaveEdit} loading={saving} disabled={processingPhoto || Boolean(profilePhoto && !photoInspected) || inspectingPhoto}>I-save ang Pagbabago</Button>
        </ModalFooter>
      </Modal>

      {/* ── Confirm Delete ── */}
      <ConfirmDialog
        open={confirmDelete}
        title="I-archive ang alaga?"
        message={`Itatago si ${animal.name} (${animal.tag_id}) sa active herd. Mananatili ang mga tala nito at maaari itong ibalik mula sa Archived Records.`}
        confirmLabel="I-archive"
        cancelLabel="Huwag Muna"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      {/* ── Administer Medicine / Inventory Modal ── */}
      <MedicationTreatmentModal
        open={administerModalOpen}
        onClose={() => setAdministerModalOpen(false)}
        preselectedAnimalId={animal.id}
        onSuccess={() => {
          farmData.refresh();
        }}
      />

      {/* ── Official QR Code ID Card Modal ── */}
      <AnimalQRCardModal
        isOpen={animalQRModalOpen}
        onClose={() => setAnimalQRModalOpen(false)}
        animal={animal}
      />

      {/* ── Health Case Modal ── */}
      <HealthCaseModal
        isOpen={healthCaseModalOpen}
        onClose={() => setHealthCaseModalOpen(false)}
        preselectedAnimalId={animal.id}
        onCaseCreated={() => farmData.refresh()}
      />

      <MortalityRecordModal
        animal={animal}
        open={mortalityModalOpen}
        onClose={() => setMortalityModalOpen(false)}
      />

    </>
  );
}

// ─── Action Button ─────────────────────────────────────────────────────────────
function ActionBtn({ icon, label, onClick, variant }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  variant: 'neutral' | 'green' | 'red';
}) {
  const colors = {
    neutral: { base: 'var(--surface)', border: 'var(--border)', text: 'var(--text-secondary)', hover: 'var(--surface-hover)' },
    green: { base: '#EAF6ED', border: 'rgba(35,139,69,0.35)', text: '#176B35', hover: '#DDF0E2' },
    red: { base: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)', text: '#EF4444', hover: 'rgba(239,68,68,0.20)' },
  }[variant];

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '7px 14px', borderRadius: 'var(--radius-pill)',
        background: colors.base, border: `1px solid ${colors.border}`,
        color: colors.text, fontSize: 13, fontWeight: 700,
        cursor: 'pointer', transition: 'all 0.18s', whiteSpace: 'nowrap' as const,
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.hover; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = colors.base; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {icon} {label}
    </button>
  );
}
