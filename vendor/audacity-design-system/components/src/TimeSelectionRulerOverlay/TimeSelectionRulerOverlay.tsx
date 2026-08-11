import { TimeSelection } from '@audacity-ui/core';

export interface TimeSelectionRulerOverlayProps {
  /**
   * Time selection range
   */
  timeSelection: TimeSelection | null;
  /**
   * Zoom level in pixels per second
   */
  pixelsPerSecond: number;
  /**
   * Left padding in pixels (for alignment with track content)
   */
  leftPadding: number;
  /**
   * Y position where overlay starts (typically half the ruler height)
   */
  top: number;
  /**
   * Height of the overlay
   */
  height: number;
  /**
   * Background color for the selection
   * @default 'rgba(255, 255, 255, 0.5)'
   */
  backgroundColor?: string;
  /**
   * Border color for the selection edges
   * @default '#ffffff'
   */
  borderColor?: string;
}

/**
 * Visual overlay component for time selection in ruler
 * Displays a semi-transparent box with borders at selection edges
 */
export const TimeSelectionRulerOverlay: React.FC<TimeSelectionRulerOverlayProps> = ({
  timeSelection,
  pixelsPerSecond,
  leftPadding,
  top,
  height,
  backgroundColor = 'rgba(255, 255, 255, 0.5)',
  borderColor = '#ffffff',
}) => {
  if (!timeSelection) return null;

  const startX = timeSelection.startTime * pixelsPerSecond + leftPadding;
  const endX = timeSelection.endTime * pixelsPerSecond + leftPadding;
  const width = endX - startX;

  return (
    <div
      className="time-selection-ruler-overlay"
      style={{
        position: 'absolute',
        left: `${startX}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor,
        borderLeft: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
};

export default TimeSelectionRulerOverlay;
