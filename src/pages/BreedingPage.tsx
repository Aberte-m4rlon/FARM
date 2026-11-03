import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFarmData } from '../lib/useFarmData';
import { isAnimalActive } from '../lib/animalLifecycle';

import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter, ConfirmDialog } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input, Select, FormField } from '../components/ui/Input';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { FilterToolbar, FilterSearch, FilterSelect } from '../components/FilterToolbar';
import { Icons } from '../lib/icons';
import {
  Plus,
  Pencil,
  Archive,
  Baby,
  CheckCircle2,
  Tag,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Calendar,
  HeartHandshake,
} from 'lucide-react';
import {
  calculateKiddingDate,
  formatDate,
  daysUntil,
  assessBreedingReadiness,
  monthsSince,
  type BreedingAssessment,
} from '../lib/analytics';
import { createNotification } from '../lib/recommendations';
import { generateNextAnimalId, fetchNextUniqueAnimalId, insertAnimalWithUniqueRetry, createAnimalWithInitialWeight } from '../lib/animalId';
import { formatBreedingDate, isBreedingDue, localDateKey } from '../lib/breedingWorkflow';
import './BreedingDueList.css';
import type { Animal, BreedingRecord, Species, Sex } from '../types';

const emptyForm = {
  animal_id: '',
  partner_id: '',
  mating_date: new Date().toISOString().split('T')[0],
  status: 'Pregnant',
  notes: '',
};


/**
 * Helper to compute professional veterinary-style readiness card metadata
 */
function getAnimalReadinessCardData(
  animal: Animal,
  assessment: BreedingAssessment | undefined,
  settings: { breeding_min_age_months?: number; breeding_min_weight_kg?: number } | null | undefined
) {
  const isFemale = animal.sex === 'Female';
  const isReady = assessment?.recommendation === 'Ready';
  const isPregnant = animal.breeding_status === 'Pregnant';
  const age = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
  const minAge = settings?.breeding_min_age_months ?? 8;
  const minWeight = settings?.breeding_min_weight_kg ?? 25;

  if (isReady) {
    const reasons: string[] = [];
    reasons.push(`Pasok sa naitalang edad at pamantayan ng timbang${age ? ` (${age} buwang gulang)` : ''}`);
    if (animal.weight_kg) {
      reasons.push(`Sapat ang timbang (${animal.weight_kg} kg ≥ ${minWeight} kg)`);
    } else {
      reasons.push('Sapat ang minimum na timbang sa pagpapalahi');
    }
    if (assessment?.reasons && assessment.reasons.length > 0) {
      assessment.reasons.forEach((r) => {
        if (!reasons.includes(r) && !r.toLowerCase().includes('healthy, mature')) {
          reasons.push(r);
        }
      });
    }

    return {
      statusType: 'ready',
      statusLabel: isFemale ? 'Handa nang I-mate' : 'Handang Barako',
      StatusIcon: CheckCircle2,
      ReasonIcon: CheckCircle2,
      reasons: reasons.slice(0, 3),
      cardClass: 'readiness-card-ready',
      badgeClass: 'badge-ready',
      dotClass: 'dot-ready',
      iconClass: 'icon-ready',
    };
  }

  if (isPregnant) {
    return {
      statusType: 'pregnant',
      statusLabel: 'Kasalukuyang Buntis',
      StatusIcon: Clock,
      ReasonIcon: AlertCircle,
      reasons: ['Kasalukuyang nagbubuntis (hindi maaaring i-mate)'],
      cardClass: 'readiness-card-pregnant',
      badgeClass: 'badge-pregnant',
      dotClass: 'dot-pregnant',
      iconClass: 'icon-pregnant',
    };
  }

  // Determine specific warning reason
  const reasons = assessment?.reasons && assessment.reasons.length > 0
    ? assessment.reasons
    : ['Hindi pa pasok sa pamantayan ng pagpapalahi'];

  let statusLabel = 'Hindi Pa Handa';
  let StatusIcon = AlertTriangle;
  let statusType = 'warning';

  if (age !== null && age < minAge) {
    statusLabel = 'Masyado Pang Bata';
  } else if (animal.weight_kg !== null && Number(animal.weight_kg) < minWeight) {
    statusLabel = 'Kulang sa Timbang';
  }

  return {
    statusType,
    statusLabel,
    StatusIcon,
    ReasonIcon: AlertCircle,
    reasons,
    cardClass: statusType === 'danger' ? 'readiness-card-danger' : 'readiness-card-warning',
    badgeClass: statusType === 'danger' ? 'badge-danger' : 'badge-warning',
    dotClass: statusType === 'danger' ? 'dot-danger' : 'dot-warning',
    iconClass: statusType === 'danger' ? 'icon-danger' : 'icon-warning',
  };
}

