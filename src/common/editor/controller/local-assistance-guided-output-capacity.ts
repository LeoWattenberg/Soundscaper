/* SPDX-License-Identifier: AGPL-3.0-only */

/** Geometry-derived audio reservations without weakening bounded structured outputs. */

import {
	assistanceWorkflowCustodySlotSpec,
} from '../assistance/workflow-custody-v1.ts';
import type {
	AssistanceGuidedWorkflowId,
	AssistanceWorkflowStageSpec,
} from '../assistance/workflow.ts';
import type {
	AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import { localAssistanceCanonicalWaveByteLength } from './local-assistance-audio-geometry.ts';

export const LOCAL_ASSISTANCE_STRUCTURED_OUTPUT_MAXIMUM_BYTES = 64 * 1024 * 1024;

export function localAssistanceGuidedOutputMaximumByteLength(
	workflowId: AssistanceGuidedWorkflowId,
	stageId: string,
	slotId: string,
	authority: AssistanceWorkflowReviewAuthorityV1,
): number {
	const slot = assistanceWorkflowCustodySlotSpec(workflowId, stageId, 'output', slotId);
	if (!slot.mediaTypes.includes('audio/wav')) {
		return LOCAL_ASSISTANCE_STRUCTURED_OUTPUT_MAXIMUM_BYTES;
	}
	if (authority.audioWave === null) {
		throw new TypeError('Guided audio output capacity requires exact adapter geometry.');
	}
	return localAssistanceCanonicalWaveByteLength(
		authority.audioWave.sampleRate,
		authority.audioWave.channelCount,
		authority.audioWave.frameCount,
	);
}

export function localAssistanceGuidedStorageReservation(
	workflowId: AssistanceGuidedWorkflowId,
	stages: readonly AssistanceWorkflowStageSpec[],
	authority: AssistanceWorkflowReviewAuthorityV1,
): number {
	let total = 0;
	for (const stage of stages) {
		for (const slot of stage.outputSlots) {
			if (!slot.required) continue;
			total += localAssistanceGuidedOutputMaximumByteLength(
				workflowId, stage.stageId, slot.slotId, authority,
			);
			if (!Number.isSafeInteger(total)) {
				throw new RangeError('Guided output reservations exceed safe storage geometry.');
			}
		}
	}
	return total;
}
