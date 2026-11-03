import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Stethoscope,
  Calendar,
  AlertCircle,
  FileText,
  UserCheck,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { useFarmData } from '../../../lib/useFarmData';
import { useAuth } from '../../../lib/auth';
import { useToast } from '../../ui/Toast';
import { Button } from '../../ui/Button';
import {
  createHealthCase,
  generateCaseNumber,
} from '../../../lib/healthService';
import type { Animal, CaseSeverity, CaseStatus } from '../../../types';

interface HealthCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedAnimalId?: string;
  onCaseCreated?: () => void;
}

export function HealthCaseModal({
  isOpen,
  onClose,
  preselectedAnimalId,
  onCaseCreated,
}: HealthCaseModalProps) {
  const { animals, refresh } = useFarmData();
  const { user } = useAuth();
  const toast = useToast();

  const [selectedAnimalId, setSelectedAnimalId] = useState<string>(preselectedAnimalId || '');
  const [caseNumber, setCaseNumber] = useState<string>('');
  const [suspectedCondition, setSuspectedCondition] = useState<string>('');
  const [confirmedDiagnosis, setConfirmedDiagnosis] = useState<string>('');
  const [dateReported, setDateReported] = useState<string>(new Date().toISOString().split('T')[0]);
  const [severity, setSeverity] = useState<CaseSeverity>('Moderate');
  const [attendingVet, setAttendingVet] = useState<string>('');
  const [clinicalNotes, setClinicalNotes] = useState<string>('');
  const [caseStatus, setCaseStatus] = useState<CaseStatus>('Open');
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setCaseNumber(generateCaseNumber());
    }
  }, [isOpen]);

  useEffect(() => {
    if (preselectedAnimalId) {
      setSelectedAnimalId(preselectedAnimalId);
    } else if (animals.length > 0 && !selectedAnimalId) {
      setSelectedAnimalId(animals[0].id);
    }
  }, [preselectedAnimalId, animals, selectedAnimalId]);

  const currentAnimal: Animal | undefined = useMemo(() => {
    return animals.find((a: Animal) => a.id === selectedAnimalId);
  }, [animals, selectedAnimalId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAnimal || !user) {
      toast('Pumili ng alaga bago itala ang case.', 'error');
      return;
    }

    if (!suspectedCondition.trim()) {
      toast('Ilagay ang pinaghihinalaang karamdaman (Suspected Condition).', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const savedCase = await createHealthCase({
        userId: user.id,
        animalId: currentAnimal.id,
        caseNumber,
        suspectedCondition: suspectedCondition.trim(),
        confirmedDiagnosis: confirmedDiagnosis.trim() || null,
        dateReported,
        severity,
        attendingVeterinarian: attendingVet.trim() || null,
        clinicalNotes: clinicalNotes.trim() || null,
        caseStatus,
        followUpDate: followUpDate || null,
      });

      toast(`Matagumpay na naitala ang Health Case: ${savedCase.case_number}!`, 'success');
      await refresh();
      if (onCaseCreated) onCaseCreated();
      onClose();
    } catch (err: any) {
      console.error('Error creating health case:', err);
      toast(err.message || 'Hindi maitala ang health case.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--surface, #ffffff)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border, #e5e7eb)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border, #e5e7eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(35,139,69,0.06), rgba(23,107,53,0.02))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '10px',
                backgroundColor: 'rgba(35, 139, 69, 0.12)',
                color: '#238B45',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Stethoscope size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text, #111827)' }}>
                Magbukas ng Health Case / Diagnosis
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', margin: 0 }}>
                Case File: <strong>{caseNumber}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-secondary, #9ca3af)',
              padding: 6,
              borderRadius: '8px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Animal Selector */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #374151)', display: 'block', marginBottom: 4 }}>
              Alaga (Kambing o Tupa) *
            </label>
            <select
              value={selectedAnimalId}
              onChange={(e) => setSelectedAnimalId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border, #d1d5db)',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {animals.map((a: Animal) => (
                <option key={a.id} value={a.id}>
                  {a.tag_id} — {a.name} ({a.species === 'Goat' ? 'Kambing' : 'Tupa'})
                </option>
              ))}
            </select>
          </div>

          {/* Suspected vs Confirmed Diagnosis (Strictly kept separate per medical best practices) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#b45309', display: 'block', marginBottom: 4 }}>
                Pinaghihinalaang Karamdaman (Suspected) *
              </label>
              <input
                type="text"
                placeholder="Hal. Pneumonia / Bloat / Parasitism"
                value={suspectedCondition}
                onChange={(e) => setSuspectedCondition(e.target.value)}
                required
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #f59e0b',
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 11, color: '#6b7280' }}>Obserbasyon o paunang palagay bago kumpirmahin.</span>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#15803d', display: 'block', marginBottom: 4 }}>
                Kumpirmadong Diagnosis ng Beterinaryo (Confirmed)
              </label>
              <input
                type="text"
                placeholder="Opisyal na diagnosis mula sa Vet"
                value={confirmedDiagnosis}
                onChange={(e) => setConfirmedDiagnosis(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #10b981',
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 11, color: '#6b7280' }}>Itala kapag may opisyal na pagsusuri ang lisensyadong vet.</span>
            </div>
          </div>

          {/* Severity and Status */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
                Lebel ng Kalubhaan (Severity) *
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as CaseSeverity)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #d1d5db)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <option value="Mild">Magaan (Mild)</option>
                <option value="Moderate">Katamtaman (Moderate)</option>
                <option value="Severe">Malubha (Severe)</option>
                <option value="Critical">Kritikal (Critical)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
                Katayuan ng Kaso (Status) *
              </label>
              <select
                value={caseStatus}
                onChange={(e) => setCaseStatus(e.target.value as CaseStatus)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #d1d5db)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <option value="Open">Bukas (Open)</option>
                <option value="Under Treatment">Ginagamot (Under Treatment)</option>
                <option value="Monitoring">Binabantayan (Monitoring)</option>
                <option value="Recovered">Gumaling na (Recovered)</option>
                <option value="Closed">Naisara na (Closed)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
                Petsa ng Pagkakatala *
              </label>
              <input
                type="date"
                value={dateReported}
                onChange={(e) => setDateReported(e.target.value)}
                required
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #d1d5db)',
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* Attending Veterinarian and Follow-up Date */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
                Attending Veterinarian
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Dr. Juan Dela Cruz, DVM"
                  value={attendingVet}
                  onChange={(e) => setAttendingVet(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px 9px 34px',
                    borderRadius: '8px',
                    border: '1px solid var(--border, #d1d5db)',
                    fontSize: 13,
                  }}
                />
                <UserCheck size={16} color="#9ca3af" style={{ position: 'absolute', left: 10, top: 11 }} />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
                Petsa ng Follow-up / Pagsusuri
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px 9px 34px',
                    borderRadius: '8px',
                    border: '1px solid var(--border, #d1d5db)',
                    fontSize: 13,
                  }}
                />
                <Calendar size={16} color="#9ca3af" style={{ position: 'absolute', left: 10, top: 11 }} />
              </div>
              <span style={{ fontSize: 11, color: '#6b7280' }}>Awtomatikong gagawa ng paalala sa sistema.</span>
            </div>
          </div>

          {/* Clinical Notes */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4b5563)', display: 'block', marginBottom: 4 }}>
              Klinikal na Tala (Clinical Notes & Recommendations)
            </label>
            <textarea
              rows={3}
              placeholder="Mga tagubilin ng beterinaryo, rekomendadong paghihiwalay sa kawan (isolation), atbp."
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border, #d1d5db)',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border, #e5e7eb)',
            }}
          >
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Kanselahin
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !currentAnimal}
              style={{
                backgroundColor: '#238B45',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isSubmitting ? 'Itinatala…' : 'I-save ang Health Case'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
