import { type HTMLAttributes } from 'react';
import { Card } from './Card';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  circle?: boolean;
}

export function Skeleton({
  width = '100%',
  height = '16px',
  borderRadius = 'var(--radius-sm, 10px)',
  circle = false,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={`alpas-skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : borderRadius,
        background: 'var(--color-surface-hover, rgba(148, 163, 184, 0.16))',
        animation: 'alpas-pulse 1.6s ease-in-out infinite',
        ...style,
      }}
      {...props}
    />
  );
}

// ── SkeletonCard ──────────────────────────────────────────────────────────────
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card padding="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Skeleton width={40} height={40} circle />
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height={16} style={{ marginBottom: 6 }} />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '70%' : '100%'}
          height={14}
          style={{ marginBottom: 8 }}
        />
      ))}
    </Card>
  );
}

// ── SkeletonTable ─────────────────────────────────────────────────────────────
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} width={`${100 / cols}%`} height={16} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--color-border-light)' }}>
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} width={`${100 / cols}%`} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}
