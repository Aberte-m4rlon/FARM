import { supabase } from './supabase';
import { notificationService } from './notificationService';
import { isAnimalActive } from './animalLifecycle';
import type {
  Animal,
  WeightRecord,
  Vaccination,
  InventoryItem,
  BreedingRecord,
  Settings,
  Notification,
  Priority,
} from '../types';
import {
  inventoryStatus,
  vaccinationStatusFromDue,
  daysUntil,
  calculateGrowth,
  calculateKiddingDate,
  monthsSince,
  assessBreedingReadiness,
} from './analytics';
const DEFAULT_SETTINGS: Settings = {
  id: '',
  user_id: '',
  farm_name: 'AlpasFarm',
  target_weight_kg: 40,
  gestation_days: 150,
  expiry_warning_days: 15,
  vaccine_due_days: 30,
  breeding_min_age_months: 8,
  breeding_min_weight_kg: 25,
  created_at: '',
  updated_at: '',
};

export interface PriorityItem {
  id: string;
  severity: 'critical' | 'urgent' | 'attention' | 'upcoming' | 'routine';
  icon: string;
  title: string;
  description: string;
  link: string;
}

export interface SmartRecommendation {
  category: string;
  title: string;
  description: string;
  priority: Priority;
  severity_color: 'red' | 'orange' | 'yellow' | 'green' | 'blue';
  link: string;
}

export interface DailyAlert {
  id: string;
  type: 'Vaccination' | 'Breeding' | 'Weight' | 'Inventory';
  title: string;
  description: string;
  priority: Priority;
  dueLabel: string;
  link: string;
}

