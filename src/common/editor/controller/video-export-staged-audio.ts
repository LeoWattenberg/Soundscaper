/* SPDX-License-Identifier: AGPL-3.0-only */

import { DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT } from '../video-delivery-audio-layout.ts';

interface StagedAudioPlan {
	readonly inputs: readonly Readonly<{
		readonly kind?: unknown;
		readonly channelLayout?: unknown;
	}>[];
}

interface StagedAudioProject {
	readonly masterChannels?: unknown;
}

/** Read the audio layout admitted by the plan that both video encoders consume. */
export function stagedAudioChannelLayout(plan: StagedAudioPlan): string {
	const audioInput = plan.inputs.find((input) => input.kind === 'staged-audio-mix');
	return (audioInput?.channelLayout as string | undefined) ?? DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT;
}

/** Resolve the exact staged mix channel geometry handed to the browser encoder. */
export function stagedAudioChannelCount(plan: StagedAudioPlan, project: StagedAudioProject): number {
	const layout = stagedAudioChannelLayout(plan);
	if (layout === 'mono') return 1;
	if (layout === 'stereo') return 2;
	const channels = Number(project.masterChannels ?? 2);
	if (!Number.isSafeInteger(channels) || channels < 1 || channels > 32) {
		throw new RangeError('The video delivery master channel count is invalid.');
	}
	return channels;
}
