import type { Animal } from '../types';
import { resolveFarmAnimalQr as resolveDomainQr, type FarmQrResolution } from './gateDomain';

export type QrAnimalResolution = FarmQrResolution<Animal>;

export function resolveFarmAnimalQr(rawValue: string, farmId: string, farmAnimals: Animal[]): QrAnimalResolution {
  return resolveDomainQr(rawValue, farmId, farmAnimals);
}
