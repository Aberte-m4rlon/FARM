import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useFarmData } from '../lib/useFarmData';
import { isAnimalActive } from '../lib/animalLifecycle';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter, ConfirmDialog } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { FormField, Input, Select } from '../components/ui/Input';
import { ComboBox } from '../components/ComboBox';
import { FilterToolbar, FilterSearch, FilterPill } from '../components/FilterToolbar';
import {
  Plus,
  Pencil,
  Archive,
  Syringe,
  Clock,
  AlertTriangle,
  Search,
  Calendar,
  User,
  CheckCircle2,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { formatDate, daysUntil, vaccinationStatusFromDue } from '../lib/analytics';
import { createNotification } from '../lib/recommendations';
import { GOAT_SHEEP_VACCINES, COMMON_VETS } from '../lib/farmDefaults';
import { isVaccineCategory } from '../lib/inventoryOperations';
import type { Vaccination } from '../types';

const emptyForm = {
  animal_id: '',
  vaccine_name: '',
  date_given: new Date().toISOString().split('T')[0],
  next_due_date: '',
  veterinarian: '',
  notes: '',
  inventory_item_id: '',
  deduct_quantity: 1,
};

/* ─── Reusable Liquid Glass Style Tokens ─────────────────────────────────── */
const liquidGlassCard: React.CSSProperties = {
  position: 'relative',
  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.035))',
  backdropFilter: 'blur(32px) saturate(180%)',
  WebkitBackdropFilter: 'blur(32px) saturate(180%)',
  border: '1px solid rgba(255, 255, 255, 0.20)',
  borderRadius: 24,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(255, 255, 255, 0.04), 0 20px 50px rgba(0, 0, 0, 0.20)',
  transition: 'transform 250ms ease, box-shadow 250ms ease, border-color 250ms ease, background 250ms ease',
  overflow: 'hidden',
};

const specularHighlight: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.20), transparent 28%, transparent 70%, rgba(255, 255, 255, 0.06))',
  pointerEvents: 'none',
  zIndex: 1,
};

