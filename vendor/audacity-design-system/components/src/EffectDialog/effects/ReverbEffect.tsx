import React, { useState } from 'react';
import { useTheme } from '../../ThemeProvider';
import { Knob } from '../../Knob';
import './ReverbEffect.css';

export interface ReverbEffectProps {
  /**
   * Initial decay time in seconds
   */
  initialDecay?: number;

  /**
   * Initial pre-delay time in seconds
   */
  initialPreDelay?: number;

  /**
   * Initial wet/dry mix (0-1, where 1 is 100% wet)
   */
  initialWet?: number;

  /**
   * Called when parameters change
   */
  onChange?: (params: { decay: number; preDelay: number; wet: number }) => void;
}

/**
 * ReverbEffect - Controls for the Reverb audio effect
 * A convolution-based reverb that creates spatial/room effects
 */
export const ReverbEffect: React.FC<ReverbEffectProps> = ({
  initialDecay = 1.5,
  initialPreDelay = 0.01,
  initialWet = 1,
  onChange,
}) => {
  const { theme } = useTheme();
  const [decay, setDecay] = useState(initialDecay);
  const [preDelay, setPreDelay] = useState(initialPreDelay);
  const [wet, setWet] = useState(initialWet);

  const style = {
    '--reverb-label-color': theme.foreground.text.primary,
    '--reverb-input-bg': theme.background.control.input.idle,
    '--reverb-input-border': theme.border.input.idle,
  } as React.CSSProperties;

  const handleDecayChange = (value: number) => {
    setDecay(value);
    onChange?.({ decay: value, preDelay, wet });
  };

  const handlePreDelayChange = (value: number) => {
    setPreDelay(value);
    onChange?.({ decay, preDelay: value, wet });
  };

  const handleWetChange = (value: number) => {
    setWet(value);
    onChange?.({ decay, preDelay, wet: value });
  };

  return (
    <div className="reverb-effect" style={style}>
      {/* Knobs Row */}
      <div className="reverb-effect__knobs">
        <div className="reverb-effect__knob-container">
          <Knob
            value={decay}
            min={0.1}
            max={10}
            step={0.1}
            mode="unipolar"
            label="Decay"
            onChange={handleDecayChange}
          />
          <span className="reverb-effect__knob-label">Decay</span>
          <span className="reverb-effect__knob-value">{decay.toFixed(1)}s</span>
        </div>

        <div className="reverb-effect__knob-container">
          <Knob
            value={preDelay}
            min={0}
            max={0.5}
            step={0.01}
            mode="unipolar"
            label="Pre-Delay"
            onChange={handlePreDelayChange}
          />
          <span className="reverb-effect__knob-label">Pre-Delay</span>
          <span className="reverb-effect__knob-value">{(preDelay * 1000).toFixed(0)}ms</span>
        </div>

        <div className="reverb-effect__knob-container">
          <Knob
            value={wet}
            min={0}
            max={1}
            step={0.01}
            mode="unipolar"
            label="Wet/Dry"
            onChange={handleWetChange}
          />
          <span className="reverb-effect__knob-label">Wet/Dry</span>
          <span className="reverb-effect__knob-value">{(wet * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
};

export default ReverbEffect;
