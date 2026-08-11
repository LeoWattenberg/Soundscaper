/**
 * ProgressBar Component
 *
 * A horizontal progress indicator showing completion percentage
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './ProgressBar.css';

export interface ProgressBarProps {
  /**
   * Progress value as a percentage (0-100)
   */
  value?: number;
  /**
   * Width of the progress bar
   */
  width?: number | string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * ProgressBar - Shows progress as a filled horizontal bar
 */
export function ProgressBar({
  value = 0,
  width = 220,
  className = '',
}: ProgressBarProps) {
  const { theme } = useTheme();

  // Clamp value between 0 and 100
  const clampedValue = Math.min(Math.max(value, 0), 100);

  const widthStyle = typeof width === 'number' ? `${width}px` : width;

  const style = {
    '--progress-bar-bg': theme.background.control.slider.track,
    '--progress-bar-fill': theme.border.focus,
  } as React.CSSProperties;

  return (
    <div
      className={`progress-bar ${className}`}
      style={{ width: widthStyle, ...style }}
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="progress-bar__fill"
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  );
}

export default ProgressBar;
