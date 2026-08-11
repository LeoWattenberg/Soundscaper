/**
 * Hover and interaction detection utilities for spectral selection
 */

import { EDGE_THRESHOLD, CORNER_SIZE } from './constants';
import { SelectionBounds } from './coordinates';

/**
 * Check if mouse position is hovering over the center line
 */
export function isHoveringCenterLine(
  mouseX: number,
  mouseY: number,
  bounds: SelectionBounds
): boolean {
  const nearCenterLine = Math.abs(mouseY - bounds.centerY) <= EDGE_THRESHOLD;
  const insideX = mouseX >= bounds.leftX + EDGE_THRESHOLD && mouseX <= bounds.rightX - EDGE_THRESHOLD;

  return nearCenterLine && insideX;
}

/**
 * Check if mouse position is within selection bounds
 */
export function isWithinSelection(
  mouseX: number,
  mouseY: number,
  bounds: SelectionBounds
): boolean {
  const withinX = mouseX >= bounds.leftX - EDGE_THRESHOLD && mouseX <= bounds.rightX + EDGE_THRESHOLD;
  const withinY = mouseY >= bounds.topY - EDGE_THRESHOLD && mouseY <= bounds.bottomY + EDGE_THRESHOLD;

  return withinX && withinY;
}

/**
 * Detect which corner (if any) the mouse is hovering over
 */
export type Corner = 'tl' | 'tr' | 'bl' | 'br' | null;

export function detectCorner(
  mouseX: number,
  mouseY: number,
  bounds: SelectionBounds
): Corner {
  const onLeft = Math.abs(mouseX - bounds.leftX) <= CORNER_SIZE;
  const onRight = Math.abs(mouseX - bounds.rightX) <= CORNER_SIZE;
  const onTop = Math.abs(mouseY - bounds.topY) <= CORNER_SIZE;
  const onBottom = Math.abs(mouseY - bounds.bottomY) <= CORNER_SIZE;

  if (onLeft && onTop) return 'tl';
  if (onRight && onTop) return 'tr';
  if (onLeft && onBottom) return 'bl';
  if (onRight && onBottom) return 'br';

  return null;
}

/**
 * Detect which edge (if any) the mouse is hovering over
 */
export type Edge = 'left' | 'right' | 'top' | 'bottom' | null;

export function detectEdge(
  mouseX: number,
  mouseY: number,
  bounds: SelectionBounds
): Edge {
  const nearLeft = Math.abs(mouseX - bounds.leftX) <= EDGE_THRESHOLD;
  const nearRight = Math.abs(mouseX - bounds.rightX) <= EDGE_THRESHOLD;
  const nearTop = Math.abs(mouseY - bounds.topY) <= EDGE_THRESHOLD;
  const nearBottom = Math.abs(mouseY - bounds.bottomY) <= EDGE_THRESHOLD;

  if (nearLeft) return 'left';
  if (nearRight) return 'right';
  if (nearTop) return 'top';
  if (nearBottom) return 'bottom';

  return null;
}
