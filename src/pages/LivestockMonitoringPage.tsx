import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Circle,
  DoorOpen,
  Download,
  Eye,
  LoaderCircle,
  LogIn,
  LogOut,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Tag,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, type CameraDevice } from 'html5-qrcode';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { GateDetectionHistory } from '../components/gate/GateDetectionHistory';
import { CameraGatewayStatusCard } from '../components/gate/CameraGatewayStatusCard';
import { isAdminRole, useAuth } from '../lib/auth';
import { useFarmData } from '../lib/useFarmData';
import { useToast } from '../components/ui/Toast';
import { supabase } from '../lib/supabase';
import { isSupabaseAuthUserId } from '../lib/supabaseIdentity';
import { buildGateDetectionHistory } from '../lib/gateDetectionHistory';
import {
  captureGateActivityFrame,
  detectGateLivestock,
  getFarmCameraCount,
  getFarmCameraGateSettings,
  GateDetectionRequestError,
  getGateActivityStatus,
  getGateDetectorDiagnostics,
  predictGateActivity,
  waitForGateDetector,
  type GateActivityFrame,
  type GateActivityLabel,
  type GateDetectorStatus,
  type GatePrediction,
  type FarmCameraCrossing,
} from '../lib/gateDetection';
import {
  cancelGateSession,
  clearGateLiveTracks,
  ensureMainGate,
  finishGateSession,
  getGateCameraMetrics,
  getGateSession,
  getGateSessionSummary,
  getActiveAnimals,
  getActiveGateSession,
  getLatestGateSession,
  linkGateDetectionSightingQr,
  linkGateDetectionSightingEartag,
  listGateCameraCrossings,
  listGateAlerts,
  listGateDetectionSightings,
  listGateEvents,
  recordGateDetectionSighting,
  recordGateCameraCrossing,
  recordGateMovementAlert,
  recordGateMovement,
  recordGateMovementEartag,
  setGateAlertStatus,
  startGateSession,
  syncGateLiveTracks,
  verifyGateQr,
  type GateAlert,
  type GateCameraCrossing,
  type GateCameraMetrics,
  type GateDetectionSighting,
  type GateDirection,
  type GateEvent,
  type GateSession,
} from '../lib/gateMonitoring';
import { resolveFarmAnimalQr } from '../lib/gateQrVerification';
import { normalizeEartagNumber, resolveFarmAnimalEartag, shouldPlayNewActiveAlertSound } from '../lib/gateDomain';
import { GateAnimalTracker, type GateFlow, type GateTrack } from '../lib/gateTracking';
import { matchDetectionToTrack, matchEartagNumberToEarTrack, matchQrToEarTrack } from '../lib/gateQrAssociation';
import { createFarmCameraStreamTicket, getFarmCameraStatus, isFarmCameraActive, refreshFarmCameraStreamTicket, streamFarmCameraFrames } from '../lib/cameraStream';
import {
  cancelFarmCountingSession,
  loadFarmCountingOverview,
  startFarmCountingSession,
  type CameraCountingOverview,
  type CameraCountingSession,
} from '../lib/cameraCounting';
import type { Animal } from '../types';
import './LivestockMonitoringPage.css';

const SCANNER_ID = 'livestock-gate-qr-camera';
const MAX_FRAME_AGE_MS = 2_500;
const TRACK_BOX_RETENTION_MS = 5_000;
const QR_CROSSING_WINDOW_MS = 20_000;
// One frame can detect and track many goats/sheep at once. Pacing requests at
// 2 FPS keeps two active device previews under the API's per-user request limit
// while making the on-screen tracks look more responsive.
const DETECTION_INTERVAL_MS = 500;
const MAX_DETECTION_FRAME_EDGE = 960;
type CameraState = 'off' | 'starting' | 'scanning' | 'error';
type CameraSource = 'farm' | 'device';
type DetectorState = 'idle' | 'loading' | 'ready' | 'error';
type QrState = 'waiting' | 'detected' | 'verified' | 'unknown' | 'duplicate';
type ActivityState = 'idle' | 'checking' | 'waiting' | 'buffering' | 'estimating' | 'ready' | 'unavailable' | 'unsupported';

interface FarmCameraFrameWaiter {
  epoch: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

const ACTIVITY_LABELS_FIL: Record<GateActivityLabel, string> = {
  grazing: 'Kumakain ng damo',
  running: 'Tumatakbo',
  sitting: 'Nakaupo',
  standing: 'Nakatayo',
  walking: 'Naglalakad',
};

interface LiveFrame {
  detections: Array<{
    species: 'goat' | 'sheep';
    confidence: number;
    box: [number, number, number, number];
  }>;
  tracks: GateTrack[];
  qrReadingTrackIds: string[];
  at: number;
  message: string;
  image?: { width: number; height: number };
}

interface PendingQr {
  animal: Animal;
  rawValue: string;
  verificationId?: string;
  eartagNumber?: string;
  method?: 'qr' | 'eartag';
  trackingId: string;
  direction: GateDirection | null;
}

interface TrackQrIdentity {
  animalId: string;
  rawValue: string;
  species: 'goat' | 'sheep';
  method?: 'qr' | 'eartag';
  eartagNumber?: string;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid input syntax for type uuid/i.test(message)) {
    return 'Hindi makakonekta ang account sa tala ng bukid. Mag-sign in muli o humingi ng tulong sa tagapangasiwa.';
  }
  if (/permission|denied|notallowed/i.test(message)) return 'Hindi pinayagan ang camera. I-enable ang camera permission sa browser settings.';
  if (/no camera|notfound|device/i.test(message)) return 'Walang camera na makita sa device na ito.';
  if (/relation .* does not exist|schema cache|could not find the table/i.test(message)) {
    return 'Hindi pa handa ang talaan ng gate. Humingi ng tulong sa tagapangasiwa.';
  }
  return 'May aberya sa camera. Subukang muli.';
}

function animalSpecies(animal: Animal): 'goat' | 'sheep' {
  return animal.species.toLowerCase() === 'sheep' ? 'sheep' : 'goat';
}

function speciesLabel(species: string): string {
  return species.toLowerCase() === 'sheep' ? 'Tupa' : 'Kambing';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('fil-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function waitForCameraFrame(video: HTMLVideoElement, timeoutMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('canplay', check);
      video.removeEventListener('playing', check);
    };
    const check = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Nabuksan ang camera pero walang live video frame. Suriin ang Android Camera access at piliin ang rear camera.'));
    }, timeoutMs);
    video.addEventListener('loadeddata', check);
    video.addEventListener('canplay', check);
    video.addEventListener('playing', check);
    check();
  });
}

function getRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function supportsVideoCaptureStream(
  video: HTMLVideoElement,
): video is HTMLVideoElement & { captureStream(): MediaStream } {
  return typeof Reflect.get(video, 'captureStream') === 'function';
}

