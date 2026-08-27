/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Derives semantic output authority from controller-owned prepared inputs.
 *
 * This lives beside the controllers that call it rather than under `ui/`: editor core must
 * stay independent of the presentation modules, and the guided path already keeps its own
 * review-authority derivation here. The UI re-exports it for the session stores.
 */

import { inspectWavBlobPcm } from '../wav-import.js';
import { reviewAssistanceEditorialGenerationPlanV1 } from
	'../assistance/editorial-generation-v1.ts';
import { reviewAssistanceVisualFramePack } from '../assistance/visual-frame-pack-v2.ts';
import type { LocalAssistancePreparedMedia } from '../ui/local-assistance-preparation.ts';
import type { LocalAssistanceReviewAuthority } from '../ui/local-assistance-result-review.ts';

const OUTPUT_AUDIO_RATES = Object.freeze({
	'speech-enhancement': 48_000,
	'source-separation': 44_100,
} as const);

export async function deriveLocalAssistanceReviewAuthority(
	prepared: LocalAssistancePreparedMedia,
): Promise<LocalAssistanceReviewAuthority> {
	if (prepared.operation === 'editorial-generation') return editorialAuthority(prepared);
	if (prepared.operation === 'optical-character-recognition'
		|| prepared.operation === 'subject-detection'
		|| prepared.operation === 'saliency-detection') return visualAuthority(prepared);
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

async function editorialAuthority(
	prepared: LocalAssistancePreparedMedia,
): Promise<LocalAssistanceReviewAuthority> {
	const inputs = prepared.inputs.filter(({ role }) => role === 'editorial-context');
	if (inputs.length !== 1 || inputs[0]!.bytes.size > 512 * 1024) {
		throw new TypeError('Editorial review requires one bounded exact context input.');
	}
	let value: unknown;
	try { value = JSON.parse(await inputs[0]!.bytes.text()) as unknown; }
	catch (error) { throw new TypeError('Editorial context is not valid JSON.', { cause: error }); }
	const plan = reviewAssistanceEditorialGenerationPlanV1(value);
	return Object.freeze({ editorialCandidateIds: plan.authorizedCandidateIds });
}

async function visualAuthority(
	prepared: LocalAssistancePreparedMedia,
): Promise<LocalAssistanceReviewAuthority> {
	const inputs = prepared.inputs.filter(({ role }) => role === 'frame-pack');
	if (inputs.length !== 1) {
		throw new TypeError('Visual review requires one exact frame-pack input.');
	}
	const pack = reviewAssistanceVisualFramePack(new Uint8Array(await inputs[0]!.bytes.arrayBuffer()));
	const frames = Object.freeze(Array.from({ length: pack.frameCount }, (_, ordinal) => {
		const frame = pack.frame(ordinal);
		return Object.freeze({ sourceFrame: frame.sourceFrame,
			presentationTick: frame.presentationTick });
	}));
	return Object.freeze({ visualFrames: Object.freeze({ width: pack.sourceWidth,
		height: pack.sourceHeight, timescale: pack.timescale, frames }) });
}
