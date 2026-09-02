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
  onGestureStart?: (value: number) => void;
  onGestureEnd?: (value: number) => void;
  onGestureCancel?: () => void;
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
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
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
  const gestureEndRef = useRef(onGestureEnd);
  gestureEndRef.current = onGestureEnd;
  const gestureCancelRef = useRef(onGestureCancel);
  gestureCancelRef.current = onGestureCancel;
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartYRef = useRef<number>(0);
  const dragStartValueRef = useRef<number>(0);
  const gestureValueRef = useRef<number>(value);
  const keyGestureRef = useRef(false);
  const dragGestureRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragCaptureTargetRef = useRef<HTMLButtonElement | null>(null);

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

  // Keyboard adjustment — fired when the knob's button has DOM focus,
  // not when the surrounding slot has it. Arrow up/right increases,
  // down/left decreases; Shift accelerates 10×.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || !onChange) return;
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft'
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (!keyGestureRef.current) {
        keyGestureRef.current = true;
        gestureValueRef.current = clampedValue;
        onGestureStart?.(clampedValue);
      }
      const direction = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
      const stepSize = e.shiftKey ? step * 10 : step;
      const newValue = Math.max(min, Math.min(max, clampedValue + direction * stepSize));
      if (newValue !== clampedValue) {
        gestureValueRef.current = newValue;
        onChange(newValue);
      }
    } else if (e.key === 'Escape' && keyGestureRef.current) {
      e.preventDefault();
      keyGestureRef.current = false;
      onGestureCancel?.();
    }
  };

  const finishKeyGesture = (e?: React.KeyboardEvent) => {
    if (e && !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    if (!keyGestureRef.current) return;
    keyGestureRef.current = false;
    onGestureEnd?.(gestureValueRef.current);
  };

  const releaseCapturedPointer = React.useCallback((pointerId: number | null) => {
    const target = dragCaptureTargetRef.current ?? knobRef.current;
    dragCaptureTargetRef.current = null;
    if (pointerId === null || !target) return;
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // The browser may already have released capture while dispatching a terminal event.
    }
  }, []);

  const settleDrag = React.useCallback((
    outcome: 'commit' | 'cancel',
    pointerId?: number,
  ) => {
    if (!dragGestureRef.current) return;
    const activePointerId = dragPointerIdRef.current;
    if (pointerId !== undefined && pointerId !== activePointerId) return;
    dragGestureRef.current = false;
    dragPointerIdRef.current = null;
    setIsDragging(false);
    releaseCapturedPointer(activePointerId);
    if (outcome === 'commit') gestureEndRef.current?.(gestureValueRef.current);
    else gestureCancelRef.current?.();
  }, [releaseCapturedPointer]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !onChange || e.button !== 0 || e.isPrimary === false
      || dragGestureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    setIsDragging(true);
    dragGestureRef.current = true;
    dragPointerIdRef.current = e.pointerId;
    dragCaptureTargetRef.current = e.currentTarget;
    dragStartXRef.current = e.clientX;
    dragStartYRef.current = e.clientY;
    dragStartValueRef.current = clampedValue;
    gestureValueRef.current = clampedValue;
    onGestureStart?.(clampedValue);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragGestureRef.current || dragPointerIdRef.current !== e.pointerId || !onChange) return;
    e.preventDefault();
    e.stopPropagation();

    // Horizontal movement right and vertical movement up both increase the value.
    const deltaX = e.clientX - dragStartXRef.current;
    const deltaY = dragStartYRef.current - e.clientY;
    const sensitivity = (max - min) / 200;
    const deltaValue = (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) * sensitivity;
    let newValue = dragStartValueRef.current + deltaValue;
    newValue = Math.round(newValue / step) * step;
    newValue = Math.max(min, Math.min(max, newValue));

    gestureValueRef.current = newValue;
    onChange(newValue);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    settleDrag('commit', e.pointerId);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    settleDrag('cancel', e.pointerId);
  };

  React.useEffect(() => {
    if (!isDragging) return;
    const handleWindowBlur = () => settleDrag('commit');
    globalThis.addEventListener?.('blur', handleWindowBlur);
    return () => globalThis.removeEventListener?.('blur', handleWindowBlur);
  }, [isDragging, settleDrag]);

  React.useEffect(() => () => {
    const pointerId = dragPointerIdRef.current;
    const gestureActive = dragGestureRef.current || keyGestureRef.current;
    dragGestureRef.current = false;
    dragPointerIdRef.current = null;
    keyGestureRef.current = false;
    releaseCapturedPointer(pointerId);
    if (gestureActive) gestureCancelRef.current?.();
  }, [releaseCapturedPointer]);

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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={(e) => settleDrag('cancel', e.pointerId)}
      onKeyDown={handleKeyDown}
      onKeyUp={finishKeyGesture}
      onBlur={() => finishKeyGesture()}
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
