import React, { useState, useCallback, useRef } from 'react';
import { GhostButton } from '../GhostButton';
import { useTheme } from '../ThemeProvider';
import './PanelHeader.css';

export interface PanelHeaderTab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label */
  label: string;
}

export interface PanelHeaderProps {
  /** Array of tab items */
  tabs: PanelHeaderTab[];
  /** ID of the currently active tab */
  activeTabId: string;
  /** Called when a tab is clicked */
  onTabChange?: (tabId: string) => void;
  /** Called when tabs are reordered by drag */
  onTabReorder?: (tabs: PanelHeaderTab[]) => void;
  /** Called when the menu button on the active tab is clicked */
  onMenuClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Called when the close button is clicked */
  onClose?: () => void;
  /** Called when the user drags the top edge to resize the panel */
  onResizeStart?: (e: React.MouseEvent) => void;
  /** Additional CSS class names */
  className?: string;
}

const RESIZE_ZONE = 4; // px from top edge that triggers resize cursor
const DRAG_THRESHOLD = 4; // px of movement before drag starts

/**
 * PanelHeader - Tabbed header for panels.
 * Displays tabs with the active tab highlighted and an ellipsis menu button.
 * Optionally shows a close button and supports top-edge resize dragging.
 * Tabs can be reordered by dragging.
 */
export const PanelHeader: React.FC<PanelHeaderProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabReorder,
  onMenuClick,
  onClose,
  onResizeStart,
  className = '',
}) => {
  const { theme } = useTheme();
  const [inResizeZone, setInResizeZone] = useState(false);

  // Drag-to-reorder state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<'before' | 'after'>('before');
  // Refs to avoid stale closures in pointer event handlers
  const dropTargetRef = useRef<string | null>(null);
  const dropSideRef = useRef<'before' | 'after'>('before');
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const onTabReorderRef = useRef(onTabReorder);
  onTabReorderRef.current = onTabReorder;
  const dragRef = useRef<{
    tabId: string;
    startX: number;
    started: boolean;
  } | null>(null);
  const tabGroupRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!onResizeStart) return;
    // Don't change cursor to resize while dragging a tab
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const localY = e.clientY - rect.top;
    setInResizeZone(localY <= RESIZE_ZONE);
  }, [onResizeStart]);

  const handleMouseLeave = useCallback(() => {
    setInResizeZone(false);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (inResizeZone && onResizeStart) {
      onResizeStart(e);
    }
  }, [inResizeZone, onResizeStart]);

  // Tab drag handlers
  const handleTabPointerDown = useCallback((e: React.PointerEvent, tabId: string) => {
    // Only reorder if there are multiple tabs
    if (tabs.length < 2 || !onTabReorder) return;
    // Only left mouse button
    if (e.button !== 0) return;

    dragRef.current = { tabId, startX: e.clientX, started: false };

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;

      if (!dragRef.current.started) {
        if (Math.abs(ev.clientX - dragRef.current.startX) < DRAG_THRESHOLD) return;
        dragRef.current.started = true;
        setDragTabId(dragRef.current.tabId);
      }

      // Find which tab we're over
      if (!tabGroupRef.current) return;
      const tabElements = tabGroupRef.current.querySelectorAll('[role="tab"]');
      let foundTarget: string | null = null;
      let foundSide: 'before' | 'after' = 'before';

      for (const el of tabElements) {
        const rect = el.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          const id = (el as HTMLElement).dataset.tabId;
          if (id && id !== dragRef.current.tabId) {
            foundTarget = id;
            foundSide = ev.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
          }
          break;
        }
      }

      dropTargetRef.current = foundTarget;
      dropSideRef.current = foundSide;
      setDropTargetId(foundTarget);
      setDropSide(foundSide);
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      const currentDropTarget = dropTargetRef.current;
      const currentDropSide = dropSideRef.current;
      const currentTabs = tabsRef.current;
      const reorder = onTabReorderRef.current;

      if (dragRef.current?.started && currentDropTarget && reorder) {
        const fromId = dragRef.current.tabId;
        const newTabs = currentTabs.filter(t => t.id !== fromId);
        const draggedTab = currentTabs.find(t => t.id === fromId);
        if (draggedTab) {
          const targetIdx = newTabs.findIndex(t => t.id === currentDropTarget);
          if (targetIdx >= 0) {
            const insertIdx = currentDropSide === 'after' ? targetIdx + 1 : targetIdx;
            newTabs.splice(insertIdx, 0, draggedTab);
            reorder(newTabs);
          }
        }
      }

      dragRef.current = null;
      dropTargetRef.current = null;
      setDragTabId(null);
      setDropTargetId(null);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [tabs.length]);

  const style = {
    '--ph-bg': theme.background.surface.elevated,
    '--ph-tab-active-bg': theme.background.surface.default,
    '--ph-tab-hover-bg': theme.background.surface.hover,
    '--ph-border': theme.border.default,
    '--ph-text': theme.foreground.text.primary,
    '--ph-focus': theme.border.focus,
    ...(inResizeZone ? { cursor: 'ns-resize' } : {}),
  } as React.CSSProperties;

  return (
    <div
      className={`panel-header ${className}`}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      <div className="panel-header__tab-group" role="tablist" ref={tabGroupRef}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDragging = tab.id === dragTabId;
          const isDropTarget = tab.id === dropTargetId;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              data-tab-id={tab.id}
              aria-selected={isActive}
              className={`panel-header__tab ${
                isActive
                  ? 'panel-header__tab--active'
                  : 'panel-header__tab--inactive'
              }${isDragging ? ' panel-header__tab--dragging' : ''}${
                isDropTarget ? ` panel-header__tab--drop-${dropSide}` : ''
              }`}
              onClick={() => onTabChange?.(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTabChange?.(tab.id);
                }
              }}
              onPointerDown={(e) => handleTabPointerDown(e, tab.id)}
            >
              <span className="panel-header__tab-label">{tab.label}</span>
              {isActive && (
                <GhostButton
                  icon="menu"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMenuClick?.(e);
                  }}
                  ariaLabel={`${tab.label} menu`}
                  tabIndex={-1}
                />
              )}
            </div>
          );
        })}
      </div>

      {onClose && (
        <GhostButton
          icon="close"
          size="small"
          onClick={onClose}
          ariaLabel="Close panel"
          className="panel-header__close"
        />
      )}
    </div>
  );
};

export default PanelHeader;
