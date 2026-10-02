/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState, type ReactNode } from 'react';
import { Knob } from '@soundscaper/design-system/Knob';
import { CommitField } from './inspector-controls.jsx';

interface ClipPropertyKnobProps {
	readonly name: string;
	readonly label: string;
	readonly value: string | number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly defaultValue: number;
	readonly mode?: 'bipolar' | 'unipolar';
	readonly disabled: boolean;
	readonly children?: ReactNode;
	readonly onCommit: (name: string, value: string | number) => void;
	readonly formatKnobValue?: (value: number) => string;
	readonly onKnobCommit: (value: number) => void;
}

/** Keep a knob gesture as one edit while allowing an exact numeric value. */
export default function ClipPropertyKnob({ name, label, value, min, max,
	step, defaultValue, mode = 'bipolar', disabled, children, onCommit, onKnobCommit, formatKnobValue = String }: ClipPropertyKnobProps) {
	const [gestureValue, setGestureValue] = useState<number | null>(null);
	const displayValue = gestureValue === null ? value : formatKnobValue(gestureValue);
	return <div className="audio-editor-clip-property-knob" data-clip-knob={name}>
		<span>{label}</span>
		<div className="audio-editor-clip-property-knob__row">
			<Knob label={label} value={gestureValue ?? Number(value)} min={min} max={max} step={step}
				defaultValue={defaultValue} mode={mode} disabled={disabled} onChange={setGestureValue}
				onGestureEnd={(next) => { onKnobCommit(next); setGestureValue(null); }}
				onGestureCancel={() => setGestureValue(null)} />
			<CommitField label={label} name={name} value={displayValue} type="number" disabled={disabled}
				visuallyHiddenLabel readOnly={false} multiline={false} onCommit={onCommit} />
			{children}
		</div>
	</div>;
}
