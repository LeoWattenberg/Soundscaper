import React from 'react';
import { useTheme } from '../ThemeProvider';
import './MixerFaderHandle.css';

export interface MixerFaderHandleProps {
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Inline styles (used by parent fader for positioning)
   */
  style?: React.CSSProperties;
}

/**
 * MixerFaderHandle - The draggable handle for a mixer fader/slider
 *
 * A 16×32px handle with a centered horizontal indicator line.
 * Designed to be positioned by a parent fader component.
 */
export const MixerFaderHandle: React.FC<MixerFaderHandleProps> = ({
  className = '',
  style: externalStyle,
}) => {
  const { theme } = useTheme();

  const style = {
    '--handle-bg': theme.background.control.slider.handle.background,
    '--handle-border': theme.background.control.slider.handle.border,
    '--handle-indicator': theme.foreground.text.primary,
    ...externalStyle,
  } as React.CSSProperties;

  return (
    <div
      className={`mixer-fader-handle ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div className="mixer-fader-handle__indicator" />
    </div>
  );
};

export default MixerFaderHandle;
