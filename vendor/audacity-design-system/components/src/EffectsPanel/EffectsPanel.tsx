import React from 'react';
import { SidePanel } from '../SidePanel';
import { useTheme } from '../ThemeProvider';
import { useContainerTabGroup } from '../hooks/useContainerTabGroup';
import { EffectsPanelHeader } from './EffectsPanelHeader';
import { EffectsStackHeader } from './EffectsStackHeader';
import { EffectSlot } from './EffectSlot';
import './EffectsPanel.css';

export interface Effect {
  id: string;
  name: string;
  enabled: boolean;
}

export interface EffectSlotProps {
  /** Effect data */
  effect?: Effect;
  /** Whether this is a master effect slot */
  isMaster?: boolean;
  /** Called when effect enabled state changes */
  onToggle?: (enabled: boolean) => void;
  /** Called when effect is selected from dropdown */
  onEffectChange?: (effectId: string) => void;
  /** Called when effect settings should be shown */
  onShowSettings?: () => void;
}

export interface EffectsTrackSectionProps {
  /** Track name */
  trackName: string;
  /** Track effects */
  effects: Effect[];
  /** Whether all effects are enabled */
  allEnabled: boolean;
  /** Called when track effects are toggled */
  onToggleAll?: (enabled: boolean) => void;
  /** Called when effect enabled state changes */
  onEffectToggle?: (effectIndex: number, enabled: boolean) => void;
  /** Called when effect is changed */
  onEffectChange?: (effectIndex: number, effectId: string) => void;
  /** Called when effects are reordered */
  onEffectsReorder?: (fromIndex: number, toIndex: number) => void;
  /** Called when "Add effect" is clicked */
  onAddEffect?: (event: React.MouseEvent) => void;
  /** Called when track context menu is clicked */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Called when effect is removed */
  onRemoveEffect?: (effectIndex: number) => void;
  /** Called when effect is replaced with a different effect */
  onReplaceEffect?: (effectIndex: number, effectName: string) => void;
  /** Called when "Change effect…" is picked from a slot's context menu */
  onChangeEffect?: (effectIndex: number, anchor: DOMRect | null) => void;
  /** Effects the user has purchased from MuseHub this session — surfaced in
   *  each slot's caret context menu alongside the built-in categories. */
  purchasedEffects?: Array<{ id: string; name: string; vendor: string }>;
  /** Plugin IDs the user has disabled in the Plugin Manager — filtered out
   *  of each slot's caret menu. */
  disabledPluginIds?: Set<string>;
}

export interface EffectsMasterSectionProps {
  /** Master effects */
  effects: Effect[];
  /** Whether all master effects are enabled */
  allEnabled: boolean;
  /** Called when master effects are toggled */
  onToggleAll?: (enabled: boolean) => void;
  /** Called when effect enabled state changes */
  onEffectToggle?: (effectIndex: number, enabled: boolean) => void;
  /** Called when effect is changed */
  onEffectChange?: (effectIndex: number, effectId: string) => void;
  /** Called when effects are reordered */
  onEffectsReorder?: (fromIndex: number, toIndex: number) => void;
  /** Called when "Add master effect" is clicked */
  onAddEffect?: (event: React.MouseEvent) => void;
  /** Called when master context menu is clicked */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Called when effect is removed */
  onRemoveEffect?: (effectIndex: number) => void;
  /** Called when effect is replaced with a different effect */
  onReplaceEffect?: (effectIndex: number, effectName: string) => void;
  /** Called when "Change effect…" is picked from a slot's context menu */
  onChangeEffect?: (effectIndex: number, anchor: DOMRect | null) => void;
  /** Effects the user has purchased from MuseHub this session — surfaced in
   *  each slot's caret context menu alongside the built-in categories. */
  purchasedEffects?: Array<{ id: string; name: string; vendor: string }>;
  /** Plugin IDs the user has disabled in the Plugin Manager — filtered out
   *  of each slot's caret menu. */
  disabledPluginIds?: Set<string>;
}

