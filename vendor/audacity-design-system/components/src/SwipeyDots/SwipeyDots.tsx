/**
 * SwipeyDots - Pagination indicator for carousels and multi-page dialogs
 */

import './SwipeyDots.css';

export interface SwipeyDotsProps {
  /**
   * Total number of dots to display
   */
  totalDots: number;
  /**
   * Index of the currently active dot (0-based)
   */
  activeDot: number;
  /**
   * Callback when a dot is clicked
   */
  onDotClick?: (index: number) => void;
  /**
   * Additional CSS class name
   */
  className?: string;
}

/**
 * SwipeyDots - A pagination indicator component that displays dots representing pages/slides
 * with one active dot highlighted. Commonly used in carousels and multi-page dialogs.
 */
export function SwipeyDots({
  totalDots,
  activeDot,
  onDotClick,
  className = '',
}: SwipeyDotsProps) {
  return (
    <div
      className={`swipey-dots ${className}`}
      role="tablist"
      aria-label="Carousel navigation"
    >
      {Array.from({ length: totalDots }).map((_, index) => (
        <button
          key={index}
          className={`swipey-dots__dot ${index === activeDot ? 'swipey-dots__dot--active' : ''}`}
          onClick={() => onDotClick?.(index)}
          role="tab"
          aria-selected={index === activeDot}
          aria-label={`Go to slide ${index + 1}`}
          aria-current={index === activeDot ? 'true' : 'false'}
          type="button"
        />
      ))}
    </div>
  );
}

export default SwipeyDots;
