/**
 * NumberStepper - Number input with up/down arrows
 */

import React, { useState } from 'react';
import { useTheme } from '../ThemeProvider';
import './NumberStepper.css';

export interface NumberStepperProps {
  /**
   * Input value
   */
  value?: string;
  /**
   * Default value for uncontrolled component
   */
  defaultValue?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Change handler
   */
  onChange?: (value: string) => void;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Input width
   */
  width?: number | string;
  /**
   * Step amount for increment/decrement
   */
  step?: number;
  /**
   * Minimum value
   */
  min?: number;
  /**
   * Maximum value
   */
  max?: number;
}

/**
 * NumberStepper component - Number input with up/down arrows
 */
export const NumberStepper = React.forwardRef<HTMLInputElement, NumberStepperProps>(({
  value,
  defaultValue = '',
  placeholder,
  disabled = false,
  onChange,
  tabIndex,
  className = '',
  width,
  step = 1,
  min,
  max,
}, ref) => {
  const { theme } = useTheme();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [isFocused, setIsFocused] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const style = {
    '--number-stepper-border': theme.border.default,
    '--number-stepper-border-focus': theme.border.focus,
    '--number-stepper-success-outline': theme.foreground.icon.success,
    '--number-stepper-success-border': theme.foreground.icon.success,
    '--number-stepper-text': theme.foreground.text.primary,
    '--number-stepper-placeholder': theme.foreground.text.secondary,
    '--number-stepper-btn-text': theme.foreground.text.primary,
    '--number-stepper-btn-hover': theme.background.surface.subtle,
    '--number-stepper-btn-active': theme.background.surface.hover,
  } as React.CSSProperties;

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const handleIncrement = () => {
    if (disabled) return;

    // Extract numeric value from string (e.g., "20 dB" -> 20)
    const match = currentValue.match(/-?\d+\.?\d*/);
    const numericValue = match ? parseFloat(match[0]) : 0;
    const unit = currentValue.replace(match?.[0] || '', '').trim();

    let newValue = numericValue + step;
    if (max !== undefined && newValue > max) {
      newValue = max;
    }

    const newStringValue = unit ? `${newValue} ${unit}` : newValue.toString();

    if (!isControlled) {
      setInternalValue(newStringValue);
    }
    onChange?.(newStringValue);
  };

  const handleDecrement = () => {
    if (disabled) return;

    // Extract numeric value from string
    const match = currentValue.match(/-?\d+\.?\d*/);
    const numericValue = match ? parseFloat(match[0]) : 0;
    const unit = currentValue.replace(match?.[0] || '', '').trim();

    let newValue = numericValue - step;
    if (min !== undefined && newValue < min) {
      newValue = min;
    }

    const newStringValue = unit ? `${newValue} ${unit}` : newValue.toString();

    if (!isControlled) {
      setInternalValue(newStringValue);
    }
    onChange?.(newStringValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter toggles edit mode
    if (e.key === 'Enter') {
      e.preventDefault();
      setIsEditMode(!isEditMode);
      return;
    }

    // In edit mode, arrow keys increment/decrement
    if (isEditMode) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleIncrement();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleDecrement();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditMode(false);
      }
    }
    // When not in edit mode, arrow keys are handled by parent (TabGroupField)
  };

  const handleInputFocus = () => {
    setIsFocused(true);
  };

  const handleInputBlur = () => {
    setIsFocused(false);
    setIsEditMode(false); // Exit edit mode when losing focus
  };

  const handleInputClick = () => {
    setIsEditMode(true); // Click enters edit mode
  };

  const widthStyle = width ? (typeof width === 'number' ? `${width}px` : width) : undefined;

  return (
    <div
      className={`number-stepper ${isFocused ? 'number-stepper--focused' : ''} ${isEditMode ? 'number-stepper--editing' : ''} ${disabled ? 'number-stepper--disabled' : ''} ${className}`}
      style={widthStyle ? { width: widthStyle, ...style } : style}
    >
      <input
        ref={ref}
        type="text"
        value={currentValue}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleChange}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        onClick={handleInputClick}
        onKeyDown={handleKeyDown}
        tabIndex={tabIndex}
        className="number-stepper__input"
      />
      <div className="number-stepper__arrows">
        <button
          type="button"
          className="number-stepper__arrow number-stepper__arrow--up"
          onClick={handleIncrement}
          disabled={disabled}
          tabIndex={-1}
        >
          <span className="number-stepper__icon musescore-icon">{'\uEF10'}</span>
        </button>
        <button
          type="button"
          className="number-stepper__arrow number-stepper__arrow--down"
          onClick={handleDecrement}
          disabled={disabled}
          tabIndex={-1}
        >
          <span className="number-stepper__icon musescore-icon">{'\uEF12'}</span>
        </button>
      </div>
    </div>
  );
});

NumberStepper.displayName = 'NumberStepper';

export default NumberStepper;
