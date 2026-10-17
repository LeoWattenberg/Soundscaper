/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1 } from '../../video-global-develop-v1.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';

export default function PhotoDevelopQuickSettings(props: Readonly<{ disabled: boolean; messages: PhotoDevelopSettingsCopyV1;
	isCurrent: () => boolean; onApply: (type: 'white-balance-v1' | 'tone-ladder-v1', changes: Readonly<Record<string, number>>) => void }>) {
	const [type, setType] = useState<'white-balance-v1' | 'tone-ladder-v1'>('tone-ladder-v1'), [parameter, setParameter] = useState('exposure'), [delta, setDelta] = useState('0');
	const { messages, disabled } = props, definition = GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1[type];
	const current = () => !disabled && props.isCurrent();
	const range = definition.params[parameter as keyof typeof definition.params];
	return <fieldset disabled={disabled}><legend>{messages.quick}</legend>
		<label>{messages.adjustment}<select aria-label={messages.adjustment} value={type} onChange={event => {
			if (!current()) return; const next = event.currentTarget.value as typeof type; setType(next); setParameter(next === 'white-balance-v1' ? 'temperature' : 'exposure'); setDelta('0');
		}}>{Object.entries(GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1).map(([key, value]) => <option key={key} value={key}>{messages.shared[value.labelKey] ?? value.label}</option>)}</select></label>
		<label>{messages.parameter}<select aria-label={messages.parameter} value={parameter} onChange={event => { if (current()) { setParameter(event.currentTarget.value); setDelta('0'); } }}>
			{Object.entries(definition.params).map(([key, value]) => <option key={key} value={key}>{messages.shared[value.labelKey] ?? value.label}</option>)}</select></label>
		<label>{messages.delta}<input aria-label={messages.delta} type="number" value={delta} step={range?.step ?? 0.01}
			min={range ? range.min - range.max : undefined} max={range ? range.max - range.min : undefined}
			onChange={event => { if (current()) setDelta(event.currentTarget.value); }} /></label>
		<button type="button" disabled={disabled || !delta || !Number.isFinite(Number(delta)) || Number(delta) === 0} onClick={() => {
			if (current() && delta && Number.isFinite(Number(delta))) props.onApply(type, { [parameter]: Number(delta) });
		}}>{messages.applyQuick}</button>
	</fieldset>;
}