export function VaccinationsPage() {
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vaccination | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Vaccination | null>(null);
  const [fStatus, setFStatus] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const activeAnimals = farmData.animals.filter(isAnimalActive);

  const animalMap = useMemo(() => {
    const map = new Map<string, typeof farmData.animals[0]>();
    farmData.animals.forEach((a) => map.set(a.id, a));
    return map;
  }, [farmData.animals]);

  const animalName = (id: string) => animalMap.get(id)?.name ?? 'Unknown';
  const animalTag = (id: string) => animalMap.get(id)?.tag_id ?? '—';
  const animalSpecies = (id: string) => animalMap.get(id)?.species ?? 'Goat';

  const filtered = useMemo(() => {
    return farmData.vaccinations
      .filter((r) => {
        const status = vaccinationStatusFromDue(r.next_due_date, farmData.settings?.vaccine_due_days ?? 30);
        if (fStatus !== 'All') {
          if (fStatus === 'No Due Date') {
            if (status !== 'None') return false;
          } else if (status !== fStatus) {
            return false;
          }
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const aName = animalName(r.animal_id).toLowerCase();
          const aTag = animalTag(r.animal_id).toLowerCase();
          const vName = r.vaccine_name.toLowerCase();
          const vet = (r.veterinarian ?? '').toLowerCase();
          if (!aName.includes(q) && !aTag.includes(q) && !vName.includes(q) && !vet.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.date_given).getTime() - new Date(a.date_given).getTime());
  }, [farmData.vaccinations, fStatus, searchQuery, farmData.settings, farmData.animals]);

  const vaccineInventory = useMemo(() => {
    return farmData.inventory.filter((i) => isVaccineCategory(i.category));
  }, [farmData.inventory]);

  const selectedVaccineItem = useMemo(() => {
    return vaccineInventory.find((i) => i.id === form.inventory_item_id) || null;
  }, [vaccineInventory, form.inventory_item_id]);

  const openAdd = (preselectedAnimalId?: string) => {
    setEditing(null);
    const firstVaccine = vaccineInventory.find((i) => Number(i.quantity) > 0) || vaccineInventory[0];
    setForm({
      ...emptyForm,
      animal_id: activeAnimals.some((animal) => animal.id === preselectedAnimalId)
        ? preselectedAnimalId!
        : activeAnimals[0]?.id ?? '',
      inventory_item_id: firstVaccine?.id ?? '',
      vaccine_name: firstVaccine?.name ?? '',
      deduct_quantity: 1,
    });
    setErrors({});
    setModalOpen(true);
  };

  useEffect(() => {
    if (farmData.loading) return;
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      openAdd(params.get('animalId') ?? undefined);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, farmData.loading]);

  const openEdit = (r: Vaccination) => {
    setEditing(r);
    const matched = vaccineInventory.find((i) => i.name.toLowerCase() === r.vaccine_name.toLowerCase());
    setForm({
      animal_id: r.animal_id,
      vaccine_name: r.vaccine_name,
      date_given: r.date_given,
      next_due_date: r.next_due_date ?? '',
      veterinarian: r.veterinarian ?? '',
      notes: r.notes ?? '',
      inventory_item_id: matched?.id ?? '',
      deduct_quantity: 1,
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.animal_id) e.animal_id = 'Pumili ng kambing o tupa.';
    if (!editing && !form.inventory_item_id) {
      e.inventory_item_id = 'Pumili ng bakuna mula sa imbentaryo.';
    } else if (!form.vaccine_name.trim()) {
      e.vaccine_name = 'Kailangan ang pangalan ng bakuna.';
    }
    if (!form.date_given) {
      e.date_given = 'Kailangan ang petsa ng bakuna.';
    } else {
      const now = new Date();
      const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
      if (form.date_given > today) e.date_given = 'Hindi maaaring pumili ng petsang panghinaharap.';
    }
    if (form.date_given && form.next_due_date && form.next_due_date < form.date_given) {
      e.next_due_date = 'Hindi maaaring mas maaga sa petsa ng bakuna ang susunod na schedule.';
    }

    const doses = Number(form.deduct_quantity) || 0;
    if (doses <= 0) {
      e.deduct_quantity = 'Maglagay ng hindi bababa sa 1 dosis.';
    } else if (!editing && selectedVaccineItem) {
      const avail = Number(selectedVaccineItem.quantity) || 0;
      if (doses > avail) {
        e.deduct_quantity = `Kulang ang stock. ${avail} ${selectedVaccineItem.unit} na lang ang natitira.`;
      }
      if (selectedVaccineItem.expiry_date && form.date_given && selectedVaccineItem.expiry_date < form.date_given) {
        e.inventory_item_id = `⚠️ Expired na ang bakunang ito noong ${selectedVaccineItem.expiry_date}. Hindi ito maaaring gamitin.`;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!user) {
      toast('Nawalan ng koneksyon sa account. Mag-login muli bago mag-save.', 'error');
      return;
    }

    const animal = farmData.animals.find((a) => a.id === form.animal_id);
    if (!animal || (!isSuperAdmin && animal.user_id !== user.id)) {
      toast('Walang pahintulot sa napiling kambing o tupa.', 'error');
      return;
    }

    setSaving(true);
    const vaccName = selectedVaccineItem ? selectedVaccineItem.name : form.vaccine_name.trim();
    const doses = Number(form.deduct_quantity) || 1;
    const vaccStatus = vaccinationStatusFromDue(form.next_due_date || null, farmData.settings?.vaccine_due_days ?? 30);

    try {
      if (editing) {
        const { error } = await supabase.rpc('update_vaccination_record', {
          p_user_id: animal.user_id,
          p_vaccination_id: editing.id,
          p_vaccine_name: vaccName,
          p_date_given: form.date_given,
          p_next_due_date: form.next_due_date || null,
          p_veterinarian: form.veterinarian.trim() || null,
          p_notes: form.notes.trim() || null,
        });
        if (error) throw error;
        toast('Matagumpay na na-update ang record ng bakuna.', 'success');
      } else {
        if (!selectedVaccineItem) {
          toast('Pumili ng wastong bakuna mula sa imbentaryo.', 'error');
          setSaving(false);
          return;
        }

        const { data: result, error } = await supabase.rpc('record_vaccination_with_inventory', {
          p_user_id: animal.user_id,
          p_animal_id: animal.id,
          p_inventory_item_id: selectedVaccineItem.id,
          p_quantity: doses,
          p_vaccine_name: vaccName,
          p_date_given: form.date_given,
          p_next_due_date: form.next_due_date || null,
          p_veterinarian: form.veterinarian.trim() || null,
          p_notes: form.notes.trim() || null,
        });
        if (error) throw error;
        if (!result?.success) throw new Error(result?.message || 'Hindi nakumpirma ang record ng bakuna.');

        toast(`Nai-save ang bakuna! Nabawasan ng ${doses} ${selectedVaccineItem.unit} ang ${selectedVaccineItem.name}.`, 'success');
      }

      if (vaccStatus === 'Overdue') {
        await createNotification(
          animal.user_id,
          'Vaccination',
          `${animal.name} — Lampas na sa schedule ng bakuna`,
          `${vaccName} ay dapat noong ${form.next_due_date}`,
          'Critical',
          '/vaccinations',
          `vacc_overdue_${form.animal_id}_${form.next_due_date}`
        );
      } else if (vaccStatus === 'Due Soon') {
        const days = form.next_due_date ? daysUntil(form.next_due_date) : null;
        await createNotification(
          animal.user_id,
          'Vaccination',
          `${animal.name} — Bakuna sa loob ng ${days} araw`,
          `${vaccName} schedule sa ${form.next_due_date}`,
          'Warning',
          '/vaccinations',
          `vacc_duesoon_${form.animal_id}_${form.next_due_date}`
        );
      }

      setModalOpen(false);
      farmData.refresh();
    } catch (error) {
      const rpcError = error && typeof error === 'object'
        ? error as { message?: unknown; code?: unknown }
        : null;
      const message = typeof rpcError?.message === 'string' ? rpcError.message.trim() : '';
      const code = typeof rpcError?.code === 'string' ? rpcError.code : '';
      const missingRpc = code === 'PGRST202' || /could not find the function|schema cache/i.test(message);
      toast(
        missingRpc
          ? 'Hindi pa naka-install ang database update para makapag-save ng bakuna. Kailangang i-update ang database ng AlpasFarm.'
          : message
            ? `Hindi na-save ang bakuna: ${message}`
            : 'Hindi na-save ang bakuna. Suriin ang impormasyon at subukan muli.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    try {
      let deleteQuery = supabase.from('vaccinations').update({ archived_at: new Date().toISOString(), archived_by: user.id }).eq('id', confirmDelete.id);
      if (!isSuperAdmin) {
        deleteQuery = deleteQuery.eq('user_id', user.id);
      }
      const { error } = await deleteQuery;
      if (error) throw error;
      toast('In-archive ang record ng bakuna. Maaari itong ibalik mula sa Archived Records.', 'success');
      setConfirmDelete(null);
      farmData.refresh();
    } catch {
      toast('Hindi ma-archive ang record ng bakuna.', 'error');
    }
  };

  const upToDate = activeAnimals.filter((a) => a.vaccination_status === 'Up to Date').length;
  const dueSoon = activeAnimals.filter((a) => a.vaccination_status === 'Due Soon').length;
  const overdue = activeAnimals.filter((a) => a.vaccination_status === 'Overdue').length;

  const filterTabs = [
    { id: 'All', label: 'Lahat ng Records', count: farmData.vaccinations.length },
    { id: 'Up to Date', label: 'Up to Date', count: upToDate },
    { id: 'Due Soon', label: 'Due Soon', count: dueSoon },
    { id: 'Overdue', label: 'Lampas sa Schedule (Overdue)', count: overdue },
    { id: 'No Due Date', label: 'Walang Due Date', count: null },
  ];

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', width: '100%' }}>
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 26,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              background: '#E8F5E9',
              border: '1px solid rgba(67, 160, 71, 0.25)',
              boxShadow: '0 4px 12px rgba(46, 125, 50, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2E7D32',
            }}
          >
            <Syringe size={24} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 900,
                color: 'var(--text)',
                margin: 0,
                letterSpacing: '-0.6px',
                lineHeight: 1.2,
              }}
            >
              Mga Bakuna
            </h1>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '13px',
                margin: 0,
                marginTop: 2,
                fontWeight: 500,
              }}
            >
              Iskedyul ng bakuna, booster, at proteksyon ng kambing at tupa · {farmData.vaccinations.length} naitalang bakuna
            </p>
          </div>
        </div>

        {/* ── Add Vaccination — Floating Liquid Glass Pill ─────────── */}
        <button
          onClick={() => openAdd()}
          disabled={activeAnimals.length === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 26px',
            borderRadius: 999,
            background: 'linear-gradient(135deg, rgba(255, 59, 48, 0.92), rgba(255, 106, 42, 0.84))',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.30)',
            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.35), 0 10px 30px rgba(255, 80, 30, 0.25)',
            color: '#FFFFFF',
            fontWeight: 800,
            fontSize: '13px',
            letterSpacing: '0.2px',
            cursor: activeAnimals.length === 0 ? 'not-allowed' : 'pointer',
            opacity: activeAnimals.length === 0 ? 0.5 : 1,
            transition: 'transform 200ms ease, box-shadow 200ms ease',
          }}
          onMouseEnter={(e) => {
            if (activeAnimals.length > 0) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.45), 0 14px 36px rgba(255, 80, 30, 0.35)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.35), 0 10px 30px rgba(255, 80, 30, 0.25)';
          }}
        >
          <Plus size={16} strokeWidth={2.8} />
          Mag-record ng Bakuna
        </button>
      </div>

      {/* ── 3 Floating Liquid Glass Statistic Cards ───────────────── */}
      <div className="mobile-stats-grid-3 dashboard-stats stats-grid kpi-grid section-gap" style={{ marginBottom: 24 }}>
        {/* Card 1: Up to Date (Green Glass) */}
        <div
          onClick={() => setFStatus(fStatus === 'Up to Date' ? 'All' : 'Up to Date')}
          className="kpi-card stat-card mobile-stats-card-3"
          style={{
            ...liquidGlassCard,
            padding: '20px 22px',
            cursor: 'pointer',
            background: fStatus === 'Up to Date'
              ? 'linear-gradient(135deg, rgba(35, 139, 69, 0.20), rgba(23, 107, 53, 0.08))'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.035))',
            borderColor: fStatus === 'Up to Date' ? 'rgba(35, 139, 69, 0.45)' : 'rgba(35, 139, 69, 0.20)',
            boxShadow: fStatus === 'Up to Date'
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.40), 0 20px 50px rgba(35, 139, 69, 0.20)'
              : 'inset 0 1px 0 rgba(255, 255, 255, 0.30), 0 18px 45px rgba(0, 0, 0, 0.20)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-3px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div style={specularHighlight} />
          <div className="kpi-top" style={{ position: 'relative', zIndex: 2 }}>
            <div
              className="kpi-icon"
              style={{
                background: '#EAF6ED',
                border: '1px solid rgba(35, 139, 69, 0.25)',
                color: '#238B45',
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#176B35',
                padding: '3px 9px',
                borderRadius: 999,
                background: '#EAF6ED',
                border: '1px solid rgba(35, 139, 69, 0.25)',
                letterSpacing: '0.6px',
              }}
            >
              AYOS
            </span>
          </div>
          <div className="kpi-value" style={{ position: 'relative', zIndex: 2, marginTop: 4 }}>
            {upToDate}
          </div>
          <div className="kpi-label" style={{ position: 'relative', zIndex: 2 }}>
            Bakuna ayos
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary, #176B35)', marginTop: 3, fontWeight: 600, position: 'relative', zIndex: 2 }}>
            Kumpleto ang takdang bakuna
          </div>
        </div>

        {/* Card 2: Due Soon (Amber/Orange Glass) */}
        <div
          onClick={() => setFStatus(fStatus === 'Due Soon' ? 'All' : 'Due Soon')}
          className="kpi-card stat-card mobile-stats-card-3"
          style={{
            ...liquidGlassCard,
            padding: '20px 22px',
            cursor: 'pointer',
            background: fStatus === 'Due Soon'
              ? 'linear-gradient(135deg, rgba(255, 159, 10, 0.24), rgba(255, 106, 42, 0.08))'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.035))',
            borderColor: fStatus === 'Due Soon' ? 'rgba(255, 159, 10, 0.45)' : 'rgba(255, 255, 255, 0.20)',
            boxShadow: fStatus === 'Due Soon'
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.40), 0 20px 50px rgba(255, 159, 10, 0.20)'
              : 'inset 0 1px 0 rgba(255, 255, 255, 0.30), 0 18px 45px rgba(0, 0, 0, 0.20)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-3px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div style={specularHighlight} />
          <div className="kpi-top" style={{ position: 'relative', zIndex: 2 }}>
            <div
              className="kpi-icon"
              style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.08))',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#D97706',
              }}
            >
              <Clock size={22} />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#D97706',
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.30)',
                letterSpacing: '0.6px',
              }}
            >
              MALAPIT NA
            </span>
          </div>
          <div className="kpi-value" style={{ position: 'relative', zIndex: 2, marginTop: 4 }}>
            {dueSoon}
          </div>
          <div className="kpi-label" style={{ position: 'relative', zIndex: 2 }}>
            Malapit na
          </div>
          <div style={{ fontSize: 11, color: '#D97706', marginTop: 3, fontWeight: 600, position: 'relative', zIndex: 2 }}>
            Kailangan sa loob ng {farmData.settings?.vaccine_due_days ?? 30} araw
          </div>
        </div>

        {/* Card 3: Overdue (Red Glass) */}
        <div
          onClick={() => setFStatus(fStatus === 'Overdue' ? 'All' : 'Overdue')}
          className="kpi-card stat-card mobile-stats-card-3"
          style={{
            ...liquidGlassCard,
            padding: '20px 22px',
            cursor: 'pointer',
            background: fStatus === 'Overdue'
              ? 'linear-gradient(135deg, rgba(255, 59, 48, 0.26), rgba(217, 45, 32, 0.08))'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.035))',
            borderColor: fStatus === 'Overdue' ? 'rgba(255, 59, 48, 0.50)' : 'rgba(255, 255, 255, 0.20)',
            boxShadow: fStatus === 'Overdue'
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.40), 0 20px 50px rgba(255, 59, 48, 0.22)'
              : 'inset 0 1px 0 rgba(255, 255, 255, 0.30), 0 18px 45px rgba(0, 0, 0, 0.20)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-3px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div style={specularHighlight} />
          <div className="kpi-top" style={{ position: 'relative', zIndex: 2 }}>
            <div
              className="kpi-icon"
              style={{
                background: 'linear-gradient(135deg, rgba(255, 59, 48, 0.25), rgba(217, 45, 32, 0.08))',
                border: '1px solid rgba(255, 59, 48, 0.35)',
                color: '#FF3B30',
              }}
            >
              <AlertTriangle size={22} />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#FF3B30',
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(255, 59, 48, 0.15)',
                border: '1px solid rgba(255, 59, 48, 0.30)',
                letterSpacing: '0.6px',
              }}
            >
              ALERTO
            </span>
          </div>
          <div className="kpi-value" style={{ position: 'relative', zIndex: 2, marginTop: 4 }}>
            {overdue}
          </div>
          <div className="kpi-label" style={{ position: 'relative', zIndex: 2 }}>
            Lampas na
          </div>
          <div style={{ fontSize: 11, color: '#FF3B30', marginTop: 3, fontWeight: 600, position: 'relative', zIndex: 2 }}>
            Kailangan ng panibagong bakuna
          </div>
        </div>
      </div>

      {/* ── Floating Liquid Glass Filter & Search Toolbar (One Row) ────── */}
      <FilterToolbar>
        <FilterSearch
          placeholder="Maghanap ng animal, ID, breed, o item..."
          value={searchQuery}
          onChange={setSearchQuery}
          minWidth={240}
        />
        {filterTabs.map((tab) => (
          <FilterPill
            key={tab.id}
            active={fStatus === tab.id}
            onClick={() => setFStatus(tab.id)}
            label={tab.label}
            count={tab.count ?? undefined}
          />
        ))}
      </FilterToolbar>

      {/* ── Main Liquid Glass Table Card ──────────────────────────── */}
      <div style={{ ...liquidGlassCard, padding: 0 }}>
        <div style={specularHighlight} />

        {filtered.length === 0 ? (
          /* Empty State */
          <div style={{ padding: '70px 24px', textAlign: 'center', position: 'relative', zIndex: 2 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                background: '#E8F5E9',
                border: '1px solid rgba(67, 160, 71, 0.25)',
                boxShadow: '0 8px 24px rgba(46, 125, 50, 0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
                color: '#2E7D32',
              }}
            >
              <Syringe size={34} />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.3px' }}>
              Wala pang vaccination records.
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: 440, margin: '8px auto 22px', lineHeight: 1.5 }}>
              {searchQuery || fStatus !== 'All'
                ? 'Walang record na tumutugma sa iyong paghahanap o filter.'
                : 'Magtala ng unang bakuna para masubaybayan ang schedule, boosters, at proteksyon sa bukid.'}
            </p>
            <button
              onClick={() => openAdd()}
              disabled={activeAnimals.length === 0}
              style={{
                padding: '10px 24px',
                borderRadius: 999,
                background: 'linear-gradient(135deg, #43A047, #2E7D32)',
                border: '1px solid rgba(255, 255, 255, 0.30)',
                boxShadow: '0 4px 14px rgba(46, 125, 50, 0.25)',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Plus size={16} /> Mag-record ng Bakuna
            </button>
          </div>
        ) : (
          /* Data Table */
          <>
          <div className="table-wrap vaccination-table-desktop" style={{ background: 'transparent', border: 'none', boxShadow: 'none', borderRadius: 0, position: 'relative', zIndex: 2 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Petsa ng Bakuna</th>
                  <th>Kambing / Tupa</th>
                  <th>Pangalan ng Bakuna</th>
                  <th>Susunod na Bakuna</th>
                  <th>Katayuan</th>
                  <th>Beterinaryo / Kawani</th>
                  <th style={{ textAlign: 'right' }}>Aksyon</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const status = vaccinationStatusFromDue(v.next_due_date, farmData.settings?.vaccine_due_days ?? 30);
                  const aName = animalName(v.animal_id);
                  const aTag = animalTag(v.animal_id);
                  const aSpecies = animalSpecies(v.animal_id);
                  const daysLeft = v.next_due_date ? daysUntil(v.next_due_date) : null;

                  return (
                    <tr key={v.id}>
                      {/* Date Given */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Calendar size={14} color="var(--text-tertiary)" />
                          <span style={{ fontWeight: 600 }}>{formatDate(v.date_given)}</span>
                        </div>
                      </td>

                      {/* Animal */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              background: 'linear-gradient(135deg, rgba(35, 139, 69, 0.18), rgba(23, 107, 53, 0.08))',
                              border: '1px solid rgba(35, 139, 69, 0.30)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 15,
                              flexShrink: 0,
                            }}
                          >
                            <Syringe size={14} color="#238B45" />
                          </div>
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--text)', fontSize: '13px' }}>{aName}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              {aTag} • {aSpecies === 'Goat' ? 'Kambing' : 'Tupa'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Vaccine */}
                      <td>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{v.vaccine_name}</div>
                          {v.notes && (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {v.notes}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Next Due Date & Relative Time */}
                      <td>
                        <div>
                          <div style={{ fontWeight: 600, color: v.next_due_date ? 'var(--text)' : 'var(--text-tertiary)' }}>
                            {formatDate(v.next_due_date)}
                          </div>
                          {daysLeft !== null && (
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: daysLeft < 0 ? '#EF4444' : daysLeft <= 14 ? '#F59E0B' : '#238B45',
                              }}
                            >
                              {daysLeft < 0
                                ? `${Math.abs(daysLeft)} araw nang lampas`
                                : daysLeft === 0
                                ? 'Schedule na ngayon'
                                : `${daysLeft} araw ang natitira`}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td>
                        <span
                          className={`badge ${
                            status === 'Up to Date'
                              ? 'badge-healthy'
                              : status === 'Due Soon'
                              ? 'badge-orange'
                              : status === 'Overdue'
                              ? 'badge-critical'
                              : 'badge-gray'
                          }`}
                        >
                          {status === 'Up to Date' && <CheckCircle2 size={11} />}
                          {status === 'Due Soon' && <Clock size={11} />}
                          {status === 'Overdue' && <AlertTriangle size={11} />}
                          {status === 'Up to Date'
                            ? 'Ayos'
                            : status === 'Due Soon'
                            ? 'Malapit na'
                            : status === 'Overdue'
                            ? 'Lampas na (Overdue)'
                            : 'Walang Due Date'}
                        </span>
                      </td>

                      {/* Veterinarian */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: v.veterinarian ? 'var(--text)' : 'var(--text-tertiary)' }}>
                          {v.veterinarian && <User size={13} color="var(--text-tertiary)" />}
                          <span>{v.veterinarian ?? '—'}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(v)}
                            title="I-edit ang Record"
                            aria-label="I-edit ang Record"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              background: 'rgba(255, 255, 255, 0.08)',
                              border: '1px solid rgba(255, 255, 255, 0.14)',
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirmDelete(v)}
                            title="I-archive ang Record"
                            aria-label="I-archive ang Record"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              background: 'rgba(255, 59, 48, 0.12)',
                              border: '1px solid rgba(255, 59, 48, 0.28)',
                              color: '#FF3B30',
                            }}
                          >
                            <Archive size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="vaccination-cards-mobile">
            {filtered.map((v) => {
              const status = vaccinationStatusFromDue(v.next_due_date, farmData.settings?.vaccine_due_days ?? 30);
              const daysLeft = v.next_due_date ? daysUntil(v.next_due_date) : null;
              return (
                <article className="vaccination-mobile-card" key={v.id}>
                  <div className="vaccination-mobile-heading">
                    <div><strong>{v.vaccine_name}</strong><span>{animalName(v.animal_id)} · {animalTag(v.animal_id)}</span></div>
                    <span className={`vaccination-status is-${status === 'Overdue' ? 'late' : status === 'Due Soon' ? 'soon' : status === 'Up to Date' ? 'good' : 'unknown'}`}>
                      {status === 'Up to Date' ? 'Ayos' : status === 'Due Soon' ? 'Malapit na' : status === 'Overdue' ? 'Lampas na' : 'Walang petsa'}
                    </span>
                  </div>
                  <div className="vaccination-mobile-details">
                    <span>Naibigay: {formatDate(v.date_given)}</span>
                    <span>Susunod: {formatDate(v.next_due_date)}{daysLeft !== null ? daysLeft < 0 ? ` · ${Math.abs(daysLeft)} araw nang lampas` : daysLeft === 0 ? ' · Takda ngayon' : ` · ${daysLeft} araw pa` : ''}</span>
                    {v.veterinarian && <span>Beterinaryo o kawani: {v.veterinarian}</span>}
                    {v.notes && <span>Tala: {v.notes}</span>}
                  </div>
                  <div className="vaccination-mobile-actions">
                    <Button variant="secondary" size="sm" onClick={() => openEdit(v)} leftIcon={<Pencil size={14} />}>I-edit</Button>
                    <Button variant="danger" size="sm" onClick={() => setConfirmDelete(v)} leftIcon={<Archive size={14} />}>I-archive</Button>
                  </div>
                </article>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* ── Add / Edit Modal ───────────────────────────────────────── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <ModalHeader
          title={editing ? 'I-edit ang Record ng Bakuna' : 'Mag-record ng Bakuna'}
          onClose={() => setModalOpen(false)}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="Pumili ng Kambing o Tupa" required error={errors.animal_id}>
              <Select
                value={form.animal_id}
                onChange={(e) => setForm({ ...form, animal_id: e.target.value })}
                options={[
                  { value: '', label: 'Pumili ng kambing o tupa...' },
                  ...activeAnimals.map((a) => ({
                    value: a.id,
                    label: `${a.name} (${a.tag_id}) — ${a.species === 'Goat' ? 'Kambing' : 'Tupa'} • ${a.breed ?? 'Standard'}`,
                  })),
                ]}
              />
            </FormField>

            {vaccineInventory.length === 0 && (
              <div
                style={{
                  background: '#FEF3C7',
                  border: '1px solid #FCD34D',
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 13,
                  color: '#92400E',
                }}
              >
                ⚠️ Wala pang bakuna sa imbentaryo.{' '}
                <a href="/inventory" style={{ textDecoration: 'underline', fontWeight: 700 }}>
                  Magdagdag ng bakuna
                </a>{' '}
                upang maitala ang pagbabakuna at mabawasan ang stock.
              </div>
            )}

            <FormField label="Pumili ng bakuna" required error={errors.inventory_item_id || errors.vaccine_name}>
              <Select
                value={form.inventory_item_id}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const item = vaccineInventory.find((i) => i.id === selectedId);
                  setForm({
                    ...form,
                    inventory_item_id: selectedId,
                    vaccine_name: item ? item.name : '',
                  });
                }}
                options={[
                  {
                    value: '',
                    label: vaccineInventory.length === 0 ? 'Walang bakuna sa imbentaryo' : 'Pumili ng bakuna...',
                  },
                  ...vaccineInventory.map((i) => ({
                    value: i.id,
                    label: `${i.name} — ${i.quantity} ${i.unit}${Number(i.quantity) <= 0 ? ' (Ubos na)' : ''}${
                      i.expiry_date && form.date_given && i.expiry_date < form.date_given ? ' (Lampas na sa bisa)' : ''
                    }`,
                    disabled: Number(i.quantity) <= 0 || (!!i.expiry_date && !!form.date_given && i.expiry_date < form.date_given),
                  })),
                ]}
              />
            </FormField>

            {selectedVaccineItem && (
              <div
                style={{
                  background:
                    selectedVaccineItem.expiry_date && form.date_given && selectedVaccineItem.expiry_date < form.date_given
                      ? '#FEE2E2'
                      : Number(selectedVaccineItem.quantity) <= 0
                      ? '#FEE2E2'
                      : '#EAF6ED',
                  border: `1px solid ${
                    Number(selectedVaccineItem.quantity) <= 0 || (selectedVaccineItem.expiry_date && form.date_given && selectedVaccineItem.expiry_date < form.date_given)
                      ? '#FCA5A5'
                      : '#C3E6CB'
                  }`,
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 13,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  <strong>Natitirang stock:</strong>{' '}
                  <span
                    style={{
                      color:
                        Number(selectedVaccineItem.quantity) <= 0
                          ? '#EF4444'
                          : Number(selectedVaccineItem.quantity) <= Number(selectedVaccineItem.minimum_stock)
                          ? '#D97706'
                          : '#238B45',
                      fontWeight: 800,
                    }}
                  >
                    {selectedVaccineItem.quantity} {selectedVaccineItem.unit}
                  </span>
                </span>
                {selectedVaccineItem.expiry_date && (
                  <span>
                    <strong>May bisa hanggang:</strong>{' '}
                    <span
                      style={{
                        color: form.date_given && selectedVaccineItem.expiry_date < form.date_given ? '#EF4444' : '#50645A',
                        fontWeight: 700,
                      }}
                    >
                      {formatDate(selectedVaccineItem.expiry_date)}
                    </span>
                  </span>
                )}
              </div>
            )}

            <FormField label={`Bilang ng dosis (${selectedVaccineItem?.unit || 'dosis'})`} required error={errors.deduct_quantity}>
              <Input
                type="number"
                min="1"
                step="1"
                value={form.deduct_quantity}
                onChange={(e) => setForm({ ...form, deduct_quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                placeholder="1"
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Petsa ng Bakuna" required error={errors.date_given}>
                <Input
                  type="date"
                  value={form.date_given}
                  onChange={(e) => setForm({ ...form, date_given: e.target.value })}
                />
              </FormField>

              <FormField label="Susunod na bakuna" error={errors.next_due_date}>
                <Input
                  type="date"
                  value={form.next_due_date}
                  onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
                />
              </FormField>
            </div>

            <details className="farmer-form-more">
              <summary>Iba pang detalye (opsyonal)</summary>
              <div className="farmer-form-more-content">
                <FormField label="Beterinaryo o nagbakuna">
                  <ComboBox
                    value={form.veterinarian}
                    onChange={(v) => setForm({ ...form, veterinarian: v })}
                    options={COMMON_VETS}
                    placeholder="Pumili o mag-type ng pangalan..."
                  />
                </FormField>

                <FormField label="Tala tungkol sa bakuna">
                  <textarea
                    className="form-textarea"
                    placeholder="Hal. 2 ml na itinurok sa leeg. Walang naging reaksyon."
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    style={{ minHeight: 80 }}
                  />
                </FormField>
              </div>
            </details>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Kanselahin
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {editing ? 'I-save ang mga Pagbabago' : 'I-save ang Record'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Confirm Deletion Dialog ────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="I-archive ang record ng bakuna?"
        message="Mananatili ang record ng bakuna sa history at maaari itong ibalik mula sa Archived Records."
        confirmLabel="I-archive"
        cancelLabel="Huwag Muna"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
