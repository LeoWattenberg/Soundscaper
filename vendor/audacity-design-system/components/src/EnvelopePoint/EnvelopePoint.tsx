import * as React from 'react';
import { useEffect, useRef } from 'react';
import './EnvelopePoint.css';

export interface EnvelopePointProps {
  /** X position in pixels */
  x: number;

  /** Y position in pixels */
  y: number;

  /** Whether this point is being hovered */
  isHovered?: boolean;

  /** Whether this point is being dragged */
  isDragged?: boolean;

  /** Point color */
  color?: string;

  /** Hover color */
  hoverColor?: string;

  /** Stroke color */
  strokeColor?: string;

  /** Point radius in pixels */
  radius?: number;

  /** Mouse event handlers */
  onMouseDown?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLCanvasElement>) => void;

  /** Custom className */
  className?: string;
}

export const EnvelopePoint: React.FC<EnvelopePointProps> = ({
  x,
  y,
  isHovered = false,
  isDragged = false,
  color = '#ffffff',
  hoverColor = '#ffaa00',
  strokeColor = '#2ecc71',
  radius = 4,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseEnter,
  onMouseLeave,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to include the point + some padding for hit area
    const size = radius * 4;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw the point in the center of the canvas
    const centerX = size / 2;
    const centerY = size / 2;

    const fillColor = isHovered || isDragged ? hoverColor : color;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }, [isHovered, isDragged, color, hoverColor, strokeColor, radius]);

  const size = radius * 4;

  return (
    <canvas
      ref={canvasRef}
      className={`envelope-point ${isHovered ? 'envelope-point--hovered' : ''} ${isDragged ? 'envelope-point--dragged' : ''} ${className}`}
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        cursor: isHovered || isDragged ? 'grab' : 'pointer',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
};

export default EnvelopePoint;
