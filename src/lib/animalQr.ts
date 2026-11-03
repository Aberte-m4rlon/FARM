import type { Animal } from '../types';

export function buildAnimalEartagNumber(animal: Pick<Animal, 'tag_id'>): string {
  const tagId = String(animal.tag_id ?? '').trim();
  const digits = tagId.replace(/[^0-9]/g, '');
  if (!digits) return tagId || '001';
  return String(Number.parseInt(digits, 10)).padStart(3, '0');
}

export function buildAnimalQrPayload(animal: Pick<Animal, 'public_qr_token'>): string {
  if (!animal.public_qr_token) return '';
  const origin = typeof window === 'undefined' ? 'https://alpasfarm.site' : window.location.origin;
  return new URL(`/public/${encodeURIComponent(animal.public_qr_token)}`, origin).toString();
}
