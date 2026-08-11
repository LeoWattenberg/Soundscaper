/**
 * Dialog - Modal dialog component
 * Based on Figma design: node-id=6326-22726
 */

import React, { useEffect, useRef, useState } from 'react';
import { DialogHeader } from '../DialogHeader';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useTheme } from '../ThemeProvider';
import './Dialog.css';

export interface DialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Dialog title shown in the header
   */
  title: string;
  /**
   * Dialog content
   */
  children: React.ReactNode;
  /**
   * Footer content (typically buttons)
   */
  footer?: React.ReactNode;
  /**
   * Optional header content (appears below title)
   */
  headerContent?: React.ReactNode;
  /**
   * Optional logo URL for header
   */
  logo?: string;
  /**
   * Callback when dialog should close
   */
  onClose?: () => void;
  /**
   * Callback when clicking outside the dialog
   * @default calls onClose
   */
  onClickOutside?: () => void;
  /**
   * Whether clicking outside closes the dialog
   * @default true
   */
  closeOnClickOutside?: boolean;
  /**
   * Whether pressing Escape closes the dialog
   * @default true
   */
  closeOnEscape?: boolean;
  /**
   * Optional className for the dialog
   */
  className?: string;
  /**
   * Optional width for the dialog
   */
  width?: number | string;
  /**
   * Whether the dialog can be maximized
   * @default false
   */
  maximizable?: boolean;
  /**
   * Remove default body padding (16px 16px 24px)
   * Use when dialog content needs custom padding
   * @default false
   */
  noPadding?: boolean;
  /**
   * Show border on top of footer
   * @default true
   */
  footerBorder?: boolean;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Inline styles (for CSS custom properties)
   */
  style?: React.CSSProperties;
  /**
   * Minimum height for the dialog
   * @default 488
   */
  minHeight?: number | string;
  /**
   * Use custom layout (no body wrapper, footer rendered as children)
   * Use this for completely custom dialog layouts like two-column designs
   * @default false
   */
  customLayout?: boolean;
}

/**
 * Dialog component - Modal dialog with overlay
 */
