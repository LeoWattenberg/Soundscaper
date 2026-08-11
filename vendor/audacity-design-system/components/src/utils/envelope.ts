/**
 * Envelope rendering utilities for canvas
 * Extracted from working sandbox implementation in apps/demo/clip-envelope
 */

const BOTTOM_MARGIN = 3; // Prevent envelope from going under clip border
const INFINITY_ZONE = 1; // Within bottom margin, last 1px for -∞

/**
 * Convert dB value to Y position using non-linear scale
 * Uses cubic power curve with 0dB positioned at about 2/3 down the clip
 * @param db - dB value (-60 to +12, or -Infinity)
 * @param y - Top Y position of clip body
 * @param height - Height of clip body
 * @returns Y position in pixels
 */
export function dbToYNonLinear(db: number, y: number, height: number): number {
  const minDb = -60;
  const maxDb = 12;
  const usableHeight = height - BOTTOM_MARGIN;

  // -Infinity maps to the bottom of usable area (top of bottom margin)
  if (db === -Infinity) {
    return y + usableHeight;
  }

  // Clamp to valid dB range
  const clampedDb = Math.max(minDb, Math.min(maxDb, db));

  // Power curve mapping with 0dB at ~2/3 down
  // Using power of 3.0 to position 0dB lower in the clip
  const dbRange = maxDb - minDb; // 72 dB total range
  const linear = (clampedDb - minDb) / dbRange; // 0 to 1

  // Apply power curve: higher power pushes 0dB lower
  const normalized = Math.pow(linear, 3.0);

  return y + usableHeight - normalized * usableHeight;
}

/**
 * Convert Y position to dB value using non-linear scale
 * Inverse of dbToYNonLinear
 * @param yPos - Y position in pixels
 * @param y - Top Y position of clip body
 * @param height - Height of clip body
 * @returns dB value
 */
export function yToDbNonLinear(yPos: number, y: number, height: number): number {
  const minDb = -60;
  const maxDb = 12;
  const usableHeight = height - BOTTOM_MARGIN;

  // At or past the usable height triggers -infinity
  if (yPos >= y + usableHeight) {
    return -Infinity;
  }

  // Convert Y position to normalized value (0-1) within usable area
  const relativeY = yPos - y;
  const normalized = (usableHeight - relativeY) / usableHeight;

  // Apply inverse cubic curve
  const linearNorm = Math.pow(normalized, 1 / 3);

  // Convert to dB
  return minDb + linearNorm * (maxDb - minDb);
}

export interface EnvelopePointData {
  time: number;
  db: number;
}

/**
 * Get the gain multiplier (linear, 0-1+) at a given time from envelope points
 * Uses linear interpolation between points
 * @param time - Time in seconds
 * @param points - Array of envelope points
 * @param duration - Clip duration in seconds
 * @returns Gain multiplier (0 = silence, 1 = unity, >1 = amplification)
 */
export function getEnvelopeGainAtTime(
  time: number,
  points: EnvelopePointData[],
  duration: number
): number {
  // No points = unity gain (0dB = 1.0 multiplier)
  if (!points || points.length === 0) {
    return 1.0;
  }

  // Clamp time to clip bounds
  const t = Math.max(0, Math.min(duration, time));

  // Find the two points that bracket this time
  let beforePoint: EnvelopePointData | null = null;
  let afterPoint: EnvelopePointData | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.time <= t) {
      beforePoint = point;
    }
    if (point.time >= t && !afterPoint) {
      afterPoint = point;
    }
  }

  // Determine the dB value at this time
  let db: number;

  if (!beforePoint && !afterPoint) {
    // No points at all (shouldn't happen, but handle gracefully)
    db = 0;
  } else if (!beforePoint) {
    // Before first point: use first point's dB
    db = afterPoint!.db;
  } else if (!afterPoint) {
    // After last point: use last point's dB
    db = beforePoint.db;
  } else if (beforePoint.time === afterPoint.time) {
    // Exactly on a point
    db = beforePoint.db;
  } else {
    // Between two points: linear interpolation in dB space
    const ratio = (t - beforePoint.time) / (afterPoint.time - beforePoint.time);
    db = beforePoint.db + ratio * (afterPoint.db - beforePoint.db);
  }

  // Convert dB to linear gain multiplier
  // Formula: gain = 10^(dB/20)
  return Math.pow(10, db / 20);
}

export interface RenderEnvelopeLineOptions {
  /** Canvas 2D context */
  ctx: CanvasRenderingContext2D;
  /** Array of envelope points */
  points: EnvelopePointData[];
  /** Clip duration in seconds */
  duration: number;
  /** X position to start rendering */
  x: number;
  /** Y position to start rendering */
  y: number;
  /** Width to render */
  width: number;
  /** Height to render */
  height: number;
  /** Line color (default: 'red') */
  color?: string;
  /** Indices of points to hide (for drag interactions) */
  hiddenPointIndices?: number[];
}

/**
 * Render envelope line on canvas
 * Draws the envelope curve through control points
 */
