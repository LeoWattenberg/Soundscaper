/**
 * SpectralSelectionOverlay - Container component for spectral selection rendering
 *
 * This component handles mouse interaction tracking and delegates rendering
 * to the pure SpectralSelectionCanvas component.
 */

import React, { useRef, useState } from 'react';
import { SpectralSelectionCanvas } from './SpectralSelectionCanvas';
import { SpectralSelection } from './types';
import { CoordinateConfig, isHoveringCenterLine as checkHoveringCenterLine, getSelectionBounds } from './utils';
import './SpectralSelectionOverlay.css';

export interface SpectralSelectionOverlayProps {
  /**
   * Spectral selection data
   */
  spectralSelection: SpectralSelection | null;
  /**
   * Pixels per second (zoom level)
   */
  pixelsPerSecond: number;
  /**
   * Track heights array
   */
  trackHeights: number[];
  /**
   * Track gap in pixels
   */
  trackGap: number;
  /**
   * Initial gap from top
   */
  initialGap: number;
  /**
   * Clip header height
   */
  clipHeaderHeight?: number;
  /**
   * Track clips data (to find clip positions)
   */
  tracks: Array<{
    id?: number;
    name?: string;
    height?: number;
    viewMode?: 'waveform' | 'spectrogram' | 'split';
    channelSplitRatio?: number;
    clips: Array<{
      id: number | string;
      start: number;
      duration: number;
    }>;
  }>;
  /**
   * Whether the selection is being dragged
   */
  isDragging?: boolean;
  /**
   * Whether we're actively creating a new selection (marquee in progress)
   */
  isCreating?: boolean;
}

/**
 * SpectralSelectionOverlay - Renders a frequency-range selection marquee
 * with dashed borders, corner handles, and hover effects
 */
export function SpectralSelectionOverlay({
  spectralSelection,
  pixelsPerSecond,
  trackHeights,
  trackGap,
  initialGap,
  clipHeaderHeight = 20,
  tracks,
  isDragging = false,
  isCreating = false,
}: SpectralSelectionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Handle mouse move to track position for hover effect
  // PERFORMANCE: Skip hover tracking during drag to prevent expensive re-renders
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging || isCreating) return; // Skip during drag for performance

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  if (!spectralSelection) return null;

  // Calculate if hovering over center line
  const coordinateConfig: CoordinateConfig = {
    pixelsPerSecond,
    trackHeights,
    trackGap,
    initialGap,
    clipHeaderHeight,
    tracks, // Include tracks for split view detection
  };

  const bounds = getSelectionBounds(
    spectralSelection.startTime,
    spectralSelection.endTime,
    spectralSelection.minFrequency,
    spectralSelection.maxFrequency,
    spectralSelection.trackIndex,
    coordinateConfig
  );

  const isHovering = mousePos
    ? checkHoveringCenterLine(mousePos.x, mousePos.y, bounds)
    : false;

  // Canvas size should cover the entire track area
  const totalHeight = trackHeights.reduce((sum, h) => sum + h, 0) + initialGap + trackGap * (trackHeights.length - 1);
  const totalWidth = 5000; // Should match canvas width

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="spectral-selection-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: totalWidth,
        height: totalHeight,
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    >
      <SpectralSelectionCanvas
        selection={spectralSelection}
        tracks={tracks}
        coordinateConfig={coordinateConfig}
        width={totalWidth}
        height={totalHeight}
        isHoveringCenterLine={isHovering}
        isDragging={isDragging}
        isCreating={isCreating}
      />
    </div>
  );
}

export default SpectralSelectionOverlay;
