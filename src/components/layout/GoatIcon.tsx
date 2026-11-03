interface GoatIconProps {
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
}

export function GoatIcon({
  size = 22,
  className = '',
  color = 'currentColor',
  strokeWidth = 2,
}: GoatIconProps) {
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
      {/* Horns */}
      <path d="M7 5C5 3 3 3 2 4.5c0 2.5 3 4 5 4" />
      <path d="M17 5c2-2 4-2 5 1.5 0 2.5-3 4-5 4" />
      {/* Head */}
      <path d="M8 8.5C8 6.5 9.8 5 12 5s4 1.5 4 3.5v4c0 2.2-1.8 4-4 4s-4-1.8-4-4v-4z" />
      {/* Ears */}
      <path d="M7.5 9L4 10" />
      <path d="M16.5 9L20 10" />
      {/* Muzzle / Beard */}
      <path d="M11 19.5v2c0 .3.2.5.5.5h1c.3 0 .5-.2.5-.5v-2" />
      <path d="M10.5 14h3" />
      {/* Eyes */}
      <circle cx="10" cy="11" r="0.8" fill={color} />
      <circle cx="14" cy="11" r="0.8" fill={color} />
    </svg>
  );
}
