/**
 * MedicationTreatmentModal
 * Unified modal for administering medicine/treatment to active animals
 * directly connected to the user's Farm Inventory.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Button,
  Input,
  Select,
  Textarea,
  DateInput,
  NumberInput,
} from '../../ui';
import { Pill, AlertTriangle, CheckCircle2, PackageCheck } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { supabase } from '../../../lib/supabase';
import { administerMedicationTreatment, isTreatmentInventoryItem } from '../../../lib/inventoryOperations';
import { isAnimalActive } from '../../../lib/animalLifecycle';
import type { Animal, InventoryItem, TreatmentStatus } from '../../../types';

export interface MedicationTreatmentModalProps {
  open: boolean;
  onClose: () => void;
  preselectedAnimalId?: string;
  animals?: Animal[];
  onSuccess?: () => void;
}

const TREATMENT_STATUSES: { label: string; value: TreatmentStatus }[] = [
  { label: 'Ginagamot', value: 'Kasalukuyang Ginagamot' },
  { label: 'Kailangan ng gamot', value: 'Kailangan ng Gamot' },
  { label: 'Tapos na', value: 'Tapos na ang Gamot' },
  { label: 'Bantayan (Monitor)', value: 'Bantayan' },
  { label: 'Hindi pa nabibigyan', value: 'Hindi pa Nabibigyan' },
];

const FREQUENCY_OPTIONS = [
  { label: 'Minsan sa isang araw', value: 'Isang beses sa isang araw' },
  { label: 'Dalawang beses sa isang araw', value: 'Dalawang beses sa isang araw' },
  { label: 'Kada 8 oras', value: 'Kada 8 oras' },
  { label: 'Kada 12 oras', value: 'Kada 12 oras' },
  { label: 'Isang beses lamang', value: 'Isang beses lamang' },
  { label: 'Kada linggo', value: 'Kada linggo' },
  { label: 'Ayon sa payo ng Beterinaryo', value: 'Ayon sa payo ng Beterinaryo' },
];

/**
 * Maps raw database / technical errors to clear, farmer-friendly Filipino messages
 */
function mapFarmerFriendlyError(rawError?: string): string {
  if (!rawError) return 'May naganap na error sa pagtatala ng gamot. Pakisubukan muli.';
  const lower = rawError.toLowerCase();
  if (
    lower.includes('is_sold') ||
    lower.includes('status') ||
    lower.includes('column') ||
    lower.includes('relation') ||
    lower.includes('syntax') ||
    lower.includes('schema cache') ||
    lower.includes('42703') ||
    lower.includes('pgrst')
  ) {
    return 'Hindi naitala ang gamutan. Pakisubukan muli.';
  }
  if (lower.includes('naibenta') || lower.includes('sold') || lower.includes('naka-archive') || lower.includes('archived')) {
    return 'Hindi maaaring bigyan ng gamot ang alaga na naibenta na o naka-archive.';
  }
  return 'Hindi naitala ang gamutan. Suriin ang impormasyon at subukan muli.';
}