export function generateDailyAlerts(
  animals: Animal[],
  weightRecords: WeightRecord[],
  vaccinations: Vaccination[],
  inventory: InventoryItem[],
  breedingRecords: BreedingRecord[],
  settings: Settings = DEFAULT_SETTINGS,
): DailyAlert[] {
  const alerts: DailyAlert[] = [];
  const activeAnimals = animals.filter(isAnimalActive);
  const latestWeightByAnimal = new Map<string, WeightRecord>();

  for (const record of weightRecords) {
    const current = latestWeightByAnimal.get(record.animal_id);
    const candidateTime = new Date(record.record_date).getTime();
    const currentTime = current ? new Date(current.record_date).getTime() : Number.NEGATIVE_INFINITY;
    if (
      !current ||
      candidateTime > currentTime ||
      (!Number.isFinite(currentTime) && Number.isFinite(candidateTime))
    ) {
      latestWeightByAnimal.set(record.animal_id, record);
    }
  }

  activeAnimals.forEach((animal) => {
    if (animal.vaccination_status === 'Overdue') {
      alerts.push({
        id: `vacc-overdue-${animal.id}`,
        type: 'Vaccination',
        title: `${animal.name} — Lampas na sa schedule ng bakuna`,
        description: `Lampas na sa takdang petsa ang bakuna ni ${animal.name}. Mag-iskedyul ng follow-up na bakuna ayon sa tala ng hayop.`,
        priority: 'Critical',
        dueLabel: 'Kailangan ng Aksyon',
        link: '/vaccinations',
      });
    } else if (animal.vaccination_status === 'Due Soon') {
      alerts.push({
        id: `vacc-soon-${animal.id}`,
        type: 'Vaccination',
        title: `${animal.name} — Malapit na ang schedule ng bakuna`,
        description: `Nalalapit na ang takdang araw ng bakuna ni ${animal.name}. Suriin ang tala at magplano ng pagbabakuna.`,
        priority: 'Warning',
        dueLabel: 'Ngayong Linggo',
        link: '/vaccinations',
      });
    }

    const latestWeight = latestWeightByAnimal.get(animal.id);
    if (!latestWeight || daysUntil(latestWeight.record_date) < -30) {
      alerts.push({
        id: `weight-${animal.id}`,
        type: 'Weight',
        title: `${animal.name} — Oras na para timbangin muli`,
        description: `Mahigit isang buwan nang walang bagong tala ng timbang para kay ${animal.name}. Magtala muli kung kailangan para sa farm records.`,
        priority: 'Normal',
        dueLabel: 'Ngayong Linggo',
        link: `/animals/${animal.id}`,
      });
    }

    if (animal.breeding_status === 'Pregnant' && animal.expected_kidding_date) {
      const remaining = daysUntil(animal.expected_kidding_date);
      if (remaining >= 0 && remaining <= 30) {
        alerts.push({
          id: `kidding-${animal.id}`,
          type: 'Breeding',
          title: `${animal.name} — Malapit nang manganak`,
          description: `Inaasahang petsa ng panganganak: ${animal.expected_kidding_date}. Ihanda ang malinis at tuyong kulungan, bantayan ang kilos ng inahin, at maghanda sa panganganak.`,
          priority: remaining <= 7 ? 'Critical' : 'Warning',
          dueLabel: remaining <= 7 ? 'Kritikal na Araw' : `${remaining} araw`,
          link: `/animals/${animal.id}`,
        });
      }
    }
  });

  inventory.forEach((item) => {
    const status = inventoryStatus(item, settings.expiry_warning_days);
    if (status.status === 'Expired') {
      alerts.push({
        id: `inventory-${item.id}`,
        type: 'Inventory',
        title: `${item.name} — Nag-expire na ang stock`,
        description: `Paso o expired na ang gamit na ito. Huwag nang gagamitin sa kambing o tupa upang maiwasan ang pinsala, at itapon o palitan agad.`,
        priority: 'Critical',
        dueLabel: 'Aksyonan Agad',
        link: '/inventory',
      });
    } else if (status.status === 'Out of Stock') {
      alerts.push({
        id: `inventory-${item.id}`,
        type: 'Inventory',
        title: `${item.name} — Ubos na ang stock`,
        description: `Wala nang natitirang stock sa bodega. Mag-order o magdagdag agad upang hindi maantala ang pag-aalaga sa kawan.`,
        priority: 'Critical',
        dueLabel: 'Aksyonan Agad',
        link: '/inventory',
      });
    } else if (status.status === 'Expiring Soon') {
      alerts.push({
        id: `inventory-${item.id}`,
        type: 'Inventory',
        title: `${item.name} — Malapit nang mag-expire`,
        description: `Malapit nang mapaso ang stock na ito (${item.quantity} ${item.unit} ang natitira). Unahing gamitin o magplano ng bagong stock.`,
        priority: 'Warning',
        dueLabel: 'Malapit na',
        link: '/inventory',
      });
    } else if (status.status === 'Low Stock') {
      alerts.push({
        id: `inventory-${item.id}`,
        type: 'Inventory',
        title: `${item.name} — Mababa na ang stock`,
        description: `Mababa na sa minimum limit ang ${item.name} (${item.quantity} ${item.unit} na lamang). Mag-stock in na bago maubusan.`,
        priority: 'Warning',
        dueLabel: 'Malapit na',
        link: '/inventory',
      });
    }
  });

  const priorityOrder: Record<Priority, number> = { Critical: 0, Warning: 1, Normal: 2, Success: 3 };
  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[a.priority]);

  return alerts;
}

