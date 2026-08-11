import React, { useRef, useEffect, useState } from 'react';
import './SpectralSelectionOverlay.css';

interface SpectralSelection {
  trackIndex: number;
  clipId: number | string;
  startTime: number;
  endTime: number;
  minFrequency: number; // 0-1 (normalized, 0 = bottom, 1 = top)
  maxFrequency: number; // 0-1 (normalized)
}

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
   * Left padding in pixels
   */
  leftPadding: number;
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
    clips: Array<{
      id: number | string;
      start: number;
      duration: number;
    }>;
  }>;
}

/**
 * SpectralSelectionOverlay - Renders a frequency-range selection marquee
 * with dashed borders, corner handles, and overlays
 */
export function SpectralSelectionOverlay({
  spectralSelection,
  pixelsPerSecond,
  leftPadding,
  trackHeights,
  trackGap,
  initialGap,
  clipHeaderHeight = 20,
  tracks,
}: SpectralSelectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const EDGE_THRESHOLD = 6;

  // Handle mouse move to track position for hover effect
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectralSelection) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { trackIndex, clipId, startTime, endTime, minFrequency, maxFrequency } = spectralSelection;

    // Find the clip
    if (trackIndex >= tracks.length) return;
    const track = tracks[trackIndex];
    const clip = track.clips.find(c => c.id === clipId);
    if (!clip) return;

    // Calculate track Y position
    let trackY = initialGap;
    for (let i = 0; i < trackIndex; i++) {
      trackY += trackHeights[i] + trackGap;
    }

    const trackHeight = trackHeights[trackIndex];
    const clipBodyHeight = trackHeight - clipHeaderHeight;

    // Calculate X positions
    const clipStartX = clip.start * pixelsPerSecond + leftPadding;
    const selectionStartX = startTime * pixelsPerSecond + leftPadding;
    const selectionEndX = endTime * pixelsPerSecond + leftPadding;
    const selectionWidth = selectionEndX - selectionStartX;

    // Calculate Y positions (inverted: 0 = bottom, 1 = top in frequency space)
    const selectionTopY = trackY + clipHeaderHeight + (1 - maxFrequency) * clipBodyHeight;
    const selectionBottomY = trackY + clipHeaderHeight + (1 - minFrequency) * clipBodyHeight;
    const selectionHeight = selectionBottomY - selectionTopY;

    // Draw darker overlay above the selection (within clip bounds)
    if (maxFrequency < 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const overlayTopY = trackY + clipHeaderHeight;
      const overlayHeight = selectionTopY - overlayTopY;
      ctx.fillRect(selectionStartX, overlayTopY, selectionWidth, overlayHeight);
    }

    // Draw darker overlay below the selection (within clip bounds)
    if (minFrequency > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const overlayBottomY = selectionBottomY;
      const overlayHeight = (trackY + trackHeight) - overlayBottomY;
      ctx.fillRect(selectionStartX, overlayBottomY, selectionWidth, overlayHeight);
    }

    // Draw dashed marquee border with 100% opaque alternating black/white dashes
    const dashLength = 4;
    ctx.lineWidth = 1;

    // Helper to draw a dashed line segment with alternating colors
    const drawDashedLine = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      const segments = Math.floor(length / dashLength);

      for (let i = 0; i < segments; i++) {
        const t1 = (i * dashLength) / length;
        const t2 = Math.min(((i + 1) * dashLength) / length, 1);
        const startX = x1 + dx * t1;
        const startY = y1 + dy * t1;
        const endX = x1 + dx * t2;
        const endY = y1 + dy * t2;

        // Alternate between white and black
        ctx.strokeStyle = i % 2 === 0 ? '#ffffff' : '#000000';
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    };

    // Draw all four sides
    drawDashedLine(selectionStartX, selectionTopY, selectionEndX, selectionTopY); // Top
    drawDashedLine(selectionEndX, selectionTopY, selectionEndX, selectionBottomY); // Right
    drawDashedLine(selectionEndX, selectionBottomY, selectionStartX, selectionBottomY); // Bottom
    drawDashedLine(selectionStartX, selectionBottomY, selectionStartX, selectionTopY); // Left

    // Draw horizontal center line (solid black, or highlighted if hovering)
    const centerY = (selectionTopY + selectionBottomY) / 2;

    // Check if mouse is hovering over center line
    const isHoveringCenterLine = mousePos
      && Math.abs(mousePos.y - centerY) <= EDGE_THRESHOLD
      && mousePos.x >= selectionStartX + EDGE_THRESHOLD
      && mousePos.x <= selectionEndX - EDGE_THRESHOLD;

    if (isHoveringCenterLine) {
      // Draw highlighted center line (thicker and white)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(selectionStartX, centerY);
      ctx.lineTo(selectionEndX, centerY);
      ctx.stroke();
    } else {
      // Draw normal center line (thin black)
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(selectionStartX, centerY);
      ctx.lineTo(selectionEndX, centerY);
      ctx.stroke();
    }

    // Draw 6px corner resize handles (white fill, black stroke)
    const handleSize = 6;
    const corners = [
      { x: selectionStartX, y: selectionTopY }, // Top-left
      { x: selectionEndX, y: selectionTopY }, // Top-right
      { x: selectionStartX, y: selectionBottomY }, // Bottom-left
      { x: selectionEndX, y: selectionBottomY }, // Bottom-right
    ];

    corners.forEach(corner => {
      // Draw white fill
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize
      );

      // Draw black stroke
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize
      );
    });
  }, [spectralSelection, pixelsPerSecond, leftPadding, trackHeights, trackGap, initialGap, clipHeaderHeight, tracks, mousePos, EDGE_THRESHOLD]);

  if (!spectralSelection) return null;

  // Canvas size should cover the entire track area
  const totalHeight = trackHeights.reduce((sum, h) => sum + h, 0) + initialGap + trackGap * (trackHeights.length - 1);
  const totalWidth = 5000; // Should match canvas width

  return (
    <canvas
      ref={canvasRef}
      className="spectral-selection-overlay"
      width={totalWidth}
      height={totalHeight}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    />
  );
}

export default SpectralSelectionOverlay;
