import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * ComboBox — type-to-filter dropdown with free-text fallback.
 * User can either pick from the list OR type anything custom.
 */
export function ComboBox({ value, onChange, options, placeholder = 'Search or type...', className = '', disabled = false, id }: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filtered options based on query
  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onChange(e.target.value); // allow free-text
    setOpen(true);
  };

  const handleSelect = (option: string) => {
    onChange(option);
    setQuery('');
    setOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    setQuery('');
    setOpen(true);
  };

  const displayValue = open ? query : value;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          id={id}
          className={`form-input ${className}`}
          style={{ paddingRight: 56 }}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 2 }}>
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
              tabIndex={-1}
              aria-label="Clear"
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
            tabIndex={-1}
            aria-label="Toggle dropdown"
            disabled={disabled}
          >
            <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
        </div>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: 'var(--color-surface-solid, #ffffff)',
          border: '1px solid var(--color-border, #E5E7EB)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
          maxHeight: 220, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-text-secondary, #78877F)' }}>
              No matches — press Enter or continue typing to use "{query || value}"
            </div>
          ) : (
            filtered.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(option); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                  color: 'var(--color-text-primary, #1F2937)',
                  borderBottom: '1px solid var(--color-border-light, #E5E7EB)',
                  fontWeight: option === value ? 700 : 400,
                  background: option === value ? 'var(--color-primary-soft, #EAF6ED)' : 'transparent',
                  border: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover, rgba(35, 139, 69, 0.08))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = option === value ? 'var(--color-primary-soft, #EAF6ED)' : 'transparent')}
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