export function generateRecommendations(
  animals: Animal[],
  weightRecords: WeightRecord[],
  vaccinations: Vaccination[],
  inventory: InventoryItem[],
  breedingRecords: BreedingRecord[],
  settings: Settings = DEFAULT_SETTINGS,
): { recommendations: SmartRecommendation[]; priorities: PriorityItem[] } {
  const recs: SmartRecommendation[] = [];
  const priorities: PriorityItem[] = [];
  const activeAnimals = animals.filter(isAnimalActive);

  // 2. Overdue & due-soon vaccinations
  const overdueVacc = activeAnimals.filter((a) => a.vaccination_status === 'Overdue');
  const dueSoonVacc = activeAnimals.filter((a) => a.vaccination_status === 'Due Soon');

  if (overdueVacc.length > 0) {
    recs.push({
      category: 'Vaccination',
      title: `${overdueVacc.length} alaga ang lampas na sa iskedyul ng bakuna`,
      description: overdueVacc.map((a) => a.name).join(', '),
      priority: 'Critical',
      severity_color: 'red',
      link: '/vaccinations',
    });
    priorities.push({
      id: 'vacc-overdue',
      severity: 'urgent',
      icon: 'Syringe',
      title: `${overdueVacc.length} alaga ang lampas sa bakuna`,
      description: overdueVacc.map((a) => a.name).join(', '),
      link: '/vaccinations',
    });
  }
  if (dueSoonVacc.length > 0) {
    recs.push({
      category: 'Vaccination',
      title: `${dueSoonVacc.length} alaga ang may paparating na iskedyul ng bakuna`,
      description: dueSoonVacc.map((a) => a.name).join(', '),
      priority: 'Warning',
      severity_color: 'yellow',
      link: '/vaccinations',
    });
  }

  // 3. Kidding due soon
  const pregnantAnimals = activeAnimals.filter(
    (a) => a.breeding_status === 'Pregnant' && a.expected_kidding_date,
  );
  pregnantAnimals.forEach((a) => {
    const days = daysUntil(a.expected_kidding_date!);
    if (days >= 0 && days <= 30) {
      const urgency = days <= 3 ? 'critical' : days <= 7 ? 'urgent' : days <= 14 ? 'attention' : 'upcoming';
      recs.push({
        category: 'Breeding',
        title: `${a.name} — Manganganak sa loob ng ${days} ${days === 1 ? 'araw' : 'araw'}`,
        description: `Inaasahang petsa ng panganganak: ${a.expected_kidding_date}. Ihanda ang kulungan ng panganganak.`,
        priority: days <= 7 ? 'Critical' : 'Warning',
        severity_color: days <= 7 ? 'red' : 'orange',
        link: `/animals/${a.id}`,
      });
      priorities.push({
        id: `kidding-${a.id}`,
        severity: urgency,
        icon: 'Baby',
        title: `${a.name} — inaasahang manganganak sa ${days} araw`,
        description: `Takda: ${a.expected_kidding_date}`,
        link: `/animals/${a.id}`,
      });
    }
  });

  // 4. Inventory alerts
  const expiredItems = inventory.filter((i) => inventoryStatus(i, settings.expiry_warning_days).status === 'Expired');
  const expiringItems = inventory.filter(
    (i) => inventoryStatus(i, settings.expiry_warning_days).status === 'Expiring Soon',
  );
  const lowStockItems = inventory.filter(
    (i) => inventoryStatus(i, settings.expiry_warning_days).status === 'Low Stock',
  );
  const outOfStock = inventory.filter(
    (i) => inventoryStatus(i, settings.expiry_warning_days).status === 'Out of Stock',
  );

  if (expiredItems.length > 0) {
    recs.push({
      category: 'Inventory',
      title: `${expiredItems.length} gamit ang nag-expire na sa imbentaryo`,
      description: expiredItems.map((i) => i.name).join(', '),
      priority: 'Critical',
      severity_color: 'red',
      link: '/inventory',
    });
  }
  if (expiringItems.length > 0) {
    recs.push({
      category: 'Inventory',
      title: `${expiringItems.length} gamit ang malapit nang mag-expire`,
      description: expiringItems.map((i) => `${i.name} (${inventoryStatus(i, settings.expiry_warning_days).label})`).join(', '),
      priority: 'Warning',
      severity_color: 'orange',
      link: '/inventory',
    });
  }
  if (outOfStock.length > 0) {
    recs.push({
      category: 'Inventory',
      title: `${outOfStock.length} gamit ang ubos na sa imbentaryo`,
      description: outOfStock.map((i) => i.name).join(', '),
      priority: 'Critical',
      severity_color: 'red',
      link: '/inventory',
    });
    priorities.push({
      id: 'inv-out',
      severity: 'urgent',
      icon: 'PackageX',
      title: `${outOfStock.length} gamit ang ubos na sa stock`,
      description: outOfStock.map((i) => i.name).join(', '),
      link: '/inventory',
    });
  }
  if (lowStockItems.length > 0) {
    recs.push({
      category: 'Inventory',
      title: `${lowStockItems.length} gamit ang mababa na ang stock`,
      description: lowStockItems.map((i) => i.name).join(', '),
      priority: 'Warning',
      severity_color: 'orange',
      link: '/inventory',
    });
  }

  // 5. No recent weight records
  const animalsNoRecentWeight = activeAnimals.filter((a) => {
    const animalWeights = weightRecords.filter((w) => w.animal_id === a.id);
    if (animalWeights.length === 0) return true;
    const latest = animalWeights.sort(
      (x, y) => new Date(y.record_date).getTime() - new Date(x.record_date).getTime(),
    )[0];
    return daysUntil(latest.record_date) < -30;
  });
  if (animalsNoRecentWeight.length > 0) {
    recs.push({
      category: 'Weight',
      title: `${animalsNoRecentWeight.length} alaga ang kailangang timbangin muli`,
      description: 'Magtala ng bagong timbang upang mapanatili ang kasaysayan ng paglaki.',
      priority: 'Normal',
      severity_color: 'blue',
      link: '/animals',
    });
    priorities.push({
      id: 'weight-routine',
      severity: 'routine',
      icon: 'Scale',
      title: `${animalsNoRecentWeight.length} alaga ang dapat nang timbangin`,
      description: 'Mahigit 30 araw nang walang bagong timbang',
      link: '/animals',
    });
  }

  // 7. Declining weight
  activeAnimals.forEach((a) => {
    const animalWeights = weightRecords.filter((w) => w.animal_id === a.id);
    const growth = calculateGrowth(animalWeights, settings.target_weight_kg);
    if (growth.trend === 'Declining') {
      recs.push({
        category: 'Weight',
        title: `Bumababa ang timbang ni ${a.name}`,
        description: `Bumaba ang timbang sa pinakahuling tala. Suriin ang mga naitalang timbang at magtala muli kung kinakailangan.`,
        priority: 'Warning',
        severity_color: 'orange',
        link: `/animals/${a.id}`,
      });
      priorities.push({
        id: `decline-${a.id}`,
        severity: 'attention',
        icon: 'TrendingDown',
        title: `${a.name} — bumababa ang timbang`,
        description: 'Bumaba ang timbang sa pinakahuling rekord',
        link: `/animals/${a.id}`,
      });
    }
  });

  // 8. Breeding readiness
  const femalesReady = activeAnimals.filter((a) => {
    if (a.sex !== 'Female' || a.breeding_status === 'Pregnant') return false;
    const lastMating = breedingRecords
      .filter((b) => b.animal_id === a.id)
      .sort((x, y) => new Date(y.mating_date).getTime() - new Date(x.mating_date).getTime())[0] ?? null;
    return assessBreedingReadiness(a, settings, lastMating).recommendation === 'Ready';
  });
  if (femalesReady.length > 0) {
    recs.push({
      category: 'Breeding',
      title: `${femalesReady.length} inahin ang handa na sa pagpapalahi (breeding)`,
      description: femalesReady.map((a) => a.name).join(', '),
      priority: 'Normal',
      severity_color: 'green',
      link: '/breeding',
    });
    priorities.push({
      id: 'breeding-ready',
      severity: 'upcoming',
      icon: 'Heart',
      title: `${femalesReady.length} inahin ang handa na sa breeding`,
      description: 'Nasa wastong edad at timbang para sa pagpapalahi',
      link: '/breeding',
    });
  }

  // Sort priorities by severity
  const severityOrder: Record<string, number> = { critical: 0, urgent: 1, attention: 2, upcoming: 3, routine: 4 };
  priorities.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const priorityOrder: Record<Priority, number> = { Critical: 0, Warning: 1, Normal: 2, Success: 3 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return { recommendations: recs, priorities };
}

export async function createNotification(
  userId: string,
  type: Notification['type'],
  title: string,
  description: string | null,
  priority: Priority,
  link: string | null = null,
  eventKey?: string | null
): Promise<void> {
  await notificationService.dispatchNotification({
    userId,
    type,
    title,
    message: description || title,
    description,
    priority,
    link,
    eventKey,
  });
}

export { calculateKiddingDate, vaccinationStatusFromDue, monthsSince };
