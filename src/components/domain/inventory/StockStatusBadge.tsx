import { Badge, type BadgeVariant } from '../../ui/Badge';
import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';

export interface StockStatusBadgeProps {
  quantity: number;
  minimumStock: number;
  size?: 'sm' | 'md';
}

export function StockStatusBadge({
  quantity,
  minimumStock,
  size = 'sm',
}: StockStatusBadgeProps) {
  let variant: BadgeVariant = 'success';
  let Icon = CheckCircle2;
  let label = 'In Stock';

  if (quantity <= 0) {
    variant = 'danger';
    Icon = AlertOctagon;
    label = 'Out of Stock';
  } else if (quantity <= minimumStock) {
    variant = 'warning';
    Icon = AlertTriangle;
    label = 'Mababa na ang Stock';
  }

  return (
    <Badge
      variant={variant}
      size={size}
      icon={<Icon size={size === 'sm' ? 12 : 14} />}
    >
      {label}
    </Badge>
  );
}
