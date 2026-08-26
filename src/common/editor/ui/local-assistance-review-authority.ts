/* SPDX-License-Identifier: AGPL-3.0-only */

/** Derives semantic output authority from controller-owned prepared inputs. */

import { inspectWavBlobPcm } from '../wav-import.js';
import type { LocalAssistancePreparedMedia } from './local-assistance-preparation.ts';
import type { LocalAssistanceReviewAuthority } from './local-assistance-result-review.ts';

const OUTPUT_AUDIO_RATES = Object.freeze({
	'speech-enhancement': 48_000,
	'source-separation': 44_100,
} as const);

export async function deriveLocalAssistanceReviewAuthority(
	prepared: LocalAssistancePreparedMedia,
): Promise<LocalAssistanceReviewAuthority> {
	if (prepared.operation !== 'speech-enhancement' && prepared.operation !== 'source-separation') {
		return Object.freeze({});
	}
	const audioInputs = prepared.inputs.filter(({ role }) => role === 'audio');
	if (audioInputs.length !== 1 || audioInputs[0]!.mediaType !== 'audio/wav') {
		throw new TypeError('Audio-result review requires one exact conformed WAV input.');
	}
	const descriptor = await inspectWavBlobPcm(audioInputs[0]!.bytes) as Readonly<{
		sampleFormat: string;
		sampleRate: number;
		channelCount: number;
		frameCount: number;
	}>;
	if (descriptor.sampleFormat !== 'float32'
		|| descriptor.sampleRate !== OUTPUT_AUDIO_RATES[prepared.operation]) {
		throw new TypeError('The assistance audio input does not match its adapter-owned profile.');
	}
	return Object.freeze({ audioWave: Object.freeze({
		sampleRate: descriptor.sampleRate,
		channelCount: descriptor.channelCount,
		frameCount: descriptor.frameCount,
	}) });
}
