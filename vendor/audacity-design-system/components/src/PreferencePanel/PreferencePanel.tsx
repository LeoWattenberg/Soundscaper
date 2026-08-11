import React from 'react';
import { useTheme } from '../ThemeProvider';
import './PreferencePanel.css';

export interface PreferencePanelProps {
  /**
   * Title text for the panel
   */
  title?: string;
  /**
   * Child content (typically radio buttons or other form elements)
   */
  children: React.ReactNode;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const PreferencePanel: React.FC<PreferencePanelProps> = ({
  title,
  children,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--preference-panel-bg': theme.background.surface.elevated,
    '--preference-panel-border': theme.border.default,
    '--preference-panel-title-text': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div className={`preference-panel ${className}`} style={style}>
      {title && <h4 className="preference-panel__title">{title}</h4>}
      <div className="preference-panel__content">
        {children}
      </div>
    </div>
  );
};

export default PreferencePanel;
