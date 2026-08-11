import React from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../ThemeProvider';
import './Tooltip.css';

export interface TooltipProps {
  /** Tooltip text content */
  content: string;
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Whether tooltip is visible */
  visible?: boolean;
  /** Offset from cursor/target (default: 8px) */
  offset?: number;
}

/**
 * Tooltip - A floating tooltip component
 *
 * Displays contextual information near a target position.
 * Typically shown on hover or when additional context is needed.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  x,
  y,
  visible = true,
  offset = 8,
}) => {
  if (!visible) return null;

  const tooltipElement = (
    <div
      className="tooltip"
      style={{
        left: `${x}px`,
        top: `${y - offset}px`,
      }}
    >
      <div className="tooltip__content">
        {content}
      </div>
      {/* Triangle pointer - rotated 180deg, positioned at bottom center */}
      <div className="tooltip__arrow">
        <svg width="16" height="7" viewBox="0 0 16 7" fill="none">
          {/* Triangle with stroke - pointing up (will be rotated 180deg in CSS) */}
          <path
            d="M1 6.5L8 1L15 6.5"
            stroke="#D4D5D9"
            strokeWidth="1"
            fill="#F8F8F9"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
    </div>
  );

  // Render tooltip at document body level to escape stacking context issues
  return createPortal(tooltipElement, document.body);
};

export default Tooltip;
