import React, { useState, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import './PointLabel.css';

export interface PointLabelProps {
  /**
   * Label text to display in the flag
   */
  text: string;

  /**
   * Height of the stalk in pixels
   */
  stalkHeight?: number;

  /**
   * Whether the label is selected
   */
  selected?: boolean;

  /**
   * Whether the label has keyboard focus
   */
  focused?: boolean;

  /**
   * Click handler
   */
  onClick?: () => void;

  /**
   * Double click handler for editing
   */
  onDoubleClick?: () => void;

  /**
   * Callback when dragging ears to create a region
   * @param side - which ear is being dragged
   * @param clientX - mouse X position
   */
  onEarDrag?: (params: { side: 'left' | 'right'; clientX: number }) => void;

  /**
   * Callback when moving the entire label
   */
  onMove?: (params: { clientX: number; clientY: number }) => void;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Additional inline styles
   */
  style?: React.CSSProperties;
}

/**
 * PointLabel - A single-point label with flag-style text box
 */
export const PointLabel: React.FC<PointLabelProps> = ({
  text,
  stalkHeight = 100,
  selected = false,
  focused = false,
  onClick,
  onDoubleClick,
  onEarDrag,
  onMove,
  className = '',
  style = {},
}) => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [leftEarHovered, setLeftEarHovered] = useState(false);
  const [rightEarHovered, setRightEarHovered] = useState(false);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'ear-drag';
    side?: 'left' | 'right';
    startX: number;
    startY: number;
  } | null>(null);

  // Handle drag start for ears (to convert to region)
  const handleEarDragStart = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type: 'ear-drag',
      side,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  // Handle drag start for stalk/flag (move)
  const handleMoveStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  // Handle mouse move and mouse up during drag
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (dragState.type === 'move') {
        onMove?.({ clientX: e.clientX, clientY: e.clientY });
      } else if (dragState.type === 'ear-drag') {
        // Only trigger ear drag if moved at least 5px
        const deltaX = Math.abs(e.clientX - dragState.startX);
        if (deltaX >= 5) {
          onEarDrag?.({ side: dragState.side!, clientX: e.clientX });
        }
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onEarDrag, onMove]);

  // Render ear SVG
  const renderEar = (isLeft: boolean, onMouseDown?: (e: React.MouseEvent) => void) => {
    const leftEarPath = "M0.723608 1.44722L7 14V0H1.61827C0.874886 0 0.391157 0.782314 0.723608 1.44722Z";
    const rightEarPath = "M6.27639 1.44722L0 14V0H5.38173C6.12511 0 6.60884 0.782314 6.27639 1.44722Z";
    const earPath = isLeft ? leftEarPath : rightEarPath;

    const earHovered = isLeft ? leftEarHovered : rightEarHovered;
    const setEarHovered = isLeft ? setLeftEarHovered : setRightEarHovered;

    // Determine opacity based on state
    let fillOpacity = 1;
    if (selected) {
      fillOpacity = earHovered ? 0.5 : 0.4;
    } else {
      if (earHovered) {
        fillOpacity = 0.8;
      } else if (isHovered) {
        fillOpacity = 0.7;
      } else {
        fillOpacity = 1;
      }
    }

    const showWhiteLayer = isHovered || selected || earHovered;

    return (
      <div
        className={`point-label__${isLeft ? 'left' : 'right'}-ear`}
        onMouseDown={onMouseDown}
        onMouseEnter={() => setEarHovered(true)}
        onMouseLeave={() => setEarHovered(false)}
        style={{ cursor: onMouseDown ? 'ew-resize' : 'default' }}
      >
        <svg
          width="7"
          height="14"
          viewBox="0 0 7 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block' }}
        >
          {showWhiteLayer && (
            <path d={earPath} fill="white" stroke="none" />
          )}
          <path
            d={earPath}
            fill="#7EB1FF"
            fillOpacity={fillOpacity}
            stroke="none"
          />
        </svg>
      </div>
    );
  };

  return (
    <div
      className={`point-label ${selected ? 'point-label--selected' : ''} ${focused ? 'point-label--focused' : ''} ${className}`}
      style={{
        position: 'relative',
        width: '1px',
        height: `${stalkHeight}px`,
        ...style,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Center stalk */}
      <div
        className="point-label__stalk"
        onMouseDown={handleMoveStart}
        style={{ cursor: 'grab' }}
      >
        <div className="point-label__stalk-line" />
      </div>

      {/* Left ear */}
      {renderEar(true, handleEarDragStart('left'))}

      {/* Right ear */}
      {renderEar(false, handleEarDragStart('right'))}

      {/* Flag (label box positioned to the right) */}
      <div
        className="point-label__flag"
        onMouseDown={handleMoveStart}
        style={{ cursor: 'grab' }}
      >
        <div className="point-label__flag-text">{text || ''}</div>
      </div>
    </div>
  );
};

export default PointLabel;
