import React from 'react';
import { useTheme } from '../ThemeProvider';
import { usePreferences } from '../contexts/PreferencesContext';
import { DialogHeader } from '../DialogHeader';
import { EffectDialogFooter } from './EffectDialogFooter';
import './EffectDialog.css';

export interface EffectDialogProps {
  /**
   * Effect name displayed in header
   */
  effectName: string;

  /**
   * Whether the dialog is open
   */
  isOpen: boolean;

  /**
   * Called when dialog should close
   */
  onClose: () => void;

  /**
   * Called when OK button is clicked
   */
  onOk?: () => void;

  /**
   * Called when Preview button is clicked
   */
  onPreview?: () => void;

  /**
   * Whether preview is currently playing
   */
  isPreviewing?: boolean;

  /**
   * Effect content (parameters, controls, preview, etc.)
   */
  children: React.ReactNode;

  /**
   * Optional presets dropdown content
   */
  presetsSlot?: React.ReactNode;

  /**
   * Optional effect header slot (for automation, presets, etc.)
   */
  headerSlot?: React.ReactNode;

  /**
   * Width of dialog (default: 600px)
   */
  width?: number;

  /**
   * Height of dialog (default: 500px)
   */
  height?: number;

  /**
   * Additional CSS class
   */
  className?: string;

  /**
   * Whether to hide the footer (for real-time effects)
   */
  hideFooter?: boolean;
}

/**
 * EffectDialog - Base dialog component for audio effects
 * Provides standard layout: header, content area, and footer with Preview/Cancel/OK
 */
export const EffectDialog: React.FC<EffectDialogProps> = ({
  effectName,
  isOpen,
  onClose,
  onOk,
  onPreview,
  isPreviewing = false,
  children,
  presetsSlot,
  headerSlot,
  width = 600,
  height = 500,
  className = '',
  hideFooter = false,
}) => {
  const { theme } = useTheme();
  const { preferences } = usePreferences();

  const style = {
    '--effect-dialog-bg': theme.background.surface.default,
    '--effect-dialog-border': theme.border.default,
    '--effect-dialog-shadow': '0 8px 32px rgba(0, 0, 0, 0.4)',
    '--effect-dialog-content-bg': theme.background.surface.default,
    '--effect-dialog-footer-bg': theme.background.surface.elevated,
    '--effect-dialog-footer-border': theme.border.divider,
  } as React.CSSProperties;

  const dialogRef = React.useRef<HTMLDivElement>(null);

  // Auto-focus the dialog when it opens
  React.useEffect(() => {
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="effect-dialog-backdrop" onClick={onClose} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className={`effect-dialog ${className}`}
        style={{
          ...style,
          width: `${width}px`,
          height: `${height}px`,
        }}
        role="dialog"
        aria-labelledby="effect-dialog-title"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <DialogHeader
          title={effectName}
          onClose={onClose}
          os={preferences.operatingSystem}
        />

        {/* Effect Header (automation, presets, etc.) */}
        {headerSlot}

        {/* Content */}
        <div className="effect-dialog__content">
          {children}
        </div>

        {/* Footer */}
        {!hideFooter && (
          <EffectDialogFooter
            onApply={() => {
              onOk?.();
              onClose();
            }}
            onCancel={onClose}
            onPreview={onPreview}
            isPreviewing={isPreviewing}
            leftSlot={presetsSlot}
          />
        )}
      </div>
    </>
  );
};

export default EffectDialog;
