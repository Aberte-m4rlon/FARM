import { PawPrint } from 'lucide-react';

export interface AnimalImageProps {
  src?: string | null;
  alt?: string;
  species?: string;
  size?: number | string;
  borderRadius?: string;
  className?: string;
}

export function AnimalImage({
  src,
  alt = 'Animal',
  species = 'Goat',
  size = 48,
  borderRadius = 'var(--radius-md, 14px)',
  className = '',
}: AnimalImageProps) {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`alpas-animal-image ${className}`}
        style={{
          width: pixelSize,
          height: pixelSize,
          borderRadius,
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }

  const isSheep = species.toLowerCase().includes('sheep');

  return (
    <div
      className={`alpas-animal-placeholder ${className}`}
      style={{
        width: pixelSize,
        height: pixelSize,
        borderRadius,
        background: isSheep ? '#EAF6ED' : '#F4FAF5',
        color: isSheep ? '#176B35' : '#238B45',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontWeight: 700,
        fontSize: '12px',
      }}
    >
      <PawPrint size={typeof size === 'number' ? Math.max(16, Math.floor(size * 0.45)) : 20} />
    </div>
  );
}
