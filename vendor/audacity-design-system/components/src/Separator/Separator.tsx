import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Separator.css';

export interface SeparatorProps {
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Separator: React.FC<SeparatorProps> = ({ className = '' }) => {
  const { theme } = useTheme();

  const style = {
    '--separator-color': theme.border.divider,
  } as React.CSSProperties;

  return (
    <div className={`separator ${className}`} role="separator" style={style} />
  );
};

export default Separator;
