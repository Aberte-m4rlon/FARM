import React, { useState } from 'react';
import { useNotifications } from '../../../context/NotificationContext';
import { useAuth } from '../../../lib/auth';
import { useToast } from '../../ui/Toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import {
  Bell,
  Mail,
  Smartphone,
  ShieldAlert,
  Send,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { NotificationPreferences } from '../../../types';

interface ChannelMatrixRow {
  key: string;
  label: string;
  description: string;
  inAppKey: keyof NotificationPreferences;
  smsKey: keyof NotificationPreferences;
  emailKey: keyof NotificationPreferences;
}

const CATEGORY_ROWS: ChannelMatrixRow[] = [
  {
    key: 'health',
    label: 'Kalusugan ng Kambing at Tupa (Health Alerts)',
    description: 'May sakit, kailangan ng agarang atensyon, o may abnormal na vital signs.',
    inAppKey: 'health_in_app',
    smsKey: 'health_sms',
    emailKey: 'health_email',
  },
  {
    key: 'medication',
    label: 'Pagpapainom ng Gamot (Medication)',
    description: 'Mga paalala sa tamang oras at gamot na dapat ibigay sa may sakit na alaga.',
    inAppKey: 'medication_in_app',
    smsKey: 'medication_sms',
    emailKey: 'medication_email',
  },
  {
    key: 'vaccination',
    label: 'Iskedyul ng Bakuna (Vaccination)',
    description: 'Paparating o lampas na sa takdang araw ng bakuna.',
    inAppKey: 'vaccination_in_app',
    smsKey: 'vaccination_sms',
    emailKey: 'vaccination_email',
  },
  {
    key: 'inventory',
    label: 'Imbentaryo at Pagkaubos (Inventory)',
    description: 'Mababang stock ng gamot, bakuna, o mga gamit na malapit nang mag-expire.',
    inAppKey: 'inventory_in_app',
    smsKey: 'inventory_sms',
    emailKey: 'inventory_email',
  },
  {
    key: 'breeding',
    label: 'Pagbubuntis at Panganganak (Breeding)',
    description: 'Nalalapit na petsa ng panganganak at paalala sa pagpaparami.',
    inAppKey: 'breeding_in_app',
    smsKey: 'breeding_sms',
    emailKey: 'breeding_email',
  },
  {
    key: 'sales',
    label: 'Pagbebenta ng Kambing at Tupa (Sales)',
    description: 'Kumpirmasyon kapag matagumpay na naitala ang benta ng kambing o tupa.',
    inAppKey: 'sales_in_app',
    smsKey: 'sales_sms',
    emailKey: 'sales_email',
  },
  {
    key: 'system',
    label: 'Mahalagang Abiso sa Sistema (System)',
    description: 'Mga update sa account, seguridad, at pangkalahatang paalala ng AlpasFarm.',
    inAppKey: 'system_in_app',
    smsKey: 'system_sms',
    emailKey: 'system_email',
  },
];

