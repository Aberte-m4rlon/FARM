import type {
  Animal,
  WeightRecord,
  Settings,
  BreedingRecord,
} from '../types';
export function monthsSince(dateStr: string): number {
  const birth = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
}

export function daysBetween(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function ageLabel(dateOfBirth: string | null): string {
  if (!dateOfBirth) return 'Unknown';
  const months = monthsSince(dateOfBirth);
  if (months < 0) return 'Unknown';
  if (months < 1) return 'Less than 1 month';
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} ${remMonths === 1 ? 'month' : 'months'}`;
  if (remMonths === 0) return `${years} ${years === 1 ? 'year' : 'years'}`;
  return `${years} ${years === 1 ? 'year' : 'years'} ${remMonths} ${remMonths === 1 ? 'month' : 'months'}`;
}

export interface GrowthPrediction {
  currentWeight: number;
  previousWeight: number | null;
  weightChange: number | null;
  dailyGain: number | null;
  trend: 'Good' | 'Slow' | 'Stable' | 'Declining' | 'Insufficient';
  averageDailyGain: number | null;
  projectedWeight30: number | null;
  daysToTarget: number | null;
  marketReadyDate: string | null;
  enoughData: boolean;
}

export function calculateGrowth(
  records: WeightRecord[],
  targetWeight: number = 40,
): GrowthPrediction {
  const sorted = [...records].sort(
    (a, b) => new Date(a.record_date).getTime() - new Date(b.record_date).getTime(),
  );

  if (sorted.length === 0) {
    return {
      currentWeight: 0,
      previousWeight: null,
      weightChange: null,
      dailyGain: null,
      trend: 'Insufficient',
      averageDailyGain: null,
      projectedWeight30: null,
      daysToTarget: null,
      marketReadyDate: null,
      enoughData: false,
    };
  }

  const latest = sorted[sorted.length - 1];
  const currentWeight = Number(latest.weight_kg);
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const previousWeight = previous ? Number(previous.weight_kg) : null;
  const weightChange = previousWeight !== null ? +(currentWeight - previousWeight).toFixed(2) : null;

  let dailyGain: number | null = null;
  if (previous) {
    const days = daysBetween(previous.record_date, latest.record_date);
    if (days > 0) {
      dailyGain = +((currentWeight - Number(previous.weight_kg)) / days).toFixed(4);
    }
  }

  // Average daily gain across all records
  let averageDailyGain: number | null = null;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalDays = daysBetween(first.record_date, last.record_date);
    if (totalDays > 0) {
      averageDailyGain = +(
        (Number(last.weight_kg) - Number(first.weight_kg)) / totalDays
      ).toFixed(4);
    }
  }

  let trend: GrowthPrediction['trend'] = 'Stable';
  if (dailyGain === null) {
    trend = 'Insufficient';
  } else if (dailyGain > 0.15) {
    trend = 'Good';
  } else if (dailyGain > 0.03) {
    trend = 'Slow';
  } else if (dailyGain < 0) {
    trend = 'Declining';
  }

  const projectedWeight30 =
    averageDailyGain !== null ? +(currentWeight + averageDailyGain * 30).toFixed(2) : null;

  let daysToTarget: number | null = null;
  let marketReadyDate: string | null = null;
  if (averageDailyGain !== null && averageDailyGain > 0 && currentWeight < targetWeight) {
    daysToTarget = Math.ceil((targetWeight - currentWeight) / averageDailyGain);
    const d = new Date();
    d.setDate(d.getDate() + daysToTarget);
    marketReadyDate = d.toISOString().split('T')[0];
  }

  return {
    currentWeight,
    previousWeight,
    weightChange,
    dailyGain,
    trend,
    averageDailyGain,
    projectedWeight30,
    daysToTarget,
    marketReadyDate,
    enoughData: sorted.length >= 2,
  };
}

export function calculateKiddingDate(
  matingDate: string,
  gestationDays: number = 150,
): string {
  const d = new Date(matingDate);
  d.setDate(d.getDate() + gestationDays);
  return d.toISOString().split('T')[0];
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface InventoryStatus {
  status: 'OK' | 'Low Stock' | 'Out of Stock' | 'Expiring Soon' | 'Expired';
  daysToExpiry: number | null;
  label: string;
  color: 'green' | 'orange' | 'red' | 'blue' | 'gray';
}

export function inventoryStatus(
  item: { quantity: number; minimum_stock: number; expiry_date: string | null },
  warningDays: number = 15,
): InventoryStatus {
  const qty = Number(item.quantity);
  const min = Number(item.minimum_stock);

  let daysToExpiry: number | null = null;
  if (item.expiry_date) {
    daysToExpiry = daysUntil(item.expiry_date);
  }

  if (daysToExpiry !== null && daysToExpiry < 0) {
    return { status: 'Expired', daysToExpiry, label: 'Expired', color: 'red' };
  }
  if (qty <= 0) {
    return { status: 'Out of Stock', daysToExpiry, label: 'Out of stock', color: 'red' };
  }
  if (daysToExpiry !== null && daysToExpiry <= warningDays) {
    return {
      status: 'Expiring Soon',
      daysToExpiry,
      label: `Expires in ${daysToExpiry} ${daysToExpiry === 1 ? 'day' : 'days'}`,
      color: 'orange',
    };
  }
  if (qty <= min) {
    return { status: 'Low Stock', daysToExpiry, label: 'Low stock', color: 'orange' };
  }
  return { status: 'OK', daysToExpiry, label: 'In stock', color: 'green' };
}

export function vaccinationStatusFromDue(
  nextDueDate: string | null,
  dueDays: number = 30,
): 'Up to Date' | 'Due Soon' | 'Overdue' | 'None' {
  if (!nextDueDate) return 'None';
  const days = daysUntil(nextDueDate);
  if (days < 0) return 'Overdue';
  if (days <= dueDays) return 'Due Soon';
  return 'Up to Date';
}

export interface BreedingAssessment {
  recommendation: 'Ready' | 'Not Ready' | 'Monitor';
  reasons: string[];
}

export function assessBreedingReadiness(
  animal: Animal,
  settings: Settings,
  lastMating: BreedingRecord | null,
): BreedingAssessment {
  const reasons: string[] = [];
  const minAge = settings?.breeding_min_age_months ?? 8;
  const minWeight = settings?.breeding_min_weight_kg ?? 25;
  const gestationDays = settings?.gestation_days ?? 150;

  // 1. Check if archived or inactive
  if (animal.archived) {
    return { recommendation: 'Not Ready', reasons: ['Animal is archived or inactive.'] };
  }

  // 2. Female-specific checks (Does / Ewes / Dams)
  if (animal.sex === 'Female') {
    if (animal.breeding_status === 'Pregnant') {
      return { recommendation: 'Not Ready', reasons: ['Currently pregnant (in active gestation).'] };
    }

    let ready = true;

    if (animal.date_of_birth) {
      const ageMonths = monthsSince(animal.date_of_birth);
      if (ageMonths < minAge) {
        reasons.push(`Too young (${ageMonths} mos, minimum ${minAge} mos required)`);
        ready = false;
      }
    } else {
      reasons.push('Walang petsa ng kapanganakan para masuri ang edad.');
      ready = false;
    }

    if (animal.weight_kg === null || animal.weight_kg === undefined) {
      reasons.push('Wala pang naitalang timbang para masuri ang breeding readiness.');
      ready = false;
    } else if (Number(animal.weight_kg) < minWeight) {
      reasons.push(
        `Underweight (${animal.weight_kg} kg, minimum ${minWeight} kg required)`,
      );
      ready = false;
    }

    if (lastMating) {
      const daysSinceMating = daysBetween(lastMating.mating_date, new Date().toISOString());
      if (daysSinceMating < gestationDays + 60 && lastMating.status === 'Pregnant') {
        reasons.push('Active pregnancy from recent mating record');
        ready = false;
      } else if (daysSinceMating < 60 && lastMating.status === 'Kidded') {
        reasons.push('Post-kidding recovery period (minimum 60 days rest)');
        ready = false;
      }
    }

    if (ready) {
      const ageMonths = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
      reasons.push(`Age and recorded weight meet the breeding criteria${ageMonths ? ` (${ageMonths} mos)` : ''}`);
      return { recommendation: 'Ready', reasons };
    }

    return { recommendation: 'Not Ready', reasons };
  }

  // 3. Male-specific checks (Bucks / Rams / Sires)
  if (animal.sex === 'Male') {
    let ready = true;

    // Check for castration or wether notes
    const notesLower = (animal.notes || '').toLowerCase();
    if (notesLower.includes('castrat') || notesLower.includes('wether')) {
      return { recommendation: 'Not Ready', reasons: ['Castrated / wether (incapable of breeding).'] };
    }

    if (animal.date_of_birth) {
      const ageMonths = monthsSince(animal.date_of_birth);
      if (ageMonths < minAge) {
        reasons.push(`Too young for service (${ageMonths} mos, minimum ${minAge} mos required)`);
        ready = false;
      }
    } else {
      reasons.push('Walang petsa ng kapanganakan para masuri ang edad.');
      ready = false;
    }

    if (animal.weight_kg === null || animal.weight_kg === undefined) {
      reasons.push('Wala pang naitalang timbang para masuri ang breeding readiness.');
      ready = false;
    } else if (Number(animal.weight_kg) < minWeight) {
      reasons.push(
        `Underweight for service (${animal.weight_kg} kg, minimum ${minWeight} kg required)`,
      );
      ready = false;
    }

    if (ready) {
      const ageMonths = animal.date_of_birth ? monthsSince(animal.date_of_birth) : null;
      reasons.push(`Age and recorded weight meet the breeding criteria${ageMonths ? ` (${ageMonths} mos)` : ''}`);
      return { recommendation: 'Ready', reasons };
    }

    return { recommendation: 'Not Ready', reasons };
  }

  return { recommendation: 'Not Ready', reasons: ['Unknown sex or unassigned status.'] };
}
