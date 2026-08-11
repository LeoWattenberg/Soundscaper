import React, { useState } from 'react';
import { Icon } from '../Icon';
import { ToggleButton } from '../ToggleButton';
import { useTheme } from '../ThemeProvider';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import { EFFECT_REGISTRY } from '@audacity-ui/core';
import './EffectSlot.css';

export interface EffectSlotProps {
  /**
   * Effect name
   */
  effectName?: string;

  /**
   * Whether the effect is enabled
   */
  enabled?: boolean;

  /**
   * Called when the enable/disable button is clicked
   */
  onToggle?: (enabled: boolean) => void;

  /**
   * Called when the effect name field is clicked (to select effect)
   */
  onSelectEffect?: () => void;

  /**
   * Called when the settings dropdown is clicked
   */
  onShowSettings?: () => void;

  /**
   * Called when remove effect is clicked
   */
  onRemoveEffect?: () => void;

  /**
   * Called when a different effect is selected from the menu
   */
  onReplaceEffect?: (effectName: string) => void;

  /**
   * Optional list of effects the user has purchased from MuseHub this
   * session — grouped by vendor and rendered after the built-in categories
   * so power users can swap to a paid plugin without going through the
   * marketplace modal.
   */
  purchasedEffects?: Array<{ id: string; name: string; vendor: string }>;

  /**
   * Plugin IDs disabled in the Plugin Manager — those effects are omitted
   * from the caret menu so the slot can't be set to a disabled plugin.
   */
  disabledPluginIds?: Set<string>;

  /**
   * Called when "Change effect…" is picked from the slot context menu — the
   * host opens the marketplace modal so the same browse/replace flow is used.
   * Receives the slot's bounding rect so the modal can anchor next to it.
   */
  onChangeEffect?: (anchor: DOMRect | null) => void;

  /**
   * Whether this slot is being dragged
   */
  isDragging?: boolean;

  /**
   * Called when drag starts
   */
  onDragStart?: (e: React.DragEvent) => void;

  /**
   * Called during drag over
   */
  onDragOver?: (e: React.DragEvent) => void;

  /**
   * Called when dropped
   */
  onDrop?: (e: React.DragEvent) => void;

  /**
   * Called when drag ends
   */
  onDragEnd?: (e: React.DragEvent) => void;

  /**
   * Additional CSS class names
   */
  className?: string;

  /**
   * Inline styles (for animations)
   */
  style?: React.CSSProperties;

  /**
   * Custom active color for the toggle button (e.g., orange for master effects)
   */
  activeColor?: string;

  /**
   * Called when Cmd+Up/Down is pressed to reorder this slot.
   * direction: -1 for up, +1 for down.
   */
  onReorder?: (direction: -1 | 1) => void;
}

/**
 * EffectSlot - A draggable effect slot with toggle, name, and settings
 * Used in the effects panel stack for both track and master effects
 */
