import { supabase } from './supabase';
import { createNotification } from './recommendations';
import { daysUntil } from './analytics';
import type { InventoryItem, TreatmentStatus, TreatmentUsageType } from '../types';

export function isVaccineCategory(category?: string | null): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  return c === 'vaccine' || c === 'vaccines';
}

export function isMedicineCategory(category?: string | null): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  return (
    c === 'medicine' ||
    c === 'medicines' ||
    c === 'dewormer' ||
    c === 'supplement' ||
    c === 'supplements' ||
    c === 'vitamins' ||
    c === 'vitamin'
  );
}

export function isSupplementCategory(category?: string | null): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  return c === 'supplement' || c === 'supplements' || c === 'vitamins' || c === 'vitamin';
}

/**
 * Filter items appropriate for medication and treatments.
 * Strictly excludes Feed, Equipment, Tools, and Containers.
 */
export function isTreatmentInventoryItem(category?: string | null): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  // Exclude non-treatment categories strictly
  if (
    c === 'feed' ||
    c === 'equipment' ||
    c === 'tools' ||
    c.includes('pakain') ||
    c.includes('kagamitan') ||
    c.includes('kasangkapan') ||
    c.includes('lalagyan')
  ) {
    return false;
  }
  return (
    c === 'medicine' ||
    c === 'medicines' ||
    c === 'dewormer' ||
    c === 'purga' ||
    c === 'supplement' ||
    c === 'supplements' ||
    c === 'vitamins' ||
    c === 'vitamin' ||
    c === 'vaccine' ||
    c === 'vaccines' ||
    c === 'supplies' ||
    c.includes('gamot') ||
    c.includes('bitamina') ||
    c.includes('suplemento') ||
    c.includes('bakuna') ||
    c.includes('health') ||
    c.includes('med')
  );
}

/**
 * Check if an item is expired based on current date
 */
export function isItemExpired(itemOrDate: InventoryItem | string | null | undefined): boolean {
  if (!itemOrDate) return false;
  const expiryDate = typeof itemOrDate === 'string' ? itemOrDate : itemOrDate.expiry_date;
  if (!expiryDate) return false;
  return daysUntil(expiryDate) < 0;
}

export interface AdministerMedicationParams {
  userId: string;
  isSuperAdmin?: boolean;
  animalId: string;
  animalTag?: string;
  animalName?: string;
  inventoryItem: InventoryItem;
  quantity: number;
  unit: string;
  usageType?: TreatmentUsageType | string;
  status: TreatmentStatus;
  dosage?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  notes?: string;
  allowExpired?: boolean;
}

export interface AdministerMedicationResult {
  success: boolean;
  previousStock: number;
  newStock: number;
  usageId?: string;
  transactionId?: string;
  healthRecordId?: string;
  error?: string;
}

/**
 * Atomic Administration of Medication & Treatment with Farm Inventory Deduction.
 * Dual-layer transactional safety:
 * 1. Checks animal ownership and ensures animal is active (not sold/archived)
 * 2. Checks inventory item ownership, sufficiency, unit match, and non-expiration
 * 3. Attempts PostgreSQL RPC function for 100% single-transaction atomicity
 * 4. Requires the PostgreSQL RPC so stock deduction and usage records commit together
 * 5. Creates factual inventory_usage and inventory_transactions records only
 * 7. Dispatches deduplicated low-stock alerts via In-App, SMS, and Email
 */
