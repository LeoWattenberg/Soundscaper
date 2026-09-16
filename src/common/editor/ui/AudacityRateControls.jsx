/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import ParameterNumber from './inspector/EffectParameterNumber.jsx';
import { LabeledDropdown } from './inspector/inspector-controls.jsx';
import { audacityVinylRateAvailable } from './audacity-derived-controls.ts';

const VINYL_RATES = [100 / 3, 45, 78];
const VINYL_OPTIONS = [{ value: 'n/a', label: 'n/a' }, ...VINYL_RATES.map(value => ({
	value: String(value), label: value === 100 / 3 ? '33⅓' : String(value),
}))];

/** Audacity's alternate rate and duration fields express the same supported
 * percent parameter; their edits keep the ordinary automation commit path. */
export default function AudacityRateControls({ effectType, parameters, effectContext = {}, renderParameter, copy,
	disabled = false, parameterRange = [-50, 100], sampleRate = undefined }) {
	const tempo = effectType === 'audacity-change-tempo';
	const name = tempo ? 'tempoPercent' : 'speedPercent';
	const control = renderParameter(name);
	const percent = Number(parameters[name]) || 0;
	const multiplier = 1 + percent / 100;
	const [fromBpm, setFromBpm] = useState(0);
	const [fromRpm, setFromRpm] = useState(100 / 3);
	const sourceDuration = Number(effectContext.selectionDuration);
	const label = key => canonicalCopyValue(key, copy);
	const commit = next => {
		const value = Number(Math.min(100, Math.max(-50, next)).toFixed(3));
		return control?.props?.onCommit?.(value, { controlValue: value });
	};
	const number = (key, value, range, onCommit, unit = null, locked = false, step = 0.001) => <ParameterNumber
		label={`${label(key)}${unit ? ` (${unit})` : ''}`} displayLabel={label(key)} valueUnit={unit}
		value={value} range={range} step={step}
		presentation="number" copy={copy} disabled={disabled || locked} hook={key}
		sampleRate={sampleRate}
		timeCodeUnit={!tempo && unit === 's' ? 'seconds' : null} onCommit={onCommit} />;
	const toRpm = VINYL_RATES.find(value => Math.abs(value - fromRpm * multiplier) < 0.01);
	const destinationRpmOptions = VINYL_OPTIONS.map(option => ({
		...option,
		disabled: option.value !== 'n/a' && !audacityVinylRateAvailable(fromRpm, Number(option.value), parameterRange),
	}));
	const sourceRpmOptions = VINYL_OPTIONS.map(option => ({
		...option,
		disabled: option.value !== 'n/a' && toRpm !== undefined
			&& !audacityVinylRateAvailable(Number(option.value), toRpm, parameterRange),
	}));
	return <div className="audio-editor-audacity-rate">
		{!tempo && number('effectAudacitySpeedMultiplier', Number(multiplier.toFixed(3)), [0.5, 2], next => commit((next - 1) * 100))}
		<div data-audacity-parameter={name}>{control}</div>
		{tempo ? <section className="audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed">
			<h3 className="audio-editor-audacity-port__heading">{label('effectAudacityBeatsPerMinute')}</h3>
			<div className="audio-editor-audacity-pitch__pair">
				{number('effectAudacityFromBpm', fromBpm || '', [1, 1_000], next => {
					setFromBpm(next);
					if (fromBpm) void commit((fromBpm * multiplier / next - 1) * 100);
				})}
				{number('effectAudacityToBpm', fromBpm ? Number((fromBpm * multiplier).toFixed(3)) : '',
					[fromBpm * 0.5, fromBpm * 2], next => commit((next / fromBpm - 1) * 100), null, !fromBpm)}
			</div>
		</section> : <section className="audio-editor-audacity-port__section">
			<h3 className="audio-editor-audacity-port__heading">{label('effectAudacityVinylRpm')}</h3>
			<div className="audio-editor-audacity-pitch__pair">
				<LabeledDropdown label={label('effectAudacityFromRpm')} value={String(fromRpm)}
					options={sourceRpmOptions} disabled={disabled} hook="effect-from-rpm" onChange={next => {
						if (next === 'n/a') return;
						if (toRpm && !audacityVinylRateAvailable(Number(next), toRpm, parameterRange)) return;
						setFromRpm(Number(next));
						if (toRpm) void commit((toRpm / Number(next) - 1) * 100);
					}} />
				<LabeledDropdown label={label('effectAudacityToRpm')} value={toRpm ? String(toRpm) : 'n/a'}
					options={destinationRpmOptions} disabled={disabled} hook="effect-to-rpm" onChange={next => {
						if (next !== 'n/a' && audacityVinylRateAvailable(fromRpm, Number(next), parameterRange)) {
							void commit((Number(next) / fromRpm - 1) * 100);
						}
					}} />
			</div>
		</section>}
		{sourceDuration > 0 && Number.isFinite(sourceDuration) && <section className="audio-editor-audacity-port__section audio-editor-audacity-port__section--boxed">
			<h3 className="audio-editor-audacity-port__heading">{label('effectAudacitySelectionLength')}</h3>
			<div className="audio-editor-audacity-pitch__pair">
				{number('effectAudacityCurrentLength', sourceDuration, [0, sourceDuration], () => undefined, 's', true)}
				{number('effectAudacityNewLength', Number((sourceDuration / multiplier).toFixed(3)),
					[sourceDuration / 2, sourceDuration * 2], next => commit((sourceDuration / next - 1) * 100), 's')}
			</div>
		</section>}
	</div>;
}
