/* SPDX-License-Identifier: AGPL-3.0-only */

/** Derives immutable terminal-review authority from adapter-owned staged inputs. */

import {
	createEmptyAssistanceWorkflowReviewAuthorityV1,
	validateAssistanceWorkflowReviewAuthorityV1,
	type AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import type { AssistanceGuidedWorkflowId } from '../assistance/workflow.ts';
import { inspectWavBlobPcm } from '../wav-import.js';

interface PreparedExternalInput {
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
): Promise<AssistanceWorkflowReviewAuthorityV1> {
	if (workflowId !== 'enhance-dialogue' && workflowId !== 'separate-dialogue-music-effects') {
		return createEmptyAssistanceWorkflowReviewAuthorityV1();
	}
	const audio = inputs.filter(({ mediaType }) => mediaType === 'audio/wav');
	if (audio.length !== 1) {
		throw new TypeError('Guided audio review requires one exact adapter-owned WAV input.');
	}
	const descriptor = await inspectWavBlobPcm(audio[0]!.bytes) as Readonly<{
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
			frameCount: descriptor.frameCount }, editorialCandidateIds: null });
}
