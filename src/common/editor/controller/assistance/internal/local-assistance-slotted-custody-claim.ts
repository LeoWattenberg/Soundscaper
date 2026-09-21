/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceWorkflowClaimV1 } from '../../../assistance/workflow.ts';
import type { AssistanceWorkflowCustodyClaimV1 } from '../../../assistance/workflow-custody-v1.ts';

/** Require a returned custody reservation to match the exact slotted workflow claim. */
export function assertSlottedCustodyClaim(
	handle: Readonly<{ custody: AssistanceWorkflowCustodyClaimV1;
		workflowClaim: AssistanceWorkflowClaimV1 }> | null | undefined,
	direction: 'input' | 'output',
	jobId: string,
	stageId: string,
	slotId: string,
	message: string,
): AssistanceWorkflowClaimV1 {
	const claim = handle?.workflowClaim;
	if (!handle?.custody || claim?.direction !== direction || claim.jobId !== jobId
		|| claim.stageId !== stageId || claim.slotId !== slotId
		|| claim.claimId !== handle.custody.claimId) {
		throw new TypeError(message);
	}
	return claim;
}
