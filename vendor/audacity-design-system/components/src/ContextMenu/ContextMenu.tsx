import React, { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import './ContextMenu.css';

export interface ContextMenuProps {
  /**
   * Whether the menu is open
   */
  isOpen: boolean;

  /**
   * Callback when menu should close
   */
  onClose: () => void;

  /**
   * X position for the menu (in pixels)
   */
  x: number;

  /**
   * Y position for the menu (in pixels)
   */
  y: number;

  /**
   * Menu items (children)
   */
  children: React.ReactNode;

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Whether to auto-focus first item (when opened via keyboard)
   */
  autoFocus?: boolean;

  /**
   * Inline styles (for CSS custom properties)
   */
  style?: React.CSSProperties;
}

/**
 * ContextMenu - A floating context menu that appears at a specific position
 * Handles click-outside-to-close and positioning
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  onClose,
  x,
  y,
  children,
  className = '',
  autoFocus = true,
  style: externalStyle,
}) => {
  const { theme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  const internalStyle = {
    '--context-menu-bg': theme.background.menu.background,
    '--context-menu-border': theme.border.default,
    '--context-menu-shadow': '0 4px 16px rgba(0, 0, 0, 0.4)',
    '--context-menu-divider-bg': theme.border.divider,
  } as React.CSSProperties;

  const style = { ...internalStyle, ...externalStyle };

  // Store the trigger element when menu opens
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement;
    }
  }, [isOpen]);

  // Auto-focus first menu item when opened via keyboard
  useEffect(() => {
    if (!isOpen || !autoFocus || !menuRef.current) return;

    // Find first focusable menu item
    const firstItem = menuRef.current.querySelector('[role="menuitem"]') as HTMLElement;
    if (firstItem) {
      // Use setTimeout to ensure menu is rendered and positioned
      setTimeout(() => {
        firstItem.focus();
      }, 0);
    }
  }, [isOpen, autoFocus]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Add slight delay to prevent immediate close from the button click that opened it
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!menuRef.current) return;

      // Only select direct children menu items, not nested submenu items
      // This ensures submenu navigation is isolated
      const items = Array.from(
        menuRef.current.querySelectorAll(':scope > [role="menuitem"]:not([aria-disabled="true"])')
      ) as HTMLElement[];

      if (items.length === 0) return;

      const currentIndex = items.findIndex(item => item === document.activeElement);

      // Only handle navigation if focus is within this menu level (not in a submenu)
      const focusedElement = document.activeElement;
      const isInSubmenu = focusedElement &&
        !items.includes(focusedElement as HTMLElement) &&
        menuRef.current.contains(focusedElement);

      // If focus is in a submenu, let the submenu handle arrow keys
      if (isInSubmenu && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          // Restore focus to trigger element
          if (triggerElementRef.current) {
            const trigger = triggerElementRef.current;
            triggerElementRef.current = null;
            setTimeout(() => trigger.focus(), 0);
          }
          break;

        case 'Tab':
          // Tab (with or without Shift) closes menu and moves focus outside
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < items.length - 1) {
            items[currentIndex + 1].focus();
          } else {
            // Wrap to first item
            items[0].focus();
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            items[currentIndex - 1].focus();
          } else {
            // Wrap to last item
            items[items.length - 1].focus();
          }
          break;

        case 'Home':
          e.preventDefault();
          items[0].focus();
          break;

        case 'End':
          e.preventDefault();
          items[items.length - 1].focus();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Adjust position if menu would go off-screen
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Check if menu goes off right edge
    if (rect.right > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    // Check if menu goes off bottom edge
    if (rect.bottom > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    // Check if menu goes off left edge
    if (adjustedX < 0) {
      adjustedX = 10;
    }

    // Check if menu goes off top edge
    if (adjustedY < 0) {
      adjustedY = 10;
    }

    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  }, [isOpen, x, y]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={`context-menu ${className}`}
      role="menu"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 10000,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
