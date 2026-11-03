import { Badge, type BadgeVariant } from '../../ui/Badge';
import { Calendar, AlertTriangle, AlertOctagon } from 'lucide-react';

export interface ExpiryBadgeProps {
  expiryDate?: string | null;
  size?: 'sm' | 'md';
}

export function ExpiryBadge({ expiryDate, size = 'sm' }: ExpiryBadgeProps) {
  if (!expiryDate) return null;

  const now = new Date();
  const exp = new Date(expiryDate);
  const diffTime = exp.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let variant: BadgeVariant = 'neutral';
  let label = `Exp: ${expiryDate}`;
  let Icon = Calendar;

  if (diffDays < 0) {
    variant = 'danger';
    Icon = AlertOctagon;
    label = `Expired na (${Math.abs(diffDays)}d ago)`;
  } else if (diffDays <= 30) {
    variant = 'warning';
    Icon = AlertTriangle;
    label = `Malapit nang Mag-expire (${diffDays}d)`;
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
