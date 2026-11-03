import { useState, useMemo, type ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { SkeletonTable } from './Skeleton';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (item: T, index: number) => ReactNode;
  sortable?: boolean;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField?: keyof T | ((item: T, index: number) => string | number);
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (item: T, index: number) => void;
  pageSize?: number;
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyField = 'id',
  loading = false,
  emptyTitle = 'Walang tala',
  emptyDescription = 'Wala pang impormasyong maipapakita.',
  onRowClick,
  pageSize = 10,
  className = '',
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Sorting
  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;
      const result = valA < valB ? -1 : 1;
      return sortDirection === 'asc' ? result : -result;
    });
  }, [data, sortKey, sortDirection]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortKey(null);
        setSortDirection('asc');
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const getItemKey = (item: T, index: number): string | number => {
    if (typeof keyField === 'function') return keyField(item, index);
    return item[keyField] ?? index;
  };

  return (
    <div
      className={`alpas-data-table-container ${className}`}
      style={{
        width: '100%',
        borderRadius: 'var(--radius-xl, 24px)',
        border: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
        background: 'var(--color-surface, #FFFFFF)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card, 0 6px 24px rgba(15, 23, 42, 0.06))',
      }}
    >
      <div className="alpas-data-table-scroll" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table
          className="alpas-data-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left',
            fontSize: '13.5px',
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--color-surface-hover, rgba(148, 163, 184, 0.08))',
                borderBottom: '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
              }}
            >
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={{
                    padding: '14px 18px',
                    fontWeight: 700,
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-muted, #64748B)',
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                    width: col.width,
                    textAlign: col.align || 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      justifyContent:
                        col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                    }}
                  >
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span style={{ display: 'inline-flex', opacity: sortKey === col.key ? 1 : 0.4 }}>
                        {sortKey === col.key ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )
                        ) : (
                          <ChevronsUpDown size={14} />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: 0 }}>
                  <SkeletonTable rows={pageSize > 5 ? 5 : pageSize} cols={columns.length} />
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              paginatedData.map((item, index) => (
                <tr
                  key={getItemKey(item, index)}
                  onClick={() => onRowClick?.(item, index)}
                  className="alpas-table-row"
                  style={{
                    borderBottom: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.7))',
                    cursor: onRowClick ? 'pointer' : 'default',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      data-label={typeof col.header === 'string' || typeof col.header === 'number' ? String(col.header) : col.key}
                      style={{
                        padding: '14px 18px',
                        color: 'var(--color-text-primary, #0F172A)',
                        textAlign: col.align || 'left',
                        verticalAlign: 'middle',
                      }}
                    >
                      {col.render ? col.render(item, index) : item[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {!loading && data.length > pageSize && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderTop: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.8))',
            background: 'var(--color-surface, #FFFFFF)',
            fontSize: '12.5px',
            color: 'var(--color-text-muted, #64748B)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Nakaraang pahina"
              style={{ padding: '4px 10px', minHeight: 34 }}
            >
              <ChevronLeft size={14} /> Nakaraan
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Susunod na pahina"
              style={{ padding: '4px 10px', minHeight: 34 }}
            >
              Susunod <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
