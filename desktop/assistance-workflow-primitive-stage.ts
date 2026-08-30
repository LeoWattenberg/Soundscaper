/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only projection from aggregate stage custody into the operation-v1 runtime boundary. */

import {
	validateAssistanceOperationRequest,
	validateAssistanceOperationResult,
} from './assistance-operation-contract.ts';
import type { AssistanceOperationOutcome } from './assistance-operation-service.ts';
import type {
	AssistanceOutputClaim,
	AssistanceOutputReservation,
	AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowPrimitiveStagePort,
	type AssistanceWorkflowStageExecutionV1,
} from './assistance-workflow-executor.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowSourceRangeV1,
} from '../src/common/editor/assistance/workflow.ts';

export interface AssistanceWorkflowPrimitiveStageCustody {
	preparePrimitiveStage(stage: AssistanceWorkflowStageExecutionV1): PromiseLike<Readonly<{
		readonly inputs: readonly AssistanceStagedInputClaim[];
		readonly outputs: readonly AssistanceOutputReservation[];
	}>> | Readonly<{
		readonly inputs: readonly AssistanceStagedInputClaim[];
		readonly outputs: readonly AssistanceOutputReservation[];
	}>;
	bindPrimitiveOutputs(
		stage: AssistanceWorkflowStageExecutionV1,
		outputs: readonly AssistanceOutputClaim[],
	): PromiseLike<void> | void;
}

export interface AssistanceWorkflowStagedOperationPort {
	executeStaged(
		request: ReturnType<typeof validateAssistanceOperationRequest>,
		signal: AbortSignal,
	): PromiseLike<AssistanceOperationOutcome> | AssistanceOperationOutcome;
}

export interface AssistanceWorkflowPrimitiveStageRunnerOptions {
	readonly custody: AssistanceWorkflowPrimitiveStageCustody;
	readonly operations: AssistanceWorkflowStagedOperationPort;
}

export function createAssistanceWorkflowPrimitiveStageRunner(
	options: AssistanceWorkflowPrimitiveStageRunnerOptions,
): AssistanceWorkflowPrimitiveStagePort {
	if (!options?.custody || typeof options.custody.preparePrimitiveStage !== 'function'
		|| typeof options.custody.bindPrimitiveOutputs !== 'function'
		|| !options.operations || typeof options.operations.executeStaged !== 'function') {
		throw new TypeError('Workflow primitive execution requires custody and staged operation ports.');
	}
	return async (stageValue) => {
		const stage = validateStage(stageValue);
		stage.signal.throwIfAborted();
		const prepared = await options.custody.preparePrimitiveStage(stage);
		stage.signal.throwIfAborted();
		if (!prepared || !Array.isArray(prepared.inputs) || !Array.isArray(prepared.outputs)) {
			throw new TypeError('Workflow primitive custody returned malformed operation claims.');
		}
		const request = validateAssistanceOperationRequest({
			contractVersion: 1,
			jobId: stage.request.jobId,
			operation: stage.stage.operation,
			selectionFence: operationFence(stage),
			models: stage.models.map(({ modelId, version, artifactSha256s }) => Object.freeze({
				modelId, version, artifactSha256s,
			})),
			inputs: prepared.inputs,
			outputs: prepared.outputs,
		});
		stage.progress(0, 1);
		const outcome = await options.operations.executeStaged(request, stage.signal);
		stage.signal.throwIfAborted();
		if (!outcome || outcome.contractVersion !== 1 || outcome.jobId !== request.jobId
			|| outcome.operation !== request.operation) {
			throw new TypeError('Staged operation returned an uncorrelated workflow outcome.');
		}
		if (outcome.outcome === 'unavailable') {
			if (outcome.reason === 'model-unavailable') {
				return Object.freeze({ outcome: 'unavailable' as const,
					reason: 'model-unavailable' as const });
			}
			if (outcome.reason === 'adapter-unavailable' || outcome.reason === 'runtime-unavailable') {
				return Object.freeze({ outcome: 'unavailable' as const,
					reason: 'stage-unavailable' as const });
			}
			throw new TypeError('Staged operation returned an unsupported unavailable reason.');
		}
		if (outcome.outcome !== 'completed') {
			throw new TypeError('Staged operation returned an unsupported workflow outcome.');
		}
		const result = validateAssistanceOperationResult(outcome.result, request);
		await options.custody.bindPrimitiveOutputs(stage, result.outputs);
		stage.signal.throwIfAborted();
		stage.progress(1, 1);
		return Object.freeze({ outcome: 'completed' as const });
	};
}

function validateStage(value: AssistanceWorkflowStageExecutionV1): AssistanceWorkflowStageExecutionV1 {
	if (!value || typeof value !== 'object' || !(value.signal instanceof AbortSignal)
		|| typeof value.progress !== 'function' || value.stage?.operation === null) {
		throw new TypeError('A workflow primitive runner requires one operation stage execution.');
	}
	const request = validateAssistanceWorkflow(value.request);
	const graph = assistanceWorkflowStageGraph(request.workflowId);
	const stage = graph.find(({ stageId }) => stageId === value.stage.stageId);
	if (!stage || stage.operation !== value.stage.operation
		|| request.stageIds[value.stageIndex] !== stage.stageId
		|| value.stageCount !== request.stageIds.length) {
		throw new TypeError('The workflow primitive stage is not correlated to its derived graph.');
	}
	const expectedCustody = createAssistanceWorkflowStageCustodyToken(value);
	if (JSON.stringify(expectedCustody) !== JSON.stringify(value.custody)) {
		throw new TypeError('The workflow primitive stage lost its exact custody token.');
	}
	return Object.freeze({ ...value, request, stage });
}

function operationFence(stage: AssistanceWorkflowStageExecutionV1) {
	const range = primaryRange(stage);
	const fence = stage.request.fence;
	return Object.freeze({
		projectId: fence.projectId,
		schemaFamily: fence.schemaFamily,
		schemaVersion: fence.schemaVersion,
		revision: fence.revision,
		sequenceId: fence.sequenceId,
		occurrenceIds: range.occurrenceIds,
		sourceId: range.sourceId,
		sourceSha256: range.sourceSha256,
		sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame,
		linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256,
	});
}

function primaryRange(stage: AssistanceWorkflowStageExecutionV1): AssistanceWorkflowSourceRangeV1 {
	const inputSlots = new Set(stage.inputs.map(({ slotId }) => slotId));
	const preferredKind = inputSlots.has('audio') ? 'audio'
		: inputSlots.has('video') || inputSlots.has('frame-pack') ? 'video' : null;
	const matches = preferredKind === null ? stage.request.fence.sourceRanges
		: stage.request.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === preferredKind);
	if (matches.length !== 1) {
		throw new TypeError('A workflow primitive stage requires exactly one source-range authority.');
	}
	return matches[0]!;
}
