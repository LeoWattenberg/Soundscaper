import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import './ContextMenuItem.css';

export interface ContextMenuItemProps {
  /**
   * Label text for the menu item
   */
  label?: string;

  /**
   * Click handler for the menu item
   */
  onClick?: () => void;

  /**
   * Whether the item is disabled
   */
  disabled?: boolean;

  /**
   * Child menu items for submenu
   */
  children?: React.ReactNode;

  /**
   * Whether this item has a submenu
   */
  hasSubmenu?: boolean;

  /**
   * Icon to display before the label
   */
  icon?: React.ReactNode;

  /**
   * Whether the item is checked (shows checkmark)
   */
  checked?: boolean;

  /**
   * Keyboard shortcut to display on the right
   */
  shortcut?: string;

  /**
   * Callback when submenu should close
   */
  onClose?: () => void;

  /**
   * Whether this item is a divider
   */
  isDivider?: boolean;
}

/**
 * ContextMenuItem - A single item in a context menu
 * Supports nested submenus via children prop
 */
export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  label,
  onClick,
  disabled = false,
  children,
  hasSubmenu = false,
  icon,
  checked,
  shortcut,
  onClose,
  isDivider = false,
}) => {
  const { theme } = useTheme();
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  const style = {
    '--context-menu-item-text': theme.foreground.text.primary,
    '--context-menu-item-hover-bg': theme.background.menu.item.hover,
    '--context-menu-submenu-bg': theme.background.menu.background,
    '--context-menu-submenu-border': theme.border.default,
    '--context-menu-submenu-shadow': '0 2px 8px rgba(0, 0, 0, 0.3)',
    '--context-menu-divider-color': theme.border.default,
  } as React.CSSProperties;

  // Render divider
  if (isDivider) {
    return <div className="context-menu-divider" style={style} role="separator" />;
  }

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return;

    if (hasSubmenu || children) {
      e.stopPropagation();
      setSubmenuOpen(!submenuOpen);
    } else {
      onClick?.();
      onClose?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    // For items with submenus
    if (hasSubmenu || children) {
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (!submenuOpen) {
          setSubmenuOpen(true);
          // Focus first submenu item after opening
          setTimeout(() => {
            const firstSubmenuItem = submenuRef.current?.querySelector('[role="menuitem"]') as HTMLElement;
            if (firstSubmenuItem) {
              firstSubmenuItem.focus();
            }
          }, 0);
        }
        return;
      }

      if (e.key === 'ArrowLeft' && submenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        setSubmenuOpen(false);
        // Return focus to parent item
        itemRef.current?.focus();
        return;
      }
    } else {
      // For regular menu items without submenus
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
        onClose?.();
      }
    }
  };

  const handleMouseEnter = () => {
    if (hasSubmenu || children) {
      setSubmenuOpen(true);
    }
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    // Check if mouse is moving to submenu
    if (submenuRef.current && e.relatedTarget instanceof Node) {
      if (submenuRef.current.contains(e.relatedTarget)) {
        return;
      }
    }
    setSubmenuOpen(false);
  };

  // Close submenu when clicking outside
  useEffect(() => {
    if (!submenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setSubmenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [submenuOpen]);

  // Handle keyboard navigation within submenu
  useEffect(() => {
    if (!submenuOpen) return;

    const handleSubmenuKeyboard = (e: KeyboardEvent) => {
      // Only handle if focus is within the submenu
      if (!submenuRef.current?.contains(document.activeElement)) return;

      const items = Array.from(
        submenuRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')
      ) as HTMLElement[];

      if (items.length === 0) return;

      const currentIndex = items.findIndex(item => item === document.activeElement);

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          setSubmenuOpen(false);
          itemRef.current?.focus();
          break;

        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          if (currentIndex < items.length - 1) {
            items[currentIndex + 1].focus();
          } else {
            // Wrap to first item
            items[0].focus();
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          if (currentIndex > 0) {
            items[currentIndex - 1].focus();
          } else {
            // Wrap to last item
            items[items.length - 1].focus();
          }
          break;

        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          items[0].focus();
          break;

        case 'End':
          e.preventDefault();
          e.stopPropagation();
          items[items.length - 1].focus();
          break;
      }
    };

    document.addEventListener('keydown', handleSubmenuKeyboard, true);
    return () => document.removeEventListener('keydown', handleSubmenuKeyboard, true);
  }, [submenuOpen]);

  return (
    <div
      ref={itemRef}
      className={`context-menu-item ${disabled ? 'disabled' : ''} ${submenuOpen ? 'submenu-open' : ''}`}
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={style}
    >
      <div className="context-menu-item-content">
        {checked !== undefined && (
          <span className="context-menu-item-checkmark">
            {checked && <Icon name="check" size={16} />}
          </span>
        )}
        {icon && <span className="context-menu-item-icon">{icon}</span>}
        <span className="context-menu-item-label">{label}</span>
        {shortcut && (
          <span className="context-menu-item-shortcut">{shortcut}</span>
        )}
        {(hasSubmenu || children) && (
          <span className="context-menu-item-arrow">▸</span>
        )}
      </div>

      {(hasSubmenu || children) && submenuOpen && (
        <div ref={submenuRef} className="context-menu-submenu" role="menu">
          {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child, { onClose } as any);
            }
            return child;
          })}
        </div>
      )}
    </div>
  );
};
