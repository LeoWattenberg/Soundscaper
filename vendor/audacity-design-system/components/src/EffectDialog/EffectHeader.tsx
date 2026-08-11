import React from 'react';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import { ToggleButton } from '../ToggleButton';
import { Dropdown } from '../Dropdown';
import './EffectHeader.css';

export interface EffectHeaderProps {
  /**
   * Whether this is a destructive effect (hides automation toggle)
   */
  isDestructive?: boolean;

  /**
   * Whether automation is enabled (for non-destructive effects)
   */
  automationEnabled?: boolean;

  /**
   * Called when automation toggle is clicked
   */
  onToggleAutomation?: (enabled: boolean) => void;

  /**
   * Current preset name
   */
  presetName?: string;

  /**
   * Available presets
   */
  presets?: string[];

  /**
   * Called when preset is changed
   */
  onPresetChange?: (preset: string) => void;

  /**
   * Called when save preset is clicked
   */
  onSavePreset?: () => void;

  /**
   * Called when undo is clicked
   */
  onUndo?: () => void;

  /**
   * Whether undo is available
   */
  canUndo?: boolean;

  /**
   * Called when delete preset is clicked
   */
  onDeletePreset?: () => void;

  /**
   * Whether delete is available
   */
  canDelete?: boolean;

  /**
   * Called when more options is clicked
   */
  onMoreOptions?: (e: React.MouseEvent) => void;

  /**
   * Additional CSS class
   */
  className?: string;
}

/**
 * EffectHeader - Header bar for effect dialogs with automation toggle, preset dropdown, and action buttons
 */
export const EffectHeader: React.FC<EffectHeaderProps> = ({
  isDestructive = false,
  automationEnabled = false,
  onToggleAutomation,
  presetName = 'Default preset',
  presets = ['Default preset', 'Preset 1', 'Preset 2'],
  onPresetChange,
  onSavePreset,
  onUndo,
  canUndo = false,
  onDeletePreset,
  canDelete = false,
  onMoreOptions,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--effect-header-bg': theme.background.surface.default,
    '--effect-header-border': theme.border.default,
    '--effect-header-button-bg': theme.background.control.button.secondary.idle,
    '--effect-header-button-hover-bg': theme.background.control.button.secondary.hover,
    '--effect-header-automation-bg': theme.background.control.button.primary.idle,
    '--effect-header-automation-active-bg': theme.background.control.button.primary.active,
  } as React.CSSProperties;

  return (
    <div className={`effect-header ${className}`} style={style}>
      <div className="effect-header__left">
        {/* Automation toggle - only for non-destructive effects */}
        {!isDestructive && (
          <ToggleButton
            icon="power"
            iconSize={16}
            active={automationEnabled}
            onClick={() => onToggleAutomation?.(!automationEnabled)}
            ariaLabel={automationEnabled ? 'Disable automation' : 'Enable automation'}
            size={28}
          />
        )}

        {/* Preset dropdown */}
        <div className="effect-header__preset">
          <Dropdown
            value={presetName}
            options={presets.map(p => ({ value: p, label: p }))}
            onChange={(value) => onPresetChange?.(value)}
            placeholder="Select preset"
          />
        </div>
      </div>

      <div className="effect-header__right">
        {/* Save preset button */}
        <button
          className="effect-header__icon-button"
          onClick={onSavePreset}
          aria-label="Save preset"
          title="Save preset"
        >
          <Icon name="save" size={16} />
        </button>

        {/* Undo button */}
        <button
          className="effect-header__icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo"
        >
          <Icon name="undo" size={16} />
        </button>

        {/* Delete preset button */}
        <button
          className="effect-header__icon-button"
          onClick={onDeletePreset}
          disabled={!canDelete}
          aria-label="Delete preset"
          title="Delete preset"
        >
          <Icon name="trash" size={16} />
        </button>

        {/* More options button */}
        <button
          className="effect-header__icon-button"
          onClick={onMoreOptions}
          aria-label="More options"
          title="More options"
        >
          <Icon name="menu" size={16} />
        </button>
      </div>
    </div>
  );
};

export default EffectHeader;
