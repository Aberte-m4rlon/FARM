import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFarmData } from '../lib/useFarmData';
import { isAnimalActive } from '../lib/animalLifecycle';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter, ConfirmDialog } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { FormField, Input, Select } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { FilterToolbar, FilterSearch, FilterSelect } from '../components/FilterToolbar';
import { GoatIcon } from '../components/layout/GoatIcon';
import {
  Plus,
  Pencil,
  Archive,
  History,
  TrendingDown,
  TrendingUp,
  PackageX,
  Package,
  PawPrint,
  Pill,
  Wrench,
  AlertTriangle,
  Baby,
  Scale,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Layers,
  Heart,
  DollarSign,
} from 'lucide-react';
import { inventoryStatus, formatDate, ageLabel } from '../lib/analytics';
import { createNotification } from '../lib/recommendations';
import type { InventoryItem, InventoryCategory, InventoryTransaction } from '../types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function txSign(type: InventoryTransaction['type']): '+' | '-' {
  return type === 'STOCK_IN' || type === 'ADJUSTMENT_IN' || type === 'RETURN' ? '+' : '-';
}

function txColor(type: InventoryTransaction['type']): string {
  return txSign(type) === '+' ? '#16A34A' : '#EF4444';
}

function txLabel(type: InventoryTransaction['type']): string {
  const map: Record<InventoryTransaction['type'], string> = {
    STOCK_IN: 'Pumasok (Stock In)',
    CONSUMPTION: 'Nagamit (Consumed)',
    REMOVAL: 'Tinanggal (Removed)',
    ADJUSTMENT_IN: 'Idinagdag (Adjustment +)',
    ADJUSTMENT_OUT: 'Ibiniwas (Adjustment −)',
    RETURN: 'Ibinalik (Returned)',
  };
  return map[type];
}

function farmerInventoryStatus(status: ReturnType<typeof inventoryStatus>): string {
  switch (status.status) {
    case 'Expired': return 'Paso na';
    case 'Out of Stock': return 'Ubos na';
    case 'Expiring Soon': return status.daysToExpiry === 0 ? 'Mapapaso ngayon' : `Mapapaso sa ${status.daysToExpiry} araw`;
    case 'Low Stock': return 'Kaunti na';
    default: return 'Sapat pa';
  }
}

/** Calculate totals for one item from its transactions */
function itemTotals(itemId: string, txs: InventoryTransaction[]) {
  const mine = txs.filter((t) => t.inventory_item_id === itemId);
  let totalAdded = 0, totalConsumed = 0, totalRemoved = 0, totalAdjNet = 0;
  for (const t of mine) {
    if (t.type === 'STOCK_IN' || t.type === 'RETURN') totalAdded += t.quantity;
    else if (t.type === 'CONSUMPTION') totalConsumed += t.quantity;
    else if (t.type === 'REMOVAL') totalRemoved += t.quantity;
    else if (t.type === 'ADJUSTMENT_IN') totalAdjNet += t.quantity;
    else if (t.type === 'ADJUSTMENT_OUT') totalAdjNet -= t.quantity;
  }
  return { totalAdded, totalConsumed, totalRemoved, totalAdjNet };
}

function getAgeMonths(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  return months >= 0 ? months : 0;
}

