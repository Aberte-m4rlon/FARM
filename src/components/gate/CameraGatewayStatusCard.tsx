import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Camera, RefreshCw } from 'lucide-react';
import { getFarmCameraCount, type FarmCameraCountResult } from '../../lib/gateDetection';
import { getFarmCameraStatus, type FarmCameraStatus } from '../../lib/cameraStream';
import './CameraGatewayStatusCard.css';

interface CameraGatewayStatusCardProps {
  compact?: boolean;
  showCounts?: boolean;
}

interface CameraSnapshot {
  status: FarmCameraStatus | null;
  count: FarmCameraCountResult | null;
  failed: boolean;
}

const EMPTY: CameraSnapshot = { status: null, count: null, failed: false };

function formatLastFrame(timestamp: string | null): string {
  if (!timestamp) return 'Wala pang natatanggap na live frame';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `Huling frame ${date.toLocaleString('fil-PH', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Wala pang natatanggap na live frame';
}

function formatLastHeartbeat(timestamp: string | null): string {
  if (!timestamp) return 'Wala pang natatanggap na gateway heartbeat';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `Huling heartbeat ${date.toLocaleString('fil-PH', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Wala pang natatanggap na gateway heartbeat';
}

export function CameraGatewayStatusCard({ compact = false, showCounts = true }: CameraGatewayStatusCardProps) {
  const [snapshot, setSnapshot] = useState<CameraSnapshot>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const [statusResult, countResult] = await Promise.allSettled([
        getFarmCameraStatus(),
        showCounts ? getFarmCameraCount() : Promise.resolve(null),
      ]);
      const status = statusResult.status === 'fulfilled' ? statusResult.value : null;
      const count = countResult.status === 'fulfilled' ? countResult.value : null;
      setSnapshot({
        status,
        count,
        failed: statusResult.status === 'rejected' || (showCounts && countResult.status === 'rejected' && Boolean(status?.active)),
      });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [showCounts]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(poll);
  }, [refresh]);

  const online = snapshot.status?.stream_connected === true;
  const lastFrame = snapshot.count?.detected_at ?? snapshot.status?.last_frame_at ?? null;
  const statusLabel = online ? 'Gumagana' : 'Walang live na koneksyon';

  return (
    <section className={`camera-gateway-card${compact ? ' is-compact' : ''}`} aria-label="Kalagayan ng CCTV gateway at camera">
      <div className="camera-gateway-heading">
        <div className="camera-gateway-title">
          <span className="camera-gateway-title-icon"><Activity size={17} /></span>
          <strong>{compact ? 'Camera sa bukid' : 'Koneksyon ng camera sa bukid'}</strong>
        </div>
        <button type="button" className="camera-gateway-refresh" onClick={() => void refresh()} disabled={refreshing} aria-label="I-refresh ang status ng camera" title="I-refresh">
          <RefreshCw size={15} className={refreshing ? 'gate-spin' : undefined} />
          <span>I-refresh</span>
        </button>
      </div>

      {snapshot.failed && <p className="camera-gateway-warning" role="status">Hindi makuha ang pinakabagong status. Ipinapakita ang huling tala.</p>}
      <div className="camera-gateway-status-tile">
        <span className="camera-gateway-status-icon"><Camera size={16} /></span>
        <div>
          <strong>Camera sa pasukan</strong>
          <span className="camera-gateway-status-value">{snapshot.status ? statusLabel : 'Hindi matukoy'}</span>
          <small>{formatLastFrame(lastFrame)}</small>
        </div>
        <i className={online ? 'is-online' : 'is-offline'} aria-hidden="true" />
      </div>

      <div className="camera-gateway-status-tile">
        <span className="camera-gateway-status-icon"><Activity size={16} /></span>
        <div>
          <strong>Gateway service</strong>
          <span className="camera-gateway-status-value">{snapshot.status ? snapshot.status.gateway_online ? 'Online' : 'Offline' : 'Hindi matukoy'}</span>
          <small>{formatLastHeartbeat(snapshot.status?.gateway_last_seen_at ?? null)}</small>
        </div>
        <i className={snapshot.status?.gateway_online ? 'is-online' : 'is-offline'} aria-hidden="true" />
      </div>

      {showCounts && <div className="camera-gateway-counts" aria-live="polite">
        <div className="camera-gateway-count-total"><span>Hayop sa camera</span><strong>{online ? snapshot.count?.animal_count ?? '—' : '—'}</strong></div>
        <div className="camera-gateway-count-flow">
          <span>Galaw sa gate</span>
          <div><span><small>Pumasok</small><strong>{snapshot.count?.entries_total ?? '—'}</strong></span><span><small>Lumabas</small><strong>{snapshot.count?.exits_total ?? '—'}</strong></span></div>
          <small className="camera-gateway-count-note">{snapshot.count ? formatLastFrame(snapshot.count.detected_at) : 'Wala pang bilang'}</small>
        </div>
      </div>}
    </section>
  );
}
