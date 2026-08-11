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

const AudacityLogo = () => (
  <svg
    className="application-header__logo"
    width="16"
    height="16"
    viewBox="0 0 128 128"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <clipPath id="clipPath3126">
        <path d="m 30,94 2,2 3,10 1,-12 3,15 0,-19 2,5 3,14 0,-19 2,2 3,17 3,-23 6.615678,25.91971 L 59,96 l 2,-6 2,25 6,-25 2,21 5,-22 5,24 1,-18 3,-6 1,23 5,-22 3,10 1,-9 3,6 0,-19 -3,8 L 94,69 92,82 90,78 89,64 84,83 83,79 80,49 77,75 75,83 71,56 67,79 65,85 64,43.695313 58,90 52,48 49,84 47,80 45,56 44,80 41,87 39,63 37,82 34,77 34,91 30,76 30,94 z" />
      </clipPath>
      <clipPath id="clipPath2798">
        <path d="M 64,6.875 C 50.736931,6.8749995 38.641338,11.015795 29.71875,17.96875 20.796162,24.921705 15.000001,34.870138 15,45.9375 l 0,4 C 6.141206,54.425978 -2.65625e-7,66.200002 0,80 c 3.5e-7,17.663999 10.049452,32 23,32 l 0,-66.0625 c 1e-6,-8.28809 4.289844,-15.915956 11.65625,-21.65625 C 42.022656,18.540956 52.424603,14.875 64,14.875 c 11.575394,0 21.977345,3.665955 29.34375,9.40625 C 100.71016,30.021545 105,37.649411 105,45.9375 L 105,112 c 12.95055,0 23,-14.336001 23,-32 0,-13.799998 -6.14121,-25.574022 -15,-30.0625 l 0,-4 C 113,34.870138 107.20384,24.921705 98.28125,17.96875 89.358662,11.015795 77.263067,6.8750003 64,6.875 z M 26,49 l 0,63 c 2,0 4,-1 5,-3 l 0,-58 c -1,-1 -3,-2 -5,-2 z m 76,0 c -2,0 -4,1 -5,2 l 0,58 c 1,2 3,3 5,3 l 0,-63 z" />
      </clipPath>
    </defs>
    <g transform="translate(0,0.2718691)">
      <path d="M 61.15625,42.25 C 58.861805,47.992238 56.651829,57.494785 53.982827,46.562915 51.981219,38.798278 47.704128,51.428622 44.59375,53.59375 38.320522,58.362406 34.848663,65.082161 32.0625,72.28125 24.684749,66.007892 27.452069,76.076134 27,81 c 0.402184,7.380888 -0.800512,15.452086 0.59375,22.40625 5.854747,5.10155 10.089878,13.15352 18.802059,13.04976 5.959442,2.07139 5.213051,-6.94006 10.616691,0.53774 4.972912,6.81603 8.043984,2.83082 11.290095,-0.52223 4.743263,7.26056 6.196016,-8.68733 10.197405,-1.53402 6.184179,2.40622 11.729123,3.55166 12.743737,-4.61035 C 92.513698,103.88085 103.59678,103.75018 101,96 100.63782,87.959006 101.71936,79.344023 100.46875,71.65625 96.271243,68.380172 93.032682,60.815021 88.25,60.15625 82.332486,63.027958 84.612545,50.366594 82.177379,46.639815 81.381184,36.8539 79.285065,41.278717 77.006263,47.989585 75.745384,57.650753 70.444886,53.045255 67.737405,46.722214 65.328893,44.69735 62.584408,33.998658 61.15625,42.25 z" fill="#f3e517" opacity="0.7" />
      <g clipPath="url(#clipPath3126)">
        <path d="m 28,116 0,-73 72,0 0,73 -72,0 z" fill="#ff7901" />
        <path d="m 29,80 8,5 3,-9 5,6 6,-10 2,12 2,-8 3,6 1,-6 c 0,0 3,8 3,7 0,-1 4,-15 4,-15 l 4,13 6,-12 3,13 5,-9 3,9 5,-5 6,6 0,8 -4,3 -6,-2 -4,-2 -1,10 -2,-10 -4,9 -6,-9 -2,9 -4,-6 -5,13 -3,-15 -6,3 -4,-6 -2,10 -4,-5 -4,5 -2,-3 -6,1 0,-16 z" fill="#ff0101" opacity="0.7" />
      </g>
      <g clipPath="url(#clipPath2798)">
        <path d="M 64,6.875 C 50.736931,6.8749995 38.641338,11.015795 29.71875,17.96875 20.796162,24.921705 15.000001,34.870138 15,45.9375 l 0,4 C 6.141206,54.425978 -2.65625e-7,66.200002 0,80 c 3.5e-7,17.663999 10.049452,32 23,32 l 0,-66.0625 c 1e-6,-8.28809 4.289844,-15.915956 11.65625,-21.65625 C 42.022656,18.540956 52.424603,14.875 64,14.875 c 11.575394,0 21.977345,3.665955 29.34375,9.40625 C 100.71016,30.021545 105,37.649411 105,45.9375 L 105,112 c 12.95055,0 23,-14.336001 23,-32 0,-13.799998 -6.14121,-25.574022 -15,-30.0625 l 0,-4 C 113,34.870138 107.20384,24.921705 98.28125,17.96875 89.358662,11.015795 77.263067,6.8750003 64,6.875 z M 26,49 l 0,63 c 2,0 4,-1 5,-3 l 0,-58 c -1,-1 -3,-2 -5,-2 z m 76,0 c -2,0 -4,1 -5,2 l 0,58 c 1,2 3,3 5,3 l 0,-63 z" fill="#000000" />
        <path d="M 60,4.875 C 46.736931,4.8749995 34.641338,9.015795 25.71875,15.96875 16.796162,22.921705 9.000001,32.870138 9,43.9375 l 0,2 C 0.141206,50.425978 -9.0000003,62.200002 -9,76 c 4e-7,17.663999 12.049452,28 25,28 l 0,-48 c 18.212543,-76.721252 3,-2.538386 3,-4 0,-12 7.610919,-26.021289 14,-31 7.366406,-5.740294 15.424603,-9 27,-9 11.575394,0 21.977345,2.540955 29.34375,8.28125 C 96.71016,26.021545 101,33.649411 101,41.9375 L 101,110 c 1.1221,0 1.93982,-2.7782 3,-3 11.1757,-2.33812 19,-14.8665 19,-31 0,-13.799998 -4.14121,-21.511522 -13,-26 l -1,-8.0625 C 109,30.870138 103.20384,20.921705 94.28125,13.96875 85.358662,7.015795 73.263067,4.8750003 60,4.875 z M 25,45 23,107 c 2,0 7,-1 8,-3 l 0,-57 c -1,-1 -4,-2 -6,-2 z m 74,0 c -2,0 -4,1 -5,2 l 0,58 c 1,2 3,4 5,4 l 0,-64 z" fill="#0000cc" opacity="0.5" />
      </g>
      <path d="M 16,56 C 9.2335582,58.198211 6.2297604,67.404307 6.2297604,75.404307 6.2297604,67.404307 14.774449,60 16,56 z M 37.77024,16.680861 C 25.32304,23.478178 22.763601,29.624897 20,36 24.981512,28.932353 29.634193,21.645485 37.77024,16.680861 z m -9.991095,33.020078 0.272345,2.587273 -1.906412,-2.042584 0.272344,-1.361723 1.361723,0.817034 z m 81.294845,0.817033 4.08517,6.400098 -1.49789,1.361723 -2.58728,-7.761821 z" fill="#ffffff" opacity="0.3" />
    </g>
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
            {'\uE921'}
          </button>
          <button
            className="application-header__windows-control application-header__windows-control--maximize"
            onClick={() => onWindowControl?.('maximize')}
            aria-label="Maximize"
            tabIndex={-1}
          >
            {'\uE922'}
          </button>
          <button
            className="application-header__windows-control application-header__windows-control--close"
            onClick={() => onWindowControl?.('close')}
            aria-label="Close"
            tabIndex={-1}
          >
            {'\uE8BB'}
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
