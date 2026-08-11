/**
 * Carousel - Reusable carousel/slideshow component
 */

import { useState, Children, ReactNode } from 'react';
import { GhostButton } from '../GhostButton';
import { SwipeyDots } from '../SwipeyDots';
import './Carousel.css';

export interface CarouselProps {
  /**
   * Slide content as React children
   */
  children: ReactNode;
  /**
   * Initial slide index (0-based)
   * @default 0
   */
  initialSlide?: number;
  /**
   * Show navigation arrows
   * @default true
   */
  showArrows?: boolean;
  /**
   * Show dot indicators
   * @default true
   */
  showDots?: boolean;
  /**
   * Callback when slide changes
   */
  onSlideChange?: (index: number) => void;
  /**
   * Additional CSS class name
   */
  className?: string;
}

/**
 * Carousel component - Displays content in a navigable slideshow format
 * with arrow buttons and dot indicators.
 */
export function Carousel({
  children,
  initialSlide = 0,
  showArrows = true,
  showDots = true,
  onSlideChange,
  className = '',
}: CarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const slides = Children.toArray(children);
  const totalSlides = slides.length;

  const handlePrevSlide = () => {
    const newIndex = currentSlide === 0 ? totalSlides - 1 : currentSlide - 1;
    setCurrentSlide(newIndex);
    onSlideChange?.(newIndex);
  };

  const handleNextSlide = () => {
    const newIndex = currentSlide === totalSlides - 1 ? 0 : currentSlide + 1;
    setCurrentSlide(newIndex);
    onSlideChange?.(newIndex);
  };

  const handleDotClick = (index: number) => {
    setCurrentSlide(index);
    onSlideChange?.(index);
  };

  if (totalSlides === 0) {
    return null;
  }

  return (
    <div className={`carousel ${className}`}>
      {/* Carousel Navigation */}
      <div className="carousel__navigation">
        {/* Left Arrow */}
        {showArrows && (
          <GhostButton
            icon="chevron-left"
            size="large"
            onClick={handlePrevSlide}
            ariaLabel="Previous slide"
          />
        )}

        {/* Current Slide Content */}
        <div className="carousel__content">
          {slides[currentSlide]}
        </div>

        {/* Right Arrow */}
        {showArrows && (
          <GhostButton
            icon="chevron-right"
            size="large"
            onClick={handleNextSlide}
            ariaLabel="Next slide"
          />
        )}
      </div>

      {/* Dot Indicators */}
      {showDots && totalSlides > 1 && (
        <SwipeyDots
          totalDots={totalSlides}
          activeDot={currentSlide}
          onDotClick={handleDotClick}
        />
      )}
    </div>
  );
}

export default Carousel;
