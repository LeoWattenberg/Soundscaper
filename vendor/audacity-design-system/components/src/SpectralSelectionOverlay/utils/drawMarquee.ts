/**
 * Pure drawing functions for spectral selection marquee
 */

import { SelectionBounds } from './coordinates';
import { DASH_LENGTH, CORNER_SIZE, CENTER_LINE_WIDTH, CENTER_LINE_HOVER_WIDTH } from './constants';

/**
 * Draw a dashed line with alternating black and white segments
 */
export function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.floor(length / DASH_LENGTH);

  for (let i = 0; i < segments; i++) {
    const t1 = (i * DASH_LENGTH) / length;
    const t2 = Math.min(((i + 1) * DASH_LENGTH) / length, 1);
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
}

/**
 * Draw a dashed line with only black segments (for mirrored selection)
 */
export function drawBlackDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.floor(length / DASH_LENGTH);

  ctx.strokeStyle = '#000000';

  for (let i = 0; i < segments; i++) {
    const t1 = (i * DASH_LENGTH) / length;
    const t2 = Math.min(((i + 1) * DASH_LENGTH) / length, 1);
    const startX = x1 + dx * t1;
    const startY = y1 + dy * t1;
    const endX = x1 + dx * t2;
    const endY = y1 + dy * t2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
}

/**
 * Draw marquee border (dashed rectangle with alternating white and black)
 */
export function drawMarqueeBorder(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds
): void {
  ctx.lineWidth = 1;

  // Draw all four sides
  drawDashedLine(ctx, bounds.leftX, bounds.topY, bounds.rightX, bounds.topY); // Top
  drawDashedLine(ctx, bounds.rightX, bounds.topY, bounds.rightX, bounds.bottomY); // Right
  drawDashedLine(ctx, bounds.rightX, bounds.bottomY, bounds.leftX, bounds.bottomY); // Bottom
  drawDashedLine(ctx, bounds.leftX, bounds.bottomY, bounds.leftX, bounds.topY); // Left
}

/**
 * Draw marquee border with only black dashes (for mirrored selection)
 */
export function drawBlackMarqueeBorder(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds
): void {
  ctx.lineWidth = 1;

  // Draw all four sides with black dashes only
  drawBlackDashedLine(ctx, bounds.leftX, bounds.topY, bounds.rightX, bounds.topY); // Top
  drawBlackDashedLine(ctx, bounds.rightX, bounds.topY, bounds.rightX, bounds.bottomY); // Right
  drawBlackDashedLine(ctx, bounds.rightX, bounds.bottomY, bounds.leftX, bounds.bottomY); // Bottom
  drawBlackDashedLine(ctx, bounds.leftX, bounds.bottomY, bounds.leftX, bounds.topY); // Left
}

/**
 * Draw center line (horizontal line through middle)
 */
export function drawCenterLine(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds,
  isHovering: boolean
): void {
  if (isHovering) {
    // Draw highlighted center line (thicker and white)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = CENTER_LINE_HOVER_WIDTH;
  } else {
    // Draw normal center line (thin black)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = CENTER_LINE_WIDTH;
  }

  ctx.beginPath();
  ctx.moveTo(bounds.leftX, bounds.centerY);
  ctx.lineTo(bounds.rightX, bounds.centerY);
  ctx.stroke();
}

/**
 * Draw corner resize handles
 */
export function drawCornerHandles(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds
): void {
  const corners = [
    { x: bounds.leftX, y: bounds.topY }, // Top-left
    { x: bounds.rightX, y: bounds.topY }, // Top-right
    { x: bounds.leftX, y: bounds.bottomY }, // Bottom-left
    { x: bounds.rightX, y: bounds.bottomY }, // Bottom-right
  ];

  corners.forEach(corner => {
    // Draw white fill
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      corner.x - CORNER_SIZE / 2,
      corner.y - CORNER_SIZE / 2,
      CORNER_SIZE,
      CORNER_SIZE
    );

    // Draw black stroke
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      corner.x - CORNER_SIZE / 2,
      corner.y - CORNER_SIZE / 2,
      CORNER_SIZE,
      CORNER_SIZE
    );
  });
}

/**
 * Draw darkening overlays above and below the selection
 * OR draw time-selection-style overlay if selection spans full frequency range
 */
export function drawDarkenedOverlays(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds,
  minFrequency: number,
  maxFrequency: number,
  trackY: number,
  trackHeight: number,
  clipHeaderHeight: number
): void {
  // Check if selection spans full frequency range (0 to 1)
  const isFullHeight = minFrequency === 0 && maxFrequency === 1;

  if (isFullHeight) {
    // Full-height overlay is drawn BEFORE clipping in SpectralSelectionCanvas
    // So we don't draw it here - just skip the darkening overlays
  } else {
    // Draw darker overlay above the selection (within clip bounds)
    if (maxFrequency < 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const overlayTopY = trackY + clipHeaderHeight;
      const overlayHeight = bounds.topY - overlayTopY;
      ctx.fillRect(bounds.leftX, overlayTopY, bounds.width, overlayHeight);
    }

    // Draw darker overlay below the selection (within clip bounds)
    if (minFrequency > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const overlayBottomY = bounds.bottomY;
      const overlayHeight = (trackY + trackHeight) - overlayBottomY;
      ctx.fillRect(bounds.leftX, overlayBottomY, bounds.width, overlayHeight);
    }
  }
}
