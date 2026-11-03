import { Badge, type BadgeVariant } from '../../ui/Badge';

export interface AnimalStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function AnimalStatusBadge({ status, size = 'sm' }: AnimalStatusBadgeProps) {
  const norm = (status || 'Active').toLowerCase();

  let variant: BadgeVariant = 'neutral';
  let label = status || 'Active';

  if (norm === 'active' || norm.includes('kasalukuyan')) {
    variant = 'success';
    label = 'Active / Kasalukuyan sa Bukid';
  } else if (norm.includes('pregnant') || norm.includes('buntis')) {
    variant = 'primary';
    label = 'Pregnant / Buntis';
  } else if (norm.includes('sold') || norm.includes('naibenta')) {
    variant = 'neutral';
    label = 'Sold / Naibenta';
  } else if (norm.includes('transferred') || norm.includes('nailipat')) {
    variant = 'neutral';
    label = 'Transferred / Nailipat';
  } else if (norm.includes('deceased') || norm.includes('namatay') || norm.includes('culled')) {
    variant = 'danger';
    label = 'Deceased / Namatay';
  } else if (norm.includes('quarantined') || norm.includes('isolated')) {
    variant = 'warning';
    label = 'Naka-quarantine';
  }

  return (
    <Badge variant={variant} size={size} dot>
      {label}
    </Badge>
  );
}
