import { useState, useEffect } from 'react';
import { useFarmData } from '../lib/useFarmData';
import { supabase } from '../lib/supabase';
import { isAdminRole, useAuth } from '../lib/auth';
import { useToast } from '../components/ui/Toast';
import { KeyRound, Eye, EyeOff, User, Building2, ShieldCheck, Camera } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, FormField } from '../components/ui/Input';
import { NotificationPreferencesCard } from '../components/domain/notifications/NotificationPreferencesCard';
import { getFarmCameraGateSettings, saveFarmCameraGateSettings } from '../lib/gateDetection';

export function SettingsPage() {
  const farmData = useFarmData();
  const { user, profile } = useAuth();
  const toast = useToast();
  const canManageCameraCounting = profile?.role === 'farm_manager' || isAdminRole(profile?.role ?? null);
  const [cameraGateLineY, setCameraGateLineY] = useState(0.55);
  const [savedCameraGateLineY, setSavedCameraGateLineY] = useState(0.55);
  const [cameraGateSettingsReady, setCameraGateSettingsReady] = useState(false);
  const [cameraGateSettingsAvailable, setCameraGateSettingsAvailable] = useState(false);
  const [savingCameraGateSettings, setSavingCameraGateSettings] = useState(false);
  const [cameraGateSettingsError, setCameraGateSettingsError] = useState('');
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  // ── Change Password ──────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    setPwError('');
    if (!pwForm.newPw) { setPwError('Kailangan ang bagong password.'); return; }
    if (pwForm.newPw.length < 6) { setPwError('Dapat may hindi bababa sa 6 na karakter ang password.'); return; }
    if (pwForm.newPw !== pwForm.confirm) { setPwError('Hindi magkatugma ang mga password.'); return; }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.newPw });
      if (error) throw error;
      toast('Matagumpay na napalitan ang password.', 'success');
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch {
      setPwError('Hindi napalitan ang password. Suriin ang iyong koneksyon at subukan muli.');
    } finally {
      setSavingPw(false);
    }
  };

  // Owner & Public Profile contact & privacy state
  const [ownerName, setOwnerName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [farmLocation, setFarmLocation] = useState('');
  const [showContactNumber, setShowContactNumber] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showFarmLocation, setShowFarmLocation] = useState(true);

  useEffect(() => {
    if (profile?.full_name) {
      setOwnerName(profile.full_name);
    } else if (user?.user_metadata?.full_name) {
      setOwnerName(user.user_metadata.full_name);
    }
    if (user?.user_metadata?.phone) {
      setContactNumber(user.user_metadata.phone);
    }
    if (user?.user_metadata?.location || user?.user_metadata?.farm_location) {
      setFarmLocation(user.user_metadata.location || user.user_metadata.farm_location);
    }
    if (user?.user_metadata?.show_contact_number !== undefined) {
      setShowContactNumber(Boolean(user.user_metadata.show_contact_number));
    }
    if (user?.user_metadata?.show_email !== undefined) {
      setShowEmail(Boolean(user.user_metadata.show_email));
    }
    if (user?.user_metadata?.show_farm_location !== undefined) {
      setShowFarmLocation(Boolean(user.user_metadata.show_farm_location));
    }
  }, [user, profile]);

  const [form, setForm] = useState({
    farm_name: 'AlpasFarm',
    target_weight_kg: 40,
    gestation_days: 150,
    expiry_warning_days: 15,
    vaccine_due_days: 30,
    breeding_min_age_months: 8,
    breeding_min_weight_kg: 25,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !canManageCameraCounting) return;
    let cancelled = false;
    setCameraGateSettingsReady(false);
    setCameraGateSettingsAvailable(false);
    setCameraGateSettingsError('');
    void getFarmCameraGateSettings().then((settings) => {
      if (cancelled) return;
      setCameraGateSettingsAvailable(true);
      setCameraGateLineY(settings.gate_line_y);
      setSavedCameraGateLineY(settings.gate_line_y);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setCameraGateSettingsError(error instanceof Error
          ? error.message
          : 'Hindi makuha ang naka-save na configuration ng counting line.');
      }
    }).finally(() => {
      if (!cancelled) setCameraGateSettingsReady(true);
    });
    return () => { cancelled = true; };
  }, [canManageCameraCounting, user?.id]);

  const handleSaveCameraGateSettings = async () => {
    if (!user || savingCameraGateSettings || !cameraGateSettingsReady) return;
    if (!navigator.onLine) {
      setCameraGateSettingsError('Kailangan ng internet para ma-save ang counting settings.');
      return;
    }
    setSavingCameraGateSettings(true);
    setCameraGateSettingsError('');
    try {
      const saved = await saveFarmCameraGateSettings({
        gate_line_y: cameraGateLineY,
        entry_flow: 'top-to-bottom',
      });
      setCameraGateLineY(saved.gate_line_y);
      setSavedCameraGateLineY(saved.gate_line_y);
      toast('Na-save ang CCTV counting settings. Awtomatikong makukuha ng gateway ang bagong pwesto.', 'success');
    } catch (error) {
      setCameraGateSettingsError(error instanceof Error
        ? error.message
        : 'Hindi na-save ang CCTV counting settings. Suriin ang koneksyon at subukan muli.');
    } finally {
      setSavingCameraGateSettings(false);
    }
  };

  useEffect(() => {
    if (farmData.settings) {
      setForm({
        farm_name: farmData.settings.farm_name,
        target_weight_kg: Number(farmData.settings.target_weight_kg),
        gestation_days: farmData.settings.gestation_days,
        expiry_warning_days: farmData.settings.expiry_warning_days,
        vaccine_due_days: farmData.settings.vaccine_due_days,
        breeding_min_age_months: farmData.settings.breeding_min_age_months,
        breeding_min_weight_kg: Number(farmData.settings.breeding_min_weight_kg),
      });
    }
  }, [farmData.settings]);

  const handleSave = async () => {
    if (!user) return;
    if (!navigator.onLine) {
      toast('Walang internet connection. Kailangan ng internet para ma-save ang pagbabagong ito.', 'danger');
      return;
    }
    setSaving(true);
    try {
      if (farmData.settings && !farmData.settings.id.startsWith('default-settings-')) {
        let updateQuery = supabase.from('settings').update({ ...form, user_id: user.id }).eq('id', farmData.settings.id);
        if (profile?.role !== 'super_admin') {
          updateQuery = updateQuery.eq('user_id', user.id);
        }
        const { error } = await updateQuery;
        if (error) throw error;
      } else {
        const { error } = await supabase.from('settings').insert({ ...form, user_id: user.id });
        if (error) throw error;
      }
      // Update owner profile & public privacy settings
      await supabase.auth.updateUser({
        data: {
          full_name: ownerName,
          phone: contactNumber,
          location: farmLocation,
          farm_location: farmLocation,
          show_contact_number: showContactNumber,
          show_email: showEmail,
          show_farm_location: showFarmLocation,
        },
      });

      if (profile?.id) {
        await supabase.from('profiles').update({ full_name: ownerName }).eq('id', profile.id);
      }

      toast('Matagumpay na na-save ang mga setting at profile.', 'success');
      farmData.refresh();
    } catch {
      toast('Hindi na-save ang mga setting. Suriin ang iyong koneksyon at subukan muli.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const numField = (label: string, key: keyof typeof form, hint?: string) => (
    <FormField label={label} hint={hint}>
      <Input
        type="number"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </FormField>
  );

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Mga Setting</h1>
        <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>
          Isaayos ang iyong profile at mga kagustuhan sa bukid.
        </p>
      </div>

      {/* ── Profile Section ── */}
      <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <User size={16} color="var(--color-primary, #238B45)" />
          Account
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 12 }}>Naka-sign in bilang</div>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{user?.email}</div>
        </div>

        {/* Change Password */}
        <div style={{ borderTop: '1px solid var(--border-light, rgba(255,255,255,0.08))', paddingTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <KeyRound size={15} color="var(--color-text-secondary, #475569)" />
            <span style={{ fontWeight: 700, fontSize: 14 }}>Palitan ang Password</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <FormField label="Bagong Password">
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Hindi bababa sa 6 na karakter"
                  value={pwForm.newPw}
                  onChange={(e) => setPwForm({ ...pwForm, newPw: e.target.value })}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary, #475569)' }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </FormField>
            <FormField label="Kumpirmahin ang Bagong Password">
              <Input
                type={showPw ? 'text' : 'password'}
                placeholder="I-type muli ang bagong password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
              />
            </FormField>
          </div>
          {pwError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.10)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12, marginTop: 8 }}>
              {pwError}
            </div>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleChangePassword}
            loading={savingPw}
            disabled={savingPw || !pwForm.newPw}
            leftIcon={<KeyRound size={13} />}
            style={{ marginTop: 10 }}
          >
            I-save ang Bagong Password
          </Button>
        </div>
      </Card>

      {/* ── Impormasyon ng Bukid at Pampublikong Profile ── */}
      <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
          <Building2 size={16} color="var(--color-primary, #238B45)" />
          Impormasyon ng Bukid at Pampublikong Profile
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginBottom: 16 }}>
          Pamahalaan ang mga detalye ng iyong bukid at piliin kung anong impormasyon sa pakikipag-ugnayan ang makikita sa pampublikong QR profile ng iyong mga alaga.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
          <FormField label="Pangalan ng Bukid" hint="Halimbawa: Dela Cruz Goat Farm o AlpasFarm">
            <Input value={form.farm_name} onChange={(e) => setForm({ ...form, farm_name: e.target.value })} />
          </FormField>
          <FormField label="Pangalan ng May-ari" hint="Makikita sa public contact card kung papahintulutan">
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Juan Dela Cruz" />
          </FormField>
          <FormField label="Numero ng Telepono / Mobile" hint="Gagamitin para sa tawag o mensahe mula sa public QR">
            <Input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="09123456789" />
          </FormField>
          <FormField label="Lokasyon ng Bukid" hint="Halimbawa: Bongabong, Oriental Mindoro">
            <Input value={farmLocation} onChange={(e) => setFarmLocation(e.target.value)} placeholder="Bongabong, Oriental Mindoro" />
          </FormField>
        </div>

        <details className="farmer-settings-more" style={{ marginBottom: 0 }}>
          <summary>Privacy ng animal QR profile</summary>
          <div className="farmer-settings-more-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--color-text-primary, #1e293b)' }}>
            <ShieldCheck size={15} color="var(--color-primary, #238B45)" />
            Piliin ang impormasyong makikita sa QR profile
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showContactNumber}
                onChange={(e) => setShowContactNumber(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--color-primary, #238B45)' }}
              />
              <span>Ipakita ang Numero ng Telepono sa Public Profile</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showEmail}
                onChange={(e) => setShowEmail(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--color-primary, #238B45)' }}
              />
              <span>Ipakita ang Email Address sa Public Profile</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showFarmLocation}
                onChange={(e) => setShowFarmLocation(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--color-primary, #238B45)' }}
              />
              <span>Ipakita ang Lokasyon ng Bukid sa Public Profile</span>
            </label>
          </div>
          </div>
        </details>
      </Card>

      {canManageCameraCounting && (
        <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            <Camera size={16} color="var(--color-primary, #238B45)" />
            CCTV Counting Settings
          </div>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 12, margin: '0 0 16px' }}>
            Dito lang baguhin ang counting line. Awtomatikong kukunin ng camera gateway ang naka-save na pwesto; hindi mabubura o mare-reset ang kasalukuyan at nakaraang bilang.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, alignItems: 'start' }}>
            <label style={{ display: 'grid', gap: 8, fontSize: 13, fontWeight: 700 }}>
              <span>Counting Line Position</span>
              <strong style={{ color: 'var(--color-primary, #238B45)', fontSize: 18 }}>
                {cameraGateSettingsReady ? `${Math.round(cameraGateLineY * 100)}% down` : 'Loading…'}
              </strong>
              <input
                aria-label="Counting line position"
                type="range"
                min="25"
                max="75"
                step="1"
                value={Math.round(cameraGateLineY * 100)}
                disabled={!cameraGateSettingsReady || !cameraGateSettingsAvailable || savingCameraGateSettings}
                onChange={(event) => {
                  setCameraGateLineY(Number(event.target.value) / 100);
                  setCameraGateSettingsError('');
                }}
                style={{ width: '100%', accentColor: 'var(--color-primary, #238B45)' }}
              />
              <small style={{ color: 'var(--color-text-secondary, #475569)', fontWeight: 400 }}>
                Pumili ng posisyon mula 25% hanggang 75% pababa sa camera frame.
              </small>
            </label>

            <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
              <strong style={{ fontSize: 13 }}>Entry Direction</strong>
              <div aria-label="Entry direction: Pababa = Pumasok" style={{ minHeight: 42, display: 'flex', alignItems: 'center', padding: '0 12px', border: '1px solid var(--glass-border, #d6e2d9)', borderRadius: 10, background: 'var(--alpafarm-surface-soft, #f3f8f4)', color: 'var(--color-text-primary, #174B2A)', fontSize: 14, fontWeight: 800 }}>
                Pababa = Pumasok
              </div>
              <small style={{ color: 'var(--color-text-secondary, #475569)' }}>OUTSIDE → INSIDE. Fixed na direksyon para sa lahat ng CCTV counting.</small>
            </div>
          </div>

          {cameraGateSettingsError && (
            <div role="alert" style={{ marginTop: 12, borderRadius: 9, border: '1px solid rgba(180,35,24,.2)', background: 'rgba(180,35,24,.07)', color: '#b42318', padding: '9px 12px', fontSize: 12 }}>
              {cameraGateSettingsError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <span style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 11 }} aria-live="polite">
              {cameraGateSettingsReady && !cameraGateSettingsError && Math.abs(cameraGateLineY - savedCameraGateLineY) < 0.005
                ? 'Naka-save ang configuration'
                : cameraGateSettingsReady && !cameraGateSettingsError ? 'May hindi pa naka-save na pagbabago' : ''}
            </span>
            <Button
              variant="primary"
              onClick={handleSaveCameraGateSettings}
              loading={savingCameraGateSettings}
              disabled={!cameraGateSettingsReady || !cameraGateSettingsAvailable || savingCameraGateSettings || Math.abs(cameraGateLineY - savedCameraGateLineY) < 0.005}
            >
              I-save ang Counting Settings
            </Button>
          </div>
        </Card>
      )}

      {/* ── MGA KAGUSTUHAN SA NOTIFICATION (IN-APP, SMS, EMAIL) ── */}
      <NotificationPreferencesCard contactPhone={contactNumber} />

      <details className="farmer-settings-more">
        <summary>Iba pang setting ng bukid</summary>
        <div className="farmer-settings-more-content">
          <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Pag-aanak</div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginBottom: 14 }}>
              Baguhin lamang kung iba ang karaniwang iskedyul ng inyong bukid.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              {numField('Tagal ng pagbubuntis (araw)', 'gestation_days', 'Karaniwang 150 araw para sa kambing at tupa.')}
              {numField('Pinakamababang edad sa pag-aanak (buwan)', 'breeding_min_age_months')}
              {numField('Pinakamababang timbang sa pag-aanak (kg)', 'breeding_min_weight_kg')}
            </div>
          </Card>

          <Card variant="glass" padding="lg" style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Mga paalala at target</div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #475569)', marginBottom: 14 }}>
              Ang mga halagang ito ang ginagamit para sa mga paalala at pagtatantya.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              {numField('Target na timbang (kg)', 'target_weight_kg', 'Gabay lamang sa pagtatantya ng timbang.')}
              {numField('Paalala bago mapaso (araw)', 'expiry_warning_days')}
              {numField('Paalala sa bakuna bago ang takdang araw', 'vaccine_due_days')}
            </div>
          </Card>
        </div>
      </details>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 30 }}>
        <Button variant="primary" onClick={handleSave} loading={saving}>
          I-save ang mga Setting
        </Button>
      </div>
    </div>
  );
}
