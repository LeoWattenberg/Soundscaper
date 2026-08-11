/**
 * TimeSelectionCanvasOverlay
 *
 * Visual overlay that displays the time selection range over canvas/tracks.
 * Renders as a semi-transparent box over the selected time range and tracks.
 */

import React from 'react';
import { TimeSelection } from '@audacity-ui/core';
import './TimeSelectionCanvasOverlay.css';

export interface TimeSelectionCanvasOverlayProps {
  /**
   * Time selection to display (null = no selection)
   */
  timeSelection: TimeSelection | null;
  /**
   * Pixels per second - zoom level
   */
  pixelsPerSecond: number;
  /**
   * Left padding before timeline starts (in pixels)
   */
  leftPadding: number;
  /**
   * Y position where overlay should start (top of first selected track)
   */
  top: number;
  /**
   * Height of the overlay (spans selected tracks)
   */
  height: number;
  /**
   * Background color of the selection overlay
   * @default 'rgba(255, 255, 255, 0.15)'
   */
  backgroundColor?: string;
  /**
   * Border color of the selection
   * @default '#80ccc0'
   */
  borderColor?: string;
  /**
   * CSS mix-blend-mode for the overlay
   * @default 'soft-light'
   */
  mixBlendMode?: string;
  /**
   * Additional CSS class names
   */
  className?: string;
}

export const TimeSelectionCanvasOverlay: React.FC<TimeSelectionCanvasOverlayProps> = ({
  timeSelection,
  pixelsPerSecond,
  leftPadding,
  top,
  height,
  backgroundColor = 'rgba(255, 255, 255, 0.15)',
  borderColor = '#80ccc0',
  mixBlendMode = 'soft-light',
  className = '',
}) => {
  if (!timeSelection) {
    return null;
  }

  const { startTime, endTime } = timeSelection;

  // Convert times to pixel positions
  const startX = startTime * pixelsPerSecond + leftPadding;
  const endX = endTime * pixelsPerSecond + leftPadding;
  const width = endX - startX;

  return (
    <div
      className={`time-selection-canvas-overlay ${className}`}
      style={{
        position: 'absolute',
        left: `${startX}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor,
        pointerEvents: 'none', // Allow clicks to pass through
        zIndex: 5, // Above tracks but below UI controls
        mixBlendMode: mixBlendMode as any, // Blend mode for overlay (use 'normal' for no blending)
      }}
    />
  );
};

export default TimeSelectionCanvasOverlay;
