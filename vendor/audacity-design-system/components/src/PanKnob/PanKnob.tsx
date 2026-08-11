import React from 'react';
import { Knob, type KnobProps } from '../Knob';

export interface PanKnobProps extends Omit<KnobProps, 'min' | 'max' | 'mode'> {
  /**
   * Pan value: -100 (full left) to 100 (full right)
   */
  value?: number;
}

/**
 * PanKnob - Specialized knob for pan controls
 * Wrapper around the generic Knob component with pan-specific defaults
 */
export const PanKnob: React.FC<PanKnobProps> = (props) => {
  return (
    <Knob
      {...props}
      min={-100}
      max={100}
      mode="bipolar"
      label={props.label || 'Pan'}
    />
  );
};

export default PanKnob;
