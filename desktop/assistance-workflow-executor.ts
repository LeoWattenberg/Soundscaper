/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned aggregate workflow dispatch over opaque, pathless V1 claims. */

import {
	ASSISTANCE_WORKFLOW_IDS,
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowInputClaimV1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowStageSpec,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import type {
	AssistanceWorkflowExecutionContext,
	AssistanceWorkflowExecutionResult,
} from './assistance-workflow-service.ts';

export const ASSISTANCE_WORKFLOW_STAGE_CUSTODY_VERSION = 1;

/**
 * Stages implemented as deterministic, main-owned transformations rather than
 * primitive inference operations. Keeping this list closed prevents a supplied
 * handler name from becoming an execution surface.
 */
export const ASSISTANCE_WORKFLOW_OWNED_STAGE_IDS = Object.freeze([
	'assemble-captions',
	'propose-cleanup',
	'attribute-speakers',
	'merge-reaction-ranges',
	'chunk-transcript',
	'publish-transcript-index',
	'propose-tempo-map',
	'normalize-cuts',
	'sample-shot-frames',
	'publish-video-index',
	'track-subjects',
	'plan-crops',
	'gather-signals',
	'rank-highlights',
	'assemble-highlights',
] as const);

export type AssistanceWorkflowOwnedStageId =
	(typeof ASSISTANCE_WORKFLOW_OWNED_STAGE_IDS)[number];

/** A pathless capability identity. A custody bridge may associate private data with its object identity. */
export interface AssistanceWorkflowStageCustodyTokenV1 {
	readonly custodyVersion: typeof ASSISTANCE_WORKFLOW_STAGE_CUSTODY_VERSION;
	readonly jobId: string;
	readonly stageId: string;
	readonly inputClaimIds: readonly string[];
	readonly outputClaimIds: readonly string[];
}

/** Exact, canonically slotted stage authority presented to a custody resolver. */
export interface AssistanceWorkflowStageBindingV1 {
	readonly request: AssistanceWorkflowV1;
	readonly stage: AssistanceWorkflowStageSpec;
	readonly stageIndex: number;
	readonly stageCount: number;
	readonly inputs: readonly AssistanceWorkflowInputClaimV1[];
	readonly outputs: readonly AssistanceWorkflowOutputClaimV1[];
	readonly models: readonly AssistanceWorkflowModelBindingV1[];
	readonly signal: AbortSignal;
}

/** Authority presented to exactly one primitive port or owned deterministic handler. */
export interface AssistanceWorkflowStageExecutionV1 extends AssistanceWorkflowStageBindingV1 {
	readonly custody: AssistanceWorkflowStageCustodyTokenV1;
	progress(completed: number, total: number): void;
}

export type AssistanceWorkflowStageResultV1 = Readonly<{
	outcome: 'completed';
}> | Readonly<{
	outcome: 'unavailable';
	reason: 'stage-unavailable' | 'model-unavailable';
}>;

export type AssistanceWorkflowStageCustodyResultV1 = Readonly<{
	outcome: 'resolved';
	custody: AssistanceWorkflowStageCustodyTokenV1;
}> | Readonly<{
	outcome: 'unavailable';
	reason: 'stage-unavailable';
}>;

export type AssistanceWorkflowCustodyResolver = (
	stage: AssistanceWorkflowStageBindingV1,
) => PromiseLike<AssistanceWorkflowStageCustodyResultV1> | AssistanceWorkflowStageCustodyResultV1;

export type AssistanceWorkflowPrimitiveStagePort = (
	stage: AssistanceWorkflowStageExecutionV1,
) => PromiseLike<AssistanceWorkflowStageResultV1> | AssistanceWorkflowStageResultV1;

export type AssistanceWorkflowOwnedStageHandler = AssistanceWorkflowPrimitiveStagePort;

export type AssistanceWorkflowOwnedStageHandlers = Readonly<Partial<Record<
	AssistanceWorkflowOwnedStageId,
	AssistanceWorkflowOwnedStageHandler
>>>;

export interface AssistanceWorkflowExecutorOptions {
	readonly resolveCustody?: AssistanceWorkflowCustodyResolver;
	readonly runPrimitiveStage?: AssistanceWorkflowPrimitiveStagePort;
	readonly deterministicHandlers?: AssistanceWorkflowOwnedStageHandlers;
}

const OPTION_KEYS = Object.freeze([
	'resolveCustody', 'runPrimitiveStage', 'deterministicHandlers',
]);
const CUSTODY_KEYS = Object.freeze([
	'custodyVersion', 'jobId', 'stageId', 'inputClaimIds', 'outputClaimIds',
]);
const CUSTODY_RESULT_KEYS = Object.freeze(['outcome', 'custody']);
const UNAVAILABLE_RESULT_KEYS = Object.freeze(['outcome', 'reason']);
const COMPLETED_RESULT_KEYS = Object.freeze(['outcome']);
const OWNED_STAGE_ID_SET = new Set<string>(ASSISTANCE_WORKFLOW_OWNED_STAGE_IDS);

assertOwnedStageRegistryComplete();

/** Mint the immutable identity a main-owned custody resolver returns for one exact stage. */
export function createAssistanceWorkflowStageCustodyToken(
	stage: AssistanceWorkflowStageBindingV1,
): AssistanceWorkflowStageCustodyTokenV1 {
	if (!stage || typeof stage !== 'object') {
		throw new TypeError('The assistance workflow stage binding is invalid.');
	}
	return Object.freeze({
		custodyVersion: ASSISTANCE_WORKFLOW_STAGE_CUSTODY_VERSION,
		jobId: stage.request.jobId,
		stageId: stage.stage.stageId,
		inputClaimIds: Object.freeze(stage.inputs.map(({ claimId }) => claimId)),
		outputClaimIds: Object.freeze(stage.outputs.map(({ claimId }) => claimId)),
	});
}

/**
 * Build an aggregate executor without inventing operation-v1 file claims. The
 * injected custody resolver and stage ports own the future V2 data bridge.
 */
export function createAssistanceWorkflowExecutor(
	optionsValue: AssistanceWorkflowExecutorOptions,
): (
	request: AssistanceWorkflowV1,
	context: AssistanceWorkflowExecutionContext,
) => Promise<AssistanceWorkflowExecutionResult> {
	const options = normalizeOptions(optionsValue);
	return async (requestValue, context) => {
		const request = validateAssistanceWorkflow(requestValue);
		const executionContext = validateExecutionContext(context);
		const graph = assistanceWorkflowStageGraph(request.workflowId);
		const selected = Object.freeze(request.stageIds.map((stageId) => {
			const stage = graph.find((candidate) => candidate.stageId === stageId);
			if (!stage) throw new TypeError('The assistance workflow selected an unknown derived stage.');
			return stage;
		}));

		for (const [stageIndex, stage] of selected.entries()) {
			executionContext.signal.throwIfAborted();
			if (stageIndex > 0) executionContext.progress(stage.stageId, 'queued');
			const binding = bindStage(request, stage, stageIndex, selected.length, executionContext.signal);
			executionContext.progress(stage.stageId, 'staging-input');
			const resolver = options.resolveCustody;
			if (!resolver) return unavailableStage(executionContext, stage.stageId, 'stage-unavailable');
			const custodyResult = validateCustodyResult(await resolver(binding), binding);
			executionContext.signal.throwIfAborted();
			if (custodyResult.outcome === 'unavailable') {
				return unavailableStage(executionContext, stage.stageId, custodyResult.reason);
			}

			const delegate = stage.operation === null
				? options.deterministicHandlers.get(stage.stageId as AssistanceWorkflowOwnedStageId)
				: options.runPrimitiveStage;
			if (!delegate) return unavailableStage(executionContext, stage.stageId, 'stage-unavailable');
			if (binding.models.length > 0) executionContext.progress(stage.stageId, 'loading-model');
			executionContext.progress(stage.stageId, 'running');
			let active = true;
			let determinateTotal: number | null = null;
			let determinateCompleted = 0;
			const progress = (completed: number, total: number): void => {
				if (!active) throw new Error('The assistance workflow stage is no longer active.');
				executionContext.signal.throwIfAborted();
				if (!Number.isFinite(completed) || completed < 0 || !Number.isFinite(total)
					|| total <= 0 || completed > total) {
					throw new TypeError('Assistance workflow stage progress must use finite bounded units.');
				}
				if (determinateTotal !== null
					&& (total !== determinateTotal || completed < determinateCompleted)) {
					throw new TypeError('Assistance workflow stage progress must advance monotonically.');
				}
				determinateTotal = total;
				determinateCompleted = completed;
				executionContext.progress(stage.stageId, 'running', completed, total);
			};
			const stageExecution = Object.freeze({ ...binding, custody: custodyResult.custody, progress });
			let result: AssistanceWorkflowStageResultV1;
			try {
				result = validateStageResult(await delegate(stageExecution));
			} finally {
				active = false;
			}
			executionContext.signal.throwIfAborted();
			if (result.outcome === 'unavailable') {
				return unavailableStage(executionContext, stage.stageId, result.reason);
			}
			executionContext.progress(stage.stageId, 'staging-output');
			executionContext.progress(stage.stageId, 'finalizing');
		}
		return Object.freeze({ outcome: 'completed' as const });
	};
}

interface NormalizedExecutorOptions {
	readonly resolveCustody?: AssistanceWorkflowCustodyResolver;
	readonly runPrimitiveStage?: AssistanceWorkflowPrimitiveStagePort;
	readonly deterministicHandlers: ReadonlyMap<
		AssistanceWorkflowOwnedStageId,
		AssistanceWorkflowOwnedStageHandler
	>;
}

function normalizeOptions(value: unknown): NormalizedExecutorOptions {
	const record = exactRecord(value, OPTION_KEYS, 'executor options', true);
	const resolver = optionalFunction(record.resolveCustody, 'custody resolver');
	const primitive = optionalFunction(record.runPrimitiveStage, 'primitive stage port');
	const handlers = new Map<AssistanceWorkflowOwnedStageId, AssistanceWorkflowOwnedStageHandler>();
	if (record.deterministicHandlers !== undefined) {
		const handlerRecord = exactOpenRecord(record.deterministicHandlers, 'deterministic handler map');
		for (const key of Object.keys(handlerRecord)) {
			if (!OWNED_STAGE_ID_SET.has(key)) {
				throw new TypeError(`The assistance workflow handler names an unowned stage ${key}.`);
			}
			const handler = handlerRecord[key];
			if (typeof handler !== 'function') {
				throw new TypeError('An assistance workflow deterministic handler must be a function.');
			}
			handlers.set(key as AssistanceWorkflowOwnedStageId, handler as AssistanceWorkflowOwnedStageHandler);
		}
	}
	return Object.freeze({
		...(resolver ? { resolveCustody: resolver as AssistanceWorkflowCustodyResolver } : {}),
		...(primitive ? { runPrimitiveStage: primitive as AssistanceWorkflowPrimitiveStagePort } : {}),
		deterministicHandlers: handlers,
	});
}

function bindStage(
	request: AssistanceWorkflowV1,
	stage: AssistanceWorkflowStageSpec,
	stageIndex: number,
	stageCount: number,
	signal: AbortSignal,
): AssistanceWorkflowStageBindingV1 {
	return Object.freeze({
		request,
		stage,
		stageIndex,
		stageCount,
		inputs: claimsForSlots(request.inputs, stage.stageId, stage.inputSlots),
		outputs: claimsForSlots(request.outputs, stage.stageId, stage.outputSlots),
		models: claimsForSlots(request.models, stage.stageId, stage.modelSlots),
		signal,
	});
}

function claimsForSlots<Claim extends Readonly<{ stageId: string; slotId: string }>>(
	claims: readonly Claim[],
	stageId: string,
	slots: readonly Readonly<{ slotId: string }>[],
): readonly Claim[] {
	return Object.freeze(slots.flatMap(({ slotId }) => {
		const claim = claims.find((candidate) => candidate.stageId === stageId && candidate.slotId === slotId);
		return claim ? [claim] : [];
	}));
}

function validateCustodyResult(
	value: unknown,
	stage: AssistanceWorkflowStageBindingV1,
): AssistanceWorkflowStageCustodyResultV1 {
	const record = exactOpenRecord(value, 'custody resolver result');
	if (record.outcome === 'unavailable') {
		exactKeys(record, UNAVAILABLE_RESULT_KEYS, 'custody resolver result');
		if (record.reason !== 'stage-unavailable') {
			throw new TypeError('The assistance workflow custody resolver reason is invalid.');
		}
		return Object.freeze({ outcome: 'unavailable', reason: 'stage-unavailable' });
	}
	if (record.outcome !== 'resolved') {
		throw new TypeError('The assistance workflow custody resolver result is invalid.');
	}
	exactKeys(record, CUSTODY_RESULT_KEYS, 'custody resolver result');
	const custody = validateCustodyToken(record.custody, stage);
	return Object.freeze({ outcome: 'resolved', custody });
}

function validateCustodyToken(
	value: unknown,
	stage: AssistanceWorkflowStageBindingV1,
): AssistanceWorkflowStageCustodyTokenV1 {
	const record = exactOpenRecord(value, 'stage custody token');
	exactKeys(record, CUSTODY_KEYS, 'stage custody token');
	if (!Object.isFrozen(value) || !Object.isFrozen(record.inputClaimIds)
		|| !Object.isFrozen(record.outputClaimIds)) {
		throw new TypeError('The assistance workflow stage custody token must be immutable.');
	}
	if (record.custodyVersion !== ASSISTANCE_WORKFLOW_STAGE_CUSTODY_VERSION
		|| record.jobId !== stage.request.jobId || record.stageId !== stage.stage.stageId) {
		throw new TypeError('The assistance workflow stage custody token does not bind its exact stage.');
	}
	assertExactClaimIds(record.inputClaimIds, stage.inputs, 'input');
	assertExactClaimIds(record.outputClaimIds, stage.outputs, 'output');
	return value as AssistanceWorkflowStageCustodyTokenV1;
}

function assertExactClaimIds(
	value: unknown,
	claims: readonly Readonly<{ claimId: string }>[],
	direction: 'input' | 'output',
): void {
	if (!Array.isArray(value) || value.length !== claims.length
		|| value.some((claimId, index) => claimId !== claims[index]!.claimId)) {
		throw new TypeError(`The assistance workflow custody ${direction} claims do not match the stage.`);
	}
}

function validateStageResult(value: unknown): AssistanceWorkflowStageResultV1 {
	const record = exactOpenRecord(value, 'stage result');
	if (record.outcome === 'completed') {
		exactKeys(record, COMPLETED_RESULT_KEYS, 'stage result');
		return Object.freeze({ outcome: 'completed' });
	}
	if (record.outcome !== 'unavailable') {
		throw new TypeError('The assistance workflow stage result is invalid.');
	}
	exactKeys(record, UNAVAILABLE_RESULT_KEYS, 'stage result');
	if (record.reason !== 'stage-unavailable' && record.reason !== 'model-unavailable') {
		throw new TypeError('The assistance workflow stage unavailable reason is invalid.');
	}
	return Object.freeze({ outcome: 'unavailable', reason: record.reason });
}

function unavailableStage(
	context: AssistanceWorkflowExecutionContext,
	stageId: string,
	reason: 'stage-unavailable' | 'model-unavailable',
): AssistanceWorkflowExecutionResult {
	context.progress(stageId, 'finalizing');
	return Object.freeze({ outcome: 'unavailable', reason });
}

function validateExecutionContext(value: AssistanceWorkflowExecutionContext): AssistanceWorkflowExecutionContext {
	if (!value || typeof value !== 'object' || typeof value.progress !== 'function'
		|| !isAbortSignal(value.signal)) {
		throw new TypeError('The assistance workflow execution context is invalid.');
	}
	return value;
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return Boolean(value && typeof value === 'object'
		&& typeof (value as AbortSignal).throwIfAborted === 'function'
		&& typeof (value as AbortSignal).addEventListener === 'function');
}

function optionalFunction(value: unknown, label: string): ((...args: never[]) => unknown) | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'function') throw new TypeError(`The assistance workflow ${label} is invalid.`);
	return value as (...args: never[]) => unknown;
}

