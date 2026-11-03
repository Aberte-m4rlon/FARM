import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Clock3, Eye, X } from 'lucide-react';
import type { GateDetectionHistoryItem, GateHistoryEventType } from '../../lib/gateDetectionHistory';
import './GateDetectionHistory.css';

type HistoryFilter = 'all' | 'goat' | 'sheep' | 'entry' | 'exit' | 'unidentified';

const FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'Lahat' },
  { value: 'goat', label: 'Kambing' },
  { value: 'sheep', label: 'Tupa' },
  { value: 'entry', label: 'Pumasok' },
  { value: 'exit', label: 'Lumabas' },
  { value: 'unidentified', label: 'Hindi nakilala' },
];

function speciesLabel(species: GateDetectionHistoryItem['species']) {
  return species === 'sheep' ? 'Tupa' : 'Kambing';
}

function eventLabel(event: GateHistoryEventType) {
  return event === 'entry' ? 'Pumasok' : event === 'exit' ? 'Lumabas' : 'Nakita';
}

function formatHistoryDate(value: string, includeDate = false) {
  return new Intl.DateTimeFormat('fil-PH', includeDate
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { hour: '2-digit', minute: '2-digit' },
  ).format(new Date(value));
}

export interface GateDetectionHistoryProps {
  items: GateDetectionHistoryItem[];
  sessionId?: string;
  loading: boolean;
  error: string;
  cameraState: 'off' | 'starting' | 'scanning' | 'error';
  detectorActive: boolean;
  farmerFriendly?: boolean;
}

