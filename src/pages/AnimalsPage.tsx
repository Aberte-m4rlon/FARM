import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useFarmData } from '../lib/useFarmData';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter, ConfirmDialog } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input, Select, FormField } from '../components/ui/Input';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ComboBox } from '../components/ComboBox';
import { FilterToolbar, FilterSearch, FilterSelect } from '../components/FilterToolbar';
import { Icons } from '../lib/icons';
import { Plus, Pencil, Eye, Archive, RotateCcw, QrCode, Download, Printer, Layers, PawPrint } from 'lucide-react';
import { ageLabel } from '../lib/analytics';
import { getBreedsForSpecies } from '../lib/farmDefaults';
import { generateNextAnimalId, fetchNextUniqueAnimalId, insertAnimalWithUniqueRetry, createAnimalWithInitialWeight } from '../lib/animalId';
import QRCode from 'qrcode';
import type { Animal, Species, Sex } from '../types';
import { buildAnimalQrPayload } from '../lib/animalQr';
import { isAnimalActive, isAnimalDeceased } from '../lib/animalLifecycle';

const normalizeEartagNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^[0-9]{1,6}$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseEartagNumberFromAnimal = (animal: Pick<Animal, 'eartag_number' | 'tag_id'> | null | undefined): number | null => {
  if (!animal) return null;
  const direct = normalizeEartagNumber(animal.eartag_number);
  return direct;
};

const getNextEartagNumber = (animals: Animal[]) => {
  const used = new Set<number>();
  animals.filter((animal) => !animal.archived && !animal.is_sold && !['sold', 'deceased', 'transferred'].includes((animal.status ?? '').toLowerCase())).forEach((animal) => {
    const parsed = parseEartagNumberFromAnimal(animal);
    if (parsed !== null) {
      used.add(parsed);
    }
  });

  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
};

const emptyForm = {
  tag_id: '',
  eartag_number: '',
  name: '',
  species: 'Goat' as Species,
  breed: '',
  sex: 'Female' as Sex,
  date_of_birth: '',
  weight_kg: '',
  notes: '',
};

const APP_URL = typeof window !== 'undefined' ? window.location.origin : 'https://capstone-delta-jet.vercel.app';

