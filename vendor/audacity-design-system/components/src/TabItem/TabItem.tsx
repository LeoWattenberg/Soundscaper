import React from 'react';
import { useTheme } from '../ThemeProvider';import './TabItem.css';

export interface TabItemProps {
  /**
   * Whether the tab is currently selected
   */
  selected?: boolean;
  /**
   * Tab label text
   */
  label: string;
  /**
   * Icon element to display before the label
   */
  icon?: React.ReactNode;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Whether the tab is disabled
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
}

export const TabItem: React.FC<TabItemProps> = ({
  selected = false,
  label,
  icon,
  onClick,
  disabled = false,
  className = '',
  ariaLabel,
}) => {
  const { theme } = useTheme();

  const style = {
    '--tab-bg-idle': theme.background.tab.idle,
    '--tab-bg-hover': theme.background.tab.hover,
    '--tab-bg-selected': theme.background.tab.selected,
    '--tab-border-selected': theme.background.tab.selectedBorder,
    '--tab-text': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <button
      type="button"
      role="tab"
      className={`tab-item ${selected ? 'tab-item--selected' : ''} ${disabled ? 'tab-item--disabled' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      aria-selected={selected}
      style={style}
    >
      {icon && <span className="tab-item__icon">{icon}</span>}
      <span className="tab-item__label">{label}</span>
    </button>
  );
};

export default TabItem;
