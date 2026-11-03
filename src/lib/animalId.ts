import { supabase } from './supabase';
import { notificationService } from './notificationService';
import type { Animal, Species } from '../types';

/**
 * Returns standardized uppercase prefix based on species.
 */
export function getSpeciesPrefix(species: Species | string): 'GOAT' | 'SHEEP' {
  const norm = String(species || '').trim().toLowerCase();
  if (norm.includes('sheep') || norm.includes('tupa')) {
    return 'SHEEP';
  }
  return 'GOAT';
}

/**
 * Parses numeric suffix from a tag_id string given a target prefix.
 * e.g., "GOAT-001" -> 1, "goat-15" -> 15, "SHEEP-001" -> 1.
 */
export function parseAnimalNumber(tagId: string | null | undefined, targetPrefix: 'GOAT' | 'SHEEP'): number | null {
  if (!tagId || typeof tagId !== 'string') return null;
  const trimmed = tagId.trim();

  // Primary pattern: e.g. GOAT-001, GOAT_001, GOAT001
  const regex = new RegExp(`^${targetPrefix}[-_ ]?0*(\\d+)$`, 'i');
  const match = trimmed.match(regex);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    return isNaN(num) ? null : num;
  }

  // Generic fallback if tag starts with number
  const genericMatch = trimmed.match(/^(\d+)$/);
  if (genericMatch && genericMatch[1]) {
    const num = parseInt(genericMatch[1], 10);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Generates the next available candidate Animal ID based on active animals.
 * Reuses the lowest available released ID among active animals of the same species.
 * E.g., if GOAT-001 is active, GOAT-002 is sold/archived, and GOAT-003 is active,
 * this returns "GOAT-002" (NOT GOAT-004).
 * If no existing active animals exist, returns "GOAT-001" (or "SHEEP-001").
 */
export function generateNextAnimalId(
  species: Species | string,
  existingAnimals: Array<{ tag_id?: string | null; species?: string | null; archived?: boolean; status?: string; is_sold?: boolean }> = []
): string {
  const prefix = getSpeciesPrefix(species);
  const activeNumbers = new Set<number>();

  for (const animal of existingAnimals) {
    if (!animal.tag_id) continue;
    // Sold or archived animals release their visible tag ID for reuse!
    const isSoldOrArchived = Boolean(animal.archived || animal.status === 'Sold' || animal.is_sold);
    if (isSoldOrArchived) {
      continue;
    }

    const num = parseAnimalNumber(animal.tag_id, prefix);
    if (num !== null && num > 0) {
      activeNumbers.add(num);
    }
  }

  // Find lowest positive integer (1, 2, 3...) not currently used by an ACTIVE animal
  let candidateNum = 1;
  while (activeNumbers.has(candidateNum)) {
    candidateNum++;
  }

  return `${prefix}-${String(candidateNum).padStart(3, '0')}`;
}

/**
 * Queries Supabase to fetch all existing active tag_ids and calculate the next unique ID.
 * Excludes archived/sold animals so their IDs are available for reuse.
 */
export async function fetchNextUniqueAnimalId(
  species: Species | string,
  userId?: string | null
): Promise<string> {
  const prefix = getSpeciesPrefix(species);

  try {
    let query = supabase.from('animals').select('tag_id, species, archived').eq('archived', false);
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching animals for ID generation, fallback to defaults:', error.message);
      return `${prefix}-001`;
    }

    const nextId = generateNextAnimalId(species, data || []);
    return nextId;
  } catch (err) {
    console.error('Failed to query next animal ID:', err);
    return `${prefix}-001`;
  }
}

/**
 * Checks whether a specific tag_id is already registered by an ACTIVE animal in the user's farm.
 * Sold animals (archived = true) release their tag ID, allowing it to be reused.
 */
export async function isAnimalIdAvailable(
  tagId: string,
  excludeAnimalId?: string | null,
  userId?: string | null,
): Promise<boolean> {
  if (!tagId || !tagId.trim()) return false;
  try {
    let query = supabase
      .from('animals')
      .select('id')
      .ilike('tag_id', tagId.trim())
      .eq('archived', false); // Only active animals block ID availability!

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (excludeAnimalId) {
      query = query.neq('id', excludeAnimalId);
    }

    const { data, error } = await query.limit(1);
    if (error) {
      console.warn('Could not verify animal ID uniqueness:', error.message);
      return true;
    }

    return !data || data.length === 0;
  } catch {
    return true;
  }
}

export interface InsertAnimalOptions {
  maxRetries?: number;
  onAutoIncrement?: (newTagId: string) => void;
}

export interface SaveAnimalResult {
  data: Animal | null;
  error: Error | null;
  finalTagId: string;
  hadConflict: boolean;
}

/**
 * Inserts a new animal with automatic duplicate prevention and race-condition retries.
 * Tag IDs are unique per farm (user_id) among ACTIVE animals.
 */