export function GateDetectionHistory({
  items,
  sessionId,
  loading,
  error,
  cameraState,
  detectorActive,
  farmerFriendly = false,
}: GateDetectionHistoryProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedItem, setSelectedItem] = useState<GateDetectionHistoryItem | null>(null);
  const sessionItems = useMemo(
    () => sessionId ? items.filter((item) => item.sessionId === sessionId) : [],
    [items, sessionId],
  );
  const filteredItems = useMemo(() => sessionItems.filter((item) => {
    if (filter === 'goat' || filter === 'sheep') return item.species === filter;
    if (filter === 'entry' || filter === 'exit') return item.eventType === filter;
    if (filter === 'unidentified') return !item.qrVerified || !item.animalId;
    return true;
  }), [filter, sessionItems]);
  const tracks = useMemo(() => {
    const byTrack = new Map<string, GateDetectionHistoryItem>();
    for (const item of sessionItems) {
      const key = item.trackingId ?? item.id;
      const previous = byTrack.get(key);
      if (!previous || (!previous.qrVerified && item.qrVerified)) byTrack.set(key, item);
    }
    return [...byTrack.values()];
  }, [sessionItems]);
  const recentItems = filteredItems.slice(0, visibleCount);
  const offline = cameraState === 'error';

  const openItem = (item: GateDetectionHistoryItem) => {
    if (item.animalId) {
      navigate(`/animals/${item.animalId}`);
      return;
    }
    setSelectedItem(item);
  };

  return (
    <section className={'gate-detection-history' + (farmerFriendly ? ' is-farmer-friendly' : '')} id="gate-section-history" aria-labelledby="gate-detection-history-title">
      <div className="gate-detection-history-heading">
        <div className="gate-detection-history-icon"><Eye size={19} /></div>
        <div className="gate-detection-history-title">
          <h2 id="gate-detection-history-title">{farmerFriendly ? 'Mga Kamakailang Galaw sa Gate' : 'Detection History'}</h2>
          <p>{farmerFriendly ? 'Mga pinakahuling pasok, labas at hayop na nakita.' : 'Mga hayop na nakita ng camera'}</p>
        </div>
        <span className={'gate-detection-state ' + (offline ? 'is-offline' : detectorActive ? 'is-active' : '')}>
          <span />
          {offline ? farmerFriendly ? 'Walang koneksyon' : 'Camera Offline' : detectorActive ? farmerFriendly ? 'Nagbibilang' : 'Detection Active' : cameraState === 'starting' ? 'Naghahanda ang camera' : farmerFriendly ? 'Naka-pause' : 'Hindi aktibo'}
        </span>
      </div>

      {sessionId && tracks.length > 0 && (
        <div className="gate-detection-session-summary" aria-label={farmerFriendly ? 'Buod ng kasalukuyang pagbibilang' : 'Buod ng kasalukuyang monitoring session'}>
          <strong>{farmerFriendly ? 'Sa session na ito' : 'Ngayong Monitoring'}</strong>
          <span>{tracks.length} nakita</span>
          <span>{tracks.filter((item) => item.species === 'goat').length} kambing</span>
          <span>{tracks.filter((item) => item.species === 'sheep').length} tupa</span>
          <span>{sessionItems.filter((item) => item.eventType === 'entry').length} pumasok</span>
          <span>{sessionItems.filter((item) => item.eventType === 'exit').length} lumabas</span>
          <span>{tracks.filter((item) => !item.qrVerified || !item.animalId).length} hindi nakilala</span>
        </div>
      )}

      <div className="gate-detection-filters" role="group" aria-label={farmerFriendly ? 'Salain ang mga galaw sa gate' : 'Salain ang detection history'}>
        {FILTERS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={filter === option.value ? 'is-selected' : ''}
            aria-pressed={filter === option.value}
            onClick={() => { setFilter(option.value); setVisibleCount(20); }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && <p className="gate-detection-history-error" role="alert">{error}</p>}
      {loading ? (
        <p className="gate-detection-history-empty">Kinukuha ang mga tala…</p>
      ) : recentItems.length === 0 ? (
        <div className="gate-detection-history-empty">
          <Eye size={21} />
          <strong>{farmerFriendly ? 'Wala pang galaw sa gate' : 'Maghintay ng detection'}</strong>
          <span>{farmerFriendly ? 'Lalabas dito ang pinakahuling pasok at labas kapag may naitala ang camera.' : 'Kapag may nakita ang camera na kambing o tupa, lalabas dito ang detection history.'}</span>
        </div>
      ) : (
        <div className="gate-detection-history-list" aria-live="polite">
          {recentItems.map((item) => {
            const identified = Boolean(item.qrVerified && item.animalId);
            const verificationLabel = item.eartagVerified
              ? farmerFriendly ? 'Na-verify ang eartag' : 'Number Verified'
              : item.qrVerified ? farmerFriendly ? 'Na-verify ang QR' : 'QR Verified'
                : item.eartagNumber ? farmerFriendly ? 'Hindi nakilala' : `Hindi Kilalang Eartag · ${item.eartagNumber}` : 'Hindi pa nakikilala';
            const MovementIcon = item.eventType === 'entry' ? ArrowDownRight : item.eventType === 'exit' ? ArrowUpRight : Eye;
            return (
              <button
                className="gate-detection-history-item"
                key={`${item.source}-${item.id}`}
                type="button"
                onClick={() => openItem(item)}
                aria-label={identified
                  ? `${item.animalName ?? 'Hayop'}, ${eventLabel(item.eventType)}, buksan ang profile`
                  : `${speciesLabel(item.species)} na nakita, tingnan ang detalye`}
              >
                <span className={'gate-detection-event-icon ' + item.eventType}><MovementIcon size={17} /></span>
                <span className="gate-detection-item-copy">
                  <strong>{identified ? item.animalName ?? (item.eartagNumber ? `Eartag ${item.eartagNumber}` : 'Rehistradong hayop') : item.eartagNumber ? farmerFriendly ? `Eartag ${item.eartagNumber} · Hindi nakilala` : `Number ${item.eartagNumber} · Hindi Kilalang Eartag` : speciesLabel(item.species)}</strong>
                  <span>
                    {speciesLabel(item.species)}
                    <span className="gate-detection-separator"> · </span>
                    {verificationLabel}
                  </span>
                </span>
                <span className={'gate-detection-event-label ' + item.eventType}>
                  {identified && <Check size={13} />}
                  {eventLabel(item.eventType)}
                </span>
                <span className="gate-detection-time">
                  <Clock3 size={13} />
                  {formatHistoryDate(item.createdAt)}
                </span>
                <ChevronRight size={16} className="gate-detection-chevron" />
              </button>
            );
          })}
        </div>
      )}

      {filteredItems.length > visibleCount && (
        <button
          className="gate-detection-more"
          type="button"
          onClick={() => setVisibleCount((count) => count + 20)}
        >
          Tingnan pa ang mga naunang detection
        </button>
      )}

      {selectedItem && (
        <div className="gate-detection-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedItem(null);
        }}>
          <section className="gate-detection-dialog" role="dialog" aria-modal="true" aria-labelledby="gate-detection-dialog-title">
            <button className="gate-detection-dialog-close" type="button" onClick={() => setSelectedItem(null)} aria-label="Isara ang detalye">
              <X size={18} />
            </button>
            <div className="gate-detection-dialog-icon"><CircleHelp size={22} /></div>
                    <h3 id="gate-detection-dialog-title">{farmerFriendly ? 'Detalye ng galaw' : 'Detalye ng detection'}</h3>
            <dl>
              <div><dt>Hayop</dt><dd>{selectedItem.eartagNumber ? `Eartag ${selectedItem.eartagNumber}` : speciesLabel(selectedItem.species)} · {selectedItem.eartagVerified ? farmerFriendly ? 'Na-verify ang eartag' : 'Number Verified' : selectedItem.qrVerified ? farmerFriendly ? 'Na-verify ang QR' : 'QR Verified' : 'Hindi pa nakikilala'}</dd></div>
              <div><dt>Galaw</dt><dd>{eventLabel(selectedItem.eventType)}</dd></div>
              <div><dt>Petsa at oras</dt><dd>{formatHistoryDate(selectedItem.createdAt, true)}</dd></div>
              <div><dt>Camera</dt><dd>Main Gate</dd></div>
              <div><dt>Huling nakita</dt><dd>{formatHistoryDate(selectedItem.lastSeenAt, true)}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </section>
  );
}
