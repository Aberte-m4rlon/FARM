export interface AnimalLifecycleStatus {
  archived?: boolean | null;
  is_sold?: boolean | null;
  status?: string | null;
}

export function isAnimalActive(animal: AnimalLifecycleStatus): boolean {
  const status = String(animal.status ?? '').trim().toLowerCase();
  return animal.archived !== true
    && animal.is_sold !== true
    && !['archived', 'sold', 'deceased', 'transferred'].includes(status);
}

export function isAnimalDeceased(animal: AnimalLifecycleStatus): boolean {
  return String(animal.status ?? '').trim().toLowerCase() === 'deceased';
}
