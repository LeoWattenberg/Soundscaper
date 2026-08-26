/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only projection from a slotted workflow stage to operation-v1 execution. */

import {
	validateAssistanceOperationRequest,
	type AssistanceOperationRequest,
} from './assistance-operation-contract.ts';
import type { createAssistanceOperationService } from './assistance-operation-service.ts';
import type { AssistanceWorkflowCustody } from './assistance-workflow-custody.ts';
import type {
	AssistanceWorkflowPrimitiveStagePort,
	AssistanceWorkflowStageExecutionV1,
	AssistanceWorkflowStageResultV1,
} from './assistance-workflow-executor.ts';

type OperationService = Pick<ReturnType<typeof createAssistanceOperationService>, 'executeStaged'>;
type WorkflowCustody = Pick<AssistanceWorkflowCustody,
	'operationInputClaim' | 'outputReservationForClaim' | 'recordAuthenticatedOutputForClaim'>;

export interface AssistanceWorkflowOperationStageRuntimeOptions {
	readonly operations: OperationService;
	readonly custody: WorkflowCustody;
}

export function createAssistanceWorkflowOperationStageRuntime(
	options: AssistanceWorkflowOperationStageRuntimeOptions,
): AssistanceWorkflowPrimitiveStagePort {
	if (!options?.operations || typeof options.operations.executeStaged !== 'function'
		|| !options.custody || typeof options.custody.operationInputClaim !== 'function'
		|| typeof options.custody.outputReservationForClaim !== 'function'
		|| typeof options.custody.recordAuthenticatedOutputForClaim !== 'function') {
		throw new TypeError('Workflow primitive stages require exact operation and custody ports.');
	}
	return async (stageValue): Promise<AssistanceWorkflowStageResultV1> => {
		const stage = assertStage(stageValue);
		const operation = stage.stage.operation;
		if (!operation) throw new TypeError('A deterministic workflow stage cannot enter operation-v1.');
		if (stage.request.fence.sourceRanges.length !== 1) return unavailable('stage-unavailable');
		const inputs = await Promise.all(stage.inputs.map((claim) =>
			options.custody.operationInputClaim(claim, operation, stage.signal)));
		const outputs = stage.outputs.map((claim) => options.custody.outputReservationForClaim(claim));
		let request: AssistanceOperationRequest;
		try {
			request = validateAssistanceOperationRequest({ contractVersion: 1,
				jobId: stage.request.jobId, operation,
				selectionFence: selectionFence(stage),
				models: stage.models.map(({ modelId, version, artifactSha256s }) =>
					Object.freeze({ modelId, version, artifactSha256s })),
				inputs, outputs });
		} catch (error) {
			if (error instanceof TypeError || error instanceof RangeError) {
				return unavailable('stage-unavailable');
			}
			throw error;
		}
		const outcome = await options.operations.executeStaged(request, stage.signal);
		stage.signal.throwIfAborted();
		if (outcome.outcome === 'unavailable') {
			return unavailable(outcome.reason === 'model-unavailable'
				? 'model-unavailable' : 'stage-unavailable');
		}
		if (outcome.result.outputs.length !== stage.outputs.length) {
			throw new TypeError('Operation-v1 omitted a workflow output claim.');
		}
		for (const [index, claim] of outcome.result.outputs.entries()) {
			await options.custody.recordAuthenticatedOutputForClaim(
				stage.outputs[index]!, claim, stage.signal,
			);
		}
		stage.progress(1, 1);
		return Object.freeze({ outcome: 'completed' });
	};
}

function selectionFence(stage: AssistanceWorkflowStageExecutionV1) {
	const fence = stage.request.fence;
	const range = fence.sourceRanges[0]!;
	return Object.freeze({ projectId: fence.projectId, schemaVersion: fence.schemaVersion,
		revision: fence.revision, sequenceId: fence.sequenceId,
		occurrenceIds: range.occurrenceIds, sourceId: range.sourceId,
		sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame, linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256 });
}

function assertStage(value: AssistanceWorkflowStageExecutionV1): AssistanceWorkflowStageExecutionV1 {
	if (!value || typeof value !== 'object' || !(value.signal instanceof AbortSignal)
		|| typeof value.progress !== 'function') {
		throw new TypeError('The workflow primitive stage execution is invalid.');
	}
	value.signal.throwIfAborted();
	return value;
}

function unavailable(
	reason: 'stage-unavailable' | 'model-unavailable',
): AssistanceWorkflowStageResultV1 {
	return Object.freeze({ outcome: 'unavailable', reason });
}
