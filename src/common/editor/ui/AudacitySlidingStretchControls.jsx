/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useId } from 'react';
import {
	canonicalCopyValue, effectParameterCopyKey,
} from '../../i18n/canonical-extras.js';
import ParameterNumber from './inspector/EffectParameterNumber.jsx';
import {
	audacityPitchPercent, audacityPitchPercentGesture, audacitySemitonesFromPercent,
} from './audacity-derived-controls.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

const CARDS = [
	{ id: 'initial-tempo', name: 'startTempoPercent', title: 'effectCardInitialTempoChange', tempo: true },
	{ id: 'final-tempo', name: 'endTempoPercent', title: 'effectCardFinalTempoChange', tempo: true },
	{ id: 'initial-pitch', name: 'startPitchSemitones', title: 'effectCardInitialPitchShift' },
	{ id: 'final-pitch', name: 'endPitchSemitones', title: 'effectCardFinalPitchShift' },
];

/** Audacity's four sliding-stretch cards retain their supported parameters;
 * each pitch percentage is an alternate view of its existing semitone value. */
export default function AudacitySlidingStretchControls({ parameters, definition, renderParameter, copy, disabled = false }) {
	const id = useId();
	const label = key => canonicalCopyValue(key, copy);
	return <>{CARDS.map(card => {
		const control = renderParameter(card.name);
		const descriptor = definition.params[card.name];
		const minimum = descriptor.minimum ?? -12;
		const maximum = descriptor.maximum ?? 12;
		const value = Number(parameters[card.name]) || 0;
		const semitoneLabel = formatLocalizedTemplate(label('effectAudacitySemitoneRange'), {
			minimum: String(minimum), maximum: String(maximum),
		});
		const pitchControl = React.isValidElement(control) ? React.cloneElement(control, {
			copy: { ...copy, [effectParameterCopyKey('audacity-sliding-stretch', card.name)]: semitoneLabel },
			descriptor: { ...control.props.descriptor, unit: '' },
		}) : control;
		const commitPercent = next => {
			const semitones = Number(audacitySemitonesFromPercent(next).toFixed(2));
			return control?.props?.onCommit?.(semitones, { controlValue: semitones });
		};
		const gesture = control?.props?.gestureFor?.(card.name) || {};
		return <section key={card.id} aria-labelledby={`${id}-${card.id}`}
			className={`audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed audio-editor-audacity-sliding__${card.tempo ? 'tempo' : 'pitch'}`}
			data-audacity-port-section={card.id}>
			<h3 id={`${id}-${card.id}`} className="audio-editor-audacity-port__heading">{label(card.title)}</h3>
			<div data-audacity-parameter={card.name}>{card.tempo ? control : pitchControl}</div>
			{!card.tempo && <ParameterNumber label={label('effectAudacityPercentageChange')}
				displayLabel={label('effectAudacityPercentageChange')} valueUnit="%"
				value={Number(audacityPitchPercent(value).toFixed(3))}
				range={[audacityPitchPercent(minimum), audacityPitchPercent(maximum)]}
				step={0.1} presentation="slider" copy={copy} disabled={disabled}
				hook={`${card.name}Percent`} timeCodeUnit={null} onCommit={commitPercent}
				{...audacityPitchPercentGesture(gesture)} />}
		</section>;
	})}</>;
}
