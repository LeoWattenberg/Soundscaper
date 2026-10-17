import React from 'react';
import { Knob, type KnobProps } from '../Knob';
import { ManualValueDialog } from '../ManualValueDialog/ManualValueDialog';
import { useValueContextMenu } from '../hooks/useValueContextMenu';

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
  const [manualOpen, setManualOpen] = React.useState(false);
  const applyManual = (next: number) => {
    if (props.disabled || !props.onChange) return;
    props.onGestureStart?.(props.value ?? 0);
    props.onChange(next);
    props.onGestureEnd?.(next);
  };
  const menu = useValueContextMenu({
    onEnterValue: () => setManualOpen(true), disabled: props.disabled || !props.onChange,
    onReset: () => applyManual(props.defaultValue ?? 0), resetLabel: 'centre',
  });
  return (
    <span style={{ display: 'contents' }} onContextMenu={menu.onContextMenu}>
    <Knob
      {...props}
      defaultValue={props.defaultValue ?? 0}
      min={-100}
      max={100}
      mode="bipolar"
      label={props.label || 'Pan'}
    />
    {menu.menu}
    <ManualValueDialog isOpen={manualOpen} title={props.label || 'Pan'} value={props.value ?? 0}
      min={-100} max={100} onApply={applyManual} onClose={() => setManualOpen(false)} />
    </span>
  );
};

export default PanKnob;
