/**
 * Menu Component
 *
 * Displays a dropdown menu with items and optional keyboard shortcuts
 */

import { useTheme } from '../ThemeProvider';
import './Menu.css';

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
  checked?: boolean;
}

export interface MenuProps {
  items: MenuItem[];
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  className?: string;
}

export function Menu({
  items,
  isOpen,
  anchorEl,
  onClose,
  className = '',
}: MenuProps) {
  const { theme } = useTheme();

  if (!isOpen || !anchorEl) return null;

  // Get position from anchor element
  const rect = anchorEl.getBoundingClientRect();
  const style = {
    '--menu-bg': theme.background.surface.elevated,
    '--menu-border': theme.border.default,
    '--menu-shadow': '0px 4px 8px rgba(0, 0, 0, 0.15)',
    '--menu-item-text': theme.foreground.text.primary,
    '--menu-item-text-disabled': theme.foreground.text.disabled,
    '--menu-item-hover-bg': theme.background.surface.hover,
    '--menu-divider': theme.border.divider,
    position: 'absolute' as const,
    top: `${rect.bottom}px`,
    left: `${rect.left}px`,
    zIndex: 1000,
  } as React.CSSProperties;

  return (
    <>
      {/* Backdrop to close menu when clicking outside */}
      <div
        className="menu-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999,
        }}
      />

      {/* Menu */}
      <div className={`menu ${className}`} style={style}>
        {items.map((item, index) => {
          if (item.divider) {
            return <div key={index} className="menu__divider" />;
          }

          return (
            <button
              key={index}
              className={`menu__item ${item.disabled ? 'menu__item--disabled' : ''}`}
              onClick={() => {
                if (!item.disabled && item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
            >
              <span className="menu__checkmark">
                {item.checked && '✓'}
              </span>
              <span className="menu__label">{item.label}</span>
              {item.shortcut && (
                <span className="menu__shortcut">{item.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default Menu;
