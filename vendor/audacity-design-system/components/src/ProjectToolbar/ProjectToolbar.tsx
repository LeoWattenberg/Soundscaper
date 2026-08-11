import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Tab } from '../Tab';
import { useTabGroup } from '../hooks/useTabGroup';
import { useTheme } from '../ThemeProvider';
import { Dropdown } from '../Dropdown';
import { GhostButton } from '../GhostButton';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import { ToolbarGroup } from '../ToolbarGroup';
import type { IconName } from '../Icon';
import './ProjectToolbar.css';

export interface ProjectToolbarWorkspaceOption {
  value: string;
  label: string;
}

export interface ProjectToolbarWorkspaceSelector {
  value: string;
  options: ProjectToolbarWorkspaceOption[];
  onChange: (value: string) => void;
  /** Dropdown width in non-compact mode. Default 162px (Figma spec). */
  width?: string;
  /** Label shown next to the dropdown in non-compact mode. Default "Workspace". */
  label?: string;
}

export interface ProjectToolbarAction {
  icon: IconName;
  label: string;
  ariaLabel?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface ProjectToolbarHistoryActions {
  onUndo?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRedo?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface ProjectToolbarProps {
  /**
   * Height of the project toolbar in pixels
   * @default 40
   */
  height?: number;
  /**
   * Currently active menu item
   */
  activeItem?: 'home' | 'project' | 'export' | 'debug';
  /**
   * Callback when a menu item is clicked
   */
  onMenuItemClick?: (item: 'home' | 'project' | 'export' | 'debug') => void;
  /**
   * Structured center actions. When provided the toolbar drops the
   * action labels below `labelsBelow` and renders icon-only ghost
   * buttons. Falls back to `centerContent` if omitted.
   */
  centerActions?: ProjectToolbarAction[];
  /**
   * Structured workspace selector. Renders a dropdown above
   * `compactBelow` and a ghost icon button + context menu below it.
   * Falls back to `rightContent` if omitted.
   */
  workspaceSelector?: ProjectToolbarWorkspaceSelector;
  /**
   * Undo / redo callbacks rendered to the right of the workspace
   * selector when `workspaceSelector` is set.
   */
  historyActions?: ProjectToolbarHistoryActions;
  /**
   * Viewport width (px) below which the structured workspace selector
   * collapses to an icon button + context menu. @default 1200
   */
  compactBelow?: number;
  /**
   * Viewport width (px) below which the structured center actions
   * drop their labels. @default 900
   */
  labelsBelow?: number;
  /**
   * Free-form center content. Used when `centerActions` is not set.
   */
  centerContent?: React.ReactNode;
  /**
   * Free-form right content. Used when `workspaceSelector` is not set.
   */
  rightContent?: React.ReactNode;
  /**
   * Whether to show the debug menu item
   */
  showDebugMenu?: boolean;
  /**
   * Optional className for custom styling
   */
  className?: string;
}

/**
 * ProjectToolbar component - Top-level menu bar with tab groups
 * - Height: 40px (default)
 * - Background: #ffffff
 * - Border bottom: 1px solid #e5e5e5
 * - Contains: Home, Project, Export menus + center/right content
 * - Keyboard navigation: Arrow keys navigate within tab groups
 *
 * Responsive structured slots: pass `workspaceSelector` and/or
 * `centerActions` and the toolbar handles the compact-on-narrow
 * collapses internally so consumers don't have to wire ResizeObserver
 * and ContextMenu plumbing themselves.
 */
export function ProjectToolbar({
  height = 40,
  activeItem,
  onMenuItemClick,
  centerActions,
  workspaceSelector,
  historyActions,
  compactBelow = 1200,
  labelsBelow = 900,
  centerContent,
  rightContent,
  showDebugMenu = false,
  className = '',
}: ProjectToolbarProps) {
  const { theme } = useTheme();
  const leftGroupRef = useRef<(HTMLElement | null)[]>([]);

  // Shared state for roving tabindex
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Track viewport width for responsive collapses. We listen for window
  // resize rather than measuring the toolbar so the breakpoints stay
  // intuitive ("the window is narrower than X") regardless of any
  // surrounding layout.
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1920,
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isWorkspaceCompact = viewportWidth < compactBelow;
  const isLabelsCompact = viewportWidth < labelsBelow;

  // Workspace context menu state (compact mode)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState({ x: 0, y: 0 });
  const workspaceIconRef = useRef<HTMLDivElement>(null);
  const openWorkspaceMenu = () => {
    if (workspaceIconRef.current) {
      const rect = workspaceIconRef.current.getBoundingClientRect();
      setWorkspaceMenuPos({ x: rect.left, y: rect.bottom + 2 });
    }
    setWorkspaceMenuOpen(true);
  };

  const style = {
    '--toolbar-bg': theme.background.toolbar,
    '--toolbar-border': theme.border.onSurface,
    '--toolbar-text': theme.foreground.text.tertiary,
    '--toolbar-hover': theme.background.surface.hover,
    '--toolbar-active-text': theme.foreground.text.primary,
    '--toolbar-active-indicator': theme.border.focus,
    '--toolbar-text-primary': theme.foreground.text.primary,
  } as React.CSSProperties;

  const totalMenuItems = useMemo(() => {
    return showDebugMenu ? 4 : 3;
  }, [showDebugMenu]);

  // Use tab group hooks for each menu item with shared state
  const homeTab = useTabGroup({
    groupId: 'project-toolbar',
    itemIndex: 0,
    totalItems: totalMenuItems,
    itemRefs: leftGroupRef,
    activeIndex: activeTabIndex,
    onItemActivate: setActiveTabIndex,
  });

  const projectTab = useTabGroup({
    groupId: 'project-toolbar',
    itemIndex: 1,
    totalItems: totalMenuItems,
    itemRefs: leftGroupRef,
    activeIndex: activeTabIndex,
    onItemActivate: setActiveTabIndex,
  });

  const exportTab = useTabGroup({
    groupId: 'project-toolbar',
    itemIndex: 2,
    totalItems: totalMenuItems,
    itemRefs: leftGroupRef,
    activeIndex: activeTabIndex,
    onItemActivate: setActiveTabIndex,
  });

  const debugTab = useTabGroup({
    groupId: 'project-toolbar',
    itemIndex: 3,
    totalItems: totalMenuItems,
    itemRefs: leftGroupRef,
    activeIndex: activeTabIndex,
    onItemActivate: setActiveTabIndex,
  });

  // Resolve center area: structured `centerActions` wins over free-form
  // `centerContent`. With structured actions, labels drop at the
  // labelsBelow threshold.
  const renderedCenter: React.ReactNode = centerActions
    ? (
        <ToolbarGroup ariaLabel="Toolbar options" tabGroupId="project-toolbar-actions">
          {centerActions.map((action, i) => (
            <GhostButton
              key={i}
              icon={action.icon}
              ariaLabel={action.ariaLabel ?? action.label}
              label={isLabelsCompact ? undefined : action.label}
              size={isLabelsCompact ? 'medium' : undefined}
              onClick={action.onClick}
            />
          ))}
        </ToolbarGroup>
      )
    : centerContent;

  // Resolve right area: structured `workspaceSelector` wins.
  const handleWorkspacePick = (next: string) => {
    workspaceSelector?.onChange(next);
    setWorkspaceMenuOpen(false);
  };
  const renderedRight: React.ReactNode = workspaceSelector
    ? (
        <>
          {isWorkspaceCompact ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <div ref={workspaceIconRef} style={{ display: 'inline-flex' }}>
                <GhostButton
                  icon="workspace"
                  ariaLabel={workspaceSelector.label ?? 'Workspace'}
                  size="medium"
                  onClick={openWorkspaceMenu}
                />
              </div>
              {historyActions && (
                <>
                  <GhostButton
                    icon="undo"
                    ariaLabel="Undo"
                    size="medium"
                    onClick={historyActions.onUndo}
                  />
                  <GhostButton
                    icon="redo"
                    ariaLabel="Redo"
                    size="medium"
                    onClick={historyActions.onRedo}
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <span style={{ fontSize: '13px', color: 'var(--toolbar-text-primary)', marginRight: '4px' }}>
                {workspaceSelector.label ?? 'Workspace'}
              </span>
              <ToolbarGroup ariaLabel="Workspace controls" tabGroupId="project-toolbar-workspace">
                <Dropdown
                  value={workspaceSelector.value}
                  width={workspaceSelector.width ?? '162px'}
                  options={workspaceSelector.options}
                  onChange={(next) => workspaceSelector.onChange(next)}
                />
              </ToolbarGroup>
              {historyActions && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <GhostButton
                    icon="undo"
                    ariaLabel="Undo"
                    size="medium"
                    onClick={historyActions.onUndo}
                  />
                  <GhostButton
                    icon="redo"
                    ariaLabel="Redo"
                    size="medium"
                    onClick={historyActions.onRedo}
                  />
                </div>
              )}
            </>
          )}
          <ContextMenu
            isOpen={workspaceMenuOpen}
            onClose={() => setWorkspaceMenuOpen(false)}
            x={workspaceMenuPos.x}
            y={workspaceMenuPos.y}
          >
            {workspaceSelector.options.map((opt) => (
              <ContextMenuItem
                key={opt.value}
                label={opt.label}
                checked={workspaceSelector.value === opt.value}
                onClick={() => handleWorkspacePick(opt.value)}
              />
            ))}
          </ContextMenu>
        </>
      )
    : rightContent;

  return (
    <div
      className={`project-toolbar ${className}`}
      style={{ height: `${height}px`, ...style }}
      role="toolbar"
      aria-label="Project toolbar"
    >
      <div className="project-toolbar__left" role="group" aria-label="Main menu">
        <Tab
          ref={(el) => (leftGroupRef.current[0] = el)}
          label="Home"
          isActive={activeItem === 'home'}
          onClick={() => onMenuItemClick?.('home')}
          tabIndex={homeTab.tabIndex}
          onKeyDown={homeTab.onKeyDown}
          onFocus={homeTab.onFocus}
          onBlur={homeTab.onBlur}
        />
        <Tab
          ref={(el) => (leftGroupRef.current[1] = el)}
          label="Project"
          isActive={activeItem === 'project'}
          onClick={() => onMenuItemClick?.('project')}
          tabIndex={projectTab.tabIndex}
          onKeyDown={projectTab.onKeyDown}
          onFocus={projectTab.onFocus}
          onBlur={projectTab.onBlur}
        />
        <Tab
          ref={(el) => (leftGroupRef.current[2] = el)}
          label="Export"
          isActive={activeItem === 'export'}
          onClick={() => onMenuItemClick?.('export')}
          tabIndex={exportTab.tabIndex}
          onKeyDown={exportTab.onKeyDown}
          onFocus={exportTab.onFocus}
          onBlur={exportTab.onBlur}
        />
        {showDebugMenu && (
          <Tab
            ref={(el) => (leftGroupRef.current[3] = el)}
            label="Debug"
            isActive={activeItem === 'debug'}
            onClick={() => onMenuItemClick?.('debug')}
            tabIndex={debugTab.tabIndex}
            onKeyDown={debugTab.onKeyDown}
            onFocus={debugTab.onFocus}
            onBlur={debugTab.onBlur}
          />
        )}
      </div>

      {activeItem !== 'home' && renderedCenter && (
        <div className="project-toolbar__center" role="group" aria-label="Toolbar options">
          {renderedCenter}
        </div>
      )}

      {activeItem !== 'home' && renderedRight && (
        <div className="project-toolbar__right" role="group" aria-label="Workspace controls">
          {renderedRight}
        </div>
      )}
    </div>
  );
}
