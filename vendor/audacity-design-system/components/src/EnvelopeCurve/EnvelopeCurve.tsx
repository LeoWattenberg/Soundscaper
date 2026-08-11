import * as React from 'react';
import { useEffect, useRef } from 'react';
import type { EnvelopePoint as EnvelopePointData } from '@audacity-ui/core';
import { EnvelopePoint } from '../EnvelopePoint';
import './EnvelopeCurve.css';

export interface EnvelopeCurveProps {
  /** Envelope points (time, dB) */
  points: EnvelopePointData[];

  /** X position in pixels */
  x: number;

  /** Y position in pixels */
  y: number;

  /** Width in pixels */
  width: number;

  /** Height in pixels */
  height: number;

  /** Start time of the envelope */
  startTime: number;

  /** Duration in seconds */
  duration: number;

  /** Pixels per second for time-to-pixel conversion */
  pixelsPerSecond: number;

  /** Envelope line color */
  lineColor?: string;

  /** Envelope line color when hovered */
  lineColorHover?: string;

  /** Draw line as dual stroke: 3px black underneath + 1px white on top */
  dualStrokeLine?: boolean;

  /** Envelope point color */
  pointColor?: string;

  /** Envelope point color when hovered */
  pointColorHover?: string;

  /** Index of hovered segment (for segment dragging) */
  hoveredSegmentIndex?: number | null;

  /** Index of dragged point */
  draggedPointIndex?: number | null;

  /** Whether the curve is in active edit mode */
  active?: boolean;

  /** dB range */
  minDb?: number;
  maxDb?: number;

  /** Mouse event handlers */
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLDivElement>) => void;

  /** Custom className */
  className?: string;
}

// Non-linear dB scale conversion (matches Clip component)
const dbToYNonLinear = (db: number, y: number, height: number, minDb: number, maxDb: number): number => {
  const INFINITY_ZONE_HEIGHT = 1;
  const usableHeight = height - INFINITY_ZONE_HEIGHT;

  if (db === -Infinity || db < minDb) {
    return y + height;
  }

  const dbRange = maxDb - minDb;
  const linear = (db - minDb) / dbRange;
  const normalized = Math.pow(linear, 3.0);

  return y + usableHeight - normalized * usableHeight;
};

// Helper to evaluate envelope curve at a given time
const evaluateEnvelope = (time: number, points: EnvelopePointData[]): number => {
  if (points.length === 0) return 0;

  let beforePoint: EnvelopePointData | null = null;
  let afterPoint: EnvelopePointData | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.time <= time) {
      beforePoint = point;
    }
    if (point.time >= time && !afterPoint) {
      afterPoint = point;
    }
  }

  if (!beforePoint && afterPoint) return afterPoint.db;
  if (beforePoint && !afterPoint) return beforePoint.db;
  if (!beforePoint && !afterPoint) return 0;

  if (beforePoint && afterPoint && beforePoint.time !== afterPoint.time) {
    const t = (time - beforePoint.time) / (afterPoint.time - beforePoint.time);
    return beforePoint.db + t * (afterPoint.db - beforePoint.db);
  }

  return beforePoint?.db ?? 0;
};

export const EnvelopeCurve: React.FC<EnvelopeCurveProps> = ({
  points,
  x,
  y,
  width,
  height,
  startTime,
  duration,
  pixelsPerSecond,
  lineColor = '#2ecc71',
  lineColorHover = '#ffaa00',
  dualStrokeLine = false,
  pointColor = '#ffffff',
  pointColorHover = '#ffaa00',
  hoveredSegmentIndex = null,
  draggedPointIndex = null,
  active = true,
  minDb = -60,
  maxDb = 12,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (points.length === 0) return;

    // Build envelope line path
    const buildLinePath = (startPx: number, endPx: number) => {
      ctx.beginPath();
      let isFirst = true;
      for (let px = startPx; px <= endPx; px += 2) {
        const time = startTime + (px / width) * duration;
        const db = evaluateEnvelope(time, points);
        const yPos = dbToYNonLinear(db, 0, height, minDb, maxDb);
        if (isFirst) {
          ctx.moveTo(px, yPos);
          isFirst = false;
        } else {
          ctx.lineTo(px, yPos);
        }
      }
    };

    // Draw envelope line
    const currentLineColor = hoveredSegmentIndex !== null ? lineColorHover : lineColor;

    if (dualStrokeLine) {
      // Black shadow pass (3px)
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      buildLinePath(0, width);
      ctx.stroke();
      // White overlay pass (1px)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      buildLinePath(0, width);
      ctx.stroke();
    } else {
      ctx.strokeStyle = currentLineColor;
      ctx.lineWidth = 2;
      buildLinePath(0, width);
      ctx.stroke();
    }

    // Draw hovered segment highlight
    if (hoveredSegmentIndex !== null && points.length > 1) {
      const startPoint = points[hoveredSegmentIndex];
      const endPoint = points[hoveredSegmentIndex + 1];

      if (startPoint && endPoint) {
        const startX = (startPoint.time - startTime) * pixelsPerSecond;
        const endX = (endPoint.time - startTime) * pixelsPerSecond;

        // Draw segment overlay
        ctx.fillStyle = 'rgba(255, 170, 0, 0.1)';
        ctx.fillRect(startX, 0, endX - startX, height);

        // Redraw segment in hover color
        if (dualStrokeLine) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          buildLinePath(startX, endX);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          buildLinePath(startX, endX);
          ctx.stroke();
        } else {
          ctx.strokeStyle = lineColorHover;
          ctx.lineWidth = 2;
          buildLinePath(startX, endX);
          ctx.stroke();
        }
      }
    }
  }, [points, width, height, startTime, duration, pixelsPerSecond, lineColor, lineColorHover, dualStrokeLine, hoveredSegmentIndex, minDb, maxDb]);

  return (
    <div
      className={`envelope-curve ${active ? 'envelope-curve--active' : ''} ${className}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: active ? 'auto' : 'none',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* Canvas for envelope line */}
      <canvas
        ref={canvasRef}
        className="envelope-curve__line"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
        }}
      />

      {/* Render control points */}
      {points.map((point, index) => {
        const pointX = (point.time - startTime) * pixelsPerSecond;
        const pointY = dbToYNonLinear(point.db, 0, height, minDb, maxDb);

        return (
          <EnvelopePoint
            key={index}
            x={pointX}
            y={pointY}
            isHovered={draggedPointIndex === index}
            isDragged={draggedPointIndex === index}
            color={pointColor}
            hoverColor={pointColorHover}
            strokeColor={lineColor}
          />
        );
      })}
    </div>
  );
};

export default EnvelopeCurve;
