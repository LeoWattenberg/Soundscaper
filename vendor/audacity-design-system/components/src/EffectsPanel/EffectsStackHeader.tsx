import React from 'react';
import { ToggleButton } from '../ToggleButton';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { GhostButton } from '../GhostButton';
import { useTheme } from '../ThemeProvider';
import './EffectsStackHeader.css';

export interface EffectsStackHeaderProps {
  /**
   * Track or section name
   */
  name: string;

  /**
   * Whether all effects in this stack are enabled
   */
  allEnabled: boolean;

  /**
   * Called when the toggle all button is clicked
   */
  onToggleAll?: (enabled: boolean) => void;

  /**
   * Called when the context menu button is clicked
   */
  onContextMenu?: (event: React.MouseEvent) => void;

  /**
   * Called when the header's "Effects" / add button is clicked. When provided
   * the header renders an inline button on the right edge (the standalone
   * "Add effect" button at the bottom of the section is removed).
   */
  onAddEffect?: (event: React.MouseEvent) => void;

  /**
   * Label for the inline add button.
   * @default 'Effects'
   */
  addButtonLabel?: string;

  /**
   * Whether this is a master track header
   */
  isMaster?: boolean;

  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * EffectsStackHeader - Header for a track or master effects stack
 * Shows the track name, toggle all button, and context menu
 */
export const EffectsStackHeader: React.FC<EffectsStackHeaderProps> = ({
  name,
  allEnabled,
  onToggleAll,
  onContextMenu,
  onAddEffect,
  addButtonLabel = 'Effects',
  isMaster = false,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--esh-bg': theme.background.surface.default,
    '--esh-border': theme.border.default,
    '--esh-text-color': theme.foreground.text.primary,
    '--esh-toggle-bg': theme.background.control.button.secondary.idle,
    '--esh-toggle-hover-bg': theme.background.control.button.secondary.hover,
    '--esh-toggle-active-bg': theme.background.control.button.primary.active,
    '--esh-toggle-icon-color': theme.foreground.icon.primary,
    '--esh-toggle-active-icon-color': theme.foreground.text.inverse,
  } as React.CSSProperties;

  return (
    <div
      className={`effects-stack-header ${isMaster ? 'effects-stack-header--master' : ''} ${className}`}
      style={style}
    >
      <div className="effects-stack-header__content">
        {/* Toggle all button */}
        <ToggleButton
          icon="power"
          iconSize={14}
          active={allEnabled}
          onClick={() => onToggleAll?.(!allEnabled)}
          ariaLabel={allEnabled ? `Disable all ${isMaster ? 'master' : 'track'} effects` : `Enable all ${isMaster ? 'master' : 'track'} effects`}
          size={24}
          activeColor={theme.accent.primary}
        />

        {/* Track name */}
        <div className="effects-stack-header__name">
          {name}
        </div>
      </div>

      {/* Inline add-effect button on the right, mirroring "Add new" in
          TrackControlSidePanel's header. */}
      {onAddEffect && (
        <Button
          variant="secondary"
          size="default"
          onClick={(e) => e && onAddEffect(e)}
          showIcon={true}
          icon={<Icon name="plus" size={14} />}
          className="effects-stack-header__add-button"
        >
          {addButtonLabel}
        </Button>
      )}
      {onContextMenu && (
        <GhostButton
          icon="menu"
          size="small"
          onClick={onContextMenu}
          ariaLabel="Effect stack options"
          className="effects-stack-header__menu-button"
        />
      )}
    </div>
  );
};

export default EffectsStackHeader;
