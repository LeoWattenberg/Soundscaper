import React from 'react';
import { useTheme } from '../ThemeProvider';
import { Button } from '../Button';
import './EffectDialogFooter.css';

export interface EffectDialogFooterProps {
  /**
   * Called when Apply button is clicked
   */
  onApply?: () => void;

  /**
   * Called when Cancel button is clicked
   */
  onCancel: () => void;

  /**
   * Called when Preview button is clicked
   */
  onPreview?: () => void;

  /**
   * Whether preview is currently playing
   */
  isPreviewing?: boolean;

  /**
   * Optional content for left side (e.g., presets dropdown)
   */
  leftSlot?: React.ReactNode;

  /**
   * Additional CSS class
   */
  className?: string;
}

/**
 * EffectDialogFooter - Footer component for effect dialogs
 * Shows Preview button on left (if provided), Cancel and Apply buttons on right
 */
export const EffectDialogFooter: React.FC<EffectDialogFooterProps> = ({
  onApply,
  onCancel,
  onPreview,
  isPreviewing = false,
  leftSlot,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--effect-dialog-footer-bg': theme.background.surface.default,
    '--effect-dialog-footer-border': theme.border.divider,
  } as React.CSSProperties;

  return (
    <div className={`effect-dialog-footer ${className}`} style={style}>
      {/* Left side - Preview button or custom slot */}
      {onPreview ? (
        <Button
          variant="secondary"
          size="default"
          onClick={onPreview}
          disabled={isPreviewing}
          className="effect-dialog-footer__preview-button"
        >
          {isPreviewing ? 'Stop Preview' : 'Preview'}
        </Button>
      ) : (
        <div className="effect-dialog-footer__left">
          {leftSlot}
        </div>
      )}

      {/* Right side - Cancel and Apply buttons */}
      <div className="effect-dialog-footer__right">
        <Button
          variant="secondary"
          size="default"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="default"
          onClick={onApply}
        >
          Apply
        </Button>
      </div>
    </div>
  );
};

export default EffectDialogFooter;
