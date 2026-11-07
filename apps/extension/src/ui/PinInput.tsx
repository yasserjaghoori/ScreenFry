import React, { useEffect, useRef } from 'react';

/** Six separate digit boxes backed by one value. Paste, backspace and arrow keys behave naturally. */
export function PinInput({ value, onChange, label, autoFocus, disabled, onComplete }: {
  value: string; onChange: (value: string) => void; label: string; autoFocus?: boolean; disabled?: boolean; onComplete?: (value: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (autoFocus) refs.current[Math.min(value.length, 5)]?.focus(); }, [autoFocus, disabled]);
  function set(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, 6);
    onChange(digits);
    refs.current[Math.min(digits.length, 5)]?.focus();
    if (digits.length === 6) onComplete?.(digits);
  }
  return <div className="pin-boxes" role="group" aria-label={label}>
    {Array.from({ length: 6 }, (_, index) => <input
      key={index}
      ref={(element) => { refs.current[index] = element; }}
      className={`pin-box ${value[index] ? 'filled' : ''}`}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      aria-label={`${label} digit ${index + 1}`}
      maxLength={1}
      disabled={disabled}
      value={value[index] ?? ''}
      onFocus={(event) => { if (index > value.length) refs.current[value.length]?.focus(); else event.target.select(); }}
      onPaste={(event) => { event.preventDefault(); set(event.clipboardData.getData('text')); }}
      onKeyDown={(event) => {
        if (event.key === 'Backspace') { event.preventDefault(); set(value.slice(0, Math.max(0, value.length - 1))); }
      }}
      onChange={(event) => { const digit = event.target.value.replace(/\D/g, '').slice(-1); if (digit) set(value.slice(0, index) + digit + value.slice(index + 1)); }}
    />)}
  </div>;
}
