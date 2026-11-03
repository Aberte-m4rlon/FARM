import { type ReactNode, type HTMLAttributes } from 'react';

export type GridCols = 1 | 2 | 3 | 4 | 'auto';
export type GridGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ResponsiveGridProps extends HTMLAttributes<HTMLDivElement> {
  cols?: GridCols;
  gap?: GridGap;
  minItemWidth?: number;
  children: ReactNode;
}

export function ResponsiveGrid({
  cols = 4,
  gap = 'md',
  minItemWidth = 260,
  children,
  className = '',
  style,
  ...props
}: ResponsiveGridProps) {
  const getGapValue = (): string => {
    switch (gap) {
      case 'xs': return '8px';
      case 'sm': return '12px';
      case 'lg': return '24px';
      case 'xl': return '32px';
      case 'md':
      default:   return '16px';
    }
  };

  const getGridTemplateColumns = (): string => {
    if (cols === 'auto') {
      return `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`;
    }
    return `repeat(var(--grid-cols, ${cols}), minmax(0, 1fr))`;
  };

  return (
    <div
      className={`alpas-responsive-grid alpas-grid-cols-${cols} ${className}`}
      style={{
        display: 'grid',
        gridTemplateColumns: getGridTemplateColumns(),
        gap: getGapValue(),
        width: '100%',
        ['--grid-cols' as any]: cols === 'auto' ? undefined : cols,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
