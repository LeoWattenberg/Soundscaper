import React, { useRef, useState } from 'react';
import { useTheme } from '../ThemeProvider';
import './Knob.css';

export interface KnobProps {
  /**
   * Current value
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
   * Step increment
   */
  step?: number;
  /**
   * Change handler
   */
  onChange?: (value: number) => void;
  /**
   * Label for the knob
   */
  label?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Disabled state
   */
  disabled?: boolean;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Unique ID for the knob
   */
  id?: string;
  /**
   * Color mode: 'bipolar' (left/right colors) or 'unipolar' (single color)
   */
  mode?: 'bipolar' | 'unipolar';
  /**
   * Accent color for unipolar mode
   */
  accentColor?: string;
}

export const Knob: React.FC<KnobProps> = ({
  value = 0,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  label,
  className = '',
  disabled = false,
  tabIndex = 0,
  id,
  mode = 'bipolar',
  accentColor = '#677ce4',
}) => {
  const { theme } = useTheme();
  const knobRef = useRef<HTMLButtonElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number>(0);
  const dragStartValueRef = useRef<number>(0);

  // Clamp value to min/max
  const clampedValue = Math.max(min, Math.min(max, value));

  // Normalize value to 0-1 range
  const normalizedValue = (clampedValue - min) / (max - min);

  // Calculate rotation angle for knob
  // For bipolar: center is at 0deg, range is -135deg to +135deg
  // For unipolar: starts at -135deg (7:30), ends at +135deg (4:30)
  let knobRotation: number;
  if (mode === 'bipolar') {
    // Map value from min/max to -135/+135 degrees
    const bipolarNormalized = (clampedValue - min) / (max - min) * 2 - 1; // -1 to 1
    knobRotation = bipolarNormalized * 135;
  } else {
    // Unipolar: -135deg at min, +135deg at max
    knobRotation = -135 + (normalizedValue * 270);
  }

  // Calculate value sweep
  let valueSweepDegrees: number;
  let sweepStartDeg: number;
  let sweepColor: string;

  if (mode === 'bipolar') {
    // Bipolar mode: sweep from center outward
    const centerValue = (min + max) / 2;
    const isNegative = clampedValue < centerValue;
    const bipolarNormalized = (clampedValue - min) / (max - min) * 2 - 1; // -1 to 1
    valueSweepDegrees = Math.abs(bipolarNormalized) * 135;
    sweepStartDeg = isNegative ? 0 - valueSweepDegrees : 0;
    sweepColor = isNegative ? '#84b5ff' : '#677ce4';
  } else {
    // Unipolar mode: sweep from start
    valueSweepDegrees = normalizedValue * 270;
    sweepStartDeg = -135;
    sweepColor = accentColor;
  }

  const style = {
    '--knob-gauge': theme.background.control.panKnob.gauge,
    '--knob-dial-border': theme.background.control.panKnob.border,
    '--knob-dial-bg': theme.background.control.panKnob.face,
    '--knob-indicator': theme.foreground.text.primary,
  } as React.CSSProperties;

  const ariaLabel = label ? `${label}: ${clampedValue}` : `${clampedValue}`;

  const showSweep = mode === 'bipolar'
    ? clampedValue !== (min + max) / 2
    : normalizedValue > 0;

  // Handle mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || !onChange) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartValueRef.current = clampedValue;
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!onChange) return;

      // Calculate delta Y (inverted - drag up increases, drag down decreases)
      const deltaY = dragStartYRef.current - e.clientY;

      // Sensitivity: 200 pixels = full range
      const sensitivity = (max - min) / 200;
      const deltaValue = deltaY * sensitivity;

      // Calculate new value
      let newValue = dragStartValueRef.current + deltaValue;

      // Round to step
      newValue = Math.round(newValue / step) * step;

      // Clamp to range
      newValue = Math.max(min, Math.min(max, newValue));

      onChange(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, min, max, step, onChange]);

  return (
    <button
      ref={knobRef}
      className={`knob ${isDragging ? 'knob--dragging' : ''} ${className}`}
      tabIndex={tabIndex}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clampedValue}
      style={style}
      onMouseDown={handleMouseDown}
    >
      {/* Background gauge */}
      <div className="knob__gauge" />

      {/* Value sweep (shows amount in accent color) */}
      {showSweep && (
        <div
          className="knob__value-sweep"
          style={{
            background: `conic-gradient(
              from ${sweepStartDeg}deg,
              ${sweepColor} 0deg,
              ${sweepColor} ${valueSweepDegrees}deg,
              transparent ${valueSweepDegrees}deg
            )`
          }}
        />
      )}

      {/* Knob group (rotates as one) */}
      <div
        className="knob__knob-group"
        style={{ transform: `rotate(${knobRotation}deg)` }}
      >
        <div className="knob__dial-border" />
        <div className="knob__dial">
          <div className="knob__indicator" />
        </div>
      </div>
    </button>
  );
};

export default Knob;
