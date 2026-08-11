import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Radio.css';

export interface RadioProps {
  /**
   * Whether the radio is selected
   */
  checked?: boolean;
  /**
   * Change handler
   */
  onChange?: (checked: boolean) => void;
  /**
   * Disabled state
   */
  disabled?: boolean;
  /**
   * Name attribute for grouping radios
   */
  name?: string;
  /**
   * Value attribute
   */
  value?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Radio: React.FC<RadioProps> = ({
  checked = false,
  onChange,
  disabled = false,
  name,
  value,
  tabIndex,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--radio-border': theme.border.control.radio,
    '--radio-border-hover': theme.border.focus,
    '--radio-bg': theme.background.control.radio.idle,
    '--radio-pip': theme.background.control.button.primary.idle,
    '--radio-pip-disabled': theme.foreground.icon.disabled,
  } as React.CSSProperties;

  const handleChange = () => {
    if (!disabled && !checked) {
      onChange?.(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only change on Enter/Space, and only if not already checked
    if ((e.key === 'Enter' || e.key === ' ') && !disabled && !checked) {
      e.preventDefault();
      onChange?.(true);
    }
  };

  return (
    <div
      className={`radio ${checked ? 'radio--checked' : ''} ${disabled ? 'radio--disabled' : ''} ${className}`}
      onClick={handleChange}
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex !== undefined ? tabIndex : (disabled ? -1 : 0)}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={() => {}} // Controlled by outer div
        tabIndex={-1}
        className="radio__input"
        aria-hidden="true"
      />
      <div className="radio__indicator">
        {checked && <div className="radio__pip" />}
      </div>
    </div>
  );
};

export default Radio;