export const EffectSlot: React.FC<EffectSlotProps> = ({
  effectName = 'Effect name',
  enabled = true,
  onToggle,
  onSelectEffect,
  onChangeEffect,
  onShowSettings,
  onRemoveEffect,
  onReplaceEffect,
  purchasedEffects,
  disabledPluginIds,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  className = '',
  style: customStyle,
  activeColor,
  onReorder,
}) => {
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isNavigatingInside, setIsNavigatingInside] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const slotRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);

  const handleSettingsClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right + 4, y: rect.top });
    setMenuOpen(true);
    onShowSettings?.();
  };

  // Manage tabIndex on internal focusable elements
  React.useEffect(() => {
    if (!slotRef.current) return;
    const focusables = slotRef.current.querySelectorAll<HTMLElement>(
      'button, input, select, [role="button"]'
    );
    focusables.forEach((el) => {
      el.tabIndex = isNavigatingInside ? 0 : -1;
    });
  }, [isNavigatingInside, effectName, enabled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isSlotFocused = document.activeElement === slotRef.current;

    if (!isNavigatingInside && isSlotFocused) {
      // Cmd+Up/Down reorders the slot (only when focused on the row itself)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (onReorder) {
          e.preventDefault();
          e.stopPropagation();
          onReorder(e.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingInside(true);
        // Focus first internal control after state update
        setTimeout(() => {
          const dragHandle = slotRef.current?.querySelector<HTMLElement>('.effect-slot__drag-handle');
          if (dragHandle) {
            dragHandle.focus();
          } else {
            const first = slotRef.current?.querySelector<HTMLElement>('button, input, select');
            first?.focus();
          }
        }, 0);
        return;
      }
    } else if (isNavigatingInside) {
      // Move mode: Enter on drag handle activates, Up/Down reorders, Enter/Escape exits
      if (isMoving) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          onReorder?.(e.key === 'ArrowUp' ? -1 : 1);
          return;
        }
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          setIsMoving(false);
          return;
        }
        // Block all other keys while in move mode
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Enter on drag handle enters move mode
      if (e.key === 'Enter' && document.activeElement === dragHandleRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setIsMoving(true);
        return;
      }

      // Arrow keys cycle between controls within this slot
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const focusables = Array.from(
          slotRef.current?.querySelectorAll<HTMLElement>(
            'button:not([tabindex="-1"]), input:not([tabindex="-1"]), [tabindex="0"]'
          ) ?? []
        );
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        if (idx === -1) return;
        const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        let next = forward ? idx + 1 : idx - 1;
        if (next >= focusables.length) next = 0;
        if (next < 0) next = focusables.length - 1;
        focusables[next].focus();
        return;
      }

      // Escape returns to the slot row
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingInside(false);
        setIsMoving(false);
        slotRef.current?.focus();
        return;
      }

      // Tab exits the slot — let the panel's container tab group handle it
      if (e.key === 'Tab') {
        setIsNavigatingInside(false);
        setIsMoving(false);
        return;
      }
    }
  };

  const handleFocus = (e: React.FocusEvent) => {
    // If a child receives focus (not the slot row itself), enter navigation mode
    // This handles focus restoration from dialogs landing on a child element
    if (e.target !== slotRef.current && slotRef.current?.contains(e.target as Node)) {
      if (!isNavigatingInside) {
        setIsNavigatingInside(true);
      }
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // If focus leaves the slot entirely, exit navigation mode
    if (!slotRef.current?.contains(e.relatedTarget as Node)) {
      setIsNavigatingInside(false);
      setIsMoving(false);
    }
  };

  const themeStyle = {
    '--es-drag-handle-color': theme.foreground.icon.primary,
    '--es-toggle-bg': theme.background.control.button.secondary.idle,
    '--es-toggle-hover-bg': theme.background.control.button.secondary.hover,
    '--es-toggle-active-bg': theme.background.control.button.primary.active,
    '--es-toggle-icon-color': theme.foreground.icon.primary,
    '--es-toggle-active-icon-color': theme.foreground.text.inverse,
    '--es-input-bg': theme.background.control.input.idle,
    '--es-input-border': theme.border.input.idle,
    '--es-input-hover-border': theme.border.input.hover,
    '--es-text-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div
      ref={slotRef}
      className={`effect-slot ${isDragging ? 'effect-slot--dragging' : ''} ${className}`}
      style={{ ...themeStyle, ...customStyle }}
      tabIndex={-1}
      role="group"
      aria-label={effectName}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Drag handle */}
      <div
        ref={dragHandleRef}
        className={`effect-slot__drag-handle ${isMoving ? 'effect-slot__drag-handle--moving' : ''}`}
        tabIndex={-1}
        role="button"
        aria-label={isMoving ? 'Moving effect — use Up/Down arrows, Escape to stop' : 'Press Enter to reorder effect'}
      >
        <Icon name="gripper" size={16} />
      </div>

      <div className="effect-slot__content">
        {/* Toggle button */}
        <ToggleButton
          icon="power"
          iconSize={14}
          active={enabled}
          onClick={() => onToggle?.(!enabled)}
          ariaLabel={enabled ? 'Disable effect' : 'Enable effect'}
          size={24}
          activeColor={activeColor || theme.accent.primary}
        />

        {/* Effect name field */}
        <button
          className="effect-slot__name-field"
          onClick={onSelectEffect}
          aria-label="Select effect"
        >
          <span className="effect-slot__name-text">{effectName}</span>
        </button>

        {/* Settings dropdown button */}
        <button
          className="effect-slot__settings-button"
          onClick={handleSettingsClick}
          aria-label="Effect settings"
        >
          <Icon name="caret-down" size={16} />
        </button>
      </div>

      {/* Context menu — category submenus pick from installed effects in one
          click; "Get effects…" hands off to the MuseHub marketplace for
          anything else; "Remove effect" tears the slot down. */}
      <ContextMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        x={menuPosition.x}
        y={menuPosition.y}
      >
        {Object.entries(EFFECT_REGISTRY).map(([category, effects]) => {
          const enabled = effects.filter((e) => !disabledPluginIds || !disabledPluginIds.has(e.id));
          if (enabled.length === 0) return null;
          return (
            <ContextMenuItem key={category} label={category} hasSubmenu>
              {enabled.map((effect) => (
                <ContextMenuItem
                  key={effect.id}
                  label={effect.name}
                  onClick={() => {
                    onReplaceEffect?.(effect.name);
                    setMenuOpen(false);
                  }}
                />
              ))}
            </ContextMenuItem>
          );
        })}
        {/* MuseHub purchases — grouped by vendor and rendered after the
            built-in categories so the plugin manager is the same surface
            wherever the user got the effect from. */}
        {(() => {
          if (!purchasedEffects || purchasedEffects.length === 0) return null;
          const visible = purchasedEffects.filter(
            (e) => !disabledPluginIds || !disabledPluginIds.has(e.id),
          );
          if (visible.length === 0) return null;
          const byVendor = new Map<string, typeof visible>();
          for (const e of visible) {
            const list = byVendor.get(e.vendor) ?? [];
            list.push(e);
            byVendor.set(e.vendor, list);
          }
          return Array.from(byVendor.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([vendor, effects]) => (
              <ContextMenuItem key={vendor} label={vendor} hasSubmenu>
                {effects.map((effect) => (
                  <ContextMenuItem
                    key={effect.id}
                    label={effect.name}
                    onClick={() => {
                      onReplaceEffect?.(effect.name);
                      setMenuOpen(false);
                    }}
                  />
                ))}
              </ContextMenuItem>
            ));
        })()}
        <ContextMenuItem isDivider />
        <ContextMenuItem
          label="Get effects…"
          onClick={() => {
            // Anchor the marketplace modal next to this slot so the user
            // stays oriented to the row they're replacing.
            const slotEl = (slotRef.current as HTMLElement | null);
            const anchor = slotEl ? slotEl.getBoundingClientRect() : null;
            onChangeEffect?.(anchor);
            setMenuOpen(false);
          }}
        />
        <ContextMenuItem isDivider />
        <ContextMenuItem
          label="Remove effect"
          onClick={() => {
            onRemoveEffect?.();
            setMenuOpen(false);
          }}
        />
      </ContextMenu>
    </div>
  );
};

export default EffectSlot;
