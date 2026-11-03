import { supabase } from './supabase';
import type { CaseSeverity, CaseStatus, HealthAlert, HealthCase, HealthAlertType } from '../types';

export function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `HC-${year}-${randomSuffix}`;
}

async function createHealthAlert(params: {
  userId: string;
  animalId: string;
  alertType: HealthAlertType | string;
  message: string;
  sourceId: string;
}): Promise<HealthAlert | null> {
  const payload = {
    user_id: params.userId,
    animal_id: params.animalId,
    alert_type: params.alertType,
    severity: 'normal' as const,
    message: params.message,
    source_id: params.sourceId,
    is_read: false,
    is_resolved: false,
  };
  const { data, error } = await supabase.from('health_alerts').insert(payload).select('*').single();
  if (!error) return data as HealthAlert;

  console.warn('[healthService] Could not create follow-up alert:', error.message);
  const { error: notificationError } = await supabase.from('notifications').insert({
    user_id: params.userId,
    type: 'Health',
    title: 'Nakatakdang follow-up',
    message: params.message,
    description: params.message,
    priority: 'Warning',
    animal_id: params.animalId,
    read: false,
  });
  if (notificationError) console.warn('[healthService] Could not create follow-up notification:', notificationError.message);
  return null;
}

export async function createHealthCase(params: {
  userId: string;
  animalId: string;
  caseNumber?: string;
  assessmentId?: string | null;
  suspectedCondition: string;
  confirmedDiagnosis?: string | null;
  dateReported?: string;
  severity: CaseSeverity;
  attendingVeterinarian?: string | null;
  clinicalNotes?: string | null;
  caseStatus?: CaseStatus;
  followUpDate?: string | null;
  attachments?: string[];
}): Promise<HealthCase> {
  const caseNumber = params.caseNumber || generateCaseNumber();
  const payload = {
    user_id: params.userId,
    animal_id: params.animalId,
    assessment_id: params.assessmentId ?? null,
    case_number: caseNumber,
    suspected_condition: params.suspectedCondition,
    confirmed_diagnosis: params.confirmedDiagnosis ?? null,
    date_reported: params.dateReported ?? new Date().toISOString().split('T')[0],
    severity: params.severity,
    attending_veterinarian: params.attendingVeterinarian ?? null,
    clinical_notes: params.clinicalNotes ?? null,
    case_status: params.caseStatus ?? 'Open',
    follow_up_date: params.followUpDate ?? null,
    attachments: params.attachments ?? [],
  };

  const { data, error } = await supabase.from('health_cases').insert(payload).select('*').single();
  if (error) {
    console.error('[healthService] Error creating health case:', error);
    throw new Error('Hindi na-save ang health case. Suriin ang koneksyon at subukang muli.');
  }

  if (params.followUpDate) {
    await createHealthAlert({
      userId: params.userId,
      animalId: params.animalId,
      alertType: 'pending_vet_review',
      message: `Nakatakdang follow-up para sa Case ${caseNumber} sa ${params.followUpDate}.`,
      sourceId: data.id,
    });
  }

  return data as HealthCase;
}
