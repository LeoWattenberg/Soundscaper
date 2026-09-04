/**
 * ApplicationHeader - Top application header with OS-specific styling
 *
 * Displays app branding and menu items with platform-specific UI patterns:
 * - Windows: Menu bar at bottom, window controls at top right
 * - macOS: Traffic lights at left, app name centered
 */

import React from 'react';
import './ApplicationHeader.css';
import { Menu, MenuItem } from '../Menu';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';
import { useTabOrder } from '../hooks/useTabOrder';
import { useTheme } from '../ThemeProvider';

/**
 * The Audacity 4 headphone mark, taken from the website's favicon
 * (audacity.github.io/public/favicon.svg) so the header matches the
 * current brand.
 */
const AudacityLogo = () => (
  <svg
    className="application-header__logo"
    width="16"
    height="16"
    viewBox="0 0 41 42"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M40.8398 31.0351C40.8398 36.0694 36.6929 40.1506 31.5775 40.1506C26.462 40.1506 22.3151 36.0694 22.3151 31.0351C22.3151 26.0008 26.462 21.9197 31.5775 21.9197C36.6929 21.9197 40.8398 26.0008 40.8398 31.0351Z"
      fill="#DF135F"
    />
    <path
      d="M20.5988 0C12.2072 0 5.40448 6.91542 5.40447 15.4459C5.40447 16.6978 5.5512 18.3459 5.82772 19.5114H6.47867C6.36034 18.7908 6.29825 17.6167 6.29825 16.8574C6.29826 10.1671 11.1002 4.74345 17.0236 4.74341C22.9471 4.74341 27.749 10.167 27.749 16.8574C27.749 17.4931 27.7056 18.7642 27.622 19.3735H35.4494C35.6744 18.3161 35.7931 16.5718 35.7931 15.4459C35.793 6.91543 28.9903 1.11945e-05 20.5988 0Z"
      fill="#DF135F"
    />
    <path
      d="M0.160156 31.0351C0.160156 36.1359 4.21692 40.2709 9.22119 40.2709V21.7994C4.21692 21.7994 0.160156 25.9344 0.160156 31.0351Z"
      fill="#DF135F"
    />
    <path
      d="M17.5656 20.097L20.9333 31.0351L17.5656 41.92L14.3963 31.0351L17.5656 20.097Z"
      fill="#DF135F"
    />
    <path
      d="M12.8008 25.1754L14.5892 31.0351L12.8008 36.9742L10.6263 31.0351L12.8008 25.1754Z"
      fill="#DF135F"
    />
  </svg>
);

export type OperatingSystem = 'windows' | 'macos';

export interface ApplicationHeaderProps {
  /**
   * Operating system variant
   * @default 'windows'
   */
  os?: OperatingSystem;
  /**
   * Application name
   * @default 'Audacity'
   */
  appName?: string;
  /**
   * Menu items (Windows only)
   */
  menuItems?: string[];
  /**
   * Callback when menu item is clicked
   */
  onMenuItemClick?: (item: string) => void;
  /**
   * Menu item definitions for dropdown menus
   */
  menuDefinitions?: Record<string, MenuItem[]>;
  /**
   * Callback when window control is clicked
   */
  onWindowControl?: (action: 'minimize' | 'maximize' | 'close') => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

const DEFAULT_MENU_ITEMS = [
  'File',
  'Edit',
  'Select',
  'View',
  'Record',
  'Tracks',
  'Generate',
  'Effect',
  'Analyze',
  'Tools',
  'Extra',
  'Help',
];

/**
 * ApplicationHeader - Platform-specific application header
 */
export function ApplicationHeader({
  os = 'windows',
  appName = 'Audacity',
  menuItems = DEFAULT_MENU_ITEMS,
  onMenuItemClick,
  menuDefinitions,
  onWindowControl,
  className = '',
}: ApplicationHeaderProps) {
  const { theme } = useTheme();
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const menubarRef = React.useRef<HTMLDivElement>(null);
  const { activeProfile } = useAccessibilityProfile();

  const style = {
    '--header-bg': theme.background.surface.default,
    '--header-border': theme.border.onSurface,
    '--header-text': theme.foreground.text.primary,
    '--header-menu-hover': theme.background.surface.hover,
  } as React.CSSProperties;

  // Check if we're in flat navigation mode
  const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
  // Resolve menu tabIndex from profile
  const menuTabIndex = useTabOrder('file-menu');

  const handleMenuClick = (item: string, event: React.MouseEvent<HTMLButtonElement>) => {
    // If menu has definitions, open dropdown
    if (menuDefinitions && menuDefinitions[item]) {
      setOpenMenu(item);
      setMenuAnchorEl(event.currentTarget);
    } else {
      // Otherwise just fire callback
      onMenuItemClick?.(item);
    }
  };

  const handleMenuClose = () => {
    setOpenMenu(null);
    setMenuAnchorEl(null);
  };

  // Reset tabIndex to first element when focus leaves the menubar (only in grouped mode)
  const handleMenubarBlur = (e: React.FocusEvent) => {
    if (isFlatNavigation) return; // Don't manage tabIndex in flat mode

    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!menubarRef.current?.contains(relatedTarget)) {
      const buttons = menubarRef.current?.querySelectorAll('button');
      if (buttons) {
        buttons.forEach((btn, index) => {
          (btn as HTMLElement).tabIndex = index === 0 ? menuTabIndex : -1;
        });
      }
    }
  };

