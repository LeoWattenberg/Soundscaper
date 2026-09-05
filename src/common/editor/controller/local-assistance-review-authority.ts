/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Derives semantic output authority from controller-owned prepared inputs.
 *
 * This lives beside the controllers that call it rather than in the assistance vocabulary:
 * the guided path already keeps its own review-authority derivation here, and the session
 * stores reach it through `assistance/local-assistance-result-review.ts`.
 */

import { inspectWavBlobPcm } from '../wav-import.js';
import { reviewAssistanceEditorialGenerationPlanV1 } from
	'../assistance/editorial-generation-v1.ts';
import { reviewAssistanceVisualFramePack } from '../assistance/visual-frame-pack-v2.ts';
import type { LocalAssistancePreparedMedia } from '../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceReviewAuthority } from '../assistance/local-assistance-result-review.ts';

const OUTPUT_AUDIO_RATES = Object.freeze({
	'speech-enhancement': 48_000,
	'source-separation': 44_100,
} as const);

export async function deriveLocalAssistanceReviewAuthority(
	prepared: LocalAssistancePreparedMedia,
): Promise<LocalAssistanceReviewAuthority> {
	if (prepared.operation === 'editorial-generation') return editorialAuthority(prepared);
	if (prepared.operation === 'image-text-embedding'
		|| prepared.operation === 'optical-character-recognition'
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
	if (inputs.length < 1 || inputs.length > 64) {
		throw new TypeError('Visual review requires a bounded frame-pack inventory.');
	}
	let geometry: Readonly<{ sourceWidth: number; sourceHeight: number;
		rasterWidth: number; rasterHeight: number; timescale: number }> | null = null;
	const frames: Array<Readonly<{ sourceFrame: number; presentationTick: string }>> = [];
	for (const { bytes } of inputs) {
		const pack = reviewAssistanceVisualFramePack(new Uint8Array(await bytes.arrayBuffer()));
		geometry ??= Object.freeze({ sourceWidth: pack.sourceWidth, sourceHeight: pack.sourceHeight,
			rasterWidth: pack.rasterWidth, rasterHeight: pack.rasterHeight,
			timescale: pack.timescale });
		if (pack.sourceWidth !== geometry.sourceWidth || pack.sourceHeight !== geometry.sourceHeight
			|| pack.rasterWidth !== geometry.rasterWidth || pack.rasterHeight !== geometry.rasterHeight
			|| pack.timescale !== geometry.timescale) {
			throw new TypeError('Visual frame packs changed their exact geometry or timing scale.');
		}
		for (let ordinal = 0; ordinal < pack.frameCount; ordinal += 1) {
			const frame = pack.frame(ordinal);
			const prior = frames.at(-1);
			if (prior && (frame.sourceFrame <= prior.sourceFrame
				|| BigInt(frame.presentationTick) <= BigInt(prior.presentationTick))) {
				throw new TypeError('Visual frame packs are not globally ordered.');
			}
			frames.push(Object.freeze({ sourceFrame: frame.sourceFrame,
				presentationTick: frame.presentationTick }));
		}
	}
	if (geometry === null || frames.length < 1) {
		throw new TypeError('Visual review requires at least one exact frame.');
	}
	return Object.freeze({ visualFrames: Object.freeze({ width: geometry.sourceWidth,
		height: geometry.sourceHeight, timescale: geometry.timescale,
		frames: Object.freeze(frames) }) });
}
