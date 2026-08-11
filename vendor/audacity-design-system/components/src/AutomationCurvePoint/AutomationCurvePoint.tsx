import React from 'react';
import './AutomationCurvePoint.css';

export interface AutomationCurvePointProps {
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Whether the point is being hovered */
  isHovered?: boolean;
  /** Whether the point is being dragged */
  isDragging?: boolean;
  /** Whether the point is selected */
  isSelected?: boolean;
  /** Color of the point */
  color?: 'red' | 'blue' | 'green';
  /** Size of the point in pixels */
  size?: number;
  /** Click handler */
  onClick?: (e: React.MouseEvent) => void;
  /** Mouse down handler */
  onMouseDown?: (e: React.MouseEvent) => void;
  /** Mouse enter handler */
  onMouseEnter?: (e: React.MouseEvent) => void;
  /** Mouse leave handler */
  onMouseLeave?: (e: React.MouseEvent) => void;
}

/**
 * AutomationCurvePoint - A control point for automation curves
 *
 * States:
 * - Default: Red filled circle with white border
 * - Hover: Slightly larger with glow
 * - Dragging: Even larger with stronger glow
 * - Selected: Different border color
 */
export const AutomationCurvePoint: React.FC<AutomationCurvePointProps> = ({
  x,
  y,
  isHovered = false,
  isDragging = false,
  isSelected = false,
  color = 'red',
  size = 6,
  onClick,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}) => {
  const className = [
    'automation-curve-point',
    `automation-curve-point--${color}`,
    isHovered && 'automation-curve-point--hovered',
    isDragging && 'automation-curve-point--dragging',
    isSelected && 'automation-curve-point--selected',
  ]
    .filter(Boolean)
    .join(' ');

  // Calculate actual size based on state
  const actualSize = isDragging ? size * 1.4 : isHovered ? size * 1.2 : size;
  const halfSize = actualSize / 2;

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        left: x - halfSize,
        top: y - halfSize,
        width: actualSize,
        height: actualSize,
        pointerEvents: 'auto',
      }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
};

export default AutomationCurvePoint;
