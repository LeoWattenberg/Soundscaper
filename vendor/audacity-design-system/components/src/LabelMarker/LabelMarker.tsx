import React, { useState } from 'react';
import { useTheme } from '../ThemeProvider';
import './LabelMarker.css';

export interface LabelMarkerProps {
  /**
   * Label text to display
   */
  text: string;

  /**
   * Type of label marker
   */
  type?: 'point' | 'region';

  /**
   * Visual state of the label
   */
  state?: 'idle' | 'hover' | 'active';

  /**
   * Width in pixels (for region labels)
   */
  width?: number;

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
   * Called when dragging ears or stalks to resize region labels
   * Passes the mouse clientX position so parent can convert to time
   */
  onRegionResize?: (params: { side: 'left' | 'right'; clientX: number }) => void;

  /**
   * Called when dragging the label body/stalk to move a label
   * Passes deltaX (change from drag start position)
   */
  onLabelMove?: (deltaX: number) => void;

  /**
   * Called on mouse down (before drag) to handle selection
   * Receives the mouse event to check for shift key
   */
  onSelect?: (e?: React.MouseEvent) => void;

  /**
   * Additional CSS class
   */
  className?: string;
}

/**
 * LabelMarker - Visual marker for labels in label tracks
 * Can be either a point marker (single time) or region marker (time range)
 */
export const LabelMarker: React.FC<LabelMarkerProps> = ({
  text,
  type = 'point',
  state = 'idle',
  width = 225,
  stalkHeight = 60,
  selected = false,
  focused = false,
  onClick,
  onDoubleClick,
  onRegionResize,
  onLabelMove,
  onSelect,
  className = '',
}) => {
  const { theme } = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [leftEarHovered, setLeftEarHovered] = useState(false);
  const [rightEarHovered, setRightEarHovered] = useState(false);
  const [dragState, setDragState] = useState<{ type: 'resize' | 'move'; side?: 'left' | 'right'; startX: number; initialWidth: number } | null>(null);

  const style = {
    '--label-marker-bg': theme.border.focus,
    '--label-marker-text': theme.foreground.text.primary,
  } as React.CSSProperties;

  const actualState = state !== 'idle' ? state : (isHovered ? 'hover' : 'idle');
  const isActive = selected || actualState === 'active';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Keyboard events are handled in Canvas.tsx
  };

  // Handle drag start for resizing (ears only)
  const handleDragStart = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    if (onRegionResize) {
      // Prevent focus on mouse down (only allow tab-based focus)
      e.preventDefault();
      e.stopPropagation();
      setDragState({ type: 'resize', side, startX: e.clientX, initialWidth: width });
    }
  };

  // Handle drag start for moving (label box for all types, stalk for point labels)
  const handleMoveStart = (e: React.MouseEvent) => {
    if (onLabelMove) {
      // Prevent focus on mouse down (only allow tab-based focus)
      e.preventDefault();

      // Call onSelect BEFORE stopPropagation to allow selection on mouse down
      // But only if NOT shift-clicking (preserve multi-selection)
      if (!e.shiftKey) {
        onSelect?.(e);
      } else {
      }

      e.stopPropagation();
      setDragState({ type: 'move', startX: e.clientX, initialWidth: width });
    }
  };

  React.useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX;

      if (dragState.type === 'move') {
        // Moving a label - pass deltaX to maintain offset
        onLabelMove?.(deltaX);
      } else if (dragState.type === 'resize') {
        // Only trigger resize if we've moved at least 5px (for point->region conversion)
        if (type === 'point' && Math.abs(deltaX) < 5) {
          return;
        }

        // Pass the absolute mouse position to the parent for resizing
        onRegionResize?.({ side: dragState.side!, clientX: e.clientX });
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
  }, [dragState, onRegionResize, onLabelMove, type]);

  // Render ear with proper layering for states
  const renderEar = (isLeft: boolean, onMouseDown?: (e: React.MouseEvent) => void) => {
    // Use exact Figma paths - they fill the viewBox from 0 to 14
    const leftEarPath = "M0.723608 1.44722L7 14V0H1.61827C0.874886 0 0.391157 0.782314 0.723608 1.44722Z";
    const rightEarPath = "M6.27639 1.44722L0 14V0H5.38173C6.12511 0 6.60884 0.782314 6.27639 1.44722Z";
    const earPath = isLeft ? leftEarPath : rightEarPath;

    const earHovered = isLeft ? leftEarHovered : rightEarHovered;
    const setEarHovered = isLeft ? setLeftEarHovered : setRightEarHovered;

    // Determine opacity based on state (matching Figma)
    let fillOpacity = 1; // Default

    if (selected || isActive) {
      // Selected/Active states - parent hover doesn't change the selected appearance
      if (earHovered) {
        fillOpacity = 0.5; // Selected + Ear Hover (slight increase from selected)
      } else {
        fillOpacity = 0.4; // Selected (stays at 0.4 even when parent is hovered)
      }
    } else {
      // Not selected states
      if (earHovered) {
        fillOpacity = 0.8; // Ear Hover only
      } else if (isHovered) {
        fillOpacity = 0.7; // Parent Hover
      } else {
        fillOpacity = 1; // Default
      }
    }

    const showWhiteLayer = isHovered || selected || isActive || earHovered;

    return (
      <div
        className={`label-marker__${isLeft ? 'left' : 'right'}-ear`}
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
          style={{ display: 'block' }} // Remove any inline gaps
        >
          {/* White background layer (shown on hover/active) */}
          {showWhiteLayer && (
            <path
              d={earPath}
              fill="white"
              stroke="none"
            />
          )}
          {/* Blue foreground layer */}
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

  // Determine if we should show flag style (point or very narrow region)
  // When width < 10px, stalks overlap, so show flag style
  const isPoint = type === 'point';
  const isNarrowRegion = !isPoint && width < 10;
  const showFlagStyle = isPoint || isNarrowRegion;

  return (
    <div
      className={`label-marker ${showFlagStyle ? 'label-marker--point' : 'label-marker--region'} label-marker--${actualState} ${isActive ? 'label-marker--active' : ''} ${focused ? 'label-marker--focused' : ''} ${className}`}
      style={{
        position: 'relative',
        ...style,
        width: isPoint ? '1px' : `${width}px`,
        height: `${stalkHeight}px`, // Total height is just the stalk height (ears overlay on top)
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Left ear - for point: draggable to create region, for region: draggable to resize */}
      {renderEar(true, handleDragStart('left'))}

      {/* Right ear - for point: draggable to create region, for region: draggable to resize */}
      {renderEar(false, handleDragStart('right'))}

      {/* Label box - single element that switches between banner and flag styles based on width */}
      <div
        className="label-marker__label-box"
        onMouseDown={handleMoveStart}
        style={{ cursor: 'grab' }}
      >
        <div className="label-marker__label-text">{text || ''}</div>
      </div>

      {/* Left stalk - for point: center stalk, for region: left edge stalk */}
      <div
        className="label-marker__left-stalk"
        onMouseDown={isPoint ? handleMoveStart : handleDragStart('left')}
        style={{ cursor: isPoint ? 'grab' : 'ew-resize' }}
      >
        <div className="label-marker__stalk-line" />
      </div>

      {/* Right stalk - only for region labels (not true point labels) */}
      {type !== 'point' && (
        <div
          className="label-marker__right-stalk"
          onMouseDown={handleDragStart('right')}
          style={{ cursor: 'ew-resize' }}
        >
          <div className="label-marker__stalk-line" />
        </div>
      )}
    </div>
  );
};

export default LabelMarker;
