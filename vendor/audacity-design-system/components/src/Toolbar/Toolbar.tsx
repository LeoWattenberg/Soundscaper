import React, { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import { useContainerTabGroup } from '../hooks/useContainerTabGroup';
import '../assets/fonts/musescore-icon.css';
import './Toolbar.css';

export interface ToolbarProps {
  /**
   * Height of the toolbar in pixels
   * @default 48
   */
  height?: number;
  /**
   * Main content/left section of the toolbar
   */
  children?: React.ReactNode;
  /**
   * Optional right section content
   */
  rightContent?: React.ReactNode;
  /**
   * Optional className for custom styling
   */
  className?: string;
  /**
   * Enable keyboard navigation as a tab group. Default is `false` so the
   * component renders without requiring a tab-group manager — consumers
   * (like the Audacity sandbox) that want arrow-key navigation can opt in.
   * @default false
   */
  enableTabGroup?: boolean;
  /**
   * Starting tabIndex for the first element in the toolbar (default: 0)
   */
  startTabIndex?: number;
  /**
   * Tab group ID for accessibility profile configuration
   * @default 'transport-toolbar'
   */
  tabGroupId?: string;
  /**
   * Show a gripper handle on the left edge of the toolbar. Fires
   * `onGripperMouseDown` when the user presses on it; the parent owns
   * the rest of the drag lifecycle (positioning, snap zones, etc.).
   * @default false
   */
  showGripper?: boolean;
  /**
   * Called when the user mouses down on the gripper. Receives the raw
   * mouse event plus the toolbar's bounding rect at press time, so the
   * parent can compute a cursor-to-toolbar offset for free positioning.
   * The toolbar itself doesn't move — the parent decides where to render.
   */
  onGripperMouseDown?: (event: React.MouseEvent, toolbarRect: DOMRect) => void;
}

/**
 * Toolbar component matching Figma design specifications
 * - Height: 48px (default)
 * - Background: #f8f8f9
 * - Border bottom: 1px solid #d4d5d9
 * - Internal padding: 12px horizontal
 * - Keyboard navigation: Arrow keys navigate within toolbar (tab group)
 */
export function Toolbar({
  height = 48,
  children,
  rightContent,
  className = '',
  enableTabGroup = false,
  startTabIndex: _startTabIndexProp,
  tabGroupId = 'transport-toolbar',
  showGripper = false,
  onGripperMouseDown,
}: ToolbarProps) {
  const { theme } = useTheme();
  const toolbarRef = useRef<HTMLDivElement>(null);

  const handleGripperMouseDown = (e: React.MouseEvent) => {
    if (!onGripperMouseDown) return;
    const rect = toolbarRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    onGripperMouseDown(e, rect);
  };

  const toolbarFilter = React.useCallback((el: HTMLElement) => {
    // Skip elements inside role="group" (TimeCode internal buttons)
    if (el.getAttribute('role') !== 'group') {
      const parentGroup = el.closest('[role="group"]');
      if (parentGroup) return false;
    }
    return true;
  }, []);

  const { onKeyDown, onBlur, containerProps, initTabIndices } = useContainerTabGroup({
    containerRef: toolbarRef,
    groupId: tabGroupId,
    selector: 'button, select, input, [role="group"]',
    filter: toolbarFilter,
    ariaLabel: 'Tool toolbar',
  });

  // Re-init when children change
  useEffect(() => {
    if (enableTabGroup) {
      initTabIndices();
    }
  }, [enableTabGroup, children, rightContent, initTabIndices]);

  const style = {
    '--toolbar-bg': theme.background.toolbar,
    '--toolbar-border': theme.border.onSurface,
    '--toolbar-divider': theme.border.divider,
    '--toolbar-gripper-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div
      ref={toolbarRef}
      className={`toolbar${showGripper ? ' toolbar--has-gripper' : ''} ${className}`}
      style={{ minHeight: `${height}px`, ...style }}
      role={enableTabGroup ? containerProps.role : undefined}
      aria-label={enableTabGroup ? containerProps['aria-label'] : undefined}
      onKeyDown={enableTabGroup ? onKeyDown : undefined}
      onBlur={enableTabGroup ? onBlur : undefined}
    >
      {showGripper && (
        <span
          className="toolbar__gripper musescore-icon"
          aria-hidden="true"
          role="presentation"
          onMouseDown={handleGripperMouseDown}
        >
          {'\uF3A2'}
        </span>
      )}
      <div className="toolbar__content">
        {children}
      </div>
      {rightContent && (
        <div className="toolbar__right">
          {rightContent}
        </div>
      )}
    </div>
  );
}

export interface ToolbarDividerProps {
  /**
   * Width of the divider
   * @default 1
   */
  width?: number;
}

/**
 * Vertical divider for separating toolbar button groups
 * - Width: 1px (default)
 */
export function ToolbarDivider({ width = 1 }: ToolbarDividerProps) {
  return (
    <div
      className="toolbar__divider"
      style={{ width: `${width}px` }}
    >
      <div className="toolbar__divider-line" />
    </div>
  );
}

export interface ToolbarButtonGroupProps {
  /**
   * Buttons or other content in the group
   */
  children: React.ReactNode;
  /**
   * Gap between items in the group (in pixels)
   * @default 2
   */
  gap?: number;
  /**
   * Optional className for custom styling
   */
  className?: string;
}

/**
 * Container for grouping toolbar buttons together
 * - Default gap: 2px (for transport buttons)
 * - Use gap={4} for regular button groups
 */
export function ToolbarButtonGroup({
  children,
  gap = 2,
  className = '',
}: ToolbarButtonGroupProps) {
  return (
    <div
      className={`toolbar__button-group ${className}`}
      style={{ gap: `${gap}px` }}
    >
      {children}
    </div>
  );
}
