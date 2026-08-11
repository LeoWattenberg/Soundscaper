import React from 'react';
import { Icon, IconName } from '../Icon';
import { useTheme } from '../ThemeProvider';
import './ToolButton.css';

export interface ToolButtonProps {
  /**
   * Icon name from MusescoreIcon font
   */
  icon: IconName;
  /**
   * Button size
   * - small: 20x20px (icon 14px)
   * - default: 28x28px (icon 16px)
   */
  size?: 'small' | 'default';
  /**
   * Button state
   */
  state?: 'idle' | 'hover' | 'pressed' | 'disabled';
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
 * ToolButton component matching Figma design specifications
 * - Default size: 28x28px (icon 16px)
 * - Small size: 20x20px (icon 14px)
 * - Border radius: 2px
 * - States: idle, hover, pressed, disabled
 * - Uses MusescoreIcon font for icons
 */
export function ToolButton({
  icon,
  size = 'default',
  state = 'idle',
  onClick,
  disabled = false,
  ariaLabel,
  className = '',
}: ToolButtonProps) {
  const { theme } = useTheme();
  const [internalState, setInternalState] = React.useState<'idle' | 'hover' | 'pressed'>('idle');

  const currentState = disabled ? 'disabled' : state !== 'idle' ? state : internalState;

  const style = {
    '--tool-btn-idle': theme.background.control.button.secondary.idle,
    '--tool-btn-hover': theme.background.control.button.secondary.hover,
    '--tool-btn-pressed': theme.background.control.button.secondary.active,
    '--tool-icon-color': theme.foreground.icon.primary,
  } as React.CSSProperties;

  const handleMouseEnter = () => {
    if (!disabled && state === 'idle') {
      setInternalState('hover');
    }
  };

  const handleMouseLeave = () => {
    if (!disabled && state === 'idle') {
      setInternalState('idle');
    }
  };

  const handleMouseDown = () => {
    if (!disabled && state === 'idle') {
      setInternalState('pressed');
    }
  };

  const handleMouseUp = () => {
    if (!disabled && state === 'idle') {
      setInternalState('hover');
    }
  };

  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const iconSize = size === 'small' ? 14 : 16;

  return (
    <button
      className={`tool-button tool-button--${size} tool-button--${currentState} ${className}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      disabled={disabled}
      type="button"
      style={style}
      aria-label={ariaLabel}
    >
      <Icon name={icon} size={iconSize} className="tool-button__icon" />
    </button>
  );
}
