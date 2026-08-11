import React, { useState } from 'react';
import { EFFECT_REGISTRY } from '@audacity-ui/core';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import './MixerEffect.css';

export interface MixerEffectProps {
  /**
   * Effect name to display. When empty/undefined, the slot is considered empty.
   */
  effectName?: string;
  /**
   * Whether the effect is enabled (active). Only relevant when populated.
   * @default false
   */
  enabled?: boolean;
  /**
   * Called when the power/enable button is clicked
   */
  onToggle?: () => void;
  /**
   * Called when the dropdown button is clicked on an empty slot (legacy, unused if onAddEffect provided)
   */
  onDropdownClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Track color applied to enabled effect chips (any CSS color)
   */
  trackColor?: string;
  /**
   * Called when "Remove effect" is selected from the dropdown menu
   */
  onRemoveEffect?: () => void;
  /**
   * Called when a different effect is selected from the dropdown menu
   */
  onReplaceEffect?: (effectName: string) => void;
  /**
   * Called when the effect name area is clicked
   */
  onClick?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * MixerEffect - An effect slot for the mixer channel strip.
 *
 * Shows the assigned effect name with power and dropdown buttons on hover.
 * When empty, shows a blank input that reveals a dropdown on hover.
 * When populated, the dropdown opens a context menu with Remove + Replace options.
 */
export const MixerEffect: React.FC<MixerEffectProps> = ({
  effectName,
  enabled = false,
  onToggle,
  trackColor,
  onDropdownClick,
  onRemoveEffect,
  onReplaceEffect,
  onClick,
  className = '',
}) => {
  const { theme } = useTheme();
  const populated = !!effectName;

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  const style = {
    '--me-bg': theme.background.control.input.idle,
    '--me-border': theme.border.input.idle,
    '--me-hover-border': theme.border.input.hover,
    '--me-text': theme.foreground.text.primary,
    '--me-active-bg': trackColor ?? 'rgba(103, 124, 228, 0.5)',
    '--me-active-border': theme.border.input.hover,
    '--me-active-text': theme.foreground.text.contrastPrimary,
    '--me-icon': theme.foreground.icon.primary,
    '--me-icon-contrast': theme.foreground.icon.inverse,
  } as React.CSSProperties;

  const classes = [
    'mixer-effect',
    !populated && 'mixer-effect--empty',
    populated && enabled && 'mixer-effect--enabled',
    className,
  ].filter(Boolean).join(' ');

  const iconColor = populated && enabled
    ? theme.foreground.icon.inverse
    : theme.foreground.icon.primary;

  const handleDropdownClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (populated) {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPosition({ x: rect.right + 4, y: rect.top });
      setMenuOpen(true);
    } else {
      onDropdownClick?.(e);
    }
  };

  return (
    <div className={classes} style={style}>
      {populated && (
        <button
          className="mixer-effect__power"
          onClick={onToggle}
          aria-label={enabled ? 'Disable effect' : 'Enable effect'}
          aria-pressed={enabled}
        >
          <Icon name="power" size={16} color={iconColor} />
        </button>
      )}

      <div
        className="mixer-effect__name"
        onClick={onClick}
        role={populated ? 'button' : undefined}
      >
        {effectName ?? ''}
      </div>

      <button
        className="mixer-effect__dropdown"
        onClick={handleDropdownClick}
        aria-label="Select effect"
      >
        <Icon name="caret-down" size={16} color={iconColor} />
      </button>

      {populated && (
        <ContextMenu
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
          x={menuPosition.x}
          y={menuPosition.y}
        >
          <ContextMenuItem
            label="Remove effect"
            onClick={() => {
              onRemoveEffect?.();
              setMenuOpen(false);
            }}
          />
          <ContextMenuItem isDivider />
          {Object.entries(EFFECT_REGISTRY).map(([categoryName, effectDefs]) => (
            <ContextMenuItem
              key={categoryName}
              label={categoryName}
            >
              {effectDefs.map((effectDef) => (
                <ContextMenuItem
                  key={effectDef.id}
                  label={effectDef.name}
                  checked={effectDef.name === effectName}
                  onClick={() => {
                    onReplaceEffect?.(effectDef.name);
                    setMenuOpen(false);
                  }}
                />
              ))}
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
    </div>
  );
};

export default MixerEffect;
