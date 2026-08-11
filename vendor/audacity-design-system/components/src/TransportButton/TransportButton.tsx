import React from 'react';
import { Icon, IconName } from '../Icon';
import { useTheme } from '../ThemeProvider';
import './TransportButton.css';

export interface TransportButtonProps {
  /**
   * Icon name from MusescoreIcon font
   */
  icon: IconName;
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
   * Whether the button is in active/toggled state (for toggle buttons like loop)
   */
  active?: boolean;
  /**
   * Whether the button is in recording state (red background, white icon)
   */
  recording?: boolean;
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
 * TransportButton component matching Figma design specifications
 * - Size: 28x28px
 * - Border radius: 3px
 * - States: idle, hover, pressed, disabled
 * - Uses MusescoreIcon font for icons
 */
export function TransportButton({
  icon,
  state = 'idle',
  onClick,
  disabled = false,
  active = false,
  recording = false,
  ariaLabel,
  className = '',
}: TransportButtonProps) {
  const { theme } = useTheme();
  const [internalState, setInternalState] = React.useState<'idle' | 'hover' | 'pressed'>('idle');

  const currentState = disabled ? 'disabled' : state !== 'idle' ? state : internalState;

  const style = {
    '--transport-btn-idle': recording ? theme.audio.transport.record : theme.background.control.button.secondary.idle,
    '--transport-btn-hover': recording ? theme.audio.transport.record : theme.background.control.button.secondary.hover,
    '--transport-btn-pressed': recording ? theme.audio.transport.record : theme.background.control.button.secondary.active,
    '--transport-icon-color': recording ? '#FFFFFF' : theme.foreground.icon.primary,
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

  return (
    <button
      className={`transport-button transport-button--${currentState} ${active ? 'transport-button--active' : ''} ${className}`}
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
      <Icon name={icon} size={14} className="transport-button__icon" />
    </button>
  );
}
