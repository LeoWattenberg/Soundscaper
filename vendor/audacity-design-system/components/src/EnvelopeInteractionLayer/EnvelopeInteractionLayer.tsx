import React, { useRef, useEffect, useState } from 'react';
import { Tooltip } from '../Tooltip/Tooltip';

const EMPTY_NUMBER_ARRAY: number[] = [];

export interface EnvelopePoint {
  time: number;
  db: number;
}

export interface EnvelopeInteractionLayerProps {
  /** Envelope points (time is relative to clip/lane duration, 0-1) */
  envelopePoints: EnvelopePoint[];

  /** Called when envelope points are updated */
  onEnvelopePointsChange: (points: EnvelopePoint[]) => void;

  /** Called when hidden points change during drag (for eating visualization) */
  onHiddenPointsChange?: (hiddenIndices: number[]) => void;

  /** Called when hovered points change (for hover visual feedback, can be multiple during segment drag) */
  onHoveredPointsChange?: (pointIndices: number[]) => void;

  /** Called when cursor position changes over the envelope line (for cursor follower dot) */
  onCursorPositionChange?: (position: { time: number; db: number } | null) => void;

  /** Whether envelope editing is enabled */
  enabled?: boolean;

  /** Width of the interaction area in pixels */
  width: number;

  /** Height of the interaction area in pixels */
  height: number;

  /** Duration in seconds (for time calculations) */
  duration: number;

  /** X offset for positioning */
  x?: number;

  /** Y offset for positioning */
  y?: number;

  /** Points to hide during drag (eating behavior) */
  hiddenPointIndices?: number[];
}

interface DragState {
  type: 'point' | 'segment' | null;
  pointIndex?: number;
  segmentStartIndex?: number;
  segmentEndIndex?: number;
  startX: number;
  startY: number;
  originalTime?: number;
  startDb1?: number;
  startDb2?: number;
  hasMoved: boolean;
  hiddenIndices: number[];
}

const CLICK_THRESHOLD = 10; // Pixels for detecting clicks on existing control points
const ENVELOPE_LINE_FAR_THRESHOLD = 4; // Max distance from line for interaction
const ENVELOPE_PROXIMITY_THRESHOLD = 16; // Pixels for cursor change and event capture
const SNAP_THRESHOLD_TIME = 0.05; // Horizontal snapping threshold (50ms)
const TIME_EPSILON = 0.001; // For detecting clip origin (time = 0)
const ENVELOPE_MOVE_THRESHOLD = 3; // Pixels to distinguish click from drag

// dB to Y coordinate conversion (non-linear power curve)
function dbToYNonLinear(db: number, height: number): number {
  const minDb = -60;
  const maxDb = 12;
  const BOTTOM_MARGIN = 3;
  const usableHeight = height - BOTTOM_MARGIN;

  if (db === -Infinity) {
    return usableHeight; // Bottom of usable area
  }

  // Clamp to valid dB range
  const clampedDb = Math.max(minDb, Math.min(maxDb, db));

  const dbRange = maxDb - minDb;
  const linear = (clampedDb - minDb) / dbRange;
  const normalized = Math.pow(linear, 3.0);

  return usableHeight - normalized * usableHeight;
}

// Y to dB conversion (inverse of dbToYNonLinear)
function yToDbNonLinear(y: number, height: number): number {
  const minDb = -60;
  const maxDb = 12;
  const BOTTOM_MARGIN = 3;
  const usableHeight = height - BOTTOM_MARGIN;

  // At or past usable height triggers -infinity
  if (y >= usableHeight) {
    return -Infinity;
  }

  const normalized = (usableHeight - y) / usableHeight;
  const linear = Math.pow(normalized, 1.0 / 3.0);
  const db = minDb + linear * (maxDb - minDb);

  return db;
}

// Calculate distance from point to line segment
function distanceToLineSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * EnvelopeInteractionLayer - Handles envelope point editing interactions
 *
 * This component provides a transparent interaction layer for envelope editing.
 * It can be positioned over any envelope visualization (clip or lane).
 */