function StatTile({ label, value, icon, accent, detail }: {
  label: string;
  value: number | string;
  icon: ReactNode;
  accent?: string;
  detail?: string;
}) {
  return (
    <div className="gate-stat-tile">
      <span className="gate-stat-icon" style={{ color: accent }}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

export function LivestockMonitoringPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as { animalId?: string; cameraIntent?: 'monitor' | 'scan-qr' } | null;
  const requestedAnimalId = navigationState?.animalId
    ?? new URLSearchParams(location.search).get('animalId')
    ?? undefined;
  const requestedCameraIntent = navigationState?.cameraIntent;
  const { user, role } = useAuth();
  const farmData = useFarmData();
  const toast = useToast();
  const farmAnimals = useMemo(
    () => user ? farmData.animals.filter((animal) => animal.user_id === user.id) : [],
    [farmData.animals, user],
  );
  const expectedAnimals = useMemo(() => {
    const activeHerd = getActiveAnimals(farmAnimals);
    if (!requestedAnimalId) return activeHerd;
    const requested = activeHerd.find((animal) => animal.id === requestedAnimalId && animal.user_id === user?.id);
    return requested ? [requested] : [];
  }, [farmAnimals, requestedAnimalId, user?.id]);
  const canEditFarmGateSettings = role === 'farm_manager' || isAdminRole(role);

  const [session, setSession] = useState<GateSession | null>(null);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [cameraCrossings, setCameraCrossings] = useState<GateCameraCrossing[]>([]);
  const [detectionSightings, setDetectionSightings] = useState<GateDetectionSighting[]>([]);
  const [detectionHistoryLoading, setDetectionHistoryLoading] = useState(true);
  const [detectionHistoryError, setDetectionHistoryError] = useState('');
  const [cameraMetrics, setCameraMetrics] = useState<GateCameraMetrics | null>(null);
  const [alerts, setAlerts] = useState<GateAlert[]>([]);
  const [sessionSummary, setSessionSummary] = useState<{
    expected_animal_ids: string[];
    confirmed_animal_ids: string[];
    inside_animal_ids: string[];
    unaccounted_animal_ids: string[];
  } | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [cameraState, setCameraState] = useState<CameraState>('off');
  const [cameraMessage, setCameraMessage] = useState('');
  const [cameraSource, setCameraSource] = useState<CameraSource>(requestedCameraIntent ? 'device' : 'farm');
  const [farmCameraStreamActive, setFarmCameraStreamActive] = useState(false);
  const [farmCameraStreamVersion, setFarmCameraStreamVersion] = useState(0);
  const [cameraTestMode, setCameraTestMode] = useState(false);
  const [farmAnimalCount, setFarmAnimalCount] = useState<number | null>(null);
  const [farmAnimalCountAt, setFarmAnimalCountAt] = useState(0);
  const [farmEntriesTotal, setFarmEntriesTotal] = useState<number | null>(null);
  const [farmExitsTotal, setFarmExitsTotal] = useState<number | null>(null);
  const [farmGoatEntriesTotal, setFarmGoatEntriesTotal] = useState<number | null>(null);
  const [farmGoatExitsTotal, setFarmGoatExitsTotal] = useState<number | null>(null);
  const [farmSheepEntriesTotal, setFarmSheepEntriesTotal] = useState<number | null>(null);
  const [farmSheepExitsTotal, setFarmSheepExitsTotal] = useState<number | null>(null);
  const [farmRecentCrossings, setFarmRecentCrossings] = useState<FarmCameraCrossing[]>([]);
  const [farmCountingOverview, setFarmCountingOverview] = useState<CameraCountingOverview | null>(null);
  const [farmCountingError, setFarmCountingError] = useState('');
  const [farmCountingLoading, setFarmCountingLoading] = useState(true);
  const [farmCountingSaving, setFarmCountingSaving] = useState(false);
  const [farmCountingPeriodHours, setFarmCountingPeriodHours] = useState(12);
  const [selectedFarmSessionId, setSelectedFarmSessionId] = useState('');
  const [showFarmEndCountConfirm, setShowFarmEndCountConfirm] = useState(false);
  const [farmCompletionPopup, setFarmCompletionPopup] = useState<CameraCountingSession | null>(null);
  const [farmCameraLastConnectedAt, setFarmCameraLastConnectedAt] = useState<string | null>(null);
  const [farmCameraServerActive, setFarmCameraServerActive] = useState(false);
  const [farmGatewayOnline, setFarmGatewayOnline] = useState<boolean | null>(null);
  const [farmGatewayLastSeenAt, setFarmGatewayLastSeenAt] = useState<string | null>(null);
  const [farmGateLineY, setFarmGateLineY] = useState(0.55);
  const [farmGateSettingsReady, setFarmGateSettingsReady] = useState(false);
  const [farmGateSettingsRevision, setFarmGateSettingsRevision] = useState(0);
  const [farmGateGatewayAcknowledged, setFarmGateGatewayAcknowledged] = useState(false);
  const [farmGateSettingsError, setFarmGateSettingsError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [cameraFrameSize, setCameraFrameSize] = useState({ width: 0, height: 0 });
  const [farmCameraStreamSize, setFarmCameraStreamSize] = useState({ width: 16, height: 9 });
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [detectorState, setDetectorState] = useState<DetectorState>('idle');
  const [detectorStatus, setDetectorStatus] = useState<GateDetectorStatus | null>(null);
  const [detectorDiagnosticsError, setDetectorDiagnosticsError] = useState('');
  const [activityState, setActivityState] = useState<ActivityState>('idle');
  const [activityMessage, setActivityMessage] = useState('Handa kapag nagsimula ang camera.');
  const [activityEstimate, setActivityEstimate] = useState<{ label: GateActivityLabel; trackingId: string } | null>(null);
  const [liveFrame, setLiveFrame] = useState<LiveFrame>({
    detections: [], tracks: [], qrReadingTrackIds: [], at: 0, message: 'Hihintayin ang live camera.',
  });
  const [qrState, setQrState] = useState<QrState>('waiting');
  const [qrMessage, setQrMessage] = useState('Naghihintay ng eartag number.');
  const [pendingQr, setPendingQr] = useState<PendingQr | null>(null);
  const pendingQrRef = useRef<PendingQr | null>(null);
  const pendingQrByTrackRef = useRef<Map<string, PendingQr>>(new Map());
  const [cameraOrientation, setCameraOrientation] = useState<GateFlow>('top-to-bottom');
  const [crossingTotal, setCrossingTotal] = useState(0);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [clockNow, setClockNow] = useState(Date.now());
  const [savingEvent, setSavingEvent] = useState(false);
  const movementSaveInFlightRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertBusyId, setAlertBusyId] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const farmAutoStartUserRef = useRef<string | null>(null);
  const farmCompletionSeenRef = useRef<Set<string>>(new Set());
  const cameraFrameRef = useRef<HTMLDivElement | null>(null);
  const farmCameraImageRef = useRef<HTMLImageElement | null>(null);
  const farmCameraStreamControllerRef = useRef<AbortController | null>(null);
  const farmCameraFrameUrlRef = useRef<string | null>(null);
  const farmCameraFrameWaiterRef = useRef<FarmCameraFrameWaiter | null>(null);
  const farmCameraStreamEpochRef = useRef(0);
  const farmCameraBrowserReadyRef = useRef(false);
  const lastFarmCameraFrameAtRef = useRef(0);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingAnimationRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const sessionRef = useRef<GateSession | null>(null);
  const mountedRef = useRef(true);
  const scanLockedRef = useRef(false);
  const qrProcessingTrackIdsRef = useRef<Set<string>>(new Set());
  const qrFrameEvidenceRef = useRef<Map<string, { trackingId: string; rawValue: string; hits: number; at: number }>>(new Map());
  const eartagFrameEvidenceRef = useRef<Map<string, { trackingId: string; rawValue: string; hits: number; at: number }>>(new Map());
  const eartagLastAttemptRef = useRef<Map<string, number>>(new Map());
  const inferenceBusyRef = useRef(false);
  const lastFarmInferenceSequenceRef = useRef(0);
  const detectionPauseUntilRef = useRef(0);
  const transientDetectionFailuresRef = useRef(0);
  const activityEnabledRef = useRef(false);
  const activityBusyRef = useRef(false);
  const activityEpochRef = useRef(0);
  const activityFramesRef = useRef<GateActivityFrame[]>([]);
  const activityTrackIdRef = useRef<string | null>(null);
  const lastActivityFrameAtRef = useRef(0);
  const liveSyncBusyRef = useRef(false);
  const lastLiveSyncAtRef = useRef(0);
  const sightingPersistedAtRef = useRef<Map<string, number>>(new Map());
  const sightingSaveInFlightRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef(new GateAnimalTracker(cameraOrientation));
  const cameraOrientationRef = useRef(cameraOrientation);
  const configureCameraFlow = useCallback((flow: GateFlow) => {
    if (cameraOrientationRef.current !== flow) trackerRef.current = new GateAnimalTracker(flow);
    cameraOrientationRef.current = flow;
    setCameraOrientation(flow);
  }, []);
  const frameRef = useRef<LiveFrame>({ detections: [], tracks: [], qrReadingTrackIds: [], at: 0, message: '' });
  const soundContextRef = useRef<AudioContext | null>(null);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const soundReadyRef = useRef(false);
  const qrUnlockTimerRef = useRef<number | null>(null);
  const trackQrIdentityRef = useRef<Record<string, TrackQrIdentity>>({});
  const reportedAnomalyAlertsRef = useRef<Map<string, number>>(new Map());
  const [identifiedTrackIds, setIdentifiedTrackIds] = useState<Record<string, string>>({});

  const isMonitoring = session?.status === 'monitoring';
  const isCameraMonitoring = isMonitoring || cameraTestMode;
  const movementSets = useMemo(
    () => ({
      confirmed: new Set(sessionSummary?.confirmed_animal_ids ?? []),
      inside: new Set(sessionSummary?.inside_animal_ids ?? []),
      missing: session && session.status !== 'cancelled'
        ? sessionSummary?.unaccounted_animal_ids ?? session.expected_animal_ids
        : [],
    }),
    [session?.expected_animal_ids, sessionSummary],
  );
  const insideCount = movementSets.inside.size;
  const confirmedCount = movementSets.confirmed.size;
  const activeAlerts = useMemo(() => alerts.filter((alert) => alert.status === 'active'), [alerts]);
  const visibleTracks = useMemo(
    () => liveFrame.tracks.filter((track) =>
      track.consecutiveMisses === 0 && clockNow - track.lastSeenAt <= MAX_FRAME_AGE_MS,
    ),
    [clockNow, liveFrame],
  );
  const retainedBoxTracks = useMemo(
    () => liveFrame.tracks.filter((track) =>
      track.confirmed && clockNow - track.lastSeenAt <= TRACK_BOX_RETENTION_MS,
    ),
    [clockNow, liveFrame],
  );
  const visibleGoats = visibleTracks.filter((track) => track.species === 'goat').length;
  const visibleSheep = visibleTracks.filter((track) => track.species === 'sheep').length;
  const visibleUnidentified = visibleTracks.filter((track) => !identifiedTrackIds[track.id]).length;
  const detectionOverlayStyle = useMemo<CSSProperties>(() => {
    const image = liveFrame.image ?? (cameraSource === 'farm' ? farmCameraStreamSize : undefined);
    const { width: frameWidth, height: frameHeight } = cameraFrameSize;
    if (!image?.width || !image.height || !frameWidth || !frameHeight) return { display: 'none' };
    // Keep bounding boxes aligned with the pixels actually visible after CSS object-fit.
    const fit = cameraSource === 'farm' ? 'contain' : 'cover';
    const scale = fit === 'cover'
      ? Math.max(frameWidth / image.width, frameHeight / image.height)
      : Math.min(frameWidth / image.width, frameHeight / image.height);
    const drawnWidth = image.width * scale;
    const drawnHeight = image.height * scale;
    return {
      width: `${drawnWidth}px`,
      height: `${drawnHeight}px`,
      left: `${(frameWidth - drawnWidth) / 2}px`,
      top: `${(frameHeight - drawnHeight) / 2}px`,
    };
  }, [cameraFrameSize, cameraSource, farmCameraStreamSize, liveFrame.image]);
  const activityAnimalId = activityEstimate ? identifiedTrackIds[activityEstimate.trackingId] : undefined;
  const activityAnimal = activityAnimalId ? farmAnimals.find((animal) => animal.id === activityAnimalId) : undefined;
  const activityDisplayMessage = activityState === 'ready' && activityEstimate
    ? `${activityAnimal ? `${activityAnimal.tag_id} · ${activityAnimal.name}: ` : ''}${ACTIVITY_LABELS_FIL[activityEstimate.label]} (tinatayang kilos lang).`
    : activityMessage;
  const expectedForSession = useMemo(() => {
    if (session?.status !== 'monitoring') return expectedAnimals;
    const expectedIds = new Set(sessionSummary?.expected_animal_ids ?? session.expected_animal_ids);
    return getActiveAnimals(farmAnimals.filter((animal) => expectedIds.has(animal.id)));
  }, [expectedAnimals, farmAnimals, session, sessionSummary?.expected_animal_ids]);
  const sessionRosterAnimals = useMemo(() => {
    if (!session) return [];
    const expectedIds = new Set(session.expected_animal_ids);
    return getActiveAnimals(farmAnimals.filter((animal) => expectedIds.has(animal.id)));
  }, [farmAnimals, session]);
  const expectedCount = session?.status === 'monitoring'
    ? sessionSummary?.expected_animal_ids.length ?? session.expected_count
    : expectedAnimals.length;
  const expectedGoats = expectedForSession.filter((animal) => animalSpecies(animal) === 'goat').length;
  const expectedSheep = expectedForSession.filter((animal) => animalSpecies(animal) === 'sheep').length;
  const windowSecondsLeft = session?.status === 'monitoring'
    ? Math.max(0, Math.ceil((new Date(session.started_at).getTime() + session.reconciliation_window_minutes * 60_000 - clockNow) / 1_000))
    : 0;
  const reconciliationWindowComplete = Boolean(session?.status === 'monitoring' && windowSecondsLeft === 0);
  const windowCountdown = Math.floor(windowSecondsLeft / 60) + ':' + String(windowSecondsLeft % 60).padStart(2, '0');
  const detectionActive = cameraState === 'scanning'
    && detectorState === 'ready'
    && (cameraSource === 'farm' || (isCameraMonitoring && !reconciliationWindowComplete));
  const detectionHistory = useMemo(
    () => buildGateDetectionHistory(detectionSightings, events, cameraCrossings, farmAnimals),
    [cameraCrossings, detectionSightings, events, farmAnimals],
  );

  const refreshSessionData = useCallback(async (sessionId: string) => {
    const [nextSession, nextEvents, nextAlerts, nextSummary, nextCrossings, nextMetrics] = await Promise.all([
      getGateSession(sessionId),
      listGateEvents(sessionId),
      listGateAlerts(sessionId),
      getGateSessionSummary(sessionId),
      listGateCameraCrossings(sessionId),
      getGateCameraMetrics(sessionId),
    ]);
    if (!mountedRef.current) return;
    let nextSightings: GateDetectionSighting[] | null = null;
    try {
      nextSightings = await listGateDetectionSightings(sessionId);
    } catch (error) {
      setDetectionHistoryError('Hindi muna makuha ang detection history. Ilapat ang kinakailangang database update o subukan muli mamaya.');
      console.error('Hindi makuha ang camera detection history.', error);
    }
    if (!mountedRef.current) return;
    const flow = nextSession.entry_flow === 'bottom-to-top' ? 'bottom-to-top' : 'top-to-bottom';
    configureCameraFlow(flow);
    sessionRef.current = nextSession;
    setSession(nextSession);
    setEvents(nextEvents);
    setCameraCrossings(nextCrossings);
    if (nextSightings) {
      setDetectionSightings(nextSightings);
      setDetectionHistoryError('');
    }
    setDetectionHistoryLoading(false);
    setCameraMetrics(nextMetrics);
    setCrossingTotal(nextMetrics.crossing_count);
    setAlerts(nextAlerts);
    setSessionSummary(nextSummary);
  }, [configureCameraFlow]);

  const refreshDetectionSightings = useCallback(async (sessionId: string) => {
    try {
      const nextSightings = await listGateDetectionSightings(sessionId);
      if (!mountedRef.current) return;
      setDetectionSightings(nextSightings);
      setDetectionHistoryError('');
    } catch (error) {
      if (!mountedRef.current) return;
      setDetectionHistoryError('Hindi muna makuha ang detection history. Subukan muli mamaya.');
      console.error('Hindi makuha ang camera detection history.', error);
    } finally {
      if (mountedRef.current) setDetectionHistoryLoading(false);
    }
  }, []);
  const refreshCameraDevices = useCallback(async () => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (mountedRef.current) setCameraDevices(devices);
    } catch {
      // Camera labels and device access may be unavailable until the browser grants permission.
    }
  }, []);

  useEffect(() => { void refreshCameraDevices(); }, [refreshCameraDevices]);

  useEffect(() => {
    const frame = cameraFrameRef.current;
    if (!frame) return;
    if (typeof ResizeObserver === 'undefined') {
      const rect = frame.getBoundingClientRect();
      setCameraFrameSize({ width: rect.width, height: rect.height });
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCameraFrameSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let loadedSuccessfully = false;
    setFarmGateSettingsReady(false);
    setFarmGateSettingsError('');
    const refreshSettings = async () => {
      try {
        const settings = await getFarmCameraGateSettings();
        if (cancelled) return;
        loadedSuccessfully = true;
        setFarmGateLineY(settings.gate_line_y);
        setFarmGateSettingsRevision(settings.revision ?? 0);
        setFarmGateGatewayAcknowledged(settings.gateway_acknowledged ?? false);
        setFarmGateSettingsError('');
      } catch {
        if (!cancelled && !loadedSuccessfully) {
          setFarmGateSettingsError('Hindi makuha ang naka-save na configuration ng counting line.');
        }
      } finally {
        if (!cancelled) setFarmGateSettingsReady(true);
      }
    };
    void refreshSettings();
    const timer = window.setInterval(() => { void refreshSettings(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      farmCameraStreamEpochRef.current += 1;
      farmCameraStreamControllerRef.current?.abort();
      farmCameraStreamControllerRef.current = null;
      farmCameraFrameWaiterRef.current?.reject(new Error('Camera startup was cancelled.'));
      farmCameraFrameWaiterRef.current = null;
      if (farmCameraFrameUrlRef.current) URL.revokeObjectURL(farmCameraFrameUrlRef.current);
      farmCameraFrameUrlRef.current = null;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      farmCameraImageRef.current?.removeAttribute('src');
      const activeSession = sessionRef.current;
      if (activeSession?.status === 'monitoring') {
        void clearGateLiveTracks(activeSession.id).catch(() => undefined);
      }
      if (scanner) {
        void (async () => {
          try {
            if (scanner.getState() === 2 || scanner.getState() === 3) await scanner.stop();
            scanner.clear();
          } catch {
            // Camera resources are best-effort cleaned up when leaving the page.
          }
        })();
      }
      if (qrUnlockTimerRef.current !== null) window.clearTimeout(qrUnlockTimerRef.current);
      trackerRef.current.reset();
      void soundContextRef.current?.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      } else {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      }
      if (recordingAnimationRef.current !== null) {
        window.cancelAnimationFrame(recordingAnimationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user || cameraSource !== 'farm') return;
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const overview = await loadFarmCountingOverview(selectedFarmSessionId || undefined);
        if (cancelled) return;
        setFarmCountingOverview(overview);
        setFarmCountingError('');
        if (!selectedFarmSessionId && overview.selected_session_id) {
          setSelectedFarmSessionId(overview.selected_session_id);
        }
        const completed = overview.sessions.find((session) => session.status === 'COMPLETE');
        if (completed) {
          const key = `alpasfarm:counting-complete:${completed.id}`;
          let alreadyShown = false;
          try { alreadyShown = window.localStorage.getItem(key) === 'shown'; } catch { /* Popup is still guarded for this page lifetime. */ }
          if (!alreadyShown && !farmCompletionSeenRef.current.has(completed.id)) {
            farmCompletionSeenRef.current.add(completed.id);
            try { window.localStorage.setItem(key, 'shown'); } catch { /* Keep the popup available if storage is disabled. */ }
            setFarmCompletionPopup(completed);
          }
        }
      } catch (error) {
        if (!cancelled) setFarmCountingError(error instanceof Error ? error.message : 'Hindi makuha ang bilang mula sa database.');
      } finally {
        loading = false;
        if (!cancelled) setFarmCountingLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_500);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [cameraSource, selectedFarmSessionId, user?.id]);

  useEffect(() => {
    if (!user || cameraSource !== 'farm') return;
    let cancelled = false;
    const refreshStatus = () => {
      void getFarmCameraStatus().then((status) => {
        if (!cancelled) {
          setFarmCameraLastConnectedAt(status.last_frame_at);
          setFarmCameraServerActive(status.stream_connected);
          setFarmGatewayOnline(status.gateway_online);
          setFarmGatewayLastSeenAt(status.gateway_last_seen_at);
        }
      }).catch(() => undefined);
    };
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 10_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [cameraSource, user?.id]);

  useEffect(() => { pendingQrRef.current = pendingQr; }, [pendingQr]);

  useEffect(() => {
    if (!user || farmData.loading) return;
    if (!isSupabaseAuthUserId(user.id)) {
      setPageError('Hindi makakonekta ang account sa tala ng bukid. Mag-sign in muli o humingi ng tulong sa tagapangasiwa.');
      setPageLoading(false);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    setDetectionHistoryLoading(true);
    setDetectionHistoryError('');
    setPageError('');
    void (async () => {
      try {
        const activeSession = await getActiveGateSession(user.id);
        const latest = activeSession ?? await getLatestGateSession(user.id);
        if (cancelled) return;
        if (!latest) {
          setDetectionSightings([]);
          setDetectionHistoryLoading(false);
          return;
        }
        const [nextEvents, nextAlerts, nextSummary, nextCrossings, nextMetrics] = await Promise.all([
          listGateEvents(latest.id),
          listGateAlerts(latest.id),
          getGateSessionSummary(latest.id),
          listGateCameraCrossings(latest.id),
          getGateCameraMetrics(latest.id),
        ]);
        if (cancelled) return;
        let nextSightings: GateDetectionSighting[] | null = null;
        try {
          nextSightings = await listGateDetectionSightings(latest.id);
        } catch (error) {
          setDetectionHistoryError('Hindi muna makuha ang detection history. Ilapat ang kinakailangang database update o subukan muli mamaya.');
          console.error('Hindi makuha ang camera detection history.', error);
        }
        if (cancelled) return;
        const flow = latest.entry_flow === 'bottom-to-top' ? 'bottom-to-top' : 'top-to-bottom';
        configureCameraFlow(flow);
        sessionRef.current = latest;
        setSession(latest);
        setEvents(nextEvents);
        setCameraCrossings(nextCrossings);
        if (nextSightings) {
          setDetectionSightings(nextSightings);
          setDetectionHistoryError('');
        }
        setDetectionHistoryLoading(false);
        setCameraMetrics(nextMetrics);
        setCrossingTotal(nextMetrics.crossing_count);
        setAlerts(nextAlerts);
        setSessionSummary(nextSummary);
        seenAlertIdsRef.current = new Set(nextAlerts.map((alert) => alert.id));
        soundReadyRef.current = true;
      } catch (error) {
        if (!cancelled) {
          setPageError(friendlyError(error));
          setDetectionHistoryError('Hindi muna makuha ang detection history. Subukan muli mamaya.');
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
          setDetectionHistoryLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [configureCameraFlow, farmData.loading, user]);

  useEffect(() => {
    if (!session || !user) return;
    const channel = supabase
      .channel('gate-session-' + session.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'gate_events',
        filter: 'session_id=eq.' + session.id,
      }, () => { void refreshSessionData(session.id); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'gate_sessions',
        filter: 'id=eq.' + session.id,
      }, () => { void refreshSessionData(session.id); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'gate_alerts',
        filter: 'session_id=eq.' + session.id,
      }, () => { void refreshSessionData(session.id); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'gate_camera_crossings',
        filter: 'session_id=eq.' + session.id,
      }, () => { void refreshSessionData(session.id); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'gate_detection_sightings',
        filter: 'session_id=eq.' + session.id,
      }, () => { void refreshDetectionSightings(session.id); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshDetectionSightings, refreshSessionData, session?.id, user]);

  useEffect(() => {
    if (!isMonitoring && cameraState !== 'scanning') return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [cameraState, isMonitoring]);

  const playAlertTone = useCallback(async () => {
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;
      const context = soundContextRef.current ?? new AudioContextConstructor();
      soundContextRef.current = context;
      if (context.state === 'suspended') await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.45);
    } catch {
      // Visual alert remains available if the browser blocks audio.
    }
  }, []);

  useEffect(() => {
    if (!soundReadyRef.current || !soundEnabled) return;
    const newAlert = shouldPlayNewActiveAlertSound(soundEnabled, seenAlertIdsRef.current, alerts);
    for (const alert of alerts) seenAlertIdsRef.current.add(alert.id);
    if (newAlert) void playAlertTone();
  }, [activeAlerts, alerts, playAlertTone, soundEnabled]);

  useEffect(() => {
    if (cameraState !== 'scanning' || session?.status !== 'monitoring') return;
    const now = Date.now();
    for (const track of liveFrame.tracks) {
      const observation = track.movementAnomaly;
      if (
        observation === 'none' ||
        track.consecutiveHits < 2 ||
        track.confidence < 0.55 ||
        now - track.lastSeenAt > MAX_FRAME_AGE_MS
      ) continue;

      const identity = trackQrIdentityRef.current[track.id];
      if (!identity || identity.species !== track.species) continue;
      const alertKey = session.id + ':' + identity.animalId;
      const lastAlertAt = reportedAnomalyAlertsRef.current.get(alertKey) ?? 0;
      if (now - lastAlertAt < 10 * 60_000) continue;
      reportedAnomalyAlertsRef.current.set(alertKey, now);

      void (async () => {
        try {
          // Issue a fresh, short-lived QR proof so the alert can still be saved
          // if the crossing flow already used the original verification.
          const proof = await verifyGateQr(session.id, identity.rawValue, track.id);
          if (!proof.verified || !proof.verification_id || proof.animal_id !== identity.animalId) {
            throw new Error(proof.message || 'Hindi muling ma-verify ang eartag para sa movement alert.');
          }
          await recordGateMovementAlert({
            sessionId: session.id,
            verificationId: proof.verification_id,
            trackingId: track.id,
            species: track.species,
            observation,
          });
          if (mountedRef.current) {
            toast('Paunang galaw alert para sa eartag na ' + farmAnimals.find((animal) => animal.id === identity.animalId)?.tag_id + '. Suriin muna ang hayop.', 'warning');
            void refreshSessionData(session.id).catch(() => undefined);
          }
        } catch (error) {
          reportedAnomalyAlertsRef.current.delete(alertKey);
          if (mountedRef.current) setPageError(friendlyError(error));
        }
      })();
    }
  }, [cameraState, farmAnimals, liveFrame, refreshSessionData, session?.id, session?.status, toast]);

  const stopVideoRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const startVideoRecording = useCallback(() => {
    setRecordingError('');
    try {
      const mimeType = getRecordingMimeType();
      if (!mimeType) throw new Error('Hindi suportado ng browser ang video recording. Gumamit ng Chrome, Edge, o Firefox na updated.');

      let stream: MediaStream;
      if (cameraSource === 'farm') {
        const image = farmCameraImageRef.current;
        if (!image?.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
          throw new Error('Hintaying lumabas ang live frame bago mag-record.');
        }
        const canvas = recordingCanvasRef.current ?? document.createElement('canvas');
        recordingCanvasRef.current = canvas;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context || typeof canvas.captureStream !== 'function') {
          throw new Error('Hindi makapag-record ng farm feed ang browser na ito.');
        }
        let lastDrawAt = 0;
        const drawFrame = () => {
          const now = performance.now();
          if (now - lastDrawAt >= 100 && image.complete && image.naturalWidth > 0) {
            if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
            }
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            lastDrawAt = now;
          }
          recordingAnimationRef.current = window.requestAnimationFrame(drawFrame);
        };
        drawFrame();
        stream = canvas.captureStream(10);
      } else {
        const video = document.getElementById(SCANNER_ID)?.querySelector('video');
        if (!(video instanceof HTMLVideoElement) || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          throw new Error('Hintaying lumabas ang live frame bago mag-record.');
        }
        if (video.srcObject instanceof MediaStream) {
          stream = video.srcObject.clone();
        } else if (supportsVideoCaptureStream(video)) {
          stream = video.captureStream();
        } else {
          throw new Error('Hindi makapag-record ng camera ng device ang browser na ito.');
        }
      }

      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecordingError('Nagkaroon ng problema sa pag-record. Subukan muli.');
        stopVideoRecording();
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        if (recordingAnimationRef.current !== null) {
          window.cancelAnimationFrame(recordingAnimationRef.current);
          recordingAnimationRef.current = null;
        }
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        if (mountedRef.current) {
          setIsRecording(false);
          setRecordingSeconds(0);
        }

        if (chunks.length === 0) {
          if (mountedRef.current) setRecordingError('Walang video data na na-save. Subukan muli habang may live feed.');
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
        const filename = `alpasfarm-camera-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
        const url = URL.createObjectURL(blob);
        const download = document.createElement('a');
        download.href = url;
        download.download = filename;
        document.body.appendChild(download);
        download.click();
        download.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (mountedRef.current) toast('Na-save ang video sa device bilang ' + filename, 'success');
      };
      recorder.start(1_000);
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch (error) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      if (recordingAnimationRef.current !== null) {
        window.cancelAnimationFrame(recordingAnimationRef.current);
        recordingAnimationRef.current = null;
      }
      setRecordingError(error instanceof Error ? error.message : 'Hindi masimulan ang video recording.');
    }
  }, [cameraSource, stopVideoRecording, toast]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const stopScanner = useCallback(async () => {
    stopVideoRecording();
    farmCameraStreamEpochRef.current += 1;
    farmCameraStreamControllerRef.current?.abort();
    farmCameraStreamControllerRef.current = null;
    farmCameraFrameWaiterRef.current?.reject(new Error('Camera startup was cancelled.'));
    farmCameraFrameWaiterRef.current = null;
    farmCameraBrowserReadyRef.current = false;
    lastFarmCameraFrameAtRef.current = 0;
    if (farmCameraFrameUrlRef.current) URL.revokeObjectURL(farmCameraFrameUrlRef.current);
    farmCameraFrameUrlRef.current = null;
    farmCameraImageRef.current?.removeAttribute('src');
    setCameraMessage('');
    setFarmAnimalCount(null);
    setFarmAnimalCountAt(0);
    activityEpochRef.current += 1;
    activityEnabledRef.current = false;
    activityBusyRef.current = false;
    activityFramesRef.current = [];
    activityTrackIdRef.current = null;
    lastActivityFrameAtRef.current = 0;
    setActivityEstimate(null);
    setActivityState('idle');
    setActivityMessage('Handa kapag nagsimula ang camera.');
    const activeSession = sessionRef.current;
    const clearLiveTracks = () => {
      if (activeSession?.status === 'monitoring') {
        lastLiveSyncAtRef.current = 0;
        void clearGateLiveTracks(activeSession.id).catch(() => undefined);
      }
    };
    const scanner = scannerRef.current;
    setFarmCameraStreamActive(false);
    if (!scanner) {
      clearLiveTracks();
  const stoppedFrame = { detections: [], tracks: [], qrReadingTrackIds: [], at: Date.now(), message: 'Camera is off.' };
      frameRef.current = stoppedFrame;
      if (mountedRef.current) setLiveFrame(stoppedFrame);
      if (mountedRef.current) setCameraState('off');
      return;
    }
    scannerRef.current = null;
    try {
      const state = scanner.getState();
      if (state === 2 || state === 3) await scanner.stop();
      scanner.clear();
    } catch {
      // Ignore camera stop races, such as leaving the page during startup.
    }
    clearLiveTracks();
    const stoppedFrame = { detections: [], tracks: [], qrReadingTrackIds: [], at: Date.now(), message: 'Camera is off.' };
    frameRef.current = stoppedFrame;
    if (mountedRef.current) setLiveFrame(stoppedFrame);
    if (mountedRef.current) setCameraState('off');
  }, [stopVideoRecording]);

  const scheduleQrUnlock = useCallback((delayMs: number) => {
    if (qrUnlockTimerRef.current !== null) window.clearTimeout(qrUnlockTimerRef.current);
    qrUnlockTimerRef.current = window.setTimeout(() => {
      qrUnlockTimerRef.current = null;
      if (!mountedRef.current) return;
      scanLockedRef.current = false;
      setQrState('waiting');
      setQrMessage('Naghihintay ng susunod na mababasang eartag number.');
    }, delayMs);
  }, []);

  const handleQrDecoded = useCallback(async (rawValue: string, trackingId?: string) => {
    const activeSession = sessionRef.current;
    if (!user || (!trackingId && scanLockedRef.current)) return;
    if (trackingId && qrProcessingTrackIdsRef.current.has(trackingId)) return;
    if (trackingId) qrProcessingTrackIdsRef.current.add(trackingId);
    else scanLockedRef.current = true;
    setQrState('detected');
    if (!trackingId && !pendingQrRef.current) setPendingQr(null);
    let keepLockedForConfirmation = false;
    try {
      const resolution = resolveFarmAnimalQr(rawValue, user.id, farmAnimals);
      if (resolution.status !== 'verified') {
        setQrState('unknown');
        setQrMessage(resolution.message);
        return;
      }

      const visible = frameRef.current.tracks.filter((track) =>
        track.consecutiveMisses === 0 && Date.now() - track.lastSeenAt <= MAX_FRAME_AGE_MS,
      );
      const candidateTrack = trackingId
        ? visible.find((track) => track.id === trackingId)
        : visible.length === 1 ? visible[0] : undefined;
      if (!candidateTrack) {
        setQrState('unknown');
        setQrMessage(trackingId
          ? 'Nawala ang hayop sa kasalukuyang frame bago makumpirma ang QR. Susubukan muli kapag malinaw na.'
          : 'Para maiugnay nang tama ang QR, ilapit ito nang makita ang iisang hayop o hintaying matukoy ang puwesto ng eartag.');
        return;
      }
      if (candidateTrack.species !== animalSpecies(resolution.animal)) {
        setQrState('unknown');
        setQrMessage('Hindi tugma ang QR at nakikitang uri ng hayop. Walang galaw na itatala.');
        return;
      }
      const knownIdentity = trackQrIdentityRef.current[candidateTrack.id];
      if (knownIdentity) {
        if (knownIdentity.animalId !== resolution.animal.id) {
          setQrState('unknown');
          setQrMessage('May ibang QR nang nakakabit sa kasalukuyang track. Hintaying mawala ang dating track bago iugnay ang bagong hayop.');
        }
        return;
      }

      if (activeSession?.status !== 'monitoring') {
        trackQrIdentityRef.current[candidateTrack.id] = {
          animalId: resolution.animal.id,
          rawValue,
          method: 'qr',
          species: animalSpecies(resolution.animal),
        };
        setIdentifiedTrackIds((currentIds) => ({ ...currentIds, [candidateTrack.id]: resolution.animal.id }));
        setQrState('verified');
        setQrMessage(`Nabasa ang QR: ${resolution.animal.name} · ${resolution.animal.tag_id}`);
        if (!trackingId) {
          scheduleQrUnlock(4_000);
          keepLockedForConfirmation = true;
        }
        return;
      }
      const serverVerification = await verifyGateQr(activeSession.id, rawValue, candidateTrack.id);
      if (!serverVerification.verified || !serverVerification.verification_id || !serverVerification.animal_id) {
        setQrState('unknown');
        setQrMessage(serverVerification.message ?? 'Hindi na-verify ng Supabase ang QR na ito.');
        return;
      }
      const registeredAnimal = farmAnimals.find((animal) =>
        animal.id === serverVerification.animal_id && animal.user_id === user.id,
      );
      if (!registeredAnimal) {
        setQrState('unknown');
        setQrMessage('Na-verify ang QR sa server pero wala sa kasalukuyang farm list. I-refresh ang animal registry.');
        return;
      }
      // The camera tracker keeps running while Supabase verifies the QR. Use
      // its latest frame so a crossing during that request is not missed.
      const latestFrame = frameRef.current;
      const latestTracks = latestFrame.tracks.filter((track) =>
        track.consecutiveMisses === 0 && Date.now() - track.lastSeenAt <= MAX_FRAME_AGE_MS,
      );
      const linkedTrack = trackingId
        ? latestTracks.find((track) => track.id === candidateTrack.id && track.species === animalSpecies(registeredAnimal))
        : latestTracks.length === 1
          ? latestTracks.find((track) => track.id === candidateTrack.id && track.species === animalSpecies(registeredAnimal))
          : undefined;
      if (!linkedTrack) {
        setQrState('unknown');
        setQrMessage('Hindi naitugma ang QR sa parehong camera track. Iharap muli ang eartag habang malinaw itong nakikita.');
        return;
      }

      trackQrIdentityRef.current[linkedTrack.id] = {
        animalId: registeredAnimal.id,
        rawValue,
        method: 'qr',
        species: animalSpecies(registeredAnimal),
      };
      setIdentifiedTrackIds((currentIds) => ({ ...currentIds, [linkedTrack.id]: registeredAnimal.id }));
      void linkGateDetectionSightingQr({
        sessionId: activeSession.id,
        trackingId: linkedTrack.id,
        species: linkedTrack.species,
        confidence: linkedTrack.confidence,
        verificationId: serverVerification.verification_id,
      }).then((sighting) => {
        if (!mountedRef.current) return;
        setDetectionSightings((current) => [
          sighting,
          ...current.filter((item) => item.id !== sighting.id),
        ].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()).slice(0, 250));
        setDetectionHistoryError('');
      }).catch((error) => {
        if (!mountedRef.current) return;
        setDetectionHistoryError('Nakilala ang QR, pero hindi na-link sa detection history. Subukan muli ang QR.');
        console.error('Hindi maiugnay ang na-verify na QR sa detection history.', error);
      });
      const crossingIsRecent = Boolean(linkedTrack.lastCrossing && Date.now() - linkedTrack.lastCrossing.at <= QR_CROSSING_WINDOW_MS);
      const existingPending = pendingQrByTrackRef.current.get(linkedTrack.id);
      const nextPendingQr: PendingQr = existingPending ?? {
        animal: registeredAnimal,
        rawValue,
        verificationId: serverVerification.verification_id,
        method: 'qr',
        trackingId: linkedTrack.id,
        direction: crossingIsRecent
          ? linkedTrack.lastCrossing!.direction
          : null,
      };
      pendingQrByTrackRef.current.set(linkedTrack.id, nextPendingQr);
      if (!pendingQrRef.current) {
        pendingQrRef.current = nextPendingQr;
        setPendingQr(nextPendingQr);
      }
      setQrState('verified');
      setQrMessage(crossingIsRecent
        ? 'Nabasa ang QR ng ' + registeredAnimal.tag_id + ' at nakumpirma ang pagtawid nito.'
        : 'Nakilala ang ' + registeredAnimal.tag_id + '. Susubaybayan ang sariling pagtawid nito kahit may ibang hayop sa frame.');
      keepLockedForConfirmation = !trackingId;
    } catch (error) {
      setQrState('unknown');
      setQrMessage(friendlyError(error));
    } finally {
      if (trackingId) qrProcessingTrackIdsRef.current.delete(trackingId);
      else if (!keepLockedForConfirmation) scheduleQrUnlock(1_200);
    }
  }, [farmAnimals, scheduleQrUnlock, user]);

  const handleEartagDecoded = useCallback(async (rawNumber: string, trackingId: string) => {
    const number = normalizeEartagNumber(rawNumber);
    const activeSession = sessionRef.current;
    if (!number || !user || qrProcessingTrackIdsRef.current.has(trackingId)) return;
    const attemptKey = `${activeSession?.id ?? 'preview'}:${trackingId}:${number}`;
    const lastAttempt = eartagLastAttemptRef.current.get(attemptKey) ?? 0;
    if (Date.now() - lastAttempt < 8_000) return;
    qrProcessingTrackIdsRef.current.add(trackingId);
    eartagLastAttemptRef.current.set(attemptKey, Date.now());
    setQrState('detected');

    try {
      const visible = frameRef.current.tracks.filter((track) =>
        track.consecutiveMisses === 0 && Date.now() - track.lastSeenAt <= MAX_FRAME_AGE_MS,
      );
      const track = visible.find((candidate) => candidate.id === trackingId);
      if (!track) {
        setQrState('unknown');
        setQrMessage('Nawala ang hayop sa kasalukuyang kuha bago makumpirma ang numero. Hihintayin ang susunod na malinaw na kuha.');
        return;
      }

      const localResolution = resolveFarmAnimalEartag(number, user.id, farmAnimals);
      const existingIdentity = trackQrIdentityRef.current[track.id];
      if (existingIdentity) {
        if (existingIdentity.method === 'eartag' && existingIdentity.eartagNumber === number) return;
        setQrState('unknown');
        setQrMessage('May ibang pagkakakilanlan nang nakaugnay sa kasalukuyang hayop. Hindi papalitan ang nakatala nitong number.');
        return;
      }

      let registeredAnimal: Animal | undefined;
      if (activeSession?.status === 'monitoring') {
        const sighting = await linkGateDetectionSightingEartag({
          sessionId: activeSession.id,
          trackingId: track.id,
          species: track.species,
          confidence: track.confidence,
          eartagNumber: number,
        });
        if (mountedRef.current) {
          setDetectionSightings((current) => [
            sighting,
            ...current.filter((item) => item.id !== sighting.id),
          ].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()).slice(0, 250));
          setDetectionHistoryError('');
        }
        if (!sighting.eartag_verified || !sighting.animal_id) {
          setQrState('unknown');
          setQrMessage(localResolution.status === 'verified'
            ? `Hindi tugma ang Number ${number} sa uri ng hayop na nakita. Walang hayop na ikinabit sa OCR result.`
            : `Hindi Kilalang Eartag · Number ${number} is not registered sa farm.`);
          return;
        }
        registeredAnimal = farmAnimals.find((candidate) =>
          candidate.id === sighting.animal_id && candidate.user_id === user.id &&
          Number(candidate.eartag_number) === Number(number),
        );
        if (!registeredAnimal) {
          setQrState('unknown');
          setQrMessage(`Nakumpirma ang Number ${number} sa database pero wala ito sa kasalukuyang animal list. I-refresh ang talaan.`);
          return;
        }
      } else if (localResolution.status === 'verified') {
        registeredAnimal = localResolution.animal;
      }

      if (!registeredAnimal) {
        setQrState('unknown');
        setQrMessage(`Hindi Kilalang Eartag · Number ${number} is not registered sa farm.`);
        return;
      }
      if (animalSpecies(registeredAnimal) !== track.species) {
        setQrState('unknown');
        setQrMessage(`Hindi tugma ang Number ${number} at ang uri ng hayop sa camera. Walang galaw na itatala.`);
        return;
      }

      trackQrIdentityRef.current[track.id] = {
        animalId: registeredAnimal.id,
        rawValue: number,
        eartagNumber: number,
        method: 'eartag',
        species: track.species,
      };
      setIdentifiedTrackIds((currentIds) => ({ ...currentIds, [track.id]: registeredAnimal!.id }));
      setQrState('verified');
      setQrMessage(`${number} — ${registeredAnimal.name} · Number Verified`);

      if (activeSession?.status === 'monitoring') {
        const crossingIsRecent = Boolean(track.lastCrossing && Date.now() - track.lastCrossing.at <= QR_CROSSING_WINDOW_MS);
        const nextPending: PendingQr = {
          animal: registeredAnimal,
          rawValue: number,
          eartagNumber: number,
          method: 'eartag',
          trackingId: track.id,
          direction: crossingIsRecent ? track.lastCrossing!.direction : null,
        };
        pendingQrByTrackRef.current.set(track.id, nextPending);
        if (!pendingQrRef.current) {
          pendingQrRef.current = nextPending;
          setPendingQr(nextPending);
        }
      }
    } catch (error) {
      setQrState('unknown');
      setQrMessage(friendlyError(error));
      if (mountedRef.current) setDetectionHistoryError('Nabasa ang number, pero hindi ito na-save sa detection history.');
      console.error('Hindi mai-save ang multi-frame-verified eartag reading.', error);
    } finally {
      qrProcessingTrackIdsRef.current.delete(trackingId);
    }
  }, [farmAnimals, user]);

  const startScanner = useCallback(async (cameraId = selectedCameraId, source = cameraSource): Promise<boolean> => {
    await stopScanner();
    const farmStreamEpoch = source === 'farm' ? ++farmCameraStreamEpochRef.current : 0;
    const activityEpoch = ++activityEpochRef.current;
    activityFramesRef.current = [];
    activityTrackIdRef.current = null;
    activityEnabledRef.current = false;
    activityBusyRef.current = false;
    setActivityEstimate(null);
    if (source === 'farm') {
      setActivityState('unsupported');
      setActivityMessage('Kabuuang bilang lang ang kinukuha ng CCTV.');
    } else {
      setActivityState('checking');
      setActivityMessage('Sinusuri kung handa ang sheep activity model.');
      void getGateActivityStatus().then((status) => {
        if (!mountedRef.current || activityEpochRef.current !== activityEpoch) return;
        const expectedLabels = ['grazing', 'running', 'sitting', 'standing', 'walking'];
        const ready = status.model_loaded && status.supported_species.includes('sheep') &&
          expectedLabels.every((label) => status.classes.includes(label as GateActivityLabel));
        activityEnabledRef.current = ready;
        setActivityState(ready ? 'waiting' : 'unavailable');
        setActivityMessage(ready
          ? 'Naghihintay ng iisang tupa sa camera.'
          : 'Hindi naka-load ang sheep activity model sa ML server.');
      }).catch(() => {
        if (!mountedRef.current || activityEpochRef.current !== activityEpoch) return;
        setActivityState('unavailable');
        setActivityMessage('Hindi maabot ang sheep activity model.');
      });
    }
    if (qrUnlockTimerRef.current !== null) window.clearTimeout(qrUnlockTimerRef.current);
    qrUnlockTimerRef.current = null;
    scanLockedRef.current = false;
    setPageError('');
    setCameraMessage('');
    setFarmAnimalCount(null);
    setFarmAnimalCountAt(0);
    setCameraState('starting');
    setDetectorState('loading');
    setQrState('waiting');
    setQrMessage('Naghihintay ng eartag number.');

    if (source === 'farm') {
      lastFarmInferenceSequenceRef.current = 0;
      setDetectorState('ready');
    } else {
      void waitForGateDetector().then((status) => {
        if (mountedRef.current && activityEpochRef.current === activityEpoch) {
          setDetectorStatus(status);
          setDetectorState('ready');
        }
      }).catch((error) => {
        if (mountedRef.current && activityEpochRef.current === activityEpoch) {
          setDetectorState('error');
          setCameraMessage('Hindi ma-load ang goat/sheep detector: ' + friendlyError(error));
        }
      });
    }

    if (!mountedRef.current) return false;
    try {
      if (source === 'farm') {
        await createFarmCameraStreamTicket();
        if (!mountedRef.current || farmCameraStreamEpochRef.current !== farmStreamEpoch) return false;
        farmCameraBrowserReadyRef.current = false;
        lastFarmCameraFrameAtRef.current = 0;
        const firstFrame = new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            if (farmCameraFrameWaiterRef.current?.epoch !== farmStreamEpoch) return;
            farmCameraFrameWaiterRef.current = null;
            reject(new Error('Camera connected, pero walang video.'));
          }, 15_000);
          farmCameraFrameWaiterRef.current = {
            epoch: farmStreamEpoch,
            resolve: () => {
              window.clearTimeout(timeout);
              farmCameraFrameWaiterRef.current = null;
              resolve();
            },
            reject: (error) => {
              window.clearTimeout(timeout);
              farmCameraFrameWaiterRef.current = null;
              reject(error);
            },
          };
        });
        setFarmCameraStreamVersion((version) => version + 1);
        setFarmCameraStreamActive(true);
        await firstFrame;
        if (!mountedRef.current || farmCameraStreamEpochRef.current !== farmStreamEpoch) return false;
        setCameraState('scanning');
        return true;
      }
      const scanner = new Html5Qrcode(SCANNER_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } },
        { fps: 5, qrbox: { width: 230, height: 230 }, aspectRatio: 1 },
        (decodedText) => { void handleQrDecoded(decodedText); },
        () => undefined,
      );
      const video = document.getElementById(SCANNER_ID)?.querySelector('video');
      if (!(video instanceof HTMLVideoElement)) throw new Error('Nabuksan ang camera pero hindi lumabas ang video preview.');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('muted', 'true');
      video.setAttribute('playsinline', 'true');
      await video.play();
      await waitForCameraFrame(video);
      if (!mountedRef.current) return false;
      const activeCameraId = scanner.getRunningTrackSettings().deviceId;
      if (activeCameraId) setSelectedCameraId(activeCameraId);
      setCameraState('scanning');
      void refreshCameraDevices();
      return true;
    } catch (error) {
      if (source === 'farm' && farmCameraStreamEpochRef.current !== farmStreamEpoch) return false;
      try { scannerRef.current?.clear(); } catch { /* startup may not have mounted the camera yet */ }
      scannerRef.current = null;
      if (mountedRef.current) {
        setCameraState('error');
        const message = friendlyError(error);
        setCameraMessage(source === 'farm' && /frame|stream|camera connected/i.test(message)
          ? 'Camera connected, pero walang video.'
          : message);
        if (source === 'farm') setFarmCameraStreamActive(false);
      }
      return false;
    }
  }, [cameraSource, handleQrDecoded, refreshCameraDevices, selectedCameraId, stopScanner]);

  useEffect(() => {
    if (!user || cameraSource !== 'farm' || !farmGateSettingsReady || farmAutoStartUserRef.current === user.id) return;
    const timer = window.setTimeout(() => {
      if (farmAutoStartUserRef.current === user.id) return;
      farmAutoStartUserRef.current = user.id;
      void startScanner('', 'farm');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cameraSource, farmGateSettingsReady, startScanner, user?.id]);

  useEffect(() => {
    if (!isAdminRole(role) || cameraState !== 'scanning') return;
    let active = true;
    const refreshDiagnostics = async () => {
      try {
        const status = await getGateDetectorDiagnostics();
        if (active) {
          setDetectorStatus(status);
          setDetectorDiagnosticsError('');
        }
      } catch {
        if (active) setDetectorDiagnosticsError('Hindi ma-refresh ang detector diagnostics.');
      }
    };
    void refreshDiagnostics();
    const timer = window.setInterval(() => { void refreshDiagnostics(); }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [cameraState, role]);

  const handleCameraChange = useCallback((cameraId: string) => {
    setSelectedCameraId(cameraId);
    if (cameraState === 'scanning') void startScanner(cameraId, 'device');
  }, [cameraState, startScanner]);

  const handleCameraSourceChange = useCallback((source: CameraSource) => {
    setCameraSource(source);
    if (cameraState === 'scanning') void startScanner(selectedCameraId, source);
  }, [cameraState, selectedCameraId, startScanner]);

  useEffect(() => {
    if (cameraSource !== 'farm' || !farmCameraStreamActive) return;
    const controller = new AbortController();
    farmCameraStreamControllerRef.current = controller;
    let pendingFrame: Blob | null = null;
    let renderingFrame = false;
    const handleStreamError = (error: unknown) => {
      if (controller.signal.aborted || !mountedRef.current) return;
      const detail = error instanceof Error ? error.message : '';
      const message = /camera offline|sign in muli|hindi naka-enable/i.test(detail)
        ? detail
        : 'Camera connected, pero walang video.';
      farmCameraFrameWaiterRef.current?.reject(new Error(message));
      setCameraMessage(message);
      setCameraState('error');
      setFarmCameraStreamActive(false);
      controller.abort();
    };
    const renderLatestFrame = async () => {
      if (renderingFrame) return;
      renderingFrame = true;
      try {
        while (pendingFrame && !controller.signal.aborted && mountedRef.current) {
          const frame = pendingFrame;
          pendingFrame = null;
          const image = farmCameraImageRef.current;
          if (!image) continue;

          const nextUrl = URL.createObjectURL(frame);
          const previousUrl = farmCameraFrameUrlRef.current;
          try {
            if (typeof image.decode === 'function') {
              image.src = nextUrl;
              await image.decode();
            } else {
              await new Promise<void>((resolve, reject) => {
                const onLoad = () => { cleanup(); resolve(); };
                const onError = () => { cleanup(); reject(new Error('Camera frame could not be decoded.')); };
                const cleanup = () => {
                  image.removeEventListener('load', onLoad);
                  image.removeEventListener('error', onError);
                };
                image.addEventListener('load', onLoad, { once: true });
                image.addEventListener('error', onError, { once: true });
                image.src = nextUrl;
              });
            }
          } catch {
            URL.revokeObjectURL(nextUrl);
            throw new Error('Camera connected, pero walang video.');
          }

          if (controller.signal.aborted || !mountedRef.current || image.naturalWidth < 1 || image.naturalHeight < 1) {
            URL.revokeObjectURL(nextUrl);
            continue;
          }
          farmCameraFrameUrlRef.current = nextUrl;
          if (previousUrl) URL.revokeObjectURL(previousUrl);
          lastFarmCameraFrameAtRef.current = Date.now();
          if (!farmCameraBrowserReadyRef.current) {
            farmCameraBrowserReadyRef.current = true;
            setCameraMessage('');
            setCameraState('scanning');
            const waiter = farmCameraFrameWaiterRef.current;
            if (waiter?.epoch === farmCameraStreamEpochRef.current) waiter.resolve();
          }
        }
      } catch (error) {
        handleStreamError(error);
      } finally {
        renderingFrame = false;
        if (pendingFrame && !controller.signal.aborted && mountedRef.current) void renderLatestFrame();
      }
    };
    void streamFarmCameraFrames(controller.signal, (frame) => {
      // Keep just the newest frame while the browser decodes. This prevents a
      // slow device from displaying a growing queue of old camera images.
      pendingFrame = frame;
      if (!renderingFrame) void renderLatestFrame();
    }).catch(handleStreamError);
    return () => {
      controller.abort();
      pendingFrame = null;
      if (farmCameraStreamControllerRef.current === controller) farmCameraStreamControllerRef.current = null;
      if (farmCameraFrameUrlRef.current) URL.revokeObjectURL(farmCameraFrameUrlRef.current);
      farmCameraFrameUrlRef.current = null;
      farmCameraImageRef.current?.removeAttribute('src');
    };
  }, [cameraSource, farmCameraStreamActive, farmCameraStreamVersion]);

  useEffect(() => {
    if (cameraState !== 'scanning' || cameraSource !== 'farm' || !farmCameraStreamActive) return;
    let disposed = false;
    let checking = false;
    const verifyGateway = async () => {
      if (disposed || checking) return;
      checking = true;
      const active = await isFarmCameraActive();
      checking = false;
      if (disposed) return;
      const browserFrameIsRecent = lastFarmCameraFrameAtRef.current > 0 &&
        Date.now() - lastFarmCameraFrameAtRef.current <= 5_000;
      if (active && browserFrameIsRecent) return;
      setCameraMessage(active
        ? 'Camera connected, pero walang video.'
        : 'Camera offline — Pakicheck ang camera connection.');
      setCameraState('error');
      setFarmCameraStreamActive(false);
    };
    const timer = window.setInterval(() => { void verifyGateway(); }, 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cameraSource, cameraState, farmCameraStreamActive]);

  useEffect(() => {
    if (cameraState !== 'scanning' || cameraSource !== 'farm' || !farmCameraStreamActive) return;
    const timer = window.setInterval(() => { void refreshFarmCameraStreamTicket().catch(() => undefined); }, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [cameraSource, cameraState, farmCameraStreamActive]);

  useEffect(() => {
    if (!user || cameraSource !== 'farm' || cameraState !== 'error') return;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryDelay = 3_000;
    let retryInFlight = false;
    let retryPreview: () => Promise<void> = async () => undefined;
    const scheduleRetry = (delay: number) => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => { void retryPreview(); }, delay);
    };
    retryPreview = async () => {
      if (cancelled || retryInFlight) return;
      if (document.visibilityState !== 'visible') {
        scheduleRetry(5_000);
        return;
      }
      retryInFlight = true;
      let connected = false;
      try {
        connected = await startScanner('', 'farm');
      } catch {
        connected = false;
      } finally {
        retryInFlight = false;
      }
      if (cancelled || connected) return;
      retryDelay = Math.min(30_000, retryDelay * 2);
      scheduleRetry(retryDelay);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !retryInFlight) scheduleRetry(0);
    };
    scheduleRetry(retryDelay);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cameraSource, cameraState, startScanner, user?.id]);

  useEffect(() => {
    if (cameraState !== 'scanning' || detectorState !== 'ready'
      || (cameraSource !== 'farm' && (!isCameraMonitoring || reconciliationWindowComplete))) return;
    let disposed = false;
    const scanFrame = async () => {
      if (disposed || inferenceBusyRef.current || Date.now() < detectionPauseUntilRef.current) return;
      const container = document.getElementById(SCANNER_ID);
      const video = container?.querySelector('video');
      const farmImage = cameraSource === 'farm' ? farmCameraImageRef.current : null;
      const sourceElement = farmImage ?? (video instanceof HTMLVideoElement ? video : null);
      if (!sourceElement) return;
      const frameWidth = sourceElement instanceof HTMLVideoElement ? sourceElement.videoWidth : sourceElement.naturalWidth;
      const frameHeight = sourceElement instanceof HTMLVideoElement ? sourceElement.videoHeight : sourceElement.naturalHeight;
      if (!frameWidth || !frameHeight || (sourceElement instanceof HTMLVideoElement && sourceElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)) return;

      inferenceBusyRef.current = true;
      try {
        let canvas = canvasRef.current;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvasRef.current = canvas;
        }
        const scale = Math.min(1, MAX_DETECTION_FRAME_EDGE / frameWidth, MAX_DETECTION_FRAME_EDGE / frameHeight);
        canvas.width = Math.max(1, Math.round(frameWidth * scale));
        canvas.height = Math.max(1, Math.round(frameHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || !canvas.width || !canvas.height) return;
        context.drawImage(sourceElement, 0, 0, canvas.width, canvas.height);
        let predictions: GatePrediction[];
        let image: { width: number; height: number };
        let at: number;
        if (cameraSource === 'farm') {
          const farmResult = await getFarmCameraCount();
          if (disposed || !mountedRef.current) return;
          if (farmResult.frame_sequence <= lastFarmInferenceSequenceRef.current) return;
          lastFarmInferenceSequenceRef.current = farmResult.frame_sequence;
          const detectedAt = Date.parse(farmResult.detected_at);
          at = Number.isFinite(detectedAt) ? detectedAt : Date.now();
          setFarmAnimalCount(farmResult.animal_count);
          setFarmEntriesTotal(farmResult.entries_total);
          setFarmExitsTotal(farmResult.exits_total);
          setFarmGoatEntriesTotal(farmResult.goat_entries_total);
          setFarmGoatExitsTotal(farmResult.goat_exits_total);
          setFarmSheepEntriesTotal(farmResult.sheep_entries_total);
          setFarmSheepExitsTotal(farmResult.sheep_exits_total);
          setFarmRecentCrossings(farmResult.recent_crossings ?? []);
          setFarmAnimalCountAt(at);
          predictions = farmResult.predictions;
          image = farmResult.image;
        } else {
          const detectionResult = await detectGateLivestock(canvas);
          if (disposed || !mountedRef.current) return;
          predictions = detectionResult.predictions;
          image = detectionResult.image;
          at = Date.now();
        }

        const detections = predictions.map((prediction) => ({
          species: prediction.class,
          confidence: prediction.confidence,
          box: [
            prediction.bbox.x1 / image.width,
            prediction.bbox.y1 / image.height,
            prediction.bbox.x2 / image.width,
            prediction.bbox.y2 / image.height,
          ] as [number, number, number, number],
        }));
        const tracking = trackerRef.current.update(detections, at);
        const sightingSession = sessionRef.current;
        if (sightingSession?.status === 'monitoring' && !cameraTestMode) {
          for (const track of tracking.tracks) {
            if (
              !track.confirmed ||
              track.consecutiveHits < 2 ||
              track.consecutiveMisses !== 0 ||
              track.confidence < 0.55 ||
              at - track.lastSeenAt > MAX_FRAME_AGE_MS
            ) continue;
            const sightingKey = sightingSession.id + ':' + track.id;
            const lastPersistedAt = sightingPersistedAtRef.current.get(sightingKey) ?? 0;
            if (at - lastPersistedAt < 30_000 || sightingSaveInFlightRef.current.has(sightingKey)) continue;
            sightingPersistedAtRef.current.set(sightingKey, at);
            sightingSaveInFlightRef.current.add(sightingKey);
            void recordGateDetectionSighting({
              sessionId: sightingSession.id,
              trackingId: track.id,
              species: track.species,
              confidence: track.confidence,
            }).then((sighting) => {
              if (!mountedRef.current) return;
              setDetectionSightings((current) => [
                sighting,
                ...current.filter((item) => item.id !== sighting.id),
              ].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()).slice(0, 250));
              setDetectionHistoryError('');
            }).catch((error) => {
              if (!mountedRef.current) return;
              setDetectionHistoryError('Nakita ang hayop, pero hindi muna na-save ang detection history.');
              console.error('Hindi na-save ang camera detection history.', error);
            }).finally(() => {
              sightingSaveInFlightRef.current.delete(sightingKey);
            });
          }
        }
        transientDetectionFailuresRef.current = 0;
        const qrPayloadsByTrack = new Map<string, Set<string>>();
        predictions.forEach((prediction, index) => {
          const detection = detections[index];
          const animalTrack = matchDetectionToTrack(detection.box, detection.species, tracking.tracks);
          if (!animalTrack) return;
          for (const code of prediction.qr_codes ?? []) {
            const qrBox = {
              x1: code.bbox.x1 / image.width,
              y1: code.bbox.y1 / image.height,
              x2: code.bbox.x2 / image.width,
              y2: code.bbox.y2 / image.height,
            };
            const earTrack = matchQrToEarTrack(qrBox, tracking.tracks);
            if (!earTrack || earTrack.id !== animalTrack.id) continue;
            const values = qrPayloadsByTrack.get(animalTrack.id) ?? new Set<string>();
            values.add(code.value);
            qrPayloadsByTrack.set(animalTrack.id, values);
          }
        });
        const nextQrEvidence = new Map<string, { trackingId: string; rawValue: string; hits: number; at: number }>();
        const qrReadingTrackIds: string[] = [];
        for (const [trackingId, values] of qrPayloadsByTrack) {
          if (values.size !== 1) continue;
          const rawValue = [...values][0];
          const evidenceKey = trackingId + '\u0000' + rawValue;
          const previousEvidence = qrFrameEvidenceRef.current.get(evidenceKey);
          const hits = previousEvidence && at - previousEvidence.at <= DETECTION_INTERVAL_MS * 2.5
            ? previousEvidence.hits + 1
            : 1;
          nextQrEvidence.set(evidenceKey, { trackingId, rawValue, hits, at });
          qrReadingTrackIds.push(trackingId);
          if (hits === 3 && !trackQrIdentityRef.current[trackingId]) {
            void handleQrDecoded(rawValue, trackingId);
          }
        }
        qrFrameEvidenceRef.current = nextQrEvidence;
        const eartagPayloadsByTrack = new Map<string, Set<string>>();
        predictions.forEach((prediction, index) => {
          const detection = detections[index];
          const animalTrack = matchDetectionToTrack(detection.box, detection.species, tracking.tracks);
          if (!animalTrack) return;
          for (const reading of prediction.eartag_numbers ?? []) {
            const number = normalizeEartagNumber(reading.value);
            if (!number) continue;
            const tagBox = {
              x1: reading.bbox.x1 / image.width,
              y1: reading.bbox.y1 / image.height,
              x2: reading.bbox.x2 / image.width,
              y2: reading.bbox.y2 / image.height,
            };
            const tagTrack = matchEartagNumberToEarTrack(tagBox, tracking.tracks);
            if (!tagTrack || tagTrack.id !== animalTrack.id) continue;
            const values = eartagPayloadsByTrack.get(tagTrack.id) ?? new Set<string>();
            values.add(number);
            eartagPayloadsByTrack.set(tagTrack.id, values);
          }
        });
        const nextEartagEvidence = new Map<string, { trackingId: string; rawValue: string; hits: number; at: number }>();
        const eartagReadingTrackIds: string[] = [];
        const confirmedEartags: Array<{ trackingId: string; number: string }> = [];
        for (const [trackingId, values] of eartagPayloadsByTrack) {
          if (values.size !== 1) continue;
          const number = [...values][0];
          const evidenceKey = trackingId + '\u0000' + number;
          const previousEvidence = eartagFrameEvidenceRef.current.get(evidenceKey);
          const hits = previousEvidence && at - previousEvidence.at <= DETECTION_INTERVAL_MS * 2.5
            ? previousEvidence.hits + 1
            : 1;
          nextEartagEvidence.set(evidenceKey, { trackingId, rawValue: number, hits, at });
          eartagReadingTrackIds.push(trackingId);
          if (hits >= 3) {
            confirmedEartags.push({ trackingId, number });
          }
        }
        eartagFrameEvidenceRef.current = nextEartagEvidence;
        const nextFrame: LiveFrame = {
          detections,
          tracks: tracking.tracks,
          qrReadingTrackIds: [...new Set([...qrReadingTrackIds, ...eartagReadingTrackIds])],
          at,
          image,
          message: detections.length === 0
            ? tracking.tracks.length > 0
              ? 'Naghihintay ng malinaw na kasunod na kuha; pansamantalang pinananatili ang huling bounding box.'
              : 'Walang kambing o tupa sa live frame.'
            : detections.length > 1
              ? detections.length + ' hayop ang nakikita; magkakahiwalay na sinusubaybayan ang galaw.'
              : 'Nakikita ang ' + speciesLabel(detections[0].species) + ' sa camera.',
        };
        frameRef.current = nextFrame;
        setLiveFrame(nextFrame);
        for (const result of confirmedEartags) {
          if (!trackQrIdentityRef.current[result.trackingId]) {
            void handleEartagDecoded(result.number, result.trackingId);
          }
        }
        detectionPauseUntilRef.current = 0;

        const soleSheep = detections.length === 1 && detections[0].species === 'sheep';
        if (!soleSheep) {
          activityFramesRef.current = [];
          activityTrackIdRef.current = null;
          if (activityEnabledRef.current) {
            setActivityState(detections.some((detection) => detection.species === 'goat') ? 'unsupported' : 'waiting');
            setActivityMessage(detections.some((detection) => detection.species === 'goat')
              ? 'Sheep lang ang saklaw ng activity model; hindi ito nag-iiskor ng kambing.'
              : 'Naghihintay ng iisang tupa sa camera.');
          }
        } else if (activityEnabledRef.current && !activityBusyRef.current) {
          const sheepTrack = tracking.tracks.find((track) =>
            track.species === 'sheep' && track.consecutiveMisses === 0 && at - track.lastSeenAt <= MAX_FRAME_AGE_MS,
          );
          if (!sheepTrack) {
            activityFramesRef.current = [];
            activityTrackIdRef.current = null;
            setActivityState('waiting');
            setActivityMessage('Naghihintay ng matatag na sheep track.');
          } else {
            if (activityTrackIdRef.current !== sheepTrack.id) {
              activityFramesRef.current = [];
              activityTrackIdRef.current = sheepTrack.id;
            }
            if (at - lastActivityFrameAtRef.current >= 900) {
              lastActivityFrameAtRef.current = at;
              try {
                const sample = await captureGateActivityFrame(canvas, at);
                if (!disposed && mountedRef.current && activityEnabledRef.current) {
                  const samples = [...activityFramesRef.current, sample].slice(-12);
                  activityFramesRef.current = samples;
                  setActivityState(samples.length === 12 ? 'estimating' : 'buffering');
                  setActivityMessage(samples.length === 12
                    ? 'Sinusuri ang 12 sunod-sunod na frame.'
                    : `Kinokolekta ang kilos ng tupa (${samples.length}/12 frame).`);
                  if (samples.length === 12) {
                    const predictionEpoch = activityEpochRef.current;
                    const trackId = sheepTrack.id;
                    activityFramesRef.current = [];
                    activityBusyRef.current = true;
                    void predictGateActivity(samples).then((estimate) => {
                      if (!mountedRef.current || activityEpochRef.current !== predictionEpoch) return;
                      const trackStillVisible = frameRef.current.tracks.some((track) =>
                        track.id === trackId && track.species === 'sheep' && track.consecutiveMisses === 0 &&
                        Date.now() - track.lastSeenAt <= MAX_FRAME_AGE_MS,
                      );
                      if (!trackStillVisible) return;
                      setActivityEstimate({ label: estimate.activity, trackingId: trackId });
                      setActivityState('ready');
                      setActivityMessage('Tinatayang kilos lang; maaaring magkamali ang model.');
                    }).catch(() => {
                      if (!mountedRef.current || activityEpochRef.current !== predictionEpoch) return;
                      setActivityState('waiting');
                      setActivityMessage('Hindi naisagawa ang pagtataya; mag-iipon muli ng frame.');
                    }).finally(() => {
                      if (activityEpochRef.current === predictionEpoch) activityBusyRef.current = false;
                    });
                  }
                }
              } catch {
                activityFramesRef.current = [];
                setActivityState('waiting');
                setActivityMessage('Hindi makuha ang camera frame para sa activity estimate.');
              }
            }
          }
        }
        const browserCrossings = cameraSource === 'farm' ? [] : tracking.crossings;
        const crossingSaves = new Map<string, Promise<{ success: boolean; duplicate: boolean; crossing_id: string | null }>>();
        if (browserCrossings.length) {
          setCrossingTotal((count) => count + browserCrossings.length);
          const activeSession = sessionRef.current;
          if (activeSession?.status === 'monitoring') {
            browserCrossings.forEach((crossing) => {
              const crossingSave = recordGateCameraCrossing({
                sessionId: activeSession.id,
                crossingKey: crypto.randomUUID(),
                trackingId: crossing.trackingId,
                species: crossing.species,
                direction: crossing.direction,
                confidence: crossing.confidence,
                movementObservation: crossing.observation,
              });
              crossingSaves.set(`${crossing.trackingId}:${crossing.direction}`, crossingSave);
              void crossingSave.then(async () => {
                try {
                  const metrics = await getGateCameraMetrics(activeSession.id);
                  if (!mountedRef.current) return;
                  setCameraMetrics(metrics);
                  setCrossingTotal(metrics.crossing_count);
                } catch {
                  // The crossing save succeeded; realtime refresh can update its metrics later.
                }
              }).catch(() => {
                if (mountedRef.current) {
                  setCameraMessage('Nakita ang pagtawid, pero hindi ito na-save sa history. Suriin ang koneksyon at subukan muli.');
                }
              });
            });
          }
        }
        const activeSession = sessionRef.current;
        if (
          activeSession?.status === 'monitoring' &&
          !liveSyncBusyRef.current &&
          at - lastLiveSyncAtRef.current >= 5_000
        ) {
          liveSyncBusyRef.current = true;
          lastLiveSyncAtRef.current = at;
          void syncGateLiveTracks(activeSession.id, tracking.tracks.filter((track) => track.consecutiveMisses === 0).map((track) => ({
            trackingId: track.id,
            species: track.species,
            confidence: track.confidence,
          }))).catch(() => {
            if (mountedRef.current) setCameraMessage('Tuloy ang live camera, pero hindi ma-update ang kasalukuyang bilang sa Goat and Sheep Status (Katayuan ng Kambing at Tupa).');
          }).finally(() => {
            liveSyncBusyRef.current = false;
          });
        }
        for (const crossing of browserCrossings) {
          if (activeSession?.status !== 'monitoring') break;
          const identity = trackQrIdentityRef.current[crossing.trackingId];
          if (!identity || identity.species !== crossing.species) continue;
          if (identity.method === 'eartag' && identity.eartagNumber) {
            const animal = farmAnimals.find((candidate) => candidate.id === identity.animalId && candidate.user_id === user?.id);
            if (!animal) continue;
            const savedCrossing = crossingSaves.get(`${crossing.trackingId}:${crossing.direction}`) ?? Promise.resolve(null);
            void savedCrossing.then(() => {
              if (!mountedRef.current || sessionRef.current?.status !== 'monitoring') return;
              const nextPending: PendingQr = {
                animal,
                rawValue: identity.eartagNumber!,
                eartagNumber: identity.eartagNumber!,
                method: 'eartag',
                trackingId: crossing.trackingId,
                direction: crossing.direction,
              };
              pendingQrByTrackRef.current.set(crossing.trackingId, nextPending);
              if (!pendingQrRef.current || pendingQrRef.current.trackingId === crossing.trackingId) {
                pendingQrRef.current = nextPending;
                setPendingQr(nextPending);
              }
              setQrState('verified');
              setQrMessage(`${identity.eartagNumber} — ${animal.name} crossed the gate; saving the direction.`);
            }).catch((error) => {
              if (mountedRef.current) setCameraMessage('Nakita ang pagtawid, pero hindi ito na-save: ' + friendlyError(error));
            });
            continue;
          }
          void verifyGateQr(activeSession.id, identity.rawValue, crossing.trackingId).then((proof) => {
            if (!proof.verified || !proof.verification_id || proof.animal_id !== identity.animalId) return;
            const animal = farmAnimals.find((candidate) => candidate.id === identity.animalId && candidate.user_id === user?.id);
            if (!animal) return;
            const nextPending: PendingQr = {
              animal,
              rawValue: identity.rawValue,
              verificationId: proof.verification_id,
              method: 'qr',
              trackingId: crossing.trackingId,
              direction: crossing.direction,
            };
            pendingQrByTrackRef.current.set(crossing.trackingId, nextPending);
            if (!pendingQrRef.current || pendingQrRef.current.trackingId === crossing.trackingId) {
              pendingQrRef.current = nextPending;
              setPendingQr(nextPending);
            }
            if (mountedRef.current) {
              setQrState('verified');
              setQrMessage('Nakilala ang ' + animal.tag_id + ' at tumawid ito. Itinatala ang sariling direksyon nito.');
            }
          }).catch((error) => {
            if (mountedRef.current) setCameraMessage('Nakilala ang ' + farmAnimals.find((animal) => animal.id === identity.animalId)?.tag_id + ', pero hindi ma-verify ang pagtawid: ' + friendlyError(error));
          });
        }
        setDetectorState('ready');
      } catch (error) {
        if (!disposed && mountedRef.current) {
          if (error instanceof GateDetectionRequestError && error.status === 429) {
            const pauseMs = Math.max(DETECTION_INTERVAL_MS, error.retryAfterMs || 60_000);
            detectionPauseUntilRef.current = Date.now() + pauseMs;
            qrFrameEvidenceRef.current.clear();
            eartagFrameEvidenceRef.current.clear();
            eartagLastAttemptRef.current.clear();
            pendingQrByTrackRef.current.clear();
            pendingQrRef.current = null;
            setPendingQr(null);
          const pausedFrame: LiveFrame = {
            ...frameRef.current,
            qrReadingTrackIds: [],
            // Keep the original frame time so stale boxes expire naturally and
            // cannot be mistaken for a current crossing during the cooldown.
            message: `Naghihintay ang detector ng ${Math.ceil(pauseMs / 1_000)} segundo bago magpatuloy. Pinananatili muna ang huling mga kahon.`,
          };
            frameRef.current = pausedFrame;
            setLiveFrame(pausedFrame);
            setDetectorState('ready');
            return;
          }

        const retryable = !(error instanceof GateDetectionRequestError) || error.status === 408 || error.status >= 500;
        if (retryable) {
          transientDetectionFailuresRef.current += 1;
          const retryMs = Math.min(5_000, 1_000 * 2 ** Math.min(transientDetectionFailuresRef.current - 1, 2));
          detectionPauseUntilRef.current = Date.now() + retryMs;
          const retryFrame: LiveFrame = {
            ...frameRef.current,
            qrReadingTrackIds: [],
            message: `Pansamantalang mabagal ang detector; susubukan muli pagkalipas ng ${Math.ceil(retryMs / 1_000)} segundo.`,
          };
          frameRef.current = retryFrame;
          setLiveFrame(retryFrame);
          setDetectorState('ready');
          return;
        }

          setDetectorState('error');
          qrFrameEvidenceRef.current.clear();
          eartagFrameEvidenceRef.current.clear();
          eartagLastAttemptRef.current.clear();
          pendingQrByTrackRef.current.clear();
          pendingQrRef.current = null;
          setPendingQr(null);
        const unavailableFrame: LiveFrame = { ...frameRef.current, qrReadingTrackIds: [], message: friendlyError(error) };
          frameRef.current = unavailableFrame;
          setLiveFrame(unavailableFrame);
        }
      } finally {
        inferenceBusyRef.current = false;
      }
    };
    let scanTimer: number | null = null;
    const scanLoop = async () => {
      const startedAt = performance.now();
      await scanFrame();
      if (disposed) return;
      const elapsed = performance.now() - startedAt;
      const pauseRemaining = Math.max(0, detectionPauseUntilRef.current - Date.now());
      scanTimer = window.setTimeout(scanLoop, pauseRemaining || Math.max(50, DETECTION_INTERVAL_MS - elapsed));
    };
    void scanLoop();
    return () => {
      disposed = true;
      if (scanTimer !== null) window.clearTimeout(scanTimer);
    };
  }, [cameraSource, cameraState, cameraTestMode, detectorState, farmAnimals, handleQrDecoded, isCameraMonitoring, reconciliationWindowComplete, user?.id]);

  useEffect(() => {
    if (!isMonitoring || !reconciliationWindowComplete || cameraState !== 'scanning') return;
    activityEpochRef.current += 1;
    activityEnabledRef.current = false;
    activityBusyRef.current = false;
    activityFramesRef.current = [];
    activityTrackIdRef.current = null;
    setActivityEstimate(null);
    setActivityState('idle');
    setActivityMessage('Tapos na ang monitoring window.');
    setPendingQr(null);
    pendingQrRef.current = null;
    pendingQrByTrackRef.current.clear();
    qrFrameEvidenceRef.current.clear();
    eartagFrameEvidenceRef.current.clear();
    eartagLastAttemptRef.current.clear();
    trackQrIdentityRef.current = {};
    scanLockedRef.current = false;
    trackerRef.current.reset();
    const previewFrame: LiveFrame = {
      detections: [], tracks: [], qrReadingTrackIds: [], at: Date.now(),
      message: 'Tapos na ang reconciliation window. Naka-preview pa rin ang camera; tapusin ang monitoring para makita ang mga hayop na kailangan ng verification.',
    };
    frameRef.current = previewFrame;
    setLiveFrame(previewFrame);
    setQrMessage('Tapos na ang reconciliation window.');
    if (session?.id) void clearGateLiveTracks(session.id).catch(() => undefined);
  }, [cameraState, isMonitoring, reconciliationWindowComplete, session?.id]);

  const startSession = useCallback(async () => {
    if (cameraSource === 'farm') {
      setPageError('Ang CCTV sa bukid ay para sa live count at pagsubaybay ng galaw. Para iugnay ang hayop sa indibidwal na profile, gamitin ang hiwalay na device-camera scan.');
      return;
    }
    if (!user) return;
    if (!isSupabaseAuthUserId(user.id)) {
      setPageError('Hindi makakonekta ang account sa tala ng bukid. Mag-sign in muli o humingi ng tulong sa tagapangasiwa.');
      return;
    }
    if (expectedAnimals.length === 0) {
      setPageError('Wala pang kambing o tupa sa talaan. Magdagdag muna ng alaga bago buksan ang camera.');
      return;
    }
    setPageLoading(true);
    setPageError('');
    setCameraTestMode(false);
    let cameraStarted = false;
    try {
      cameraStarted = await startScanner();
      if (!cameraStarted) return;
      const gate = await ensureMainGate(user.id);
      let created: GateSession;
      let resumedExistingSession = false;
      try {
        created = await startGateSession(
          gate.id,
          expectedAnimals.map((animal) => animal.id),
          windowMinutes,
          0.55,
          cameraOrientation,
        );
      } catch (startError) {
        const existing = await getActiveGateSession(user.id).catch(() => null);
        if (!existing) throw startError;
        created = existing;
        resumedExistingSession = true;
      }
      const activeFlow = created.entry_flow === 'bottom-to-top' ? 'bottom-to-top' : 'top-to-bottom';
      configureCameraFlow(activeFlow);
      sessionRef.current = created;
      setSession(created);
      setEvents([]);
      setCameraCrossings([]);
      setDetectionSightings([]);
      setDetectionHistoryError('');
      sightingPersistedAtRef.current.clear();
      sightingSaveInFlightRef.current.clear();
      setCameraMetrics(null);
      setAlerts([]);
      setSessionSummary(null);
      trackerRef.current.reset();
      trackQrIdentityRef.current = {};
      qrFrameEvidenceRef.current.clear();
      eartagFrameEvidenceRef.current.clear();
      eartagLastAttemptRef.current.clear();
      qrProcessingTrackIdsRef.current.clear();
      pendingQrByTrackRef.current.clear();
      reportedAnomalyAlertsRef.current.clear();
      frameRef.current = { detections: [], tracks: [], qrReadingTrackIds: [], at: 0, message: 'Inihahanda ang camera.' };
      setLiveFrame(frameRef.current);
      setCrossingTotal(0);
      lastLiveSyncAtRef.current = 0;
      setIdentifiedTrackIds({});
      setPendingQr(null);
      pendingQrRef.current = null;
      seenAlertIdsRef.current.clear();
      soundReadyRef.current = true;
      await refreshSessionData(created.id);
      toast(resumedExistingSession ? 'Bumalik sa aktibong Smart Gate session.' : 'Nagsimula ang Smart Gate session.', 'success');
    } catch (error) {
      if (cameraStarted && sessionRef.current?.status !== 'monitoring') {
        // Keep the live preview and detector available if saving the gate session
        // fails. In test mode no gate movement is recorded.
        setCameraTestMode(true);
        setCameraMessage('Aktibo ang live preview at detection, pero hindi nasimulan ang gate session. Walang galaw na itatala.');
      }
      setPageError(friendlyError(error));
    } finally {
      setPageLoading(false);
    }
  }, [cameraOrientation, cameraSource, configureCameraFlow, expectedAnimals, refreshSessionData, startScanner, stopScanner, toast, user, windowMinutes]);

  const startCameraTest = useCallback(async () => {
    setPageError('');
    setCameraTestMode(true);
    const started = await startScanner();
    if (!started) setCameraTestMode(false);
  }, [startScanner]);

  const stopCameraTest = useCallback(async () => {
    setCameraTestMode(false);
    await stopScanner();
  }, [stopScanner]);

  const handleStartFarmCount = useCallback(async () => {
    if (!user || !canEditFarmGateSettings || farmCountingOverview?.active_session || farmCountingSaving) return;
    if (!window.confirm(`Magsimula ng bagong overnight count na tatagal ng ${farmCountingPeriodHours} oras? Kukunin ang expected count mula sa kasalukuyang aktibong kambing at tupa sa database.`)) return;
    setFarmCountingSaving(true);
    setFarmCountingError('');
    try {
      const overview = await startFarmCountingSession(farmCountingPeriodHours);
      setFarmCountingOverview(overview);
      setSelectedFarmSessionId(overview.active_session?.id ?? overview.selected_session_id ?? '');
      setShowFarmEndCountConfirm(false);
      toast(`Nagsimula ang overnight count. Magpapatuloy ito nang ${farmCountingPeriodHours} oras.`, 'success');
    } catch (error) {
      setFarmCountingError(error instanceof Error ? error.message : 'Hindi nasimulan ang counting session.');
    } finally {
      setFarmCountingSaving(false);
    }
  }, [canEditFarmGateSettings, farmCountingOverview?.active_session, farmCountingPeriodHours, farmCountingSaving, toast, user]);

  const handleEndFarmCount = useCallback(async () => {
    const active = farmCountingOverview?.active_session;
    if (!user || !canEditFarmGateSettings || !active || farmCountingSaving) return;
    setFarmCountingSaving(true);
    setFarmCountingError('');
    try {
      const overview = await cancelFarmCountingSession(active.id);
      setFarmCountingOverview(overview);
      setSelectedFarmSessionId(active.id);
      setShowFarmEndCountConfirm(false);
      toast('Nakansela ang overnight count. Nasa history pa rin ang record at walang missing alert na ginawa.', 'warning');
    } catch (error) {
      setFarmCountingError(error instanceof Error ? error.message : 'Hindi na-save ang pagtatapos ng bilang.');
    } finally {
      setFarmCountingSaving(false);
    }
  }, [canEditFarmGateSettings, farmCountingOverview?.active_session, farmCountingSaving, toast, user]);

  const confirmMovement = useCallback(async () => {
    if (!pendingQr || !session || !user || savingEvent || movementSaveInFlightRef.current) return;
    const current = frameRef.current;
    const track = current.tracks.find((candidate) => candidate.id === pendingQr.trackingId);
    if (
      Date.now() - current.at > MAX_FRAME_AGE_MS ||
      !track ||
      !track.confirmed ||
      track.confidence < 0.4 ||
      track.species !== animalSpecies(pendingQr.animal) ||
      !track.lastCrossing ||
      (pendingQr.direction !== null && track.lastCrossing.direction !== pendingQr.direction) ||
      Date.now() - track.lastCrossing.at > QR_CROSSING_WINDOW_MS
    ) {
      setQrMessage('Naghihintay ng malinaw na pagtawid ng nakilalang hayop sa live camera. Walang galaw na itatala hangga’t hindi tugma ang camera.');
      return;
    }

    const direction = track.lastCrossing.direction;

    movementSaveInFlightRef.current = true;
    setSavingEvent(true);
    try {
      const result = pendingQr.eartagNumber
        ? await recordGateMovementEartag({
          sessionId: session.id,
          trackingId: track.id,
          direction,
          species: track.species,
          confidence: track.confidence,
          eartagNumber: pendingQr.eartagNumber,
          movementObservation: track.lastCrossing.observation,
        })
        : await recordGateMovement({
          sessionId: session.id,
          verificationId: pendingQr.verificationId ?? '',
          direction,
          species: track.species,
          confidence: track.confidence,
          trackingId: track.id,
          movementObservation: track.lastCrossing.observation,
        });
      if (result.duplicate) {
        setQrState('duplicate');
        setQrMessage('Duplicate scan: naitala na ang parehong direksyon sa loob ng 20 segundo.');
      } else {
        setQrState('verified');
        const visibleIdentity = pendingQr.eartagNumber
          ? `${pendingQr.eartagNumber} — ${pendingQr.animal.name}`
          : `${pendingQr.animal.tag_id} — ${pendingQr.animal.name}`;
        setQrMessage(visibleIdentity + ' ay ' + (direction === 'entry' ? 'nakabalik' : 'lumabas') + '.');
        toast('Movement recorded: ' + visibleIdentity, 'success');
      }
      setIdentifiedTrackIds((currentIds) => ({ ...currentIds, [track.id]: pendingQr.animal.id }));
      pendingQrByTrackRef.current.delete(track.id);
      const nextPending = pendingQrByTrackRef.current.values().next().value as PendingQr | undefined;
      pendingQrRef.current = nextPending ?? null;
      setPendingQr(nextPending ?? null);
      await refreshSessionData(session.id);
      scheduleQrUnlock(1_400);
    } catch (error) {
      setQrState('unknown');
      setQrMessage(friendlyError(error));
      pendingQrByTrackRef.current.delete(pendingQr.trackingId);
      const nextPending = pendingQrByTrackRef.current.values().next().value as PendingQr | undefined;
      pendingQrRef.current = nextPending ?? null;
      setPendingQr(nextPending ?? null);
      scheduleQrUnlock(1_400);
    } finally {
      movementSaveInFlightRef.current = false;
      setSavingEvent(false);
    }
  }, [pendingQr, refreshSessionData, savingEvent, scheduleQrUnlock, session, toast, user]);

  const dismissQr = useCallback(() => {
    if (qrUnlockTimerRef.current !== null) window.clearTimeout(qrUnlockTimerRef.current);
    qrUnlockTimerRef.current = null;
    const dismissedTrackId = pendingQrRef.current?.trackingId;
    if (dismissedTrackId) {
      pendingQrByTrackRef.current.delete(dismissedTrackId);
      delete trackQrIdentityRef.current[dismissedTrackId];
      qrFrameEvidenceRef.current.forEach((evidence, key) => {
        if (evidence.trackingId === dismissedTrackId) qrFrameEvidenceRef.current.delete(key);
      });
      setIdentifiedTrackIds((currentIds) => {
        const nextIds = { ...currentIds };
        delete nextIds[dismissedTrackId];
        return nextIds;
      });
    }
    const nextPending = pendingQrByTrackRef.current.values().next().value as PendingQr | undefined;
    pendingQrRef.current = nextPending ?? null;
    setPendingQr(nextPending ?? null);
    scanLockedRef.current = false;
    setQrState('waiting');
    setQrMessage('Naghihintay ng eartag number.');
  }, []);

  const onFinishSession = useCallback(async () => {
    if (!session) return;
    setFinishing(true);
    setPageError('');
    try {
      await stopScanner();
      const result = await finishGateSession(session.id);
      setPendingQr(null);
      pendingQrRef.current = null;
      pendingQrByTrackRef.current.clear();
      scanLockedRef.current = false;
      const finishedSession = session ? {
        ...session,
        status: 'reconciled' as const,
        ended_at: new Date().toISOString(),
        entered_count: result.entered_count,
        exited_count: result.exited_count,
        missing_count: result.unaccounted_count,
      } : null;
      sessionRef.current = finishedSession;
      setSession(finishedSession);
      await refreshSessionData(session.id);
      setConfirmFinish(false);
      setQrState('waiting');
      setQrMessage('Tapos na ang reconciliation window.');
      toast(
        result.unaccounted_count
          ? result.unaccounted_count + ' hayop ang nangangailangan ng verification.'
          : 'Lahat ng expected na hayop ay na-verify.',
        result.unaccounted_count ? 'warning' : 'success',
      );
    } catch (error) {
      setPageError(friendlyError(error));
    } finally {
      setFinishing(false);
    }
  }, [refreshSessionData, session, stopScanner, toast]);

  const onCancelSession = useCallback(async () => {
    if (!session) return;
    setFinishing(true);
    try {
      await stopScanner();
      await cancelGateSession(session.id);
      setPendingQr(null);
      pendingQrRef.current = null;
      pendingQrByTrackRef.current.clear();
      scanLockedRef.current = false;
      const cancelledSession = { ...session, status: 'cancelled' as const, ended_at: new Date().toISOString() };
      sessionRef.current = cancelledSession;
      setSession(cancelledSession);
      setConfirmCancel(false);
      setPendingQr(null);
      setQrState('waiting');
      setQrMessage('Kinansela ang monitoring session. Napanatili ang movement history.');
    } catch (error) {
      setPageError(friendlyError(error));
    } finally {
      setFinishing(false);
    }
  }, [session, stopScanner]);

  const updateAlert = useCallback(async (alert: GateAlert, status: 'acknowledged' | 'resolved') => {
    setAlertBusyId(alert.id);
    try {
      await setGateAlertStatus(alert.id, status);
      if (session) await refreshSessionData(session.id);
      toast(status === 'resolved' ? 'Nalutas ang alert.' : 'Na-acknowledge ang alert.', 'success');
    } catch (error) {
      setPageError(friendlyError(error));
    } finally {
      setAlertBusyId(null);
    }
  }, [refreshSessionData, session, toast]);

  const toggleSound = useCallback(async () => {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    if (enabled) {
      try {
        const AudioContextConstructor = window.AudioContext;
        if (!AudioContextConstructor) return;
        const context = soundContextRef.current ?? new AudioContextConstructor();
        soundContextRef.current = context;
        if (context.state === 'suspended') await context.resume();
      } catch {
        setSoundEnabled(false);
        setPageError('Hindi available ang audio sa browser na ito.');
      }
    }
  }, [soundEnabled]);

  const runSoundTest = useCallback(() => {
    setSoundEnabled(true);
    void playAlertTone();
  }, [playAlertTone]);

  const recordingControl = cameraState === 'scanning' || recordingError ? (
    <div className="gate-recording-controls">
      {cameraState === 'scanning' && (
        <Button
          variant={isRecording ? 'danger' : 'outline'}
          size="lg"
          fullWidth
          onClick={isRecording ? stopVideoRecording : startVideoRecording}
          leftIcon={isRecording ? <Download size={17} /> : <Video size={17} />}
          aria-label={isRecording ? 'Itigil at i-save ang video recording' : 'I-record ang live video'}
        >
          {isRecording ? 'Itigil at i-save ang video' : 'I-record ang live video'}
        </Button>
      )}
      {isRecording && (
        <span className="gate-recording-status" role="status" aria-live="polite">
          <Circle size={11} fill="currentColor" /> REC · {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
        </span>
      )}
      {recordingError && <span className="gate-recording-error" role="alert">{recordingError}</span>}
      {cameraState === 'scanning' && <small>Video feed lang ang mare-record (walang detection overlay) at ida-download sa device mo. Hindi ito ina-upload sa ALPASFARM.</small>}
    </div>
  ) : null;

  const accountAnimal = (id: string) => farmAnimals.find((animal) => animal.id === id);
  const qrMatchingDetector = Boolean(pendingQr && (() => {
    const track = liveFrame.tracks.find((candidate) => candidate.id === pendingQr.trackingId);
    return Date.now() - liveFrame.at <= MAX_FRAME_AGE_MS && track &&
      track.confirmed && track.confidence >= 0.4 &&
      track.species === animalSpecies(pendingQr.animal) && track.lastCrossing &&
      (pendingQr.direction === null || track.lastCrossing.direction === pendingQr.direction) &&
      Date.now() - track.lastCrossing.at <= QR_CROSSING_WINDOW_MS;
  })());
  useEffect(() => {
    if (!isMonitoring || cameraState !== 'scanning' || !pendingQr || !qrMatchingDetector || savingEvent) return;
    void confirmMovement();
  }, [cameraState, confirmMovement, isMonitoring, pendingQr, qrMatchingDetector, savingEvent]);
  const directionCounts = {
    entry: events.filter((event) => event.direction === 'entry').length,
    exit: events.filter((event) => event.direction === 'exit').length,
  };
  const cameraEntryCrossings = cameraCrossings.filter((crossing) => crossing.direction === 'entry');
  const totalEntered = cameraMetrics?.camera_entry_count ?? cameraEntryCrossings.length;
  const freshFarmAnimalCount = farmAnimalCount !== null && farmAnimalCountAt > 0
    && clockNow - farmAnimalCountAt <= 5_000
    ? farmAnimalCount
    : null;
  const activeFarmCountingSession = farmCountingOverview?.active_session ?? null;
  const selectedFarmCountingSession = farmCountingOverview?.sessions.find((session) => session.id === selectedFarmSessionId)
    ?? activeFarmCountingSession
    ?? farmCountingOverview?.sessions[0]
    ?? null;
  const selectedFarmCountingEndAt = selectedFarmCountingSession?.status === 'ONGOING'
    ? selectedFarmCountingSession.period_ends_at
    : selectedFarmCountingSession?.ended_at ?? selectedFarmCountingSession?.period_ends_at ?? null;
  const activeFarmAnimalTotal = getActiveAnimals(farmAnimals)
    .filter((animal) => ['goat', 'sheep'].includes(animal.species.toLowerCase())).length;

  if (cameraSource === 'farm') {
    const cameraIsLive = cameraState === 'scanning';
    const cameraPreviewStatus = cameraIsLive
      ? 'LIVE'
      : cameraState === 'starting' || (cameraState === 'error' && farmCameraServerActive)
        ? 'RECONNECTING LIVE PREVIEW'
        : 'CAMERA OFFLINE';
    return (
      <main className="livestock-gate-page gate-farmer-page gate-cctv-count-page">
        <header className="gate-page-heading gate-farmer-heading">
          <div className="gate-farmer-heading-copy">
            <span className="gate-farmer-eyebrow"><Camera size={14} /> CAMERA SA BUKID</span>
            <h1>Camera sa Pasukan</h1>
            <p>Bilang ng mga hayop na nasa camera, pumasok, at lumabas.</p>
          </div>
          <div className="gate-farmer-status-group">
            <span className={'gate-farmer-status ' + (cameraIsLive ? 'is-good' : cameraState === 'error' ? 'is-bad' : '')} role="status" aria-live="polite">
              <span className="gate-session-dot" />
              {cameraPreviewStatus}
            </span>
            <span className={'gate-farmer-status ' + (farmGatewayOnline === true ? 'is-good' : farmGatewayOnline === false ? 'is-bad' : '')} role="status" aria-live="polite">
              <span className="gate-session-dot" />
              Gateway {farmGatewayOnline === null ? 'CHECKING' : farmGatewayOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </header>

        {pageError && <div className="gate-farmer-error" role="alert">{pageError}</div>}
        {farmCountingError && <div className="gate-farmer-error" role="alert">{farmCountingError}</div>}

        <section className="gate-cctv-workspace" aria-label="Live CCTV at bilang ng mga hayop">
          <Card className="gate-farmer-camera-section gate-cctv-camera-panel">
            <div className="gate-farmer-camera-heading">
              <div>
                <span className="gate-cctv-camera-label"><Camera size={14} /> CAMERA SA PASUKAN</span>
                <h2>Camera ng bukid</h2>
                <p>Live view ng daanan papasok at palabas ng kulungan.</p>
              </div>
              <span className={'gate-cctv-live-state ' + (cameraIsLive ? 'is-live' : cameraState === 'error' ? 'is-error' : '')} role="status" aria-live="polite">
                <span />{cameraPreviewStatus}
              </span>
            </div>
            <div className="gate-video-frame gate-farmer-video-frame" ref={cameraFrameRef}>
              <div id={SCANNER_ID} className={cameraState === 'off' || cameraState === 'error' ? 'gate-video-hidden' : 'gate-video-mounted'}>
                {farmCameraStreamActive && (
                  <img
                    ref={farmCameraImageRef}
                    className="gate-farm-camera-stream"
                    alt="Live CCTV feed sa bukid"
                    onLoad={(event) => {
                      const { naturalWidth, naturalHeight } = event.currentTarget;
                      if (naturalWidth && naturalHeight) {
                        setFarmCameraStreamSize((current) => current.width === naturalWidth && current.height === naturalHeight
                          ? current
                          : { width: naturalWidth, height: naturalHeight });
                      }
                    }}
                  />
                )}
              </div>
              {cameraState === 'starting' && (
                <div className="gate-camera-placeholder is-loading" role="status" aria-live="polite">
                  <LoaderCircle size={34} className="gate-camera-loading-icon" />
                  <strong>Binubuksan ang CCTV…</strong>
                  <span>Hinihintay ang unang video frame.</span>
                </div>
              )}
              {cameraState !== 'scanning' && cameraState !== 'starting' && (
                <div className="gate-camera-placeholder">
                  {cameraState === 'error' ? <CameraOff size={36} /> : <Camera size={36} />}
                  <strong>{cameraPreviewStatus === 'CAMERA OFFLINE' ? 'Camera Offline' : 'Reconnecting live preview…'}</strong>
                  <span>{cameraMessage || (farmCameraLastConnectedAt
                    ? `Last connected: ${new Date(farmCameraLastConnectedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`
                    : 'Hinihintay ang tunay na video mula sa Tapo camera.')}</span>
                </div>
              )}
              {cameraIsLive && detectionOverlayStyle.display !== 'none' && (
                <div className="gate-detection-overlay farm-gate-detection-overlay" style={detectionOverlayStyle}>
                  {(liveFrame.image && clockNow - liveFrame.at <= 5_000
                    ? liveFrame.detections
                    : []).map((detection, index) => {
                    const track = matchDetectionToTrack(detection.box, detection.species, liveFrame.tracks);
                    const anomalyLabel = track?.movementAnomaly === 'repeated_stop_start'
                      ? 'Pahinto-hinto'
                      : track?.movementAnomaly === 'repeated_direction_change'
                        ? 'Pabalik-balik'
                        : '';
                    const movementLabel = !track ? 'Nakita' : anomalyLabel || (track.movement === 'stopped'
                      ? 'Huminto'
                      : track.movement === 'slow' ? 'Mabagal' : 'Gumagalaw');
                    return (
                      <div
                        className={'gate-farm-detection-box is-' + detection.species}
                        key={`${track?.id ?? detection.species}:${index}`}
                        title={`${detection.species === 'goat' ? 'Kambing' : 'Tupa'} · ${Math.round(detection.confidence * 100)}%`}
                        style={{
                          left: `${detection.box[0] * 100}%`,
                          top: `${detection.box[1] * 100}%`,
                          width: `${(detection.box[2] - detection.box[0]) * 100}%`,
                          height: `${(detection.box[3] - detection.box[1]) * 100}%`,
                        }}
                      >
                        <strong>{detection.species === 'goat' ? 'Kambing' : 'Tupa'} · {movementLabel}{track ? ` · ${track.id}` : ''}</strong>
                      </div>
                    );
                  })}
                  <div className="gate-count-line" aria-hidden="true" style={{ top: `${farmGateLineY * 100}%` }}><span /></div>
                  <div className="gate-count-side-label is-inside at-bottom">KULUNGAN / INSIDE</div>
                  <div className="gate-count-side-label is-outside at-top">LABAS / OUTSIDE</div>
                </div>
              )}
              {cameraIsLive && (
                <div className="gate-camera-overlay gate-farmer-camera-overlay" aria-live="polite">
                  <span><span className="gate-live-dot" /> LIVE</span>
                  <span>Hayop sa frame: {freshFarmAnimalCount ?? '—'}</span>
                </div>
              )}
            </div>
            <div className="gate-count-controls">
              <div className="gate-count-readonly-field">
                <span>Counting line position</span>
                <strong>{farmGateSettingsReady ? `${Math.round(farmGateLineY * 100)}% down` : '—'}</strong>
                <small>Configured in Counting Settings</small>
              </div>
              <div className="gate-count-readonly-field">
                <span>Direksyon ng pasok</span>
                <strong>Pababa = Pumasok</strong>
                <small>OUTSIDE → INSIDE</small>
              </div>
              <span className={'gate-count-settings-status' + (farmGateSettingsError ? ' is-error' : '')} aria-live="polite">
                {farmGateSettingsError
                  ? farmGateSettingsError
                  : `Counting configuration: ${!farmGateSettingsReady || farmGatewayOnline === null
                    ? 'Checking'
                    : farmGatewayOnline === false
                      ? 'Saved'
                      : farmGateSettingsRevision === 0 || farmGateGatewayAcknowledged ? 'Active' : 'Applying'} · Gateway: ${farmGatewayOnline === null ? 'Checking' : farmGatewayOnline ? 'Online' : 'Offline'}`}
              </span>
            </div>
            <div className="gate-cctv-mode-note">
              <span className="gate-cctv-mode-icon"><ShieldCheck size={17} /></span>
              <div><strong>Counting line: {activeFarmCountingSession ? 'Active' : 'Ready'}</strong><span>Configured counting line is used by the camera gateway. Isang return ang binibilang kapag nasubaybayan ang hayop mula LABAS papasok sa KULUNGAN.</span></div>
            </div>
          </Card>

          <Card className="gate-cctv-summary-panel gate-counting-session-panel">
            <div className="gate-cctv-summary-heading">
              <span className="gate-cctv-summary-icon"><Activity size={18} /></span>
              <div><span>OVERNIGHT RETURN COUNT</span><h2>{selectedFarmCountingSession?.status === 'ONGOING' ? 'Returned tonight' : 'Counting history'}</h2></div>
            </div>
            <div className={'gate-count-session-status is-' + (selectedFarmCountingSession?.status.toLowerCase() ?? 'ready')} role="status" aria-live="polite">
              <span className="gate-session-dot" />
              {selectedFarmCountingSession?.status === 'ONGOING' && farmGatewayOnline === false
                ? 'GATEWAY OFFLINE'
                : selectedFarmCountingSession?.status ?? 'READY'}
              {selectedFarmCountingSession && <time dateTime={selectedFarmCountingSession.started_at}>
                {new Date(selectedFarmCountingSession.started_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                {selectedFarmCountingEndAt ? ` – ${new Date(selectedFarmCountingEndAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}` : ''}
              </time>}
            </div>

            {selectedFarmCountingSession ? (
              <>
                <div className="gate-counting-total">
                  <span>RETURNED / EXPECTED</span>
                  <strong>{selectedFarmCountingSession.entered_total} / {selectedFarmCountingSession.required_total}</strong>
                  <small>{selectedFarmCountingSession.status === 'ONGOING'
                    ? `${selectedFarmCountingSession.missing_total} remaining`
                    : selectedFarmCountingSession.status === 'MISSING'
                      ? `${selectedFarmCountingSession.missing_total} not recorded` : selectedFarmCountingSession.status}</small>
                </div>
                {selectedFarmCountingSession.status === 'ONGOING' && selectedFarmCountingSession.missing_total === 0 && (
                  <div className="gate-counting-note" role="status">
                    Expected number reached. Monitoring continues until the end of the counting period.
                  </div>
                )}
                {selectedFarmCountingSession.status === 'COMPLETE' && (
                  <div className="gate-counting-note is-success" role="status">
                    Kumpleto ang bilang ng Kambing at Tupa na naitala na nakabalik sa kulungan.
                  </div>
                )}
                {selectedFarmCountingSession.status === 'MISSING' && (
                  <div className="gate-counting-note is-warning" role="alert">
                    May {selectedFarmCountingSession.missing_goats} Kambing at {selectedFarmCountingSession.missing_sheep} Tupa na hindi naitala na nakabalik. Hindi tinutukoy ng system ang indibidwal na hayop.
                  </div>
                )}
                {selectedFarmCountingSession.camera_incomplete && (
                  <div className="gate-counting-note is-warning" role="alert">
                    May camera interruption; maaaring hindi kumpleto ang bilang. Beripikahin ang mga hayop sa kulungan bago mag-aksyon.
                    {farmCountingOverview?.outages.length ? (
                      <ul>{farmCountingOverview.outages.map((outage) => (
                        <li key={outage.id}>
                          {new Date(outage.started_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                          {' – '}{outage.ended_at
                            ? new Date(outage.ended_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
                            : 'Hindi pa nakakabalik'}
                        </li>
                      ))}</ul>
                    ) : null}
                  </div>
                )}
                {activeFarmCountingSession && cameraState === 'error' && !selectedFarmCountingSession.camera_incomplete && (
                  <div className="gate-counting-note is-warning" role="alert">
                    Camera offline. Return counting may be incomplete. The system will not mark animals missing until the counting period ends.
                  </div>
                )}
                {activeFarmCountingSession && farmGatewayOnline === false && (
                  <div className="gate-counting-note is-warning" role="alert">
                    Gateway offline. Detection and counting are paused until the gateway reconnects. The nightly record remains saved; no missing alert is created before the scheduled end.
                    {farmGatewayLastSeenAt ? ` Last heartbeat: ${new Date(farmGatewayLastSeenAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.` : ''}
                  </div>
                )}
                <div className="gate-counting-metrics">
                  <div><span>Entry events</span><strong>{selectedFarmCountingSession.entry_event_count}</strong></div>
                  <div><span>Exit events</span><strong>{selectedFarmCountingSession.exit_event_count}</strong></div>
                  <div><span>Period</span><strong>{selectedFarmCountingSession.period_hours ?? '—'} hrs</strong></div>
                </div>
                <div className="gate-counting-event-list">
                  <strong>Latest crossings</strong>
                  {farmCountingOverview?.events.length ? (
                    <ul>{farmCountingOverview.events.slice(0, 6).map((event) => (
                      <li key={event.id}>
                        <span>
                          {event.animal_type === 'goat' ? 'Kambing' : 'Tupa'} · {event.direction === 'entry' ? 'Pumasok' : 'Lumabas'}
                        </span>
                        <time dateTime={event.detected_at}>{new Date(event.detected_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</time>
                      </li>
                    ))}</ul>
                  ) : <small>Wala pang crossing event sa session na ito.</small>}
                </div>
              </>
            ) : (
              <div className="gate-counting-empty">
                <strong>{farmCountingLoading ? 'Loading counting session…' : 'Walang aktibong bilang'}</strong>
                <span>Expected count: {activeFarmAnimalTotal} aktibong kambing at tupa mula sa database.</span>
              </div>
            )}

            <div className="gate-farmer-camera-actions gate-counting-actions">
              {activeFarmCountingSession ? (
                <Button variant="outline" size="lg" fullWidth onClick={() => setShowFarmEndCountConfirm(true)} disabled={!canEditFarmGateSettings || farmCountingSaving} leftIcon={<Pause size={17} />}>
                  Cancel Night Count
                </Button>
              ) : (
                <>
                  <label className="gate-counting-period-select">
                    <span>Counting period</span>
                    <select value={farmCountingPeriodHours} onChange={(event) => setFarmCountingPeriodHours(Number(event.target.value))} disabled={farmCountingSaving}>
                      {[6, 8, 10, 12, 14, 16, 18].map((hours) => <option key={hours} value={hours}>{hours} hours</option>)}
                    </select>
                  </label>
                  <Button size="lg" fullWidth onClick={() => { void handleStartFarmCount(); }} loading={farmCountingSaving} disabled={!canEditFarmGateSettings || activeFarmAnimalTotal === 0} leftIcon={<Play size={17} />}>
                    Magsimula ng Bagong Bilangan
                  </Button>
                </>
              )}
              {cameraIsLive ? (
                <Button variant="secondary" size="lg" fullWidth onClick={() => { void stopCameraTest(); }} leftIcon={<Pause size={17} />}>
                  Close CCTV
                </Button>
              ) : cameraState === 'error' ? (
                <Button variant="outline" size="lg" fullWidth onClick={() => { void startScanner('', 'farm'); }} disabled={!user} leftIcon={<RefreshCw size={17} />}>
                  Retry camera connection
                </Button>
              ) : <small>Camera preview starts automatically when this page opens.</small>}
            </div>

            <div className="gate-counting-history">
              <strong>Counting History</strong>
              {farmCountingOverview?.sessions.length ? (
                <ul>{farmCountingOverview.sessions.slice(0, 8).map((session) => (
                  <li key={session.id}>
                    <button type="button" className={session.id === selectedFarmCountingSession?.id ? 'is-selected' : ''} onClick={() => setSelectedFarmSessionId(session.id)}>
                      <span>{new Date(session.started_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })} · {session.status}</span>
                      <strong>Kambing {session.entered_goats}/{session.required_goats} · Tupa {session.entered_sheep}/{session.required_sheep}</strong>
                      <small>{session.status === 'ONGOING' ? `${session.missing_total} remaining`
                        : session.status === 'MISSING' ? `${session.missing_total} not recorded`
                          : session.status === 'COMPLETE' ? '0 unaccounted' : 'Count cancelled early'}
                        {session.camera_incomplete ? ' · camera interruption' : ''}
                        {' · '}{new Date(session.started_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}
                        {(session.status === 'ONGOING' ? session.period_ends_at : session.ended_at ?? session.period_ends_at) ? ` – ${new Date((session.status === 'ONGOING' ? session.period_ends_at : session.ended_at ?? session.period_ends_at)!).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}` : ''}</small>
                    </button>
                  </li>
                ))}</ul>
              ) : <small>Wala pang na-save na counting session.</small>}
            </div>

            {farmCountingOverview?.alerts.length ? (
              <div className="gate-counting-alerts" aria-label="Counting alerts">
                <strong>Alerts</strong>
                <ul>{farmCountingOverview.alerts.slice(0, 3).map((alert) => (
                  <li key={alert.id}><span>{alert.title}</span><small>{alert.description}</small><time>{new Date(alert.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</time></li>
                ))}</ul>
              </div>
            ) : null}
          </Card>
        </section>

        {showFarmEndCountConfirm && activeFarmCountingSession && (
          <div className="gate-counting-dialog-backdrop">
            <section className="gate-counting-dialog" role="dialog" aria-modal="true" aria-labelledby="gate-count-end-title">
              <h2 id="gate-count-end-title">Cancel overnight count?</h2>
              <p>Matitigil ang live nightly count at mase-save ang record bilang CANCELLED. Hindi ito gagawa ng missing-animal alert.</p>
              <p>Naitala sa ngayon: {activeFarmCountingSession.entered_goats} Kambing at {activeFarmCountingSession.entered_sheep} Tupa. Nakatakda itong matapos sa {activeFarmCountingSession.period_ends_at ? new Date(activeFarmCountingSession.period_ends_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}.</p>
              <div>
                <Button variant="outline" onClick={() => setShowFarmEndCountConfirm(false)}>Continue Counting</Button>
                <Button onClick={() => { void handleEndFarmCount(); }} loading={farmCountingSaving}>Cancel Count</Button>
              </div>
            </section>
          </div>
        )}

        {farmCompletionPopup && (
          <div className="gate-counting-dialog-backdrop">
            <section className="gate-counting-dialog" role="dialog" aria-modal="true" aria-labelledby="gate-count-complete-title">
              <CheckCircle2 size={34} aria-hidden="true" />
              <h2 id="gate-count-complete-title">Complete na ang bilang.</h2>
              <p>Kambing: {farmCompletionPopup.entered_goats}/{farmCompletionPopup.required_goats}<br />Tupa: {farmCompletionPopup.entered_sheep}/{farmCompletionPopup.required_sheep}<br />Total: {farmCompletionPopup.entered_goats + farmCompletionPopup.entered_sheep}/{farmCompletionPopup.required_goats + farmCompletionPopup.required_sheep}</p>
              <p>Started: {new Date(farmCompletionPopup.started_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}<br />Completed: {farmCompletionPopup.completed_at ? new Date(farmCompletionPopup.completed_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}</p>
              <Button onClick={() => setFarmCompletionPopup(null)}>Close</Button>
            </section>
          </div>
        )}
      </main>
    );
  }

  if (!isAdminRole(role)) {
    const farmerError = pageError
      ? /permission|denied|notallowed/i.test(pageError)
        ? 'Payagan ang camera sa device at subukan muli.'
        : cameraTestMode
          ? pageError
        : /database|migration|supabase|uuid|relation|schema/i.test(pageError)
          ? 'Hindi muna mai-save ang tala. Subukang muli o humingi ng tulong sa tagapangasiwa.'
          : 'Hindi mabuksan ang camera. Subukan muli.'
      : '';
    return (
      <main className="livestock-gate-page gate-farmer-page">
        <header className="gate-page-heading gate-farmer-heading">
          <div className="gate-farmer-heading-copy">
            <span className="gate-farmer-eyebrow"><Camera size={14} /> CAMERA SA GATE</span>
            <h1>Pagsubaybay sa Pasukan</h1>
            <p>Gamitin ang camera para itala ang pagpasok at paglabas ng mga hayop.</p>
          </div>
          <span className={'gate-farmer-status ' + (isMonitoring && cameraState === 'scanning' ? 'is-good' : cameraState === 'error' ? 'is-bad' : '')} role="status" aria-live="polite">
            <span className="gate-session-dot" />
            {cameraState === 'error' ? 'Walang koneksyon' : cameraState === 'starting' ? 'Binubuksan ang camera' : isMonitoring && cameraState === 'scanning' ? 'Nagbibilang' : isMonitoring ? 'Naka-pause' : cameraState === 'scanning' ? 'Handa' : 'Nakasara'}
          </span>
        </header>

        <Button variant="outline" size="sm" onClick={() => handleCameraSourceChange('farm')} disabled={isMonitoring}>
          Bumalik sa bilang ng CCTV
        </Button>

        <details className="gate-farmer-connection-details">
          <summary><Activity size={16} /> Katayuan ng koneksyon sa camera</summary>
          <CameraGatewayStatusCard showCounts={false} />
        </details>

        <nav className="gate-section-nav gate-farmer-nav" aria-label="Mga seksyon ng camera monitoring">
          <a href="#gate-section-camera"><Camera size={15} /> Camera</a>
          <a href="#gate-section-overview"><Eye size={15} /> Bilang</a>
          <a href="#gate-section-history"><Activity size={15} /> Mga Galaw</a>
        </nav>

        {farmerError && <div className="gate-farmer-error" role="alert">{farmerError}</div>}

        <div className="gate-farmer-main-grid">
        <section id="gate-section-camera" className="gate-farmer-camera-section">
          <div className="gate-farmer-camera-heading">
            <div><h2>Camera ng device</h2><p>Gamitin ang eartag para matukoy ang hayop na tumawid.</p></div>
            {cameraState === 'scanning' && <span className="gate-farmer-live-pill"><span className="gate-live-dot" /> LIVE</span>}
          </div>
          <div className="gate-video-frame gate-farmer-video-frame">
            <div id={SCANNER_ID} className={cameraState === 'off' || cameraState === 'error' ? 'gate-video-hidden' : 'gate-video-mounted'}>
            </div>
            {cameraState === 'starting' && (
              <div className="gate-camera-placeholder is-loading" role="status" aria-live="polite">
                <LoaderCircle size={34} className="gate-camera-loading-icon" />
                <strong>Binubuksan ang camera</strong>
                <span>Sandali lang.</span>
              </div>
            )}
            {cameraState !== 'scanning' && cameraState !== 'starting' && (
              <div className="gate-camera-placeholder">
                <CameraOff size={36} />
                <strong>{cameraState === 'error' ? 'Walang koneksyon sa camera' : 'Nakasara ang camera'}</strong>
                <span>{cameraState === 'error'
                  ? 'Pakicheck ang koneksyon ng camera at subukan muli.'
                  : reconciliationWindowComplete
                  ? 'Tapos na ang oras ng monitoring. Tapusin ito para makita kung aling hayop ang kailangang beripikahin.'
                  : 'Payagan ang paggamit ng camera sa device.'}</span>
              </div>
            )}
            {cameraState === 'scanning' && (
              <>
                {retainedBoxTracks.map((track) => {
                  const identity = farmAnimals.find((animal) => animal.id === identifiedTrackIds[track.id]);
                  const boxIsStale = track.consecutiveMisses > 0 || clockNow - track.lastSeenAt > DETECTION_INTERVAL_MS * 1.5;
                  return (
                    <div
                      className={'gate-track-box is-' + track.species + (identity ? ' is-identified' : '') + (boxIsStale ? ' is-stale' : '')}
                      key={track.id}
                      style={{ left: `${track.displayBox[0] * 100}%`, top: `${track.displayBox[1] * 100}%`, width: `${(track.displayBox[2] - track.displayBox[0]) * 100}%`, height: `${(track.displayBox[3] - track.displayBox[1]) * 100}%` }}
                    >
                      <strong>{identity ? `${trackQrIdentityRef.current[track.id]?.eartagNumber ?? identity.eartag_number ?? identity.tag_id} — ${identity.name}` : `${speciesLabel(track.species)} na nakita`}</strong>
                      <span>{boxIsStale ? 'Huling nakita · ina-update' : identity ? `${speciesLabel(identity.species)} · Na-verify ang eartag` : 'Hindi pa nakikilala'}</span>
                    </div>
                  );
                })}
                <div className="gate-camera-overlay gate-farmer-camera-overlay">
                  <span><span className="gate-live-dot" /> LIVE</span>
                </div>
                {reconciliationWindowComplete
                  ? <div className="gate-detection-notice" role="status">Tapos na ang oras ng pagbibilang. Tapusin ang monitoring para makita ang mga hayop na kailangang beripikahin.</div>
                  : detectorState === 'error' && <div className="gate-detection-notice" role="status">Hindi muna masuri ang mga hayop.</div>}
              </>
            )}
          </div>

          {cameraTestMode && cameraState === 'scanning' && (
            <div className="gate-farmer-error" role="status">
              Live preview lang ito. Hindi pa nagtatala ng pasok o labas.
            </div>
          )}

          {pendingQr?.animal ? (
            <div className="gate-farmer-result is-identified" aria-live="polite">
              <CheckCircle2 size={21} />
              <div><strong>Nakilala ang hayop</strong><span>{pendingQr.eartagNumber ? `Eartag ${pendingQr.eartagNumber} · ` : ''}{pendingQr.animal.name} · {speciesLabel(pendingQr.animal.species)} · {pendingQr.eartagNumber ? 'Na-verify ang eartag' : 'Na-verify ang QR'}</span></div>
            </div>
          ) : qrState === 'unknown' ? (
            <div className="gate-farmer-result" aria-live="polite">
              <QrCode size={21} />
              <div><strong>Hindi nakilala</strong><span>Hindi mabasa nang malinaw ang eartag number. Hindi ito itatala bilang ibang hayop.</span></div>
            </div>
          ) : visibleTracks.length > 0 && visibleUnidentified > 0 ? (
            <div className="gate-farmer-result" aria-live="polite">
              <Eye size={21} />
              <div><strong>Kambing/Tupa na nakita</strong><span>Hindi pa nakikilala</span></div>
            </div>
          ) : null}

          {recordingControl}

          <div className="gate-farmer-camera-actions">
            {!isMonitoring && cameraTestMode && cameraState === 'scanning' ? (
              <Button variant="secondary" size="lg" fullWidth onClick={() => { void stopCameraTest(); }} leftIcon={<Pause size={17} />}>Isara ang preview</Button>
            ) : !isMonitoring ? (
              <Button size="lg" fullWidth onClick={() => { void startSession(); }} loading={pageLoading || farmData.loading} disabled={!isSupabaseAuthUserId(user?.id) || expectedAnimals.length === 0} leftIcon={<Camera size={17} />}>
                {cameraTestMode ? 'Subukang muli' : 'Simulan ang pagbibilang'}
              </Button>
            ) : cameraState === 'scanning' ? (
              <Button variant="secondary" size="lg" fullWidth onClick={() => { void stopScanner(); }} leftIcon={<Pause size={17} />}>I-pause ang camera</Button>
            ) : (
              <Button size="lg" fullWidth onClick={() => { void startScanner(); }} loading={cameraState === 'starting'} leftIcon={<Play size={17} />}>
                {cameraState === 'error' ? 'Subukan muli' : 'Buksan muli ang camera'}
              </Button>
            )}
            {expectedAnimals.length === 0 && !isMonitoring && (
              <p className="gate-farmer-empty-herd">Magdagdag muna ng kambing o tupa sa talaan bago simulan ang camera.</p>
            )}
            {isMonitoring && reconciliationWindowComplete && (
              <Button variant="outline" size="lg" fullWidth onClick={() => { void onFinishSession(); }} loading={finishing} leftIcon={<CheckCircle2 size={17} />}>Tapusin ang monitoring</Button>
            )}
          </div>
        </section>

        <section id="gate-section-overview" className="gate-farmer-summary" aria-label="Kalagayan ng mga hayop">
          <div className="gate-farmer-summary-heading"><span className="gate-farmer-eyebrow">SA KASALUKUYANG SESSION</span><h2>Mga hayop na pumasok</h2></div>
          <div className="gate-farmer-primary-stats">
            <div className="gate-farmer-stat is-total"><strong>{totalEntered}</strong><span>Total Entry</span></div>
          </div>
        </section>
        </div>

        <GateDetectionHistory
          items={detectionHistory}
          sessionId={session?.id}
          loading={detectionHistoryLoading}
          error={detectionHistoryError}
          cameraState={cameraState}
          detectorActive={detectionActive}
          farmerFriendly
        />

        <section className="gate-farmer-health-link" aria-label="Hiwalay na health scanner">
          <div><strong>Suriin ang kalagayan</strong><span>Gamitin ang camera para tingnan ang kambing o tupa.</span></div>
          <Button type="button" variant="secondary" onClick={() => navigate('/health-screening')}>Suriin ang hayop</Button>
        </section>

        <section id="gate-section-alerts" className="gate-farmer-alerts">
          <div className="gate-farmer-alert-heading"><Bell size={19} /><h2>Mga Paalala</h2></div>
          {activeAlerts.length === 0 ? (
            <p className="gate-farmer-no-alerts">Walang paalala sa ngayon.</p>
          ) : (
            <div className="gate-farmer-alert-list">
              {activeAlerts.slice(0, 5).map((alert) => {
                const animal = accountAnimal(alert.animal_id);
                const isMovementAlert = alert.alert_type === 'movement_observation';
                const isUnaccountedAlert = alert.alert_type === 'unaccounted';
                return (
                  <article className="gate-farmer-alert" key={alert.id}>
                    <div>
                      <strong>{isMovementAlert ? 'Kailangan ng Atensyon' : isUnaccountedAlert ? 'May hayop na hindi pa nakikita' : 'May bagong paalala'}</strong>
                      <p>{isMovementAlert
                        ? `May napansing hindi karaniwang galaw${animal ? ` kay ${animal.name}` : ''}. Mainam na tingnan ito nang personal.`
                        : isUnaccountedAlert
                          ? `${animal ? `${animal.name} (${speciesLabel(animal.species)})` : 'May isang kambing/tupa'} ang hindi pa nakumpirma.`
                          : animal ? `Tingnan ang paalala para kay ${animal.name}.` : 'Tingnan ang mga tala ng hayop.'}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => navigate(animal ? `/animals/${animal.id}` : '/animals')}>Tingnan</Button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {isMonitoring && !reconciliationWindowComplete && (
          <p className="gate-farmer-session-note" role="status">Aktibo ang pagsubaybay. Patuloy na susuriin ng camera ang pasukan.</p>
        )}
      </main>
    );
  }

  return (
    <main className="livestock-gate-page">
      <div className="gate-page-heading">
        <div>
          <div className="gate-eyebrow"><Activity size={15} /> CAMERA SA GATE</div>
          <h1>Pagsubaybay sa Pasukan</h1>
          <p>Ang QR o eartag scan sa camera ng device ang magtatala ng pagkakakilanlan at pagtawid.</p>
        </div>
        <div className={'gate-session-pill ' + (isMonitoring ? 'is-live' : '')}>
          <span className="gate-session-dot" />
          {pageLoading ? 'Inihahanda' : isMonitoring ? 'Nagmo-monitor' : session?.status === 'reconciled' ? 'Tapos na ang pagsusuri' : 'Hindi pa nagsisimula'}
        </div>
      </div>

      <CameraGatewayStatusCard />

      <Button variant="outline" size="sm" onClick={() => handleCameraSourceChange('farm')} disabled={isMonitoring}>
        Bumalik sa bilang ng CCTV
      </Button>

      <nav className="gate-section-nav" aria-label="Mga seksyon ng Camera Monitoring">
        <a href="#gate-section-overview"><Eye size={15} /> Kalagayan</a>
        <a href="#gate-section-camera"><Camera size={15} /> Live camera</a>
        <a href="#gate-section-session"><ShieldCheck size={15} /> Session</a>
        <a href="#gate-section-events"><Activity size={15} /> Galaw</a>
        <a href="#gate-section-history"><Eye size={15} /> Detection History</a>
        <a href="#gate-section-alerts"><AlertTriangle size={15} /> Mga alerto</a>
      </nav>

      {pageError && (
        <div className="gate-inline-error" role="alert">
          <AlertTriangle size={18} />
          <span>{pageError}</span>
          <button type="button" onClick={() => setPageError('')} aria-label="Isara ang error"><X size={16} /></button>
        </div>
      )}

      {pageLoading && !session && (
        <Card className="gate-loading-card">
          <RefreshCw size={18} className="gate-spin" /> Inihahanda ang livestock gate data…
        </Card>
      )}

      <div className="gate-stats-grid" id="gate-section-overview">
        <StatTile label="Inaasahan" value={expectedCount} detail={`${expectedGoats} kambing · ${expectedSheep} tupa`} icon={<ShieldCheck size={21} />} accent="#238B45" />
        <StatTile label="Nakikita ngayon" value={visibleTracks.length} detail={`${visibleGoats} kambing · ${visibleSheep} tupa`} icon={<Eye size={21} />} accent="#2563EB" />
        <StatTile label="Tawid sa camera" value={cameraMetrics?.crossing_count ?? crossingTotal} detail={session ? `${session.max_visible_tracks} ang pinakamaraming sabay-sabay na nakita` : undefined} icon={<Activity size={21} />} accent="#0F766E" />
        <StatTile label="Nakilalang hayop" value={confirmedCount} icon={<Tag size={21} />} accent="#2563EB" />
        <StatTile label="Total Entry" detail="Sa session" value={totalEntered} icon={<DoorOpen size={21} />} accent="#238B45" />
        <StatTile label="Nakilalang pumasok" value={cameraMetrics?.verified_entry_count ?? directionCounts.entry} icon={<Tag size={21} />} accent="#2563EB" />
        <StatTile label="Kabuuang lumabas" value={cameraMetrics?.camera_exit_count ?? cameraCrossings.filter((crossing) => crossing.direction === 'exit').length} icon={<LogOut size={21} />} accent="#D97706" />
        <StatTile label="Nasa kulungan" value={insideCount} icon={<DoorOpen size={21} />} accent="#0F766E" />
        <StatTile label="Hindi pa nakikilala" value={visibleUnidentified} icon={<AlertTriangle size={21} />} accent={visibleUnidentified ? '#D97706' : '#6B7280'} />
      </div>

      <div className="gate-main-grid">
        <Card className="gate-camera-card" padding="md" id="gate-section-camera">
          <div className="gate-card-heading">
            <div className="gate-heading-icon"><Camera size={19} /></div>
            <div>
              <h2>{cameraTestMode ? 'Test ng CCTV Connection' : 'CCTV Gate Monitoring'}</h2>
              <p>{cameraTestMode
                ? 'Test mode · sinusuri ang feed ng CCTV sa bukid.'
                : 'Live na camera sa pasukan at bilang ng mga hayop.'}</p>
            </div>
            <span className={'gate-status-badge ' + (cameraState === 'scanning' ? 'is-good' : cameraState === 'error' ? 'is-bad' : '')}>
              <span className="gate-status-dot" />
              {cameraState === 'scanning' ? 'Bukas ang camera' : cameraState === 'starting' ? 'Binubuksan' : cameraState === 'error' ? 'Hindi magamit' : 'Nakasara'}
            </span>
          </div>

          <div className="gate-camera-source">
            <strong>Camera sa pasukan</strong>
            <button type="button" className="gate-camera-refresh" onClick={() => { void startScanner(selectedCameraId, 'farm'); }} aria-label="Subukan muli ang CCTV sa bukid" title="Subukan muli ang CCTV sa bukid" disabled={cameraState === 'starting'}>
              <RefreshCw size={15} />
            </button>
            <span>Live na larawan mula sa camera sa bukid. Gamitin ang camera ng device para suriin ang hayop.</span>
          </div>

          <div className="gate-video-frame" ref={cameraFrameRef}>
            <div id={SCANNER_ID} className={cameraState === 'off' || cameraState === 'error' ? 'gate-video-hidden' : 'gate-video-mounted'}>
            </div>
            {cameraState === 'starting' && (
              <div className="gate-camera-placeholder is-loading" role="status" aria-live="polite">
                <LoaderCircle size={34} className="gate-camera-loading-icon" />
                <strong>Binubuksan ang live camera</strong>
                <span>Hintayin ang unang video frame bago simulan ang ML detection.</span>
              </div>
            )}
            {cameraState !== 'scanning' && cameraState !== 'starting' && (
              <div className="gate-camera-placeholder">
                {cameraState === 'error' ? <CameraOff size={36} /> : <Camera size={36} />}
                <strong>{cameraState === 'error' ? 'Hindi makakonekta sa camera' : 'Handa nang subukan ang camera'}</strong>
                <span>{cameraMessage || 'Pindutin ang “Subukan ang camera sa bukid” para buksan ang live preview.'}</span>
              </div>
            )}
            {cameraState === 'scanning' && (
              <>
                <div className="gate-detection-overlay" style={detectionOverlayStyle}>
                {retainedBoxTracks.map((track) => {
                  const identity = farmAnimals.find((animal) => animal.id === identifiedTrackIds[track.id]);
                  const readingQr = liveFrame.qrReadingTrackIds.includes(track.id);
                  const boxIsStale = track.consecutiveMisses > 0 || clockNow - track.lastSeenAt > DETECTION_INTERVAL_MS * 1.5;
                  const anomalyLabel = track.movementAnomaly === 'repeated_stop_start'
                    ? 'Pahinto-hinto ang galaw'
                    : track.movementAnomaly === 'repeated_direction_change'
                      ? 'Pabalik-balik ang direksyon'
                      : '';
                  const movement = anomalyLabel
                    ? anomalyLabel + (identity ? ' · Paunang alerto' : ' · Hindi pa nakikilala')
                    : track.movement === 'stopped' ? 'Huminto · pakitingnan' : track.movement === 'slow' ? 'Mabagal ang galaw' : 'Normal na galaw';
                  return (
                    <div
                      className={'gate-track-box is-' + track.species + (identity ? ' is-identified' : '') + (readingQr ? ' is-qr-reading' : '') + (boxIsStale ? ' is-stale' : '') + (track.observation !== 'normal' || track.movementAnomaly !== 'none' ? ' has-observation' : '')}
                      key={track.id}
                      title={anomalyLabel ? 'Paunang camera screening lamang. Suriin nang personal; hindi ito diagnosis.' : undefined}
                      style={{ left: `${track.displayBox[0] * 100}%`, top: `${track.displayBox[1] * 100}%`, width: `${(track.displayBox[2] - track.displayBox[0]) * 100}%`, height: `${(track.displayBox[3] - track.displayBox[1]) * 100}%` }}
                    >
                      <strong>{identity ? `${trackQrIdentityRef.current[track.id]?.eartagNumber ?? identity.eartag_number ?? identity.tag_id} — ${identity.name}` : speciesLabel(track.species)}</strong>
                      <span>{boxIsStale ? 'Huling nakita · ina-update' : identity ? `${speciesLabel(track.species)} · Number Verified · ${movement}` : readingQr ? 'Binabasa ang numero sa eartag…' : movement}</span>
                    </div>
                  );
                })}
                </div>
                <div className="gate-camera-overlay">
                  <span><span className="gate-live-dot" /> {cameraTestMode ? 'TEST · LIVE' : 'LIVE'}</span>
                  <span>Kambing {visibleGoats} · Tupa {visibleSheep}</span>
                </div>
              </>
            )}
          </div>

          <div className="gate-camera-status-row">
            <span className={'gate-status-line ' + (detectorState === 'ready' ? 'good' : detectorState === 'error' ? 'bad' : '')}>
              <Activity size={15} /> {detectorState === 'ready' ? 'Sinusuri ang mga hayop' : detectorState === 'loading' ? 'Inihahanda ang camera' : detectorState === 'error' ? 'Pansamantalang hindi masuri' : 'Handa kapag nagsimula'}
            </span>
            <span className={'gate-status-line ' + (qrState === 'verified' ? 'good' : qrState === 'unknown' ? 'bad' : '')}>
              <Tag size={15} /> Pagbasa ng eartag number: {qrState === 'waiting' ? 'Naghihintay' : qrState === 'detected' ? 'Binabasa' : qrState === 'verified' ? 'Nakilala' : qrState === 'unknown' ? 'Hindi nakilala' : 'Naulit'}
            </span>
            <span className="gate-status-line"><Clock3 size={15} /> {liveFrame.message}</span>
            <span className={'gate-status-line ' + (activityState === 'ready' ? 'good' : activityState === 'unavailable' ? 'bad' : '')} style={{ whiteSpace: 'normal' }} aria-live="polite">
              <Activity size={15} /> Kilos ng tupa (experimental): {activityDisplayMessage}
            </span>
            {isAdminRole(role) && cameraState === 'scanning' && (
              <details className="gate-ml-diagnostics">
                <summary>System diagnostics</summary>
                <div className="gate-ml-diagnostics-grid">
                  <span>Detector <strong>{detectorState === 'ready' ? 'Handa' : detectorState === 'error' ? 'Hindi available' : 'Naghihintay'}</strong></span>
                  <span>Model <strong>{detectorStatus?.model_version ?? '—'}</strong></span>
                  <span>Successful inference <strong>{detectorStatus?.diagnostics?.successful_inferences_total ?? 0}</strong></span>
                  <span>Errors <strong>{detectorStatus?.diagnostics?.failed_inferences_total ?? 0}</strong></span>
                  <span>Detections <strong>{detectorStatus?.diagnostics?.total_detections_by_class?.goat ?? 0} kambing · {detectorStatus?.diagnostics?.total_detections_by_class?.sheep ?? 0} tupa</strong></span>
                  <span>Recent FPS <strong>{detectorStatus?.diagnostics?.inference_fps_recent?.toFixed(2) ?? '—'}</strong></span>
                  <span>Average latency <strong>{detectorStatus?.diagnostics?.latency_ms_average_recent?.toFixed(0) ?? '—'} ms</strong></span>
                  <span>Last inference <strong>{detectorStatus?.diagnostics?.last_success_at ? new Date(detectorStatus.diagnostics.last_success_at).toLocaleTimeString() : 'Wala pa'}</strong></span>
                  <span>Weights SHA-256 <code>{detectorStatus?.model_sha256?.slice(0, 16) ?? '—'}</code></span>
                </div>
                {detectorDiagnosticsError && <small role="status">{detectorDiagnosticsError}</small>}
              </details>
            )}
          </div>

          <div className="gate-qr-result" aria-live="polite">
            <div className={'gate-qr-icon ' + (qrState === 'unknown' ? 'is-error' : qrState === 'verified' ? 'is-verified' : '')}>
              {qrState === 'unknown' ? <AlertTriangle size={19} /> : qrState === 'verified' ? <CheckCircle2 size={19} /> : <Tag size={19} />}
            </div>
            {pendingQr?.animal.photo_url && (
              <img className="gate-qr-animal-photo" src={pendingQr.animal.photo_url} alt={pendingQr.animal.name} />
            )}
            <div className="gate-qr-copy">
              <strong>{pendingQr ? (pendingQr.eartagNumber ? `${pendingQr.eartagNumber} — ` : '') + pendingQr.animal.name + (pendingQr.eartagNumber ? '' : ' · ' + pendingQr.animal.tag_id) : qrMessage}</strong>
          <span>{pendingQr
            ? `${speciesLabel(pendingQr.animal.species)} · ${savingEvent
              ? 'Awtomatikong itinatala ang pagtawid...'
              : pendingQr.direction === 'entry'
                ? 'Awtomatikong itatala ang pagbalik sa kulungan.'
                : pendingQr.direction === 'exit'
                  ? 'Awtomatikong itatala ang paglabas ng kulungan.'
                  : 'Susubaybayan ang direksyon ng galaw hanggang mawala ang hayop sa camera view.'}`
            : cameraTestMode && qrState === 'verified'
              ? 'Read-only test: natukoy sa farm list; walang pasok o labas na itatala.'
              : cameraTestMode
                ? 'Iharap ang eartag number sa camera para hanapin ito sa farm list.'
                : qrState === 'unknown'
                  ? 'Hindi itatala ang scan na ito.'
                  : 'Hahanapin ang eartag number sa talaan ng mga aktibong hayop sa bukid na ito.'}</span>
            </div>
            {(qrState === 'unknown' || qrState === 'duplicate' || pendingQr) && <Button variant="ghost" size="sm" onClick={dismissQr} disabled={savingEvent} leftIcon={<X size={15} />}>Dismiss</Button>}
          </div>

          {!cameraTestMode && <div className="gate-gate-config">
            <div>
              <strong>Direksyon ng pagpasok sa gate</strong>
              <span>Piliin ang direksyon ng paggalaw sa camera view. Para sa gate na kuha mula sa itaas, piliin ang itaas pababa.</span>
            </div>
            <div className="gate-direction-switch" role="group" aria-label="Gate direction">
              <button type="button" className={cameraOrientation === 'top-to-bottom' ? 'selected' : ''} onClick={() => configureCameraFlow('top-to-bottom')} disabled={isCameraMonitoring || savingEvent}>
                <LogIn size={16} /> Itaas → ibaba
              </button>
              <button type="button" className={cameraOrientation === 'bottom-to-top' ? 'selected' : ''} onClick={() => configureCameraFlow('bottom-to-top')} disabled={isCameraMonitoring || savingEvent}>
                <LogIn size={16} /> Ibaba → itaas
              </button>
            </div>
          </div>}

          <div className="gate-camera-actions">
            {!isMonitoring ? (
              cameraTestMode ? (
                <>
                  {cameraState === 'starting' && <Button variant="secondary" size="lg" fullWidth loading disabled leftIcon={<Camera size={17} />}>Binubuksan ang camera...</Button>}
                  {cameraState === 'scanning' && <Button variant="secondary" size="lg" fullWidth onClick={() => { void stopCameraTest(); }} leftIcon={<Pause size={17} />}>Tapusin ang camera test</Button>}
                  {cameraState === 'error' && <Button variant="outline" size="lg" fullWidth onClick={() => { void startCameraTest(); }} leftIcon={<RefreshCw size={16} />}>Subukan muli</Button>}
                </>
              ) : (
                <>
                  <Button size="lg" fullWidth onClick={() => { void startCameraTest(); }} loading={cameraState === 'starting'} disabled={!user} leftIcon={<Camera size={17} />}>
                  Subukan ang CCTV sa bukid
                  </Button>
                  <Button variant="secondary" size="lg" fullWidth onClick={startSession} loading={pageLoading || farmData.loading} disabled={!isSupabaseAuthUserId(user?.id) || expectedAnimals.length === 0} leftIcon={<Play size={17} />}>
                    {requestedCameraIntent === 'scan-qr' && expectedAnimals[0]
                      ? `Simulan ang QR scan ni ${expectedAnimals[0].name}`
                      : requestedCameraIntent === 'scan-qr' ? 'Hindi active ang hayop para i-scan' : 'Simulan ang gate monitoring'}
                  </Button>
                </>
              )
            ) : cameraState === 'scanning' ? (
              <Button variant="secondary" size="lg" fullWidth onClick={() => { void stopScanner(); }} leftIcon={<Pause size={17} />}>
                I-pause ang camera
              </Button>
            ) : (
              <Button size="lg" fullWidth onClick={() => { void startScanner(); }} loading={cameraState === 'starting'} leftIcon={<Play size={17} />}>
                Ibalik ang camera
              </Button>
            )}
            {cameraState === 'error' && isMonitoring && <Button variant="outline" onClick={() => { void startScanner(); }} leftIcon={<RefreshCw size={16} />}>Subukan muli</Button>}
          </div>
          {recordingControl}

          {cameraState === 'scanning' && (
            <p className="gate-model-note">{cameraTestMode
              ? 'Test mode: hindi nagtatala ng pasok, labas, o gate alert. Itutok ang camera sa kambing o tupa para makita ang ML detection; hindi kailangan ng aktuwal na gate.'
              : 'Kapag malinaw na nabasa ang QR ng eartag at nakumpirma ang galaw nito papasok o palabas ng camera view, awtomatikong itinatala ang pangalan at direksyon. Kung hindi mabasa ang QR o maraming hayop ang magkasabay, hindi manghuhula ng pagkakakilanlan. Ang galaw at activity estimate ay paunang screening lamang, hindi diagnosis.'}</p>
          )}
        </Card>

        <div className="gate-side-column">
          <Card className="gate-session-card" id="gate-section-session">
            <div className="gate-card-heading">
              <div className="gate-heading-icon"><ShieldCheck size={19} /></div>
              <div><h2>Session at paghahambing</h2><p>Ang aktibong kawan sa simula ang gagamiting batayan.</p></div>
            </div>
            <div className="gate-session-facts">
              <div><span>Gate</span><strong>Main Gate</strong></div>
              <div><span>Aktibong kawan sa simula</span><strong>{session?.expected_count ?? expectedAnimals.length} hayop</strong></div>
              {session && <div><span>Pinakamaraming sabay na nakita</span><strong>{session.max_visible_tracks}</strong></div>}
              {session && <div><span>Nagsimula</span><strong>{new Date(session.started_at).toLocaleString('fil-PH')}</strong></div>}
              {isMonitoring && <div><span>Natitirang oras</span><strong>{reconciliationWindowComplete ? 'Handa nang ihambing' : windowCountdown}</strong></div>}
              <div><span>Oras ng paghahambing</span>
                {session
                  ? <strong>{session.reconciliation_window_minutes} minuto</strong>
                  : <select value={windowMinutes} onChange={(event) => setWindowMinutes(Number(event.target.value))} aria-label="Oras ng paghahambing">
                      <option value={15}>15 minuto</option><option value={30}>30 minuto</option>
                      <option value={60}>1 oras</option><option value={120}>2 oras</option>
                    </select>}
              </div>
            </div>
            {session && sessionRosterAnimals.length > 0 && (
              <div className="gate-herd-roster" aria-live="polite">
                <div className="gate-herd-roster-heading">
                  <strong>Katayuan ng bawat hayop</strong>
                  <span>{movementSets.inside.size} nasa kulungan · {movementSets.missing.length} hindi pa kumpirmadong nasa loob</span>
                </div>
                <div className="gate-herd-roster-list">
                  {sessionRosterAnimals.map((animal) => {
                    const inside = movementSets.inside.has(animal.id);
                    const confirmed = movementSets.confirmed.has(animal.id);
                    const status = inside ? 'Nasa kulungan' : confirmed ? 'Lumabas · hindi pa nakabalik' : 'Wala pang QR scan';
                    return (
                      <div className="gate-herd-roster-row" key={animal.id}>
                        <span><strong>{animal.tag_id}</strong> · {animal.name}</span>
                        <small className={inside ? 'is-inside' : confirmed ? 'is-out' : ''}>{status}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {isMonitoring && (
              <div className="gate-reconcile-box">
                <p>{reconciliationWindowComplete ? 'Tapos na ang itinakdang oras. Ihahambing ngayon ang mga na-verify na QR sa inaasahang kawan.' : 'Hintayin ang itinakdang oras (' + windowCountdown + ' ang natitira). Hindi mamarkahang hindi nakita ang hayop mula sa isang frame lang.'}</p>
                {!confirmFinish ? (
                  <Button variant="outline" fullWidth disabled={!reconciliationWindowComplete} onClick={() => setConfirmFinish(true)} leftIcon={<CheckCircle2 size={16} />}>Tapusin ang paghahambing</Button>
                ) : (
                  <div className="gate-confirm-box">
                    <strong>Kumpirmahin ang pagtatapos?</strong>
                    <span>Ang hindi na-scan ay lalagyan lang ng “Kailangang beripikahin,” hindi permanenteng nawawala.</span>
                    <div><Button size="sm" onClick={onFinishSession} loading={finishing}>Kumpirmahin</Button><Button size="sm" variant="ghost" onClick={() => setConfirmFinish(false)}>Bumalik</Button></div>
                  </div>
                )}
                {!confirmCancel ? (
                  <button className="gate-cancel-link" type="button" onClick={() => setConfirmCancel(true)}>Kanselahin ang session</button>
                ) : (
                  <div className="gate-confirm-box is-cancel">
                    <strong>Kanselahin ang session?</strong><span>Mananatili ang mga movement log.</span>
                    <div><Button size="sm" variant="danger" onClick={onCancelSession} loading={finishing}>Kanselahin</Button><Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>Bumalik</Button></div>
                  </div>
                )}
              </div>
            )}
            {session?.status === 'reconciled' && (
              <div className={'gate-finish-summary ' + (session.missing_count ? 'has-missing' : '')}>
                <CheckCircle2 size={18} />
                <span>{session.missing_count ? session.missing_count + ' hayop ang kailangang beripikahin.' : 'Na-verify ang lahat ng inaasahang hayop.'}</span>
              </div>
            )}
            {session && session.status !== 'monitoring' && (
              <Button fullWidth onClick={startSession} loading={pageLoading || farmData.loading} leftIcon={<Play size={16} />}>
                Simulan muli
              </Button>
            )}
          </Card>

          <Card className="gate-sound-card">
            <div className="gate-card-heading">
              <div className="gate-heading-icon"><Bell size={18} /></div>
              <div><h2>Tunog ng alerto</h2><p>Isang maikling tunog para sa bagong alerto.</p></div>
            </div>
            <div className="gate-sound-actions">
              <Button variant={soundEnabled ? 'success' : 'secondary'} size="sm" onClick={() => { void toggleSound(); }} leftIcon={soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}>
                {soundEnabled ? 'May tunog' : 'Naka-mute'}
              </Button>
              <Button variant="ghost" size="sm" onClick={runSoundTest} leftIcon={<Volume2 size={16} />}>Subukan ang tunog</Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="gate-lower-grid">
        <Card className="gate-movement-card" id="gate-section-events">
          <div className="gate-card-heading">
            <div className="gate-heading-icon"><Activity size={18} /></div>
            <div><h2>Mga naitalang galaw</h2><p>Nase-save kapag nabasa ang rehistradong QR at nakumpirma ang direksyon ng galaw nito sa camera.</p></div>
          </div>
          {events.length === 0 && cameraCrossings.length === 0 ? (
            <div className="gate-empty-state"><QrCode size={23} /><span>Wala pang confirmed movement sa session na ito.</span></div>
          ) : (
            <>
              {events.length === 0
                ? <div className="gate-empty-state"><QrCode size={23} /><span>Wala pang nakilalang hayop sa session na ito.</span></div>
                : <div className="gate-events-list">
                    {events.slice(0, 12).map((event) => {
                      const animal = accountAnimal(event.animal_id);
                      return (
                        <div className="gate-event-row" key={event.id}>
                          <span className={'gate-direction-icon ' + event.direction}>
                            {event.direction === 'entry' ? <LogIn size={16} /> : <LogOut size={16} />}
                          </span>
                          <div className="gate-event-animal">
                          <strong>{animal?.name ?? 'Rehistradong hayop'}</strong>
                          <span>{animal?.eartag_number != null ? `Eartag ${animal.eartag_number}` : 'Walang eartag sa tala'} · {speciesLabel(event.species_detected)} · {event.direction === 'entry' ? 'Pumasok' : 'Lumabas'}</span>
                          </div>
                          <span className="gate-event-time">{formatTime(event.created_at)}</span>
                          <ChevronRight size={15} className="gate-event-chevron" />
                        </div>
                      );
                    })}
                  </div>}
              {cameraCrossings.length > 0 && (
                <div className="gate-events-list" style={{ marginTop: events.length ? 14 : 0 }}>
                  <div className="gate-card-heading" style={{ padding: '4px 0 8px' }}>
                    <div><h3>Mga tawid na nakita ng camera</h3><p>Hindi pa nakikilala ang hayop hangga’t hindi nakukumpirma ang eartag number.</p></div>
                  </div>
                  {cameraCrossings.slice(0, 12).map((crossing) => {
                    const animal = crossing.animal_id ? accountAnimal(crossing.animal_id) : undefined;
                    return (
                      <div className="gate-event-row" key={crossing.id}>
                        <span className={'gate-direction-icon ' + crossing.direction}>
                          {crossing.direction === 'entry' ? <LogIn size={16} /> : <LogOut size={16} />}
                        </span>
                        <div className="gate-event-animal">
                          <strong>{animal ? `${crossing.eartag_number ?? animal.eartag_number ?? 'Eartag walang tala'} — ${animal.name}` : crossing.eartag_number ? `Hindi nakilalang eartag · ${crossing.eartag_number}` : 'Hindi pa nakikilala'}</strong>
                          <span>{speciesLabel(crossing.species_detected)} · {crossing.direction === 'entry' ? 'Pumasok' : 'Lumabas'} · {crossing.eartag_verified ? 'Nakumpirma ang eartag' : crossing.qr_verified ? 'Nakumpirma ang QR' : 'Hindi pa nakikilala'}</span>
                        </div>
                        <span className="gate-event-time">{formatTime(crossing.created_at)}</span>
                        <ChevronRight size={15} className="gate-event-chevron" />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        <Card id="gate-section-alerts" className={'gate-alerts-card ' + (activeAlerts.length ? 'has-active-alerts' : '')}>
          <div className="gate-card-heading">
            <div className={'gate-heading-icon ' + (activeAlerts.length ? 'alert-icon' : '')}><AlertTriangle size={18} /></div>
            <div><h2>Mga alerto sa kawan</h2><p>Kabilang ang movement screening at hayop na kailangang beripikahin.</p></div>
          </div>
          {alerts.length === 0 ? (
            <div className="gate-empty-state"><ShieldCheck size={23} /><span>{session?.status === 'reconciled' ? 'Walang bukas na alerto sa session na ito.' : 'Wala pang alerto. I-scan ang eartag para maikabit ang galaw sa profile ng hayop.'}</span></div>
          ) : (
            <div className="gate-alert-list">
              {alerts.map((alert) => {
                const animal = accountAnimal(alert.animal_id);
                return (
                  <div className={'gate-alert-row status-' + alert.status} key={alert.id}>
                    {animal?.photo_url
                      ? <img className="gate-alert-photo" src={animal.photo_url} alt="" />
                      : <span className="gate-alert-photo-placeholder">{speciesLabel(animal?.species ?? 'goat').slice(0, 1)}</span>}
                    <div className="gate-alert-copy">
              <strong>{animal?.name ?? (animal?.eartag_number != null ? `Eartag ${animal.eartag_number}` : 'Hindi nakilalang hayop')} <span>· {speciesLabel(animal?.species ?? 'goat')}</span></strong>
                      <span>{alert.message}</span>
                      <small>{(alert.alert_type === 'movement_observation' ? 'Galaw · paunang screening · ' : 'Kawan · ') + (alert.status === 'active' ? 'Aktibo' : alert.status === 'acknowledged' ? 'Nakita na' : 'Nalutas na')}</small>
                    </div>
                    {alert.status !== 'resolved' && (
                      <div className="gate-alert-actions">
                        {alert.status === 'active' && <button type="button" disabled={alertBusyId === alert.id} onClick={() => { void updateAlert(alert, 'acknowledged'); }}>Nakita ko</button>}
                        {alert.alert_type === 'unaccounted' && !isMonitoring && <button type="button" disabled={pageLoading || farmData.loading} onClick={() => { void startSession(); }}>I-Rescan</button>}
                        <button type="button" className="resolve" disabled={alertBusyId === alert.id} onClick={() => { void updateAlert(alert, 'resolved'); }}>Isara</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <GateDetectionHistory
        items={detectionHistory}
        sessionId={session?.id}
        loading={detectionHistoryLoading}
        error={detectionHistoryError}
        cameraState={cameraState}
        detectorActive={detectionActive}
      />

      <div className="gate-operation-note">
        <ShieldCheck size={16} />
        <span>Ang QR ng eartag ang nag-uugnay sa eksaktong hayop. Ang galaw-alerto ay paunang computer-vision screening batay sa direksyon at paghinto; kailangan pa ring tingnan ang hayop nang personal. Hindi ito diagnosis, at hindi ito awtomatikong nakakakilala ng pilay o sakit.</span>
      </div>
    </main>
  );
}