const emptyForm = {
  name: '',
  category: 'Other' as InventoryCategory,
  quantity: '',
  unit: 'kg',
  minimum_stock: '',
  purchase_date: '',
  expiry_date: '',
  supplier: '',
  cost: '',
  notes: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const warningDays = farmData.settings?.expiry_warning_days ?? 15;
  // Legacy feed rows stay in Supabase for historical integrity, but are no longer
  // part of current inventory workflows or stock summaries.
  const operationalInventory = useMemo(
    () => farmData.inventory.filter((item) => !/^feed$/i.test((item.category || '').trim())),
    [farmData.inventory],
  );
  const operationalItemIds = useMemo(() => new Set(operationalInventory.map((item) => item.id)), [operationalInventory]);
  const allTx = useMemo(
    () => farmData.inventoryTransactions.filter((transaction) => operationalItemIds.has(transaction.inventory_item_id)),
    [farmData.inventoryTransactions, operationalItemIds],
  );

  // Active view tab: 'all' | 'livestock' | 'health' | 'equipment'
  const [activeTab, setActiveTab] = useState<'all' | 'livestock' | 'health' | 'equipment'>('all');
  const [showAnimalsRoster, setShowAnimalsRoster] = useState(false);

  // ── Add/Edit modal ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InventoryItem | null>(null);

  // ── Filters ──
  const [fCategory, setFCategory] = useState('All');
  const [fStatus, setFStatus] = useState('All');
  const [search, setSearch] = useState('');

  // ── Consume modal ──
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [consumeItem, setConsumeItem] = useState<InventoryItem | null>(null);
  const [consumeQty, setConsumeQty] = useState('');
  const [consumeReason, setConsumeReason] = useState('');
  const [consumeAnimalId, setConsumeAnimalId] = useState('');
  const [consumeSaving, setConsumeSaving] = useState(false);

  // ── Stock-in modal ──
  const [stockInOpen, setStockInOpen] = useState(false);
  const [stockInItem, setStockInItem] = useState<InventoryItem | null>(null);
  const [stockInQty, setStockInQty] = useState('');
  const [stockInCost, setStockInCost] = useState('');
  const [stockInSupplier, setStockInSupplier] = useState('');
  const [stockInDate, setStockInDate] = useState(new Date().toISOString().split('T')[0]);
  const [stockInNotes, setStockInNotes] = useState('');
  const [stockInSaving, setStockInSaving] = useState(false);

  // ── Remove modal ──
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeItem, setRemoveItem] = useState<InventoryItem | null>(null);
  const [removeQty, setRemoveQty] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [removeNotes, setRemoveNotes] = useState('');
  const [removeSaving, setRemoveSaving] = useState(false);

  // ── History modal ──
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);

  // ── Dynamic livestock metrics from saved animal and breeding records ────────
  const activeAnimals = useMemo(() => {
    return farmData.animals.filter(isAnimalActive);
  }, [farmData.animals]);

  const livestockMetrics = useMemo(() => {
    const total = activeAnimals.length;
    const goats = activeAnimals.filter((a) => (a.species || '').toLowerCase() === 'goat').length;
    const sheep = activeAnimals.filter((a) => (a.species || '').toLowerCase() === 'sheep').length;

    const male = activeAnimals.filter((a) => a.sex === 'Male').length;
    const female = activeAnimals.filter((a) => a.sex === 'Female').length;

    let young = 0;
    let adult = 0;
    for (const a of activeAnimals) {
      const m = getAgeMonths(a.date_of_birth);
      if (m !== null) {
        if (m < 12) young++;
        else adult++;
      } else {
        if (a.weight_kg !== null && a.weight_kg < 20) young++;
        else adult++;
      }
    }

    // Pregnant animals
    const pregnant = activeAnimals.filter((a) => {
      if (a.breeding_status === 'Pregnant') return true;
      return farmData.breedingRecords.some((r) => r.animal_id === a.id && r.status === 'Pregnant');
    }).length;

    // Breeding ready females (age >= 8 months or weight >= 25kg, not pregnant)
    const breedingFemales = activeAnimals.filter((a) => {
      if (a.sex !== 'Female' || a.breeding_status === 'Pregnant') return false;
      const m = getAgeMonths(a.date_of_birth);
      return (m !== null && m >= 8) || (a.weight_kg !== null && a.weight_kg >= 25);
    }).length;

    // Breeding males (mature males >= 8 months or weight >= 30kg)
    const breedingMales = activeAnimals.filter((a) => {
      if (a.sex !== 'Male') return false;
      const m = getAgeMonths(a.date_of_birth);
      return (m !== null && m >= 8) || (a.weight_kg !== null && a.weight_kg >= 30);
    }).length;

    // Expected kidding count from active pregnant breeding records
    const expectedKidding = farmData.breedingRecords.filter(
      (r) => r.status === 'Pregnant' && r.expected_kidding_date,
    ).length;

    return {
      total,
      goats,
      sheep,
      male,
      female,
      young,
      adult,
      pregnant,
      notPregnant: Math.max(0, female - pregnant),
      breedingFemales,
      breedingMales,
      expectedKidding,
    };
  }, [activeAnimals, farmData.breedingRecords]);

  const healthSuppliesStats = useMemo(() => {
    const healthItems = operationalInventory.filter((i) => {
      const c = (i.category || '').toLowerCase();
      return (
        c === 'medicine' ||
        c === 'vaccines' ||
        c === 'vitamins' ||
        c === 'supplements' ||
        c.includes('med') ||
        c.includes('vacc') ||
        c.includes('vit')
      );
    });
    const medsCount = healthItems.filter((i) => (i.category || '').toLowerCase().includes('med')).length;
    const vaxCount = healthItems.filter((i) => (i.category || '').toLowerCase().includes('vacc')).length;
    const suppCount = healthItems.filter((i) => {
      const c = (i.category || '').toLowerCase();
      return c.includes('vit') || c.includes('supp');
    }).length;
    const totalUnits = healthItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    return {
      itemCount: healthItems.length,
      medsCount,
      vaxCount,
      suppCount,
      totalUnits,
    };
  }, [operationalInventory]);

  const equipmentToolsStats = useMemo(() => {
    const items = operationalInventory.filter((i) => {
      const c = (i.category || '').toLowerCase();
      return (
        c === 'equipment' ||
        c === 'tools' ||
        c === 'supplies' ||
        c.includes('equip') ||
        c.includes('tool') ||
        c.includes('suppl')
      );
    });
    const equipCount = items.filter((i) => (i.category || '').toLowerCase().includes('equip')).length;
    const toolsCount = items.filter((i) => (i.category || '').toLowerCase().includes('tool')).length;
    const suppliesCount = items.filter((i) => (i.category || '').toLowerCase().includes('suppl')).length;
    const totalUnits = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    return {
      itemCount: items.length,
      equipCount,
      toolsCount,
      suppliesCount,
      totalUnits,
    };
  }, [operationalInventory]);

  // ── Filtered Physical Inventory list ────────────────────────────────────────
  const filtered = useMemo(() => {
    return operationalInventory
      .filter((i) => {
        if (activeTab === 'health') {
          const c = (i.category || '').toLowerCase();
          return c === 'medicine' || c === 'vaccines' || c === 'vitamins' || c === 'supplements';
        }
        if (activeTab === 'equipment') {
          const c = (i.category || '').toLowerCase();
          return c === 'equipment' || c === 'tools' || c === 'supplies';
        }
        return true;
      })
      .filter((i) => fCategory === 'All' || i.category === fCategory)
      .filter((i) => {
        if (fStatus === 'All') return true;
        const s = inventoryStatus(i, warningDays);
        return s.status === fStatus;
      })
      .filter(
        (i) =>
          !search ||
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          (i.supplier ?? '').toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [operationalInventory, activeTab, fCategory, fStatus, search, warningDays]);

  // ── Financial and stock summary ─────────────────────────────────────────────
  const summary = useMemo(() => {
    const inv = operationalInventory;
    const warningDaysLocal = warningDays;
    const lowStock = inv.filter((i) => inventoryStatus(i, warningDaysLocal).status === 'Low Stock').length;
    const outOfStock = inv.filter((i) => inventoryStatus(i, warningDaysLocal).status === 'Out of Stock').length;
    const expiring = inv.filter((i) => inventoryStatus(i, warningDaysLocal).status === 'Expiring Soon').length;
    const expired = inv.filter((i) => inventoryStatus(i, warningDaysLocal).status === 'Expired').length;

    const totalConsumed = allTx.filter((t) => t.type === 'CONSUMPTION').reduce((s, t) => s + t.quantity, 0);

    // Time boundaries
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const consumedToday = allTx
      .filter((t) => t.type === 'CONSUMPTION' && t.created_at.startsWith(todayStr))
      .reduce((s, t) => s + t.quantity, 0);

    const consumedWeek = allTx
      .filter((t) => t.type === 'CONSUMPTION' && new Date(t.created_at) >= weekAgo)
      .reduce((s, t) => s + t.quantity, 0);

    const consumedMonth = allTx
      .filter((t) => t.type === 'CONSUMPTION' && new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.quantity, 0);

    const addedMonth = allTx
      .filter((t) => (t.type === 'STOCK_IN' || t.type === 'RETURN') && new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.quantity, 0);

    // Spend transactions
    const spendTx = allTx.filter((t) => t.type === 'STOCK_IN' || t.type === 'RETURN');
    const totalSpent = spendTx.reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);
    const spentThisMonth = spendTx
      .filter((t) => new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);
    const spentThisWeek = spendTx
      .filter((t) => new Date(t.created_at) >= weekAgo)
      .reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);
    const spentToday = spendTx
      .filter((t) => t.created_at.startsWith(todayStr))
      .reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);

    const totalSpentFallback =
      totalSpent === 0
        ? inv.reduce((s, i) => s + (Number(i.cost) || 0) * (Number(i.quantity) || 0), 0)
        : totalSpent;

    const consumedTx = allTx.filter((t) => t.type === 'CONSUMPTION');
    const totalConsumedValue = consumedTx.reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);
    const consumedValueMonth = consumedTx
      .filter((t) => new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.quantity * (Number(t.cost_per_unit) || 0), 0);

    const currentInventoryValue = inv.reduce((s, i) => s + Number(i.quantity) * (Number(i.cost) || 0), 0);

    const byCategory: Record<string, number> = {};
    for (const t of spendTx) {
      const item = inv.find((i) => i.id === t.inventory_item_id);
      const cat = item?.category ?? 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + t.quantity * (Number(t.cost_per_unit) || 0);
    }

    return {
      totalItems: inv.length,
      lowStock,
      outOfStock,
      expiring,
      expired,
      totalValue: currentInventoryValue,
      totalConsumed,
      consumedToday,
      consumedWeek,
      consumedMonth,
      addedMonth,
      totalSpent: totalSpentFallback,
      spentThisMonth,
      spentThisWeek,
      spentToday,
      totalConsumedValue,
      consumedValueMonth,
      currentInventoryValue,
      byCategory,
    };
  }, [operationalInventory, allTx, warningDays]);

  // ── Core transaction helper ─────────────────────────────────────────────────
  const recordTransaction = async (
    item: InventoryItem,
    type: InventoryTransaction['type'],
    qty: number,
    reason: string | null,
    notes: string | null,
    costPerUnit?: number | null,
    referenceType?: string | null,
    referenceId?: string | null,
  ): Promise<{ newStock: number } | null> => {
    if (!user) return null;
    if (!isSuperAdmin && item.user_id !== user.id) {
      toast('Walang pahintulot sa gamit na ito sa imbentaryo.', 'danger');
      return null;
    }
    const { data, error } = await supabase.rpc('record_inventory_transaction', {
      p_user_id: item.user_id,
      p_inventory_item_id: item.id,
      p_type: type,
      p_quantity: qty,
      p_reason: reason || null,
      p_notes: notes || null,
      p_cost_per_unit: costPerUnit ?? item.cost ?? null,
      p_reference_type: referenceType ?? null,
      p_reference_id: referenceId ?? null,
    });
    if (error) throw error;
    if (!data?.success) throw new Error('Hindi nakumpirma ang inventory transaction.');
    return { newStock: Number(data.new_stock) };
  };

  // ── Consume (Usage) ─────────────────────────────────────────────────────────
  const openConsume = (item: InventoryItem) => {
    setConsumeItem(item);
    setConsumeQty('');
    setConsumeReason('');
    setConsumeAnimalId('');
    setConsumeOpen(true);
  };

  const handleConsumeStock = async () => {
    if (!consumeItem || consumeSaving || !user) return;
    if (!isSuperAdmin && consumeItem.user_id !== user.id) {
      toast('Walang pahintulot sa gamit na ito.', 'danger');
      return;
    }

    const qty = Number(consumeQty);
    if (!consumeQty || isNaN(qty) || qty <= 0) {
      toast('Maglagay ng wastong dami.', 'danger');
      return;
    }
    if (qty > Number(consumeItem.quantity)) {
      toast(`Kulang ang stock (${consumeItem.quantity} ${consumeItem.unit} lamang ang natitira).`, 'danger');
      return;
    }
    setConsumeSaving(true);
    try {
      const targetAnimal = consumeAnimalId ? farmData.animals.find((a) => a.id === consumeAnimalId) : null;
      if (consumeAnimalId && (!targetAnimal || (!isSuperAdmin && targetAnimal.user_id !== user.id))) {
        toast('Walang pahintulot sa napiling alaga.', 'danger');
        setConsumeSaving(false);
        return;
      }

      const txNotes = targetAnimal
        ? `Ginamit para kay ${targetAnimal.tag_id} (${targetAnimal.name || 'Walang Pangalan'})`
        : null;

      const result = await recordTransaction(
        consumeItem,
        'CONSUMPTION',
        qty,
        consumeReason || 'Usage',
        txNotes,
        null,
        targetAnimal ? 'animal' : null,
        targetAnimal ? targetAnimal.id : null,
      );
      if (!result) {
        setConsumeSaving(false);
        return;
      }

      const updatedItem = { ...consumeItem, quantity: result.newStock };
      const nextStatus = inventoryStatus(updatedItem, warningDays);
      if (nextStatus.status !== 'OK') {
        await createNotification(
          user?.id ?? '',
          'Inventory',
          `${consumeItem.name}: ${nextStatus.label}`,
          `Nagamit: ${qty} ${consumeItem.unit}. Natitirang stock: ${result.newStock} ${consumeItem.unit}.`,
          nextStatus.status === 'Out of Stock' || nextStatus.status === 'Expired' ? 'Critical' : 'Warning',
          '/inventory',
        );
      }

      toast(`Naitala: −${qty} ${consumeItem.unit} ng ${consumeItem.name}. Natitira: ${result.newStock} ${consumeItem.unit}.`, 'success');
      setConsumeOpen(false);
      farmData.refresh();
    } catch {
      toast('Hindi naitala ang paggamit ng gamit. Suriin ang dami at subukan muli.', 'danger');
    } finally {
      setConsumeSaving(false);
    }
  };

  // ── Stock-in ────────────────────────────────────────────────────────────────
  const openStockIn = (item: InventoryItem) => {
    setStockInItem(item);
    setStockInQty('');
    setStockInCost('');
    setStockInSupplier(item.supplier ?? '');
    setStockInDate(new Date().toISOString().split('T')[0]);
    setStockInNotes('');
    setStockInOpen(true);
  };

  const handleStockIn = async () => {
    if (!stockInItem || stockInSaving || !user) return;
    if (!isSuperAdmin && stockInItem.user_id !== user.id) {
      toast('Walang pahintulot sa gamit na ito.', 'danger');
      return;
    }
    const qty = Number(stockInQty);
    if (!stockInQty || isNaN(qty) || qty <= 0) {
      toast('Maglagay ng wastong dami.', 'danger');
      return;
    }
    setStockInSaving(true);
    try {
      const costPerUnit = stockInCost ? Number(stockInCost) / qty : stockInItem.cost;
      const notes = [
        stockInSupplier ? `Supplier: ${stockInSupplier}` : '',
        stockInDate ? `Date: ${stockInDate}` : '',
        stockInNotes,
      ].filter(Boolean).join(' | ') || null;

      const { data, error } = await supabase.rpc('record_inventory_stock_in', {
        p_user_id: stockInItem.user_id,
        p_inventory_item_id: stockInItem.id,
        p_quantity: qty,
        p_reason: 'Stock replenishment',
        p_notes: notes,
        p_cost_per_unit: costPerUnit ?? null,
        p_supplier: stockInSupplier || null,
        p_purchase_date: stockInDate || null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Hindi nakumpirma ang pagpasok ng stock at history nito.');
      const newStock = Number(data.new_stock);

      toast(`Naidagdag ang ${qty} ${stockInItem.unit} sa ${stockInItem.name}. Bagong stock: ${newStock} ${stockInItem.unit}.`, 'success');
      setStockInOpen(false);
      farmData.refresh();
    } catch {
      toast('Hindi nadagdag ang stock. Suriin ang dami at subukan muli.', 'danger');
    } finally {
      setStockInSaving(false);
    }
  };

  // ── Remove (spoilage/loss) ──────────────────────────────────────────────────
  const openRemove = (item: InventoryItem) => {
    setRemoveItem(item);
    setRemoveQty('');
    setRemoveReason('');
    setRemoveNotes('');
    setRemoveOpen(true);
  };

  const handleRemove = async () => {
    if (!removeItem || removeSaving) return;
    const qty = Number(removeQty);
    if (!removeQty || isNaN(qty) || qty <= 0) {
      toast('Maglagay ng wastong dami.', 'danger');
      return;
    }
    if (qty > Number(removeItem.quantity)) {
      toast(`Hindi maaaring magbawas ng higit sa natitirang stock (${removeItem.quantity} ${removeItem.unit}).`, 'danger');
      return;
    }
    if (!removeReason.trim()) {
      toast('Pumili o magbigay ng dahilan sa pagbawas.', 'danger');
      return;
    }
    setRemoveSaving(true);
    try {
      const result = await recordTransaction(removeItem, 'REMOVAL', qty, removeReason, removeNotes || null);
      if (!result) {
        setRemoveSaving(false);
        return;
      }
      toast(`Nabawas ang ${qty} ${removeItem.unit} mula sa ${removeItem.name}. Natitira: ${result.newStock} ${removeItem.unit}.`, 'success');
      setRemoveOpen(false);
      farmData.refresh();
    } catch {
      toast('Hindi naitala ang bawas sa stock. Suriin ang dami at subukan muli.', 'danger');
    } finally {
      setRemoveSaving(false);
    }
  };

  // ── History modal ───────────────────────────────────────────────────────────
  const openHistory = (item: InventoryItem) => {
    setHistoryItem(item);
    setHistoryOpen(true);
  };

  const historyTx = useMemo(
    () =>
      historyItem
        ? [...allTx.filter((t) => t.inventory_item_id === historyItem.id)].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
        : [],
    [historyItem, allTx],
  );

  // ── Add/Edit item ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setModalOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      openAdd();
      navigate(location.pathname, { replace: true });
    }
  }, [location.search]);

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      name: item.name,
      category: item.category,
      quantity: String(item.quantity),
      unit: item.unit,
      minimum_stock: String(item.minimum_stock),
      purchase_date: item.purchase_date ?? '',
      expiry_date: item.expiry_date ?? '',
      supplier: item.supplier ?? '',
      cost: item.cost !== null && item.cost !== undefined ? String(item.cost) : '',
      notes: item.notes ?? '',
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Pangalan ng item ay kailangan.';
    if (!form.quantity || isNaN(Number(form.quantity)) || Number(form.quantity) < 0)
      e.quantity = 'Wastong dami ay kailangan.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;
    setSaving(true);
    try {
      if (editing) {
        if (!isSuperAdmin && editing.user_id !== user.id) {
          toast('Walang pahintulot na i-edit ang gamit na ito.', 'danger');
          return;
        }
      }

      const { data, error } = await supabase.rpc('save_inventory_item', {
        p_user_id: editing?.user_id ?? user.id,
        p_inventory_item_id: editing?.id ?? null,
        p_name: form.name.trim(),
        p_category: form.category,
        p_quantity: Number(form.quantity),
        p_unit: form.unit.trim() || 'kg',
        p_minimum_stock: Number(form.minimum_stock) || 0,
        p_purchase_date: form.purchase_date || null,
        p_expiry_date: form.expiry_date || null,
        p_supplier: form.supplier.trim() || null,
        p_cost: form.cost ? Number(form.cost) : null,
        p_notes: form.notes.trim() || null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Hindi nakumpirma ang pag-save ng item at stock history.');

      toast(editing ? 'Matagumpay na na-update ang gamit sa imbentaryo.' : 'Matagumpay na naidagdag sa imbentaryo.', 'success');

      setModalOpen(false);
      farmData.refresh();
    } catch {
      toast('Hindi na-save ang gamit. Suriin ang impormasyon at subukan muli.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    try {
      let invDel = supabase.from('inventory').update({
        archived_at: new Date().toISOString(), archived_by: user.id,
      }).eq('id', confirmDelete.id);
      if (!isSuperAdmin) {
        invDel = invDel.eq('user_id', user.id);
      }
      const { error } = await invDel;
      if (error) throw error;
      toast('In-archive ang item. Nananatili ang stock at transaction history; maaari itong ibalik sa Archived Records.', 'success');
      setConfirmDelete(null);
      farmData.refresh();
    } catch {
      toast('Hindi ma-archive ang item.', 'danger');
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.4px', color: 'var(--color-text-primary, #0F172A)' }}>
              Goat and Sheep Essentials (Mga Pangunahing Pangangailangan ng Kambing at Tupa)
            </h1>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 6,
                background: '#EAF6ED',
                color: 'var(--color-primary, #238B45)',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Mga Pangunahing Pangangailangan
            </span>
          </div>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Mga bakuna, gamot, kagamitan, at suplay para sa mga kambing at tupa.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/animals?action=add')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}
          >
            <PawPrint size={15} />
            Magdagdag ng Kambing o Tupa
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}
          >
            <Plus size={16} />
            Magdagdag ng Item
          </button>
        </div>
      </div>

      {/* ── Main Inventory Overview (Top 6 Cards) ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-secondary, #64748B)', marginBottom: 8 }}>
          Mahahalagang Tala ng Bukid
        </div>
        <div className="dashboard-stats stats-grid gen-inv-grid mobile-stats-grid-3">
          {/* 1. Livestock */}
          <div className="kpi-card" onClick={() => setActiveTab('livestock')} style={{ cursor: 'pointer' }}>
            <div className="kpi-top">
              <div className="kpi-icon green">
                <Layers size={18} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #176B35)' }}>Kabuuang Kambing at Tupa</span>
            </div>
            <div className="kpi-value">{livestockMetrics.total}</div>
            <div className="kpi-label">Kambing at Tupa</div>
            <div className="kpi-delta up" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>{livestockMetrics.goats} kambing · {livestockMetrics.sheep} tupa</span>
            </div>
          </div>

          {/* 2. Health Supplies */}
          <div className="kpi-card" onClick={() => setActiveTab('health')} style={{ cursor: 'pointer' }}>
            <div className="kpi-top">
              <div className="kpi-icon red">
                <Pill size={18} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #176B35)' }}>Health Supplies</span>
            </div>
            <div className="kpi-value">{healthSuppliesStats.itemCount} <span style={{ fontSize: 14 }}>uri</span></div>
            <div className="kpi-label">Kalusugan at Gamot</div>
            <div className="kpi-delta up">
              {healthSuppliesStats.medsCount} gamot · {healthSuppliesStats.vaxCount} bakuna
            </div>
          </div>

          {/* 4. Farm Supplies */}
          <div className="kpi-card" onClick={() => setActiveTab('equipment')} style={{ cursor: 'pointer' }}>
            <div className="kpi-top">
              <div className="kpi-icon blue">
                <Package size={18} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #176B35)' }}>Pangunahing Pangangailangan</span>
            </div>
            <div className="kpi-value">{equipmentToolsStats.suppliesCount} <span style={{ fontSize: 14 }}>uri</span></div>
            <div className="kpi-label">Suplay para sa Alaga</div>
            <div className="kpi-delta up">
              Mga kailangang suplay para sa kambing at tupa
            </div>
          </div>

          {/* 5. Equipment */}
          <div className="kpi-card" onClick={() => setActiveTab('equipment')} style={{ cursor: 'pointer' }}>
            <div className="kpi-top">
              <div className="kpi-icon blue">
                <Wrench size={18} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #176B35)' }}>Equipment</span>
            </div>
            <div className="kpi-value">{equipmentToolsStats.equipCount + equipmentToolsStats.toolsCount} <span style={{ fontSize: 14 }}>gamit</span></div>
            <div className="kpi-label">Farm Equipment</div>
            <div className="kpi-delta up">
              {equipmentToolsStats.equipCount} equipment · {equipmentToolsStats.toolsCount} tools
            </div>
          </div>

          {/* 6. Low Stock */}
          <div className="kpi-card" onClick={() => setFStatus('Low Stock')} style={{ cursor: 'pointer' }}>
            <div className="kpi-top">
              <div className="kpi-icon red" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#EF4444' }}>
                <AlertTriangle size={18} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#EF4444' }}>Low Stock</span>
            </div>
            <div className="kpi-value" style={{ color: summary.lowStock > 0 ? '#EF4444' : undefined }}>
              {summary.lowStock} <span style={{ fontSize: 14 }}>item</span>
            </div>
            <div className="kpi-label">Kailangang Restock</div>
            <div className="kpi-delta down">
              Mababang antas ng imbentaryo
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .gen-inv-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 1024px) {
          .gen-inv-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }
        }
        @media (max-width: 767px) {
          .gen-inv-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
        }
        @media (max-width: 480px) {
          .gen-inv-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 6px !important;
          }
        }
      `}</style>

      {/* ── Active Alerts Strip ── */}
      {(summary.lowStock > 0 || summary.expired > 0 || summary.expiring > 0) && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            background: 'var(--color-surface, #FFFFFF)',
            border: '1px solid var(--color-border, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13, color: 'var(--color-text-primary, #0F172A)' }}>
              <AlertTriangle size={16} color="#F59E0B" />
              Mga Alerto sa Bukid:
            </div>

            {summary.lowStock > 0 && (
              <span
                onClick={() => { setActiveTab('all'); setFStatus('Low Stock'); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#D97706',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <PackageX size={14} />
                {summary.lowStock} Mababang Stock sa Supplies
              </span>
            )}

            {summary.expired > 0 && (
              <span
                onClick={() => { setActiveTab('all'); setFStatus('Expired'); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#DC2626',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <AlertTriangle size={14} />
                {summary.expired} Expired na Gamot o Gamit
              </span>
            )}

            {summary.expiring > 0 && (
              <span
                onClick={() => { setActiveTab('all'); setFStatus('Expiring Soon'); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#D97706',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <History size={14} />
                {summary.expiring} Malapit Nang Mag-expire
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Category Quick Filter Tabs ── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflow: 'visible',
          paddingBottom: 4,
          borderBottom: '1px solid var(--color-border, #E2E8F0)',
        }}
      >
        {[
          { key: 'all', label: 'Lahat', icon: <Layers size={15} /> },
          { key: 'livestock', label: `Kambing at Tupa (${livestockMetrics.total})`, icon: <PawPrint size={15} /> },
          { key: 'health', label: 'Gamot', icon: <Pill size={15} /> },
          { key: 'equipment', label: 'Kagamitan', icon: <Wrench size={15} /> },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: activeTab === tab.key ? '1px solid var(--color-primary, #238B45)' : '1px solid transparent',
              background: activeTab === tab.key ? '#EAF6ED' : 'transparent',
              color: activeTab === tab.key ? 'var(--color-primary, #238B45)' : 'var(--color-text-secondary, #64748B)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          SECTION 1: KAMBING AT TUPA
          ══════════════════════════════════════════════════════════════════════════ */}
      {(activeTab === 'all' || activeTab === 'livestock') && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <GoatIcon size={20} color="var(--color-primary, #238B45)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                  Imbentaryo ng Kambing at Tupa
                </h3>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>
                Direktang naka-link sa Talaan ng Kambing at Tupa. Awtomatikong nag-a-update ang bilang.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAnimalsRoster((prev) => !prev)}
                style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {showAnimalsRoster ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showAnimalsRoster ? 'Itago ang Talaan ng Alaga' : 'Ipakita ang Talaan ng Alaga'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/animals')}
                style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-primary, #238B45)' }}
              >
                Pamamahala ng Kambing at Tupa <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* 4 Livestock Dimension Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
            {/* Card A: Species & Kasarian */}
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--color-surface-elevated, #F8FAFC)',
                border: '1px solid var(--color-border, #E2E8F0)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary, #64748B)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <GoatIcon size={14} color="#238B45" />
                Uri at Kasarian (Species & Sex)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Kambing (Goat):</span>
                  <span style={{ fontWeight: 800, color: '#238B45' }}>{livestockMetrics.goats}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Tupa (Sheep):</span>
                  <span style={{ fontWeight: 800, color: '#176B35' }}>{livestockMetrics.sheep}</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--color-border, #E2E8F0)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Lalaki (Barako):</span>
                  <span style={{ fontWeight: 700 }}>{livestockMetrics.male}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Babae (Inahin):</span>
                  <span style={{ fontWeight: 700 }}>{livestockMetrics.female}</span>
                </div>
              </div>
            </div>

            {/* Card B: Edad at Yugto */}
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--color-surface-elevated, #F8FAFC)',
                border: '1px solid var(--color-border, #E2E8F0)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary, #64748B)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Baby size={14} color="#238B45" />
                Yugto ng Edad (Age & Stage)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Bisiro / Young (&lt; 12 mo):</span>
                  <span style={{ fontWeight: 800, color: '#238B45' }}>{livestockMetrics.young}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Matanda / Adult (≥ 12 mo):</span>
                  <span style={{ fontWeight: 800, color: '#176B35' }}>{livestockMetrics.adult}</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--color-border, #E2E8F0)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: 'var(--color-text-secondary, #64748B)' }}>Lahi / Breeding Stock:</span>
                  <span style={{ fontWeight: 700, color: '#238B45' }}>{livestockMetrics.breedingFemales + livestockMetrics.breedingMales} handa</span>
                </div>
              </div>
            </div>

            {/* Card C: Pagpaparami at Pagbubuntis */}
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--color-surface-elevated, #F8FAFC)',
                border: '1px solid var(--color-border, #E2E8F0)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary, #64748B)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Heart size={14} color="#238B45" />
                Pagpaparami (Reproduction)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Buntis (Pregnant):</span>
                  <span style={{ fontWeight: 800, color: '#238B45' }}>{livestockMetrics.pregnant} inahin</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Hindi Buntis:</span>
                  <span style={{ fontWeight: 700 }}>{livestockMetrics.notPregnant}</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--color-border, #E2E8F0)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: 'var(--color-text-secondary, #64748B)' }}>Inaasahang Panganganak:</span>
                  <span style={{ fontWeight: 700, color: '#F59E0B' }}>{livestockMetrics.expectedKidding}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Active Animals Roster Drawer */}
          {showAnimalsRoster && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border, #E2E8F0)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                  Aktibong Talaan ng Kambing at Tupa sa Bukid ({activeAnimals.length})
                </h4>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('/animals')}
                  style={{ fontSize: 11 }}
                >
                  Tingnan sa Kambing at Tupa
                </button>
              </div>

              {activeAnimals.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--color-text-secondary, #64748B)', fontSize: 13 }}>
                  Walang aktibong kambing o tupa na nakatala. Magdagdag ng bago gamit ang button sa itaas.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Tag ID</th>
                        <th>Pangalan</th>
                        <th>Uri / Species</th>
                        <th>Kasarian</th>
                        <th>Edad</th>
                        <th>Pagbubuntis</th>
                        <th>Aksyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAnimals.slice(0, 15).map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 800, color: 'var(--color-primary, #238B45)' }}>{a.tag_id}</td>
                          <td style={{ fontWeight: 600 }}>{a.name || 'Walang Pangalan'}</td>
                          <td>
                            <span className="badge" style={{ background: 'var(--color-surface-elevated, #F8FAFC)', border: '1px solid var(--color-border, #E2E8F0)', fontSize: 11 }}>
                              {a.species === 'Goat' ? 'Kambing' : 'Tupa'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}>{a.sex === 'Male' ? 'Lalaki' : 'Babae'}</td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>{ageLabel(a.date_of_birth)}</td>
                          <td style={{ fontSize: 12 }}>
                            {a.breeding_status === 'Pregnant' ? (
                              <span style={{ color: '#176B35', fontWeight: 700 }}>Buntis</span>
                            ) : (
                              <span style={{ color: 'var(--color-text-secondary, #64748B)' }}>{a.breeding_status || 'Open'}</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => navigate(`/animals/${a.id}`)}
                              style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary, #238B45)' }}
                            >
                              Tingnan
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {activeAnimals.length > 15 && (
                    <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>
                      May iba pang aktibong kambing at tupa sa talaan.{' '}
                      <button
                        type="button"
                        onClick={() => navigate('/animals')}
                        style={{ color: 'var(--color-primary, #238B45)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                      >
                        Tingnan ang lahat sa Kambing at Tupa &rarr;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          SECTION 2: FARM STOCKS & RESOURCES (Gamot, Kagamitan, Supplies)
          ══════════════════════════════════════════════════════════════════════════ */}
      {(activeTab === 'all' || activeTab !== 'livestock') && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package size={20} color="#F59E0B" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                  Imbentaryo ng mga Gamit at Supplies (Farm Stocks & Resources)
                </h3>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>
                Gamot, bakuna, kagamitan, at iba pang kasangkapan para sa pagpapatakbo ng bukid.
              </p>
            </div>

            <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
              <Plus size={14} /> Magdagdag ng Stock
            </button>
          </div>

          {/* Filters */}
          <FilterToolbar>
            <FilterSearch placeholder="Hanapin ang pangalan ng gamit o supplier..." value={search} onChange={setSearch} />
            <FilterSelect
              value={fCategory}
              onChange={setFCategory}
              options={[
                { value: 'All', label: 'Lahat ng gamit' },
                { value: 'Medicine', label: 'Gamot' },
                { value: 'Vaccines', label: 'Bakuna' },
                { value: 'Vitamins', label: 'Bitamina' },
                { value: 'Supplements', label: 'Suplemento' },
                { value: 'Supplies', label: 'Supply' },
                { value: 'Equipment', label: 'Kagamitan' },
                { value: 'Tools', label: 'Kasangkapan' },
                { value: 'Other', label: 'Iba pa' },
              ]}
              ariaLabel="Uri ng gamit"
            />
            <FilterSelect
              value={fStatus}
              onChange={setFStatus}
              options={[
                { value: 'All', label: 'Lahat ng kalagayan' },
                { value: 'OK', label: 'Sapat pa' },
                { value: 'Low Stock', label: 'Kaunti na' },
                { value: 'Out of Stock', label: 'Ubos na' },
                { value: 'Expiring Soon', label: 'Malapit nang mapaso' },
                { value: 'Expired', label: 'Paso na' },
              ]}
              ariaLabel="Kalagayan ng stock"
            />
          </FilterToolbar>

          {/* Physical Inventory Table */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Package size={32} />}
              title="Walang natagpuang gamit o supply"
              description="Magdagdag ng gamot o kagamitan upang masubaybayan ang stock at paggamit."
            />
          ) : (
            <>
            <div className="table-wrap inventory-table-desktop">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Gamit</th>
                    <th>Kategorya</th>
                    <th>Kasalukuyang Stock</th>
                    <th>Nagamit Ngayong Buwan</th>
                    <th>Minimum</th>
                    <th>Status</th>
                    <th>Tinatayang Halaga</th>
                    <th>Petsa ng pag-expire</th>
                    <th>Mga Aksyon</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const s = inventoryStatus(i, warningDays);
                    const tots = itemTotals(i.id, allTx);
                    const value = Number(i.quantity) * (Number(i.cost) || 0);
                    return (
                      <tr key={i.id}>
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary, #0F172A)' }}>
                            {i.name}
                          </div>
                          {i.supplier && (
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748B)' }}>
                              {i.supplier}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: 'var(--color-surface-elevated, #F8FAFC)',
                              border: '1px solid var(--color-border, #E2E8F0)',
                              color: 'var(--color-text-secondary, #475569)',
                              fontSize: 11,
                            }}
                          >
                            {i.category}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: 14,
                              color:
                                Number(i.quantity) <= 0
                                  ? '#EF4444'
                                  : Number(i.quantity) <= Number(i.minimum_stock)
                                  ? '#F59E0B'
                                  : 'var(--color-text-primary, #0F172A)',
                            }}
                          >
                            {Number(i.quantity).toFixed(Number.isInteger(Number(i.quantity)) ? 0 : 1)} {i.unit}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: tots.totalConsumed > 0 ? '#EF4444' : 'var(--color-text-secondary, #64748B)' }}>
                          {tots.totalConsumed > 0
                            ? `${tots.totalConsumed.toFixed(Number.isInteger(tots.totalConsumed) ? 0 : 1)} ${i.unit}`
                            : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>
                          {i.minimum_stock} {i.unit}
                        </td>
                        <td>
                          <span
                            className={`badge badge-${
                              s.color === 'green'
                                ? 'green'
                                : s.color === 'orange'
                                ? 'orange'
                                : s.color === 'red'
                                ? 'red'
                                : 'gray'
                            }`}
                          >
                            {farmerInventoryStatus(s)}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, fontWeight: 700 }}>
                          {value > 0 ? `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}` : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>
                          {formatDate(i.expiry_date)}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openConsume(i)}
                              title="Itala ang nagamit (Gamitin)"
                              style={{ color: '#EF4444' }}
                            >
                              <TrendingDown size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openStockIn(i)}
                              title="Dagdagan ang stock"
                              style={{ color: '#16A34A' }}
                            >
                              <TrendingUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openRemove(i)}
                              title="Tapon / Bawas (Spoilage)"
                              style={{ color: '#F59E0B' }}
                            >
                              <PackageX size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openHistory(i)}
                              title="Kasaysayan ng stock"
                            >
                              <History size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openEdit(i)}
                              title="I-edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setConfirmDelete(i)}
                              style={{ color: '#EF4444' }}
                              title="I-archive"
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
            <div className="inventory-mobile-cards">
              {filtered.map((i) => {
                const status = inventoryStatus(i, warningDays);
                const totals = itemTotals(i.id, allTx);
                const value = Number(i.quantity) * (Number(i.cost) || 0);
                return (
                  <article className="inventory-mobile-card" key={i.id}>
                    <div className="inventory-mobile-card-heading">
                      <div><strong>{i.name}</strong><span>{i.category}{i.supplier ? ` · ${i.supplier}` : ''}</span></div>
                      <span className={`inventory-mobile-status is-${status.color}`}>{farmerInventoryStatus(status)}</span>
                    </div>
                    <div className="inventory-mobile-stock">
                      <strong>{Number(i.quantity).toFixed(Number.isInteger(Number(i.quantity)) ? 0 : 1)} {i.unit}</strong>
                      <span>Kasalukuyang stock</span>
                    </div>
                    <div className="inventory-mobile-details">
                      <span>Nagamit ngayong buwan: {totals.totalConsumed > 0 ? `${totals.totalConsumed} ${i.unit}` : 'Wala'}</span>
                      <span>Minimum na stock: {i.minimum_stock} {i.unit}</span>
                      <span>Petsa ng pag-expire: {formatDate(i.expiry_date)}</span>
                      {value > 0 && <span>Tinatayang halaga: ₱{value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</span>}
                    </div>
                    <div className="inventory-mobile-actions">
                      <Button variant="primary" size="sm" onClick={() => openConsume(i)} leftIcon={<TrendingDown size={14} />}>Gamitin</Button>
                      <Button variant="secondary" size="sm" onClick={() => openStockIn(i)} leftIcon={<TrendingUp size={14} />}>Dagdag stock</Button>
                      <details className="compact-actions-menu">
                        <summary>Iba pa</summary>
                        <div className="animal-actions-menu-items">
                          <button onClick={() => openRemove(i)}><PackageX size={15} /> Itala ang tapon o bawas</button>
                          <button onClick={() => openHistory(i)}><History size={15} /> Tingnan ang kasaysayan</button>
                          <button onClick={() => openEdit(i)}><Pencil size={15} /> I-edit</button>
                          <button onClick={() => setConfirmDelete(i)}><Archive size={15} /> I-archive</button>
                        </div>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          SECTION 3: INVENTORY FINANCIALS & USAGE (Gastos at Paggamit)
          ══════════════════════════════════════════════════════════════════════════ */}
      {(activeTab === 'all' || activeTab !== 'livestock') && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={16} color="#238B45" />
            Gastos at halaga ng imbentaryo
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 12 }} className="inv-main-expense">
            {[
              { label: 'Kabuuang Binili (Total Purchased)', value: summary.totalSpent, color: '#176B35' },
              { label: 'Kabuuang Nagamit (Total Consumed)', value: summary.totalConsumedValue, color: '#50645A' },
              { label: 'Kasalukuyang Halaga (Stock Asset Value)', value: summary.currentInventoryValue, color: '#238B45' },
            ].map((e) => (
              <div
                key={e.label}
                style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--color-surface-elevated, #F8FAFC)',
                  border: '1px solid var(--color-border, #E2E8F0)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748B)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                  {e.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: e.color }}>
                  ₱{e.value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }} className="inv-expense-grid">
            {[
              { label: 'Ngayong Araw', value: summary.spentToday },
              { label: 'Ngayong Linggo', value: summary.spentThisWeek },
              { label: 'Ngayong Buwan', value: summary.spentThisMonth },
              { label: 'Kabuuang Gastos', value: summary.totalSpent },
            ].map((e) => (
              <div
                key={e.label}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--color-surface-elevated, #F8FAFC)',
                  border: '1px solid var(--color-border, #E2E8F0)',
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--color-text-secondary, #64748B)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>
                  {e.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                  ₱{e.value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <ModalHeader
          title={editing ? 'I-edit ang gamit sa bukid' : 'Magdagdag ng gamit sa bukid'}
          onClose={() => setModalOpen(false)}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="modal-form-grid-2">
              <FormField label="Pangalan ng gamit" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Hal. pampurga, bitamina, first aid kit"
                />
              </FormField>

              <FormField label="Uri ng gamit">
                <Select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as InventoryCategory })}
                  options={[
                    { value: 'Medicine', label: 'Gamot' },
                    { value: 'Vaccines', label: 'Bakuna' },
                    { value: 'Vitamins', label: 'Bitamina' },
                    { value: 'Supplements', label: 'Suplemento' },
                    { value: 'Supplies', label: 'Pang-araw-araw na gamit' },
                    { value: 'Equipment', label: 'Kagamitan' },
                    { value: 'Tools', label: 'Kasangkapan' },
                    { value: 'Other', label: 'Iba pa' },
                  ]}
                />
              </FormField>
            </div>

            <div className="modal-form-grid-2">
              <FormField label="Dami" required error={errors.quantity}>
                <Input
                  type="number"
                  step="0.01"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder="Hal. 50"
                />
              </FormField>

              <FormField label="Sukat o yunit">
                <Input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="Hal. ml, bote, dosis, kg"
                />
              </FormField>
            </div>

            <details className="farmer-form-more">
              <summary>Iba pang detalye (opsyonal)</summary>
              <div className="farmer-form-more-content">
                <div className="modal-form-grid-2">
                  <FormField label="Paubos na kapag umabot sa">
                    <Input
                      type="number"
                      step="0.01"
                      value={form.minimum_stock}
                      onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })}
                      placeholder="Hal. 10"
                    />
                  </FormField>

                  <FormField label="Presyo bawat yunit (₱)">
                    <Input
                      type="number"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: e.target.value })}
                      placeholder="Hal. 120"
                    />
                  </FormField>
                </div>

                <div className="modal-form-grid-2">
                  <FormField label="Petsa ng pagbili">
                    <Input
                      type="date"
                      value={form.purchase_date}
                      onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                    />
                  </FormField>

                  <FormField label="Petsa ng pag-expire">
                    <Input
                      type="date"
                      value={form.expiry_date}
                      onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                    />
                  </FormField>
                </div>

                <FormField label="Pinagbilhan">
                  <Input
                    value={form.supplier}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                    placeholder="Hal. tindahan ng agrikultura"
                  />
                </FormField>

                <FormField label="Tala">
                  <textarea
                    className="form-textarea"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Dagdag na detalye tungkol sa gamit..."
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
            {editing ? 'I-save ang Pagbabago' : 'I-save ang Stock'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Consume Modal ── */}
      <Modal open={consumeOpen} onClose={() => setConsumeOpen(false)} size="md">
        <ModalHeader title="Itala ang Nagamit sa Bukid o sa Alaga" onClose={() => setConsumeOpen(false)} />
        <ModalBody>
          {consumeItem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--color-surface-elevated, #F8FAFC)',
                  border: '1px solid var(--color-border, #E2E8F0)',
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-text-primary, #0F172A)' }}>
                  {consumeItem.name}
                </div>
                <div style={{ color: 'var(--color-text-secondary, #64748B)', marginTop: 3 }}>
                  Magagamit na stock:{' '}
                  <strong
                    style={{
                      color:
                        Number(consumeItem.quantity) <= Number(consumeItem.minimum_stock)
                            ? '#F59E0B'
                          : '#16A34A',
                    }}
                  >
                    {consumeItem.quantity} {consumeItem.unit}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <FormField
                  label="Dami ng Nagamit"
                  required
                  error={
                    consumeQty && Number(consumeQty) > Number(consumeItem.quantity)
                      ? `Lumalampas sa stock (${consumeItem.quantity} ${consumeItem.unit})`
                      : undefined
                  }
                >
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={consumeQty}
                    onChange={(e) => setConsumeQty(e.target.value)}
                    placeholder={`Max ${consumeItem.quantity}`}
                  />
                </FormField>

              </div>

              <FormField label="Ginamit Para sa Partikular na Kambing o Tupa (Opsyonal)">
                <select
                  className="form-select"
                  value={consumeAnimalId}
                  onChange={(e) => setConsumeAnimalId(e.target.value)}
                >
                  <option value="">-- Pangkalahatang Gamit sa Bukid (Hindi para sa partikular na alaga) --</option>
                  {activeAnimals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag_id} {a.name ? `(${a.name})` : ''} — {a.species === 'Goat' ? 'Kambing' : 'Tupa'}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Dahilan o Deskripsyon ng Paggamit">
                <textarea
                  className="form-textarea"
                  value={consumeReason}
                  onChange={(e) => setConsumeReason(e.target.value)}
                  placeholder="Hal. Pagpupurga, panggagamot, o pagwawasto ng stock..."
                  style={{ minHeight: 80 }}
                />
              </FormField>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConsumeOpen(false)}>
            Kanselahin
          </Button>
          <Button
            variant="danger"
            onClick={handleConsumeStock}
            loading={consumeSaving}
            leftIcon={<TrendingDown size={14} />}
          >
            Itala ang Nagamit
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Stock-In Modal ── */}
      <Modal open={stockInOpen} onClose={() => setStockInOpen(false)} size="md">
        <ModalHeader title="Dagdagan ang Stock (Stock In)" onClose={() => setStockInOpen(false)} />
        <ModalBody>
          {stockInItem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--color-surface-elevated, #F8FAFC)',
                  border: '1px solid var(--color-border, #E2E8F0)',
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-text-primary, #0F172A)' }}>
                  {stockInItem.name}
                </div>
                <div style={{ color: 'var(--color-text-secondary, #64748B)', marginTop: 3 }}>
                  Kasalukuyang stock: <strong>{stockInItem.quantity} {stockInItem.unit}</strong>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <FormField label="Dami na Idadagdag" required>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={stockInQty}
                    onChange={(e) => setStockInQty(e.target.value)}
                    placeholder="Hal. 20"
                  />
                </FormField>

                <FormField label="Kabuuang Halaga ng Bilihin (₱)">
                  <Input
                    type="number"
                    step="0.01"
                    value={stockInCost}
                    onChange={(e) => setStockInCost(e.target.value)}
                    placeholder="Opsyonal"
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <FormField label="Supplier">
                  <Input
                    value={stockInSupplier}
                    onChange={(e) => setStockInSupplier(e.target.value)}
                    placeholder="Supplier..."
                  />
                </FormField>

                <FormField label="Petsa Natanggap">
                  <Input
                    type="date"
                    value={stockInDate}
                    onChange={(e) => setStockInDate(e.target.value)}
                  />
                </FormField>
              </div>

              <FormField label="Mga Tala / Notes">
                <textarea
                  className="form-textarea"
                  value={stockInNotes}
                  onChange={(e) => setStockInNotes(e.target.value)}
                  placeholder="Numero ng resibo, batch number, atbp."
                  style={{ minHeight: 80 }}
                />
              </FormField>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setStockInOpen(false)}>
            Kanselahin
          </Button>
          <Button
            variant="primary"
            onClick={handleStockIn}
            loading={stockInSaving}
            leftIcon={<TrendingUp size={14} />}
          >
            Dagdagan ang Stock
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Remove Modal ── */}
      <Modal open={removeOpen} onClose={() => setRemoveOpen(false)} size="md">
        <ModalHeader title="Bawasan ang Stock (Spoilage / Loss)" onClose={() => setRemoveOpen(false)} />
        <ModalBody>
          {removeItem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--color-surface-elevated, #F8FAFC)',
                  border: '1px solid var(--color-border, #E2E8F0)',
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-text-primary, #0F172A)' }}>
                  {removeItem.name}
                </div>
                <div style={{ color: 'var(--color-text-secondary, #64748B)', marginTop: 3 }}>
                  Kasalukuyang stock: <strong>{removeItem.quantity} {removeItem.unit}</strong>
                </div>
              </div>

              <FormField label="Dami na Ibabawas" required>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={removeQty}
                  onChange={(e) => setRemoveQty(e.target.value)}
                />
              </FormField>

              <FormField label="Dahilan ng Pagbawas" required>
                <Select
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  options={[
                    { value: '', label: 'Pumili ng dahilan...' },
                    { value: 'Spoiled', label: 'Napanis / Nabulok (Spoiled)' },
                    { value: 'Expired', label: 'Nag-expire na (Expired)' },
                    { value: 'Damaged', label: 'Nasira (Damaged)' },
                    { value: 'Lost', label: 'Nawala (Lost)' },
                    { value: 'Incorrect stock count', label: 'Maling bilang sa imbentaryo' },
                    { value: 'Other', label: 'Iba pang dahilan' },
                  ]}
                />
              </FormField>

              <FormField label="Mga Tala / Notes">
                <textarea
                  className="form-textarea"
                  value={removeNotes}
                  onChange={(e) => setRemoveNotes(e.target.value)}
                  placeholder="Karagdagang paliwanag..."
                  style={{ minHeight: 80 }}
                />
              </FormField>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRemoveOpen(false)}>
            Kanselahin
          </Button>
          <Button
            variant="danger"
            onClick={handleRemove}
            loading={removeSaving}
            leftIcon={<PackageX size={14} />}
          >
            Kumpirmahin ang Pagbawas
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── History Modal ── */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} size="xl">
        <ModalHeader
          title={historyItem ? `Kasaysayan ng Stock — ${historyItem.name}` : 'Kasaysayan ng Stock'}
          onClose={() => setHistoryOpen(false)}
        />
        <ModalBody>
          {historyItem && (
            <div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {(() => {
                  const tots = itemTotals(historyItem.id, allTx);
                  return [
                    { label: 'Kasalukuyang Stock', value: `${historyItem.quantity} ${historyItem.unit}`, color: '#238B45' },
                    { label: 'Kabuuang Idinagdag', value: `+${tots.totalAdded} ${historyItem.unit}`, color: '#16A34A' },
                    { label: 'Kabuuang Nagamit', value: `−${tots.totalConsumed} ${historyItem.unit}`, color: '#EF4444' },
                    { label: 'Kabuuang Nabawas', value: `−${tots.totalRemoved} ${historyItem.unit}`, color: '#F59E0B' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      style={{
                        flex: '1 1 100px',
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: 'var(--color-surface-elevated, #F8FAFC)',
                        border: '1px solid var(--color-border, #E2E8F0)',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748B)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ));
                })()}
              </div>

              {historyTx.length === 0 ? (
                <EmptyState
                  icon={<History size={32} />}
                  title="Walang naitalang kasaysayan"
                  description="Lalabas dito ang bawat galaw ng stock (pagdagdag, paggamit, o pagbawas)."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Petsa</th>
                        <th>Uri</th>
                        <th>Dami</th>
                        <th>Dati</th>
                        <th>Bago</th>
                        <th>Dahilan</th>
                        <th>Mga Tala</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyTx.map((t) => (
                        <tr key={t.id}>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)', whiteSpace: 'nowrap' }}>
                            {new Date(t.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td>
                            <Badge variant={txSign(t.type) === '+' ? 'success' : 'danger'} size="sm">
                              {txLabel(t.type)}
                            </Badge>
                          </td>
                          <td style={{ fontWeight: 700, color: txColor(t.type) }}>
                            {txSign(t.type)}{t.quantity} {t.unit}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)' }}>{t.previous_stock} {t.unit}</td>
                          <td style={{ fontSize: 12, fontWeight: 600 }}>{t.new_stock} {t.unit}</td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748B)', maxWidth: 160 }}>{t.reason ?? '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748B)', maxWidth: 160 }}>{t.notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setHistoryOpen(false)}>
            Isara
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="I-archive ang item?"
        message={`Itatago ang ${confirmDelete?.name} sa active inventory. Mananatili ang mga stock transaction at maaari itong ibalik mula sa Archived Records.`}
        confirmLabel="I-archive"
        cancelLabel="Huwag Muna"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
