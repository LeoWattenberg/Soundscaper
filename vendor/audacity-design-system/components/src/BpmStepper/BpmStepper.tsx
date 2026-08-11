/**
 * BpmStepper — compact BPM input styled to match the TimeCode component.
 *
 * Shows the value as bold Lato digits on the dark TimeCode surface, the
 * `TimeCodeUnit` "bpm" suffix, and a vertical up/down arrow pair on the
 * right edge. Click the number to type a new value; press Enter to commit
 * or Escape to cancel. Arrow buttons step by `step` (default 1) with
 * accelerate-on-hold so dragging the arrows feels live.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { TimeCodeUnit } from '../TimeCode/TimeCodeUnit';
import './BpmStepper.css';

export interface BpmStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Visual variant; defaults to dark to match the TimeCode toolbar look. */
  variant?: 'light' | 'dark';
  /** Tab index for the editable number cell. */
  tabIndex?: number;
  /** aria-label for the whole stepper. */
  ariaLabel?: string;
}

const HOLD_INITIAL_DELAY = 320;
const HOLD_REPEAT_INTERVAL = 65;

export function BpmStepper({
  value,
  onChange,
  min = 20,
  max = 300,
  step = 1,
  disabled = false,
  variant = 'dark',
  tabIndex = 0,
  ariaLabel = 'BPM',
}: BpmStepperProps) {
  const { theme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);

  // Theme vars mirror TimeCode so visuals stay in sync if the design system
  // shifts those token values later.
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

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const beginEdit = () => {
    if (disabled) return;
    setDraft(String(value));
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      // Defer to next paint so the input is mounted before we focus it.
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [editing]);

  const stepBy = (direction: 1 | -1) => onChange(clamp(value + direction * step));

  const stopHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  const startHold = (direction: 1 | -1) => {
    if (disabled) return;
    stepBy(direction);
    holdTimerRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => stepBy(direction), HOLD_REPEAT_INTERVAL);
    }, HOLD_INITIAL_DELAY);
  };

  useEffect(() => stopHold, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || editing) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepBy(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepBy(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      beginEdit();
    }
  };

  return (
    <div
      className={`bpm-stepper${disabled ? ' bpm-stepper--disabled' : ''}`}
      style={style}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : tabIndex}
      onKeyDown={handleKeyDown}
    >
      <div className="bpm-stepper__display">
        {editing ? (
          <input
            ref={inputRef}
            className="bpm-stepper__input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="bpm-stepper__digits"
            onClick={beginEdit}
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
          >
            {value}
          </button>
        )}
        <TimeCodeUnit unit="bpm" />
      </div>
      <div className="bpm-stepper__arrows">
        <button
          type="button"
          className="bpm-stepper__arrow bpm-stepper__arrow--up"
          aria-label="Increase BPM"
          tabIndex={-1}
          disabled={disabled || value >= max}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
        >
          <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
            <path d="M4 0L8 6H0L4 0Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="bpm-stepper__arrow bpm-stepper__arrow--down"
          aria-label="Decrease BPM"
          tabIndex={-1}
          disabled={disabled || value <= min}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(-1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
        >
          <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
            <path d="M4 6L0 0H8L4 6Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default BpmStepper;