export function MedicationTreatmentModal({
  open,
  onClose,
  preselectedAnimalId,
  animals: initialAnimals,
  onSuccess,
}: MedicationTreatmentModalProps) {
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Data lists
  const [animals, setAnimals] = useState<Animal[]>(() =>
    initialAnimals ? initialAnimals.filter(isAnimalActive) : []
  );
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  // Form Fields — Initial state adheres strictly to farmer-first guidelines:
  // Alaga: [ Piliin ang kambing o tupa ]
  // Gamot / Item: [ Piliin ang gamot mula sa imbentaryo ]
  // Dami: [ 1 ]
  // Unit: [ -- ]
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>(preselectedAnimalId || '');
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>('');
  const [status, setStatus] = useState<TreatmentStatus>('Kasalukuyang Ginagamot');
  const [quantity, setQuantity] = useState<string>('1');
  const [dosage, setDosage] = useState<string>('');
  const [frequency, setFrequency] = useState<string>('Isang beses sa isang araw');
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Reset clean state whenever modal opens or preselectedAnimalId changes
  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setSelectedAnimalId(preselectedAnimalId || '');
      setSelectedInventoryId('');
      setQuantity('1');
      setDosage('');
      setStatus('Kasalukuyang Ginagamot');
      setFrequency('Isang beses sa isang araw');
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate('');
      setReason('');
      setNotes('');
    }
  }, [open, preselectedAnimalId]);

  // Fetch authenticated user's inventory & animals from database
  useEffect(() => {
    if (!open || !user?.id) return;

    let isMounted = true;
    setFetching(true);
    setErrorMessage(null);

    const loadData = async () => {
      try {
        // 1. Fetch user's active animals (canonical: archived = false)
        // DO NOT query nonexistent columns 'is_sold' or 'status'
        const { data: animalRows, error: animalErr } = await supabase
          .from('animals')
          .select('id, user_id, tag_id, name, species, breed, archived, status, is_sold')
          .eq('user_id', user.id)
          .eq('archived', false)
          .order('tag_id', { ascending: true });

        if (animalErr) {
          console.error('Error fetching animals:', animalErr);
          throw new Error('Nagkaroon ng problema sa database sa pagkuha ng listahan ng kambing at tupa.');
        }

        // 2. Fetch sold animal IDs from animal_sales to ensure sold animals are completely excluded
        const { data: salesRows, error: salesErr } = await supabase
          .from('animal_sales')
          .select('animal_id')
          .eq('user_id', user.id);

        if (salesErr) {
          console.warn('Could not query animal_sales:', salesErr);
        }

        const soldAnimalIdSet = new Set((salesRows || []).map((s) => s.animal_id));

        // Active animals: not archived AND not in animal_sales
        const activeAnimals = (animalRows || []).filter((a) =>
          isAnimalActive({ ...a, is_sold: Boolean(a.is_sold || soldAnimalIdSet.has(a.id)) })
        ) as Animal[];

        // 3. Fetch user's farm inventory
        const { data: invRows, error: invErr } = await supabase
          .from('inventory')
          .select('*')
          .eq('user_id', user.id)
          .order('name', { ascending: true });

        if (invErr) {
          console.error('Error fetching inventory:', invErr);
          throw new Error('Nagkaroon ng problema sa database sa pagkuha ng imbentaryo.');
        }

        // Strictly filter for medicine / treatment supplies (excludes feed, equipment, tools)
        const treatmentItems = (invRows || []).filter((item: InventoryItem) =>
          isTreatmentInventoryItem(item.category)
        ) as InventoryItem[];

        if (isMounted) {
          setAnimals(activeAnimals);
          setInventoryItems(treatmentItems);

          // If preselected animal was passed, maintain selection; otherwise leave unselected
          if (preselectedAnimalId) {
            setSelectedAnimalId(preselectedAnimalId);
          }
        }
      } catch (err: any) {
        console.error('Error loading inventory/animals for treatment modal:', err);
        if (isMounted) {
          setErrorMessage(mapFarmerFriendlyError(err?.message));
        }
      } finally {
        if (isMounted) setFetching(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [open, user?.id, preselectedAnimalId]);

  // Derived selected objects
  const selectedAnimal = useMemo(
    () => animals.find((a) => a.id === selectedAnimalId),
    [animals, selectedAnimalId]
  );

  const selectedItem = useMemo(
    () => inventoryItems.find((i) => i.id === selectedInventoryId),
    [inventoryItems, selectedInventoryId]
  );

  // Live Calculations — Strictly only evaluated when an item is selected
  const hasSelectedItem = Boolean(selectedItem);
  const availableStock = selectedItem ? Number(selectedItem.quantity) || 0 : 0;
  const parsedQty = parseFloat(quantity);
  const requestedQty = isNaN(parsedQty) ? 0 : parsedQty;
  const remainingStock = hasSelectedItem ? Math.max(0, +(availableStock - requestedQty).toFixed(2)) : 0;
  const isOutOfStock = hasSelectedItem && availableStock <= 0;
  // Premature stock error prevention: only true if item is selected, requestedQty > 0, and requestedQty > availableStock
  const isInsufficientStock = hasSelectedItem && requestedQty > 0 && requestedQty > availableStock;
  const isMinStockBreached = hasSelectedItem && selectedItem ? remainingStock <= Number(selectedItem.minimum_stock) : false;

  // Auto-sync dosage placeholder with selected inventory unit
  useEffect(() => {
    if (selectedItem && !dosage) {
      setDosage(`${quantity || '1'} ${selectedItem.unit}`);
    }
  }, [selectedItem, quantity]);

  // Form submission with strict 6-step validation sequence
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      setErrorMessage('Kailangan ng naka-login na user.');
      return;
    }

    // STEP 1: Is an animal selected?
    if (!selectedAnimalId) {
      setErrorMessage('Pakipili muna ng kambing o tupa na gagamutin.');
      return;
    }

    // STEP 2: Is an inventory medicine selected?
    const currentItem = selectedItem;
    if (!selectedInventoryId || !currentItem) {
      setErrorMessage('Pakipili muna ng gamot mula sa imbentaryo.');
      return;
    }

    // STEP 3: Is available stock loaded?
    if (availableStock === undefined || availableStock === null || isNaN(availableStock)) {
      setErrorMessage('Hindi makuha ang kasalukuyang stock. Subukang muli.');
      return;
    }

    // STEP 4: Is quantity valid?
    if (isNaN(requestedQty) || requestedQty <= 0) {
      setErrorMessage('Maglagay ng tamang dami ng gamot (dapat mas mataas sa 0).');
      return;
    }

    // STEP 5: Is requested quantity <= available stock?
    if (requestedQty > availableStock) {
      setErrorMessage(
        `Hindi sapat ang stock sa imbentaryo. Mayroon lamang ${availableStock} ${currentItem.unit} (Kulang ng ${(requestedQty - availableStock).toFixed(2)} ${currentItem.unit}).`
      );
      return;
    }

    // Verify animal is not archived/sold
    if (selectedAnimal && selectedAnimal.archived) {
      setErrorMessage('Hindi maaaring bigyan ng gamot ang alaga na naibenta na o naka-archive.');
      return;
    }

    // STEP 6: Execute atomic medication transaction
    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await administerMedicationTreatment({
        userId: user.id,
        animalId: selectedAnimalId,
        animalTag: selectedAnimal?.tag_id,
        animalName: selectedAnimal?.name || undefined,
        inventoryItem: currentItem,
        quantity: requestedQty,
        unit: currentItem.unit,
        usageType: 'Medication',
        status: status,
        dosage: dosage || `${requestedQty} ${currentItem.unit}`,
        frequency: frequency,
        startDate: startDate,
        endDate: endDate || undefined,
        reason: reason || undefined,
        notes: notes || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Nabigo ang pagtatala ng gamot.');
      }

      setSuccessMessage(
        `Matagumpay na naitala ang gamot! Nabawasan ang ${currentItem.name} ng ${requestedQty} ${currentItem.unit} (Natitirang stock: ${result.newStock} ${currentItem.unit}).`
      );

      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error('Medication submit error:', err);
      setErrorMessage(mapFarmerFriendlyError(err?.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bigyan ng Gamot / Gamit mula sa Imbentaryo"
      subtitle="Direktang konektado sa mga pangunahing pangangailangan ng alaga — awtomatikong mababawas ang stock"
      size="md"
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Error Notification Banner */}
        {errorMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#FEE2E2',
              border: '1px solid #FCA5A5',
              color: '#991B1B',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#DCFCE7',
              border: '1px solid #86EFAC',
              color: '#166534',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 1. Animal Selection */}
        <Select
          label="Kambing o Tupa"
          required
          value={selectedAnimalId}
          onChange={(e) => setSelectedAnimalId(e.target.value)}
          disabled={Boolean(preselectedAnimalId) || loading || fetching}
          helperText={
            selectedAnimal
              ? `Napili: ${selectedAnimal.tag_id} ${selectedAnimal.name ? `(${selectedAnimal.name})` : ''}`
              : 'Piliin ang kambing o tupa na gagamutin'
          }
        >
          <option value="">-- Piliin ang kambing o tupa --</option>
          {animals.length === 0 ? (
            <option value="" disabled>
              Walang aktibong kambing o tupa
            </option>
          ) : (
            animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.tag_id} — {a.name ? `${a.name} (${a.species === 'Goat' ? 'Kambing' : a.species === 'Sheep' ? 'Tupa' : 'Kambing / Tupa'})` : (a.species === 'Goat' ? 'Kambing' : a.species === 'Sheep' ? 'Tupa' : 'Kambing / Tupa')}
              </option>
            ))
          )}
        </Select>

        {/* 2. Medicine Selection from Farm Inventory */}
        <Select
          label="Pumili ng gamot"
          required
          value={selectedInventoryId}
          onChange={(e) => setSelectedInventoryId(e.target.value)}
          disabled={loading || fetching}
          helperText={
            inventoryItems.length === 0
              ? 'Wala pang gamot sa imbentaryo. Magdagdag muna ng gamot.'
              : 'Pipili mula sa imbentaryo ng bukid'
          }
        >
          <option value="">-- Piliin ang gamot mula sa imbentaryo --</option>
          {inventoryItems.length === 0 ? (
            <option value="" disabled>
              Walang gamot na nakatala sa imbentaryo
            </option>
          ) : (
            inventoryItems.map((item) => {
              const qty = Number(item.quantity) || 0;
              const isOut = qty <= 0;
              return (
                <option key={item.id} value={item.id} disabled={isOut}>
                  {item.name} ({item.category}) — {isOut ? `Ubos na (${item.unit})` : `${qty} ${item.unit}`}
                </option>
              );
            })
          )}
        </Select>

        {/* 3. Live Stock Calculation Preview — Strictly shown only AFTER medicine is selected */}
        {!selectedItem ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--color-bg-secondary, #F8FAFC)',
              border: '1px dashed var(--color-border-light, #CBD5E1)',
              color: 'var(--color-text-secondary, #64748B)',
              fontSize: '13px',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <PackageCheck size={16} color="#64748B" />
            <span>Piliin ang gamot para makita kung ilan ang natitira.</span>
          </div>
        ) : (
          <>
            <div
              className="stock-preview-card"
              style={{
                borderColor: isInsufficientStock ? '#EF4444' : isMinStockBreached ? '#F59E0B' : '#E2E8F0',
              }}
            >
              <div className="stat-pill">
                <span className="stat-label">Natitira</span>
                <span className="stat-value" style={{ color: isOutOfStock ? '#EF4444' : '#166534' }}>
                  {availableStock} {selectedItem.unit}
                </span>
              </div>

              <div className="stat-pill">
                <span className="stat-label">Gagamitin</span>
                <span className="stat-value" style={{ color: isInsufficientStock ? '#EF4444' : '#1E293B' }}>
                  {requestedQty} {selectedItem.unit}
                </span>
              </div>

              <div className="stat-pill">
                <span className="stat-label">Matitira pagkatapos</span>
                <span
                  className="stat-value"
                  style={{
                    color: isInsufficientStock ? '#EF4444' : isMinStockBreached ? '#D97706' : '#238B45',
                  }}
                >
                  {remainingStock} {selectedItem.unit}
                </span>
              </div>
            </div>

            {/* Stock Warning only if an item is selected and requested quantity exceeds stock */}
            {isInsufficientStock && (
              <div
                style={{
                  color: '#DC2626',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#FEE2E2',
                  border: '1px solid #FCA5A5',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                  Kulang ang gamot: {availableStock} {selectedItem.unit} na lang ang natitira.
                </span>
              </div>
            )}
          </>
        )}

        {/* 4. Dami & Unit (Compact 2-Column Grid on Mobile) */}
        <div className="modal-form-grid-2">
          <NumberInput
            label="Dami ng gagamitin"
            required
            min="0.01"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={loading || isOutOfStock}
            placeholder="Hal. 10"
          />

          <Input
            label="Yunit"
            value={selectedItem ? selectedItem.unit : '--'}
            disabled
            readOnly
            style={{ background: 'rgba(241, 245, 249, 0.8)', cursor: 'not-allowed' }}
          />
        </div>

        {/* 5. Katayuan ng Gamot (Treatment Status) */}
        <Select
          label="Kalagayan ng gamutan"
          required
          value={status}
          onChange={(e) => setStatus(e.target.value as TreatmentStatus)}
          disabled={loading}
        >
          {TREATMENT_STATUSES.map((st) => (
            <option key={st.value} value={st.value}>
              {st.label}
            </option>
          ))}
        </Select>

        <DateInput
          label="Petsa ng pagbibigay"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={loading}
        />

        {/* Mga opsyonal na detalye ng gamutan */}
        <details className="farmer-form-more">
          <summary>Iba pang detalye (opsyonal)</summary>
          <div className="farmer-form-more-content">
            <div className="modal-form-grid-2">
              <Input
                label="Dosis"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder={selectedItem ? `Hal. ${quantity || '1'} ${selectedItem.unit}` : 'Hal. 10 ml'}
                disabled={loading}
              />

              <Select
                label="Dalas ng pagbigay"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                disabled={loading}
              >
                {FREQUENCY_OPTIONS.map((freq) => (
                  <option key={freq.value} value={freq.value}>
                    {freq.label}
                  </option>
                ))}
              </Select>
            </div>

            <DateInput
              label="Petsa ng susunod na gamot o pagtatapos"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={loading}
            />

            <Input
              label="Dahilan o sintomas"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Hal. lagnat, sipon, regular na purga"
              disabled={loading}
            />

            <Textarea
              label="Tala o tagubilin"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Iba pang tagubilin o obserbasyon sa alaga..."
              disabled={loading}
            />
          </div>
        </details>

        {/* Modal Actions Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid var(--color-border-light, #E2E8F0)',
            position: 'sticky',
            bottom: 0,
            background: 'var(--color-surface, #FFFFFF)',
            zIndex: 10,
            paddingBottom: 'max(4px, env(safe-area-inset-bottom, 4px))',
          }}
        >
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            style={{ minHeight: 44, padding: '0 18px' }}
          >
            Kanselahin
          </Button>

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={
              loading ||
              fetching ||
              !selectedAnimalId ||
              !selectedInventoryId ||
              !hasSelectedItem ||
              isInsufficientStock ||
              isOutOfStock ||
              requestedQty <= 0
            }
            leftIcon={<Pill size={16} />}
            style={{ minHeight: 44, padding: '0 20px', fontWeight: 600 }}
          >
            I-save / Ibigay ang Gamot
          </Button>
        </div>
      </form>
    </Modal>
  );
}
