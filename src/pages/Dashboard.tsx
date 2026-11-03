import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Bell, Camera, ChevronRight, Package, PawPrint, Syringe } from 'lucide-react';
import { useFarmData } from '../lib/useFarmData';
import { useGateMonitoringSummary } from '../lib/useGateMonitoringSummary';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { CameraGatewayStatusCard } from '../components/gate/CameraGatewayStatusCard';
import { isAnimalActive } from '../lib/animalLifecycle';

function SummaryCard({ label, value, icon, tone = 'primary', detail }: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: 'primary' | 'warning' | 'danger';
  detail?: string;
}) {
  const toneStyles = {
    primary: { color: 'var(--alpafarm-primary)', background: 'var(--alpafarm-primary-soft)' },
    warning: { color: 'var(--alpafarm-warning)', background: 'var(--alpafarm-warning-soft)' },
    danger: { color: 'var(--alpafarm-danger)', background: 'var(--alpafarm-danger-soft)' },
  }[tone];

  return (
    <Card padding="md" className="farmer-dashboard-card">
      <span className="farmer-dashboard-card-icon" style={toneStyles}>{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
      {detail && <small>{detail}</small>}
    </Card>
  );
}

function Reminder({ title, detail, to, onSelect }: {
  title: string;
  detail: string;
  to: string;
  onSelect: (path: string) => void;
}) {
  return (
    <button type="button" className="farmer-dashboard-reminder" onClick={() => onSelect(to)}>
      <span className="farmer-dashboard-reminder-copy"><strong>{title}</strong><span>{detail}</span></span>
      <span className="farmer-dashboard-reminder-action">Tingnan <ChevronRight size={16} /></span>
    </button>
  );
}

function daysUntil(date: string): number | null {
  const target = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function VaccinationPanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ label: string; value: number; color: string }>;
}) {
  return (
    <Card padding="md" className="farmer-dashboard-analytics-panel">
      <div className="farmer-dashboard-title"><span className="farmer-dashboard-analytics-icon">{icon}</span><h2>{title}</h2></div>
      <div className="farmer-dashboard-breakdown-list">
        {items.filter((item) => item.value > 0 && item.label !== 'Maayos ang bakuna').length === 0
          ? <p className="farmer-dashboard-no-reminders">Walang bakunang kailangang asikasuhin.</p>
          : items.filter((item) => item.value > 0 && item.label !== 'Maayos ang bakuna').map((item) => (
            <div className="farmer-dashboard-breakdown-row" key={item.label}>
              <div className="farmer-dashboard-breakdown-label"><span><i style={{ background: item.color }} />{item.label}</span><strong>Kailangang tingnan</strong></div>
            </div>
          ))}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const farmData = useFarmData();
  const gate = useGateMonitoringSummary();
  const navigate = useNavigate();

  const activeAnimals = useMemo(
    () => farmData.animals.filter(isAnimalActive),
    [farmData.animals],
  );
  const currentMortalityRecords = farmData.mortalityRecords.filter((record) => !record.corrected_at);
  const deceasedGoats = currentMortalityRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Goat').length;
  const deceasedSheep = currentMortalityRecords.filter((record) => farmData.animals.find((animal) => animal.id === record.animal_id)?.species === 'Sheep').length;
  const activeAnimalIds = new Set(activeAnimals.map((animal) => animal.id));
  const vaccinationBreakdown = [
    { label: 'Maayos ang bakuna', value: activeAnimals.filter((animal) => animal.vaccination_status === 'Up to Date').length, color: '#239a55' },
    { label: 'Malapit nang bakunahan', value: activeAnimals.filter((animal) => animal.vaccination_status === 'Due Soon').length, color: '#e6a323' },
    { label: 'Lampas na sa takdang bakuna', value: activeAnimals.filter((animal) => animal.vaccination_status === 'Overdue').length, color: '#d94d45' },
    { label: 'Walang tala ng bakuna', value: activeAnimals.filter((animal) => !animal.vaccination_status || animal.vaccination_status === 'None').length, color: '#89958c' },
  ];
  const lowStockItems = farmData.inventory.filter((item) => Number(item.quantity) <= Number(item.minimum_stock));
  const medicationAnimalIds = new Set(
    farmData.treatmentRecords
      .filter((record) => (record.status === 'Scheduled' || record.status === 'Ongoing') && activeAnimalIds.has(record.animal_id))
      .map((record) => record.animal_id),
  );
  const vaccinationAnimalIds = new Set(
    activeAnimals.filter((animal) => animal.vaccination_status === 'Due Soon' || animal.vaccination_status === 'Overdue').map((animal) => animal.id),
  );
  const healthAlertAnimalIds = new Set(
    farmData.healthAlerts
      .filter((alert) => !alert.is_resolved && alert.severity !== 'info' && activeAnimalIds.has(alert.animal_id))
      .map((alert) => alert.animal_id),
  );
  const openGateAlerts = gate.alerts.filter((alert) => alert.status === 'active' && activeAnimalIds.has(alert.animal_id));
  const attentionAnimalIds = new Set([
    ...healthAlertAnimalIds,
    ...openGateAlerts.filter((alert) => alert.alert_type === 'movement_observation').map((alert) => alert.animal_id),
  ]);
  const missingAnimalIds = new Set(
    gate.session && gate.session.status !== 'cancelled'
      ? (gate.summary?.unaccounted_animal_ids ?? []).filter((id) => activeAnimalIds.has(id))
      : [],
  );
  const missingCount = missingAnimalIds.size;
  const breedingReminders = activeAnimals.filter((animal) => {
    if (animal.breeding_status !== 'Pregnant' || !animal.expected_kidding_date) return false;
    const days = daysUntil(animal.expected_kidding_date);
    return days !== null && days >= 0 && days <= 30;
  });

  if (farmData.loading) {
    return <div className="farmer-dashboard-loading"><LoadingSpinner size="lg" text="Kinukuha ang tala ng bukid..." /></div>;
  }

  if (farmData.loadError) {
    return (
      <main className="dashboard-page-container farmer-dashboard">
        <header className="farmer-dashboard-heading"><div><h1>Kalagayan ng Bukid</h1><p>Tingnan ang mga kailangang asikasuhin para sa mga alaga.</p></div></header>
        <Card padding="md" className="farmer-dashboard-data-error" role="alert">
          <AlertTriangle size={20} />
          <div><strong>Hindi makuha ang tala ng bukid.</strong><span>Subukang muli para makita ang pinakabagong impormasyon.</span></div>
          <Button size="sm" variant="outline" onClick={() => { void farmData.refresh(); }}>Subukan muli</Button>
        </Card>
      </main>
    );
  }

  const statusMessage = activeAnimals.length === 0
    ? 'Wala pang kambing o tupa sa talaan ng iyong bukid.'
    : missingCount > 0
    ? 'May hayop na kailangang tingnan sa pasukan.'
    : attentionAnimalIds.size > 0
      ? 'May hayop na kailangang suriin.'
      : medicationAnimalIds.size > 0
        ? 'May nakatakdang gamutan.'
        : vaccinationAnimalIds.size > 0
          ? 'May bakunang kailangang ibigay.'
          : 'Maayos ang kalagayan ng mga alaga mo.';

  return (
    <main className="dashboard-page-container farmer-dashboard">
      <header className="farmer-dashboard-heading">
        <div>
          <h1>Kalagayan ng Bukid</h1>
          <p>Tingnan ang katayuan at mga kailangang asikasuhin para sa iyong mga alaga.</p>
        </div>
        <div className="farmer-dashboard-actions">
          <Button size="sm" variant="outline" onClick={() => navigate('/animals')} leftIcon={<PawPrint size={16} />}>Kambing at Tupa</Button>
        </div>
      </header>

      <section className="farmer-dashboard-grid" aria-label="Mahahalagang tala ng bukid">
        <SummaryCard label="Mga alaga sa bukid" value={activeAnimals.length} detail="Kambing at tupa" icon={<PawPrint size={18} />} />
        <SummaryCard label="Kalusugan" value={attentionAnimalIds.size ? 'Suriin' : 'Maayos'} detail={attentionAnimalIds.size ? 'May alagang dapat tingnan' : 'Walang kailangang tingnan'} icon={<AlertTriangle size={18} />} tone={attentionAnimalIds.size ? 'warning' : 'primary'} />
      </section>

      <section className="farmer-dashboard-grid" aria-label="Mga tala ng namatay na hayop">
        <SummaryCard label="Namatay na Kambing" value={deceasedGoats} icon={<PawPrint size={18} />} tone="danger" />
        <SummaryCard label="Namatay na Tupa" value={deceasedSheep} icon={<PawPrint size={18} />} tone="danger" />
        <SummaryCard label="Kabuuang namatay" value={currentMortalityRecords.length} icon={<Activity size={18} />} tone="danger" />
      </section>

      <section className="farmer-dashboard-analytics" aria-labelledby="farmer-dashboard-analytics-title">
        <VaccinationPanel title="Katayuan ng Bakuna" icon={<Syringe size={17} />} items={vaccinationBreakdown} />
      </section>

      <Card padding="md" className="farmer-dashboard-status" aria-live="polite">
        <div className="farmer-dashboard-title"><Activity size={19} /><h2>Kalagayan ngayon</h2></div>
        <p>{statusMessage}</p>
      </Card>

      <Card padding="md" className="farmer-dashboard-camera">
        <div className="farmer-dashboard-section-heading">
          <div className="farmer-dashboard-title"><Camera size={19} /><h2>Camera sa gate</h2></div>
        </div>
        <p className="farmer-dashboard-camera-detail">Tingnan ang mga hayop sa camera at ang pagpasok o paglabas sa gate.</p>
        <CameraGatewayStatusCard compact showCounts={false} />
        <Button variant="outline" size="sm" onClick={() => navigate('/livestock-monitoring')}>Buksan ang camera</Button>
      </Card>

      <Card padding="md" className="farmer-dashboard-reminders">
        <div className="farmer-dashboard-title"><Bell size={19} /><h2>Mga Paalala</h2></div>
        <div className="farmer-dashboard-reminder-list">
          {missingCount > 0 && <Reminder title="May hayop na hindi pa nakikita sa pasukan." detail="Tingnan ang tala ng camera sa gate." to="/livestock-monitoring" onSelect={(path) => navigate(path, { state: { cameraIntent: 'monitor' } })} />}
          {attentionAnimalIds.size > 0 && <Reminder title="May alagang kailangang tingnan." detail="Suriin ang kalusugan o galaw ng hayop." to="/daily-alerts" onSelect={navigate} />}
          {medicationAnimalIds.size > 0 && <Reminder title="May nakatakdang gamutan." detail="Tingnan kung anong gamot ang ibibigay." to="/treatments" onSelect={navigate} />}
          {vaccinationAnimalIds.size > 0 && <Reminder title="May bakunang kailangang ibigay." detail="Tingnan ang iskedyul ng bakuna." to="/vaccinations" onSelect={navigate} />}
          {lowStockItems.length > 0 && <Reminder title="May gamot o gamit na kaunti na lang." detail="Tingnan ang natitirang stock." to="/inventory" onSelect={navigate} />}
          {breedingReminders.length > 0 && <Reminder title="May inahing malapit nang manganak." detail="Ihanda ang malinis at tuyong kulungan." to="/breeding" onSelect={navigate} />}
          {missingCount === 0 && attentionAnimalIds.size === 0 && medicationAnimalIds.size === 0 && vaccinationAnimalIds.size === 0 && lowStockItems.length === 0 && breedingReminders.length === 0 && (
            <p className="farmer-dashboard-no-reminders"><Package size={18} /> Walang agarang paalala sa ngayon.</p>
          )}
        </div>
      </Card>
    </main>
  );
}
