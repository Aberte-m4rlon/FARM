import { Card } from '../../ui/Card';
import { AnimalImage } from './AnimalImage';
import { AnimalStatusBadge } from './AnimalStatusBadge';
import { QrCode, ChevronRight, Scale } from 'lucide-react';
import type { Animal } from '../../../types';

export interface AnimalCardProps {
  animal: Animal;
  onClick?: () => void;
  onShowQR?: (e: React.MouseEvent) => void;
  className?: string;
}

export function AnimalCard({
  animal,
  onClick,
  onShowQR,
  className = '',
}: AnimalCardProps) {
  return (
    <Card
      variant="interactive"
      padding="sm"
      onClick={onClick}
      className={`alpas-animal-card ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
      }}
    >
      {/* Animal Photo / Avatar */}
      <AnimalImage
        src={animal.photo_url}
        alt={animal.name}
        species={animal.species}
        size={52}
        borderRadius="var(--radius-md, 14px)"
      />

      {/* Info Section */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <h4
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--color-text-primary, #0F172A)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {animal.name}
          </h4>
          <span
            style={{
              fontSize: '11.5px',
              fontWeight: 600,
              color: 'var(--color-primary, #238B45)',
              background: '#EAF6ED',
              padding: '1px 6px',
              borderRadius: 'var(--radius-xs, 6px)',
              flexShrink: 0,
            }}
          >
            {animal.tag_id}
          </span>
        </div>

        <div
          style={{
            fontSize: '12.5px',
            color: 'var(--color-text-muted, #64748B)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 6,
          }}
        >
          {animal.species} · {animal.breed || 'Unknown breed'} · {animal.sex}
        </div>

        {/* Badges Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {animal.breeding_status && <AnimalStatusBadge status={animal.breeding_status} size="sm" />}
          {animal.weight_kg !== null && animal.weight_kg !== undefined && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-text-secondary, #475569)',
              }}
            >
              <Scale size={11} />
              {animal.weight_kg} kg
            </span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {onShowQR && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowQR(e);
            }}
            aria-label="View QR Code"
            title="View QR Code"
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm, 10px)',
              background: 'var(--color-surface-hover, rgba(148, 163, 184, 0.12))',
              border: 'none',
              color: 'var(--color-text-secondary, #475569)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <QrCode size={15} />
          </button>
        )}
        <ChevronRight size={16} style={{ color: 'var(--color-text-muted, #94A3B8)' }} />
      </div>
    </Card>
  );
}
