/**
 * Spinner Component
 *
 * Loading spinner with rotating arc animation
 * - Uses theme colors for accent and gauge
 * - 48px default size
 * - Smooth rotation animation
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Spinner.css';

export interface SpinnerProps {
  /**
   * Size of the spinner in pixels
   * @default 48
   */
  size?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Spinner - Animated loading indicator
 */
export function Spinner({ size = 48, className = '' }: SpinnerProps) {
  const { theme } = useTheme();
  const accentColor = theme.accent.primary;
  const gaugeColor = theme.background.control.panKnob.gauge;

  // Calculate circle dimensions based on size
  const center = size / 2;
  const radius = (size / 48) * 18; // Scale radius proportionally
  const strokeWidth = (size / 48) * 4; // Scale stroke width proportionally
  const circumference = 2 * Math.PI * radius;
  const dashLength = circumference * 0.25; // 25% of circumference
  const gapLength = circumference - dashLength;

  return (
    <div className={`spinner ${className}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
        {/* Background arc (light) */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke={gaugeColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated foreground arc (solid) */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke={accentColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dashLength} ${gapLength}`}
          transform={`rotate(0 ${center} ${center})`}
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${center} ${center}`}
            to={`360 ${center} ${center}`}
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  );
}

export default Spinner;
