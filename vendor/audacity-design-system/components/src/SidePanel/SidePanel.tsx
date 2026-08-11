import React, { ReactNode } from 'react';
import './SidePanel.css';

export interface SidePanelProps {
  /**
   * Panel position
   */
  position?: 'left' | 'right';

  /**
   * Panel width in pixels
   */
  width?: number;

  /**
   * Whether the panel is resizable
   */
  resizable?: boolean;

  /**
   * Minimum width when resizing (px)
   */
  minWidth?: number;

  /**
   * Maximum width when resizing (px)
   */
  maxWidth?: number;

  /**
   * Panel content
   */
  children: ReactNode;

  /**
   * Additional CSS class
   */
  className?: string;

  /**
   * Inline styles (for CSS custom properties)
   */
  style?: React.CSSProperties;

  /**
   * Called when panel is resized
   */
  onResize?: (width: number) => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  position = 'left',
  width = 200,
  resizable = true,
  minWidth = 150,
  maxWidth = 400,
  children,
  className = '',
  style,
  onResize,
}) => {
  const [currentWidth, setCurrentWidth] = React.useState(width);
  const [isResizing, setIsResizing] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsResizing(true);
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;

      const rect = panelRef.current.getBoundingClientRect();
      let newWidth: number;

      if (position === 'left') {
        newWidth = e.clientX - rect.left;
      } else {
        newWidth = rect.right - e.clientX;
      }

      // Clamp width between min and max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      setCurrentWidth(newWidth);
      onResize?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, position, minWidth, maxWidth, onResize]);

  return (
    <div
      ref={panelRef}
      className={`side-panel side-panel--${position} ${isResizing ? 'side-panel--resizing' : ''} ${className}`}
      style={{ width: currentWidth, ...style }}
    >
      <div className="side-panel__content">
        {children}
      </div>

      {resizable && (
        <div
          className={`side-panel__resize-handle side-panel__resize-handle--${position}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
};

export default SidePanel;