export function NotificationPreferencesCard({
  contactPhone,
}: {
  contactPhone?: string;
}) {
  const { preferences, updatePreferences, testChannel } = useNotifications();
  const { user } = useAuth();
  const toast = useToast();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingSms, setTestingSms] = useState<boolean>(false);
  const [testingEmail, setTestingEmail] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    type: 'success' | 'error';
    channel: 'sms' | 'email';
    message: string;
  } | null>(null);

  const handleToggle = async (key: keyof NotificationPreferences, currentValue: boolean) => {
    setSavingKey(key);
    try {
      await updatePreferences({ [key]: !currentValue });
    } finally {
      setSavingKey(null);
    }
  };

  const handleTestSms = async () => {
    setTestingSms(true);
    setTestResult(null);
    try {
      const targetPhone = contactPhone || user?.user_metadata?.phone;
      const res = await testChannel('sms', targetPhone);
      if (res.success) {
        setTestResult({
          type: 'success',
          channel: 'sms',
          message: res.message || 'Matagumpay na naipadala ang test SMS!',
        });
        toast(res.message || 'Matagumpay ang Test SMS!', 'success');
      } else {
        setTestResult({
          type: 'error',
          channel: 'sms',
          message: res.message || res.error || 'Hindi naipadala ang SMS. Suriin ang Twilio o Semaphore setup.',
        });
        toast(res.error || 'Nabigo ang Test SMS', 'danger');
      }
    } catch (err: any) {
      setTestResult({
        type: 'error',
        channel: 'sms',
        message: err.message || 'May naganap na error sa pagsubok.',
      });
      toast('May problema sa koneksyon.', 'danger');
    } finally {
      setTestingSms(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const targetEmail = user?.email;
      const res = await testChannel('email', targetEmail);
      if (res.success) {
        setTestResult({
          type: 'success',
          channel: 'email',
          message: res.message || 'Matagumpay na naipadala ang test Email!',
        });
        toast(res.message || 'Matagumpay ang Test Email!', 'success');
      } else {
        setTestResult({
          type: 'error',
          channel: 'email',
          message: res.message || res.error || 'Hindi naipadala ang Email. Suriin ang SMTP / Mail configuration.',
        });
        toast(res.error || 'Nabigo ang Test Email', 'danger');
      }
    } catch (err: any) {
      setTestResult({
        type: 'error',
        channel: 'email',
        message: err.message || 'May naganap na error sa pagsubok.',
      });
      toast('May problema sa koneksyon.', 'danger');
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
      {/* Title & Info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'rgba(35, 139, 69, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Bell size={20} color="#238B45" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Mga Kagustuhan sa Paalala (Push Notifications)</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)' }}>
              In-App, SMS, at Email Alerts para sa Iyong Bukid
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestSms}
            loading={testingSms}
            leftIcon={<Smartphone size={13} />}
            title="Magpadala ng test SMS sa iyong nakarehistrong numero"
          >
            Subukan ang SMS
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestEmail}
            loading={testingEmail}
            leftIcon={<Mail size={13} />}
            title="Magpadala ng test Email sa iyong nakarehistrong email"
          >
            Subukan ang Email
          </Button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginBottom: 16, lineHeight: 1.5 }}>
        Piliin kung saang paraan mo nais matanggap ang bawat kategorya ng paalala. Ang SMS ay diretsong ipapadala sa iyong mobile number, habang ang Email naman ay ipapadala sa iyong email inbox.
      </p>

      {/* Test Diagnostic Result Banner */}
      {testResult && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 8,
            border:
              testResult.type === 'success'
                ? '1px solid rgba(34, 197, 94, 0.3)'
                : '1px solid rgba(239, 68, 68, 0.3)',
            background:
              testResult.type === 'success'
                ? 'rgba(34, 197, 94, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
            color: testResult.type === 'success' ? '#15803D' : '#B91C1C',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          {testResult.type === 'success' ? (
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          ) : (
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          )}
          <div style={{ flex: 1 }}>
            <strong>{testResult.type === 'success' ? 'Tagumpay:' : 'Pansin:'}</strong>{' '}
            {testResult.message}
          </div>
        </div>
      )}

      {/* Emergency Bypass Notice */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.65)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 240 }}>
          <ShieldAlert size={20} color="#E11D48" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>
              Agarang Emergency Alerto (Critical Emergency Override)
            </div>
            <div style={{ fontSize: 11.5, color: '#64748B' }}>
              Kusang magpapadala ng agarang SMS at Email kapag kritikal ang lagay ng alaga kahit naka-off ang kategorya.
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={Boolean(preferences.critical_bypass)}
            onChange={() => handleToggle('critical_bypass', Boolean(preferences.critical_bypass))}
            style={{ width: 18, height: 18, accentColor: '#238B45' }}
          />
          <span>Bypass Aktibo</span>
        </label>
      </div>

      {/* Preferences Matrix Table */}
      <div
        style={{
          overflowX: 'auto',
          borderRadius: 10,
          border: '1px solid var(--border-light, rgba(0, 0, 0, 0.08))',
          background: 'rgba(255, 255, 255, 0.5)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(0, 0, 0, 0.03)', borderBottom: '1px solid var(--border-light, rgba(0, 0, 0, 0.08))' }}>
              <th style={{ padding: '12px 14px', fontWeight: 800 }}>Kategorya ng Paalala</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, width: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Bell size={14} color="#238B45" /> In-App
                </div>
              </th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, width: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Smartphone size={14} color="#0284C7" /> SMS
                </div>
              </th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, width: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Mail size={14} color="#D97706" /> Email
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ROWS.map((row, idx) => {
              const inAppVal = Boolean(preferences[row.inAppKey]);
              const smsVal = Boolean(preferences[row.smsKey]);
              const emailVal = Boolean(preferences[row.emailKey]);

              return (
                <tr
                  key={row.key}
                  style={{
                    borderBottom:
                      idx === CATEGORY_ROWS.length - 1
                        ? 'none'
                        : '1px solid var(--border-light, rgba(0, 0, 0, 0.05))',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.015)',
                  }}
                >
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text, #1E293B)' }}>{row.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary, #64748B)', marginTop: 2 }}>
                      {row.description}
                    </div>
                  </td>

                  {/* In-App Toggle */}
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={inAppVal}
                      disabled={savingKey === row.inAppKey}
                      onChange={() => handleToggle(row.inAppKey, inAppVal)}
                      style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#238B45' }}
                      title="Toggle In-App notification"
                    />
                  </td>

                  {/* SMS Toggle */}
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={smsVal}
                      disabled={savingKey === row.smsKey}
                      onChange={() => handleToggle(row.smsKey, smsVal)}
                      style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#0284C7' }}
                      title="Toggle SMS notification"
                    />
                  </td>

                  {/* Email Toggle */}
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={emailVal}
                      disabled={savingKey === row.emailKey}
                      onChange={() => handleToggle(row.emailKey, emailVal)}
                      style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#D97706' }}
                      title="Toggle Email notification"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#64748B', marginTop: 12 }}>
        <Info size={13} color="#238B45" />
        <span>Kusang nase-save ang bawat pagbabago sa mga checkbox sa itaas.</span>
      </div>
    </Card>
  );
}
