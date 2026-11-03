import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, RefreshCw, ScanEye, Stethoscope } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useFarmData } from '../lib/useFarmData';
import { isAnimalActive } from '../lib/animalLifecycle';
import type { Animal } from '../types';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import './HealthScreeningPage.css';

type ScreeningStatus = 'healthy' | 'watch' | 'attention';
interface ScreeningResult {
  species: 'goat' | 'sheep';
  status: ScreeningStatus;
  concern: string | null;
  possible_condition: string | null;
  possible_conditions?: string[];
  affected_area: string | null;
  recommendation: string;
  analysis_model?: string;
}
interface ScreeningHistoryRecord {
  id: string;
  animal_id: string;
  prediction?: string | null;
  visible_status: ScreeningStatus | null;
  observed_concern: string | null;
  affected_area: string | null;
  recommendation: string | null;
  indicators?: unknown;
  created_at: string;
}
type ScreeningSaveResult = { id: string } | { error: string };

const STATUS_LABEL: Record<ScreeningStatus, string> = {
  healthy: 'Maayos',
  watch: 'Bantayan',
  attention: 'Kailangan ng Atensyon',
};

function animalLabel(animal: Animal): string {
  return `${animal.species === 'Sheep' ? 'Tupa' : 'Kambing'} · ${animal.name} · Eartag ${animal.eartag_number ?? '—'}`;
}

function formatScreeningDate(value: string): string {
  return new Date(value).toLocaleString('fil-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function screeningSignature(screening: ScreeningResult): string {
  return JSON.stringify({
    status: screening.status,
    concern: screening.concern?.trim().toLocaleLowerCase('fil-PH') ?? '',
    affectedArea: screening.affected_area?.trim().toLocaleLowerCase('fil-PH') ?? '',
    possibleCondition: screening.possible_condition?.trim().toLocaleLowerCase('fil-PH') ?? '',
    conditions: [...(screening.possible_conditions ?? [])].sort(),
  });
}

function getPossibleConditionHints(indicators: unknown): string[] {
  if (!Array.isArray(indicators)) return [];
  return indicators.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as { type?: unknown; observation?: unknown };
    return item.type === 'possible_visual_condition' && typeof item.observation === 'string'
      ? [item.observation]
      : [];
  });
}

function getPossibleCondition(indicators: unknown): string | null {
  if (!Array.isArray(indicators)) return null;
  const entry = indicators.find((item) => item && typeof item === 'object'
    && (item as { type?: unknown }).type === 'ai_possible_condition');
  const observation = entry && typeof entry === 'object' ? (entry as { observation?: unknown }).observation : null;
  return typeof observation === 'string' ? observation : null;
}

function rememberLatestScan(signatures: Map<string, string>, animalId: string, record?: Partial<ScreeningHistoryRecord> | null): void {
  if (!record) return;
  const status = record.visible_status ?? (record.prediction === 'normal_appearance' ? 'healthy'
    : record.prediction === 'possible_health_concern' ? 'watch' : null);
  if (!status) return;
  signatures.set(animalId, JSON.stringify({
    status,
    concern: record.observed_concern?.trim().toLocaleLowerCase('fil-PH') ?? '',
    affectedArea: record.affected_area?.trim().toLocaleLowerCase('fil-PH') ?? '',
    conditions: getPossibleConditionHints(record.indicators).sort(),
  }));
}

