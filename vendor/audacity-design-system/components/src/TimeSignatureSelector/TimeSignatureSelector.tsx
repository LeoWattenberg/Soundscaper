/**
 * TimeSignatureSelector — compact "N / D" display with a dropdown caret
 * that picks from common time signatures. Styled to match the TimeCode +
 * BpmStepper family (Lato bold digits on the dark TimeCode surface).
 */
import React, { useRef, useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { TimeCodeUnit } from '../TimeCode/TimeCodeUnit';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import './TimeSignatureSelector.css';

export interface TimeSignature {
  numerator: number;
  /** Power-of-two denominator: 1, 2, 4, 8, 16 … */
  denominator: number;
}

export interface TimeSignatureSelectorProps {
  value: TimeSignature;
  onChange: (value: TimeSignature) => void;
  /** Override the default option list. */
  options?: TimeSignature[];
  disabled?: boolean;
  variant?: 'light' | 'dark';
  tabIndex?: number;
  ariaLabel?: string;
}

const DEFAULT_OPTIONS: TimeSignature[] = [
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 4, denominator: 4 },
  { numerator: 5, denominator: 4 },
  { numerator: 6, denominator: 8 },
  { numerator: 7, denominator: 8 },
  { numerator: 9, denominator: 8 },
  { numerator: 12, denominator: 8 },
];

const sameSignature = (a: TimeSignature, b: TimeSignature) =>
  a.numerator === b.numerator && a.denominator === b.denominator;

const formatSignature = (sig: TimeSignature) => `${sig.numerator}/${sig.denominator}`;

export function TimeSignatureSelector({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  disabled = false,
  variant = 'dark',
  tabIndex = 0,
  ariaLabel = 'Time signature',
}: TimeSignatureSelectorProps) {
  const { theme } = useTheme();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const style = {
    '--timecode-bg': variant === 'light' ? '#FFFFFF' : '#212433',
    '--timecode-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
    '--timecode-hover': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-border': variant === 'light' ? '#D4D5D9' : 'transparent',
    '--timecode-unit-bg': variant === 'light' ? '#FFFFFF' : '#212433',
    '--timecode-unit-text': variant === 'light' ? theme.foreground.text.primary : '#c5c6cd',
    '--timecode-unit-hover-bg': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-unit-hover-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
    '--focus-color': theme.border.focus,
  } as React.CSSProperties;

  const openMenu = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ x: rect.left, y: rect.bottom + 2 });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    }
  };

  return (
    <>
      <div
        className={`time-signature-selector${disabled ? ' time-signature-selector--disabled' : ''}`}
        style={style}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={menu !== null}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : tabIndex}
        onKeyDown={handleKeyDown}
      >
        <div className="time-signature-selector__display">
          <span className="time-signature-selector__digit">{value.numerator}</span>
          <TimeCodeUnit unit="slash" />
          <span className="time-signature-selector__digit">{value.denominator}</span>
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="time-signature-selector__caret"
          aria-label="Choose time signature"
          tabIndex={-1}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            openMenu();
          }}
        >
          <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
            <path d="M4 6L0 0H8L4 6Z" fill="currentColor" />
          </svg>
        </button>
      </div>
      {menu && (
        <ContextMenu isOpen onClose={() => setMenu(null)} x={menu.x} y={menu.y}>
          {options.map((option) => (
            <ContextMenuItem
              key={formatSignature(option)}
              label={formatSignature(option)}
              checked={sameSignature(option, value)}
              onClick={() => {
                onChange(option);
                setMenu(null);
              }}
              onClose={() => setMenu(null)}
            />
          ))}
        </ContextMenu>
      )}
    </>
  );
}

export default TimeSignatureSelector;
