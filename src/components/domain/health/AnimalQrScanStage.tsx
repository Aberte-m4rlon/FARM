import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { AlertCircle, ArrowLeft, Camera, QrCode, UploadCloud } from 'lucide-react';
import type { Animal } from '../../../types';
import { isAnimalActive } from '../../../lib/animalLifecycle';

interface AnimalQrScanStageProps {
  animals: Animal[];
  currentUserId?: string;
  onAnimalFound: (animal: Animal) => void;
  onUploadImage: () => void;
  onClose: () => void;
}

const CONTAINER_ID = 'alpasfarm-health-qr-reader';

export function AnimalQrScanStage({
  animals,
  currentUserId,
  onAnimalFound,
  onUploadImage,
  onClose,
}: AnimalQrScanStageProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const animalsRef = useRef(animals);
  const onAnimalFoundRef = useRef(onAnimalFound);
  const isMountedRef = useRef(true);
  const acceptedRef = useRef(false);
  const [cameraError, setCameraError] = useState('');
  const [scanMessage, setScanMessage] = useState('');

  useEffect(() => {
    animalsRef.current = animals;
  }, [animals]);

  useEffect(() => {
    onAnimalFoundRef.current = onAnimalFound;
  }, [onAnimalFound]);

  useEffect(() => {
    isMountedRef.current = true;
    acceptedRef.current = false;

    const scanner = new Html5Qrcode(CONTAINER_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          async (decodedText) => {
            if (acceptedRef.current) return;

            let payload: { type?: string; animalId?: string; farmId?: string };
            try {
              payload = JSON.parse(decodedText);
            } catch {
              setScanMessage('Hindi valid na ALPASFARM QR Code.');
              return;
            }

            if (
              payload.type !== 'alpasfarm_animal' ||
              !payload.animalId ||
              !payload.farmId
            ) {
              setScanMessage('Hindi valid na ALPASFARM QR Code.');
              return;
            }

            if (!currentUserId || payload.farmId !== currentUserId) {
              setScanMessage('Hindi kabilang sa iyong bukid ang QR code na ito.');
              return;
            }

            const animal = animalsRef.current.find(
              (item) =>
                item.id === payload.animalId &&
                item.user_id === currentUserId &&
                isAnimalActive(item) &&
                (item.species === 'Goat' || item.species === 'Sheep'),
            );

            if (!animal) {
              setScanMessage('Hindi makita ang aktibong hayop sa iyong bukid.');
              return;
            }

            acceptedRef.current = true;
            try {
              const state = scanner.getState();
              if (state === 2 || state === 3) await scanner.stop();
              scanner.clear();
            } catch {
              // The scanner may already be stopping during route changes.
            }
            if (isMountedRef.current) onAnimalFoundRef.current(animal);
          },
          () => {},
        );
      } catch (error) {
        if (!isMountedRef.current) return;
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        setCameraError(
          message.includes('permission') || message.includes('notallowed')
            ? 'Hindi pinahintulutan ang camera. I-on ang camera access sa browser settings at subukan muli.'
            : 'Hindi mabuksan ang camera. Suriin ang camera access at subukan muli.',
        );
      }
    };

    startScanner();

    return () => {
      isMountedRef.current = false;
      const activeScanner = scannerRef.current;
      scannerRef.current = null;
      if (!activeScanner) return;
      try {
        const state = activeScanner.getState();
        if (state === 2 || state === 3) {
          void activeScanner.stop().finally(() => activeScanner.clear());
        } else {
          activeScanner.clear();
        }
      } catch {
        // Ignore cleanup errors after the scanner has already stopped.
      }
    };
  }, [currentUserId]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100001,
        background: '#0B0F17',
        color: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        padding: 'max(16px, env(safe-area-inset-top)) 18px max(20px, env(safe-area-inset-bottom))',
        overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Bumalik"
          style={{ background: 'transparent', border: 0, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 6, padding: 8 }}
        >
          <ArrowLeft size={18} /> Bumalik
        </button>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Camera Monitoring</div>
        <span style={{ width: 72 }} />
      </header>

      <main style={{ width: '100%', maxWidth: 520, margin: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 58, height: 58, borderRadius: 18, background: 'rgba(34,197,94,.14)', color: '#4ADE80', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
            <QrCode size={30} />
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>I-scan muna ang QR Code</h2>
          <p style={{ color: '#CBD5E1', fontSize: 14, lineHeight: 1.5, margin: '8px 0 0' }}>
            I-scan ang QR code ng kambing o tupa para awtomatikong makilala ang hayop.
          </p>
        </div>

        <div style={{ position: 'relative', width: '100%', minHeight: 320, borderRadius: 18, overflow: 'hidden', background: '#111827', border: '1px solid rgba(255,255,255,.15)' }}>
          <div id={CONTAINER_ID} style={{ width: '100%', minHeight: 320 }} />
          {!cameraError && (
            <div style={{ position: 'absolute', inset: 0, margin: 'auto', width: 250, height: 250, border: '2px solid rgba(74,222,128,.9)', borderRadius: 20, pointerEvents: 'none', boxShadow: '0 0 0 999px rgba(0,0,0,.18)' }} />
          )}
        </div>

        {cameraError ? (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FCA5A5', fontSize: 13 }}>
            <AlertCircle size={18} /> {cameraError}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94A3B8', fontSize: 13 }}>
            <Camera size={17} /> Itapat ang camera sa QR code ng hayop.
          </div>
        )}

        <button
          type="button"
          onClick={onUploadImage}
          style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#FFFFFF', fontWeight: 700, cursor: 'pointer' }}
        >
          <UploadCloud size={17} /> Mag-upload ng larawan
        </button>

        {scanMessage && (
          <div role="alert" style={{ color: '#FCD34D', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 12, padding: '11px 13px', fontSize: 13 }}>
            {scanMessage}
          </div>
        )}
      </main>
    </div>
  );
}
