/**
 * LabeledCheckbox Component
 *
 * A checkbox with an associated label
 */

import React from 'react';
import { Checkbox } from '../Checkbox';
import { useTheme } from '../ThemeProvider';
import './LabeledCheckbox.css';

export interface LabeledCheckboxProps {
  /**
   * Label text for the checkbox
   */
  label: string;
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
}

/**
 * LabeledCheckbox - A checkbox with label
 */
export function LabeledCheckbox({
  label,
  checked = false,
  disabled = false,
  onChange,
  tabIndex,
  className = '',
}: LabeledCheckboxProps) {
  const { theme } = useTheme();

  const handleClick = () => {
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  const style = {
    '--labeled-checkbox-text': theme.foreground.text.primary,
    cursor: disabled ? 'default' : 'pointer',
  } as React.CSSProperties;

  return (
    <div
      className={`labeled-checkbox ${className}`}
      onClick={handleClick}
      style={style}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        tabIndex={tabIndex}
        aria-label={label}
      />
      <span className="labeled-checkbox__label">
        {label}
      </span>
    </div>
  );
}

export default LabeledCheckbox;