export async function insertAnimalWithUniqueRetry(
  payload: Partial<Animal> & { species: Species; user_id?: string },
  options: InsertAnimalOptions = {}
): Promise<SaveAnimalResult> {
  const maxRetries = options.maxRetries ?? 5;
  const prefix = getSpeciesPrefix(payload.species);

  // 1. Fetch current DB state for active animals for this user
  let freshQuery = supabase.from('animals').select('tag_id, species, archived').eq('archived', false);
  if (payload.user_id) {
    freshQuery = freshQuery.eq('user_id', payload.user_id);
  }
  const { data: currentAnimals } = await freshQuery;
  let currentCandidate = payload.tag_id?.trim() || generateNextAnimalId(payload.species, currentAnimals || []);

  let hadConflict = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check if current candidate is available before trying insert
    const isAvailable = await isAnimalIdAvailable(currentCandidate, null, payload.user_id);
    if (!isAvailable) {
      hadConflict = true;
      const num = parseAnimalNumber(currentCandidate, prefix) || 0;
      currentCandidate = `${prefix}-${String(num + 1).padStart(3, '0')}`;
      if (options.onAutoIncrement) options.onAutoIncrement(currentCandidate);
      continue;
    }

    // Attempt insert
    const recordToInsert = {
      ...payload,
      tag_id: currentCandidate,
    };

    const { data, error } = await supabase
      .from('animals')
      .insert(recordToInsert)
      .select()
      .maybeSingle();

    if (!error) {
      return {
        data: data as Animal,
        error: null,
        finalTagId: currentCandidate,
        hadConflict,
      };
    }

    // Check if error is unique violation (23505) or duplicate tag_id
    const isDuplicate =
      error.code === '23505' ||
      error.message?.toLowerCase().includes('duplicate') ||
      error.message?.toLowerCase().includes('unique') ||
      error.message?.toLowerCase().includes('already exists');

    if (isDuplicate) {
      hadConflict = true;
      const num = parseAnimalNumber(currentCandidate, prefix) || 0;
      currentCandidate = `${prefix}-${String(num + 1).padStart(3, '0')}`;
      if (options.onAutoIncrement) options.onAutoIncrement(currentCandidate);
      continue;
    }

    // Other non-duplicate error: return immediately
    return {
      data: null,
      error: new Error(error.message),
      finalTagId: currentCandidate,
      hadConflict,
    };
  }

  return {
    data: null,
    error: new Error('Unable to find an available Animal ID after multiple attempts. Please try again.'),
    finalTagId: currentCandidate,
    hadConflict,
  };
}

export interface CreateAnimalWithWeightResult {
  animal: Animal | null;
  finalTagId: string;
  hadConflict: boolean;
  initialWeightRecorded: boolean;
  error: Error | null;
}

/**
 * Automatically records the initial weight for a newly registered animal.
 * - Idempotent: checks if a weight record already exists for this animal before inserting.
 * - Single source of truth: ensures previous_weight_kg, weight_change_kg, daily_gain_kg are null.
 * - Standard notes: "Initial weight recorded during animal registration."
 * - Scoped to the same user_id as the animal.
 */
export async function recordInitialAnimalWeight(
  animal: { id: string; user_id: string; date_of_birth?: string | null },
  weightKg: number,
  recordDate?: string
): Promise<{ success: boolean; error: Error | null }> {
  const numWeight = Number(weightKg);
  if (!numWeight || isNaN(numWeight) || numWeight <= 0) {
    return { success: false, error: new Error('Dapat positibong numero ang timbang na higit sa 0.') };
  }

  try {
    // Idempotency: verify no weight record exists yet for this animal
    const { data: existing, error: checkErr } = await supabase
      .from('weight_records')
      .select('id')
      .eq('animal_id', animal.id)
      .limit(1);

    if (checkErr) {
      console.warn('Warning checking existing weight records:', checkErr);
    }

    if (existing && existing.length > 0) {
      // Already has an initial weight record, do not duplicate
      return { success: true, error: null };
    }

    const todayDate = recordDate || new Date().toISOString().split('T')[0];

    const payload = {
      user_id: animal.user_id,
      animal_id: animal.id,
      record_date: todayDate,
      weight_kg: Math.round(numWeight * 100) / 100,
      previous_weight_kg: null,
      weight_change_kg: null,
      daily_gain_kg: null,
      notes: 'Initial weight recorded during animal registration.',
    };

    const { error: insertErr } = await supabase.from('weight_records').insert(payload);

    if (insertErr) {
      console.error('Failed to create initial weight record:', insertErr);
      return { success: false, error: new Error('Hindi na-record ang unang timbang. Pakisubukan muli.') };
    }

    // Ensure animal's current weight_kg is in sync
    await supabase.from('animals').update({ weight_kg: Math.round(numWeight * 100) / 100 }).eq('id', animal.id);

    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error recording initial weight:', err);
    return { success: false, error: new Error('Hindi na-record ang unang timbang. Pakisubukan muli.') };
  }
}