const EnvelopeInteractionLayerComponent: React.FC<EnvelopeInteractionLayerProps> = ({
  envelopePoints,
  onEnvelopePointsChange,
  onHiddenPointsChange,
  onHoveredPointsChange,
  onCursorPositionChange,
  enabled = true,
  width,
  height,
  duration,
  x = 0,
  y = 0,
  hiddenPointIndices = EMPTY_NUMBER_ARRAY,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [localHiddenIndices, setLocalHiddenIndices] = useState<number[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; db: number } | null>(null);
  const [isNearEnvelope, setIsNearEnvelope] = useState(false);
  const [isHoveringPoint, setIsHoveringPoint] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Helper function to check if mouse is near the envelope (within actual hit thresholds)
  const checkProximityToEnvelope = (mouseX: number, mouseY: number): boolean => {
    // Check proximity to existing points (10px hit area)
    for (let i = 0; i < envelopePoints.length; i++) {
      const point = envelopePoints[i];
      const px = (point.time / duration) * width;
      const py = dbToYNonLinear(point.db, height);
      const distance = Math.sqrt((mouseX - px) ** 2 + (mouseY - py) ** 2);
      if (distance <= CLICK_THRESHOLD) {
        return true;
      }
    }

    // Check proximity to envelope line segments (4px hit area)
    const segments = buildEnvelopeSegments(envelopePoints, width, height, duration);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const dist = distanceToLineSegment(mouseX, mouseY, segment.x1, segment.y1, segment.x2, segment.y2);
      if (dist <= ENVELOPE_LINE_FAR_THRESHOLD) {
        return true;
      }
    }

    return false;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Only handle envelope interactions if mouse is near the envelope
    const nearEnvelope = checkProximityToEnvelope(mouseX, mouseY);
    if (!nearEnvelope) {
      // Don't stop propagation - allow time selection to work
      return;
    }

    // Stop propagation only when near envelope
    e.stopPropagation();

    // Check for existing point click
    for (let i = 0; i < envelopePoints.length; i++) {
      const point = envelopePoints[i];
      const px = (point.time / duration) * width;
      const py = dbToYNonLinear(point.db, height);

      const distance = Math.sqrt((mouseX - px) ** 2 + (mouseY - py) ** 2);
      if (distance <= CLICK_THRESHOLD) {
        // Start point drag
        dragStateRef.current = {
          type: 'point',
          pointIndex: i,
          startX: mouseX,
          startY: mouseY,
          originalTime: point.time,
          hasMoved: false,
          hiddenIndices: [],
        };
        setIsDragging(true);
        // Clear cursor follower when dragging starts
        onCursorPositionChange?.(null);
        return;
      }
    }

    // Check for segment click
    const segments = buildEnvelopeSegments(envelopePoints, width, height, duration);
    let minDistance = Infinity;
    let closestSegmentIndex = -1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const dist = distanceToLineSegment(mouseX, mouseY, segment.x1, segment.y1, segment.x2, segment.y2);
      if (dist < minDistance) {
        minDistance = dist;
        closestSegmentIndex = i;
      }
    }

    // Check if within ENVELOPE_LINE_FAR_THRESHOLD of the line
    if (minDistance <= ENVELOPE_LINE_FAR_THRESHOLD) {
      // Start potential segment drag (or click to add point)
      // Determine which segment was clicked
      const { segmentStartIndex, segmentEndIndex } = findSegmentIndices(envelopePoints, closestSegmentIndex, duration);

      dragStateRef.current = {
        type: 'segment',
        segmentStartIndex: segmentStartIndex !== -1 ? segmentStartIndex : undefined,
        segmentEndIndex: segmentEndIndex !== -1 ? segmentEndIndex : undefined,
        startX: mouseX,
        startY: mouseY,
        startDb1: segmentStartIndex !== -1 ? envelopePoints[segmentStartIndex]?.db : undefined,
        startDb2: segmentEndIndex !== -1 ? envelopePoints[segmentEndIndex]?.db : undefined,
        hasMoved: false,
        hiddenIndices: [],
      };
      setIsDragging(true);
      // Clear cursor follower when dragging starts
      onCursorPositionChange?.(null);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      let mouseY = e.clientY - rect.top;

      // Clamp mouseY to prevent dragging outside the valid area
      mouseY = Math.max(0, Math.min(height, mouseY));

      const dragState = dragStateRef.current;

      // Check if moved beyond threshold (3 pixels to distinguish click from drag)
      const dx = Math.abs(mouseX - dragState.startX);
      const dy = Math.abs(mouseY - dragState.startY);
      if (dx > ENVELOPE_MOVE_THRESHOLD || dy > ENVELOPE_MOVE_THRESHOLD) {
        dragState.hasMoved = true;
      }

      if (dragState.type === 'point' && dragState.pointIndex !== undefined) {
        // Point drag
        let relativeTime = Math.max(0, Math.min(duration, (mouseX / width) * duration));
        const db = yToDbNonLinear(mouseY, height);

        // Calculate tooltip position at the point's position (relative to layer)
        const pointX = (relativeTime / duration) * width;
        const pointY = dbToYNonLinear(db, height);

        // Update tooltip with viewport coordinates (for position: fixed)
        // Allow -Infinity to pass through for display
        setTooltip({ x: rect.left + pointX, y: rect.top + pointY, db });

        // Snap to other points horizontally
        for (let i = 0; i < envelopePoints.length; i++) {
          if (i === dragState.pointIndex) continue;
          const otherPoint = envelopePoints[i];
          const timeDistance = Math.abs(relativeTime - otherPoint.time);
          if (timeDistance < SNAP_THRESHOLD_TIME) {
            relativeTime = otherPoint.time;
            break;
          }
        }

        // Determine hidden points (eating behavior)
        const hiddenIndices: number[] = [];

        if (relativeTime < TIME_EPSILON) {
          // At clip origin - hide all other points
          for (let i = 0; i < envelopePoints.length; i++) {
            if (i === dragState.pointIndex) continue;
            hiddenIndices.push(i);
          }
        } else {
          // Normal eating - hide points between original and current
          const minTime = Math.min(dragState.originalTime!, relativeTime);
          const maxTime = Math.max(dragState.originalTime!, relativeTime);

          for (let i = 0; i < envelopePoints.length; i++) {
            if (i === dragState.pointIndex) continue;
            const otherPoint = envelopePoints[i];
            if (otherPoint.time > minTime && otherPoint.time < maxTime) {
              hiddenIndices.push(i);
            }
          }
        }

        dragState.hiddenIndices = hiddenIndices;
        setLocalHiddenIndices(hiddenIndices);
        onHiddenPointsChange?.(hiddenIndices);

        // Update point position
        const newPoints = [...envelopePoints];
        newPoints[dragState.pointIndex] = {
          time: relativeTime,
          db: db === -Infinity ? -Infinity : Math.max(-60, Math.min(12, db)),
        };
        newPoints.sort((a, b) => a.time - b.time);

        // Update the point index after sorting
        const newPointIndex = newPoints.findIndex(
          (p) => p.time === relativeTime && Math.abs(p.db - Math.max(-60, Math.min(12, db))) < 0.001
        );
        if (newPointIndex !== -1) {
          dragState.pointIndex = newPointIndex;
        }

        onEnvelopePointsChange(newPoints);
      } else if (dragState.type === 'segment') {
        // Segment drag
        const deltaDb = yToDbNonLinear(mouseY, height) - yToDbNonLinear(dragState.startY, height);

        if (dragState.segmentStartIndex !== undefined) {
          // Dragging existing segment with points
          // Set both segment endpoints as hovered
          if (onHoveredPointsChange) {
            const hoveredIndices = [dragState.segmentStartIndex];
            if (dragState.segmentEndIndex !== undefined && dragState.segmentStartIndex !== dragState.segmentEndIndex) {
              hoveredIndices.push(dragState.segmentEndIndex);
            }
            onHoveredPointsChange(hoveredIndices);
          }

          const newDb1 = Math.max(-60, Math.min(12, dragState.startDb1! + deltaDb));
          const newDb2 = Math.max(-60, Math.min(12, dragState.startDb2! + deltaDb));

          // Calculate tooltip position at segment center
          const point1 = envelopePoints[dragState.segmentStartIndex];
          const point2 = envelopePoints[dragState.segmentEndIndex!];
          const centerTime = (point1.time + point2.time) / 2;
          const avgDb = (newDb1 + newDb2) / 2;
          const pointX = (centerTime / duration) * width;
          const pointY = dbToYNonLinear(avgDb, height);

          // Update tooltip with average dB (viewport coordinates)
          setTooltip({ x: rect.left + pointX, y: rect.top + pointY, db: avgDb });

          const newPoints = [...envelopePoints];
          newPoints[dragState.segmentStartIndex] = { ...newPoints[dragState.segmentStartIndex], db: newDb1 };
          if (dragState.segmentStartIndex !== dragState.segmentEndIndex) {
            newPoints[dragState.segmentEndIndex!] = { ...newPoints[dragState.segmentEndIndex!], db: newDb2 };
          }

          onEnvelopePointsChange(newPoints);
        } else if (envelopePoints.length === 0 || (envelopePoints.length === 2 && envelopePoints[0].time === 0 && Math.abs(envelopePoints[1].time - duration) < TIME_EPSILON)) {
          // Dragging default line (no points, or just the two boundary points we created)
          // Create/update two points at clip boundaries
          const newDb = Math.max(-60, Math.min(12, 0 + deltaDb));

          // Calculate tooltip position at cursor X, line Y
          const pointY = dbToYNonLinear(newDb, height);

          // Update tooltip (viewport coordinates)
          setTooltip({ x: rect.left + mouseX, y: rect.top + pointY, db: newDb });

          const newPoints = [
            { time: 0, db: newDb },
            { time: duration, db: newDb }
          ];
          onEnvelopePointsChange(newPoints);
        }
      }
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current) return;

      const dragState = dragStateRef.current;

      if (dragState.type === 'point' && dragState.pointIndex !== undefined) {
        if (!dragState.hasMoved) {
          // Click without drag - delete point
          const newPoints = [...envelopePoints];
          newPoints.splice(dragState.pointIndex, 1);
          onEnvelopePointsChange(newPoints);
        } else if (dragState.hiddenIndices.length > 0) {
          // Delete eaten points
          const newPoints = [...envelopePoints];
          dragState.hiddenIndices.sort((a, b) => b - a).forEach(i => {
            newPoints.splice(i, 1);
          });
          onEnvelopePointsChange(newPoints);
        }
      } else if (dragState.type === 'segment') {
        if (!dragState.hasMoved) {
          // Click without drag
          // If we have the two boundary points from dragging the default line, remove them and add a single point
          const hasBoundaryPoints = envelopePoints.length === 2 &&
                                    envelopePoints[0].time === 0 &&
                                    Math.abs(envelopePoints[1].time - duration) < TIME_EPSILON;

          if (hasBoundaryPoints) {
            // Remove the boundary points and add a single point at click position
            const relativeTime = (dragState.startX / width) * duration;
            const db = yToDbNonLinear(dragState.startY, height);
            const newPoint = { time: relativeTime, db };
            onEnvelopePointsChange([newPoint]);
          } else {
            // Normal click - add new point at click position
            const relativeTime = (dragState.startX / width) * duration;
            const db = yToDbNonLinear(dragState.startY, height);
            const newPoint = { time: relativeTime, db };

            // Check if adding at origin when one already exists
            const isAtClipOrigin = relativeTime < TIME_EPSILON;
            const hasPointAtOrigin = envelopePoints.some(p => p.time < TIME_EPSILON);

            if (!isAtClipOrigin || !hasPointAtOrigin) {
              const newPoints = [...envelopePoints, newPoint].sort((a, b) => a.time - b.time);
              onEnvelopePointsChange(newPoints);
            }
          }
        }
        // If dragged, segment movement already happened in mousemove
      }

      setLocalHiddenIndices([]);
      onHiddenPointsChange?.([]);
      onHoveredPointsChange?.([]); // Clear hovered points
      setTooltip(null); // Hide tooltip on mouse up
      setIsDragging(false); // Reset dragging state
      dragStateRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [envelopePoints, duration, width, height, onEnvelopePointsChange]);

  // Handle hover detection
  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check proximity to envelope for cursor change
    const nearEnvelope = checkProximityToEnvelope(mouseX, mouseY);
    setIsNearEnvelope(nearEnvelope);

    // Check if hovering over a point (only when not dragging)
    if (onHoveredPointsChange && !dragStateRef.current) {
      let hoveredIndex: number | null = null;
      for (let i = 0; i < envelopePoints.length; i++) {
        const point = envelopePoints[i];
        const px = (point.time / duration) * width;
        const py = dbToYNonLinear(point.db, height);

        const dx = mouseX - px;
        const dy = mouseY - py;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= CLICK_THRESHOLD) {
          hoveredIndex = i;
          break;
        }
      }

      // Update hover state for cursor
      setIsHoveringPoint(hoveredIndex !== null);

      onHoveredPointsChange(hoveredIndex !== null ? [hoveredIndex] : []);
    }

    // Calculate cursor position on envelope line (for cursor follower dot)
    if (onCursorPositionChange && !dragStateRef.current) {
      const segments = buildEnvelopeSegments(envelopePoints, width, height, duration);
      let minDistance = Infinity;
      let closestPoint: { time: number; db: number } | null = null;

      for (const segment of segments) {
        // Find the closest point on this segment to the mouse
        const { x1, y1, x2, y2 } = segment;

        const A = mouseX - x1;
        const B = mouseY - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;

        let xx, yy;

        if (param < 0) {
          xx = x1;
          yy = y1;
        } else if (param > 1) {
          xx = x2;
          yy = y2;
        } else {
          xx = x1 + param * C;
          yy = y1 + param * D;
        }

        const dx = mouseX - xx;
        const dy = mouseY - yy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDistance) {
          minDistance = dist;
          // Convert pixel position back to time/db
          const time = (xx / width) * duration;
          const db = yToDbNonLinear(yy, height);
          closestPoint = { time, db };
        }
      }

      // Only show cursor follower if within threshold
      if (minDistance <= ENVELOPE_LINE_FAR_THRESHOLD && closestPoint) {
        onCursorPositionChange(closestPoint);
      } else {
        onCursorPositionChange(null);
      }
    }
  };

  const handleContainerMouseLeave = () => {
    setIsNearEnvelope(false);
    setIsHoveringPoint(false);
    if (onHoveredPointsChange) {
      onHoveredPointsChange([]);
    }
    if (onCursorPositionChange) {
      onCursorPositionChange(null);
    }
  };

  if (!enabled) return null;

  // Format dB value for tooltip
  const formatDb = (db: number): string => {
    if (db === -Infinity) return '-∞ dB';
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };

  return (
    <>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={handleContainerMouseLeave}
        onClick={(e) => {
          // Only stop propagation if near envelope
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            if (checkProximityToEnvelope(mouseX, mouseY)) {
              e.stopPropagation();
            }
          }
        }}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width,
          height,
          cursor: isDragging ? 'grabbing' : (isHoveringPoint ? 'pointer' : (isNearEnvelope ? 'copy' : 'text')),
          pointerEvents: enabled ? 'auto' : 'none',
          zIndex: 3, // Above canvas (z-index: 2) and dark overlay (z-index: 1)
        }}
      />
      {tooltip && (
        <Tooltip
          content={formatDb(tooltip.db)}
          x={tooltip.x}
          y={tooltip.y}
          visible={true}
        />
      )}
    </>
  );
};

