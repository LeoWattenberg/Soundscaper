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

  // Safe-triangle "angle of escape": when the pointer leaves the
  // parent item, we build a triangle from the exit point to the two
  // leading corners of the submenu rect. As long as the pointer stays
  // inside that triangle we keep the submenu open — this is the
  // path a user cuts diagonally from parent to child. Once the
  // pointer leaves the triangle (or drifts too long without arriving)
  // we close.
  const safeTriangleRef = useRef<
    | {
        origin: { x: number; y: number };
        topCorner: { x: number; y: number };
        bottomCorner: { x: number; y: number };
      }
    | null
  >(null);
  const safeTriangleTimeoutRef = useRef<number | null>(null);
  const SAFE_TRIANGLE_TIMEOUT = 300; // safety cap — if pointer stalls in triangle, close anyway.

  const clearSafeTriangle = () => {
    safeTriangleRef.current = null;
    if (safeTriangleTimeoutRef.current !== null) {
      window.clearTimeout(safeTriangleTimeoutRef.current);
      safeTriangleTimeoutRef.current = null;
    }
    document.removeEventListener('mousemove', trackSafeTriangleMove);
  };

  const isPointInTriangle = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ) => {
    // Barycentric coordinate check — cheap and stable at boundaries.
    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (denom === 0) return false;
    const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
    const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
    const wc = 1 - wa - wb;
    return wa >= 0 && wb >= 0 && wc >= 0;
  };

  const trackSafeTriangleMove = (e: MouseEvent) => {
    const tri = safeTriangleRef.current;
    if (!tri) return;
    const p = { x: e.clientX, y: e.clientY };
    // If the pointer re-enters the parent item or the submenu, tear
    // the tracker down — hover handlers on those elements take over.
    if (
      itemRef.current?.contains(e.target as Node)
      || submenuRef.current?.contains(e.target as Node)
    ) {
      clearSafeTriangle();
      return;
    }
    if (!isPointInTriangle(p, tri.origin, tri.topCorner, tri.bottomCorner)) {
      clearSafeTriangle();
      setSubmenuOpen(false);
    }
  };

  const armSafeTriangle = (originClientX: number, originClientY: number) => {
    const submenu = submenuRef.current;
    if (!submenu) {
      setSubmenuOpen(false);
      return;
    }
    const r = submenu.getBoundingClientRect();
    // Pick the leading edge closest to the parent — usually the
    // left edge (submenu opens right of parent), but if the exit
    // point is to the right of the submenu we mirror to the right
    // edge so left-opening submenus still work.
    const submenuOnRight = r.left >= originClientX;
    const edgeX = submenuOnRight ? r.left : r.right;
    safeTriangleRef.current = {
      origin: { x: originClientX, y: originClientY },
      topCorner: { x: edgeX, y: r.top },
      bottomCorner: { x: edgeX, y: r.bottom },
    };
    if (safeTriangleTimeoutRef.current !== null) {
      window.clearTimeout(safeTriangleTimeoutRef.current);
    }
    safeTriangleTimeoutRef.current = window.setTimeout(() => {
      safeTriangleTimeoutRef.current = null;
      // Only auto-close if the pointer is still outside both the
      // parent and the submenu. Otherwise the hover handlers own
      // the state.
      clearSafeTriangle();
      setSubmenuOpen(false);
    }, SAFE_TRIANGLE_TIMEOUT);
    document.addEventListener('mousemove', trackSafeTriangleMove);
  };

  useEffect(() => () => clearSafeTriangle(), []);

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
      // Clicking a submenu parent used to toggle the child, so a
      // user hovering to open then clicking to activate would
      // accidentally dismiss the just-opened submenu. Always leave
      // the submenu open — hover-out (via the safe-triangle) or an
      // outside click is what closes it.
      setSubmenuOpen(true);
      clearSafeTriangle();
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
    // Re-entering the parent item tears down any active
    // safe-triangle tracking — hover state resumes normally.
    clearSafeTriangle();
    if (hasSubmenu || children) {
      // Any sibling parent that still has its submenu open should
      // close now that the pointer has moved on. We broadcast a
      // cheap DOM event; every ContextMenuItem listens and
      // closes its own submenu if it wasn't the one that fired.
      document.dispatchEvent(
        new CustomEvent('context-menu-hover', {
          detail: { source: itemRef.current },
        }),
      );
      setSubmenuOpen(true);
    }
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    if (!(hasSubmenu || children) || !submenuOpen) return;

    // Fast-path: the pointer is heading straight into the submenu.
    if (submenuRef.current && e.relatedTarget instanceof Node) {
      if (submenuRef.current.contains(e.relatedTarget)) {
        return;
      }
    }
    // Moving to a sibling menu item (parent's peer): close
    // immediately so the sibling's submenu can take over without
    // the two overlapping.
    const rel = e.relatedTarget as HTMLElement | null;
    if (rel && rel !== itemRef.current) {
      const parentMenu = itemRef.current?.closest('[role="menu"]');
      const relParentMenu = rel.closest?.('[role="menu"]');
      const relItem = rel.closest?.('[role="menuitem"]');
      if (
        parentMenu
        && relParentMenu === parentMenu
        && relItem
        && relItem !== itemRef.current
      ) {
        clearSafeTriangle();
        setSubmenuOpen(false);
        return;
      }
    }

    // Otherwise arm the safe-triangle: the user is now traversing
    // the empty gap between parent and child. As long as the
    // pointer stays inside the triangle drawn from the exit point
    // to the submenu's leading edge corners, the submenu stays
    // open. Any deviation outside — or the timeout — closes it.
    armSafeTriangle(e.clientX, e.clientY);
  };

  // Sibling-parent broadcast: when any sibling's hover opens its
  // submenu, close ours so we don't end up with two children
  // showing at the same time.
  useEffect(() => {
    if (!submenuOpen) return;
    const onSiblingHover = (e: Event) => {
      const source = (e as CustomEvent).detail?.source as HTMLElement | null;
      if (!source || !itemRef.current) return;
      if (source === itemRef.current) return;
      const parentMenu = itemRef.current.closest('[role="menu"]');
      const sourceParentMenu = source.closest('[role="menu"]');
      if (parentMenu && parentMenu === sourceParentMenu) {
        clearSafeTriangle();
        setSubmenuOpen(false);
      }
    };
    document.addEventListener('context-menu-hover', onSiblingHover);
    return () => document.removeEventListener('context-menu-hover', onSiblingHover);
  }, [submenuOpen]);

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
        <div
          ref={submenuRef}
          className="context-menu-submenu"
          role="menu"
          onMouseEnter={clearSafeTriangle}
        >
          {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child, { onClose } as any); // justified: cloneElement with extra props needs cast — pending components sweep
            }
            return child;
          })}
        </div>
      )}
    </div>
  );
};