export function HealthScreeningPage() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { animals } = useFarmData();
  const location = useLocation();
  const toast = useToast();
  const requestedAnimalId = (location.state as { animalId?: string } | null)?.animalId;
  const selectedAnimalIdRef = useRef(requestedAnimalId ?? '');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const screeningBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const lastSavedSignatureByAnimalRef = useRef(new Map<string, string>());
  const [selectedAnimalId, setSelectedAnimalId] = useState(requestedAnimalId ?? '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [cameraError, setCameraError] = useState('');
  const [cameraAspectRatio, setCameraAspectRatio] = useState(4 / 3);
  const [capturedImage, setCapturedImage] = useState('');
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedRecordId, setSavedRecordId] = useState('');
  const [history, setHistory] = useState<ScreeningHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [autoScanMessage, setAutoScanMessage] = useState('Pumili ng hayop.');

  const farmAnimals = useMemo(
    () => animals.filter((animal) => animal.user_id === user?.id && isAnimalActive(animal)),
    [animals, user?.id],
  );
  const selectedAnimal = farmAnimals.find((animal) => animal.id === selectedAnimalId) ?? null;
  const cameraSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (requestedAnimalId && farmAnimals.some((animal) => animal.id === requestedAnimalId)) {
      selectedAnimalIdRef.current = requestedAnimalId;
      setSelectedAnimalId(requestedAnimalId);
      return;
    }
    if (!selectedAnimalId && farmAnimals.length === 1) setSelectedAnimalId(farmAnimals[0].id);
  }, [farmAnimals, requestedAnimalId, selectedAnimalId]);

  useEffect(() => {
    selectedAnimalIdRef.current = selectedAnimalId;
  }, [selectedAnimalId]);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('off');
    setCameraError('');
    setCapturedImage('');
  }, []);

  const startCamera = useCallback(async (deviceId = selectedDeviceId) => {
    stopCamera();
    const requestId = cameraRequestRef.current;
    setCameraState('starting');
    setCameraError('');
    setCapturedImage('');
    setResult(null);
    setSavedRecordId('');
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const aspectRatio = stream.getVideoTracks()[0]?.getSettings().aspectRatio;
      if (aspectRatio && Number.isFinite(aspectRatio)) setCameraAspectRatio(aspectRatio);
      mediaStreamRef.current = stream;
      if (!videoRef.current) throw new Error('Hindi makita ang camera preview.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraState('on');
      const found = await navigator.mediaDevices.enumerateDevices();
      const cameras = found.filter((device) => device.kind === 'videoinput');
      setDevices(cameras);
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId);
    } catch (error) {
      if (requestId !== cameraRequestRef.current) return;
      stopCamera();
      setCameraState('error');
      const message = error instanceof Error ? error.message : '';
      setCameraError(/notallowed|permission/i.test(message)
        ? 'Payagan ang camera sa browser settings at subukan muli.'
        : /notfound|device/i.test(message)
          ? 'Walang camera na makita sa device na ito.'
          : 'Hindi mabuksan ang camera. Suriin ang camera access at subukan muli.');
    }
  }, [selectedDeviceId, stopCamera]);

  useEffect(() => () => {
    cameraRequestRef.current += 1;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!requestedAnimalId) return;
    setSelectedAnimalId(requestedAnimalId);
  }, [requestedAnimalId]);

  const loadHistory = useCallback(async (animalId: string) => {
    if (!user || !animalId) { setHistory([]); setHistoryError(''); return; }
    try {
      const { data, error } = await supabase
        .from('camera_health_screenings')
        .select('id,animal_id,prediction,visible_status,observed_concern,affected_area,recommendation,indicators,created_at')
        .eq('user_id', user.id)
        .eq('animal_id', animalId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) {
        // Older ALPASFARM databases do not have the newer observation columns yet.
        const legacy = await supabase
          .from('camera_health_screenings')
          .select('id,animal_id,prediction,recommendation,indicators,created_at')
          .eq('user_id', user.id)
          .eq('animal_id', animalId)
          .order('created_at', { ascending: false })
          .limit(8);
        if (!legacy.error) {
          const records = (legacy.data ?? []).map((record) => ({
            ...record,
            visible_status: record.prediction === 'normal_appearance' ? 'healthy'
              : record.prediction === 'possible_health_concern' ? 'watch' : null,
            observed_concern: null,
            affected_area: null,
          })) as ScreeningHistoryRecord[];
          setHistory(records);
          rememberLatestScan(lastSavedSignatureByAnimalRef.current, animalId, records[0]);
          setHistoryError('');
          return;
        }
        const minimal = await supabase
          .from('camera_health_screenings')
          .select('id,animal_id,prediction,created_at')
          .eq('user_id', user.id)
          .eq('animal_id', animalId)
          .order('created_at', { ascending: false })
          .limit(8);
        if (minimal.error) {
          setHistory([]);
          setHistoryError('Hindi makuha ang dating resulta. Subukang muli.');
          return;
        }
        const records = (minimal.data ?? []).map((record) => ({
          ...record,
          visible_status: record.prediction === 'normal_appearance' ? 'healthy'
            : record.prediction === 'possible_health_concern' ? 'watch' : null,
          observed_concern: null,
          affected_area: null,
        })) as ScreeningHistoryRecord[];
        setHistory(records);
        rememberLatestScan(lastSavedSignatureByAnimalRef.current, animalId, records[0]);
        setHistoryError('');
        return;
      }
      const records = (data ?? []) as ScreeningHistoryRecord[];
      setHistory(records);
      rememberLatestScan(lastSavedSignatureByAnimalRef.current, animalId, records[0]);
      setHistoryError('');
    } catch {
      setHistory([]);
      setHistoryError('Hindi makuha ang dating resulta. Suriin ang koneksyon at subukan muli.');
    }
  }, [user]);

  useEffect(() => {
    void loadHistory(selectedAnimalId);
  }, [loadHistory, selectedAnimalId]);

  const captureFrame = useCallback((): string => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      throw new Error('Hintaying luminaw ang camera preview bago magpatuloy.');
    }
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Hindi makuha ang larawan. Subukan muli.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }, []);

  const saveScreening = async (screening: ScreeningResult, animal: Animal): Promise<ScreeningSaveResult> => {
    if (!user) return { error: 'Mag-sign in muli bago i-save ang resulta.' };
    if (saveBusyRef.current) return { error: 'May ini-save pang resulta. Maghintay muna at subukan muli.' };
    saveBusyRef.current = true;
    setSaving(true);
    try {
      const riskLevel = screening.status === 'attention' ? 'HIGH' : screening.status === 'watch' ? 'MODERATE' : 'LOW';
      const values = {
        user_id: user.id,
        animal_id: animal.id,
        prediction: screening.status === 'healthy' ? 'normal_appearance' : 'possible_health_concern',
        model_version: `appearance-api:${screening.analysis_model || 'vision'}`,
        risk_level: riskLevel,
        indicators: [
          ...(screening.concern ? [{ area: screening.affected_area, observation: screening.concern }] : []),
          ...(screening.possible_condition ? [{ area: screening.affected_area, observation: screening.possible_condition, type: 'ai_possible_condition' }] : []),
          ...(screening.possible_conditions ?? []).map((condition) => ({ area: screening.affected_area, observation: condition, type: 'possible_visual_condition' })),
        ],
        recommendation: screening.recommendation,
        goat_detected: screening.species === 'goat',
        detected_species: screening.species,
        visible_status: screening.status,
        observed_concern: screening.concern,
        affected_area: screening.affected_area,
        screening_source: 'phone_camera',
      };
      let { data, error } = await supabase
        .from('camera_health_screenings')
        .insert(values)
        .select('id,created_at')
        .single();
      if (error && /column|schema cache|does not exist/i.test(error.message)) {
        const { detected_species: _species, visible_status: _status, observed_concern: _concern,
          affected_area: _area, screening_source: _source, ...legacyValues } = values;
        ({ data, error } = await supabase
          .from('camera_health_screenings')
          .insert(legacyValues)
          .select('id,created_at')
          .single());
        if (error && /column|schema cache|does not exist/i.test(error.message)) {
          ({ data, error } = await supabase
            .from('camera_health_screenings')
            .insert({ user_id: user.id, animal_id: animal.id, prediction: values.prediction, model_version: values.model_version })
            .select('id,created_at')
            .single());
        }
      }
      if (error || !data) {
        console.error('[health-screen] Failed to save screening:', error?.message ?? 'Database returned no saved record.');
        return { error: 'Hindi naitala ang scan. Suriin ang database permissions at subukan muli.' };
      }
      setSavedRecordId(data.id);
      lastSavedSignatureByAnimalRef.current.set(animal.id, screeningSignature(screening));
      await loadHistory(animal.id);
      return { id: data.id };
    } catch (error) {
      console.error('[health-screen] Failed to save screening:', error instanceof Error ? error.message : 'unknown error');
      return { error: 'Hindi naitala ang scan. Suriin ang koneksyon at database setup, pagkatapos ay subukan muli.' };
    } finally {
      saveBusyRef.current = false;
      setSaving(false);
    }
  };

  const requestScreening = useCallback(async (image: string, animal: Animal): Promise<ScreeningResult> => {
    if (!session?.access_token) throw new Error('Mag-sign in muli para magamit ang Health Camera.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 65_000);
    let response: Response;
    try {
      response = await fetch('/api/health/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ animalId: animal.id, image }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Matagal ang response ng AI. Pakisubukan muli.');
      throw new Error('Hindi available ang AI service ngayon. Pakisubukan muli.');
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({})) as ScreeningResult & { error?: string; code?: string; retry_after_seconds?: number };
    if (!response.ok) {
      const failure = new Error(payload.error || 'Hindi natapos ang scan.') as Error & { status?: number; retryAfterSeconds?: number };
      failure.status = response.status;
      failure.retryAfterSeconds = payload.retry_after_seconds;
      throw failure;
    }
    if (!['healthy', 'watch', 'attention'].includes(payload.status)
      || !['goat', 'sheep'].includes(payload.species)
      || typeof payload.recommendation !== 'string'
      || typeof payload.concern !== 'string' && payload.concern !== null
      || typeof payload.possible_condition !== 'string' && payload.possible_condition !== null) {
      throw new Error('Hindi kumpleto ang resulta. Kunan muli ang hayop.');
    }
    return payload;
  }, [session?.access_token]);

  const analyzeImage = async (image: string, animal = selectedAnimal) => {
    if (screeningBusyRef.current) return;
    if (!animal) { toast('Pumili muna ng Kambing o Tupa.', 'warning'); return; }
    if (!image) { toast('Kunan muna ng malinaw na larawan ang hayop.', 'warning'); return; }
    screeningBusyRef.current = true;
    setAnalyzing(true);
    setResult(null);
    setSavedRecordId('');
    try {
      setAutoScanMessage('Sinusuri ang larawan…');
      const screening = await requestScreening(image, animal);
      if (selectedAnimalIdRef.current !== animal.id) return;
      setResult(screening);
      if (lastSavedSignatureByAnimalRef.current.get(animal.id) === screeningSignature(screening)) {
        setSavedRecordId('already-saved');
        setAutoScanMessage('Pareho sa pinakahuling resulta kaya walang dobleng tala.');
      } else {
        setAutoScanMessage('Ini-save sa history…');
        const saved = await saveScreening(screening, animal);
        if ('id' in saved) setAutoScanMessage(`Na-save sa history ni ${animal.name}.`);
        else setAutoScanMessage(`Kumpleto ang pagsusuri, pero hindi na-save. ${saved.error}`);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Hindi natapos ang scan.', 'error');
      setAutoScanMessage(error instanceof Error ? error.message : 'Hindi natapos ang scan. Subukang muli.');
    } finally {
      screeningBusyRef.current = false;
      setAnalyzing(false);
    }
  };

  const captureAndAnalyze = async () => {
    if (screeningBusyRef.current) return;
    if (!selectedAnimal) { toast('Pumili muna ng Kambing o Tupa.', 'warning'); return; }
    if (cameraState !== 'on') { toast('Buksan muna ang camera.', 'warning'); return; }
    const animal = selectedAnimal;
    let image: string;
    try {
      image = captureFrame();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Hindi makunan ang larawan.', 'error');
      return;
    }
    setCapturedImage(image);
    setResult(null);
    setSavedRecordId('');
    setCameraError('');
    await analyzeImage(image, animal);
  };

  const saveResult = async () => {
    if (!selectedAnimal || !result) return;
    const saved = await saveScreening(result, selectedAnimal);
    if (!('id' in saved)) {
      toast(saved.error, 'error');
      return;
    }
    toast('Naitala ang resulta ng pagsusuri.', 'success');
  };

  useEffect(() => {
    if (!selectedAnimal) setAutoScanMessage('Pumili ng hayop.');
    else if (cameraState === 'off') setAutoScanMessage('Pindutin ang “Buksan ang Camera” para magsimula.');
  }, [cameraState, selectedAnimal]);

  const onAnimalChange = (animalId: string) => {
    selectedAnimalIdRef.current = animalId;
    setSelectedAnimalId(animalId);
    setCapturedImage('');
    setResult(null);
    setSavedRecordId('');
    setAutoScanMessage(animalId ? 'Pindutin ang “Buksan ang Camera” para magsimula.' : 'Pumili ng hayop.');
  };

  const cameraStatus = cameraState === 'on'
    ? analyzing ? { label: 'Sinusuri ang itsura', tone: 'loading' }
        : { label: 'Hinihintay ang Kambing/Tupa', tone: 'ready' }
    : cameraState === 'starting' ? { label: 'Inihahanda ang camera', tone: 'loading' }
      : cameraState === 'error' ? { label: 'Walang koneksyon', tone: 'offline' }
        : { label: 'Nakasara ang camera', tone: 'off' };
  const activeWorkflowStep = result ? 3
    : analyzing || capturedImage ? 2
      : cameraState === 'on' ? 1
        : selectedAnimal ? 1 : 0;
  const workflowSteps = ['Pumili ng hayop', 'Buksan ang camera', 'Kunan ang larawan', 'Suriin ang resulta'];

  return (
    <main className="health-screen-page">
      <header className="health-screen-heading">
        <div>
          <span className="health-screen-eyebrow"><Camera size={15} /> CAMERA SA BUKID</span>
          <h1>Suriin ang Hayop</h1>
          <p>Kunan ng isang malinaw na larawan ang hayop para sa AI appearance screening.</p>
        </div>
        <span className={`health-screen-camera-status is-${cameraStatus.tone}`} role="status" aria-live="polite">
          <span />{cameraStatus.label}
        </span>
      </header>

      <ol className="health-screen-workflow" aria-label="Mga hakbang sa health screening">
        {workflowSteps.map((step, index) => (
          <li className={index === activeWorkflowStep ? 'is-active' : index < activeWorkflowStep ? 'is-complete' : ''} key={step}>
            <span>{index < activeWorkflowStep ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      <div className="health-screen-workspace">
      <section className="health-screen-animal-card" aria-labelledby="health-screen-animal-title">
        <div className="health-screen-section-heading">
          <div><h2 id="health-screen-animal-title">Pumili ng Kambing o Tupa</h2></div>
          {selectedAnimal && <span className="health-screen-animal-kind">{selectedAnimal.species === 'Sheep' ? 'Tupa' : 'Kambing'}</span>}
        </div>
        <label className="health-screen-select-label" htmlFor="health-screen-animal">Hayop na susuriin</label>
        <select className="health-screen-animal-select" id="health-screen-animal" value={selectedAnimalId} onChange={(event) => onAnimalChange(event.target.value)}>
          <option value="">Pumili ng nakarehistrong hayop</option>
          {farmAnimals.map((animal) => <option key={animal.id} value={animal.id}>{animalLabel(animal)}</option>)}
        </select>
        {selectedAnimal
          ? <p className="health-screen-animal-summary"><strong>{selectedAnimal.name}</strong><span>Eartag {selectedAnimal.eartag_number ?? '—'}</span></p>
          : <p className="health-screen-selection-help">Pumili muna ng hayop para magamit ang camera at masuri ang larawan.</p>}
      </section>

      <section className="health-screen-camera-card" aria-label="Camera at mga kontrol">
        <div className="health-screen-camera-card-heading">
          <div>
            <span className="health-screen-section-kicker">LIVE SCAN</span>
            <h2>{analyzing ? 'Sinusuri ang larawan' : 'Camera preview'}</h2>
          </div>
          <span className="health-screen-frame-count"><ScanEye size={15} /> Isang larawan</span>
        </div>
        <div className="health-screen-camera-frame" style={{ aspectRatio: cameraAspectRatio }}>
          {capturedImage && <img className="health-screen-captured-image" src={capturedImage} alt="Larawang sinusuri" />}
          <video
            className={!capturedImage && cameraState === 'on' ? 'health-screen-video is-visible' : 'health-screen-video'}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) setCameraAspectRatio(videoWidth / videoHeight);
            }}
            aria-label="Live preview ng camera"
          />
          {!capturedImage && cameraState !== 'on' && (
            <div className="health-screen-camera-empty">
              <CameraOff size={34} />
              <strong>{cameraState === 'starting' ? 'Binubuksan ang camera…' : cameraState === 'error' ? 'Hindi mabuksan ang camera' : 'Handa nang magsimula'}</strong>
              <span>{cameraError || (!cameraSupported
                ? 'Hindi suportado ang camera sa browser o koneksyong ito. Buksan ang app sa HTTPS at payagan ang camera.'
                : 'Iharap ang Kambing o Tupa sa camera.')}</span>
            </div>
          )}
          {cameraState === 'on' && (!capturedImage || analyzing) && (
            <div className={`health-screen-camera-guide${analyzing ? ' is-scanning' : ''}`} role="status" aria-live="polite">
              <strong>{analyzing
                ? `Sinusuri ang ${selectedAnimal?.species === 'Sheep' ? 'Tupa' : 'Kambing'}…`
                : 'Iharap ang hayop sa camera'}</strong>
              <span>{analyzing
                ? 'Tinitingnan ang larawan para sa nakikitang senyales.'
                : 'Siguraduhing maliwanag at malinaw ang kuha.'}</span>
            </div>
          )}
          <canvas ref={canvasRef} hidden />
        </div>

        <div className="health-screen-status-message" role="status" aria-live="polite">
          {analyzing ? 'Sinusuri ang larawan…' : autoScanMessage}
        </div>
        {analyzing && (
          <div
            className="health-screen-progress"
            role="progressbar"
            aria-label="Pagsusuri ng larawan"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={0}
          >
            <span />
          </div>
        )}
        {devices.length > 1 && cameraState === 'on' && !analyzing && (
          <label className="health-screen-camera-select">
            Lumipat ng camera
            <select value={selectedDeviceId} onChange={(event) => { setSelectedDeviceId(event.target.value); void startCamera(event.target.value); }}>
              {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
            </select>
          </label>
        )}

        <div className="health-screen-controls">
          {cameraState === 'off' || cameraState === 'error' ? (
            <Button type="button" onClick={() => { void startCamera(); }} leftIcon={<Camera size={17} />} disabled={!selectedAnimal || !cameraSupported}>{cameraState === 'error' ? 'Subukan muli ang Camera' : 'Buksan ang Camera'}</Button>
          ) : cameraState === 'starting' ? (
            <Button type="button" loading disabled leftIcon={<Camera size={17} />}>Binubuksan ang camera…</Button>
          ) : (
            <Button type="button" onClick={() => { void captureAndAnalyze(); }} loading={analyzing} disabled={analyzing || !selectedAnimal} leftIcon={<ScanEye size={17} />}>
              {capturedImage ? 'Kunan Muli at Suriin' : 'Kunan at Suriin'}
            </Button>
          )}
        </div>
      </section>

      {result && selectedAnimal && (
        <section aria-live="polite" className={`health-screen-result is-${result.status}`}>
          <div className="health-screen-result-heading">
            <span className="health-screen-result-icon">{result.status === 'healthy' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</span>
            <div><span className="health-screen-section-kicker">AI HEALTH ASSESSMENT</span><h2>{STATUS_LABEL[result.status]}</h2><p>{selectedAnimal.species === 'Sheep' ? 'Tupa' : 'Kambing'} · {selectedAnimal.name} · Eartag {selectedAnimal.eartag_number ?? '—'}</p></div>
          </div>
          <div className="health-screen-result-details">
            <div><strong>Ano ang nakita ng AI</strong><p>{result.concern || 'Walang malinaw na nakababahalang senyales sa larawan.'}</p></div>
            <div><strong>Ano ang posibleng kondisyon</strong><p>{result.possible_condition || (result.status === 'healthy' ? 'Walang nakitang kundisyong sinusuportahan ng nakikitang ebidensya.' : 'May nakitang senyales, ngunit walang sapat na batayan upang pangalanan ang isang kondisyon.')}</p></div>
            <div><strong>Gaano kaseryoso</strong><p>{result.status === 'attention' ? 'Mataas — kailangan ng agarang pagsusuri ng beterinaryo.' : result.status === 'watch' ? 'Katamtaman — bantayan at ulitin ang pagsusuri kung magpatuloy.' : 'Mababa — walang malinaw na abnormal na palatandaan sa larawan.'}</p></div>
            {result.possible_conditions?.length ? <div><strong>Mga bahaging may nakitang senyales</strong><p>{result.possible_conditions.join(' · ')}</p></div> : null}
            {result.affected_area && <div><strong>Bahaging napansin</strong><p>{result.affected_area}</p></div>}
            <div><strong>Inirerekomenda</strong><p>{result.recommendation}</p></div>
          </div>
          {!savedRecordId ? (
              <Button type="button" onClick={() => { void saveResult(); }} loading={saving} disabled={saving} leftIcon={<Stethoscope size={17} />}>I-save ang resulta</Button>
          ) : (
            <>
              <div className="health-screen-saved" role="status"><CheckCircle2 size={17} /> Naitala na.</div>
              {result.status === 'attention' && <Button type="button" variant="secondary" onClick={() => navigate(`/animals/${selectedAnimal.id}?tab=health`)}>Tingnan ang tala ng hayop</Button>}
            </>
          )}
          {result.status !== 'healthy' && <Button type="button" variant="secondary" onClick={() => navigate(`/treatments?action=add&animalId=${encodeURIComponent(selectedAnimal.id)}`)}>Gumawa ng Treatment Record</Button>}
        </section>
      )}

      {selectedAnimal && (
        <section className="health-screen-history" aria-labelledby="health-screen-history-title">
          <div className="health-screen-section-heading">
            <div><span className="health-screen-section-kicker">KASAYSAYAN</span><h2 id="health-screen-history-title">Mga dating resulta</h2></div>
            <button className="health-screen-refresh" type="button" onClick={() => { void loadHistory(selectedAnimal.id); }} aria-label="I-refresh ang history" title="I-refresh ang history"><RefreshCw size={17} /></button>
          </div>
          {historyError && <p role="status" className="health-screen-history-error">{historyError}</p>}
          {!historyError && history.length === 0 && <p className="health-screen-history-empty">Wala pang naitalang health scan para sa hayop na ito.</p>}
          {history.map((record) => (
            <article className={`health-screen-history-item ${record.visible_status ? `is-${record.visible_status}` : ''}`} key={record.id}>
              <div><strong>{record.visible_status ? STATUS_LABEL[record.visible_status] : 'Dating screening'}</strong><span>{formatScreeningDate(record.created_at)}</span></div>
              {getPossibleCondition(record.indicators) && <p><b>Posibleng kondisyon:</b> {getPossibleCondition(record.indicators)}</p>}
              {record.observed_concern && <p>{record.affected_area ? `${record.affected_area}: ` : ''}{record.observed_concern}</p>}
              {!record.observed_concern && getPossibleConditionHints(record.indicators).length > 0 && <p><b>Nakitang senyales:</b> {getPossibleConditionHints(record.indicators).join(' · ')}</p>}
              {record.recommendation && <p className="health-screen-history-recommendation">{record.recommendation}</p>}
            </article>
          ))}
        </section>
      )}
      </div>
      <p className="health-screen-notice">Visual screening lang ito, hindi diagnosis. Hindi nito nasusuri ang mga sakit na hindi nakikita sa larawan; kumonsulta sa beterinaryo kung may sintomas o alalahanin kahit “Maayos” ang resulta. Iharap nang malinaw at maliwanag ang hayop sa camera para masuri ang nakikitang bahagi.</p>
    </main>
  );
}
