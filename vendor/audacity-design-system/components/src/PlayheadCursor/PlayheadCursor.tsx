import React, { useEffect, useRef, useState } from 'react';
import './PlayheadCursor.css';
import { CLIP_CONTENT_OFFSET } from '../constants';

export interface PlayheadCursorProps {
  /**
   * Playhead position in seconds
   */
  position: number;
  /**
   * Pixels per second (zoom level)
   */
  pixelsPerSecond: number;
  /**
   * Height of the stalk (full canvas height)
   */
  height: number;
  /**
   * Whether to show the playhead icon at the top (for timeline ruler)
   * @default false
   */
  showTopIcon?: boolean;
  /**
   * Top offset for the icon (if showTopIcon is true)
   * @default 0
   */
  iconTopOffset?: number;
  /**
   * Callback when position changes (via dragging)
   */
  onPositionChange?: (position: number) => void;
  /**
   * Minimum position in seconds (prevents dragging past this point)
   * @default 0
   */
  minPosition?: number;
  /**
   * Horizontal scroll offset in pixels (for timeline ruler)
   * @default 0
   */
  scrollX?: number;
}

/**
 * PlayheadCursor - Shows current playback position
 *
 * Renders a vertical line with:
 * - 1px white center line
 * - 2px black strokes on either side
 * - Optional playhead icon at top (for timeline ruler)
 */
function PlayheadCursorComponent({
  position,
  pixelsPerSecond,
  height,
  showTopIcon = false,
  iconTopOffset = 0,
  onPositionChange,
  minPosition = 0,
  scrollX = 0,
}: PlayheadCursorProps) {
  const x = CLIP_CONTENT_OFFSET + position * pixelsPerSecond - scrollX;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; position: number } | null>(null);

  useEffect(() => {
    if (showTopIcon && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // HiDPI: scale backing store, keep CSS box at 17x17 logical px.
        const cssSize = 17;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = cssSize * dpr;
        canvas.height = cssSize * dpr;
        canvas.style.width = `${cssSize}px`;
        canvas.style.height = `${cssSize}px`;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        // Clear canvas with transparent background
        ctx.clearRect(0, 0, cssSize, cssSize);

        const radius = 1;

        // Draw black stroke first (larger) - house shape pointing down with rounded corners
        ctx.beginPath();
        ctx.moveTo(8.5, 16);    // Bottom point (peak pointing down)
        ctx.lineTo(0.5, 11);    // Left roof edge
        ctx.arcTo(0.5, 0, 1.5, 0, radius); // Top left corner
        ctx.lineTo(15.5, 0);    // Top
        ctx.arcTo(16.5, 0, 16.5, 1, radius); // Top right corner
        ctx.lineTo(16.5, 11);   // Right wall
        ctx.closePath();
        ctx.fillStyle = '#000000';
        ctx.fill();

        // Draw white fill on top (slightly smaller for stroke effect)
        ctx.beginPath();
        ctx.moveTo(8.5, 15);    // Bottom point (peak pointing down)
        ctx.lineTo(1.5, 10.5);  // Left roof edge
        ctx.arcTo(1.5, 1, 2.5, 1, radius); // Top left corner
        ctx.lineTo(14.5, 1);    // Top
        ctx.arcTo(15.5, 1, 15.5, 2, radius); // Top right corner
        ctx.lineTo(15.5, 10.5); // Right wall
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }
  }, [showTopIcon]);

  // Drag handlers for playhead icon — delta-based (no DOM queries)
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!onPositionChange || !dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaTime = deltaX / pixelsPerSecond;
      const newPosition = Math.max(minPosition, dragStartRef.current.position + deltaTime);

      onPositionChange(newPosition);
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      setIsDragging(false);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onPositionChange, pixelsPerSecond, minPosition]);

  const handleIconMouseDown = (e: React.MouseEvent) => {
    if (!onPositionChange) return;
    e.preventDefault();
    e.stopPropagation();
    dragStartRef.current = { mouseX: e.clientX, position };
    setIsDragging(true);
    document.body.style.cursor = 'ew-resize';
  };

  return (
    <div
      className="playhead-cursor"
      style={{
        left: `${x}px`,
        height: `${height}px`,
      }}
    >
      {/* Black stroke (left side - 2px) */}
      <div
        className="playhead-cursor__stroke-left"
        style={{ left: '-2px' }}
      />

      {/* Black stroke (right side - 2px) */}
      <div
        className="playhead-cursor__stroke-right"
        style={{ left: '1px' }}
      />

      {/* White center line (1px) */}
      <div className="playhead-cursor__line" />

      {/* Playhead head at top (for timeline ruler) */}
      {showTopIcon && (
        <div
          onMouseDown={handleIconMouseDown}
          style={{
            position: 'absolute',
            top: `${iconTopOffset}px`,
            left: '50%',
            transform: 'translateX(calc(-50% + 0.5px))',
            cursor: onPositionChange ? 'ew-resize' : 'default',
            pointerEvents: onPositionChange ? 'auto' : 'none',
            zIndex: 4,
          }}
        >
          <canvas
            ref={canvasRef}
            width={17}
            height={17}
            style={{
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}

export const PlayheadCursor = React.memo(PlayheadCursorComponent);
