/* SPDX-License-Identifier: AGPL-3.0-only */

/** Revalidates ephemeral review media against exact staged workflow input custody. */

import type { AssistanceWorkflowV1 } from '../assistance/workflow.ts';
import {
	validateAssistanceWorkflowReviewAuthorityV1,
	type AssistanceWorkflowReviewAuthorityV1,
} from '../assistance/workflow-review-authority-v1.ts';
import { digestMediaContent } from '../storage/media-content-digest.ts';

export async function verifyLocalAssistanceGuidedReviewMediaAuthority(
	workflow: AssistanceWorkflowV1,
	authorityValue: AssistanceWorkflowReviewAuthorityV1,
	signal: AbortSignal,
): Promise<void> {
	const authority = validateAssistanceWorkflowReviewAuthorityV1(authorityValue);
	for (const asset of [authority.media.audio, authority.media.video]) {
		if (asset === null) continue;
		const claims = workflow.inputs.filter(({ direction, claimId, stageId, slotId }) =>
			direction === 'input' && claimId === asset.claimId
			&& stageId === asset.stageId && slotId === asset.slotId);
		if (claims.length !== 1) {
			throw new TypeError('Guided review media lost its exact workflow input claim.');
		}
		const sha256 = await digestMediaContent(asset.body, { signal });
		if (asset.byteLength !== asset.body.size || asset.mediaType !== asset.body.type
			|| sha256 !== asset.sha256) {
			throw new TypeError('Guided review media changed after aggregate preparation.');
		}
	}
}
