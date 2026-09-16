/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import ParameterNumber from './inspector/EffectParameterNumber.jsx';
import { LabeledDropdown } from './inspector/inspector-controls.jsx';
import {
	audacityPitchParts,
	audacityPitchPercent,
	audacityPitchPercentGesture,
	audacitySemitonesFromFrequencies,
	audacitySemitonesFromPercent,
} from './audacity-derived-controls.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

const PITCHES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
const noteFrequency = (note, octave) => 440 * 2 ** ((note + (octave + 1) * 12 - 69) / 12);
function pitchNote(frequency) {
	const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
	return { note: ((midi % 12) + 12) % 12, octave: Math.floor(midi / 12) - 1 };
}

/** The note, cents, frequency and percentage inputs all edit the same pitch
 * parameter through its existing automation-aware commit callback. */
export default function AudacityPitchControls({ parameters, effectContext = {}, renderParameter, copy, disabled = false }) {
	const detected = Number(effectContext.detectedPitchHz);
	const [fromFrequency, setFromFrequency] = useState(Number.isFinite(detected) && detected > 0 ? detected : 440);
	const semitones = Number(parameters.semitones) || 0;
	const parts = audacityPitchParts(semitones);
	const toFrequency = fromFrequency * 2 ** (semitones / 12);
	const from = pitchNote(fromFrequency);
	const to = pitchNote(toFrequency);
	const control = renderParameter('semitones');
	const commit = next => {
		const value = Number(Math.min(12, Math.max(-12, next)).toFixed(2));
		return control?.props?.onCommit?.(value, { controlValue: value });
	};
	const changeFrom = next => {
		setFromFrequency(next);
		void commit(audacitySemitonesFromFrequencies(next, toFrequency));
	};
	const changeTo = next => { void commit(audacitySemitonesFromFrequencies(fromFrequency, next)); };
	const label = key => canonicalCopyValue(key, copy);
	const number = (key, value, range, onCommit, unit, step = 1, presentation = 'number', gesture = {}) => <ParameterNumber
		label={`${label(key)}${unit ? ` (${unit})` : ''}`} displayLabel={label(key)} valueUnit={unit}
		value={value} range={range} step={step}
		presentation={presentation} copy={copy} disabled={disabled} hook={key}
		timeCodeUnit={null} onCommit={onCommit} {...gesture} />;
	const pitch = (side, value, frequencyChange) => <div className="audio-editor-audacity-pitch__note">
		<LabeledDropdown label={label(side === 'from' ? 'effectAudacityFromPitch' : 'effectAudacityToPitch')}
			value={String(value.note)} options={PITCHES.map((name, index) => ({ value: String(index), label: name }))}
			onChange={next => frequencyChange(noteFrequency(Number(next), value.octave))}
			disabled={disabled} hook={`effect-${side}-pitch`} />
		{number(side === 'from' ? 'effectAudacityFromOctave' : 'effectAudacityToOctave', value.octave, [-1, 9],
			next => frequencyChange(noteFrequency(value.note, next)))}
	</div>;
	const estimated = Number.isFinite(detected) && detected > 0
		? formatLocalizedTemplate(label('effectAudacityEstimatedPitch'), {
			pitch: `${PITCHES[from.note]}${from.octave}`, frequency: fromFrequency.toFixed(3),
		}) : label('effectAudacityUnknownEstimatedPitch');
	return <div className="audio-editor-audacity-pitch">
		<p className="audio-editor-audacity-pitch__estimate">{estimated}</p>
		<section className="audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed">
			<div className="audio-editor-audacity-pitch__pair">{pitch('from', from, changeFrom)}{pitch('to', to, changeTo)}</div>
		</section>
		<section className="audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed">
			<div className="audio-editor-audacity-pitch__pair">
				<div data-audacity-parameter="semitones">{React.isValidElement(control) ? React.cloneElement(control, {
					value: parts.semitones,
					descriptor: { ...control.props.descriptor, step: 1, unit: '' },
					onCommit: next => commit(next + parts.cents / 100),
				}) : control}</div>
				{number('effectAudacityCents', parts.cents, [0, semitones >= 12 ? 0 : 99], next => commit(parts.semitones + next / 100))}
			</div>
		</section>
		<section className="audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed">
			<div className="audio-editor-audacity-pitch__pair">
				{number('effectAudacityFromFrequency', Number(fromFrequency.toFixed(3)), [1, 100_000], changeFrom, 'Hz')}
				{number('effectAudacityToFrequency', Number(toFrequency.toFixed(3)), [1, 100_000], changeTo, 'Hz')}
			</div>
			{number('effectAudacityPercentageChange', Number(audacityPitchPercent(semitones).toFixed(3)), [-50, 100],
				next => commit(audacitySemitonesFromPercent(next)), null, 0.1, 'slider',
				audacityPitchPercentGesture(control?.props?.gestureFor?.('semitones') || {}))}
		</section>
	</div>;
}
