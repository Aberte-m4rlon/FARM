export type Species = 'Goat' | 'Sheep';
export type Sex = 'Male' | 'Female';
export type BreedingStatus = 'Open' | 'Pregnant' | 'Nursing' | 'Ready' | 'Not Ready' | 'Monitor';
export type VaccinationStatus = 'Up to Date' | 'Due Soon' | 'Overdue' | 'None';
export type InventoryTransactionType =
  | 'STOCK_IN'
  | 'CONSUMPTION'
  | 'REMOVAL'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'RETURN';

export interface InventoryTransaction {
  id: string;
  user_id: string;
  inventory_item_id: string;
  type: InventoryTransactionType;
  quantity: number;
  unit: string;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  previous_stock: number;
  new_stock: number;
  cost_per_unit: number | null;
  created_at: string;
}
export type NotificationType =
  | 'Health'
  | 'Vaccination'
  | 'Breeding'
  | 'Weight'
  | 'Inventory'
  | 'Expiry'
  | 'System'
  | 'health'
  | 'breeding'
  | 'inventory'
  | 'vaccine'
  | 'expiry'
  | 'system'
  | 'weight';

export type Priority = 'Critical' | 'Warning' | 'Normal' | 'Success';
export type NotificationPriority = Priority | 'critical' | 'high' | 'medium' | 'low';

