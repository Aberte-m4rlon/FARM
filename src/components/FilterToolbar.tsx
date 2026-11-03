import React from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

/* ==========================================================================
   REUSABLE LIQUID GLASS FILTER TOOLBAR & CONTROLS
   Flexible rows that wrap on narrow screens.
   Visible borders in both Light & Dark modes. No green accents.
   ========================================================================== */

export interface FilterToolbarProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  rightAction?: React.ReactNode;
}

export function FilterToolbar({ children, className = '', style, rightAction }: FilterToolbarProps) {
  return (
    <div className={`filter-toolbar-wrapper ${className}`} style={style}>
      <div className="filter-toolbar">
        {children}
        {rightAction && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {rightAction}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 1. Search Control ─────────────────────────────────────────────────── */
export interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  minWidth?: number | string;
  maxWidth?: number | string;
}

export function FilterSearch({
  value,
  onChange,
  placeholder = 'Maghanap ng pangalan o ID...',
  style,
  minWidth,
  maxWidth,
}: FilterSearchProps) {
  return (
    <div
      className="filter-search-wrap filter-control"
      style={{
        ...(minWidth ? { minWidth } : {}),
        ...(maxWidth ? { maxWidth } : {}),
        ...style,
      }}
    >
      <Search size={15} className="filter-search-icon" />
      <input
        type="text"
        className="filter-search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: 10,
            background: 'none',
            border: 'none',
            color: 'var(--filter-secondary)',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Burahin ang paghahanap"
          aria-label="Burahin ang paghahanap"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/* ── 2. Dropdown Select Control ────────────────────────────────────────── */
export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: (FilterSelectOption | string)[];
  ariaLabel?: string;
  style?: React.CSSProperties;
  minWidth?: number | string;
  maxWidth?: number | string;
  icon?: React.ReactNode;
}

export function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  style,
  minWidth,
  maxWidth,
  icon,
}: FilterSelectProps) {
  return (
    <div
      className="filter-select-wrap filter-control"
      style={{
        ...(minWidth ? { minWidth } : {}),
        ...(maxWidth ? { maxWidth } : {}),
        ...style,
      }}
    >
      {icon && (
        <span
          style={{
            position: 'absolute',
            left: 10,
            pointerEvents: 'none',
            color: 'var(--filter-secondary)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <select
        className="filter-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel || 'Salain'}
        style={{
          ...(icon ? { paddingLeft: 30 } : {}),
        }}
      >
        {options.map((opt) => {
          const optValue = typeof opt === 'string' ? opt : opt.value;
          const optLabel = typeof opt === 'string' ? opt : opt.label;
          return (
            <option key={optValue} value={optValue}>
              {optLabel}
            </option>
          );
        })}
      </select>
      <ChevronDown size={14} className="filter-select-chevron" />
    </div>
  );
}

/* ── 3. Toggle Control (e.g. Show Archived) ────────────────────────────── */
export interface FilterToggleProps {
  active: boolean;
  onToggle: (active: boolean) => void;
  label: string;
  activeLabel?: string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

export function FilterToggle({
  active,
  onToggle,
  label,
  activeLabel,
  icon,
  style,
}: FilterToggleProps) {
  return (
    <button
      type="button"
      className={`filter-toggle-btn filter-control ${active ? 'active' : ''}`}
      onClick={() => onToggle(!active)}
      style={style}
      aria-pressed={active}
    >
      {active ? <Check size={14} strokeWidth={2.5} /> : icon}
      <span>{active && activeLabel ? activeLabel : label}</span>
    </button>
  );
}

/* ── 4. Date Range Control ─────────────────────────────────────────────── */
export interface FilterDateRangeProps {
  fromValue: string;
  toValue: string;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  style?: React.CSSProperties;
}

export function FilterDateRange({
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  style,
}: FilterDateRangeProps) {
  return (
    <div className="filter-control" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      <input
        type="date"
        className="filter-date-input"
        value={fromValue}
        onChange={(e) => onFromChange(e.target.value)}
        title="Petsa mula"
        aria-label="Petsa mula"
      />
      <span style={{ color: 'var(--filter-secondary)', fontSize: 12, fontWeight: 600 }}>hanggang</span>
      <input
        type="date"
        className="filter-date-input"
        value={toValue}
        onChange={(e) => onToChange(e.target.value)}
        title="Petsa hanggang"
        aria-label="Petsa hanggang"
      />
    </div>
  );
}

/* ── 5. Button / Pill Item for Tabbed Filter (e.g. Status / Ranges) ─────── */
export interface FilterPillProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

export function FilterPill({
  active,
  onClick,
  label,
  count,
  icon,
  style,
}: FilterPillProps) {
  return (
    <button
      type="button"
      className={`filter-toggle-btn filter-control ${active ? 'active' : ''}`}
      onClick={onClick}
      style={{
        padding: count !== undefined ? '0 12px' : '0 14px',
        ...style,
      }}
      aria-selected={active}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            padding: '1px 6px',
            borderRadius: 999,
            marginLeft: 4,
            background: active ? 'rgba(0, 0, 0, 0.25)' : 'var(--filter-bg-hover)',
            color: active ? '#FFFFFF' : 'var(--filter-text)',
            border: active ? 'none' : '1px solid var(--filter-border)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ── 6. Filter Reset Button ────────────────────────────────────────────── */
export interface FilterResetButtonProps {
  onClick: () => void;
  label?: string;
}

export function FilterResetButton({ onClick, label = 'I-reset ang salain' }: FilterResetButtonProps) {
  return (
    <button
      type="button"
      className="filter-toggle-btn filter-control"
      onClick={onClick}
      style={{
        color: 'var(--filter-secondary)',
        fontSize: 12,
        background: 'transparent',
      }}
    >
      <X size={13} />
      <span>{label}</span>
    </button>
  );
}