export function AnimalsPage() {
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isSuperAdmin = profile?.role === 'super_admin';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Animal | null>(null);
  const [qrAnimal, setQrAnimal] = useState<Animal | null>(null);

  // Filters
  const [fSpecies, setFSpecies] = useState('All');
  const [fStatus, setFStatus] = useState<'Active' | 'Sold' | 'Deceased' | 'All'>('Active');
  const [search, setSearch] = useState('');

  const soldAnimalIds = useMemo(() => {
    return new Set((farmData.sales || []).map((s) => s.animal_id));
  }, [farmData.sales]);

  const filtered = useMemo(() => {
    const eligible = farmData.animals
      .filter((a) => {
        const isSold = soldAnimalIds.has(a.id) || a.status === 'Sold' || a.is_sold;
        if (fStatus === 'Active') {
          return isAnimalActive({ ...a, is_sold: Boolean(isSold) });
        }
        if (fStatus === 'Sold') {
          return isSold;
        }
        if (fStatus === 'Deceased') {
          return isAnimalDeceased(a) && !isSold;
        }
        return true; // 'All'
      })
      .filter((a) => fSpecies === 'All' || a.species === fSpecies);
    const normalizedSearch = search.trim().toLowerCase();
    const exactNumberMatches = /^[0-9]+$/.test(normalizedSearch)
      ? eligible.filter((animal) => String(animal.eartag_number ?? '') === String(Number(normalizedSearch)))
      : [];
    const matches = exactNumberMatches.length > 0
      ? exactNumberMatches
      : eligible.filter((a) =>
          !normalizedSearch ||
          a.name.toLowerCase().includes(normalizedSearch) ||
          String(a.eartag_number ?? '').toLowerCase().includes(normalizedSearch) ||
          a.tag_id.toLowerCase().includes(normalizedSearch) ||
          (a.breed ?? '').toLowerCase().includes(normalizedSearch)
        );
    return matches.sort((a, b) => Number(String(b.eartag_number ?? '') === String(Number(normalizedSearch))) - Number(String(a.eartag_number ?? '') === String(Number(normalizedSearch))));
  }, [farmData.animals, soldAnimalIds, fStatus, fSpecies, search]);

  const animalsNeedingAttention = new Set(
    farmData.healthAlerts
      .filter((alert) => !alert.is_resolved && alert.severity !== 'info')
      .map((alert) => alert.animal_id),
  );
  const animalsNeedingMedicine = new Set(
    farmData.treatmentRecords
      .filter((record) => record.status === 'Scheduled' || record.status === 'Ongoing')
      .map((record) => record.animal_id),
  );

  const animalStats = useMemo(() => {
    const active = farmData.animals.filter((a) => isAnimalActive({ ...a, is_sold: Boolean(soldAnimalIds.has(a.id) || a.is_sold) }));
    const goats = active.filter((a) => a.species === 'Goat').length;
    const sheep = active.filter((a) => a.species === 'Sheep').length;
    return {
      total: active.length,
      goats,
      sheep,
    };
  }, [farmData.animals, soldAnimalIds]);

  const openAdd = (prefSpecies?: Species | unknown) => {
    const targetSpecies: Species = (typeof prefSpecies === 'string' && (prefSpecies === 'Goat' || prefSpecies === 'Sheep'))
      ? prefSpecies
      : 'Goat';
    const nextId = generateNextAnimalId(targetSpecies, farmData.animals);
    const nextEartagNumber = getNextEartagNumber(farmData.animals);
    setEditing(null);
    setForm({
      ...emptyForm,
      species: targetSpecies,
      tag_id: nextId,
      eartag_number: String(nextEartagNumber),
    });
    setErrors({});
    setModalOpen(true);

    // Verify against database for newest sequential index
    fetchNextUniqueAnimalId(targetSpecies, user?.id).then((freshId) => {
      setForm((prev) => (prev.species === targetSpecies ? { ...prev, tag_id: freshId } : prev));
    }).catch(() => {});
  };

  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      const qSpecies = params.get('species');
      const targetSpecies: Species = (qSpecies && qSpecies.toLowerCase() === 'sheep') ? 'Sheep' : 'Goat';
      openAdd(targetSpecies);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search]);


  const handleSpeciesChange = (newSpecies: Species) => {
    if (!editing) {
      const nextId = generateNextAnimalId(newSpecies, farmData.animals);
      const nextEartagNumber = getNextEartagNumber(farmData.animals);
      setForm((prev) => ({
        ...prev,
        species: newSpecies,
        tag_id: nextId,
        eartag_number: String(nextEartagNumber),
      }));
      fetchNextUniqueAnimalId(newSpecies, user?.id).then((freshId) => {
        setForm((prev) => (prev.species === newSpecies ? { ...prev, tag_id: freshId } : prev));
      }).catch(() => {});
    } else {
      setForm((prev) => ({ ...prev, species: newSpecies }));
    }
  };

  const openEdit = (a: Animal) => {
    setEditing(a);
    setForm({
      tag_id: a.tag_id,
      eartag_number: parseEartagNumberFromAnimal(a) !== null ? String(parseEartagNumberFromAnimal(a)) : '',
      name: a.name,
      species: a.species,
      breed: a.breed ?? '',
      sex: a.sex,
      date_of_birth: a.date_of_birth ?? '',
      weight_kg: a.weight_kg ? String(a.weight_kg) : '',
      notes: a.notes ?? '',
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.tag_id.trim()) e.tag_id = 'Hindi mabuo ang tag ng hayop. Subukang muli.';
    const normalizedEartagNumber = normalizeEartagNumber(form.eartag_number);
    if (normalizedEartagNumber === null) {
      e.eartag_number = 'Kailangan ang numero ng eartag. Hal. 1, 9, 10, 25.';
    } else {
      const duplicate = farmData.animals.some((animal) => {
        if (animal.id === editing?.id || animal.user_id !== user?.id) {
          return false;
        }
        const animalEartagNumber = parseEartagNumberFromAnimal(animal);
        return !animal.archived && !animal.is_sold && !['sold', 'deceased', 'transferred'].includes((animal.status ?? '').toLowerCase())
          && animalEartagNumber !== null && animalEartagNumber === normalizedEartagNumber;
      });
      if (duplicate) {
        e.eartag_number = 'Mayroon nang aktibong hayop sa iyong bukid na may parehong numero ng eartag.';
      }
    }
    if (!form.name.trim()) e.name = form.species === 'Sheep' ? 'Kailangan ang pangalan ng tupa.' : 'Kailangan ang pangalan ng kambing.';
    if (!form.species) e.species = 'Kailangan piliin ang species.';
    if (!form.sex) e.sex = 'Kailangan piliin ang kasarian.';
    const trimmedWeight = form.weight_kg !== '' && form.weight_kg !== null && form.weight_kg !== undefined ? String(form.weight_kg).trim() : '';
    if (trimmedWeight !== '') {
      const w = Number(trimmedWeight);
      if (isNaN(w) || w < 0) {
        e.weight_kg = 'Dapat wastong numero ang timbang (hal. 35.5).';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;
    setSaving(true);

    const parsedWeight =
      form.weight_kg !== '' && form.weight_kg !== null && form.weight_kg !== undefined && Number(form.weight_kg) > 0
        ? Number(form.weight_kg)
        : null;
    const eartagNumber = normalizeEartagNumber(form.eartag_number);

    const payload = {
      tag_id: form.tag_id.trim(),
      eartag_number: eartagNumber,
      name: form.name.trim(),
      species: form.species,
      breed: form.breed.trim() || null,
      sex: form.sex,
      date_of_birth: form.date_of_birth || null,
      weight_kg: parsedWeight,
      notes: form.notes.trim() || null,
    };

    try {
      if (editing) {
        let query = supabase.from('animals').update(payload).eq('id', editing.id);
        if (!isSuperAdmin) {
          query = query.eq('user_id', user.id);
        }
        const { error } = await query;
        if (error) throw error;
        toast('Matagumpay na na-save ang record.', 'success');
      } else {
        const initialWeight = parsedWeight;
        const result = await createAnimalWithInitialWeight(
          {
            ...payload,
            user_id: user.id,
          },
          initialWeight,
          {
            onAutoIncrement: (newId) => {
              setForm((prev) => ({ ...prev, tag_id: newId }));
            },
          }
        );

        if (result.error) throw result.error;

        const animalTerm = form.species === 'Sheep' ? 'tupa' : 'kambing';
        if (result.initialWeightRecorded) {
          if (result.hadConflict) {
            toast(`Naresolba ang ID conflict bilang ${result.finalTagId}. Naidagdag na ang ${animalTerm} at na-record ang unang timbang.`, 'success');
          } else {
            toast(`Naidagdag na ang ${animalTerm} at na-record ang unang timbang.`, 'success');
          }
        } else {
          if (result.hadConflict) {
            toast(`Naresolba ang ID conflict bilang ${result.finalTagId}. Naidagdag na ang ${animalTerm}.`, 'success');
          } else {
            toast(`Naidagdag na ang ${animalTerm}.`, 'success');
          }
        }
      }
      setModalOpen(false);
      farmData.refresh();
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      if (/eartag_number|idx_animals_user_eartag_number_unique_active/i.test(message)) {
        setErrors((current) => ({ ...current, eartag_number: 'May aktibong hayop na sa bukid mo na gumagamit ng numerong ito.' }));
        toast('Hindi na-save: ginagamit na ng ibang aktibong hayop ang eartag number na ito.', 'danger');
      } else {
        toast('Hindi na-save ang alaga. Pakisuri ang impormasyon at subukan muli.', 'danger');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (a: Animal) => {
    if (!user) return;
    if (!a.archived) {
      setConfirmDelete(a);
      return;
    }
    try {
      const archived = !a.archived;
      let query = supabase.from('animals').update({
        archived,
        archived_at: archived ? new Date().toISOString() : null,
        archived_by: archived ? user.id : null,
        archive_reason: null,
      }).eq('id', a.id);
      if (!isSuperAdmin) {
        query = query.eq('user_id', user.id);
      }
      const { error } = await query;
      if (error) throw error;
      toast(a.archived ? 'Naibalik ang alaga sa aktibo.' : 'Nai-archive ang alaga.', 'success');
      farmData.refresh();
    } catch {
      toast('Hindi mai-update ang impormasyon. Pakisubukan muli.', 'danger');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    try {
      let query = supabase.from('animals').update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: user.id,
      }).eq('id', confirmDelete.id);
      if (!isSuperAdmin) {
        query = query.eq('user_id', user.id);
      }
      const { error } = await query;
      if (error) throw error;
      toast('In-archive ang alaga. Maaari itong ibalik mula sa Archived Records.', 'success');
      setConfirmDelete(null);
      farmData.refresh();
    } catch {
      toast('Hindi mai-archive ang alaga. Pakisubukan muli.', 'danger');
    }
  };

  const generateQR = async (a: Animal) => {
    setQrAnimal(a);
  };

  const downloadQR = async () => {
    if (!qrAnimal) return;
    const url = buildAnimalQrPayload(qrAnimal);
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `qr-${qrAnimal.tag_id}.png`;
      link.click();
      toast('Na-download ang QR code.', 'success');
    } catch {
      toast('Hindi magawa ang QR code. Pakisubukan muli.', 'danger');
    }
  };

  const printQR = () => {
    if (!qrAnimal) return;
    const url = buildAnimalQrPayload(qrAnimal);
    const win = window.open('', '_blank');
    if (!win) return;
    QRCode.toDataURL(url, { width: 300, margin: 2 }).then((dataUrl) => {
      win.document.write(`
        <html><head><title>QR Code - ${qrAnimal.name}</title></head>
        <body style="text-align:center;padding:40px;font-family:sans-serif">
          <h2>${qrAnimal.name} (${qrAnimal.tag_id})</h2>
          <img src="${dataUrl}" />
          <p>I-scan gamit ang Google Lens o camera app para buksan ang public profile ng hayop nang walang login.</p>
        </body></html>
      `);
      win.document.close();
      win.print();
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '26px',
              fontWeight: 800,
              color: 'var(--color-text-primary, #0F172A)',
              letterSpacing: '-0.02em',
            }}
          >
            Kambing at Tupa
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary, #475569)', fontSize: '14px' }}>
            {filtered.length} {filtered.length === 1 ? 'kambing o tupa' : 'kambing at tupa'} {fStatus === 'Sold' ? 'na naibenta' : fStatus === 'Deceased' ? 'na namatay' : fStatus === 'All' ? 'kabuuang rekord' : 'sa bukid'}
          </p>
        </div>
        <Button variant="primary" onClick={openAdd} leftIcon={<Plus size={16} />}>
          Magdagdag ng Kambing o Tupa
        </Button>
      </div>

      {/* 3-Column Summary Cards: Total | Goats | Sheep */}
      <div className="mobile-stats-grid-3 animal-stats-grid">
        {/* Total */}
        <div
          onClick={() => setFSpecies('All')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: fSpecies === 'All' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Kabuuan
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PawPrint size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {animalStats.total}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              kabuuang kambing at tupa
            </div>
          </div>
        </div>

        {/* Goats */}
        <div
          onClick={() => setFSpecies(fSpecies === 'Goat' ? 'All' : 'Goat')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: fSpecies === 'Goat' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Kambing
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {animalStats.goats}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Mga Kambing
            </div>
          </div>
        </div>

        {/* Sheep */}
        <div
          onClick={() => setFSpecies(fSpecies === 'Sheep' ? 'All' : 'Sheep')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: fSpecies === 'Sheep' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Tupa
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {animalStats.sheep}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Mga Tupa
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <FilterToolbar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Maghanap ng pangalan, eartag, o lahi..." />
        <FilterSelect
          value={fSpecies}
          onChange={setFSpecies}
          options={[
            { value: 'All', label: 'Lahat ng Uri' },
            { value: 'Goat', label: 'Kambing' },
            { value: 'Sheep', label: 'Tupa' },
          ]}
          ariaLabel="Uri ng hayop"
        />
        <FilterSelect
          value={fStatus}
          onChange={(val) => setFStatus(val as 'Active' | 'Sold' | 'Deceased' | 'All')}
          options={[
            { value: 'Active', label: 'Nasa bukid' },
            { value: 'Sold', label: 'Nabenta' },
            { value: 'Deceased', label: 'Namatay' },
            { value: 'All', label: 'Lahat' },
          ]}
          ariaLabel="Kalagayan ng hayop"
        />
      </FilterToolbar>

      {/* Table Card */}
      <Card variant="default" padding="none">
        <CardContent>
          {filtered.length === 0 ? (
            <div style={{ padding: 32 }}>
              <EmptyState
                icon={<Icons.PawPrint size={36} />}
                title={fStatus === 'Sold' ? 'Walang naitalang nabentang kambing o tupa' : fStatus === 'Deceased' ? 'Walang naitalang namatay na hayop' : 'Walang kambing o tupa na nakatala.'}
                description={fStatus === 'Sold' ? 'Dito lalabas ang mga kambing at tupa na naibenta na.' : fStatus === 'Deceased' ? 'Dito lalabas ang mga namatay na hayop.' : 'Magdagdag ng unang kambing o tupa para masimulan ang pagsubaybay sa bukid.'}
                actionLabel={fStatus === 'Active' ? 'Magdagdag ng Kambing o Tupa' : undefined}
                onAction={fStatus === 'Active' ? openAdd : undefined}
              />
            </div>
          ) : (
            <>
            <div className="table-wrap animal-list-desktop">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alaga</th>
                    <th>Uri at detalye</th>
                    <th>Edad / timbang</th>
                    <th>Paalala</th>
                    <th style={{ textAlign: 'right' }}>Aksyon</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td
                        style={{
                          fontWeight: 700,
                          color: 'var(--color-text-primary, #0F172A)',
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(`/animals/${a.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{a.name || 'Walang pangalan'}</span>
                          {(soldAnimalIds.has(a.id) || a.status === 'Sold' || a.is_sold) && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: '#EAF6ED',
                              color: '#238B45',
                              border: '1px solid #C7E9C0',
                            }}>
                              Nabenta
                            </span>
                          )}
                          {isAnimalDeceased(a) && !(soldAnimalIds.has(a.id) || a.status === 'Sold' || a.is_sold) && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700, backgroundColor: '#fff0ef', color: '#9f2d25', border: '1px solid #f0c7c3' }}>
                              NAMATAY NA
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ color: 'var(--color-text-secondary, #475569)' }}>
                        <strong>{a.species === 'Goat' ? 'Kambing' : 'Tupa'}</strong>
                        <div style={{ fontSize: 12, marginTop: 3 }}>{[a.breed, a.sex === 'Female' ? 'Babae' : 'Lalaki'].filter(Boolean).join(' · ')}</div>
                        <div style={{ color: 'var(--color-primary, #238B45)', fontSize: 14, fontWeight: 800, marginTop: 2 }}>Eartag {a.eartag_number ?? '—'}</div>
                      </td>
                      <td style={{ color: 'var(--color-text-secondary, #475569)' }}>
                        <div>{a.date_of_birth ? ageLabel(a.date_of_birth) : 'Edad hindi nakatala'}</div>
                        <div style={{ fontSize: 12, marginTop: 3 }}>{a.weight_kg ? `${a.weight_kg} kg` : 'Walang timbang'}</div>
                      </td>
                      <td>
                        {animalsNeedingAttention.has(a.id) || animalsNeedingMedicine.has(a.id) ? (
                          <span className="animal-attention-badge">{animalsNeedingAttention.has(a.id) ? 'Suriin' : 'May iskedyul'}</span>
                        ) : <span style={{ color: 'var(--color-text-muted, #64748B)' }}>Wala</span>}
                      </td>
                      <td>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Tingnan ang detalye"
                            onClick={() => navigate(`/animals/${a.id}`)}
                          >
                            <Eye size={15} />
                          </Button>
                          <details className="animal-actions-menu">
                            <summary>Aksyon</summary>
                            <div className="animal-actions-menu-items">
                              <button onClick={() => openEdit(a)}><Pencil size={15} /> I-edit</button>
                              <button onClick={() => generateQR(a)}><QrCode size={15} /> QR code</button>
                              <button onClick={() => handleArchive(a)}>{a.archived ? <RotateCcw size={15} /> : <Archive size={15} />} {a.archived ? 'Ibalik' : 'I-archive'}</button>
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="animal-cards-mobile" aria-label="Listahan ng kambing at tupa">
              {filtered.map((a) => {
                const isSold = soldAnimalIds.has(a.id) || a.status === 'Sold' || a.is_sold;
                const isDeceased = isAnimalDeceased(a) && !isSold;
                const needsAttention = animalsNeedingAttention.has(a.id);
                const hasTreatment = animalsNeedingMedicine.has(a.id);
                return (
                  <article className="animal-mobile-card" key={a.id}>
                    <div className="animal-mobile-card-top">
                      <div>
                        <h3>{a.name || 'Walang pangalan'}</h3>
                        <span className="animal-mobile-tag">Eartag {a.eartag_number ?? '—'}</span>
                      </div>
                      {isSold && <span className="animal-mobile-sold">Nabenta</span>}
                      {isDeceased && <span style={{ padding: '3px 8px', borderRadius: 9999, background: '#fff0ef', color: '#9f2d25', fontSize: 11, fontWeight: 750 }}>NAMATAY NA</span>}
                    </div>
                    <div className="animal-mobile-card-meta">
                      <span>{a.species === 'Goat' ? 'Kambing' : 'Tupa'}{a.breed ? ` · ${a.breed}` : ''}</span>
                      <span>{a.sex === 'Female' ? 'Babae' : 'Lalaki'} · {a.date_of_birth ? ageLabel(a.date_of_birth) : 'Edad hindi nakatala'}</span>
                      <span>{a.weight_kg ? `${a.weight_kg} kg` : 'Walang timbang'}</span>
                    </div>
                    {(needsAttention || hasTreatment) && (
                      <div className="animal-mobile-alert">{needsAttention ? 'Kailangan ng pagsusuri' : 'May nakatakdang gamutan'}</div>
                    )}
                    <div className="animal-mobile-card-actions">
                      <Button variant="primary" size="sm" onClick={() => navigate(`/animals/${a.id}`)} leftIcon={<Eye size={15} />}>Tingnan</Button>
                      <details className="animal-actions-menu">
                        <summary>Iba pang aksyon</summary>
                        <div className="animal-actions-menu-items">
                          <button onClick={() => openEdit(a)}><Pencil size={15} /> I-edit</button>
                          <button onClick={() => generateQR(a)}><QrCode size={15} /> QR code</button>
                          <button onClick={() => handleArchive(a)}>{a.archived ? <RotateCcw size={15} /> : <Archive size={15} />} {a.archived ? 'Ibalik' : 'I-archive'}</button>
                        </div>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="md"
        role="dialog"
      >
        <ModalHeader
          title={editing ? (form.species === 'Sheep' ? 'I-edit ang Tupa' : 'I-edit ang Kambing') : 'Magdagdag ng Kambing o Tupa'}
          onClose={() => setModalOpen(false)}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormField label="Numero ng Eartag" required error={errors.eartag_number} helperText="Numero sa eartag na makikita ng camera.">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.eartag_number}
                  onChange={(e) => setForm({ ...form, eartag_number: e.target.value })}
                  placeholder="Hal. 25"
                />
              </FormField>
              <FormField label="Pangalan" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="hal. Bella, Thor, Luna"
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <FormField label="Uri (Kambing o Tupa)" required>
                <Select
                  value={form.species}
                  onChange={(e) => handleSpeciesChange(e.target.value as Species)}
                  options={[
                    { value: 'Goat', label: 'Goat / Kambing' },
                    { value: 'Sheep', label: 'Sheep / Tupa' },
                  ]}
                />
              </FormField>
              <FormField label="Kasarian (Sex)" required>
                <Select
                  value={form.sex}
                  onChange={(e) => setForm({ ...form, sex: e.target.value as Sex })}
                  options={[
                    { value: 'Female', label: 'Female / Babae' },
                    { value: 'Male', label: 'Male / Lalaki' },
                  ]}
                />
              </FormField>
              <FormField label="Lahi (Breed)">
                <ComboBox
                  value={form.breed}
                  onChange={(v) => setForm({ ...form, breed: v })}
                  options={getBreedsForSpecies(form.species)}
                  placeholder="Pumili o mag-type ng lahi..."
                />
              </FormField>
            </div>

            <details className="farmer-form-more">
              <summary>Iba pang detalye (opsyonal)</summary>
              <div className="farmer-form-more-content">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <FormField label="Petsa ng kapanganakan">
                    <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
                  </FormField>
                  <FormField label="Timbang (kg)" helperText="Maaaring laktawan kung hindi pa natitimbang." error={errors.weight_kg}>
                    <Input type="number" step="0.1" min="0" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} placeholder="Hal. 35.5" />
                  </FormField>
                </div>
                <FormField label="Tala">
                  <textarea className="form-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Iba pang impormasyong nais itala..." style={{ minHeight: 80 }} />
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
            {editing ? 'I-save ang Pagbabago' : form.species === 'Sheep' ? 'I-save ang Tupa' : 'I-save ang Kambing'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* QR Modal */}
      <Modal open={!!qrAnimal} onClose={() => setQrAnimal(null)} size="sm">
        <ModalHeader title={`QR Code — ${qrAnimal?.name ?? ''}`} onClose={() => setQrAnimal(null)} />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 8 }}>
            <QRCodeCanvas value={qrAnimal ? buildAnimalQrPayload(qrAnimal) : ''} size={240} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--color-text-primary, #0F172A)' }}>
                {qrAnimal?.name}
              </div>
              <div style={{ color: 'var(--color-primary, #238B45)', fontSize: '13px', fontWeight: 600 }}>
                {qrAnimal?.tag_id}
              </div>
              <p style={{ color: 'var(--color-text-muted, #64748B)', fontSize: '12px', marginTop: 6, margin: 0 }}>
                I-scan gamit ang Google Lens o camera app para makita ang public profile nang walang login.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setQrAnimal(null)}>
            Isara
          </Button>
          <Button variant="secondary" onClick={downloadQR} leftIcon={<Download size={15} />}>
            I-download
          </Button>
          <Button variant="primary" onClick={printQR} leftIcon={<Printer size={15} />}>
            I-print
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="I-archive ang alaga?"
        message={`Hindi muna mabubura si ${confirmDelete?.name} (${confirmDelete?.tag_id}). Itatago ito sa active herd at maaari itong ibalik mula sa Archived Records.`}
        confirmLabel="I-archive"
        cancelLabel="Huwag Muna"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function QRCodeCanvas({ value, size }: { value: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && value) {
      QRCode.toCanvas(ref.current, value, { width: size, margin: 2 });
    }
  }, [value, size]);
  return <canvas ref={ref} style={{ borderRadius: 'var(--radius-md, 14px)' }} />;
}
