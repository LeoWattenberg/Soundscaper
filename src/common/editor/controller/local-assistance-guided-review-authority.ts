/* SPDX-License-Identifier: AGPL-3.0-only */

/** Derives immutable terminal-review authority from adapter-owned staged inputs. */

import {
	createEmptyAssistanceWorkflowReviewAuthorityV1,
	validateAssistanceWorkflowReviewAuthorityV1,
	type AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import {
	ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_PROMPT_BYTES,
	reviewAssistanceEditorialGenerationPlanV1,
} from '../assistance/editorial-generation-v1.ts';
import type { AssistanceGuidedWorkflowId } from '../assistance/workflow.ts';
import type { AssistanceWorkflowReviewMediaAssetV1 } from
	'../assistance/workflow-review-authority-v1.ts';
import { digestMediaContent } from '../storage/media-content-digest.ts';
import { inspectWavBlobPcm } from '../wav-import.js';

interface PreparedExternalInput {
	readonly stageId: string;
	readonly slotId: string;
	readonly claimId: string;
	readonly mediaType: string;
	readonly bytes: Blob;
}

const AUDIO_RATE = Object.freeze({
	'enhance-dialogue': 48_000,
	'separate-dialogue-music-effects': 44_100,
} as const);

export async function deriveLocalAssistanceGuidedReviewAuthority(
	workflowId: AssistanceGuidedWorkflowId,
	inputs: readonly PreparedExternalInput[],
	signal?: AbortSignal,
): Promise<AssistanceWorkflowReviewAuthorityV1> {
	const media = await reviewMedia(workflowId, inputs, signal);
	if (workflowId === 'generate-editorial-text') {
		const contexts = inputs.filter(({ mediaType }) =>
			mediaType === 'application/vnd.soundscaper.editorial-context+json');
		if (contexts.length !== 1
			|| contexts[0]!.bytes.size > ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_PROMPT_BYTES * 2) {
			throw new TypeError('Guided editorial review requires one bounded exact context input.');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
				await contexts[0]!.bytes.arrayBuffer(),
			)) as unknown;
		} catch (error) {
			throw new TypeError('Guided editorial context is not valid UTF-8 JSON.', { cause: error });
		}
		const plan = reviewAssistanceEditorialGenerationPlanV1(parsed);
		return validateAssistanceWorkflowReviewAuthorityV1({ reviewAuthorityVersion: 1,
			audioWave: null, editorialCandidateIds: plan.authorizedCandidateIds, media });
	}
	if (workflowId !== 'enhance-dialogue' && workflowId !== 'separate-dialogue-music-effects') {
		return media.audio === null && media.video === null
			? createEmptyAssistanceWorkflowReviewAuthorityV1()
			: validateAssistanceWorkflowReviewAuthorityV1({ reviewAuthorityVersion: 1,
				audioWave: null, editorialCandidateIds: null, media });
	}
	if (media.audio === null) {
		throw new TypeError('Guided audio review requires one exact adapter-owned WAV input.');
	}
	const descriptor = await inspectWavBlobPcm(media.audio.body) as Readonly<{
		container: string;
		encoding: string;
		sampleFormat: string;
		sampleRate: number;
		channelCount: number;
		frameCount: number;
	}>;
	if (descriptor.container !== 'wav' || descriptor.encoding !== 'ieee-float'
		|| descriptor.sampleFormat !== 'float32' || descriptor.sampleRate !== AUDIO_RATE[workflowId]) {
		throw new TypeError('Guided audio review authority disagrees with its adapter-owned profile.');
	}
	return validateAssistanceWorkflowReviewAuthorityV1({ reviewAuthorityVersion: 1,
		audioWave: { sampleRate: descriptor.sampleRate, channelCount: descriptor.channelCount,
			frameCount: descriptor.frameCount }, editorialCandidateIds: null, media });
}

async function reviewMedia(
	workflowId: AssistanceGuidedWorkflowId,
	inputs: readonly PreparedExternalInput[],
	signal?: AbortSignal,
): Promise<Readonly<{
	audio: AssistanceWorkflowReviewMediaAssetV1 | null;
	video: AssistanceWorkflowReviewMediaAssetV1 | null;
}>> {
	const audio = workflowId === 'clean-filler-silence'
		? await equivalentAsset(inputs, (input) => input.mediaType === 'audio/wav', 'audio/wav',
			Object.freeze({ stageId: 'detect-speech', slotId: 'audio' }), signal)
		: workflowId === 'enhance-dialogue' || workflowId === 'separate-dialogue-music-effects'
			? await uniqueAsset(inputs, (input) => input.mediaType === 'audio/wav', 'audio/wav', signal)
			: null;
	const video = workflowId === 'make-highlights'
		? await uniqueAsset(inputs, (input) => input.mediaType.startsWith('video/'), undefined, signal)
		: null;
	return Object.freeze({ audio, video });
}

async function equivalentAsset(
	inputs: readonly PreparedExternalInput[],
	accept: (input: PreparedExternalInput) => boolean,
	exactMediaType: string | undefined,
	preferred: Readonly<{ stageId: string; slotId: string }>,
	signal?: AbortSignal,
): Promise<AssistanceWorkflowReviewMediaAssetV1 | null> {
	const candidates = inputs.filter(accept);
	if (candidates.length === 0) return null;
	const assets = await Promise.all(candidates.map((candidate) =>
		asset(candidate, exactMediaType, signal)));
	if (new Set(assets.map(({ mediaType, byteLength, sha256 }) =>
		`${mediaType}:${String(byteLength)}:${sha256}`)).size !== 1) {
		throw new TypeError('Guided review media is ambiguous.');
	}
	return assets.find(({ stageId, slotId }) =>
		stageId === preferred.stageId && slotId === preferred.slotId) ?? assets[0]!;
}

async function uniqueAsset(
	inputs: readonly PreparedExternalInput[],
	accept: (input: PreparedExternalInput) => boolean,
	exactMediaType?: string,
	signal?: AbortSignal,
): Promise<AssistanceWorkflowReviewMediaAssetV1 | null> {
	const candidates = inputs.filter(accept);
	if (candidates.length === 0) return null;
	if (candidates.length !== 1) {
		throw new TypeError('Guided review media is ambiguous.');
	}
	return asset(candidates[0]!, exactMediaType, signal);
}

async function asset(
	candidate: PreparedExternalInput,
	exactMediaType?: string,
	signal?: AbortSignal,
): Promise<AssistanceWorkflowReviewMediaAssetV1> {
	const mediaType = exactMediaType ?? candidate.mediaType;
	const body = candidate.bytes.type === mediaType
		? candidate.bytes : candidate.bytes.slice(0, candidate.bytes.size, mediaType);
	const sha256 = await digestMediaContent(body, { signal });
	return Object.freeze({ stageId: candidate.stageId, slotId: candidate.slotId,
		claimId: candidate.claimId,
		mediaType, byteLength: body.size, sha256, body });
}
