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
import type { AssistanceWorkflowSourceRangeV1 } from '../src/common/editor/assistance/workflow.ts';

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
		const range = operationSourceRange(stage);
		if (!range) return unavailable('stage-unavailable');
		const inputs = await Promise.all(stage.inputs.map((claim) =>
			options.custody.operationInputClaim(claim, operation, stage.signal)));
		const outputs = stage.outputs.map((claim) => options.custody.outputReservationForClaim(claim));
		let request: AssistanceOperationRequest;
		try {
			request = validateAssistanceOperationRequest({ contractVersion: 1,
				jobId: stage.request.jobId, operation,
				selectionFence: selectionFence(stage, range),
				models: operationModelBindings(stage, operation),
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

function operationModelBindings(
	stage: AssistanceWorkflowStageExecutionV1,
	operation: NonNullable<AssistanceWorkflowStageExecutionV1['stage']['operation']>,
): readonly Readonly<{ modelId: string; version: string;
	artifactSha256s: readonly string[] }>[] {
	const projected = stage.models.map(({ modelId, version, artifactSha256s }) =>
		Object.freeze({ modelId, version, artifactSha256s }));
	return canonicalizeAssistanceWorkflowOperationModelBindingsV1(operation, projected);
}

/** Collapse only the workflow's two byte-identical PP-OCR role bindings. */
export function canonicalizeAssistanceWorkflowOperationModelBindingsV1(
	operation: NonNullable<AssistanceWorkflowStageExecutionV1['stage']['operation']>,
	projected: readonly Readonly<{ modelId: string; version: string;
		artifactSha256s: readonly string[] }>[],
): readonly Readonly<{ modelId: string; version: string;
	artifactSha256s: readonly string[] }>[] {
	if (operation !== 'optical-character-recognition' || projected.length !== 2) {
		return Object.freeze([...projected]);
	}
	const [first, second] = projected;
	if (first?.modelId !== second?.modelId || first.version !== second.version
		|| JSON.stringify(first.artifactSha256s) !== JSON.stringify(second.artifactSha256s)) {
		throw new TypeError('The PP-OCR detector and recognizer bindings are not exactly identical.');
	}
	return Object.freeze([first]);
}

function selectionFence(
	stage: AssistanceWorkflowStageExecutionV1,
	range: AssistanceWorkflowSourceRangeV1,
) {
	const fence = stage.request.fence;
	return Object.freeze({ projectId: fence.projectId, schemaVersion: fence.schemaVersion,
		revision: fence.revision, sequenceId: fence.sequenceId,
		occurrenceIds: range.occurrenceIds, sourceId: range.sourceId,
		sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame, linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256 });
}

function operationSourceRange(
	stage: AssistanceWorkflowStageExecutionV1,
): AssistanceWorkflowSourceRangeV1 | null {
	const inputSlots = new Set(stage.inputs.map(({ slotId }) => slotId));
	const hasAudio = inputSlots.has('audio');
	const hasVideo = inputSlots.has('video') || inputSlots.has('frame-pack');
	if (hasAudio && hasVideo) return null;
	const preferredKind = hasAudio ? 'audio'
		: hasVideo || (stage.request.workflowId === 'make-highlights'
			&& stage.stage.stageId === 'rerank-editorial') ? 'video' : null;
	const matches = preferredKind === null
		? stage.request.fence.sourceRanges
		: stage.request.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === preferredKind);
	return matches.length === 1 ? matches[0]! : null;
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