// Helper functions

function buildEnvelopeSegments(
  points: EnvelopePoint[],
  width: number,
  height: number,
  duration: number
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  if (points.length === 0) {
    // Default 0dB line
    const y0 = dbToYNonLinear(0, height);
    segments.push({ x1: 0, y1: y0, x2: width, y2: y0 });
  } else {
    // Segment from start to first point
    const startY = points[0].time === 0
      ? dbToYNonLinear(points[0].db, height)
      : dbToYNonLinear(0, height);
    const firstPointX = (points[0].time / duration) * width;
    const firstPointY = dbToYNonLinear(points[0].db, height);

    if (points[0].time > 0) {
      segments.push({ x1: 0, y1: startY, x2: firstPointX, y2: firstPointY });
    }

    // Segments between points
    for (let i = 0; i < points.length - 1; i++) {
      const p1x = (points[i].time / duration) * width;
      const p1y = dbToYNonLinear(points[i].db, height);
      const p2x = (points[i + 1].time / duration) * width;
      const p2y = dbToYNonLinear(points[i + 1].db, height);
      segments.push({ x1: p1x, y1: p1y, x2: p2x, y2: p2y });
    }

    // Segment from last point to end
    const lastPoint = points[points.length - 1];
    if (lastPoint.time < duration) {
      const lastPointX = (lastPoint.time / duration) * width;
      const lastPointY = dbToYNonLinear(lastPoint.db, height);
      segments.push({ x1: lastPointX, y1: lastPointY, x2: width, y2: lastPointY });
    }
  }

  return segments;
}

