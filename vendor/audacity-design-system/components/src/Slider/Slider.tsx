import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Slider.css';

export interface SliderProps {
  /**
   * Current value (0-100)
   */
  value?: number;
  /**
   * Minimum value
   */
  min?: number;
  /**
   * Maximum value
   */
  max?: number;
  /**
   * Change handler
   */
  onChange?: (value: number) => void;
  /** Starts one continuous pointer or keyboard edit. */
  onGestureStart?: (value: number) => void;
  /** Finishes the active edit with its last emitted value. */
  onGestureEnd?: (value: number) => void;
  /** Cancels an edit that the browser aborts. */
  onGestureCancel?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Disabled state
   */
  disabled?: boolean;
  /**
   * Aria label
   */
  ariaLabel?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
}

export const Slider: React.FC<SliderProps> = ({
  value = 50,
  min = 0,
  max = 100,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
  className = '',
  disabled = false,
  ariaLabel = 'Slider',
  tabIndex,
}) => {
  const { theme } = useTheme();
  const gestureActiveRef = React.useRef(false);
  const gestureValueRef = React.useRef(value);
  const gestureCancelRef = React.useRef(onGestureCancel);
  gestureCancelRef.current = onGestureCancel;

  // Clamp value to valid range
  const clampedValue = Math.max(min, Math.min(max, value));

  // Calculate percentage for positioning (0-100)
  const percentage = ((clampedValue - min) / (max - min)) * 100;

  // Handle size in pixels (must match CSS)
  const handleSize = 16;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    const standalone = !gestureActiveRef.current;
    if (standalone) {
      gestureActiveRef.current = true;
      gestureValueRef.current = clampedValue;
      onGestureStart?.(clampedValue);
    }
    gestureValueRef.current = newValue;
    onChange?.(newValue);
    if (standalone) {
      gestureActiveRef.current = false;
      onGestureEnd?.(newValue);
    }
  };

  const beginGesture = () => {
    if (disabled || gestureActiveRef.current) return;
    gestureActiveRef.current = true;
    gestureValueRef.current = clampedValue;
    onGestureStart?.(clampedValue);
  };

  const endGesture = () => {
    if (!gestureActiveRef.current) return;
    gestureActiveRef.current = false;
    onGestureEnd?.(gestureValueRef.current);
  };

  const cancelGesture = () => {
    if (!gestureActiveRef.current) return;
    gestureActiveRef.current = false;
    onGestureCancel?.();
  };

  React.useEffect(() => () => {
    if (gestureActiveRef.current) {
      gestureActiveRef.current = false;
      gestureCancelRef.current?.();
    }
  }, []);

  const style = {
    '--slider-track-bg': theme.background.control.slider.track,
    '--slider-fill-bg': theme.border.focus,
    '--slider-handle-bg': theme.background.control.slider.handle.background,
    '--slider-handle-border': theme.background.control.slider.handle.border,
  } as React.CSSProperties;

  return (
    <div className={`slider ${disabled ? 'slider--disabled' : ''} ${className}`} style={style}>
      <input
        type="range"
        min={min}
        max={max}
        value={clampedValue}
        onChange={handleChange}
        onPointerDown={beginGesture}
        onPointerUp={endGesture}
        onPointerCancel={cancelGesture}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
            beginGesture();
          } else if (event.key === 'Escape') cancelGesture();
        }}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) endGesture();
        }}
        onBlur={endGesture}
        disabled={disabled}
        className="slider__input"
        aria-label={ariaLabel}
        tabIndex={tabIndex}
      />
      <div className="slider__track">
        <div
          className="slider__fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div
        className="slider__handle"
        style={{
          left: `calc(${percentage}% - ${(percentage / 100) * handleSize}px)`
        }}
      />
    </div>
  );
};

export default Slider;
