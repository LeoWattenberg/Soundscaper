import React from 'react';
import { Icon, IconName } from '../Icon';
import { useTheme } from '../ThemeProvider';
import './GhostButton.css';

export interface GhostButtonProps {
  /**
   * Icon to display (defaults to 'menu' which uses EF13)
   */
  icon?: IconName;
  /**
   * Button size
   * - tiny: 16px × 16px, 14px icon (table headers)
   * - small: 20px × 20px, 16px icon (default, icon-only)
   * - medium: 28px × 28px, 16px icon (toolbar-aligned icon-only buttons)
   * - large: 48px × 48px, 32px icon (carousel buttons)
   */
  size?: 'tiny' | 'small' | 'medium' | 'large';
  /**
   * Optional label text to display next to the icon
   */
  label?: string;
  /**
   * Click handler
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;
  /**
   * Whether the button is in active state (e.g., menu is open)
   */
  active?: boolean;
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
   * Keyboard event handler
   */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const GhostButton: React.FC<GhostButtonProps> = ({
  icon = 'menu',
  size = 'small',
  label,
  onClick,
  disabled = false,
  active = false,
  className = '',
  ariaLabel,
  tabIndex,
  onKeyDown,
}) => {
  const { theme } = useTheme();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick?.(e);
  };

  const iconSize = size === 'large' ? 32 : size === 'tiny' ? 14 : 16;

  const style = {
    '--ghost-bg-idle': theme.background.control.button.ghost.idle,
    '--ghost-bg-hover': theme.background.control.button.ghost.hover,
    '--ghost-bg-active': theme.background.control.button.ghost.active,
    '--ghost-bg-disabled': theme.background.control.button.ghost.disabled,
    '--ghost-icon-color': theme.foreground.icon.primary,
    '--ghost-label-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <button
      type="button"
      className={`ghost-button ghost-button--${size} ${label ? 'ghost-button--with-label' : ''} ${disabled ? 'ghost-button--disabled' : ''} ${active ? 'ghost-button--active' : ''} ${className}`}
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      style={style}
    >
      <Icon name={icon} size={iconSize} />
      {label && <span className="ghost-button__label">{label}</span>}
    </button>
  );
};

export default GhostButton;
