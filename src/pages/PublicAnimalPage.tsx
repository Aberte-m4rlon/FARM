import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CalendarDays, Heart, ShieldCheck } from 'lucide-react';
import { AlpasFarmLogo } from '../components/common/AlpasFarmLogo';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

interface PublicAnimalData {
  tag_id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  date_of_birth: string | null;
  color_markings: string | null;
  photo_url: string | null;
  current_status: string;
  birth_count: number;
}

function speciesLabel(species: string): string {
  return /sheep|tupa/i.test(species) ? 'Tupa' : 'Kambing';
}

function sexLabel(sex: string): string {
  return /female|inahin|babae/i.test(sex) ? 'Babae / Inahin' : 'Lalaki / Barako';
}

function statusLabel(status: string | null | undefined): string {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'deceased': return 'NAMATAY NA';
    case 'sold': return 'Nabenta';
    case 'transferred': return 'Nailipat';
    case 'archived': return 'Naka-archive';
    default: return 'Aktibo';
  }
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('fil-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function PublicAnimalPage() {
  const { id: token } = useParams<{ id: string }>();
  const [animal, setAnimal] = useState<PublicAnimalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setAnimal(null);
    setError('');

    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      setError('Hindi valid ang QR code.');
      setLoading(false);
      return () => controller.abort();
    }

    fetch(`/api/public-animal?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { error?: string } & Partial<PublicAnimalData>;
        if (!response.ok) throw new Error(payload.error || 'Hindi mahanap ang Kambing/Tupa.');
        if (!payload.name || !payload.species || !payload.tag_id) {
          throw new Error('Hindi mahanap ang Kambing/Tupa.');
        }
        setAnimal(payload as PublicAnimalData);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Hindi ma-load ang public profile.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  return (
    <main style={{ minHeight: '100vh', padding: '24px 16px 40px', background: '#f4f7f5', color: '#17231c' }}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <AlpasFarmLogo size="sm" variant="emblem" style={{ width: 34, height: 34 }} />
          <strong style={{ letterSpacing: '.06em', color: '#176b39' }}>ALPASFARM</strong>
        </header>

        {loading ? (
          <section aria-live="polite" style={{ minHeight: 240, display: 'grid', placeItems: 'center', background: '#fff', borderRadius: 20 }}>
            <LoadingSpinner />
          </section>
        ) : error ? (
          <section role="alert" style={{ padding: 28, textAlign: 'center', background: '#fff', borderRadius: 20, border: '1px solid #e4ebe6' }}>
            <AlertCircle size={36} color="#b42318" style={{ margin: '0 auto 12px' }} />
            <h1 style={{ margin: '0 0 8px', fontSize: 21 }}>Hindi mabuksan ang profile</h1>
            <p style={{ margin: 0, color: '#59665d', lineHeight: 1.55 }}>{error}</p>
          </section>
        ) : animal ? (
          <article style={{ overflow: 'hidden', background: '#fff', borderRadius: 20, border: '1px solid #e4ebe6', boxShadow: '0 10px 32px rgba(20, 65, 39, .08)' }}>
            {animal.photo_url ? (
              <img src={animal.photo_url} alt={`${speciesLabel(animal.species)} na si ${animal.name}`} style={{ width: '100%', maxHeight: 330, objectFit: 'cover', display: 'block', background: '#edf3ef' }} />
            ) : (
              <div aria-hidden="true" style={{ height: 130, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#e5f1e8,#f5f8f6)', color: '#176b39', fontSize: 18, fontWeight: 700 }}>
                {speciesLabel(animal.species)}
              </div>
            )}
            <div style={{ padding: '22px clamp(18px,5vw,30px) 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#176b39', fontSize: 13, fontWeight: 700 }}>
                <ShieldCheck size={17} /> Pampublikong profile ng hayop
              </div>
              <h1 style={{ margin: '9px 0 4px', fontSize: 'clamp(25px,7vw,34px)', lineHeight: 1.15 }}>{animal.name}</h1>
              <p style={{ margin: 0, color: '#5f6b63' }}>{speciesLabel(animal.species)} · Eartag {animal.tag_id}</p>

              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 10, margin: '22px 0 0' }}>
                <div style={{ padding: 14, background: '#f5f8f6', borderRadius: 13 }}>
                  <dt style={{ color: '#66736a', fontSize: 12 }}>Lahi</dt>
                  <dd style={{ margin: '5px 0 0', fontWeight: 650 }}>{animal.breed || 'Walang tala'}</dd>
                </div>
                <div style={{ padding: 14, background: '#f5f8f6', borderRadius: 13 }}>
                  <dt style={{ color: '#66736a', fontSize: 12 }}>Kasarian</dt>
                  <dd style={{ margin: '5px 0 0', fontWeight: 650 }}>{sexLabel(animal.sex)}</dd>
                </div>
                <div style={{ padding: 14, background: '#f5f8f6', borderRadius: 13 }}>
                  <dt style={{ color: '#66736a', fontSize: 12 }}>Kasalukuyang katayuan</dt>
                  <dd style={{ margin: '5px 0 0', fontWeight: 750, color: String(animal.current_status ?? '').toLowerCase() === 'deceased' ? '#9f2d25' : undefined }}>{statusLabel(animal.current_status)}</dd>
                </div>
                {animal.date_of_birth && (
                  <div style={{ padding: 14, background: '#f5f8f6', borderRadius: 13 }}>
                    <dt style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#66736a', fontSize: 12 }}><CalendarDays size={14} /> Petsa ng kapanganakan</dt>
                    <dd style={{ margin: '5px 0 0', fontWeight: 650 }}>{formatDate(animal.date_of_birth)}</dd>
                  </div>
                )}
                {/female|inahin|babae/i.test(animal.sex) && (
                  <div style={{ padding: 14, background: '#f5f8f6', borderRadius: 13 }}>
                    <dt style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#66736a', fontSize: 12 }}><Heart size={14} /> Bilang ng panganganak</dt>
                    <dd style={{ margin: '5px 0 0', fontWeight: 650 }}>{animal.birth_count}</dd>
                  </div>
                )}
              </dl>
              {animal.color_markings && <p style={{ margin: '16px 0 0', color: '#59665d', fontSize: 14 }}>Kulay / marka: {animal.color_markings}</p>}
            </div>
          </article>
        ) : null}

        <footer style={{ marginTop: 18, textAlign: 'center', color: '#738077', fontSize: 12 }}>
          Ipinapakita lamang ang impormasyong itinakdang pampubliko ng may-ari.
        </footer>
      </div>
    </main>
  );
}
