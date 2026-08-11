/**
 * Checkbox Component
 *
 * A checkbox input with checked/unchecked states
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Checkbox.css';

export interface CheckboxProps {
  /**
   * Whether the checkbox is checked
   */
  checked?: boolean;
  /**
   * Whether the checkbox is disabled
   */
  disabled?: boolean;
  /**
   * Callback when checkbox state changes
   */
  onChange?: (checked: boolean) => void;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Accessible label for screen readers
   */
  'aria-label'?: string;
}

/**
 * Checkbox - A checkbox input component
 */
export function Checkbox({
  checked = false,
  disabled = false,
  onChange,
  tabIndex,
  className = '',
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const { theme } = useTheme();
  const [isHovered, setIsHovered] = React.useState(false);
  const [isPressed, setIsPressed] = React.useState(false);

  const style = {
    '--checkbox-bg-idle': theme.background.control.checkbox.idle,
    '--checkbox-bg-hover': theme.background.control.checkbox.hover,
    '--checkbox-bg-pressed': theme.background.control.checkbox.pressed,
    '--checkbox-icon-color': theme.foreground.icon.primary,
  } as React.CSSProperties;

  const handleClick = () => {
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick();
    }
  };

  const getStateClass = () => {
    if (isPressed) return 'checkbox--pressed';
    if (isHovered) return 'checkbox--hover';
    return 'checkbox--default';
  };

  return (
    <div
      className={`checkbox ${checked ? 'checkbox--checked' : 'checkbox--unchecked'} ${getStateClass()} ${disabled ? 'checkbox--disabled' : ''} ${className}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      tabIndex={tabIndex !== undefined ? tabIndex : (disabled ? -1 : 0)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => !disabled && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      style={style}
    >
      {checked && (
        <div className="checkbox__icon">{'\uEF31'}</div>
      )}
    </div>
  );
}

export default Checkbox;
