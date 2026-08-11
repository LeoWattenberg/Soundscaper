import React from 'react';
import { GhostButton } from '../GhostButton';
import { useTheme } from '../ThemeProvider';
import './EffectsPanelHeader.css';

export interface EffectsPanelHeaderProps {
  /**
   * Header title text
   */
  title?: string;

  /**
   * Called when close button is clicked
   */
  onClose?: () => void;

  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * EffectsPanelHeader - Header component for the Effects panel
 * Displays the panel title and close button
 */
export const EffectsPanelHeader: React.FC<EffectsPanelHeaderProps> = ({
  title = 'Effects',
  onClose,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--eph-bg': theme.background.surface.default,
    '--eph-border': theme.border.default,
    '--eph-text-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div
      className={`effects-panel-header ${className}`}
      style={style}
    >
      <div className="effects-panel-header__content">
        <h2 className="effects-panel-header__title">{title}</h2>
      </div>

      <GhostButton
        icon="close"
        size="small"
        onClick={onClose}
        ariaLabel="Close effects panel"
        className="effects-panel-header__close-button"
      />
    </div>
  );
};

export default EffectsPanelHeader;
