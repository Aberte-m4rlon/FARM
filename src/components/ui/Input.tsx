import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { Search, X, Calendar, ChevronDown } from 'lucide-react';

// ── Base Form Field Wrapper ──────────────────────────────────────────────────
export interface FormFieldProps {
  label?: string;
  error?: string;
  helperText?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function FormField({
  label,
  error,
  helperText,
  hint,
  required,
  children,
  className = '',
  style,
}: FormFieldProps) {
  const displayHint = helperText ?? hint;

  return (
    <div className={`alpas-form-field ${className}`} style={{ marginBottom: 16, ...style }}>
      {label && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text-primary, #174B2A)',
            marginBottom: 6,
          }}
        >
          <span>{label}</span>
          {required && <span style={{ color: 'var(--color-danger, #EF4444)' }}>*</span>}
        </label>
      )}

      {children}

      {error ? (
        <p
          style={{
            margin: '4px 0 0 0',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--color-danger, #EF4444)',
          }}
        >
          {error}
        </p>
      ) : displayHint ? (
        <p
          style={{
            margin: '4px 0 0 0',
            fontSize: '12px',
            color: 'var(--text-secondary, #50645A)',
          }}
        >
          {displayHint}
        </p>
      ) : null}
    </div>
  );
}

// ── Standard Input ────────────────────────────────────────────────────────────
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      required,
      leftIcon,
      rightIcon,
      className = '',
      style,
      disabled,
      ...props
    },
    ref
  ) => {
    const inputElement = (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {leftIcon && (
          <span
            style={{
              position: 'absolute',
              left: 14,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-muted, #667085)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {leftIcon}
          </span>
        )}

        <input
          ref={ref}
          disabled={disabled}
          className={`alpas-input ${error ? 'has-error' : ''} ${className}`}
          style={{
            width: '100%',
            height: '42px',
            padding: `0 ${rightIcon ? '40px' : '14px'} 0 ${leftIcon ? '40px' : '14px'}`,
            fontSize: '13.5px',
            fontFamily: 'inherit',
            color: 'var(--input-text, var(--text-primary, #174B2A))',
            background: 'var(--input-bg, rgba(255, 255, 255, 0.80))',
            border: `1px solid ${error ? 'var(--color-danger, #EF4444)' : 'var(--input-border, rgba(35, 139, 69, 0.15))'}`,
            borderRadius: 'var(--radius-md, 12px)',
            outline: 'none',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
            ...style,
          }}
          {...props}
        />

        {rightIcon && (
          <span
            style={{
              position: 'absolute',
              right: 14,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-muted, #667085)',
              zIndex: 1,
            }}
          >
            {rightIcon}
          </span>
        )}
      </div>
    );

    if (label || error || helperText) {
      return (
        <FormField label={label} error={error} helperText={helperText} required={required}>
          {inputElement}
        </FormField>
      );
    }

    return inputElement;
  }
);

Input.displayName = 'Input';

// ── Search Input ──────────────────────────────────────────────────────────────
export interface SearchInputProps extends Omit<InputProps, 'leftIcon' | 'rightIcon'> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onClear, onChange, placeholder = 'Search...', ...props }, ref) => {
    const hasValue = Boolean(value && String(value).length > 0);

    return (
      <Input
        ref={ref}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        leftIcon={<Search size={16} />}
        rightIcon={
          hasValue && onClear ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted, #667085)',
                display: 'flex',
                alignItems: 'center',
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          ) : undefined
        }
        {...props}
      />
    );
  }
);

SearchInput.displayName = 'SearchInput';

// ── Date Input ────────────────────────────────────────────────────────────────
export const DateInput = forwardRef<HTMLInputElement, InputProps>(
  ({ ...props }, ref) => {
    return <Input ref={ref} type="date" leftIcon={<Calendar size={16} />} {...props} />;
  }
);

DateInput.displayName = 'DateInput';

// ── Number Input ──────────────────────────────────────────────────────────────
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(
  ({ ...props }, ref) => {
    return <Input ref={ref} type="number" {...props} />;
  }
);

NumberInput.displayName = 'NumberInput';

// ── Textarea ──────────────────────────────────────────────────────────────────
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, required, className = '', style, disabled, rows = 3, ...props }, ref) => {
    const textareaElement = (
      <textarea
        ref={ref}
        disabled={disabled}
        rows={rows}
        className={`alpas-textarea ${error ? 'has-error' : ''} ${className}`}
        style={{
          width: '100%',
          padding: '10px 14px',
          fontSize: '13.5px',
          fontFamily: 'inherit',
          color: 'var(--input-text, var(--text-primary, #174B2A))',
          background: 'var(--input-bg, rgba(255, 255, 255, 0.80))',
          border: `1px solid ${error ? 'var(--color-danger, #EF4444)' : 'var(--input-border, rgba(35, 139, 69, 0.15))'}`,
          borderRadius: 'var(--radius-md, 12px)',
          outline: 'none',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'text',
          resize: 'vertical',
          ...style,
        }}
        {...props}
      />
    );

    if (label || error || helperText) {
      return (
        <FormField label={label} error={error} helperText={helperText} required={required}>
          {textareaElement}
        </FormField>
      );
    }

    return textareaElement;
  }
);

Textarea.displayName = 'Textarea';

// ── Select ────────────────────────────────────────────────────────────────────
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string | number; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, required, options, children, className = '', style, disabled, ...props }, ref) => {
    const selectElement = (
      <div style={{ position: 'relative', width: '100%' }}>
        <select
          ref={ref}
          disabled={disabled}
          className={`alpas-select ${error ? 'has-error' : ''} ${className}`}
          style={{
            width: '100%',
            height: '42px',
            padding: '0 36px 0 14px',
            fontSize: '13.5px',
            fontFamily: 'inherit',
            color: 'var(--input-text, var(--color-text-primary, #174B2A))',
            background: 'var(--input-bg, var(--color-surface-solid, #FFFFFF))',
            border: `1px solid ${error ? 'var(--color-danger, #EF4444)' : 'var(--input-border, var(--color-border, rgba(35, 139, 69, 0.20)))'}`,
            borderRadius: 'var(--radius-md, 12px)',
            outline: 'none',
            appearance: 'none',
            WebkitAppearance: 'none',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            opacity: disabled ? 0.75 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            ...style,
          }}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {/* Dropdown Chevron */}
        <span
          style={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--input-chevron, var(--color-text-secondary, #50645A))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronDown size={14} />
        </span>
      </div>
    );

    if (label || error || helperText) {
      return (
        <FormField label={label} error={error} helperText={helperText} required={required}>
          {selectElement}
        </FormField>
      );
    }

    return selectElement;
  }
);

Select.displayName = 'Select';
