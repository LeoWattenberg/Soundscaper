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
  className = '',
  disabled = false,
  ariaLabel = 'Slider',
  tabIndex,
}) => {
  const { theme } = useTheme();

  // Clamp value to valid range
  const clampedValue = Math.max(min, Math.min(max, value));

  // Calculate percentage for positioning (0-100)
  const percentage = ((clampedValue - min) / (max - min)) * 100;

  // Handle size in pixels (must match CSS)
  const handleSize = 16;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    onChange?.(newValue);
  };

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