function exactRecord(
	value: unknown,
	admittedKeys: readonly string[],
	label: string,
	allowMissing: boolean,
): Record<string, unknown> {
	const record = exactOpenRecord(value, label);
	const keys = Object.keys(record);
	if (keys.some((key) => !admittedKeys.includes(key))
		|| (!allowMissing && keys.length !== admittedKeys.length)) {
		throw new TypeError(`The assistance workflow ${label} schema keys are invalid.`);
	}
	return record;
}

function exactOpenRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The assistance workflow ${label} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`The assistance workflow ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string')
		|| keys.some((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return !descriptor?.enumerable || !('value' in descriptor);
		})) {
		throw new TypeError(`The assistance workflow ${label} schema keys are invalid.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	if (Object.keys(record).length !== keys.length
		|| Object.keys(record).some((key) => !keys.includes(key))) {
		throw new TypeError(`The assistance workflow ${label} schema keys are invalid.`);
	}
}

function assertOwnedStageRegistryComplete(): void {
	const derived = new Set<string>();
	for (const workflowId of ASSISTANCE_WORKFLOW_IDS) {
		for (const stage of assistanceWorkflowStageGraph(workflowId)) {
			if (stage.operation === null) derived.add(stage.stageId);
		}
	}
	if (derived.size !== OWNED_STAGE_ID_SET.size
		|| [...derived].some((stageId) => !OWNED_STAGE_ID_SET.has(stageId))) {
		throw new Error('The assistance workflow owned-stage registry is incomplete.');
	}
}
