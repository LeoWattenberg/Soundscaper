/**
 * AlertDialog - Simple blocking alert/error dialog
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import { DialogHeader } from '../DialogHeader';
import { DialogFooter } from '../Footer';
import { Button } from '../Button';
import './AlertDialog.css';

export interface AlertDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Callback when the dialog is closed
   */
  onClose: () => void;
  /**
   * Dialog title
   */
  title: string;
  /**
   * Dialog message
   */
  message: string;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Button text
   * @default 'OK'
   */
  buttonText?: string;
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  message,
  os = 'macos',
  buttonText = 'OK',
}: AlertDialogProps) {
  const { theme } = useTheme();

  const style = {
    '--alert-dialog-bg': theme.background.dialog.body,
    '--alert-dialog-text': theme.foreground.text.primary,
    '--alert-dialog-border': theme.border.default,
  } as React.CSSProperties;

  if (!isOpen) return null;

  return (
    <div className="alert-dialog__overlay" onClick={onClose}>
      <div
        className="alert-dialog"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title={title} onClose={onClose} os={os} />

        <div className="alert-dialog__body">
          <p className="alert-dialog__message">{message}</p>
        </div>

        <DialogFooter
          rightContent={
            <Button variant="primary" onClick={onClose}>
              {buttonText}
            </Button>
          }
        />
      </div>
    </div>
  );
}

export default AlertDialog;