export function Dialog({
  isOpen,
  title,
  children,
  footer,
  headerContent,
  logo,
  onClose,
  onClickOutside,
  closeOnClickOutside = true,
  closeOnEscape = true,
  footerBorder = true,
  className = '',
  width = 400,
  maximizable = false,
  noPadding = false,
  os = 'macos',
  style: externalStyle,
  minHeight,
  customLayout = false,
}: DialogProps) {
  const { theme } = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [dialogSize, setDialogSize] = useState({ width: 0, height: 0 });
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentWidth, setCurrentWidth] = useState(0);
  const resizeStateRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    edge: string;
  } | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  // Enable focus trap when dialog is open
  useFocusTrap(dialogRef, isOpen);

  // Handle click outside
  const handleOverlayClick = (e: React.MouseEvent) => {
    // Don't close if we just finished resizing
    if (resizeStateRef.current) {
      return;
    }

    if (e.target === e.currentTarget && closeOnClickOutside) {
      if (onClickOutside) {
        onClickOutside();
      } else if (onClose) {
        onClose();
      }
    }
  };

  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Initialize dialog size from width prop
  useEffect(() => {
    if (isOpen && dialogRef.current && !isMaximized) {
      const widthValue = typeof width === 'number' ? width : parseInt(width as string) || 400;
      // Only set width initially - let height be controlled by content unless manually resized
      setDialogSize({
        width: widthValue,
        height: 0, // 0 means auto-height based on content
      });
    }
  }, [isOpen, width, isMaximized]);

  // Track current dialog width
  useEffect(() => {
    if (!dialogRef.current) return;

    const updateWidth = () => {
      if (dialogRef.current) {
        setCurrentWidth(Math.round(dialogRef.current.getBoundingClientRect().width));
      }
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(dialogRef.current);

    return () => resizeObserver.disconnect();
  }, [isOpen]);

  // Handle resize mouse down
  const handleResizeMouseDown = (e: React.MouseEvent, edge: string) => {
    if (isMaximized) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;

    resizeStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      edge,
    };

    setIsResizing(true);
  };

  // Handle drag mouse down on header
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return;

    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: rect.left,
      startPosY: rect.top,
    };

    setIsDragging(true);
  };

  // Handle resize mouse move
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStateRef.current) return;

      const { startX, startY, startWidth, startHeight, edge } = resizeStateRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      if (edge.includes('right')) {
        newWidth = Math.max(400, startWidth + deltaX);
      } else if (edge.includes('left')) {
        newWidth = Math.max(400, startWidth - deltaX);
      }

      if (edge.includes('bottom')) {
        newHeight = Math.max(300, startHeight + deltaY);
      } else if (edge.includes('top')) {
        newHeight = Math.max(300, startHeight - deltaY);
      }

      setDialogSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Clear resize state after a small delay to prevent overlay click from closing dialog
      setTimeout(() => {
        resizeStateRef.current = null;
      }, 10);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Handle drag mouse move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return;

      const { startX, startY, startPosX, startPosY } = dragStateRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      setDialogPosition({
        x: startPosX + deltaX,
        y: startPosY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStateRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  const dialogClasses = `dialog ${isMaximized ? 'dialog--maximized' : ''} ${isResizing ? 'dialog--resizing' : ''} ${isDragging ? 'dialog--dragging' : ''} ${className}`;

  const baseStyle = isMaximized
    ? {
        '--dialog-bg': theme.background.surface.default,
        '--dialog-footer-bg': theme.background.surface.default,
        '--dialog-border': theme.border.default,
        '--dialog-footer-border': footerBorder ? theme.border.default : 'transparent',
        '--dialog-shadow': '0px 10px 30px 0px rgba(20, 21, 26, 0.3)',
      } as React.CSSProperties
    : {
        width: dialogSize.width > 0 ? `${dialogSize.width}px` : (typeof width === 'number' ? `${width}px` : width),
        height: dialogSize.height > 0 ? `${dialogSize.height}px` : undefined,
        minHeight: minHeight && (typeof minHeight === 'string' || minHeight > 0) ? (typeof minHeight === 'number' ? `${minHeight}px` : minHeight) : undefined,
        position: dialogPosition.x !== 0 || dialogPosition.y !== 0 ? 'fixed' : undefined,
        left: dialogPosition.x !== 0 ? `${dialogPosition.x}px` : undefined,
        top: dialogPosition.y !== 0 ? `${dialogPosition.y}px` : undefined,
        margin: dialogPosition.x !== 0 || dialogPosition.y !== 0 ? '0' : undefined,
        '--dialog-bg': theme.background.surface.default,
        '--dialog-footer-bg': theme.background.surface.default,
        '--dialog-border': theme.border.default,
        '--dialog-footer-border': footerBorder ? theme.border.default : 'transparent',
        '--dialog-shadow': '0px 10px 30px 0px rgba(20, 21, 26, 0.3)',
      } as React.CSSProperties;

  const dialogStyle = { ...baseStyle, ...externalStyle };

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className={dialogClasses}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {/* Resize handles */}
        {!isMaximized && (
          <>
            <div className="dialog__resize-handle dialog__resize-handle--top" onMouseDown={(e) => handleResizeMouseDown(e, 'top')} />
            <div className="dialog__resize-handle dialog__resize-handle--right" onMouseDown={(e) => handleResizeMouseDown(e, 'right')} />
            <div className="dialog__resize-handle dialog__resize-handle--bottom" onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')} />
            <div className="dialog__resize-handle dialog__resize-handle--left" onMouseDown={(e) => handleResizeMouseDown(e, 'left')} />
            <div className="dialog__resize-handle dialog__resize-handle--top-left" onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')} />
            <div className="dialog__resize-handle dialog__resize-handle--top-right" onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')} />
            <div className="dialog__resize-handle dialog__resize-handle--bottom-left" onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')} />
            <div className="dialog__resize-handle dialog__resize-handle--bottom-right" onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')} />
          </>
        )}

        {/* Header */}
        <DialogHeader
          title={`${title} (${currentWidth}px)`}
          logo={logo}
          onClose={onClose}
          maximizable={maximizable}
          isMaximized={isMaximized}
          onMaximize={() => setIsMaximized(!isMaximized)}
          onMouseDown={handleDragMouseDown}
          os={os}
        />

        {/* Optional header content */}
        {headerContent && (
          <div className="dialog__header-content">
            {headerContent}
          </div>
        )}

        {/* Body */}
        {customLayout ? (
          // Custom layout - render children directly without wrapper
          children
        ) : (
          <>
            <div className={`dialog__body ${noPadding ? 'dialog__body--no-padding' : ''}`}>
              {children}
            </div>
            {/* Footer - rendered as sibling to body, ignores body padding */}
            {footer}
          </>
        )}
      </div>
    </div>
  );
}

export default Dialog;