export interface EffectsPanelProps {
  /** Whether the panel is visible */
  isOpen?: boolean;
  /** Track section props */
  trackSection?: EffectsTrackSectionProps;
  /** Master section props */
  masterSection?: EffectsMasterSectionProps;
  /** Whether the panel is resizable */
  resizable?: boolean;
  /** Minimum width when resizing (px) */
  minWidth?: number;
  /** Maximum width when resizing (px) */
  maxWidth?: number;
  /** Called when panel is resized */
  onResize?: (width: number) => void;
  /** Called when panel is closed */
  onClose?: () => void;
  /** Called when Tab is pressed on the panel container — allows parent to redirect focus */
  onTabOut?: () => void;
  /** Additional CSS class */
  className?: string;
  /** Positioning mode - 'sidebar' for static left panel, 'overlay' for absolute positioned overlay */
  mode?: 'sidebar' | 'overlay';
  /** Position for overlay mode (left offset in px) */
  left?: number;
  /** Position for overlay mode (top offset in px) */
  top?: number;
  /** Width for overlay mode (px) */
  width?: number;
  /** Height for overlay mode (px) */
  height?: number;
}

/**
 * Effect Slot Wrapper Component
 * Adapts the new EffectSlot component to the panel's interface
 */
const EffectSlotWrapper: React.FC<EffectSlotProps> = ({
  effect,
  isMaster = false,
  onToggle,
  onEffectChange,
  onShowSettings,
}) => {
  return (
    <EffectSlot
      effectName={effect?.name || (isMaster ? 'Master effect name' : 'Effect name')}
      enabled={effect?.enabled ?? true}
      onToggle={onToggle}
      onSelectEffect={onEffectChange ? () => onEffectChange('') : undefined}
      onShowSettings={onShowSettings}
    />
  );
};

/**
 * Track Effects Section
 */
