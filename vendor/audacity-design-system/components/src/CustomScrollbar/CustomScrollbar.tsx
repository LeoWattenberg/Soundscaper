/**
 * CustomScrollbar - Custom styled scrollbar component
 *
 * A custom scrollbar that overlays content and provides smooth scrolling interaction.
 * Works with both horizontal and vertical orientations.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useTheme } from '../ThemeProvider';
import './CustomScrollbar.css';

export interface CustomScrollbarProps {
  /** Ref to the scrollable content container */
  contentRef: React.RefObject<HTMLDivElement>;
  /** Width of the scrollbar track */
  width?: number;
  /** Height of the scrollbar track */
  height?: number;
  /** Orientation */
  orientation: 'horizontal' | 'vertical';
  /** Additional class name */
  className?: string;
  /** Background color for the scrollbar track */
  backgroundColor?: string;
  /** Border color for the scrollbar track */
  borderColor?: string;
  /** Whether to use full width/height (don't subtract scrollbar thickness) */
  fullSize?: boolean;
  /** Thickness of the scrollbar thumb (width for vertical, height for horizontal) */
  thumbThickness?: number;
  /** Horizontal padding (left + right) */
  paddingX?: number;
  /** Vertical padding (top + bottom) */
  paddingY?: number;
}

/**
 * CustomScrollbar component - Custom styled scrollbar with drag interaction
 */
