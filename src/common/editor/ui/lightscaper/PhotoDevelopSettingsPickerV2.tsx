/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_DEFINITIONS_V2 } from '../../video-effects-v2.ts';
import { useRef } from 'react';
import type { ImageDevelopSelectionV1 } from '../../imaging/image-develop-settings-contract-v1.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';

export default function PhotoDevelopSettingsPickerV2(props: Readonly<{ value: ImageDevelopSelectionV1; disabled: boolean;
	messages: PhotoDevelopSettingsCopyV1; onChange: (value: ImageDevelopSelectionV1) => void; isCurrent: () => boolean }>) {
	const { value, messages, disabled } = props;
	const latest = useRef(props); latest.current = props;
	const change = (next: ImageDevelopSelectionV1) => {
		if (!disabled && latest.current === props && Reflect.apply(props.isCurrent, props, []) === true && latest.current === props) Reflect.apply(props.onChange, props, [next]);
	};
	return <fieldset disabled={disabled}><legend>{messages.picker}</legend>
		<label><input type="checkbox" checked={value.effectTypes === 'all'} onChange={event => {
			change({ ...value, effectTypes: event.currentTarget.checked ? 'all' : [] });
		}} />{messages.all}</label>
		{value.effectTypes !== 'all' && Object.entries(VIDEO_EFFECT_DEFINITIONS_V2).map(([type, definition]) => <label key={type}>
			<input type="checkbox" checked={value.effectTypes !== 'all' && value.effectTypes.includes(type)} onChange={event => {
				if (value.effectTypes !== 'all') change({ ...value, effectTypes: event.currentTarget.checked ? [...value.effectTypes, type] : value.effectTypes.filter(candidate => candidate !== type) });
			}} />{messages.shared[definition.labelKey] ?? definition.label}</label>)}
		<label><input type="checkbox" checked={value.geometry} onChange={event => { change({ ...value, geometry: event.currentTarget.checked }); }} />{messages.geometry}</label>
		<label><input type="checkbox" checked={value.localAdjustments} onChange={event => { change({ ...value, localAdjustments: event.currentTarget.checked }); }} />{messages.local}</label>
	</fieldset>;
}