const TrackEffectsSection: React.FC<EffectsTrackSectionProps> = ({
  trackName,
  effects,
  allEnabled,
  onToggleAll,
  onEffectToggle,
  onEffectChange,
  onEffectsReorder,
  onAddEffect,
  onContextMenu,
  onRemoveEffect,
  onReplaceEffect,
  onChangeEffect,
  purchasedEffects,
  disabledPluginIds,
}) => {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    onEffectsReorder?.(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="effects-panel__track-section">
      {/* Header */}
      <EffectsStackHeader
        name={trackName}
        allEnabled={allEnabled}
        onToggleAll={onToggleAll}
        onContextMenu={onContextMenu}
        onAddEffect={onAddEffect}
        addButtonLabel="Effects"
      />

      {/* Effect stack - only show if there are effects */}
      {effects.length > 0 && (
        <div
          className="effects-panel__effect-stack"
          aria-label="Effect stack"
        >
          {effects.map((effect, index) => (
            <EffectSlot
              key={effect.id}
              effectName={effect?.name || 'Effect name'}
              enabled={effect?.enabled ?? true}
              isDragging={draggedIndex === index}
              onToggle={(enabled) => onEffectToggle?.(index, enabled)}
              onSelectEffect={onEffectChange ? () => onEffectChange?.(index, '') : undefined}
              onRemoveEffect={() => onRemoveEffect?.(index)}
              onReplaceEffect={(effectName) => onReplaceEffect?.(index, effectName)}
              onChangeEffect={(anchor) => onChangeEffect?.(index, anchor)}
              purchasedEffects={purchasedEffects}
              disabledPluginIds={disabledPluginIds}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDragEnd={handleDragEnd}
              onReorder={(dir) => {
                const target = index + dir;
                if (target >= 0 && target < effects.length) {
                  onEffectsReorder?.(index, target);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Master Effects Section
 */
const MasterEffectsSection: React.FC<EffectsMasterSectionProps> = ({
  effects,
  allEnabled,
  onToggleAll,
  onEffectToggle,
  onEffectChange,
  onEffectsReorder,
  onAddEffect,
  onContextMenu,
  onRemoveEffect,
  onReplaceEffect,
  onChangeEffect,
  purchasedEffects,
  disabledPluginIds,
}) => {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    onEffectsReorder?.(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="effects-panel__master-section">
      {/* Header */}
      <EffectsStackHeader
        name="Master track"
        allEnabled={allEnabled}
        onToggleAll={onToggleAll}
        onContextMenu={onContextMenu}
        onAddEffect={onAddEffect}
        addButtonLabel="Effects"
        isMaster
      />

      {/* Effect stack - only show if there are effects */}
      {effects.length > 0 && (
        <div
          className="effects-panel__effect-stack"
          aria-label="Master effect stack"
        >
          {effects.map((effect, index) => (
            <EffectSlot
              key={effect.id}
              effectName={effect?.name || 'Master effect name'}
              enabled={effect?.enabled ?? true}
              isDragging={draggedIndex === index}
              onToggle={(enabled) => onEffectToggle?.(index, enabled)}
              onSelectEffect={onEffectChange ? () => onEffectChange?.(index, '') : undefined}
              onRemoveEffect={() => onRemoveEffect?.(index)}
              onReplaceEffect={(effectName) => onReplaceEffect?.(index, effectName)}
              onChangeEffect={(anchor) => onChangeEffect?.(index, anchor)}
              purchasedEffects={purchasedEffects}
              disabledPluginIds={disabledPluginIds}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDragEnd={handleDragEnd}
              onReorder={(dir) => {
                const target = index + dir;
                if (target >= 0 && target < effects.length) {
                  onEffectsReorder?.(index, target);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** Selector for top-level focusable children in the effects panel.
 *  Matches: close button, toggle buttons, individual effect slot rows, add buttons. */
const PANEL_CHILD_SELECTOR = 'button, .effect-slot';

/** Filter out buttons/elements that are inside an effect slot (they have their own Enter-to-enter navigation) */
function panelChildFilter(el: HTMLElement): boolean {
  // Allow effect-slot rows themselves (they are the top-level stops)
  if (el.classList.contains('effect-slot')) return true;
  // Exclude any button inside an effect slot
  if (el.closest('.effect-slot')) return false;
  return true;
}

/**
 * Effects Panel - Sidebar panel for managing track and master effects
 * Can be used as a static sidebar or as an overlay that appears next to track controls
 */
export const EffectsPanel: React.FC<EffectsPanelProps> = ({
  isOpen = true,
  trackSection,
  masterSection,
  resizable = false,
  minWidth = 240,
  maxWidth = 400,
  onResize,
  onClose,
  onTabOut,
  className = '',
  mode = 'sidebar',
  left = 0,
  top = 0,
  width,
  height,
}) => {
  const { theme } = useTheme();
  const [masterSectionHeight, setMasterSectionHeight] = React.useState(230); // Default master section height
  const [isResizingVertical, setIsResizingVertical] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Use container tab group for roving tabindex on panel children
  const tabGroup = useContainerTabGroup({
    containerRef: panelRef,
    groupId: 'effects-panel',
    selector: PANEL_CHILD_SELECTOR,
    filter: panelChildFilter,
    ariaLabel: 'Effects panel',
  });

  const style = {
    '--ep-bg': theme.background.surface.default,
    '--ep-header-bg': theme.background.surface.default,
    '--ep-header-border': theme.border.default,
    '--ep-section-bg': theme.background.surface.default,
    '--ep-section-border': theme.border.default,
    '--ep-stack-bg': theme.background.surface.inset,
    '--ep-text-primary': theme.foreground.text.primary,
    '--ep-text-secondary': theme.foreground.text.secondary,
    '--ep-icon-primary': theme.foreground.icon.primary,
    '--ep-button-bg': theme.background.control.button.secondary.idle,
    '--ep-button-hover-bg': theme.background.control.button.secondary.hover,
    '--ep-button-active-bg': theme.background.control.button.primary.active,
    '--ep-toggle-active-bg': theme.background.control.button.primary.active,
    '--ep-toggle-icon-color': theme.foreground.text.inverse,
    '--ep-input-bg': theme.background.control.input.idle,
    '--ep-input-border': theme.border.input.idle,
  } as React.CSSProperties;

  // Handle vertical resize
  const handleVerticalResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingVertical(true);
  };

  React.useEffect(() => {
    if (!isResizingVertical) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!contentRef.current) return;

      const contentRect = contentRef.current.getBoundingClientRect();
      const newHeight = contentRect.bottom - e.clientY;

      // Clamp height between min and max (min: 140px for master, min: 140px for track)
      const clampedHeight = Math.max(140, Math.min(contentRect.height - 140, newHeight));
      setMasterSectionHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      setIsResizingVertical(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingVertical]);

  // Handle keyboard — delegate arrow keys to the hook, let Tab pass through naturally
  const handleKeyDown = (e: React.KeyboardEvent) => {
    tabGroup.onKeyDown(e);
  };

  // Initialize tab indices on mount and when sections change
  React.useEffect(() => {
    tabGroup.initTabIndices();
  }, [trackSection, masterSection, tabGroup.initTabIndices]);

  // On open, move keyboard focus to the close button so the panel
  // announces itself with a visible focus ring and a familiar "X to
  // dismiss" affordance. setTimeout(0) lets layout settle so the
  // .focus() doesn't race the initial paint.
  const hasAutoFocused = React.useRef(false);
  React.useEffect(() => {
    if (isOpen && panelRef.current && !hasAutoFocused.current) {
      hasAutoFocused.current = true;
      // Prefer the Track section's "Add effect" button — that's the
      // canonical action when the user opens the panel (typically via
      // the E shortcut). Falls back to the close button if the panel
      // is rendered without an add button (e.g. label tracks), and
      // finally to the panel container itself.
      const addBtn = panelRef.current.querySelector<HTMLElement>(
        '.effects-stack-header__add-button',
      );
      const closeBtn = panelRef.current.querySelector<HTMLElement>(
        '.effects-panel-header__close-button',
      );
      setTimeout(() => {
        const target = addBtn ?? closeBtn ?? panelRef.current;
        target?.focus({ preventScroll: true });
      }, 0);
    }
    if (!isOpen) {
      hasAutoFocused.current = false;
    }
  }, [isOpen]);

  // Don't render if not open
  if (!isOpen) return null;

  const content = (
    <>
      {/* Header */}
      <EffectsPanelHeader
        title="Effects"
        onClose={onClose}
      />

      {/* Body container */}
      <div ref={contentRef} className="effects-panel__content">
        {/* Track Effects Section */}
        {trackSection && (
          <div className="effects-panel__track-section" style={{ flex: 1, minHeight: 0 }}>
            <TrackEffectsSection {...trackSection} />
          </div>
        )}

        {/* Vertical resize handle */}
        {trackSection && masterSection && (
          <div
            className={`effects-panel__vertical-resize-handle ${isResizingVertical ? 'effects-panel__vertical-resize-handle--active' : ''}`}
            onMouseDown={handleVerticalResizeStart}
          />
        )}

        {/* Master Effects Section */}
        {masterSection && (
          <div className="effects-panel__master-section" style={{ height: masterSectionHeight, minHeight: 140, flexShrink: 0 }}>
            <MasterEffectsSection {...masterSection} />
          </div>
        )}
      </div>
    </>
  );

  // Overlay mode - absolute positioned panel
  if (mode === 'overlay') {
    return (
      <div
        ref={panelRef}
        className={`effects-panel effects-panel--overlay effects-panel__focusable-container ${className}`}
        style={{
          ...style,
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: width ? `${width}px` : `${minWidth}px`,
          height: height ? `${height}px` : 'auto',
          zIndex: 1000,
        }}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onFocus={tabGroup.onFocus}
        onBlur={tabGroup.onBlur}
        onClickCapture={tabGroup.onClickCapture}
        role="region"
        aria-label="Effects panel"
      >
        {content}
      </div>
    );
  }

  // Sidebar mode - uses SidePanel wrapper
  return (
    <SidePanel
      position="left"
      width={240}
      resizable={resizable}
      minWidth={minWidth}
      maxWidth={maxWidth}
      onResize={onResize}
      className={`effects-panel ${className}`}
      style={style}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onFocus={tabGroup.onFocus}
        onBlur={tabGroup.onBlur}
        onClickCapture={tabGroup.onClickCapture}
        role="region"
        aria-label="Effects panel"
        className="effects-panel__focusable-container"
      >
        {content}
      </div>
    </SidePanel>
  );
};

export default EffectsPanel;
