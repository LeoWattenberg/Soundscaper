/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared identity predicates for pathless workflow claims and their richer custody. */

import {
	ASSISTANCE_WORKFLOW_CLAIM_VERSION,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowId,
} from './workflow.ts';
import type { AssistanceWorkflowCustodyClaimV1 } from './workflow-custody-v1.ts';

export interface AssistanceWorkflowClaimScopeV1 {
	readonly workflowId: AssistanceWorkflowId;
	readonly jobId: string;
	readonly stageId: string;
}

export function sameAssistanceWorkflowClaimIdentityV1(
	left: AssistanceWorkflowClaimV1,
	right: AssistanceWorkflowClaimV1,
): boolean {
	return left.claimVersion === right.claimVersion && left.direction === right.direction
		&& left.claimId === right.claimId && left.jobId === right.jobId
		&& left.stageId === right.stageId && left.slotId === right.slotId;
}

export function sameAssistanceWorkflowClaimSequenceV1(
	left: readonly AssistanceWorkflowClaimV1[],
	right: readonly AssistanceWorkflowClaimV1[],
): boolean {
	return left.length === right.length && left.every((claim, index) => {
		const expected = right[index];
		return expected !== undefined
			&& sameAssistanceWorkflowClaimIdentityV1(claim, expected);
	});
}

export function assistanceWorkflowCustodyCorrelatesClaimV1(
	custody: AssistanceWorkflowCustodyClaimV1,
	scope: AssistanceWorkflowClaimScopeV1,
	claim: AssistanceWorkflowClaimV1,
	direction: AssistanceWorkflowClaimV1['direction'],
): boolean {
	return custody.workflowId === scope.workflowId && custody.jobId === scope.jobId
		&& custody.stageId === scope.stageId && custody.direction === direction
		&& sameAssistanceWorkflowClaimIdentityV1(claim, {
			claimVersion: ASSISTANCE_WORKFLOW_CLAIM_VERSION,
			direction: custody.direction,
			claimId: custody.claimId,
			jobId: custody.jobId,
			stageId: custody.stageId,
			slotId: custody.slotId,
		});
}