/**
 * Creates an animal and its initial weight record atomically with compensating rollback.
 * If initial weight is provided (> 0):
 * 1. Creates animal
 * 2. Creates initial weight record linked to that animal
 * 3. If initial weight record creation fails, rolls back the created animal and returns an error
 */
export async function createAnimalWithInitialWeight(
  payload: Partial<Animal> & { species: Species; user_id?: string },
  initialWeightKg: number | null | undefined,
  options: InsertAnimalOptions = {}
): Promise<CreateAnimalWithWeightResult> {
  const hasWeight =
    initialWeightKg !== null &&
    initialWeightKg !== undefined &&
    (initialWeightKg as any) !== '' &&
    !isNaN(Number(initialWeightKg)) &&
    Number(initialWeightKg) > 0;

  // Validate weight if a value was provided but invalid (< 0 or NaN)
  if (initialWeightKg !== null && initialWeightKg !== undefined && (initialWeightKg as any) !== '') {
    const num = Number(initialWeightKg);
    if (isNaN(num) || num < 0) {
      return {
        animal: null,
        finalTagId: '',
        hadConflict: false,
        initialWeightRecorded: false,
        error: new Error('Dapat positibong numero ang timbang.'),
      };
    }
  }

  // 1. Create animal (weight_kg is optional: null if not provided or 0)
  const animalPayload = {
    ...payload,
    weight_kg: hasWeight ? Number(initialWeightKg) : null,
  };
  const animalResult = await insertAnimalWithUniqueRetry(animalPayload, options);
  if (animalResult.error || !animalResult.data) {
    return {
      animal: null,
      finalTagId: animalResult.finalTagId,
      hadConflict: animalResult.hadConflict,
      initialWeightRecorded: false,
      error: animalResult.error,
    };
  }

  const createdAnimal = animalResult.data;

  // If no initial weight was provided, return success immediately without fake records
  if (!hasWeight) {
    const speciesName = createdAnimal.species === 'Goat' ? 'Kambing' : 'Tupa';
    notificationService
      .dispatchNotification({
        userId: createdAnimal.user_id,
        type: 'System',
        title: `Bagong ${speciesName}: ${createdAnimal.name} (${createdAnimal.tag_id})`,
        message: `Matagumpay na naidagdag si ${createdAnimal.name} (${createdAnimal.tag_id}, ${createdAnimal.species === 'Goat' ? 'Kambing' : 'Tupa'}) sa iyong bukid.`,
        priority: 'Normal',
        severity: 'normal',
        link: `/animals/${createdAnimal.id}`,
        animalId: createdAnimal.id,
        relatedType: 'animal',
        relatedId: createdAnimal.id,
        eventKey: `animal_created_${createdAnimal.id}`,
      })
      .catch((e) => console.warn('Could not dispatch animal creation notification:', e));

    return {
      animal: createdAnimal,
      finalTagId: animalResult.finalTagId,
      hadConflict: animalResult.hadConflict,
      initialWeightRecorded: false,
      error: null,
    };
  }

  // 2. Create initial weight record
  const weightResult = await recordInitialAnimalWeight(createdAnimal, Number(initialWeightKg));

  if (!weightResult.success) {
    // Preserve the failed setup for auditability while keeping it out of the active herd.
    try {
      await supabase.from('animals').update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: createdAnimal.user_id,
        archive_reason: 'Initial weight setup did not complete.',
      }).eq('id', createdAnimal.id).eq('user_id', createdAnimal.user_id);
    } catch (cleanupErr) {
      console.error('Failed rollback of animal after weight creation failure:', cleanupErr);
    }

    return {
      animal: null,
      finalTagId: animalResult.finalTagId,
      hadConflict: animalResult.hadConflict,
      initialWeightRecorded: false,
      error: weightResult.error || new Error('Hindi na-record ang unang timbang. Pakisubukan muli.'),
    };
  }

  const speciesNameWithWeight = createdAnimal.species === 'Goat' ? 'Kambing' : 'Tupa';
  notificationService
    .dispatchNotification({
      userId: createdAnimal.user_id,
      type: 'System',
      title: `Bagong ${speciesNameWithWeight}: ${createdAnimal.name} (${createdAnimal.tag_id})`,
      message: `Matagumpay na naidagdag si ${createdAnimal.name} (${createdAnimal.tag_id}, ${createdAnimal.species === 'Goat' ? 'Kambing' : 'Tupa'}, ${initialWeightKg}kg) sa iyong bukid.`,
      priority: 'Normal',
      severity: 'normal',
      link: `/animals/${createdAnimal.id}`,
      animalId: createdAnimal.id,
      relatedType: 'animal',
      relatedId: createdAnimal.id,
      eventKey: `animal_created_${createdAnimal.id}`,
    })
    .catch((e) => console.warn('Could not dispatch animal creation notification:', e));

  return {
    animal: createdAnimal,
    finalTagId: animalResult.finalTagId,
    hadConflict: animalResult.hadConflict,
    initialWeightRecorded: true,
    error: null,
  };
}

