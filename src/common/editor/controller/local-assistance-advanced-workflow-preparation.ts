/* SPDX-License-Identifier: AGPL-3.0-only */

/** One selected primitive operation projected into a closed single-stage workflow-v1 recipe. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceAdvancedWorkflowId,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import type { AssistanceWorkflowCustodyClaimV1 } from
	'../assistance/workflow-custody-v1.ts';
import {
	defaultAssistanceWorkflowSettingsV1,
	serializeAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
} from '../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceModel } from '../assistance/local-assistance-bridge.ts';
import type { LocalAssistanceWorkflowCustodyBridge } from
	'../assistance/local-assistance-workflow-bridge.ts';
import type {
	LocalAssistancePreparedMedia,
	LocalAssistanceSelectedMediaPreparationPort,
} from '../assistance/local-assistance-preparation.ts';
import { localAssistanceSelectedModels } from './local-assistance-model-selection.ts';
import { normalizeLocalAssistancePreparedMedia } from './local-assistance-prepared-media.ts';
import { createLocalAssistanceGuidedAggregateFenceV1 } from
	'./local-assistance-guided-fence.ts';
import { deriveLocalAssistanceReviewAuthority } from './local-assistance-review-authority.ts';
import { LocalAssistanceAdvancedContextUnavailableError } from
	'./local-assistance-advanced-selected-context.ts';

export interface LocalAssistanceAdvancedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceAdvancedWorkflowId;
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: 'fast' | 'accurate';
	readonly settings: unknown;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceWorkflowCustodyBridge;
	readonly signal: AbortSignal;
}

export type LocalAssistanceAdvancedWorkflowPreparationOutcome = Readonly<{
	outcome: 'prepared';
	workflow: AssistanceWorkflowV1;
	prepared: LocalAssistancePreparedMedia;
}> | Readonly<{
	outcome: 'unavailable';
	reason: 'aggregate-custody-unavailable' | 'model-binding-unavailable'
		| 'source-custody-unavailable';
}>;

export interface LocalAssistanceAdvancedWorkflowPreparationDependencies {
	readonly getProject: () => unknown;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly preflightStorage: (bytes: number) => Promise<unknown>;
	readonly selected: Pick<LocalAssistanceSelectedMediaPreparationPort, 'prepareSelectedMedia'>;
}

export function createLocalAssistanceAdvancedWorkflowPreparation(
	dependencies: LocalAssistanceAdvancedWorkflowPreparationDependencies,
): Readonly<{ prepareAdvancedWorkflow(
	request: LocalAssistanceAdvancedWorkflowPreparationRequest,
): Promise<LocalAssistanceAdvancedWorkflowPreparationOutcome> }> {
	assertDependencies(dependencies);
	return Object.freeze({ prepareAdvancedWorkflow });

	async function prepareAdvancedWorkflow(
		request: LocalAssistanceAdvancedWorkflowPreparationRequest,
	): Promise<LocalAssistanceAdvancedWorkflowPreparationOutcome> {
		const workflowId = `advanced:${request?.operation}` as AssistanceAdvancedWorkflowId;
		if (request?.workflowId !== workflowId) {
			throw new TypeError('Advanced preparation lost its exact primitive workflow identity.');
		}
		const settings = validateAssistanceWorkflowSettingsV1(request.settings, workflowId);
		if (JSON.stringify(settings) !== JSON.stringify(defaultAssistanceWorkflowSettingsV1(workflowId))) {
			throw new TypeError('Advanced preparation requires the closed operation settings body.');
		}
		if (!request.custody || typeof request.custody.stageInput !== 'function'
			|| typeof request.custody.reserveOutput !== 'function'
			|| typeof request.custody.release !== 'function') {
			return unavailable('aggregate-custody-unavailable');
		}
		if (!(request.signal instanceof AbortSignal)) {
			throw new TypeError('Advanced preparation requires one cancellation signal.');
		}
		const mode = request.operation === 'shot-detection' ? request.shotDetectionMode ?? 'fast' : undefined;
		if (request.operation !== 'shot-detection' && request.shotDetectionMode !== undefined) {
			throw new TypeError('Only Advanced shot detection accepts a detection mode.');
		}
		const selectedModels = localAssistanceSelectedModels(
			request.operation, request.models, request.models.map(({ modelId }) => modelId), mode,
		);
		if (selectedModels === null) return unavailable('model-binding-unavailable');
		const token = dependencies.captureProject();
		try {
			request.signal.throwIfAborted();
			const preparedValue = await dependencies.selected.prepareSelectedMedia({
				sourceId: request.sourceId, operation: request.operation,
				...(mode ? { shotDetectionMode: mode } : {}), signal: request.signal,
			});
			const prepared = normalizeLocalAssistancePreparedMedia(preparedValue, {
				sourceId: request.sourceId, operation: request.operation,
				...(mode ? { shotDetectionMode: mode } : {}),
			});
			dependencies.assertProject(token);
			await deriveLocalAssistanceReviewAuthority(prepared);
			dependencies.assertProject(token);
			const graph = assistanceWorkflowStageGraph(workflowId);
			if (graph.length !== 1 || graph[0]!.operation !== request.operation) {
				throw new TypeError('Advanced preparation requires one derived primitive stage.');
			}
			const stage = graph[0]!;
			const inputSlots = prepared.inputs.map(({ role }) => role);
			if (inputSlots.some((slotId, index) => inputSlots.indexOf(slotId) !== index
				&& slotId !== 'frame-pack')
				|| inputSlots.some((slotId) => !stage.inputSlots.some(({ slotId: admitted }) => admitted === slotId))) {
				throw new TypeError('Prepared Advanced inputs disagree with the closed operation recipe.');
			}
			const outputSlots = prepared.outputs.map((output) => output.slotId ?? output.role);
			if (new Set(outputSlots).size !== outputSlots.length
				|| outputSlots.length !== stage.outputSlots.length
				|| outputSlots.some((slotId, index) => slotId !== stage.outputSlots[index]!.slotId)) {
				throw new TypeError('Prepared Advanced outputs disagree with the closed operation recipe.');
			}
			const models = modelBindings(stage.stageId, stage.modelSlots.map(({ slotId }) => slotId),
				selectedModels);
			const project = dataRecord(dependencies.getProject(), 'Advanced project');
			const fence = createLocalAssistanceGuidedAggregateFenceV1({ project,
				primitiveFences: [prepared.selectionFence], stages: graph,
				settingsBody: serializeAssistanceWorkflowSettingsV1(settings), models });
			const reservationBytes = prepared.outputs.reduce(
				(total, output) => safeSum(total, output.maximumByteLength), 0,
			);
			await dependencies.preflightStorage(reservationBytes);
			dependencies.assertProject(token);
			const inputs: AssistanceWorkflowClaimV1[] = [];
			for (const input of prepared.inputs) {
				const handle = await request.custody.stageInput({ jobId: request.jobId, workflowId,
					stageId: stage.stageId, slotId: input.role, mediaType: input.mediaType,
					bytes: input.bytes, signal: request.signal });
				inputs.push(assertHandle(handle, 'input', request.jobId, stage.stageId, input.role));
				dependencies.assertProject(token);
			}
			const outputs: AssistanceWorkflowClaimV1[] = [];
			for (const [index, output] of prepared.outputs.entries()) {
				const slotId = outputSlots[index]!;
				const handle = await request.custody.reserveOutput({ jobId: request.jobId, workflowId,
					stageId: stage.stageId, slotId, maximumByteLength: output.maximumByteLength });
				outputs.push(assertHandle(handle, 'output', request.jobId, stage.stageId, slotId));
				dependencies.assertProject(token);
			}
			const workflow = validateAssistanceWorkflow({ contractVersion: 1, jobId: request.jobId,
				workflowId, recipeVersion: 1, settingsVersion: 1, settings, fence,
				stageIds: [stage.stageId], models, inputs, outputs });
			return Object.freeze({ outcome: 'prepared', workflow, prepared });
		} catch (error) {
			await request.custody.release(request.jobId).catch(() => false);
			if (error instanceof LocalAssistanceAdvancedContextUnavailableError) {
				return unavailable('source-custody-unavailable');
			}
			throw error;
		}
	}
}

function modelBindings(
	stageId: string,
	slotIds: readonly string[],
	models: readonly LocalAssistanceModel[],
): readonly AssistanceWorkflowModelBindingV1[] {
	if (models.length > slotIds.length || models.length < slotIds.length
		&& slotIds.some((slotId) => slotId !== 'model')) {
		throw new TypeError('Advanced model selection disagrees with its closed stage slots.');
	}
	return Object.freeze(models.map((model, index) => Object.freeze({ bindingVersion: 1 as const,
		stageId, slotId: slotIds[index]!, modelId: model.modelId, version: model.version,
		artifactSha256s: Object.freeze([...model.artifactSha256s].sort()) })));
}

function assertHandle(
	handle: Readonly<{ custody: AssistanceWorkflowCustodyClaimV1;
		workflowClaim: AssistanceWorkflowClaimV1 }>,
	direction: 'input' | 'output',
	jobId: string,
	stageId: string,
	slotId: string,
): AssistanceWorkflowClaimV1 {
	const claim = handle?.workflowClaim;
	if (!handle?.custody || claim?.direction !== direction || claim.jobId !== jobId
		|| claim.stageId !== stageId || claim.slotId !== slotId
		|| claim.claimId !== handle.custody.claimId) {
		throw new TypeError('Advanced custody returned an uncorrelated slotted claim.');
	}
	return claim;
}

function safeSum(total: number, value: number): number {
	const result = total + value;
	if (!Number.isSafeInteger(result)) throw new RangeError('Advanced output reservations exceed safe storage.');
	return result;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function assertDependencies(value: LocalAssistanceAdvancedWorkflowPreparationDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.getProject !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.preflightStorage !== 'function' || !value.selected
		|| typeof value.selected.prepareSelectedMedia !== 'function') {
		throw new TypeError('Advanced preparation requires exact project, storage, and media custody ports.');
	}
}

function unavailable(
	reason: 'aggregate-custody-unavailable' | 'model-binding-unavailable'
		| 'source-custody-unavailable',
): LocalAssistanceAdvancedWorkflowPreparationOutcome {
	return Object.freeze({ outcome: 'unavailable', reason });
}