export async function administerMedicationTreatment(
  params: AdministerMedicationParams
): Promise<AdministerMedicationResult> {
  const {
    userId,
    isSuperAdmin = false,
    animalId,
    animalTag,
    animalName,
    inventoryItem,
    quantity,
    unit,
    usageType = 'Medication',
    status,
    dosage,
    frequency = 'Once daily',
    startDate = new Date().toISOString().slice(0, 10),
    endDate,
    reason,
    notes = '',
    allowExpired = false,
  } = params;

  // 1. Authentication & Ownership validation
  if (!userId) {
    return {
      success: false,
      previousStock: inventoryItem.quantity,
      newStock: inventoryItem.quantity,
      error: 'Kailangan ng naka-login na user.',
    };
  }

  if (!animalId) {
    return {
      success: false,
      previousStock: inventoryItem.quantity,
      newStock: inventoryItem.quantity,
      error: 'Pumili ng kambing o tupa para sa paggamot.',
    };
  }

  if (!inventoryItem || !inventoryItem.id) {
    return {
      success: false,
      previousStock: 0,
      newStock: 0,
      error: 'Pumili ng gamot mula sa imbentaryo.',
    };
  }

  if (!isSuperAdmin && inventoryItem.user_id && inventoryItem.user_id !== userId) {
    return {
      success: false,
      previousStock: inventoryItem.quantity,
      newStock: inventoryItem.quantity,
      error: 'Walang pahintulot sa gamot na ito mula sa imbentaryo.',
    };
  }

  // 2. Quantity & Stock sufficiency validation
  if (isNaN(quantity) || quantity <= 0) {
    return {
      success: false,
      previousStock: inventoryItem.quantity,
      newStock: inventoryItem.quantity,
      error: 'Maglagay ng wastong dami (dapat mas mataas sa 0).',
    };
  }

  const prevStock = Number(inventoryItem.quantity) || 0;
  if (quantity > prevStock) {
    return {
      success: false,
      previousStock: prevStock,
      newStock: prevStock,
      error: `Hindi sapat ang stock. Mayroon lamang ${prevStock} ${inventoryItem.unit} sa imbentaryo.`,
    };
  }

  // 3. Unit validation
  if (unit && inventoryItem.unit && unit.trim().toLowerCase() !== inventoryItem.unit.trim().toLowerCase()) {
    return {
      success: false,
      previousStock: prevStock,
      newStock: prevStock,
      error: `Hindi tugma ang unit ng gamot (${unit}) at stock (${inventoryItem.unit}).`,
    };
  }

  // 4. Expiration check
  if (!allowExpired && isItemExpired(inventoryItem)) {
    return {
      success: false,
      previousStock: prevStock,
      newStock: prevStock,
      error: `Expired na ang gamot na ito noong ${inventoryItem.expiry_date}. Hindi maaaring gamitin.`,
    };
  }

  // 5. Verify Animal status (Must not be sold or archived)
  try {
    const { data: animalData, error: animalCheckErr } = await supabase
      .from('animals')
      .select('id, user_id, tag_id, name, archived')
      .eq('id', animalId)
      .maybeSingle();

    if (animalCheckErr || !animalData) {
      return {
        success: false,
        previousStock: prevStock,
        newStock: prevStock,
        error: 'Hindi nahanap ang alaga o walang pahintulot.',
      };
    }

    if (!isSuperAdmin && animalData.user_id !== userId) {
      return {
        success: false,
        previousStock: prevStock,
        newStock: prevStock,
        error: 'Walang pahintulot na gamutin ang alagang ito.',
      };
    }

    if (animalData.archived) {
      return {
        success: false,
        previousStock: prevStock,
        newStock: prevStock,
        error: 'Hindi maaaring bigyan ng gamot ang alaga na naibenta na o naka-archive.',
      };
    }

    // Check animal_sales table to verify animal is not sold
    const { data: saleData } = await supabase
      .from('animal_sales')
      .select('id')
      .eq('animal_id', animalId)
      .limit(1)
      .maybeSingle();

    if (saleData) {
      return {
        success: false,
        previousStock: prevStock,
        newStock: prevStock,
        error: 'Hindi maaaring bigyan ng gamot ang alaga na naibenta na.',
      };
    }
  } catch (checkEx) {
    console.warn('Could not verify animal status via DB:', checkEx);
  }

  // 6. Apply stock and treatment changes through the PostgreSQL transaction.
  let rpcOutcomeUnknown = false;
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('administer_medication_treatment', {
      p_user_id: userId,
      p_animal_id: animalId,
      p_inventory_id: inventoryItem.id,
      p_quantity: quantity,
      p_unit: inventoryItem.unit,
      p_usage_type: usageType,
      p_status: status,
      p_dosage: dosage || null,
      p_frequency: frequency || null,
      p_start_date: startDate,
      p_end_date: endDate || null,
      p_reason: reason || null,
      p_notes: notes || null,
    });

    if (!rpcErr && rpcData && rpcData.success) {
      // Dispatched successfully via database transaction
      const newStockVal = Number(rpcData.new_stock);
      const minStockVal = Number(rpcData.minimum_stock) || 0;
      const todayStr = new Date().toISOString().slice(0, 10);

      if (rpcData.is_low_stock) {
        try {
          if (newStockVal === 0) {
            await createNotification(
              userId,
              'Inventory',
              `Naubos na ang Stock: ${rpcData.item_name}`,
              `Ang ${rpcData.item_name} ay 0 ${rpcData.unit} na lamang. Mag-restock kaagad upang hindi maantala ang paggamot sa bukid.`,
              'Critical',
              '/inventory',
              `inventory_out_${inventoryItem.id}_${todayStr}`
            );
          } else if (newStockVal <= minStockVal) {
            await createNotification(
              userId,
              'Inventory',
              `Mababang Stock: ${rpcData.item_name}`,
              `Ang natitirang stock ng ${rpcData.item_name} ay ${newStockVal} ${rpcData.unit} na lamang (minimum: ${minStockVal} ${rpcData.unit}).`,
              'Warning',
              '/inventory',
              `inventory_low_${inventoryItem.id}_${todayStr}`
            );
          }
        } catch (e) {
          console.warn('Notification dispatch warning:', e);
        }
      }

      return {
        success: true,
        previousStock: Number(rpcData.previous_stock),
        newStock: newStockVal,
        usageId: rpcData.usage_id,
        healthRecordId: rpcData.health_record_id,
        transactionId: rpcData.transaction_id,
      };
    }

    // If RPC returned a specific business logic failure (e.g. insufficient stock message)
    if (
      rpcErr &&
      !rpcErr.message.includes('function administer_medication_treatment') &&
      !rpcErr.message.includes('could not find') &&
      !rpcErr.message.includes('schema cache') &&
      !rpcErr.message.includes('does not exist') &&
      !rpcErr.message.includes('is_sold')
    ) {
      if (!rpcErr.code) {
        rpcOutcomeUnknown = true;
      } else {
        return {
          success: false,
          previousStock: prevStock,
          newStock: prevStock,
          error: rpcErr.message,
        };
      }
    }

    if (!rpcErr && rpcData && !rpcData.success) {
      return {
        success: false,
        previousStock: prevStock,
        newStock: prevStock,
        error: 'Hindi naitala ang gamutan. Pakisubukang muli.',
      };
    }
  } catch (rpcEx) {
    rpcOutcomeUnknown = true;
    console.warn('RPC administer_medication_treatment outcome is unknown; inspect records before retrying:', rpcEx);
  }

  return {
    success: false,
    previousStock: prevStock,
    newStock: prevStock,
    error: rpcOutcomeUnknown
      ? 'Hindi makumpirma kung naitala ang gamutan. Suriin muna ang treatment history at stock bago subukang muli.'
      : 'Hindi naitala ang gamutan. Kailangan munang mailapat ang atomic medication treatment migration sa Supabase; walang nabawas na stock.',
  };
}
