import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { StockStatusBadge } from './StockStatusBadge';
import { ExpiryBadge } from './ExpiryBadge';
import { Package, Wheat, Pill, Shield, Edit2, AlertCircle } from 'lucide-react';
import type { InventoryItem } from '../../../types';

export interface InventoryItemCardProps {
  item: InventoryItem;
  onEdit?: () => void;
  onAdjustStock?: () => void;
  className?: string;
}

export function InventoryItemCard({
  item,
  onEdit,
  onAdjustStock,
  className = '',
}: InventoryItemCardProps) {
  const qty = Number(item.quantity) || 0;
  const minStock = Number(item.minimum_stock) || 0;
  const isLow = qty <= minStock;
  const isOut = qty <= 0;

  const getCategoryIcon = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes('feed') || c.includes('grain') || c.includes('hay')) return <Wheat size={18} />;
    if (c.includes('med') || c.includes('vacc') || c.includes('drug')) return <Pill size={18} />;
    return <Package size={18} />;
  };

  return (
    <Card
      variant={isOut ? 'danger' : isLow ? 'warning' : 'default'}
      padding="md"
      className={`alpas-inventory-item-card ${className}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Top Details */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-sm, 10px)',
              background: isOut ? 'rgba(239, 68, 68, 0.12)' : isLow ? 'rgba(245, 158, 11, 0.12)' : '#EAF6ED',
              color: isOut ? 'var(--color-danger, #EF4444)' : isLow ? 'var(--color-warning, #F59E0B)' : 'var(--color-primary, #238B45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {getCategoryIcon(item.category)}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
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
              {item.name}
            </h4>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #64748B)', marginTop: 2 }}>
              {item.category} {item.supplier ? `· ${item.supplier}` : ''}
            </div>
          </div>
        </div>

        <StockStatusBadge quantity={qty} minimumStock={minStock} size="sm" />
      </div>

      {/* Stock metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
          background: 'var(--color-surface-hover, rgba(148, 163, 184, 0.08))',
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm, 10px)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748B)', fontWeight: 600 }}>CURRENT STOCK</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-text-primary, #0F172A)', marginTop: 2 }}>
            {qty} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted, #64748B)' }}>{item.unit}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748B)', fontWeight: 600 }}>MINIMUM THRESHOLD</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-text-primary, #0F172A)', marginTop: 2 }}>
            {minStock} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted, #64748B)' }}>{item.unit}</span>
          </div>
        </div>
      </div>

      {/* Expiry Badge if present */}
      {item.expiry_date && (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ExpiryBadge expiryDate={item.expiry_date} size="sm" />
        </div>
      )}

      {/* Action footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            leftIcon={<Edit2 size={13} />}
          >
            Edit
          </Button>
        )}
        {onAdjustStock && (
          <Button
            variant="primary"
            size="sm"
            onClick={onAdjustStock}
          >
            Update Quantity
          </Button>
        )}
      </div>
    </Card>
  );
}
