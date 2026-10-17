/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import type { ImageDevelopSelectionV4 } from '../../imaging/image-develop-settings-contract-v4.ts';
import type { PhotoDevelopSettingsCopyV1 } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import PhotoDevelopSettingsPickerV2 from './PhotoDevelopSettingsPickerV2.tsx';

/** The reused picker handles scalar globals/local groups, never recipe authority. */
export default function PhotoDevelopSettingsPickerCurrentV1(props: Readonly<{ value: ImageDevelopSelectionV4; disabled: boolean;
	messages: PhotoDevelopSettingsCopyV1; onChange: (value: ImageDevelopSelectionV4) => void; isCurrent: () => boolean }>) {
	const latest = useRef(props); latest.current = props;
	const current = () => !props.disabled && latest.current === props && Reflect.apply(props.isCurrent, props, []) === true && latest.current === props;
	return <><PhotoDevelopSettingsPickerV2 value={props.value} disabled={props.disabled} messages={props.messages} isCurrent={current}
		onChange={value => { if (current()) Reflect.apply(props.onChange, props, [{ ...value, repairs: props.value.repairs, rawDevelopment: props.value.rawDevelopment }]); }} />
		<label><input type="checkbox" checked={props.value.repairs} disabled={props.disabled} onChange={event => {
			if (current()) Reflect.apply(props.onChange, props, [{ ...props.value, repairs: event.currentTarget.checked }]);
		}} />{props.messages.repairs}</label>
		<label><input type="checkbox" checked={props.value.rawDevelopment} disabled={props.disabled} onChange={event => {
			if (current()) Reflect.apply(props.onChange, props, [{ ...props.value, rawDevelopment: event.currentTarget.checked }]);
		}} />{props.messages.rawDevelopment}</label></>;
}
