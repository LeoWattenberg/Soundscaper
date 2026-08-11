import React from 'react';
import { Icon, IconName } from '../Icon';
import { useTheme } from '../ThemeProvider';
import './ToggleToolButton.css';

export interface ToggleToolButtonProps {
  /**
   * Icon name from MusescoreIcon font
   */
  icon: IconName;
  /**
   * Whether the button is toggled on
   */
  isActive?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;
  /**
   * Accessible label for the button (required for icon-only buttons)
   */
  ariaLabel?: string;
  /**
   * Optional className for custom styling
   */
  className?: string;
}

/**
 * ToggleToolButton component matching Figma design specifications
 * - Size: 28x28px
 * - Border radius: 2px
 * - States: off (idle, hover), on (active, active-hover), disabled
 * - Uses MusescoreIcon font for icons
 * - Toggle behavior: stays pressed when active
 */
export function ToggleToolButton({
  icon,
  isActive = false,
  onClick,
  disabled = false,
  ariaLabel,
  className = '',
}: ToggleToolButtonProps) {
  const { theme } = useTheme();
  const [isHovered, setIsHovered] = React.useState(false);

  const handleMouseEnter = () => {
    if (!disabled) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  // Determine CSS class based on state
  let stateClass = 'toggle-tool-button--off';
  if (disabled) {
    stateClass = 'toggle-tool-button--disabled';
  } else if (isActive) {
    stateClass = isHovered ? 'toggle-tool-button--on-hover' : 'toggle-tool-button--on';
  } else {
    stateClass = isHovered ? 'toggle-tool-button--off-hover' : 'toggle-tool-button--off';
  }

  const iconColor = isActive ? theme.foreground.icon.inverse : theme.foreground.icon.primary;

  const style = {
    '--toggle-off-bg': theme.background.control.button.secondary.idle,
    '--toggle-off-hover-bg': theme.background.control.button.secondary.hover,
    '--toggle-on-bg': theme.background.control.button.primary.idle,
    '--toggle-on-hover-bg': theme.background.control.button.primary.hover,
    '--toggle-disabled-bg': 'transparent',
    '--toggle-disabled-color': theme.foreground.icon.disabled,
  } as React.CSSProperties;

  return (
    <button
      className={`toggle-tool-button ${stateClass} ${className}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      disabled={disabled}
      type="button"
      aria-pressed={isActive}
      aria-label={ariaLabel}
      style={style}
    >
      <Icon name={icon} size={16} color={iconColor} />
    </button>
  );
}

export default ToggleToolButton;