export function CustomScrollbar({
  contentRef,
  width = 14,
  height = 14,
  orientation,
  className = '',
  backgroundColor,
  borderColor,
  fullSize = false,
  thumbThickness = 8,
  paddingX = 0,
  paddingY = 0,
}: CustomScrollbarProps) {
  const { theme } = useTheme();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [thumbSize, setThumbSize] = useState(0);
  const [thumbPosition, setThumbPosition] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const dragStartRef = useRef({ mousePos: 0, scrollPos: 0 });

  const isHorizontal = orientation === 'horizontal';

  // Calculate thumb size and position based on content scroll state
  const updateThumb = useCallback(() => {
    if (!contentRef.current) return;

    const content = contentRef.current;
    const contentViewportWidth = content.clientWidth;
    const contentViewportHeight = content.clientHeight;

    // Update container size
    setContainerSize({
      width: contentViewportWidth,
      height: contentViewportHeight,
    });

    if (isHorizontal) {
      const contentWidth = content.scrollWidth;
      const scrollLeft = content.scrollLeft;

      if (contentWidth <= contentViewportWidth) {
        setThumbSize(0); // Hide scrollbar if content fits
        return;
      }

      // Calculate track width directly from content width (same as inline style)
      const trackWidth = fullSize ? contentViewportWidth : contentViewportWidth - width;
      const availableWidth = trackWidth - paddingX; // Account for horizontal padding
      const ratio = contentViewportWidth / contentWidth;
      const newThumbSize = Math.max(30, availableWidth * ratio); // Min 30px thumb
      const maxScroll = contentWidth - contentViewportWidth;
      const scrollRatio = scrollLeft / maxScroll;
      const maxThumbPos = availableWidth - newThumbSize;
      const newThumbPos = scrollRatio * maxThumbPos;

      setThumbSize(newThumbSize);
      setThumbPosition(newThumbPos);
    } else {
      const contentHeight = content.scrollHeight;
      const scrollTop = content.scrollTop;

      if (contentHeight <= contentViewportHeight) {
        setThumbSize(0); // Hide scrollbar if content fits
        return;
      }

      // Calculate track height directly from content height (same as inline style)
      const trackHeight = fullSize ? contentViewportHeight : contentViewportHeight - height;
      const availableHeight = trackHeight - paddingY; // Account for vertical padding
      const ratio = contentViewportHeight / contentHeight;
      const newThumbSize = Math.max(30, availableHeight * ratio); // Min 30px thumb
      const maxScroll = contentHeight - contentViewportHeight;
      const scrollRatio = scrollTop / maxScroll;
      const maxThumbPos = availableHeight - newThumbSize;
      const newThumbPos = scrollRatio * maxThumbPos;

      setThumbSize(newThumbSize);
      setThumbPosition(newThumbPos);
    }
  }, [contentRef, isHorizontal, width, height]);

  // Listen to content scroll events
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const handleScroll = () => {
      updateThumb();
    };

    content.addEventListener('scroll', handleScroll);

    // Use requestAnimationFrame to ensure DOM is ready for measurement
    requestAnimationFrame(() => {
      updateThumb(); // Initial calculation
    });

    // Recalculate on window resize
    const handleResize = () => updateThumb();
    window.addEventListener('resize', handleResize);

    // Use ResizeObserver to detect when the content container itself is resized
    const resizeObserver = new ResizeObserver(() => {
      updateThumb();
    });
    resizeObserver.observe(content);

    return () => {
      content.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [contentRef, updateThumb]);

  // Handle thumb dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const content = contentRef.current;
    if (!content) return;

    dragStartRef.current = {
      mousePos: isHorizontal ? e.clientX : e.clientY,
      scrollPos: isHorizontal ? content.scrollLeft : content.scrollTop,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const content = contentRef.current;
      const track = trackRef.current;
      if (!content || !track) return;

      const currentMousePos = isHorizontal ? e.clientX : e.clientY;
      const mouseDelta = currentMousePos - dragStartRef.current.mousePos;

      if (isHorizontal) {
        const trackWidth = track.clientWidth;
        const availableWidth = trackWidth - paddingX;
        const contentWidth = content.scrollWidth;
        const viewportWidth = content.clientWidth;
        const maxScroll = contentWidth - viewportWidth;
        const maxThumbPos = availableWidth - thumbSize;
        const scrollDelta = (mouseDelta / maxThumbPos) * maxScroll;
        content.scrollLeft = dragStartRef.current.scrollPos + scrollDelta;
      } else {
        const trackHeight = track.clientHeight;
        const availableHeight = trackHeight - paddingY;
        const contentHeight = content.scrollHeight;
        const viewportHeight = content.clientHeight;
        const maxScroll = contentHeight - viewportHeight;
        const maxThumbPos = availableHeight - thumbSize;
        const scrollDelta = (mouseDelta / maxThumbPos) * maxScroll;
        content.scrollTop = dragStartRef.current.scrollPos + scrollDelta;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, thumbSize, isHorizontal]);

  // Handle track click (jump to position)
  const handleTrackClick = (e: React.MouseEvent) => {
    if (e.target !== trackRef.current) return; // Only handle clicks on track, not thumb

    const content = contentRef.current;
    const track = trackRef.current;
    if (!content || !track) return;

    const trackRect = track.getBoundingClientRect();
    const clickPos = isHorizontal
      ? e.clientX - trackRect.left
      : e.clientY - trackRect.top;

    if (isHorizontal) {
      const trackWidth = track.clientWidth;
      const contentWidth = content.scrollWidth;
      const viewportWidth = content.clientWidth;
      const maxScroll = contentWidth - viewportWidth;
      const scrollRatio = clickPos / trackWidth;
      content.scrollLeft = scrollRatio * maxScroll;
    } else {
      const trackHeight = track.clientHeight;
      const contentHeight = content.scrollHeight;
      const viewportHeight = content.clientHeight;
      const maxScroll = contentHeight - viewportHeight;
      const scrollRatio = clickPos / trackHeight;
      content.scrollTop = scrollRatio * maxScroll;
    }
  };

  if (thumbSize === 0) return null; // Hide scrollbar if not needed

  const style = {
    '--scrollbar-thumb-idle': theme.background.control.scrollbar.thumb.idle,
    '--scrollbar-thumb-hover': theme.background.control.scrollbar.thumb.hover,
    '--scrollbar-thumb-pressed': theme.background.control.scrollbar.thumb.pressed,
    backgroundColor: backgroundColor,
    borderTop: borderColor ? `1px solid ${borderColor}` : undefined,
  } as React.CSSProperties;

  return (
    <div
      ref={trackRef}
      className={`custom-scrollbar custom-scrollbar--${orientation} ${className}`}
      style={{
        ...style,
        width: isHorizontal ? (fullSize ? `${containerSize.width}px` : `${containerSize.width - width}px`) : `${width}px`,
        height: isHorizontal ? `${height}px` : (fullSize ? `${containerSize.height}px` : `${containerSize.height - height}px`),
      }}
      onClick={handleTrackClick}
    >
      <div
        ref={thumbRef}
        className={`custom-scrollbar__thumb ${isDragging ? 'custom-scrollbar__thumb--dragging' : ''}`}
        style={{
          width: isHorizontal ? `${thumbSize}px` : `${thumbThickness}px`,
          height: isHorizontal ? `${thumbThickness}px` : `${thumbSize}px`,
          transform: isHorizontal
            ? `translate(${thumbPosition}px, ${(height - thumbThickness) / 2}px)`
            : `translate(${(width - thumbThickness) / 2}px, ${thumbPosition}px)`,
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}

export default CustomScrollbar;
