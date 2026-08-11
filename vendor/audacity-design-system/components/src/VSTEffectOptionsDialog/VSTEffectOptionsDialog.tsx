/**
 * VSTEffectOptionsDialog - Options dialog for VST/3rd party effects
 * Based on Figma design: node-id=11921-29532
 */

import React, { useState } from 'react';
import { Dialog } from '../Dialog';
import { TextInput } from '../TextInput';
import { Checkbox } from '../Checkbox';
import { Button } from '../Button';
import { useTheme } from '../ThemeProvider';
import './VSTEffectOptionsDialog.css';

export interface VSTEffectOptionsDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Callback when dialog should close
   */
  onClose: () => void;
  /**
   * Initial buffer size value
   * @default 8192
   */
  bufferSize?: number;
  /**
   * Initial latency compensation enabled state
   * @default true
   */
  latencyCompensation?: boolean;
  /**
   * Callback when OK is clicked
   */
  onConfirm?: (bufferSize: number, latencyCompensation: boolean) => void;
}

/**
 * VSTEffectOptionsDialog - Options dialog for configuring VST/3rd party effects
 */
export function VSTEffectOptionsDialog({
  isOpen,
  onClose,
  bufferSize: initialBufferSize = 8192,
  latencyCompensation: initialLatencyCompensation = true,
  onConfirm,
}: VSTEffectOptionsDialogProps) {
  const { theme } = useTheme();
  const [bufferSize, setBufferSize] = useState(initialBufferSize.toString());
  const [latencyCompensation, setLatencyCompensation] = useState(initialLatencyCompensation);

  const style = {
    '--vst-options-text-primary': theme.foreground.text.primary,
    '--vst-options-info-bg': theme.background.surface.elevated,
    '--vst-options-border': theme.border.default,
    '--vst-options-footer-bg': theme.background.surface.default,
    '--vst-options-footer-border': theme.border.default,
  } as React.CSSProperties;

  const handleConfirm = () => {
    const bufferSizeNum = parseInt(bufferSize, 10);
    if (!isNaN(bufferSizeNum)) {
      onConfirm?.(bufferSizeNum, latencyCompensation);
    }
    onClose();
  };

  const handleCancel = () => {
    // Reset to initial values
    setBufferSize(initialBufferSize.toString());
    setLatencyCompensation(initialLatencyCompensation);
    onClose();
  };

  const footer = (
    <div className="vst-options-dialog__footer" style={style}>
      <div className="vst-options-dialog__button-group">
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm}>
          OK
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      title="VST Effect options"
      onClose={onClose}
      width={400}
      footer={footer}
      footerBorder={true}
      os="windows"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', ...style }}>
        {/* Buffer size section */}
        <div className="vst-options-dialog__section">
          <div className="vst-options-dialog__section-label">Buffer size</div>
          <div className="vst-options-dialog__info-box">
            <div className="vst-options-dialog__info-text">
              The buffer size controls how many samples are sent to the effect. Most effects accept large buffers, which greatly reduces processing time. However, some effects require 8192 samples or fewer.
            </div>
            <div className="vst-options-dialog__field">
              <div className="vst-options-dialog__field-label">
                Buffer size (8 - 1048576 samples)
              </div>
              <div className="vst-options-dialog__input-wrapper">
                <TextInput
                  type="number"
                  value={bufferSize}
                  onChange={setBufferSize}
                  width="50%"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Latency compensation section */}
        <div className="vst-options-dialog__section">
          <div className="vst-options-dialog__section-label">Latency compensation</div>
          <div className="vst-options-dialog__info-box">
            <div className="vst-options-dialog__info-text">
              Some VST3 effects delay returning audio to Audacity, which can insert small silences. Enabling this option compensates for that delay, but may not work for all VST3 effects.
            </div>
            <div className="vst-options-dialog__checkbox-row">
              <Checkbox
                checked={latencyCompensation}
                onChange={setLatencyCompensation}
              />
              <div className="vst-options-dialog__checkbox-label">
                Enable compensation
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default VSTEffectOptionsDialog;
