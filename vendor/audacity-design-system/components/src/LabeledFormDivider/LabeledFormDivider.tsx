/**
 * LabeledFormDivider - Horizontal divider with centered label text
 * Based on Figma design: node-id=10123-3633
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './LabeledFormDivider.css';

export interface LabeledFormDividerProps {
  /**
   * Label text to display in the center
   */
  label: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * LabeledFormDivider component - Divider with centered label
 */
export function LabeledFormDivider({
  label,
  className = '',
}: LabeledFormDividerProps) {
  const { theme } = useTheme();

  const style = {
    '--divider-line-color': theme.border.divider,
    '--divider-label-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div className={`labeled-form-divider ${className}`} style={style}>
      <div className="labeled-form-divider__line" />
      <span className="labeled-form-divider__label">{label}</span>
      <div className="labeled-form-divider__line" />
    </div>
  );
}

export default LabeledFormDivider;