export interface Animal {
  id: string;
  user_id: string;
  public_qr_token?: string;
  public_profile_enabled?: boolean;
  public_show_birth_date?: boolean;
  tag_id: string;
  eartag_number?: number | null;
  camera_last_eartag_at?: string | null;
  name: string;
  species: Species;
  breed: string | null;
  sex: Sex;
  date_of_birth: string | null;
  color_markings: string | null;
  photo_url: string | null;
  weight_kg: number | null;
  breeding_status: BreedingStatus;
  last_mating_date: string | null;
  expected_kidding_date: string | null;
  last_vaccine_date: string | null;
  next_vaccine_date: string | null;
  vaccination_status: VaccinationStatus;
  archived: boolean;
  status?: 'Active' | 'Sold' | 'Deceased' | 'Transferred' | string;
  is_sold?: boolean;
  camera_last_seen_at?: string | null;
  camera_last_qr_at?: string | null;
  notes: string | null;
  mother_animal_id?: string | null;
  father_animal_id?: string | null;
  birth_event_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type MortalityCause = 'disease' | 'accident' | 'birthing_complication' | 'unknown' | 'other';

export interface MortalityRecord {
  id: string;
  user_id: string;
  animal_id: string;
  date_of_death: string;
  estimated_time: string | null;
  cause_of_death: MortalityCause;
  cause_details: string | null;
  symptoms_before_death: string | null;
  previous_health_status: string | null;
  previous_treatment: string | null;
  notes: string | null;
  previous_animal_status: string;
  recorded_by: string | null;
  recorded_by_name: string;
  recorded_at: string;
  corrected_at: string | null;
  corrected_by: string | null;
  correction_reason: string | null;
}

export interface HealthRecord {
  id: string;
  user_id: string;
  animal_id: string;
  record_date: string;
  reasons: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeightRecord {
  id: string;
  user_id: string;
  animal_id: string;
  record_date: string;
  weight_kg: number;
  previous_weight_kg: number | null;
  weight_change_kg: number | null;
  daily_gain_kg: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BreedingRecord {
  id: string;
  user_id: string;
  animal_id: string;
  partner_id: string | null;
  mating_date: string;
  expected_kidding_date: string | null;
  actual_kidding_date: string | null;
  offspring_count: number | null;
  status: 'Planned' | 'Pregnant' | 'Kidded' | 'Failed' | 'Monitor';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BreedingBirthEvent {
  id: string;
  user_id: string;
  breeding_id: string;
  mother_id: string;
  father_id: string | null;
  outcome: 'successful' | 'failed';
  result_label: string | null;
  event_date: string;
  actual_birth_date: string | null;
  birth_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BreedingDueAlert {
  id: string;
  user_id: string;
  breeding_id: string;
  animal_id: string;
  expected_due_date: string;
  active: boolean;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vaccination {
  id: string;
  user_id: string;
  animal_id: string;
  vaccine_name: string;
  date_given: string;
  next_due_date: string | null;
  veterinarian: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type InventoryCategory =
  | 'Feed'
  | 'Medicine'
  | 'Vaccine'
  | 'Vaccines'
  | 'Dewormer'
  | 'Supplement'
  | 'Supplements'
  | 'Vitamins'
  | 'Supplies'
  | 'Equipment'
  | 'Tools'
  | 'Other';

export type TreatmentStatus =
  | 'Kailangan ng Gamot'
  | 'Kasalukuyang Ginagamot'
  | 'Tapos na ang Gamot'
  | 'Hindi pa Nabibigyan'
  | 'Bantayan';

export type TreatmentUsageType =
  | 'Medication'
  | 'Deworming'
  | 'Supplement'
  | 'Treatment';

export interface InventoryItem {
  id: string;
  user_id: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minimum_stock: number;
  purchase_date: string | null;
  expiry_date: string | null;
  supplier: string | null;
  cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryUsageRecord {
  id: string;
  user_id: string;
  inventory_id: string;
  animal_id?: string | null;
  quantity_used: number;
  unit: string;
  usage_date: string;
  reason?: string | null;
  treatment_status?: TreatmentStatus | string | null;
  dosage?: string | null;
  frequency?: string | null;
  next_due_date?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  description: string | null;
  message?: string | null;
  priority: NotificationPriority;
  severity?: 'critical' | 'warning' | 'normal' | 'info';
  link: string | null;
  action_url?: string | null;
  animal_id?: string | null;
  related_type?: 'animal' | 'health' | 'inventory' | 'breeding' | 'vaccination' | 'sale' | 'system' | null;
  related_id?: string | null;
  event_key?: string | null;
  read: boolean;
  is_read?: boolean;
  created_at: string;
  updated_at?: string;
  read_at?: string | null;
  deliveries?: NotificationDelivery[];
}

export type DeliveryChannel = 'in_app' | 'sms' | 'email';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface NotificationDelivery {
  id: string;
  user_id: string;
  notification_id?: string | null;
  channel: DeliveryChannel;
  recipient?: string | null;
  status: DeliveryStatus;
  provider_message_id?: string | null;
  error_message?: string | null;
  attempt_count: number;
  sent_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferences {
  id?: string;
  user_id?: string;
  health_in_app: boolean;
  health_sms: boolean;
  health_email: boolean;
  inventory_in_app: boolean;
  inventory_sms: boolean;
  inventory_email: boolean;
  breeding_in_app: boolean;
  breeding_sms: boolean;
  breeding_email: boolean;
  vaccination_in_app: boolean;
  vaccination_sms: boolean;
  vaccination_email: boolean;
  medication_in_app: boolean;
  medication_sms: boolean;
  medication_email: boolean;
  sales_in_app: boolean;
  sales_sms: boolean;
  sales_email: boolean;
  system_in_app: boolean;
  system_sms: boolean;
  system_email: boolean;
  critical_bypass: boolean;
}

export interface Recommendation {
  id: string;
  user_id: string;
  category: string;
  title: string;
  description: string | null;
  priority: Priority;
  severity_color: 'red' | 'orange' | 'yellow' | 'green' | 'blue';
  link: string | null;
  dismissed: boolean;
  created_at: string;
}

export interface Settings {
  id: string;
  user_id: string;
  farm_name: string;
  target_weight_kg: number;
  gestation_days: number;
  expiry_warning_days: number;
  vaccine_due_days: number;
  breeding_min_age_months: number;
  breeding_min_weight_kg: number;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'Bayad na' | 'May Kulang' | 'Pending';

export interface AnimalSale {
  id: string;
  user_id: string;
  animal_id: string;
  animal_tag_id: string;
  animal_name: string;
  species: Species | string;
  sold_weight: number;
  selling_price: number;
  price_per_kg: number | null;
  buyer_name: string | null;
  buyer_contact: string | null;
  payment_status: PaymentStatus;
  amount_received: number;
  remaining_balance: number;
  sale_date: string;
  notes: string | null;
  sold_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Complete Animal Health Management Module Interfaces ──────────────────────

export type CaseSeverity = 'Mild' | 'Moderate' | 'Severe' | 'Critical';
export type CaseStatus = 'Open' | 'Under Treatment' | 'Monitoring' | 'Recovered' | 'Closed';
export type TreatmentRoute = 'Oral' | 'Injectable SC' | 'Injectable IM' | 'Topical' | 'Pour-on' | 'Eye drop';
export type TreatmentRecordStatus = 'Scheduled' | 'Ongoing' | 'Completed' | 'Discontinued';
export type HealthAlertType =
  | 'pending_vet_review'
  | 'treatment_follow_up';

export interface HealthCase {
  id: string;
  user_id: string;
  animal_id: string;
  assessment_id?: string | null;
  case_number: string;
  suspected_condition: string;
  confirmed_diagnosis?: string | null;
  date_reported: string;
  severity: CaseSeverity;
  attending_veterinarian?: string | null;
  clinical_notes?: string | null;
  case_status: CaseStatus;
  follow_up_date?: string | null;
  attachments?: string[];
  created_at: string;
  updated_at: string;
}

export interface TreatmentRecord {
  id: string;
  user_id: string;
  animal_id: string;
  case_id?: string | null;
  inventory_id?: string | null;
  medicine_name: string;
  active_ingredient?: string | null;
  dosage: string;
  unit: string;
  route: TreatmentRoute | string;
  frequency: string;
  start_date: string;
  end_date?: string | null;
  administering_person?: string | null;
  prescribing_veterinarian?: string | null;
  withdrawal_period_days?: number;
  withdrawal_end_date?: string | null;
  treatment_notes?: string | null;
  status: TreatmentRecordStatus;
  created_at: string;
  updated_at: string;
}

export interface HealthAlert {
  id: string;
  user_id: string;
  animal_id: string;
  alert_type: HealthAlertType | string;
  severity: 'critical' | 'warning' | 'normal' | 'info';
  message: string;
  source_id?: string | null;
  is_read: boolean;
  is_resolved: boolean;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created_at: string;
}

