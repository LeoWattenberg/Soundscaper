/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, type ReactNode } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import './AudacityNoiseReductionControls.css';

interface AudacityNoiseReductionControlsProps {
	readonly copy?: Parameters<typeof canonicalCopyValue>[1];
	readonly parameters?: Readonly<Record<string, unknown>>;
	readonly renderParameter: (name: string) => ReactNode;
	readonly disabled?: boolean;
	readonly onChangeOutput?: (value: 'reduce' | 'residue') => void;
}

/** The second card in Audacity's pinned NoiseReductionView.qml; profile capture
 * remains with the editor's existing first-step context owner. */
export default function AudacityNoiseReductionControls({
	copy, parameters = {}, renderParameter, disabled = false, onChangeOutput,
}: AudacityNoiseReductionControlsProps) {
	const name = useId();
	const label = (key: string) => canonicalCopyValue(key, copy);
	const output = parameters.output === 'residue' ? 'residue' : 'reduce';
	const choices = [
		{ value: 'reduce', key: 'effectAudacityNoiseRemoved' },
		{ value: 'residue', key: 'effectAudacityNoiseOnly' },
	] as const;
	return <section className="audio-editor-audacity-noise__reduction">
		<h3>{label('effectAudacityNoiseStep2')}</h3>
		<p>{label('effectAudacityNoiseReductionInstructions')}</p>
		<div className="audio-editor-audacity-noise__parameters">
			{['reductionDb', 'sensitivity', 'frequencySmoothingBands'].map(parameter => <div
				className="audio-editor-audacity-layout__parameter" data-audacity-parameter={parameter} key={parameter}>
				{renderParameter(parameter)}
			</div>)}
		</div>
		<div className="audio-editor-audacity-noise__output" role="radiogroup" aria-label={label('effectParamAudacityNoiseReductionOutput')}>
			<span>{label('effectParamAudacityNoiseReductionOutput')}</span>
			{choices.map(choice => <label className="audio-editor-audacity-noise__choice" key={choice.value}>
				<input type="radio" name={name} value={choice.value} disabled={disabled || !onChangeOutput}
					checked={output === choice.value} onChange={() => { onChangeOutput?.(choice.value); }} />
				{label(choice.key)}
			</label>)}
		</div>
	</section>;
}
