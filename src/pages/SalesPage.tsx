import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DollarSign,
  Scale,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  User,
  Phone,
  X,
  TrendingUp,
  Receipt,
  Info,
  Check,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useFarmData } from '../lib/useFarmData';
import {
  calculateSalesMetrics,
  calculatePricePerKg,
  recordAnimalSale,
} from '../lib/sales';
import type { AnimalSale, PaymentStatus } from '../types';
import { useToast } from '../components/ui/Toast';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { isAnimalActive } from '../lib/animalLifecycle';

export function SalesPage() {
  const { user, role } = useAuth();
  const isSuperAdmin = role === 'super_admin';
  const { animals, sales, refresh, loading } = useFarmData();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // Modal states
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [selectedSaleDetail, setSelectedSaleDetail] = useState<AnimalSale | null>(null);

  // Form states for selling
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>('');
  const [soldWeight, setSoldWeight] = useState<string>('');
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [buyerName, setBuyerName] = useState<string>('');
  const [buyerContact, setBuyerContact] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Bayad na');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [remainingBalanceInput, setRemainingBalanceInput] = useState<string>('');
  const [saleDate, setSaleDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');
  const [formStep, setFormStep] = useState<'input' | 'confirm'>('input');
  const [submitting, setSubmitting] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');

  // Check URL query parameter ?action=add to auto-open modal
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      resetForm();
      const requestedAnimalId = params.get('animalId') || '';
      const requestedAnimal = animals.find((animal) => animal.id === requestedAnimalId && isAnimalActive(animal));
      if (requestedAnimal) {
        setSelectedAnimalId(requestedAnimal.id);
        setSoldWeight(requestedAnimal.weight_kg ? String(requestedAnimal.weight_kg) : '');
      }
      setIsSellModalOpen(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, loading, animals, navigate, location.pathname]);

  // Active animals available for sale (belonging to current user and not archived/sold)
  const availableAnimals = useMemo(() => {
    return animals.filter(isAnimalActive);
  }, [animals]);

  // Selected animal object
  const selectedAnimal = useMemo(() => {
    return availableAnimals.find((a) => a.id === selectedAnimalId) || null;
  }, [availableAnimals, selectedAnimalId]);

  // Auto-calculated price per kg
  const calculatedPricePerKg = useMemo(() => {
    const p = parseFloat(sellingPrice);
    const w = parseFloat(soldWeight);
    return calculatePricePerKg(p, w);
  }, [sellingPrice, soldWeight]);

  // Calculated remaining balance in form
  const remainingBalance = useMemo(() => {
    const price = parseFloat(sellingPrice) || 0;
    if (paymentStatus === 'Bayad na') return 0;
    if (paymentStatus === 'Pending') return price;
    const enteredBalance = parseFloat(remainingBalanceInput);
    if (Number.isFinite(enteredBalance)) return enteredBalance;
    const received = parseFloat(amountReceived) || 0;
    return Math.max(0, price - received);
  }, [sellingPrice, amountReceived, paymentStatus, remainingBalanceInput]);

  // Summary Metrics
  const metrics = useMemo(() => {
    return calculateSalesMetrics(sales);
  }, [sales]);

  const salesAnalytics = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return {
        key,
        label: new Intl.DateTimeFormat('fil-PH', { month: 'short' }).format(date),
        count: 0,
        revenue: 0,
        received: 0,
      };
    });
    const monthly = new Map(months.map((month) => [month.key, month]));
    for (const sale of sales) {
      const key = String(sale.sale_date || '').slice(0, 7);
      const month = monthly.get(key);
      if (!month) continue;
      month.count += 1;
      month.revenue += Number(sale.selling_price || 0);
      month.received += Number(sale.amount_received || 0);
    }
    const maxMonthlyRevenue = Math.max(0, ...months.map((month) => month.revenue));
    const goats = sales.filter((sale) => sale.species === 'Goat');
    const sheep = sales.filter((sale) => sale.species === 'Sheep');
    const sumRevenue = (items: AnimalSale[]) => items.reduce((sum, sale) => sum + Number(sale.selling_price || 0), 0);
    const totalSpeciesCount = goats.length + sheep.length;

    return {
      months,
      maxMonthlyRevenue,
      goats: { count: goats.length, revenue: sumRevenue(goats), share: totalSpeciesCount ? goats.length / totalSpeciesCount * 100 : 0 },
      sheep: { count: sheep.length, revenue: sumRevenue(sheep), share: totalSpeciesCount ? sheep.length / totalSpeciesCount * 100 : 0 },
    };
  }, [sales]);

  const formatPeso = (value: number) => `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

  // Filtered sales records for the table
  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      // Search filter
      const matchesSearch =
        searchQuery === '' ||
        s.animal_tag_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.animal_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.buyer_name && s.buyer_name.toLowerCase().includes(searchQuery.toLowerCase()));

      // Species filter
      const matchesSpecies = speciesFilter === 'all' || s.species === speciesFilter;

      // Payment filter
      const matchesPayment = paymentFilter === 'all' || s.payment_status === paymentFilter;

      return matchesSearch && matchesSpecies && matchesPayment;
    });
  }, [sales, searchQuery, speciesFilter, paymentFilter]);

  // Reset selling form
  const resetForm = () => {
    setSelectedAnimalId('');
    setSoldWeight('');
    setSellingPrice('');
    setBuyerName('');
    setBuyerContact('');
    setPaymentStatus('Bayad na');
    setAmountReceived('');
    setRemainingBalanceInput('');
    setSaleDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setFormStep('input');
    setSubmitting(false);
  };

  const handleOpenModal = () => {
    resetForm();
    setIsSellModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsSellModalOpen(false);
    resetForm();
  };

  // Pre-validate before moving to confirmation step
  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnimal) {
      toast('Pumili muna ng kambing o tupa na ibebenta.', 'danger');
      return;
    }
    const weightNum = parseFloat(soldWeight);
    if (isNaN(weightNum) || weightNum <= 0) {
      toast('Kailangang timbangin muna ang kambing o tupa bago ito maibenta. Ilagay ang wastong timbang (kg).', 'danger');
      return;
    }
    const priceNum = parseFloat(sellingPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast('Ilagay ang wastong presyo ng pagbebenta (₱).', 'danger');
      return;
    }
    if (paymentStatus === 'May Kulang') {
      const balanceNum = parseFloat(remainingBalanceInput);
      if (!Number.isFinite(balanceNum) || balanceNum < 0 || balanceNum > priceNum) {
        toast('Ilagay ang wastong natitirang balanse (₱), mula 0 hanggang sa presyo ng benta.', 'danger');
        return;
      }
    }
    setFormStep('confirm');
  };

  // Submit and record sale
  const handleConfirmSale = async () => {
    if (!user || !selectedAnimal) return;
    setSubmitting(true);

    const weightNum = parseFloat(soldWeight);
    const priceNum = parseFloat(sellingPrice);
    const receivedNum = paymentStatus === 'Bayad na'
      ? priceNum
      : paymentStatus === 'Pending'
        ? 0
        : priceNum - parseFloat(remainingBalanceInput);

    const res = await recordAnimalSale({
      userId: user.id,
      isSuperAdmin,
      animal: selectedAnimal,
      soldWeight: weightNum,
      sellingPrice: priceNum,
      buyerName,
      buyerContact,
      paymentStatus,
      amountReceived: receivedNum,
      saleDate,
      notes,
    });

    setSubmitting(false);

    if (res.success) {
      toast('Na-record na ang bentahan. Ang alaga ay nailipat na sa Kasaysayan ng Pagbebenta.', 'success');
      handleCloseModal();
      await refresh();
    } else {
      toast('Hindi naitala ang benta. Suriin ang mga detalye at subukan muli.', 'danger');
    }
  };

  return (
    <div className="sales-page-container">
      {/* ── 3. & 4. Page Header & Primary Action ── */}
      <div className="sales-header">
        <div className="sales-header-left">
          <div className="sales-header-icon-box">
            <DollarSign size={24} />
          </div>
          <div>
            <h1 className="sales-header-title">
              Benta ng Kambing at Tupa
            </h1>
            <p className="sales-header-desc">
              Pamamahala sa pagbebenta ng kambing at tupa at kita ng bukid.
            </p>
          </div>
        </div>

        {/* Primary Action Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            onClick={handleOpenModal}
            leftIcon={<Plus size={16} />}
            style={{ fontWeight: 700 }}
          >
            Magbenta ng Kambing o Tupa
          </Button>
        </div>
      </div>

      {/* ── 5. Sales Summary Cards ── */}
      <div className="sales-stats-grid">
        {/* Card 1: Total Animals Sold */}
        <div className="sales-stat-card">
          <div className="sales-stat-top">
            <span className="sales-stat-label">Mga Nabentang Kambing at Tupa</span>
            <div className="sales-stat-icon-wrap">
              <CheckCircle2 size={17} />
            </div>
          </div>
          <div>
            <div className="sales-stat-value">
              {metrics.totalSold} <span style={{ fontSize: '15px', fontWeight: 600 }}>ulo</span>
            </div>
            <div className="sales-stat-subtext">Kabuuang bilang</div>
          </div>
        </div>

        {/* Card 2: Total Revenue */}
        <div className="sales-stat-card">
          <div className="sales-stat-top">
            <span className="sales-stat-label">Kabuuang Benta</span>
            <div className="sales-stat-icon-wrap">
              <TrendingUp size={17} />
            </div>
          </div>
          <div>
            <div className="sales-stat-value green">
              ₱{metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="sales-stat-subtext">Total na benta</div>
          </div>
        </div>

        {/* Card 3: Actual Money Received */}
        <div className="sales-stat-card">
          <div className="sales-stat-top">
            <span className="sales-stat-label">Aktwal na Natanggap</span>
            <div className="sales-stat-icon-wrap">
              <Receipt size={17} />
            </div>
          </div>
          <div>
            <div className="sales-stat-value green">
              ₱{metrics.totalReceived.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="sales-stat-subtext">Salaping natanggap</div>
          </div>
        </div>

        {/* Card 4: Total Weight Sold */}
        <div className="sales-stat-card">
          <div className="sales-stat-top">
            <span className="sales-stat-label">Kabuuang Timbang</span>
            <div className="sales-stat-icon-wrap">
              <Scale size={17} />
            </div>
          </div>
          <div>
            <div className="sales-stat-value">
              {metrics.totalWeight} <span style={{ fontSize: '15px', fontWeight: 600 }}>kg</span>
            </div>
            <div className="sales-stat-subtext">Timbang naibenta</div>
          </div>
        </div>

        {/* Card 5: Average Price per KG */}
        <div className="sales-stat-card">
          <div className="sales-stat-top">
            <span className="sales-stat-label">Average Presyo / Kilo</span>
            <div className="sales-stat-icon-wrap">
              <DollarSign size={17} />
            </div>
          </div>
          <div>
            <div className="sales-stat-value">
              ₱{metrics.avgPricePerKg.toFixed(2)}
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary, #475569)', marginLeft: 3 }}>
                /kg
              </span>
            </div>
            <div className="sales-stat-subtext">Average price</div>
          </div>
        </div>
      </div>

      {/* Outstanding Balance Alert Card */}
      {metrics.totalRemainingBalance > 0 && (
        <div className="sales-balance-alert">
          <div className="sales-balance-text">
            <AlertCircle size={20} color="#D97706" style={{ flexShrink: 0 }} />
            <div>
              <strong>Paalala sa Balanse: </strong>
              May natitirang kabuuang balanse na <strong>₱{metrics.totalRemainingBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> na kailangan pang kubrahin.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaymentFilter('May Kulang')}
            style={{ borderColor: '#D97706', color: '#D97706', fontWeight: 700, flexShrink: 0 }}
          >
            I-filter ang May Kulang
          </Button>
        </div>
      )}

      <section className="sales-analytics" aria-labelledby="sales-analytics-title">
        <div className="sales-analytics-heading">
          <div>
            <h2 id="sales-analytics-title">Analytics ng benta</h2>
            <p>Aktuwal na tala sa huling 6 na buwan at paghahambing ng kambing at tupa.</p>
          </div>
          <span className="sales-analytics-period"><Calendar size={14} /> Huling 6 na buwan</span>
        </div>
        <div className="sales-analytics-grid">
          <div className="sales-analytics-panel">
            <div className="sales-analytics-panel-title">
              <div><strong>Benta bawat buwan</strong><span>Kabuuang halaga ng naitalang bentahan</span></div>
              <TrendingUp size={18} aria-hidden="true" />
            </div>
            {sales.length === 0 ? (
              <div className="sales-analytics-empty">Wala pang naitalang benta para maipakita ang trend.</div>
            ) : (
              <div className="sales-month-chart" role="img" aria-label="Bar chart ng kabuuang benta sa bawat buwan sa huling anim na buwan">
                {salesAnalytics.months.map((month) => {
                  const barHeight = salesAnalytics.maxMonthlyRevenue ? Math.max(month.revenue ? 8 : 3, month.revenue / salesAnalytics.maxMonthlyRevenue * 100) : 3;
                  return (
                    <div className="sales-month-column" key={month.key} title={`${month.label}: ${formatPeso(month.revenue)}, ${month.count} benta`}>
                      <strong className="sales-month-value">{month.revenue ? formatPeso(month.revenue) : '₱0'}</strong>
                      <div className="sales-month-track"><div className="sales-month-bar" style={{ height: `${barHeight}%` }} /></div>
                      <span>{month.label}</span>
                      <small>{month.count} {month.count === 1 ? 'benta' : 'benta'}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="sales-analytics-panel">
            <div className="sales-analytics-panel-title">
              <div><strong>Ayon sa hayop</strong><span>Bilang at kabuuang presyo ng nabenta</span></div>
              <Scale size={18} aria-hidden="true" />
            </div>
            {sales.length === 0 ? (
              <div className="sales-analytics-empty">Lalabas dito ang paghahambing kapag may naitalang benta.</div>
            ) : (
              <div className="sales-species-breakdown">
                {([
                  { key: 'goat', label: 'Kambing', color: 'var(--alpafarm-primary)', ...salesAnalytics.goats },
                  { key: 'sheep', label: 'Tupa', color: 'var(--alpafarm-leaf)', ...salesAnalytics.sheep },
                ]).map((item) => (
                  <div className="sales-species-row" key={item.key}>
                    <div className="sales-species-row-heading"><strong>{item.label}</strong><span>{item.count} ulo · {formatPeso(item.revenue)}</span></div>
                    <div className="sales-species-track" role="progressbar" aria-label={`Bahagi ng ${item.label} sa benta`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.share)}>
                      <div style={{ width: `${item.share}%`, background: item.color }} />
                    </div>
                  </div>
                ))}
                <div className="sales-analytics-note">Kasama sa paghahambing ang kambing at tupa lamang.</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 6. Search + Filter Section ── */}
      <Card variant="default" padding="sm">
        <CardContent>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              padding: '4px 6px',
            }}
          >
            {/* Search Input */}
            <div
              style={{
                position: 'relative',
                flex: '1 1 260px',
                minWidth: '220px',
              }}
            >
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted, #64748B)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Hanapin sa Tag ID, pangalan, bumibili..."
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 34px 0 36px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                  background: 'var(--input-bg, rgba(255, 255, 255, 0.85))',
                  color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                  fontSize: '13.5px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted, #64748B)',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Burahin ang paghahanap"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: '0 1 auto' }}>
              {/* Species Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary, #475569)' }}>
                  Uri:
                </label>
                <select
                  value={speciesFilter}
                  onChange={(e) => setSpeciesFilter(e.target.value)}
                  style={{
                    height: '40px',
                    padding: '0 28px 0 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                    background: 'var(--input-bg, rgba(255, 255, 255, 0.85))',
                    color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="all">Lahat ng Uri</option>
                  <option value="Goat">Kambing</option>
                  <option value="Sheep">Tupa</option>
                </select>
              </div>

              {/* Payment Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary, #475569)' }}>
                  Bayad:
                </label>
                <select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                  style={{
                    height: '40px',
                    padding: '0 28px 0 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                    background: 'var(--input-bg, rgba(255, 255, 255, 0.85))',
                    color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="all">Lahat ng Status</option>
                  <option value="Bayad na">Bayad na</option>
                  <option value="May Kulang">May Kulang</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>

              {/* Reset button */}
              {(searchQuery || speciesFilter !== 'all' || paymentFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setSpeciesFilter('all');
                    setPaymentFilter('all');
                  }}
                  style={{ fontSize: '12px', color: 'var(--color-text-muted, #64748B)' }}
                >
                  I-reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 7. & 8. Sales History Section ── */}
      <Card variant="default" padding="none">
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 800,
                color: 'var(--color-text-primary, #0F172A)',
              }}
            >
              Kasaysayan ng Pagbebenta
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 9px',
                borderRadius: '999px',
                background: 'var(--color-primary-soft, #EAF6ED)',
                color: 'var(--color-primary, #238B45)',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              {filteredSales.length}
            </span>
          </div>

          {filteredSales.length > 0 && (
            <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary, #475569)' }}>
              Kabuuang Benta:{' '}
              <strong style={{ color: 'var(--color-primary, #238B45)' }}>
                ₱{filteredSales.reduce((sum, s) => sum + s.selling_price, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </strong>
            </div>
          )}
        </div>

        <CardContent style={{ padding: 0 }}>
          {filteredSales.length === 0 ? (
            <div style={{ padding: '40px 20px' }}>
              <EmptyState
                icon={<Receipt size={36} />}
                title="Walang naitalang benta"
                description={
                  searchQuery || speciesFilter !== 'all' || paymentFilter !== 'all'
                    ? 'Walang tumutugma sa iyong filter o hinahanap.'
                    : 'Wala pang naibentang kambing o tupa. Kapag nagbenta ka ng kambing o tupa, lalabas dito ang detalye ng benta.'
                }
                actionLabel="Magbenta ng Kambing o Tupa"
                onAction={handleOpenModal}
              />
            </div>
          ) : (
            <div>
              {/* Desktop Table View */}
              <div className="desktop-sales-table table-wrap" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Kambing / Tupa</th>
                      <th>Timbang</th>
                      <th>Presyo</th>
                      <th>Presyo/Kilo</th>
                      <th>Bayad</th>
                      <th>Petsa</th>
                      <th style={{ textAlign: 'right' }}>Aksyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <div style={{ fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                            {sale.animal_tag_id}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #475569)', marginTop: 2 }}>
                            {sale.animal_name} • {sale.species === 'Goat' ? 'Kambing' : 'Tupa'}
                          </div>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--color-text-primary, #0F172A)' }}>
                          {sale.sold_weight} kg
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--color-primary, #238B45)' }}>
                          ₱{sale.selling_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ fontSize: '12.5px', color: 'var(--color-text-secondary, #475569)' }}>
                          {sale.price_per_kg ? `₱${sale.price_per_kg.toFixed(2)}/kg` : '—'}
                        </td>
                        <td>
                          {sale.payment_status === 'Bayad na' && (
                            <span className="sale-badge-paid">
                              <CheckCircle2 size={12} />
                              Bayad na
                            </span>
                          )}
                          {sale.payment_status === 'May Kulang' && (
                            <span className="sale-badge-partial">
                              <Clock size={12} />
                              Kulang: ₱{sale.remaining_balance.toLocaleString()}
                            </span>
                          )}
                          {sale.payment_status === 'Pending' && (
                            <span className="sale-badge-pending">
                              <AlertCircle size={12} />
                              Pending
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '12.5px', color: 'var(--color-text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                          {new Date(sale.sale_date).toLocaleDateString('fil-PH', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedSaleDetail(sale)}
                            style={{ fontSize: '12px', padding: '4px 10px', height: '30px' }}
                          >
                            Tingnan
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards View */}
              <div className="mobile-sales-cards">
                {filteredSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="mobile-sale-card"
                    onClick={() => setSelectedSaleDetail(sale)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-primary, #0F172A)' }}>
                          {sale.animal_tag_id}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #475569)', marginTop: 2 }}>
                          {sale.animal_name} • {sale.species === 'Goat' ? 'Kambing' : 'Tupa'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-primary, #238B45)' }}>
                          ₱{sale.selling_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #475569)', marginTop: 2 }}>
                          {sale.sold_weight} kg
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        paddingTop: 8,
                        borderTop: '1px dashed var(--color-border, rgba(35, 139, 69, 0.12))',
                        fontSize: '12px',
                        color: 'var(--color-text-secondary, #475569)',
                      }}
                    >
                      <div>
                        <span>Presyo/kg: </span>
                        <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                          {sale.price_per_kg ? `₱${sale.price_per_kg.toFixed(2)}/kg` : '—'}
                        </strong>
                      </div>
                      <div>
                        <span>Petsa: </span>
                        <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                          {sale.sale_date}
                        </strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 4 }}>
                      <div>
                        {sale.payment_status === 'Bayad na' && (
                          <span className="sale-badge-paid">
                            <CheckCircle2 size={11} />
                            Bayad na
                          </span>
                        )}
                        {sale.payment_status === 'May Kulang' && (
                          <span className="sale-badge-partial">
                            <Clock size={11} />
                            Kulang: ₱{sale.remaining_balance.toLocaleString()}
                          </span>
                        )}
                        {sale.payment_status === 'Pending' && (
                          <span className="sale-badge-pending">
                            <AlertCircle size={11} />
                            Pending
                          </span>
                        )}
                      </div>

                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary, #238B45)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Tingnan ang detalye &rarr;
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 9. SELLING FORM MODAL (+ Magbenta ng Kambing o Tupa) ── */}
      <Modal
        open={isSellModalOpen}
        onClose={handleCloseModal}
        size="lg"
      >
        <ModalHeader
          title={formStep === 'input' ? 'Magbenta ng Kambing o Tupa' : 'Kumpirmahin ang Pagbebenta'}
          subtitle={
            formStep === 'input'
              ? 'Itala ang pagbebenta ng kambing o tupa kasama ang aktwal na timbang bago ibenta.'
              : 'Suriin ang mga detalye bago opisyal na i-save ang benta sa database.'
          }
          icon={<DollarSign size={20} />}
          onClose={handleCloseModal}
        />
        <ModalBody>
          {formStep === 'input' ? (
            <form id="sellForm" onSubmit={handleProceedToConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Field 1: Select Animal */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--color-text-primary, #0F172A)',
                    marginBottom: 6,
                  }}
                >
                  Pumili ng Kambing o Tupa na Ibebenta <span style={{ color: 'var(--color-danger, #EF4444)' }}>*</span>
                </label>
                <select
                  value={selectedAnimalId}
                  onChange={(e) => {
                    setSelectedAnimalId(e.target.value);
                    const a = availableAnimals.find((x) => x.id === e.target.value);
                    if (a && a.weight_kg) {
                      setSoldWeight(String(a.weight_kg));
                    } else {
                      setSoldWeight('');
                    }
                  }}
                  required
                  style={{
                    width: '100%',
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                    background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                    color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                    fontSize: '13.5px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">-- Pumili sa aktibong mga kambing at tupa --</option>
                  {availableAnimals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag_id} — {a.name || 'Walang pangalan'} ({a.species === 'Goat' ? 'Kambing' : 'Tupa'})
                      {a.weight_kg ? ` [Huling timbang: ${a.weight_kg}kg]` : ''}
                    </option>
                  ))}
                </select>
                {availableAnimals.length === 0 && (
                  <p style={{ fontSize: '12px', color: '#D97706', marginTop: 4 }}>
                    Walang aktibong kambing o tupa na magagamit para ibenta sa kasalukuyan.
                  </p>
                )}
              </div>

              {/* Animal Preview Box */}
              {selectedAnimal && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'var(--color-primary-soft, #EAF6ED)',
                    border: '1px solid rgba(35, 139, 69, 0.20)',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-primary, #238B45)' }}>
                    {selectedAnimal.tag_id} ({selectedAnimal.name || (selectedAnimal.species === 'Sheep' ? 'Tupa' : 'Kambing')})
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: 8,
                      fontSize: '12px',
                      color: 'var(--color-text-secondary, #475569)',
                      marginTop: 6,
                    }}
                  >
                    <div>Uri: <strong>{selectedAnimal.species === 'Goat' ? 'Kambing' : 'Tupa'}</strong></div>
                    <div>Kasarian: <strong>{selectedAnimal.sex === 'Female' ? 'Babae' : 'Lalaki'}</strong></div>
                    <div>Breed: <strong>{selectedAnimal.breed || 'N/A'}</strong></div>
                    <div>Huling Timbang: <strong>{selectedAnimal.weight_kg ? `${selectedAnimal.weight_kg} kg` : 'Wala pa'}</strong></div>
                  </div>
                </div>
              )}

              {/* Field 2: Weight Before Sale (MANDATORY) */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'var(--color-surface, #FFFFFF)',
                  border: '1px solid var(--color-border, rgba(35, 139, 69, 0.15))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--color-text-primary, #0F172A)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Scale size={15} color="var(--color-primary, #238B45)" />
                    Timbang Bago Ibenta (kg) <span style={{ color: 'var(--color-danger, #EF4444)' }}>*</span>
                  </label>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      color: 'var(--color-primary, #238B45)',
                      background: 'var(--color-primary-soft, #EAF6ED)',
                      padding: '2px 7px',
                      borderRadius: '6px',
                    }}
                  >
                    REQUIRED
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    placeholder="Halimbawa: 45.5"
                    value={soldWeight}
                    onChange={(e) => setSoldWeight(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      height: '42px',
                      padding: '0 40px 0 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                      background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                      color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                      fontSize: '14px',
                      fontWeight: 700,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--color-text-muted, #64748B)',
                    }}
                  >
                    kg
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--color-text-secondary, #475569)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Info size={13} color="var(--color-primary, #238B45)" style={{ flexShrink: 0 }} />
                  Kailangang timbangin muna ang kambing o tupa bago ito maibenta.
                </p>
              </div>

              {/* Field 3: Selling Price (MANDATORY) */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'var(--color-surface, #FFFFFF)',
                  border: '1px solid var(--color-border, rgba(35, 139, 69, 0.15))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--color-text-primary, #0F172A)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <DollarSign size={15} color="var(--color-primary, #238B45)" />
                    Presyo ng Pagbebenta (₱) <span style={{ color: 'var(--color-danger, #EF4444)' }}>*</span>
                  </label>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      color: 'var(--color-primary, #238B45)',
                      background: 'var(--color-primary-soft, #EAF6ED)',
                      padding: '2px 7px',
                      borderRadius: '6px',
                    }}
                  >
                    REQUIRED
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '14px',
                      fontWeight: 800,
                      color: 'var(--color-text-muted, #64748B)',
                    }}
                  >
                    ₱
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="Halimbawa: 6500"
                    value={sellingPrice}
                    onChange={(e) => {
                      const nextPrice = e.target.value;
                      setSellingPrice(nextPrice);
                      if (paymentStatus === 'Bayad na') {
                        setAmountReceived(nextPrice);
                        setRemainingBalanceInput('0');
                      } else if (paymentStatus === 'May Kulang') {
                        const nextPriceNum = parseFloat(nextPrice) || 0;
                        const enteredBalance = parseFloat(remainingBalanceInput);
                        const nextBalance = Number.isFinite(enteredBalance)
                          ? enteredBalance
                          : Math.max(0, nextPriceNum - (parseFloat(amountReceived) || 0));
                        setRemainingBalanceInput(nextPrice ? String(nextBalance) : '');
                        setAmountReceived(nextPrice ? String(nextPriceNum - nextBalance) : amountReceived);
                      }
                    }}
                    required
                    style={{
                      width: '100%',
                      height: '42px',
                      padding: '0 12px 0 30px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                      background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                      color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                      fontSize: '14px',
                      fontWeight: 700,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Auto Calculated Reference Price per KG */}
                {calculatedPricePerKg !== null && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'var(--color-primary-soft, #EAF6ED)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Reference kalkulasyon:</span>
                    <strong style={{ color: 'var(--color-primary, #238B45)' }}>
                      ₱{calculatedPricePerKg.toFixed(2)} bawat kilo
                    </strong>
                  </div>
                )}
              </div>

              {/* Field 4: Buyer Info (Optional) */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--color-text-primary, #0F172A)',
                    marginBottom: 8,
                  }}
                >
                  Impormasyon ng Bumibili (Opsyonal)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
                      Pangalan ng Bumibili
                    </label>
                    <div style={{ position: 'relative' }}>
                      <User size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted, #64748B)' }} />
                      <input
                        type="text"
                        placeholder="Hal. Juan Dela Cruz"
                        value={buyerName}
                        onChange={(e) => setBuyerName(e.target.value)}
                        style={{
                          width: '100%',
                          height: '38px',
                          padding: '0 10px 0 32px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                          background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                          color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
                      Contact Number
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Phone size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted, #64748B)' }} />
                      <input
                        type="text"
                        placeholder="0917-xxx-xxxx"
                        value={buyerContact}
                        onChange={(e) => setBuyerContact(e.target.value)}
                        style={{
                          width: '100%',
                          height: '38px',
                          padding: '0 10px 0 32px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                          background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                          color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Field 5: Payment Status & Tracking */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--color-text-primary, #0F172A)',
                    marginBottom: 8,
                  }}
                >
                  Katayuan ng Bayad
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(['Bayad na', 'May Kulang', 'Pending'] as PaymentStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setPaymentStatus(st);
                        if (st === 'Bayad na') {
                          setAmountReceived(sellingPrice);
                          setRemainingBalanceInput('0');
                        } else if (st === 'Pending') {
                          setAmountReceived('0');
                          setRemainingBalanceInput(sellingPrice ? sellingPrice : '');
                        } else {
                          const priceNum = parseFloat(sellingPrice) || 0;
                          const receivedNum = parseFloat(amountReceived) || 0;
                          const nextReceived = receivedNum >= priceNum && priceNum > 0 ? 0 : receivedNum;
                          setAmountReceived(String(nextReceived));
                          setRemainingBalanceInput(sellingPrice ? String(priceNum - nextReceived) : '');
                        }
                      }}
                      style={{
                        padding: '9px 6px',
                        fontSize: '12px',
                        fontWeight: paymentStatus === st ? 800 : 600,
                        borderRadius: '10px',
                        border: paymentStatus === st ? '2px solid var(--color-primary, #238B45)' : '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                        background: paymentStatus === st ? 'var(--color-primary-soft, #EAF6ED)' : 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                        color: paymentStatus === st ? 'var(--color-primary, #238B45)' : 'var(--color-text-secondary, #475569)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {paymentStatus === 'May Kulang' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
                        Natanggap na Halaga (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={sellingPrice || undefined}
                        step="0.01"
                        placeholder="Hal. 3000"
                        value={amountReceived}
                        onChange={(e) => {
                          const nextReceived = e.target.value;
                          setAmountReceived(nextReceived);
                          const priceNum = parseFloat(sellingPrice) || 0;
                          setRemainingBalanceInput(
                            nextReceived !== '' && priceNum > 0
                              ? String(priceNum - (parseFloat(nextReceived) || 0))
                              : '',
                          );
                        }}
                        style={{
                          width: '100%',
                          height: '38px',
                          padding: '0 10px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                          background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                          color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                          fontSize: '13px',
                          fontWeight: 700,
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
                        Natitirang Balanse (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={sellingPrice || undefined}
                        step="0.01"
                        placeholder="Hal. 6000"
                        value={remainingBalanceInput}
                        onChange={(e) => {
                          const nextBalance = e.target.value;
                          setRemainingBalanceInput(nextBalance);
                          const priceNum = parseFloat(sellingPrice) || 0;
                          if (nextBalance !== '' && priceNum > 0) {
                            setAmountReceived(String(priceNum - (parseFloat(nextBalance) || 0)));
                          }
                        }}
                        style={{
                          width: '100%',
                          height: '38px',
                          padding: '0 10px',
                          borderRadius: '8px',
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.35)',
                          color: '#B45309',
                          fontSize: '13px',
                          fontWeight: 800,
                          boxSizing: 'border-box',
                          outline: 'none',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Field 6: Sale Date & Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--color-text-primary, #0F172A)',
                      marginBottom: 6,
                    }}
                  >
                    Petsa ng Pagbebenta
                  </label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    style={{
                      width: '100%',
                      height: '38px',
                      padding: '0 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                      background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                      color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--color-text-primary, #0F172A)',
                      marginBottom: 6,
                    }}
                  >
                    Karagdagang Tala (Opsyonal)
                  </label>
                  <input
                    type="text"
                    placeholder="Mga tala ukol sa benta..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{
                      width: '100%',
                      height: '38px',
                      padding: '0 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border, rgba(35, 139, 69, 0.20))',
                      background: 'var(--input-bg, rgba(255, 255, 255, 0.90))',
                      color: 'var(--input-text, var(--color-text-primary, #0F172A))',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </form>
          ) : (
            /* Confirmation Step */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '14px',
                  background: 'var(--color-primary-soft, #EAF6ED)',
                  border: '1px solid rgba(35, 139, 69, 0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Receipt size={18} color="var(--color-primary, #238B45)" />
                  <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-primary, #238B45)' }}>
                    Pangkalahatang Tala ng Benta
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Kambing / Tupa:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                      {selectedAnimal?.tag_id} ({selectedAnimal?.name || 'Walang pangalan'})
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Uri:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                      {selectedAnimal?.species === 'Goat' ? 'Kambing' : 'Tupa'}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Timbang Bago Ibenta:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{soldWeight} kg</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Presyo ng Pagbebenta:</span>
                    <strong style={{ color: 'var(--color-primary, #238B45)', fontSize: '15px' }}>
                      ₱{parseFloat(sellingPrice || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  {calculatedPricePerKg !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                      <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Presyo bawat Kilo:</span>
                      <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>₱{calculatedPricePerKg.toFixed(2)}/kg</strong>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Katayuan ng Bayad:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{paymentStatus}</strong>
                  </div>
                  {paymentStatus === 'May Kulang' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                      <span style={{ color: '#B45309', fontWeight: 700 }}>Natitirang Kulang:</span>
                      <strong style={{ color: '#B45309' }}>₱{remainingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(35, 139, 69, 0.12)' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Bumibili:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                      {buyerName ? `${buyerName} ${buyerContact ? `(${buyerContact})` : ''}` : 'Hindi tinukoy'}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Petsa ng Benta:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{saleDate}</strong>
                  </div>
                </div>
              </div>

              {/* Informative explanation */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontSize: '12px',
                  color: '#1E40AF',
                }}
              >
                <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Info size={14} color="#2563EB" />
                  Ano ang mangyayari pagkatapos kumpirmahin:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  <li>Awtomatikong mamarkahan ang alaga bilang <strong>'Nabenta'</strong>.</li>
                  <li>Aalisin ito sa aktibong bilang ng mga alaga sa bukid.</li>
                  <li>Itatabi ang timbang na ito sa kasaysayan ng timbang ng bukid.</li>
                  <li>Ligtas na mananatili ang lahat ng medikal at breeding records nito.</li>
                </ul>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {formStep === 'input' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
              <Button
                variant="secondary"
                onClick={handleCloseModal}
              >
                Kanselahin
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="sellForm"
                disabled={!selectedAnimalId || availableAnimals.length === 0}
                rightIcon={<ArrowRight size={15} />}
              >
                Ipatuloy sa Kumpirmasyon
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
              <Button
                variant="secondary"
                disabled={submitting}
                onClick={() => setFormStep('input')}
                leftIcon={<ArrowLeft size={15} />}
              >
                Bumalik
              </Button>
              <Button
                variant="primary"
                disabled={submitting}
                loading={submitting}
                onClick={handleConfirmSale}
                rightIcon={<Check size={15} />}
              >
                Kumpirmahin at I-save ang Benta
              </Button>
            </div>
          )}
        </ModalFooter>
      </Modal>

      {/* ── 10. SALE DETAIL / RECEIPT MODAL ── */}
      {selectedSaleDetail && (
        <Modal
          open={!!selectedSaleDetail}
          onClose={() => setSelectedSaleDetail(null)}
          size="md"
        >
          <ModalHeader
            title="Resibo ng Pagbebenta"
            subtitle={`Talaan ng transaksyon para sa ${selectedSaleDetail.animal_tag_id}`}
            icon={<Receipt size={20} />}
            onClose={() => setSelectedSaleDetail(null)}
          />
          <ModalBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Financial Highlight */}
              <div
                style={{
                  textAlign: 'center',
                  padding: '16px',
                  borderRadius: '14px',
                  background: 'var(--color-primary-soft, #EAF6ED)',
                  border: '1px solid rgba(35, 139, 69, 0.20)',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-secondary, #475569)' }}>
                  Halaga ng Benta
                </div>
                <div style={{ fontSize: '28px', fontWeight: 900, color: 'var(--color-primary, #238B45)', marginTop: 2 }}>
                  ₱{selectedSaleDetail.selling_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div style={{ marginTop: 6 }}>
                  {selectedSaleDetail.payment_status === 'Bayad na' && (
                    <span className="sale-badge-paid">
                      <CheckCircle2 size={12} />
                      Bayad na
                    </span>
                  )}
                  {selectedSaleDetail.payment_status === 'May Kulang' && (
                    <span className="sale-badge-partial">
                      <Clock size={12} />
                      Kulang: ₱{selectedSaleDetail.remaining_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  {selectedSaleDetail.payment_status === 'Pending' && (
                    <span className="sale-badge-pending">
                      <AlertCircle size={12} />
                      Pending
                    </span>
                  )}
                </div>
              </div>

              {/* Detail Items */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  fontSize: '13px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Tag ID:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{selectedSaleDetail.animal_tag_id}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Pangalan:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{selectedSaleDetail.animal_name}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Uri:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                    {selectedSaleDetail.species === 'Goat' ? 'Kambing' : 'Tupa'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Timbang Bago Ibenta:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{selectedSaleDetail.sold_weight} kg</strong>
                </div>
                {selectedSaleDetail.price_per_kg && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Presyo bawat Kilo:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>₱{selectedSaleDetail.price_per_kg.toFixed(2)}/kg</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Bumibili:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>
                    {selectedSaleDetail.buyer_name || 'Hindi tinukoy'}
                  </strong>
                </div>
                {selectedSaleDetail.buyer_contact && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Contact Number:</span>
                    <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{selectedSaleDetail.buyer_contact}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Halagang Natanggap:</span>
                  <strong style={{ color: 'var(--color-primary, #238B45)' }}>
                    ₱{selectedSaleDetail.amount_received.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
                {selectedSaleDetail.remaining_balance > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                    <span style={{ color: '#B45309', fontWeight: 700 }}>Natitirang Balanse:</span>
                    <strong style={{ color: '#B45309' }}>
                      ₱{selectedSaleDetail.remaining_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--color-border, rgba(35, 139, 69, 0.10))' }}>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>Petsa ng Benta:</span>
                  <strong style={{ color: 'var(--color-text-primary, #0F172A)' }}>{selectedSaleDetail.sale_date}</strong>
                </div>
                {selectedSaleDetail.notes && (
                  <div style={{ paddingTop: 4 }}>
                    <span style={{ color: 'var(--color-text-secondary, #475569)', display: 'block', marginBottom: 2 }}>Mga Tala:</span>
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        background: 'var(--input-bg, rgba(255, 255, 255, 0.85))',
                        border: '1px solid var(--color-border, rgba(35, 139, 69, 0.15))',
                        fontSize: '12px',
                        color: 'var(--color-text-primary, #0F172A)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {selectedSaleDetail.notes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              <Button
                variant="secondary"
                onClick={() => setSelectedSaleDetail(null)}
              >
                Isara
              </Button>
            </div>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

export default SalesPage;