export function BreedingPage() {
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();


  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BreedingRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BreedingRecord | null>(null);
  const [fStatus, setFStatus] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [readinessTab, setReadinessTab] = useState<'females' | 'males' | 'not_ready'>('females');
  const [today, setToday] = useState(localDateKey());

  // Newborn registration state
  const [offspringModalOpen, setOffspringModalOpen] = useState(false);
  const [offspringMother, setOffspringMother] = useState<Animal | null>(null);
  const [offspringForm, setOffspringForm] = useState({
    tag_id: '',
    name: '',
    species: 'Goat' as Species,
    breed: '',
    sex: 'Female' as Sex,
    date_of_birth: new Date().toISOString().split('T')[0],
    weight_kg: '3.0',
    notes: '',
  });
  const [savingOffspring, setSavingOffspring] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateKey()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const dueBreedingRecords = useMemo(() => farmData.breedingRecords
    .filter((record) => isBreedingDue(record.status, record.expected_kidding_date, today) && !record.actual_kidding_date)
    .sort((a, b) => String(a.expected_kidding_date).localeCompare(String(b.expected_kidding_date))), [farmData.breedingRecords, today]);

  const hasRegisteredNewborns = (record: BreedingRecord) => {
    const mother = farmData.animals.find((animal) => animal.id === record.animal_id);
    const recordedDate = record.actual_kidding_date || record.expected_kidding_date;
    const legacyParentNote = mother ? `Ina: ${mother.name} (${mother.tag_id})` : '';
    return farmData.animals.some((newborn) => (
      newborn.mother_animal_id === record.animal_id
      && Boolean(newborn.birth_event_id)
      && newborn.date_of_birth === recordedDate
    ) || (
      Boolean(legacyParentNote)
      && newborn.date_of_birth === recordedDate
      && (newborn.notes || '').includes(legacyParentNote)
    ));
  };

  const females = useMemo(() => farmData.animals.filter((a) => isAnimalActive(a) && a.sex === 'Female'), [farmData.animals]);
  const males = useMemo(() => farmData.animals.filter((a) => isAnimalActive(a) && a.sex === 'Male'), [farmData.animals]);

  // Comprehensive Breeding Assessments for all females and males
  const femaleAssessments = useMemo(() => {
    if (!farmData.settings) return new Map<string, BreedingAssessment>();
    const map = new Map<string, BreedingAssessment>();
    females.forEach((f) => {
      const lastMating = farmData.breedingRecords
        .filter((b) => b.animal_id === f.id)
        .sort((a, b) => new Date(b.mating_date).getTime() - new Date(a.mating_date).getTime())[0] ?? null;
      map.set(f.id, assessBreedingReadiness(f, farmData.settings!, lastMating));
    });
    return map;
  }, [females, farmData.breedingRecords, farmData.settings]);

  const maleAssessments = useMemo(() => {
    if (!farmData.settings) return new Map<string, BreedingAssessment>();
    const map = new Map<string, BreedingAssessment>();
    males.forEach((m) => {
      map.set(m.id, assessBreedingReadiness(m, farmData.settings!, null));
    });
    return map;
  }, [males, farmData.settings]);

  const readyFemales = useMemo(() => {
    return females.filter((f) => femaleAssessments.get(f.id)?.recommendation === 'Ready');
  }, [females, femaleAssessments]);

  const notReadyFemales = useMemo(() => {
    return females.filter((f) => femaleAssessments.get(f.id)?.recommendation !== 'Ready');
  }, [females, femaleAssessments]);

  const readyMales = useMemo(() => {
    return males.filter((m) => maleAssessments.get(m.id)?.recommendation === 'Ready');
  }, [males, maleAssessments]);

  const notReadyMales = useMemo(() => {
    return males.filter((m) => maleAssessments.get(m.id)?.recommendation !== 'Ready');
  }, [males, maleAssessments]);

  // Selected animal live assessments in modal
  const selectedFemale = useMemo(() => {
    return females.find((a) => a.id === form.animal_id) || null;
  }, [females, form.animal_id]);

  const selectedFemaleAssessment = useMemo(() => {
    if (!selectedFemale || !farmData.settings) return null;
    return femaleAssessments.get(selectedFemale.id) || null;
  }, [selectedFemale, femaleAssessments, farmData.settings]);

  const selectedMale = useMemo(() => {
    return males.find((a) => a.id === form.partner_id) || null;
  }, [males, form.partner_id]);

  const selectedMaleAssessment = useMemo(() => {
    if (!selectedMale || !farmData.settings) return null;
    return maleAssessments.get(selectedMale.id) || null;
  }, [selectedMale, maleAssessments, farmData.settings]);

  // Inbreeding & Species Compatibility Warnings
  const inbreedingWarning = useMemo(() => {
    if (!selectedFemale || !selectedMale) return null;
    if (selectedFemale.id === selectedMale.id) return 'Dam and Sire cannot be the same animal.';
    if (selectedFemale.species !== selectedMale.species) {
      return `Species mismatch: Dam is a ${selectedFemale.species} while Sire is a ${selectedMale.species}.`;
    }
    const damNotes = (selectedFemale.notes || '').toLowerCase();
    const sireNotes = (selectedMale.notes || '').toLowerCase();
    if (
      damNotes.includes(selectedMale.tag_id.toLowerCase()) ||
      sireNotes.includes(selectedFemale.tag_id.toLowerCase()) ||
      (selectedFemale.breed && selectedMale.breed && selectedFemale.breed === selectedMale.breed && damNotes.includes('sire') && sireNotes.includes('sire'))
    ) {
      return 'Potential close lineage detected between selected Dam and Sire. Verify pedigree to prevent inbreeding.';
    }
    return null;
  }, [selectedFemale, selectedMale]);

  // Filtered and Searched breeding records
  const filtered = useMemo(() => {
    return farmData.breedingRecords
      .filter((r) => {
        const matchesStatus = fStatus === 'All' || r.status === fStatus;
        if (!matchesStatus) return false;

        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const female = farmData.animals.find((a) => a.id === r.animal_id);
        const male = farmData.animals.find((a) => a.id === r.partner_id);

        const femaleName = (female?.name || '').toLowerCase();
        const femaleTag = (female?.tag_id || '').toLowerCase();
        const femaleBreed = (female?.breed || '').toLowerCase();
        const maleName = (male?.name || '').toLowerCase();
        const maleTag = (male?.tag_id || '').toLowerCase();
        const notes = (r.notes || '').toLowerCase();

        return (
          femaleName.includes(q) ||
          femaleTag.includes(q) ||
          femaleBreed.includes(q) ||
          maleName.includes(q) ||
          maleTag.includes(q) ||
          notes.includes(q)
        );
      })
      .sort((a, b) => new Date(b.mating_date).getTime() - new Date(a.mating_date).getTime());
  }, [farmData.breedingRecords, farmData.animals, fStatus, searchQuery]);

  const breedingStats = useMemo(() => {
    const pregnant = farmData.breedingRecords.filter((r) => r.status === 'Pregnant').length;
    const mating = farmData.breedingRecords.filter((r) => (r.status as string) === 'Mated' || r.status === 'Planned').length || readyFemales.length;
    const expectedKidding = farmData.breedingRecords.filter((r) => {
      if (r.status !== 'Pregnant' || !r.expected_kidding_date) return false;
      const days = daysUntil(r.expected_kidding_date);
      return days !== null && days <= 60;
    }).length || pregnant;

    return {
      pregnant,
      mating,
      expectedKidding,
    };
  }, [farmData.breedingRecords, readyFemales]);

  const openAdd = (preselectedAnimalId?: string) => {
    setEditing(null);
    const selectedAnimal = farmData.animals.find((animal) =>
      animal.id === preselectedAnimalId && isAnimalActive(animal),
    );
    setForm({
      ...emptyForm,
      animal_id: selectedAnimal?.sex === 'Female' ? selectedAnimal.id : readyFemales[0]?.id ?? '',
      partner_id: selectedAnimal?.sex === 'Male' ? selectedAnimal.id : readyMales[0]?.id ?? '',
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


  const openEdit = (r: BreedingRecord) => {
    setEditing(r);
    setForm({
      animal_id: r.animal_id,
      partner_id: r.partner_id ?? '',
      mating_date: r.mating_date,
      status: r.status,
      notes: r.notes ?? '',
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};

    if (!form.animal_id) {
      e.animal_id = 'Pumili ng inahing kambing o tupa (Dam).';
    } else if (!editing && selectedFemaleAssessment && selectedFemaleAssessment.recommendation !== 'Ready') {
      e.animal_id = `Hindi pa handa sa mating ang inahing ito: ${selectedFemaleAssessment.reasons.join(', ')}`;
    }

    if (form.partner_id) {
      if (form.partner_id === form.animal_id) {
        e.partner_id = 'Hindi maaaring pareho ang lalaki at babae.';
      } else if (!editing && selectedMaleAssessment && selectedMaleAssessment.recommendation !== 'Ready') {
        e.partner_id = `Hindi pa handa sa mating ang napiling barako: ${selectedMaleAssessment.reasons.join(', ')}`;
      }
    }

    if (!form.mating_date) {
      e.mating_date = 'Kailangan ang mating date.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;

    const female = farmData.animals.find((a) => a.id === form.animal_id);
    if (!female || (!isSuperAdmin && female.user_id !== user.id)) {
      toast('Walang pahintulot sa napiling inahin.', 'danger');
      return;
    }

    if (form.partner_id) {
      const partner = farmData.animals.find((a) => a.id === form.partner_id);
      if (!partner || (!isSuperAdmin && partner.user_id !== user.id)) {
        toast('Walang pahintulot sa napiling barako.', 'danger');
        return;
      }
    }

    setSaving(true);

    const kiddingDate =
      form.status === 'Pregnant'
        ? calculateKiddingDate(form.mating_date, farmData.settings?.gestation_days ?? 150)
        : null;

    const payload = {
      user_id: user.id,
      animal_id: form.animal_id,
      partner_id: form.partner_id || null,
      mating_date: form.mating_date,
      expected_kidding_date: kiddingDate,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    try {
      if (editing) {
        let updateQuery = supabase.from('breeding_records').update(payload).eq('id', editing.id);
        if (!isSuperAdmin) {
          updateQuery = updateQuery.eq('user_id', user.id);
        }
        const { error } = await updateQuery;
        if (error) throw error;
        toast('Matagumpay na na-update ang record ng breeding.', 'success');
      } else {
        const { error } = await supabase.from('breeding_records').insert(payload);
        if (error) throw error;
        toast('Matagumpay na na-save ang record ng breeding.', 'success');

        if (kiddingDate && form.status === 'Pregnant') {
          const femaleSpecies = female?.species === 'Sheep' ? 'tupa' : 'kambing';
          await createNotification(
            user.id,
            'Breeding',
            `Inaasahang Panganganak: ${female?.name ?? (female?.species === 'Sheep' ? 'Tupa' : 'Kambing')}`,
            `Ang ${female?.name ?? femaleSpecies} ay inaasahang manganganak bandang ${formatDate(kiddingDate)}.`,
            'Normal',
            '/breeding',
            `breeding_kidding_${form.animal_id}_${kiddingDate}`
          );
        }
      }

      let animalUpdate = supabase
        .from('animals')
        .update({
          breeding_status: form.status,
          expected_kidding_date: kiddingDate,
        })
        .eq('id', form.animal_id);

      if (!isSuperAdmin) {
        animalUpdate = animalUpdate.eq('user_id', user.id);
      }
      const { data: updatedAnimal, error: animalUpdateError } = await animalUpdate
        .select('id')
        .maybeSingle();
      if (animalUpdateError || !updatedAnimal) {
        console.error('Breeding record saved, but the animal status update failed.', animalUpdateError);
        toast(
          'Na-save ang breeding record pero hindi na-update ang status ng inahin. Isara ang form at i-edit ang parehong record para muling subukan; huwag gumawa ng panibagong record.',
          'danger'
        );
        setModalOpen(false);
        await farmData.refresh();
        return;
      }
      if (editing?.expected_kidding_date && editing.expected_kidding_date !== kiddingDate) {
        const { error: notificationUpdateError } = await supabase.from('notifications').update({ read: true, is_read: true, updated_at: new Date().toISOString() })
          .eq('user_id', editing.user_id)
          .eq('event_key', `breeding_kidding_${editing.animal_id}_${editing.expected_kidding_date}`);
        if (notificationUpdateError) {
          console.warn('Could not mark the previous breeding date notification as read:', notificationUpdateError.message);
        }
      }
      const { error: dueSyncError } = await supabase.rpc('sync_breeding_due_alerts');
      if (dueSyncError) console.warn('Breeding due-alert sync will retry in the background.', dueSyncError.message);

      setModalOpen(false);
      farmData.refresh();
    } catch (error) {
      console.error('Breeding record save failed:', error);
      toast(
        error instanceof Error && error.message
          ? error.message
          : 'Hindi ma-save ang record ng breeding. Pakisubukang muli.',
        'danger'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    try {
      let deleteQuery = supabase.from('breeding_records').update({ archived_at: new Date().toISOString(), archived_by: user.id }).eq('id', confirmDelete.id);
      if (!isSuperAdmin) {
        deleteQuery = deleteQuery.eq('user_id', user.id);
      }
      const { error } = await deleteQuery;
      if (error) throw error;
      const { error: dueSyncError } = await supabase.rpc('sync_breeding_due_alerts');
      if (dueSyncError) console.warn('Breeding due-alert sync will retry in the background.', dueSyncError.message);
      toast('In-archive ang record ng breeding. Maaari itong ibalik mula sa Archived Records.', 'success');
      setConfirmDelete(null);
      farmData.refresh();
    } catch {
      toast('Hindi ma-archive ang record ng breeding. Pakisubukang muli.', 'danger');
    }
  };

  const openRegisterOffspring = (record?: BreedingRecord) => {
    if (record) {
      // Births attached to a breeding record use the transactional birth workflow.
      navigate(`/breeding?breedingId=${encodeURIComponent(record.id)}`);
      return;
    }
    const mother = readyFemales[0] || females[0];
    const species = (mother?.species || 'Goat') as Species;
    const candidateId = generateNextAnimalId(species, farmData.animals);

    setOffspringMother(mother || null);
    setOffspringForm({
      tag_id: candidateId,
      name: mother ? `${mother.name}'s Kid` : 'Bagong Silang',
      species,
      breed: mother?.breed || '',
      sex: 'Female',
      date_of_birth: localDateKey(),
      weight_kg: species === 'Goat' ? '3.0' : '3.5',
      notes: mother ? `Ina: ${mother.name} (${mother.tag_id})` : '',
    });
    setOffspringModalOpen(true);

    fetchNextUniqueAnimalId(species, user?.id).then((freshId) => {
      setOffspringForm((prev) => (prev.species === species ? { ...prev, tag_id: freshId } : prev));
    }).catch(() => {});
  };

  const handleSpeciesChangeOffspring = (newSpecies: Species) => {
    const candidateId = generateNextAnimalId(newSpecies, farmData.animals);
    setOffspringForm((prev) => ({
      ...prev,
      species: newSpecies,
      tag_id: candidateId,
    }));
    fetchNextUniqueAnimalId(newSpecies, user?.id).then((freshId) => {
      setOffspringForm((prev) => (prev.species === newSpecies ? { ...prev, tag_id: freshId } : prev));
    }).catch(() => {});
  };

  const handleSaveOffspring = async () => {
    if (!user) return;
    if (!offspringForm.name.trim()) {
      toast('Pakilagay ang pangalan ng bagong silang na alaga.', 'warning');
      return;
    }
    setSavingOffspring(true);
    try {
      const payload = {
        name: offspringForm.name.trim(),
        species: offspringForm.species,
        breed: offspringForm.breed.trim() || null,
        sex: offspringForm.sex,
        date_of_birth: offspringForm.date_of_birth || null,
        weight_kg: offspringForm.weight_kg ? Number(offspringForm.weight_kg) : null,
        notes: offspringForm.notes.trim() || null,
        user_id: user?.id,
      };

      const initialWeight = offspringForm.weight_kg ? Number(offspringForm.weight_kg) : null;
      const result = await createAnimalWithInitialWeight(payload, initialWeight, {
        onAutoIncrement: (newId) => {
          setOffspringForm((prev) => ({ ...prev, tag_id: newId }));
        },
      });

      if (result.error) throw result.error;

      if (offspringMother) {
        await supabase
          .from('animals')
          .update({
            breeding_status: 'Lactating',
            expected_kidding_date: null,
          })
          .eq('id', offspringMother.id);
      }

      if (result.initialWeightRecorded) {
        toast(`Matagumpay na nairehistro ang supling (${result.finalTagId}) at na-record ang unang timbang.`, 'success');
      } else {
        toast(`Matagumpay na nairehistro ang supling na may Tag ID: ${result.finalTagId}`, 'success');
      }
      setOffspringModalOpen(false);
      farmData.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hindi mairehistro ang supling.';
      toast(msg, 'danger');
    } finally {
      setSavingOffspring(false);
    }
  };

  const renderStatusPill = (status: string) => {
    let className = 'breeding-status-pill ';
    let label = status;

    if (status === 'Pregnant') {
      className += 'breeding-status-pregnant';
      label = 'Buntis';
    } else if (status === 'Kidded' || status === 'Delivered') {
      className += 'breeding-status-kidded';
      label = 'Nanganak na';
    } else if (status === 'Failed') {
      className += 'breeding-status-failed';
      label = 'Hindi Nabuntis';
    } else if (status === 'Monitor') {
      className += 'breeding-status-monitor';
      label = 'Naghihintay';
    } else {
      className += 'breeding-status-planned';
      label = 'Nakaplano';
    }

    return <span className={className}>{label}</span>;
  };

  const renderKiddingInfo = (dateStr: string | null, status: string) => {
    if (!dateStr) return <span style={{ color: 'var(--color-text-muted, #94A3B8)' }}>—</span>;
    const days = daysUntil(dateStr);

    let daysElement = null;
    if (status === 'Pregnant') {
      if (days === 0) {
        daysElement = <span style={{ fontSize: '11.5px', color: '#2E7D32', fontWeight: 700 }}>Manganganak na ngayon!</span>;
      } else if (days > 0) {
        const isUrgent = days <= 14;
        daysElement = (
          <span style={{ fontSize: '11.5px', color: isUrgent ? '#D97706' : '#2E7D32', fontWeight: 600 }}>
            {days} araw ang natitira{isUrgent ? ' (Malapit na)' : ''}
          </span>
        );
      } else {
        daysElement = (
          <span style={{ fontSize: '11.5px', color: '#DC2626', fontWeight: 700 }}>
            {Math.abs(days)} araw nang lampas sa schedule
          </span>
        );
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--color-text-primary, #0F172A)' }}>
          {formatDate(dateStr)}
        </span>
        {daysElement}
      </div>
    );
  };

  return (
    <div className="breeding-page-container">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: 'var(--color-text-primary, #0F172A)', letterSpacing: '-0.02em' }}>
            Breeding ng Kambing at Tupa
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary, #475569)', fontSize: '14px' }}>
            {farmData.breedingRecords.length} kabuuang records sa breeding ng kambing at tupa · {readyFemales.length} inahing handa · {readyMales.length} barakong handa
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => openRegisterOffspring()} leftIcon={<Baby size={16} />}>
            Magrehistro ng Bagong Silang
          </Button>
          <Button
            variant="primary"
            onClick={() => openAdd()}
            disabled={readyFemales.length === 0}
            leftIcon={<Plus size={16} />}
            title={readyFemales.length === 0 ? 'Walang inahing kambing o tupa na handa sa mating sa kasalukuyan' : 'Magdagdag ng Record ng Breeding'}
          >
            Magdagdag ng Record ng Breeding
          </Button>
        </div>
      </div>

      {/* 3-Column Summary Cards: Pregnant | Mating | Expected Kidding */}
      <div className="mobile-stats-grid-3">
        {/* Pregnant */}
        <div
          onClick={() => setFStatus(fStatus === 'Pregnant' ? 'All' : 'Pregnant')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: fStatus === 'Pregnant' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Buntis (Pregnant)
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Baby size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {breedingStats.pregnant}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Inahing buntis
            </div>
          </div>
        </div>

        {/* Mating */}
        <div
          onClick={() => setFStatus(fStatus === 'Mated' ? 'All' : 'Mated')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: fStatus === 'Mated' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Mating
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HeartHandshake size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {breedingStats.mating}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Handa / Naka-mate
            </div>
          </div>
        </div>

        {/* Expected Kidding */}
        <div
          className="stat-card"
          style={{
            background: 'var(--color-surface, rgba(255, 255, 255, 0.05))',
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Manganganak
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Calendar size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {breedingStats.expectedKidding}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Expected kidding
            </div>
          </div>
        </div>
      </div>

      {dueBreedingRecords.length > 0 && (
        <section className="breeding-due-list" aria-labelledby="breeding-due-title">
          <div className="breeding-due-list-heading">
            <div>
              <h2 id="breeding-due-title">May {dueBreedingRecords.length} hayop na due ngayon</h2>
              <p>Pakitingnan ang bawat alaga at itala lamang ang aktuwal na resulta.</p>
            </div>
            <span className="breeding-due-list-count">{dueBreedingRecords.length}</span>
          </div>
          <div className="breeding-due-list-items">
            {dueBreedingRecords.map((record) => {
              const animal = farmData.animals.find((row) => row.id === record.animal_id);
              return (
                <div className="breeding-due-list-item" key={record.id}>
                  <div className="breeding-due-list-animal">
                    <strong>{animal?.name || 'Alaga'}</strong>
                    <span>{animal?.tag_id || '—'} · {animal?.species === 'Sheep' ? 'Tupa' : 'Kambing'}</span>
                  </div>
                  <span className="breeding-due-list-date">
                    {record.expected_kidding_date && record.expected_kidding_date < today ? 'Lampas sa petsa' : 'Due ngayon'} · {formatBreedingDate(record.expected_kidding_date)}
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/breeding?breedingId=${encodeURIComponent(record.id)}`)}>
                    Tingnan / I-record
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Breeding Readiness Center */}
      <div className="breeding-readiness-card">
        <div className="readiness-header-row">
          <div className="readiness-title-group">
            <h2 className="readiness-title">Kahandaan sa Pagpapalahi</h2>
            <p className="readiness-subtitle">
              Tanging ang mga malulusog at sapat sa gulang ({farmData.settings?.breeding_min_age_months ?? 8} buwan) at timbang ({farmData.settings?.breeding_min_weight_kg ?? 25} kg) ang maaaring i-mate.
            </p>
          </div>

          {/* Sub Tabs */}
          <div className="readiness-tabs-nav">
            <button
              type="button"
              onClick={() => setReadinessTab('females')}
              className={`readiness-tab-btn ${readinessTab === 'females' ? 'active' : ''}`}
            >
              <span>Handang Babae</span>
              <span className="readiness-tab-count">{readyFemales.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setReadinessTab('males')}
              className={`readiness-tab-btn ${readinessTab === 'males' ? 'active' : ''}`}
            >
              <span>Handang Barako</span>
              <span className="readiness-tab-count">{readyMales.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setReadinessTab('not_ready')}
              className={`readiness-tab-btn ${readinessTab === 'not_ready' ? 'active' : ''}`}
            >
              <span>Hindi Pa Handa</span>
              <span className="readiness-tab-count warning">{notReadyFemales.length + notReadyMales.length}</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Ready Females */}
        {readinessTab === 'females' && (
          readyFemales.length === 0 ? (
            <EmptyState
              icon={<Icons.Heart size={28} />}
              title="Walang inahing kambing o tupa na handa sa mating ngayon"
              description="Kailangan maabot ng inahin ang tamang edad at timbang para makapag-mate."
            />
          ) : (
            <div className="readiness-cards-grid">
              {readyFemales.map((animal) => {
                const assessment = femaleAssessments.get(animal.id);
                const age = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
                const cardData = getAnimalReadinessCardData(animal, assessment, farmData.settings);
                const { StatusIcon, ReasonIcon } = cardData;

                return (
                  <div key={animal.id} className={`animal-readiness-card ${cardData.cardClass}`}>
                    <div className="readiness-card-header">
                      <div className="readiness-animal-info">
                        <div className="readiness-name-row">
                          <span className={`readiness-status-dot ${cardData.dotClass}`} />
                          <h3 className="readiness-animal-name" title={animal.name}>{animal.name}</h3>
                        </div>
                        <span className="readiness-tag-badge">{animal.tag_id}</span>
                      </div>
                    </div>

                    <div className="readiness-meta-row">
                      <span>{animal.breed || animal.species}</span>
                      <span className="readiness-meta-sep">•</span>
                      <span>{age ? `${age} mos old` : 'Age verified'}</span>
                    </div>

                    <div className="readiness-weight-row">
                      <span>{animal.weight_kg ? `${animal.weight_kg} kg` : 'Weight met'}</span>
                    </div>

                    <div className="readiness-badge-row">
                      <span className={`readiness-status-badge ${cardData.badgeClass}`}>
                        <StatusIcon size={13} strokeWidth={2.5} />
                        <span>{cardData.statusLabel}</span>
                      </span>
                    </div>

                    <div className="readiness-reasons-list">
                      {cardData.reasons.map((reason, idx) => (
                        <div key={idx} className="readiness-reason-item">
                          <ReasonIcon size={12} className={`reason-icon ${cardData.iconClass}`} />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Tab 2: Ready Sires */}
        {readinessTab === 'males' && (
          readyMales.length === 0 ? (
            <EmptyState
              icon={<Icons.Heart size={28} />}
              title="Walang lalaking barako na handa ngayon"
              description="Kailangan maabot ng barako ang tamang edad at timbang para magamit sa pagpapalahi."
            />
          ) : (
            <div className="readiness-cards-grid">
              {readyMales.map((animal) => {
                const assessment = maleAssessments.get(animal.id);
                const age = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
                const cardData = getAnimalReadinessCardData(animal, assessment, farmData.settings);
                const { StatusIcon, ReasonIcon } = cardData;

                return (
                  <div key={animal.id} className={`animal-readiness-card ${cardData.cardClass}`}>
                    <div className="readiness-card-header">
                      <div className="readiness-animal-info">
                        <div className="readiness-name-row">
                          <span className={`readiness-status-dot ${cardData.dotClass}`} />
                          <h3 className="readiness-animal-name" title={animal.name}>{animal.name}</h3>
                        </div>
                        <span className="readiness-tag-badge">{animal.tag_id}</span>
                      </div>
                    </div>

                    <div className="readiness-meta-row">
                      <span>{animal.breed || animal.species} Sire</span>
                      <span className="readiness-meta-sep">•</span>
                      <span>{age ? `${age} buwan` : 'Kumpirmado ang edad'}</span>
                    </div>

                    <div className="readiness-weight-row">
                      <span>{animal.weight_kg ? `${animal.weight_kg} kg` : 'Sapat ang timbang'}</span>
                    </div>

                    <div className="readiness-badge-row">
                      <span className={`readiness-status-badge ${cardData.badgeClass}`}>
                        <StatusIcon size={13} strokeWidth={2.5} />
                        <span>{cardData.statusLabel}</span>
                      </span>
                    </div>

                    <div className="readiness-reasons-list">
                      {cardData.reasons.map((reason, idx) => (
                        <div key={idx} className="readiness-reason-item">
                          <ReasonIcon size={12} className={`reason-icon ${cardData.iconClass}`} />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Tab 3: Not Yet Ready Animals */}
        {readinessTab === 'not_ready' && (
          (notReadyFemales.length === 0 && notReadyMales.length === 0) ? (
            <EmptyState
              icon={<CheckCircle2 size={28} color="#2E7D32" />}
              title="Lahat ng aktibong kambing at tupa ay handa sa pagpapalahi"
              description="Walang alaga na kasalukuyang pinipigilan ng edad, timbang, o pagbubuntis."
            />
          ) : (
            <div className="readiness-cards-grid">
              {[...notReadyFemales, ...notReadyMales].map((animal) => {
                const isFemale = animal.sex === 'Female';
                const assessment = isFemale ? femaleAssessments.get(animal.id) : maleAssessments.get(animal.id);
                const age = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
                const cardData = getAnimalReadinessCardData(animal, assessment, farmData.settings);
                const { StatusIcon, ReasonIcon } = cardData;

                return (
                  <div key={animal.id} className={`animal-readiness-card ${cardData.cardClass}`}>
                    <div className="readiness-card-header">
                      <div className="readiness-animal-info">
                        <div className="readiness-name-row">
                          <span className={`readiness-status-dot ${cardData.dotClass}`} />
                          <h3 className="readiness-animal-name" title={animal.name}>{animal.name}</h3>
                        </div>
                        <span className="readiness-tag-badge">{animal.tag_id}</span>
                      </div>
                    </div>

                    <div className="readiness-meta-row">
                      <span>{animal.sex === 'Female' ? 'Babae' : 'Lalaki'} · {animal.breed || (animal.species === 'Goat' ? 'Kambing' : 'Tupa')}</span>
                      <span className="readiness-meta-sep">•</span>
                      <span>{age ? `${age} buwan` : 'Walang nakatalang kapanganakan'}</span>
                    </div>

                    <div className="readiness-weight-row">
                      <span>{animal.weight_kg ? `${animal.weight_kg} kg` : 'Walang nakatalang timbang'}</span>
                    </div>

                    <div className="readiness-badge-row">
                      <span className={`readiness-status-badge ${cardData.badgeClass}`}>
                        <StatusIcon size={13} strokeWidth={2.5} />
                        <span>{cardData.statusLabel}</span>
                      </span>
                    </div>

                    <div className="readiness-reasons-list">
                      {cardData.reasons.map((reason, idx) => (
                        <div key={idx} className="readiness-reason-item">
                          <ReasonIcon size={12} className={`reason-icon ${cardData.iconClass}`} />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Filter Toolbar with Search & Status Filter */}
      <FilterToolbar>
        <FilterSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Maghanap ng animal, ID, breed, o item..."
          minWidth={260}
        />
        <FilterSelect
          value={fStatus}
          onChange={setFStatus}
          options={[
            { value: 'All', label: 'Lahat ng Status' },
            { value: 'Planned', label: 'Pending / Nakaplano' },
            { value: 'Pregnant', label: 'Pregnant / Buntis' },
            { value: 'Kidded', label: 'Completed / Nanganak na' },
            { value: 'Failed', label: 'Hindi Buntis / Failed' },
            { value: 'Monitor', label: 'Pending / Naghihintay' },
          ]}
          ariaLabel="Salain ayon sa Status"
          minWidth={160}
        />
      </FilterToolbar>

      {/* ── Desktop & Tablet Table (Hidden on Mobile < 768px) ── */}
      <div className="breeding-desktop-table">
        <div className="breeding-table-wrapper">
          {filtered.length === 0 ? (
            <div style={{ padding: 40 }}>
              <EmptyState
                icon={<Icons.Heart size={32} />}
                title="Wala pang breeding records."
                description={
                  searchQuery || fStatus !== 'All'
                    ? 'Walang record na tumutugma sa iyong paghahanap.'
                    : 'Magsimulang mag-record sa pamamagitan ng pagdagdag ng unang record ng breeding.'
                }
                actionLabel="Magdagdag ng Record"
                onAction={openAdd}
              />
            </div>
          ) : (
            <table className="breeding-table">
              <thead>
                <tr>
                  <th className="breeding-col-female">Babae (Inahin)</th>
                  <th className="breeding-col-partner">Lalaki (Barako)</th>
                  <th className="breeding-col-date">Araw ng Pagpapalahi</th>
                  <th className="breeding-col-kidding">Inaasahang Panganganak</th>
                  <th className="breeding-col-status">Katayuan sa Pagpapalahi</th>
                  <th className="breeding-col-actions">Aksyon</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const female = farmData.animals.find((a) => a.id === b.animal_id);
                  const male = farmData.animals.find((a) => a.id === b.partner_id);

                  return (
                    <tr key={b.id}>
                      {/* Female Dam Column */}
                      <td className="breeding-col-female">
                        <div style={{ maxWidth: 220 }}>
                          <div className="animal-cell-title" title={female?.name || 'Hindi Tukoy'}>
                            {female?.name || 'Hindi Tukoy na Babae'}
                          </div>
                          <div className="animal-cell-subtitle" title={`${female?.tag_id || ''} ${female?.breed ? `• ${female.breed}` : female?.species ? `• ${female.species === 'Goat' ? 'Kambing' : 'Tupa'}` : ''}`}>
                            {female?.tag_id || 'Walang Tag'} {female?.breed ? `• ${female.breed}` : female?.species ? `• ${female.species === 'Goat' ? 'Kambing' : 'Tupa'}` : ''}
                          </div>
                        </div>
                      </td>

                      {/* Partner Sire Column */}
                      <td className="breeding-col-partner">
                        {male ? (
                          <div style={{ maxWidth: 200 }}>
                            <div className="animal-cell-title" title={male.name}>
                              {male.name}
                            </div>
                            <div className="animal-cell-subtitle" title={`${male.tag_id} ${male.breed ? `• ${male.breed}` : ''}`}>
                              {male.tag_id} {male.breed ? `• ${male.breed}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted, #94A3B8)', fontSize: '13px' }}>Walang nakatakda</span>
                        )}
                      </td>

                      {/* Mating Date Column */}
                      <td className="breeding-col-date">
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary, #0F172A)', fontSize: '13.5px' }}>
                          {formatDate(b.mating_date)}
                        </div>
                      </td>

                      {/* Expected Kidding Column */}
                      <td className="breeding-col-kidding">
                        {renderKiddingInfo(b.expected_kidding_date, b.status)}
                      </td>

                      {/* Status Column */}
                      <td className="breeding-col-status">
                        {renderStatusPill(b.status)}
                      </td>

                      {/* Actions Column */}
                      <td className="breeding-col-actions">
                        <div className="breeding-actions-group">
                          {b.status === 'Kidded' && !hasRegisteredNewborns(b) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openRegisterOffspring(b)}
                              leftIcon={<Baby size={14} color="#238B45" />}
                              title="Magrehistro ng supling"
                            >
                              Supling
                            </Button>
                          )}
                          <button
                            type="button"
                            className="breeding-action-btn"
                            onClick={() => openEdit(b)}
                            title="I-edit ang Record"
                            aria-label="I-edit ang Record"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="breeding-action-btn archive"
                            onClick={() => setConfirmDelete(b)}
                            title="I-archive ang Record"
                            aria-label="I-archive ang Record"
                          >
                            <Archive size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Mobile Cards Layout (< 768px) ── */}
      <div className="breeding-mobile-cards">
        {filtered.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={<Icons.Heart size={32} />}
              title="Wala pang breeding records."
              description={
                searchQuery || fStatus !== 'All'
                  ? 'Walang record na tumutugma sa iyong filter.'
                  : 'Magsimulang mag-record sa pamamagitan ng pagdagdag ng unang record ng breeding.'
              }
              actionLabel="Magdagdag ng Record"
              onAction={openAdd}
            />
          </div>
        ) : (
          filtered.map((b) => {
            const female = farmData.animals.find((a) => a.id === b.animal_id);
            const male = farmData.animals.find((a) => a.id === b.partner_id);

            return (
              <div key={b.id} className="breeding-card">
                {/* Header: Female Dam + Status Pill */}
                <div className="breeding-card-header">
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--color-text-primary, #0F172A)' }}>
                      {female?.name || 'Hindi Tukoy na Babae'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #64748B)', marginTop: 2 }}>
                      {female?.tag_id || 'Walang Tag'} {female?.breed ? `• ${female.breed}` : female?.species ? `• ${female.species === 'Goat' ? 'Kambing' : 'Tupa'}` : ''}
                    </div>
                  </div>
                  <div>
                    {renderStatusPill(b.status)}
                  </div>
                </div>

                {/* Body Details */}
                <div className="breeding-card-body">
                  {/* Partner Sire */}
                  <div className="breeding-card-field">
                    <span className="breeding-card-label">Lalaki (Barako)</span>
                    <span className="breeding-card-value">
                      {male ? (
                        <span>
                          {male.name} <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #64748B)', fontWeight: 500 }}>• {male.tag_id} {male.breed ? `(${male.breed})` : ''}</span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted, #94A3B8)', fontWeight: 400 }}>Walang nakatakda</span>
                      )}
                    </span>
                  </div>

                  {/* 2-Column Grid: Mating Date & Expected Kidding */}
                  <div className="breeding-card-grid">
                    <div className="breeding-card-field">
                      <span className="breeding-card-label">Araw ng Pagpapalahi</span>
                      <span className="breeding-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={13} color="var(--color-text-secondary, #64748B)" />
                        {formatDate(b.mating_date)}
                      </span>
                    </div>

                    <div className="breeding-card-field">
                      <span className="breeding-card-label">Inaasahang Panganganak</span>
                      {renderKiddingInfo(b.expected_kidding_date, b.status)}
                    </div>
                  </div>

                  {/* Observations / Notes if present */}
                  {b.notes && (
                    <div className="breeding-card-notes">
                      {b.notes}
                    </div>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="breeding-card-footer">
                  {b.status === 'Kidded' && !hasRegisteredNewborns(b) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openRegisterOffspring(b)}
                      leftIcon={<Baby size={14} color="#238B45" />}
                      style={{ minHeight: 40 }}
                    >
                      Supling
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(b)}
                    leftIcon={<Pencil size={15} />}
                    style={{ minHeight: 40, border: '1px solid var(--color-border, #E2E8F0)' }}
                  >
                    I-edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(b)}
                    leftIcon={<Archive size={15} color="#DC2626" />}
                    style={{ minHeight: 40, border: '1px solid rgba(239, 68, 68, 0.2)', color: '#DC2626' }}
                  >
                    I-archive
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Breeding Record Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <ModalHeader
          title={editing ? 'I-edit ang Record ng Breeding' : 'Magtala ng Pagpapalahi (Mating)'}
          onClose={() => setModalOpen(false)}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Female Selection (Only Ready Females Enabled) */}
            <FormField
              label="Babae (Inahin)"
              required
              error={errors.animal_id}
              helperText={readyFemales.length === 0 ? 'Walang inahing kambing o tupa na kasalukuyang pasok sa edad at timbang para sa mating.' : undefined}
            >
              <Select
                value={form.animal_id}
                onChange={(e) => setForm({ ...form, animal_id: e.target.value })}
                options={[
                  { value: '', label: 'Pumili ng kwalipikadong babae...' },
                  // Ready Females
                  ...readyFemales.map((a) => {
                    const age = a.date_of_birth ? monthsSince(a.date_of_birth) : null;
                    return {
                      value: a.id,
                      label: `[Handa] ${a.name} (${a.tag_id}) — Handa ${age ? `(${age} buwan, ${a.weight_kg ?? '?'} kg)` : ''}`,
                    };
                  }),
                  // Not Ready Females (Disabled)
                  ...notReadyFemales.map((a) => {
                    const assessment = femaleAssessments.get(a.id);
                    const reason = assessment?.reasons[0] || 'Hindi Pa Handa';
                    return {
                      value: a.id,
                      label: `[Hindi Handa] ${a.name} (${a.tag_id}) — [${reason}]`,
                      disabled: true,
                    };
                  }),
                ]}
              />
            </FormField>

            {/* Selected Female Readiness Preview */}
            {selectedFemale && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 12px)',
                  background: selectedFemaleAssessment?.recommendation === 'Ready' ? 'rgba(46, 125, 50, 0.06)' : 'rgba(239, 68, 68, 0.08)',
                  border: `1.5px solid ${selectedFemaleAssessment?.recommendation === 'Ready' ? 'rgba(46, 125, 50, 0.25)' : 'rgba(239, 68, 68, 0.3)'}`,
                  marginTop: -6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedFemaleAssessment?.recommendation === 'Ready' ? (
                      <ShieldCheck size={16} color="#2E7D32" />
                    ) : (
                      <ShieldAlert size={16} color="#DC2626" />
                    )}
                    <span style={{ fontSize: '13px', fontWeight: 700, color: selectedFemaleAssessment?.recommendation === 'Ready' ? '#2E7D32' : '#DC2626' }}>
                      Status ng Babae: {selectedFemaleAssessment?.recommendation === 'Ready' ? 'Kwalipikado sa Mating' : 'Hindi Kwalipikado sa Mating'}
                    </span>
                  </div>
                  <Badge variant={selectedFemaleAssessment?.recommendation === 'Ready' ? 'success' : 'danger'} size="sm">
                    {selectedFemaleAssessment?.recommendation === 'Ready' ? 'Handa' : 'Hindi Pa Handa'}
                  </Badge>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #475569)' }}>
                  {selectedFemaleAssessment?.reasons.join(' · ')}
                </div>
              </div>
            )}

            {/* Partner Selection (Only Ready Males Enabled) */}
            <FormField label="Lalaki (Barako - Opsyonal)" error={errors.partner_id}>
              <Select
                value={form.partner_id}
                onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
                options={[
                  { value: '', label: 'Pumili ng lalaking barako (Sire - Opsyonal)...' },
                  // Ready Males
                  ...readyMales
                    .filter((a) => !selectedFemale || a.species === selectedFemale.species)
                    .map((a) => {
                      const age = a.date_of_birth ? monthsSince(a.date_of_birth) : null;
                      return {
                        value: a.id,
                        label: `[Handa] ${a.name} (${a.tag_id}) — ${a.species === 'Goat' ? 'Kambing' : 'Tupa'} ${age ? `(${age} buwan, ${a.weight_kg ?? '?'} kg)` : ''}`,
                      };
                    }),
                  // Not Ready Males (Disabled)
                  ...notReadyMales
                    .filter((a) => !selectedFemale || a.species === selectedFemale.species)
                    .map((a) => {
                      const assessment = maleAssessments.get(a.id);
                      const reason = assessment?.reasons[0] || 'Hindi Pa Handa';
                      return {
                        value: a.id,
                        label: `[Hindi Handa] ${a.name} (${a.tag_id}) — ${a.species === 'Goat' ? 'Kambing' : 'Tupa'} [${reason}]`,
                        disabled: true,
                      };
                    }),
                ]}
              />
            </FormField>

            {/* Selected Male Readiness Preview */}
            {selectedMale && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 12px)',
                  background: selectedMaleAssessment?.recommendation === 'Ready' ? 'rgba(46, 125, 50, 0.06)' : 'rgba(239, 68, 68, 0.08)',
                  border: `1.5px solid ${selectedMaleAssessment?.recommendation === 'Ready' ? 'rgba(46, 125, 50, 0.25)' : 'rgba(239, 68, 68, 0.3)'}`,
                  marginTop: -6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedMaleAssessment?.recommendation === 'Ready' ? (
                      <ShieldCheck size={16} color="#2E7D32" />
                    ) : (
                      <ShieldAlert size={16} color="#DC2626" />
                    )}
                    <span style={{ fontSize: '13px', fontWeight: 700, color: selectedMaleAssessment?.recommendation === 'Ready' ? '#2E7D32' : '#DC2626' }}>
                      Status ng Lalaki: {selectedMaleAssessment?.recommendation === 'Ready' ? 'Kwalipikadong Barako' : 'Hindi Kwalipikado sa Mating'}
                    </span>
                  </div>
                  <Badge variant={selectedMaleAssessment?.recommendation === 'Ready' ? 'success' : 'danger'} size="sm">
                    {selectedMaleAssessment?.recommendation === 'Ready' ? 'Handa' : 'Hindi Pa Handa'}
                  </Badge>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #475569)' }}>
                  {selectedMaleAssessment?.reasons.join(' · ')}
                </div>
              </div>
            )}

            {/* Inbreeding / Lineage Safety Warning */}
            {inbreedingWarning && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 12px)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1.5px solid rgba(245, 158, 11, 0.3)',
                }}
              >
                <AlertTriangle size={18} color="#D97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: '12.5px', color: '#92400E', lineHeight: 1.4, fontWeight: 600 }}>
                  {inbreedingWarning}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Araw ng Pagpapalahi (Mating Date)" required error={errors.mating_date}>
                <Input
                  type="date"
                  value={form.mating_date}
                  onChange={(e) => setForm({ ...form, mating_date: e.target.value })}
                />
              </FormField>

              <FormField label="Katayuan (Breeding Status)">
                <Select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  options={[
                    ...(editing?.status === 'Kidded' ? [{ value: 'Kidded', label: 'Naitala na ang panganganak', disabled: true }] : []),
                    { value: 'Planned', label: 'Nakaplano pa lamang' },
                    { value: 'Pregnant', label: 'Buntis (Pregnant)' },
                    { value: 'Failed', label: 'Hindi nabuntis' },
                    { value: 'Monitor', label: 'Naghihintay ng Resulta' },
                  ]}
                />
              </FormField>
            </div>

            {form.mating_date && form.status === 'Pregnant' && (
              <div
                style={{
                  background: 'rgba(46, 125, 50, 0.08)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 12px)',
                  color: '#2E7D32',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid rgba(46, 125, 50, 0.2)',
                }}
              >
                Estimated na panganganak (Expected Kidding Date):{' '}
                <span style={{ fontWeight: 800 }}>
                  {formatDate(
                    calculateKiddingDate(form.mating_date, farmData.settings?.gestation_days ?? 150)
                  )}
                </span>
                <br />
                <span style={{ fontSize: '11px', opacity: 0.85 }}>
                  Kinakalkula gamit ang karaniwang {farmData.settings?.gestation_days ?? 150}-araw na pagbubuntis.
                </span>
              </div>
            )}

            <FormField label="Mga Tala / Obserbasyon">
              <textarea
                className="form-textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Obserbasyon sa mating, numero ng kulungan, gawi ng alaga..."
                style={{ minHeight: 80 }}
              />
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Kanselahin
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!editing && selectedFemaleAssessment?.recommendation !== 'Ready'}
          >
            {editing ? 'I-save ang mga Pagbabago' : 'I-save ang Record'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Newborn Offspring Registration Modal */}
      <Modal open={offspringModalOpen} onClose={() => setOffspringModalOpen(false)} size="md">
        <ModalHeader
          title={offspringMother ? `Magrehistro ng Supling mula kay ${offspringMother.name}` : 'Magrehistro ng Bagong Silang na Supling'}
          onClose={() => setOffspringModalOpen(false)}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Pangalan ng Supling" required>
                <Input
                  value={offspringForm.name}
                  onChange={(e) => setOffspringForm({ ...offspringForm, name: e.target.value })}
                  placeholder="Hal. Leo, Bella Junior"
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <FormField label="Uri (Kambing o Tupa)" required>
                <Select
                  value={offspringForm.species}
                  onChange={(e) => handleSpeciesChangeOffspring(e.target.value as Species)}
                  options={[
                    { value: 'Goat', label: 'Kambing (Goat)' },
                    { value: 'Sheep', label: 'Tupa (Sheep)' },
                  ]}
                />
              </FormField>

              <FormField label="Kasarian (Sex)" required>
                <Select
                  value={offspringForm.sex}
                  onChange={(e) => setOffspringForm({ ...offspringForm, sex: e.target.value as Sex })}
                  options={[
                    { value: 'Female', label: 'Babae (Female)' },
                    { value: 'Male', label: 'Lalaki (Male)' },
                  ]}
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <FormField label="Petsa ng Kapanganakan (Date of Birth)" required>
                <Input
                  type="date"
                  value={offspringForm.date_of_birth}
                  onChange={(e) => setOffspringForm({ ...offspringForm, date_of_birth: e.target.value })}
                />
              </FormField>

              <FormField label="Timbang sa Kapanganakan (kg) (Opsyonal)" helperText="Opsyonal: Maaaring iwanang blangko">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={offspringForm.weight_kg}
                  onChange={(e) => setOffspringForm({ ...offspringForm, weight_kg: e.target.value })}
                  placeholder="Opsyonal (hal. 3.0)"
                />
              </FormField>
            </div>

            <FormField label="Mga Tala / Magulang">
              <Input
                value={offspringForm.notes}
                onChange={(e) => setOffspringForm({ ...offspringForm, notes: e.target.value })}
                placeholder="Ina, Ama, tala sa kapanganakan..."
              />
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setOffspringModalOpen(false)}>
            Kanselahin
          </Button>
          <Button variant="primary" onClick={handleSaveOffspring} loading={savingOffspring}>
            I-rehistro ang Supling
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="I-archive ang record ng breeding?"
        message="Mananatili ang tala ng breeding sa history at maaari itong ibalik mula sa Archived Records."
        confirmLabel="I-archive"
        cancelLabel="Huwag Muna"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
