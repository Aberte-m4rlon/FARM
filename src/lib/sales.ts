/**
 * sales.ts — Livestock Sales & Pre-Sale Weighing Management for ALPASFARM
 *
 * Handles:
 * - Recording sales with mandatory pre-sale weighing
 * - Tracking total animals sold, money received, weight, and price per kg
 * - Resilient database interaction with user-isolated local fallback
 * - Automatic animal archiving (marked as 'Sold') while preserving all history
 * - Automatic insertion of selling weight into weight_records
 */

import { supabase } from './supabase';
import { notificationService } from './notificationService';
import type { Animal, AnimalSale, PaymentStatus } from '../types';

export interface RecordSaleInput {
  userId: string;
  isSuperAdmin?: boolean;
  animal: Animal;
  soldWeight: number; // Mandatory pre-sale weight
  sellingPrice: number; // Mandatory final price
  buyerName?: string;
  buyerContact?: string;
  paymentStatus: PaymentStatus;
  amountReceived?: number;
  saleDate?: string;
  notes?: string;
  soldBy?: string;
}

/** Fetch sales from the authenticated database source of truth. */
export async function fetchUserSales(userId: string, isSuperAdmin = false): Promise<AnimalSale[]> {
  let query = supabase.from('animal_sales').select('*').order('sale_date', { ascending: false });
  if (!isSuperAdmin) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as AnimalSale[] | null) ?? [];
}

/**
 * Calculate price per kilogram for display and analytics
 */
export function calculatePricePerKg(price: number, weightKg: number): number | null {
  if (!weightKg || weightKg <= 0 || !price || price <= 0) return null;
  return Number((price / weightKg).toFixed(2));
}

export interface SalesMetrics {
  totalSold: number;
  totalReceived: number;
  totalRevenue: number;
  totalWeight: number;
  avgPricePerKg: number;
  totalRemainingBalance: number;
  pendingCount: number;
  partialCount: number;
}

/**
 * Calculate summary metrics for the sales dashboard and reports
 */
export function calculateSalesMetrics(sales: AnimalSale[]): SalesMetrics {
  let totalReceived = 0;
  let totalRevenue = 0;
  let totalWeight = 0;
  let totalRemainingBalance = 0;
  let pendingCount = 0;
  let partialCount = 0;

  for (const s of sales) {
    const received = Number(s.amount_received || 0);
    const price = Number(s.selling_price || 0);
    const weight = Number(s.sold_weight || 0);
    const balance = Number(s.remaining_balance || 0);

    totalReceived += received;
    totalRevenue += price;
    totalWeight += weight;
    totalRemainingBalance += balance;

    if (s.payment_status === 'Pending') pendingCount++;
    if (s.payment_status === 'May Kulang') partialCount++;
  }

  const avgPricePerKg = totalWeight > 0 ? Number((totalRevenue / totalWeight).toFixed(2)) : 0;

  return {
    totalSold: sales.length,
    totalReceived,
    totalRevenue,
    totalWeight: Number(totalWeight.toFixed(2)),
    avgPricePerKg,
    totalRemainingBalance,
    pendingCount,
    partialCount,
  };
}

/**
 * Record a new animal sale
 * - Performs pre-sale weight validation
 * - Creates sale record in the database
 * - Updates animal record to 'Sold' (archived: true, preserving all history)
 * - Records final weight in weight_records table
 */
export async function recordAnimalSale(
  input: RecordSaleInput
): Promise<{ success: boolean; sale?: AnimalSale; error?: string }> {
  const {
    userId,
    isSuperAdmin = false,
    animal,
    soldWeight,
    sellingPrice,
    buyerName,
    buyerContact,
    paymentStatus,
    amountReceived: rawAmountReceived,
    saleDate = new Date().toISOString().split('T')[0],
    notes,
    soldBy,
  } = input;

  if (!animal || !animal.id) {
    return { success: false, error: 'Pumili muna ng kambing o tupa na ibebenta.' };
  }

  if (!soldWeight || soldWeight <= 0) {
    return { success: false, error: 'Kailangang timbangin muna ang kambing o tupa bago ito maibenta. Ilagay ang wastong timbang (kg).' };
  }

  if (sellingPrice === undefined || sellingPrice === null || sellingPrice <= 0) {
    return { success: false, error: 'Ilagay ang wastong presyo ng pagbebenta (₱).' };
  }

  try {
    const { data, error } = await supabase.rpc('record_animal_sale', {
      p_animal_id: animal.id,
      p_sold_weight: soldWeight,
      p_selling_price: sellingPrice,
      p_buyer_name: buyerName?.trim() || null,
      p_buyer_contact: buyerContact?.trim() || null,
      p_payment_status: paymentStatus,
      p_amount_received: rawAmountReceived ?? 0,
      p_sale_date: saleDate,
      p_notes: notes?.trim() || null,
      p_sold_by: soldBy || null,
    });
    if (error) throw error;
    if (!data) throw new Error('Walang natanggap na tala ng benta mula sa database.');
    const sale = data as AnimalSale;
    const speciesLabel = animal.species.toLowerCase() === 'sheep' ? 'Tupa' : 'Kambing';
    await notificationService.dispatchNotification({
      userId,
      type: 'Sales',
      title: 'Naibenta ang ' + speciesLabel + ': ' + sale.animal_name + ' (' + sale.animal_tag_id + ')',
      message: 'Naitala ang pagbebenta kay ' + (sale.buyer_name || 'Bumibili') + ': PHP ' + Number(sale.selling_price).toLocaleString() + ' (' + sale.sold_weight + 'kg, Bayad: PHP ' + Number(sale.amount_received).toLocaleString() + ').',
      priority: 'Normal',
      severity: 'normal',
      link: '/sales',
      animalId: sale.animal_id,
      relatedType: 'sale',
      relatedId: sale.id,
      eventKey: 'sale_' + sale.id,
    }).catch((notificationError) => {
      console.warn('Could not dispatch sale notification:', notificationError);
    });
    return { success: true, sale };
  } catch (err: any) {
    console.error('Error during sale execution:', err);
    return { success: false, error: err?.message || 'Nagkaroon ng problema sa pag-save ng benta.' };
  }
}
