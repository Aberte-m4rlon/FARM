import type { BreedingStatus } from '../types';

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isBreedingDue(
  status: BreedingStatus | string,
  expectedDueDate: string | null | undefined,
  today: string = localDateKey(),
): boolean {
  return status === 'Pregnant' && Boolean(expectedDueDate) && String(expectedDueDate).slice(0, 10) <= today;
}

export function formatBreedingDate(value: string | null | undefined, locale = 'fil-PH'): string {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
