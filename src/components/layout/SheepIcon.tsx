interface SheepIconProps {
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
}

export function SheepIcon({
  size = 22,
  className = '',
  color = 'currentColor',
  strokeWidth = 2,
}: SheepIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Wool puffs on top of head */}
      <path d="M8 6a2.2 2.2 0 0 1 4-1 2.2 2.2 0 0 1 4 1" />
      <path d="M6.5 8.5a2 2 0 0 1 1.5-2.5" />
      <path d="M17.5 8.5a2 2 0 0 0-1.5-2.5" />
      {/* Drooping rounded ears */}
      <path d="M7 9C5 9 3 11 3 13c0 1.5 1.5 2 3 1" />
      <path d="M17 9c2 0 4 2 4 4 0 1.5-1.5 2-3 1" />
      {/* Face contour */}
      <path d="M7.5 9.5c0 4 2 8.5 4.5 8.5s4.5-4.5 4.5-8.5" />
      {/* Muzzle / Nose */}
      <path d="M10.5 15h3" />
      <path d="M12 15v1.5" />
      {/* Eyes */}
      <circle cx="10" cy="11.5" r="0.8" fill={color} />
      <circle cx="14" cy="11.5" r="0.8" fill={color} />
    </svg>
  );
}
