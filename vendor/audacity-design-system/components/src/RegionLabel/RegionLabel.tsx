import React, { useState, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import './RegionLabel.css';

export interface RegionLabelProps {
  /**
   * Label text to display in the banner
   */
  text: string;

  /**
   * Start time of the region (left stalk position initially)
   */
  startTime: number;

  /**
   * End time of the region (right stalk position initially)
   */
  endTime: number;

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
   * Callback when resizing (dragging stalks)
   * @param side - which stalk is being dragged
   * @param clientX - mouse X position
   */
  onResize?: (params: { side: 'left' | 'right'; clientX: number }) => void;

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
 * RegionLabel - A resizable label with two stalks and a banner
 * The banner can be inverted (stalks can cross over each other)
 */
export const RegionLabel: React.FC<RegionLabelProps> = ({
  text,
  startTime,
  endTime,
  stalkHeight = 100,
  selected = false,
  focused = false,
  onClick,
  onDoubleClick,
  onResize,
  onMove,
  className = '',
  style = {},
}) => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [leftEarHovered, setLeftEarHovered] = useState(false);
  const [rightEarHovered, setRightEarHovered] = useState(false);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize';
    side?: 'left' | 'right';
    startX: number;
    startY: number;
  } | null>(null);

  // Determine if the region is inverted (right stalk dragged past left)
  const isInverted = endTime < startTime;

  // Handle drag start for stalks (resize)
  const handleDragStart = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type: 'resize',
      side,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  // Handle drag start for banner (move)
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
      } else if (dragState.type === 'resize') {
        onResize?.({ side: dragState.side!, clientX: e.clientX });
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
  }, [dragState, onResize, onMove]);

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
        className={`region-label__${isLeft ? 'left' : 'right'}-ear`}
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
      className={`region-label ${selected ? 'region-label--selected' : ''} ${focused ? 'region-label--focused' : ''} ${className}`}
      style={{
        position: 'relative',
        height: `${stalkHeight}px`,
        ...style,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Left stalk */}
      <div
        className="region-label__left-stalk"
        onMouseDown={handleDragStart('left')}
        style={{ cursor: 'ew-resize' }}
      >
        <div className="region-label__stalk-line" />
      </div>

      {/* Left ear */}
      {renderEar(true, handleDragStart('left'))}

      {/* Banner (rectangle spanning between stalks) */}
      <div
        className="region-label__banner"
        onMouseDown={handleMoveStart}
        style={{ cursor: 'grab' }}
      >
        <div className="region-label__banner-text">{text || ''}</div>
      </div>

      {/* Right ear */}
      {renderEar(false, handleDragStart('right'))}

      {/* Right stalk */}
      <div
        className="region-label__right-stalk"
        onMouseDown={handleDragStart('right')}
        style={{ cursor: 'ew-resize' }}
      >
        <div className="region-label__stalk-line" />
      </div>
    </div>
  );
};

export default RegionLabel;
