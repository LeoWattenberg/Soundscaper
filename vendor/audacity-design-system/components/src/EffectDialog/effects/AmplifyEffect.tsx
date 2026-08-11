import React, { useState } from 'react';
import { useTheme } from '../../ThemeProvider';
import './AmplifyEffect.css';

export interface AmplifyEffectProps {
  /**
   * Initial amplification value in dB
   */
  initialAmplification?: number;

  /**
   * Initial clipping setting
   */
  initialAllowClipping?: boolean;

  /**
   * Called when parameters change
   */
  onChange?: (params: { amplification: number; allowClipping: boolean }) => void;
}

/**
 * AmplifyEffect - Controls for the Amplify audio effect
 * Allows users to increase or decrease the volume of audio
 */
export const AmplifyEffect: React.FC<AmplifyEffectProps> = ({
  initialAmplification = 0,
  initialAllowClipping = false,
  onChange,
}) => {
  const { theme } = useTheme();
  const [amplification, setAmplification] = useState(initialAmplification);
  const [allowClipping, setAllowClipping] = useState(initialAllowClipping);

  const style = {
    '--amplify-label-color': theme.foreground.text.primary,
    '--amplify-input-bg': theme.background.control.input.idle,
    '--amplify-input-border': theme.border.input.idle,
    '--amplify-input-text': theme.foreground.text.primary,
    '--amplify-slider-track': theme.border.divider,
    '--amplify-slider-thumb': theme.background.control.button.primary.idle,
  } as React.CSSProperties;

  const handleAmplificationChange = (value: number) => {
    setAmplification(value);
    onChange?.({ amplification: value, allowClipping });
  };

  const handleClippingChange = (checked: boolean) => {
    setAllowClipping(checked);
    onChange?.({ amplification, allowClipping: checked });
  };

  return (
    <div className="amplify-effect" style={style}>
      <div className="amplify-effect__section">
        <label className="amplify-effect__label" htmlFor="amplification-input">
          Amplification (dB):
        </label>
        <div className="amplify-effect__control-row">
          <input
            id="amplification-slider"
            type="range"
            min="-50"
            max="50"
            step="0.1"
            value={amplification}
            onChange={(e) => handleAmplificationChange(parseFloat(e.target.value))}
            className="amplify-effect__slider"
          />
          <input
            id="amplification-input"
            type="number"
            min="-50"
            max="50"
            step="0.1"
            value={amplification}
            onChange={(e) => handleAmplificationChange(parseFloat(e.target.value))}
            className="amplify-effect__input"
          />
        </div>
      </div>

      <div className="amplify-effect__section">
        <label className="amplify-effect__checkbox-label">
          <input
            type="checkbox"
            checked={allowClipping}
            onChange={(e) => handleClippingChange(e.target.checked)}
            className="amplify-effect__checkbox"
          />
          <span>Allow clipping</span>
        </label>
      </div>

      <div className="amplify-effect__info">
        <p className="amplify-effect__info-text">
          New Peak Amplitude: {(amplification > 0 ? '+' : '')}{amplification.toFixed(1)} dB
        </p>
      </div>
    </div>
  );
};

export default AmplifyEffect;
