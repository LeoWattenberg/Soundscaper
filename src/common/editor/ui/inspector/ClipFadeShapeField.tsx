/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { SteppedSlider } from './inspector-controls.jsx';

interface Props {
	readonly name: string;
	readonly label: string;
	readonly value: number | undefined;
	readonly fadeFrames: number;
	readonly legacyLabel: string;
	readonly disabled: boolean;
	readonly onCommit: (name: string, value: number) => unknown;
}

/** Preview a fade-shape gesture locally and publish only its completion. */
export default function ClipFadeShapeField({ name, label, value, fadeFrames,
	legacyLabel, disabled, onCommit }: Props) {
	const [gestureValue, setGestureValue] = useState<number | null>(null);
	const legacy = value === undefined && fadeFrames > 0;
	const savedShape = value ?? (legacy ? 2 : 1);
	const shape = gestureValue ?? savedShape;
	const legacyDisplay = legacy && gestureValue === null;
	return <label className="audio-editor-field" data-clip-field={name}>
		<span>{label}</span>
		<div className="audio-editor-clip-fade-shape__row">
			<SteppedSlider value={shape} min={0.15} max={6} step={0.01} defaultValue={1}
				ariaLabel={label} valueText={legacyDisplay ? legacyLabel : undefined}
				disabled={disabled} onChange={setGestureValue}
				onGestureStart={() => setGestureValue(savedShape)}
				onGestureEnd={(next: number) => {
					if (next !== savedShape) onCommit(name, next);
					setGestureValue(null);
				}}
				onGestureCancel={() => setGestureValue(null)} />
			<output>{legacyDisplay ? legacyLabel : shape.toFixed(2)}</output>
		</div>
	</label>;
}
