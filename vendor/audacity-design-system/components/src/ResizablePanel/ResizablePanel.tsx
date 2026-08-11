import React, { useState, useRef, useEffect } from 'react';
import './ResizablePanel.css';

export interface ResizablePanelProps {
  /**
   * Content to be rendered inside the resizable panel
   */
  children: React.ReactNode;
  /**
   * Initial height of the panel in pixels
   */
  initialHeight?: number;
  /**
   * Minimum height the panel can be resized to
   */
  minHeight?: number;
  /**
   * Maximum height the panel can be resized to
   */
  maxHeight?: number;
  /**
   * Which edge(s) can be used to resize
   */
  resizeEdge?: 'top' | 'bottom' | 'both';
  /**
   * Size of the resize zone in pixels (distance from edge)
   */
  resizeThreshold?: number;
  /**
   * Callback fired when height changes during resize
   */
  onHeightChange?: (height: number) => void;
  /**
   * Callback fired when resize starts
   */
  onResizeStart?: () => void;
  /**
   * Callback fired when resize ends
   */
  onResizeEnd?: () => void;
  /**
   * Additional CSS class names
   */
  className?: string;
  /**
   * Whether to add top margin (for first item spacing)
   */
  isFirstPanel?: boolean;
  /**
   * Additional inline styles for the container
   */
  style?: React.CSSProperties;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  initialHeight = 114,
  minHeight = 44,
  maxHeight,
  resizeEdge = 'bottom',
  resizeThreshold = 8,
  onHeightChange,
  onResizeStart,
  onResizeEnd,
  className = '',
  isFirstPanel = false,
  style: externalStyle,
}) => {
  const [height, setHeight] = useState(initialHeight);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeCursor, setResizeCursor] = useState(false);
  const resizeStartRef = useRef<{ y: number; height: number; edge: 'top' | 'bottom' } | null>(null);

  // Add document-level event listeners for dragging beyond component bounds
  useEffect(() => {
    if (!isResizing) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (resizeStartRef.current) {
        const deltaY = e.clientY - resizeStartRef.current.y;
        // For top-edge resize, dragging up (negative deltaY) should increase height
        let newHeight = resizeStartRef.current.edge === 'top'
          ? resizeStartRef.current.height - deltaY
          : resizeStartRef.current.height + deltaY;

        // Apply constraints
        newHeight = Math.max(minHeight, newHeight);
        if (maxHeight !== undefined) {
          newHeight = Math.min(maxHeight, newHeight);
        }

        // Soft snap to default height
        const SNAP_THRESHOLD = 6;
        if (Math.abs(newHeight - initialHeight) <= SNAP_THRESHOLD) {
          newHeight = initialHeight;
        }

        setHeight(newHeight);
        onHeightChange?.(newHeight);
      }
    };

    const handleDocumentMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      onResizeEnd?.();
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isResizing, minHeight, maxHeight, onHeightChange, onResizeEnd]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isResizing) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;

      let inResizeZone = false;

      if (resizeEdge === 'bottom' || resizeEdge === 'both') {
        const bottomResizeStart = height - resizeThreshold;
        inResizeZone = y >= bottomResizeStart && y <= height;
      }

      if (!inResizeZone && (resizeEdge === 'top' || resizeEdge === 'both')) {
        inResizeZone = y >= 0 && y <= resizeThreshold;
      }

      setResizeCursor(inResizeZone);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;

    let activeEdge: 'top' | 'bottom' | null = null;

    if (resizeEdge === 'bottom' || resizeEdge === 'both') {
      const bottomResizeStart = height - resizeThreshold;
      if (y >= bottomResizeStart && y <= height) {
        activeEdge = 'bottom';
      }
    }

    if (!activeEdge && (resizeEdge === 'top' || resizeEdge === 'both')) {
      if (y >= 0 && y <= resizeThreshold) {
        activeEdge = 'top';
      }
    }

    if (activeEdge) {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartRef.current = { y: e.clientY, height, edge: activeEdge };
      onResizeStart?.();
    }
  };

  const handleMouseLeave = () => {
    if (!isResizing) {
      setResizeCursor(false);
    }
  };

  return (
    <div
      className={`resizable-panel ${className}`}
      style={{
        position: 'relative',
        height: `${height}px`,
        ...externalStyle,
      }}
    >
      <div
        className={`resizable-panel__content ${resizeCursor ? 'resizable-panel__content--resize-cursor' : ''}`}
        style={{
          height: `${height}px`,
          cursor: resizeCursor ? 'ns-resize' : 'default',
          position: 'relative',
        }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
    </div>
  );
};

export default ResizablePanel;
