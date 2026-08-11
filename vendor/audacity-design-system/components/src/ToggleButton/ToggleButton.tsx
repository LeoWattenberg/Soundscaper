import React from 'react';
import { useTheme } from '../ThemeProvider';
import { Icon, IconName } from '../Icon';
import './ToggleButton.css';

export interface ToggleButtonProps {
  /**
   * Whether the button is in active/pressed state
   */
  active?: boolean;
  /**
   * Button content (typically a single character like 'M' or 'S')
   * Mutually exclusive with icon prop
   */
  children?: React.ReactNode;
  /**
   * Icon name to display instead of text
   * Mutually exclusive with children prop
   */
  icon?: IconName;
  /**
   * Icon size (only used when icon prop is provided)
   */
  iconSize?: number;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;
  /**
   * Additional CSS class names
   */
  className?: string;
  /**
   * ARIA label for accessibility
   */
  ariaLabel?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Size variant: 20px, 24px, 28px, 32px
   */
  size?: 20 | 24 | 28 | 32;
  /**
   * Custom active background color (overrides theme default)
   */
  activeColor?: string;
}

export const ToggleButton: React.FC<ToggleButtonProps> = ({
  active = false,
  children,
  icon,
  iconSize,
  onClick,
  disabled = false,
  className = '',
  ariaLabel,
  tabIndex,
  size = 28,
  activeColor,
}) => {
  const { theme } = useTheme();

  const style = {
    '--toggle-btn-bg': theme.background.control.button.secondary.idle,
    '--toggle-btn-bg-hover': theme.background.control.button.secondary.hover,
    '--toggle-btn-bg-active': activeColor || theme.background.control.button.primary.active,
    '--toggle-btn-text': theme.foreground.text.primary,
    '--toggle-btn-text-active': theme.foreground.text.inverse,
    '--toggle-btn-size': `${size}px`,
  } as React.CSSProperties;

  // Default icon sizes for each button size (if not explicitly provided)
  const defaultIconSize = size === 20 ? 12 : size === 24 ? 14 : size === 28 ? 14 : 16;

  return (
    <button
      type="button"
      className={`toggle-button ${active ? 'toggle-button--active' : ''} ${disabled ? 'toggle-button--disabled' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      aria-pressed={active}
      style={style}
    >
      {icon ? <Icon name={icon} size={iconSize || defaultIconSize} /> : children}
    </button>
  );
};

export default ToggleButton;