  // Handle keyboard navigation within the menu bar (only in grouped mode)
  const handleMenubarKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (isFlatNavigation) return; // No arrow navigation in flat mode

    // Only handle arrow keys - let Tab/Shift+Tab work naturally
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      return;
    }

    e.preventDefault();
    const buttons = menubarRef.current?.querySelectorAll('button');
    if (!buttons) return;

    let nextIndex: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % menuItems.length;
    } else {
      nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    }

    // Update tabIndex: current button gets -1, next button gets menuTabIndex
    (buttons[currentIndex] as HTMLElement).tabIndex = -1;
    (buttons[nextIndex] as HTMLElement).tabIndex = menuTabIndex;
    (buttons[nextIndex] as HTMLElement).focus();
  };
  if (os === 'macos') {
    return (
      <div className={`application-header application-header--macos ${className}`} style={style}>
        <div className="application-header__macos-controls">
          <button
            className="application-header__macos-button application-header__macos-button--close"
            onClick={() => onWindowControl?.('close')}
            aria-label="Close"
            tabIndex={-1}
          />
          <button
            className="application-header__macos-button application-header__macos-button--minimize"
            onClick={() => onWindowControl?.('minimize')}
            aria-label="Minimize"
            tabIndex={-1}
          />
          <button
            className="application-header__macos-button application-header__macos-button--maximize"
            onClick={() => onWindowControl?.('maximize')}
            aria-label="Maximize"
            tabIndex={-1}
          />
        </div>
        <div className="application-header__macos-title">
          <AudacityLogo />
          <span className="application-header__app-name">{appName}</span>
        </div>
      </div>
    );
  }

  // Windows variant
  return (
    <div className={`application-header application-header--windows ${className}`} style={style}>
      <div className="application-header__windows-titlebar">
        <div className="application-header__windows-title">
          <AudacityLogo />
          <span className="application-header__app-name">{appName}</span>
        </div>
        <div className="application-header__windows-controls">
          <button
            className="application-header__windows-control application-header__windows-control--minimize"
            onClick={() => onWindowControl?.('minimize')}
            aria-label="Minimize"
            tabIndex={-1}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            className="application-header__windows-control application-header__windows-control--maximize"
            onClick={() => onWindowControl?.('maximize')}
            aria-label="Maximize"
            tabIndex={-1}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
          <button
            className="application-header__windows-control application-header__windows-control--close"
            onClick={() => onWindowControl?.('close')}
            aria-label="Close"
            tabIndex={-1}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
              <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={menubarRef}
        className="application-header__windows-menubar"
        role="menubar"
        aria-label="Application menu"
        onBlur={handleMenubarBlur}
      >
        {menuItems.map((item, index) => (
          <button
            key={item}
            className="application-header__menu-item"
            onClick={(e) => handleMenuClick(item, e)}
            onKeyDown={(e) => handleMenubarKeyDown(e, index)}
            tabIndex={isFlatNavigation ? menuTabIndex : (index === 0 ? menuTabIndex : -1)}
          >
            {item}
          </button>
        ))}
      </div>

      {/* Dropdown menu */}
      {openMenu && menuDefinitions && menuDefinitions[openMenu] && (
        <Menu
          items={menuDefinitions[openMenu]}
          isOpen={true}
          anchorEl={menuAnchorEl}
          onClose={handleMenuClose}
        />
      )}
    </div>
  );
}

export default ApplicationHeader;
