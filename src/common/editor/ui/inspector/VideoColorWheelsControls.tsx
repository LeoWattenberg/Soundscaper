/* SPDX-License-Identifier: AGPL-3.0-only */

import { COLOR_WHEEL_GROUPS_V1, normalizeColorWheelsParamsV1 } from '../../video-color-wheels-v1.ts';
import VideoColorWheelControl, { type VideoColorWheelValueV1 } from './VideoColorWheelControl.tsx';

export type VideoColorWheelGroupV1 = typeof COLOR_WHEEL_GROUPS_V1[number];
const LABEL = Object.freeze({ shadows: 'videoEffectWheelShadows', midtones: 'videoEffectWheelMidtones', highlights: 'videoEffectWheelHighlights' });
export default function VideoColorWheelsControls(props: Readonly<{ params: unknown; copy: Readonly<Record<string, string>>; disabled: boolean;
	isCurrent: (group: VideoColorWheelGroupV1) => boolean; onBegin: (group: VideoColorWheelGroupV1) => void;
	onPreview: (group: VideoColorWheelGroupV1, params: Readonly<Record<string, number>>) => void;
	onCommit: (group: VideoColorWheelGroupV1) => void; onCancel: (group: VideoColorWheelGroupV1) => void }>) {
	const params = normalizeColorWheelsParamsV1(props.params), copy = props.copy;
	const messages = { hue: copy.videoEffectParamHue!, saturation: copy.videoEffectParamSaturation!, luminance: copy.videoEffectParamLuminance!,
		exact: copy.videoEffectExactValue!, reset: copy.videoEffectWheelReset!, instructions: copy.videoEffectWheelInstructions!, invalid: copy.videoEffectWheelInvalid! };
	const preview = (group: VideoColorWheelGroupV1, value: VideoColorWheelValueV1) => props.onPreview(group,
		{ [`${group}Hue`]: value.hue, [`${group}Saturation`]: value.saturation, [`${group}Luminance`]: value.luminance });
	return <div data-video-color-wheels>{COLOR_WHEEL_GROUPS_V1.map(group => <VideoColorWheelControl key={group} label={copy[LABEL[group]]!}
		value={{ hue: params[`${group}Hue`], saturation: params[`${group}Saturation`], luminance: params[`${group}Luminance`] }} messages={messages}
		disabled={props.disabled} isCurrent={() => props.isCurrent(group)} onBegin={() => { props.onBegin(group); }}
		onPreview={value => { preview(group, value); }} onCommit={() => { props.onCommit(group); }} onCancel={() => { props.onCancel(group); }} />)}</div>;
}
