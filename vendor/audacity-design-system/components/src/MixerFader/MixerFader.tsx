import React, { useRef, useCallback, useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { MixerFaderHandle } from '../MixerFaderHandle';
import './MixerFader.css';

export interface MixerFaderProps {
  /**
   * Current value (between min and max).
   * When provided with onChange, the component is controlled.
   * Without onChange, the component manages its own state using this as the initial value.
   * @default 0
   */
  value?: number;
  /**
   * Minimum value
   * @default -60
   */
  min?: number;
  /**
   * Maximum value
   * @default 12
   */
  max?: number;
  /**
   * Called when the value changes during drag
   */
  onChange?: (value: number) => void;
  /**
   * Called when a drag interaction ends
   */
  onChangeEnd?: (value: number) => void;
  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;
  /**
   * Accessible label
   * @default 'Fader'
   */
  ariaLabel?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
}

const HANDLE_HEIGHT = 32;
const KEYBOARD_STEP_FRACTION = 0.02;
const KEYBOARD_LARGE_STEP_FRACTION = 0.1;

/**
 * MixerFader - A vertical fader control for mixer channels
 *
 * Fills its parent height. Contains a draggable MixerFaderHandle.
 * Works as both controlled (with onChange) and uncontrolled (without).
 * Default range is -60dB to +12dB, matching typical audio mixer faders.
 */
export const MixerFader: React.FC<MixerFaderProps> = ({
  value: valueProp = 0,
  min = -60,
  max = 12,
  onChange,
  onChangeEnd,
  disabled = false,
  ariaLabel = 'Fader',
  tabIndex,
  className = '',
}) => {
  const { theme } = useTheme();
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [internalValue, setInternalValue] = useState(valueProp);

  // Use internal state when uncontrolled (no onChange), external prop when controlled
  const isControlled = onChange !== undefined;
  const currentValue = isControlled ? valueProp : internalValue;
  const clampedValue = Math.max(min, Math.min(max, currentValue));

  const setValue = useCallback((newValue: number) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  }, [isControlled, onChange]);

  // Value 0..1 where 0 = min (bottom) and 1 = max (top)
  const normalized = (clampedValue - min) / (max - min);

  const handleStyle: React.CSSProperties = {
    top: `calc(${(1 - normalized) * 100}% - ${HANDLE_HEIGHT / 2}px)`,
  };

  const valueFromY = useCallback((clientY: number): number => {
    if (!trackRef.current) return clampedValue;
    const rect = trackRef.current.getBoundingClientRect();
    const trackHeight = rect.height;
    if (trackHeight === 0) return clampedValue;
    const y = Math.max(0, Math.min(trackHeight, clientY - rect.top));
    const norm = 1 - y / trackHeight;
    return min + norm * (max - min);
  }, [min, max, clampedValue]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = true;
    trackRef.current?.setPointerCapture(e.pointerId);
    const newValue = valueFromY(e.clientY);
    setValue(newValue);
  }, [disabled, setValue, valueFromY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const newValue = valueFromY(e.clientY);
    setValue(newValue);
  }, [setValue, valueFromY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const newValue = valueFromY(e.clientY);
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChangeEnd?.(newValue);
  }, [isControlled, onChangeEnd, valueFromY]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;
    const range = max - min;
    const step = range * KEYBOARD_STEP_FRACTION;
    const largeStep = range * KEYBOARD_LARGE_STEP_FRACTION;

    let newValue = clampedValue;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        newValue = Math.min(max, clampedValue + step);
        break;
      case 'ArrowDown':
        e.preventDefault();
        newValue = Math.max(min, clampedValue - step);
        break;
      case 'PageUp':
        e.preventDefault();
        newValue = Math.min(max, clampedValue + largeStep);
        break;
      case 'PageDown':
        e.preventDefault();
        newValue = Math.max(min, clampedValue - largeStep);
        break;
      case 'Home':
        e.preventDefault();
        newValue = max;
        break;
      case 'End':
        e.preventDefault();
        newValue = min;
        break;
      default:
        return;
    }
    setValue(newValue);
    onChangeEnd?.(newValue);
  }, [disabled, clampedValue, min, max, setValue, onChangeEnd]);

  const style = {
    '--fader-track-bg': theme.background.control.fader.track,
  } as React.CSSProperties;

  return (
    <div
      className={`mixer-fader ${disabled ? 'mixer-fader--disabled' : ''} ${className}`}
      style={style}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(clampedValue * 10) / 10}
      aria-orientation="vertical"
      aria-disabled={disabled || undefined}
      tabIndex={tabIndex ?? (disabled ? -1 : 0)}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={trackRef}
        className="mixer-fader__track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="mixer-fader__track-bar" />
        <MixerFaderHandle
          className="mixer-fader__handle"
          style={handleStyle}
        />
      </div>
    </div>
  );
};

export default MixerFader;