export function renderEnvelopeLine(options: RenderEnvelopeLineOptions): void {
  const {
    ctx,
    points,
    duration,
    x,
    y,
    width,
    height,
    color = 'red',
    hiddenPointIndices = []
  } = options;

  const zeroDB_Y = dbToYNonLinear(0, y, height);

  if (points.length === 0) {
    // No control points - draw default line at 0dB
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(x, zeroDB_Y);
    ctx.lineTo(x + width, zeroDB_Y);
    ctx.stroke();
  } else {
    // Filter out hidden points for drawing the line
    const visiblePoints = points.filter((_, index) => !hiddenPointIndices.includes(index));

    if (visiblePoints.length === 0) {
      // All points are hidden - draw default line at 0dB
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(x, zeroDB_Y);
      ctx.lineTo(x + width, zeroDB_Y);
      ctx.stroke();
    } else {
      // Draw envelope through visible control points
      const startY = dbToYNonLinear(visiblePoints[0].db, y, height);

      // First segment: from clip start to first point
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(x, startY);
      const firstPx = x + (visiblePoints[0].time / duration) * width;
      const firstPy = dbToYNonLinear(visiblePoints[0].db, y, height);
      ctx.lineTo(firstPx, firstPy);
      ctx.stroke();

      // Segments between control points
      for (let i = 0; i < visiblePoints.length - 1; i++) {
        const point1 = visiblePoints[i];
        const point2 = visiblePoints[i + 1];
        const px1 = x + (point1.time / duration) * width;
        const py1 = dbToYNonLinear(point1.db, y, height);
        const px2 = x + (point2.time / duration) * width;
        const py2 = dbToYNonLinear(point2.db, y, height);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.stroke();
      }

      // Last segment: from last point to clip end
      const lastPoint = visiblePoints[visiblePoints.length - 1];
      if (lastPoint.time < duration) {
        const lastPx = x + (lastPoint.time / duration) * width;
        const lastPy = dbToYNonLinear(lastPoint.db, y, height);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(lastPx, lastPy);
        ctx.lineTo(x + width, lastPy);
        ctx.stroke();
      }
    }
  }
}

export interface RenderEnvelopePointsOptions {
  /** Canvas 2D context */
  ctx: CanvasRenderingContext2D;
  /** Array of envelope points */
  points: EnvelopePointData[];
  /** Clip duration in seconds */
  duration: number;
  /** X position to start rendering */
  x: number;
  /** Y position to start rendering */
  y: number;
  /** Width to render */
  width: number;
  /** Height to render */
  height: number;
  /** Outer circle color (default: 'red') */
  color?: string;
  /** Inner circle color (default: '#fff') */
  centerColor?: string;
  /** Indices of points to hide (for drag interactions) */
  hiddenPointIndices?: number[];
  /** Indices of points being hovered (for visual feedback, can be multiple during segment drag) */
  hoveredPointIndices?: number[];
  /** Outer radius for normal state (default: 4) */
  outerRadius?: number;
  /** Inner radius for normal state (default: 2) */
  innerRadius?: number;
  /** Outer radius for hover state (default: 5) */
  outerRadiusHover?: number;
  /** Inner radius for hover state (default: 3) */
  innerRadiusHover?: number;
  /** Show white outline on hover */
  showWhiteOutlineOnHover?: boolean;
  /** Show black center on hover */
  showBlackCenterOnHover?: boolean;
}

/**
 * Render envelope control points on canvas
 * Draws two-tone circles at each envelope point
 */
export function renderEnvelopePoints(options: RenderEnvelopePointsOptions): void {
  const {
    ctx,
    points,
    duration,
    x,
    y,
    width,
    height,
    color = 'red',
    centerColor = '#fff',
    hiddenPointIndices = [],
    hoveredPointIndices = [],
    outerRadius: outerRadiusNormal = 3,
    innerRadius: innerRadiusNormal = 1.5,
    outerRadiusHover: outerRadiusHoverValue = 5,
    innerRadiusHover: innerRadiusHoverValue = 3,
    showWhiteOutlineOnHover = false,
    showBlackCenterOnHover = false,
  } = options;

  points.forEach((point, index) => {
    // Skip hidden points
    if (hiddenPointIndices.includes(index)) return;

    const px = x + (point.time / duration) * width;
    const py = dbToYNonLinear(point.db, y, height);

    const isHovered = hoveredPointIndices.includes(index);

    // Use hover sizes if hovered, otherwise normal sizes
    const outerRadius = isHovered ? outerRadiusHoverValue : outerRadiusNormal;
    const innerRadius = isHovered ? innerRadiusHoverValue : innerRadiusNormal;

    // Ring thickness on hover (1px)
    const ringThickness = 1;

    // Draw donut/ring shape
    if (centerColor === 'transparent') {
      if (isHovered && (showWhiteOutlineOnHover || showBlackCenterOnHover)) {
        // Hovered state with white outline and/or black center
        ctx.save();

        // Draw green ring
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, outerRadius, 0, Math.PI * 2);
        ctx.fill();

        // Cut out inner circle using destination-out
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Draw 1px white outline with 1px gap from green ring
        if (showWhiteOutlineOnHover) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, outerRadius + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Draw black center dot (2px radius)
        if (showBlackCenterOnHover) {
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Normal state: thin green ring with transparent center
        ctx.save();

        // Draw outer circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, outerRadius, 0, Math.PI * 2);
        ctx.fill();

        // Cut out inner circle using destination-out
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    } else {
      // Draw filled circles (old behavior for non-transparent centers)
      // Outer circle with color
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, outerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Inner circle with center color
      ctx.fillStyle = centerColor;
      ctx.beginPath();
      ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
