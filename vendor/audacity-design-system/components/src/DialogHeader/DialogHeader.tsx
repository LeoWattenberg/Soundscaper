/**
 * DialogHeader - Dialog header component with optional logo
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import './DialogHeader.css';

export interface DialogHeaderProps {
  /**
   * Header title text
   */
  title: string;
  /**
   * Optional logo URL
   */
  logo?: string;
  /**
   * Optional close button callback
   */
  onClose?: () => void;
  /**
   * Whether the dialog can be maximized
   */
  maximizable?: boolean;
  /**
   * Whether the dialog is currently maximized
   */
  isMaximized?: boolean;
  /**
   * Maximize button callback
   */
  onMaximize?: () => void;
  /**
   * Mouse down handler for dragging
   */
  onMouseDown?: (e: React.MouseEvent) => void;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * DialogHeader component - Header for dialogs with optional logo and close button
 */
export function DialogHeader({
  title,
  logo,
  onClose,
  maximizable = false,
  isMaximized = false,
  onMaximize,
  onMouseDown,
  os = 'macos',
  className = '',
}: DialogHeaderProps) {
  const { theme } = useTheme();

  const style = {
    '--dialog-header-bg': theme.background.surface.default,
    '--dialog-header-border': theme.border.default,
    '--dialog-header-text': theme.foreground.text.primary,
    '--dialog-header-focus': theme.border.focus,
  } as React.CSSProperties;

  // macOS variant - traffic lights on left
  if (os === 'macos') {
    return (
      <div className={`dialog-header dialog-header--macos ${className}`} onMouseDown={onMouseDown} style={style}>
        <div className="dialog-header__macos-controls">
          {onClose && (
            <button
              className="dialog-header__macos-button dialog-header__macos-button--close"
              onClick={onClose}
              aria-label="Close"
              type="button"
            />
          )}
          <button
            className="dialog-header__macos-button dialog-header__macos-button--minimize"
            aria-label="Minimize"
            type="button"
            disabled
          />
          {maximizable && onMaximize && (
            <button
              className="dialog-header__macos-button dialog-header__macos-button--maximize"
              onClick={onMaximize}
              aria-label={isMaximized ? "Restore" : "Maximize"}
              type="button"
            />
          )}
        </div>
        <div className="dialog-header__macos-title">
          {logo && (
            <img
              src={logo}
              alt=""
              className="dialog-header__logo"
            />
          )}
          <span className="dialog-header__title">{title}</span>
        </div>
      </div>
    );
  }

  // Windows variant - controls on right
  return (
    <div className={`dialog-header dialog-header--windows ${className}`} onMouseDown={onMouseDown} style={style}>
      <div className="dialog-header__windows-title">
        {logo && (
          <img
            src={logo}
            alt=""
            className="dialog-header__logo"
          />
        )}
        <span className="dialog-header__title">{title}</span>
      </div>
      <div className="dialog-header__windows-controls">
        {maximizable && onMaximize && (
          <button
            className="dialog-header__windows-control dialog-header__windows-control--maximize"
            onClick={onMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
            type="button"
          >
            {isMaximized ? '\uE923' : '\uE922'}
          </button>
        )}
        {onClose && (
          <button
            className="dialog-header__windows-control dialog-header__windows-control--close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            {'\uE8BB'}
          </button>
        )}
      </div>
    </div>
  );
}

export default DialogHeader;