function findSegmentIndices(
  points: EnvelopePoint[],
  closestSegmentIndex: number,
  duration: number
): { segmentStartIndex: number; segmentEndIndex: number } {
  // Handle empty points array (no control points - just the default 0dB line)
  if (points.length === 0) {
    return { segmentStartIndex: -1, segmentEndIndex: -1 };
  }

  if (points.length === 1) {
    return { segmentStartIndex: 0, segmentEndIndex: 0 };
  }

  if (closestSegmentIndex === 0 && points[0].time > 0) {
    return { segmentStartIndex: 0, segmentEndIndex: 0 };
  }

  const hasStartSegment = points[0].time > 0;
  const adjustedIndex = hasStartSegment ? closestSegmentIndex - 1 : closestSegmentIndex;

  if (adjustedIndex >= 0 && adjustedIndex < points.length - 1) {
    return { segmentStartIndex: adjustedIndex, segmentEndIndex: adjustedIndex + 1 };
  } else if (adjustedIndex === points.length - 1) {
    return {
      segmentStartIndex: points.length - 1,
      segmentEndIndex: points.length - 1
    };
  }

  return { segmentStartIndex: -1, segmentEndIndex: -1 };
}

export const EnvelopeInteractionLayer = React.memo(EnvelopeInteractionLayerComponent);

export default EnvelopeInteractionLayer;
