/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, renderer-independent contract for the isolated OpenFX 1.5.1 host. */

import {
	OFX_CONTEXTS,
	OFX_HOST_SUITES,
	OFX_PARAMETER_TYPES,
	OFX_THREADING_DECLARATIONS,
	type OfxContext,
} from './native-ofx-descriptor.ts';
import { createNativeValidators } from './native-validation.ts';
import { assertAuthenticatedOfxRetimerSourceTimeV1 } from './native-ofx-retimer-source-time.ts';

export const OFX_HOST_ACTIONS_V1 = Object.freeze([
	'load', 'unload', 'describe', 'describe-in-context',
	'create-instance', 'destroy-instance',
	'begin-instance-changed', 'instance-changed', 'end-instance-changed',
	'get-region-of-definition', 'get-regions-of-interest', 'frames-needed',
	'get-frame-varying', 'get-time-domain', 'is-identity',
	'begin-sequence-render', 'render', 'end-sequence-render',
	'sync-private-data', 'purge-caches', 'abort',
] as const);

export type OfxHostActionV1 = (typeof OFX_HOST_ACTIONS_V1)[number];

export const OFX_RENDER_BACKENDS_V1 = Object.freeze([
	'cpu', 'opengl', 'opencl', 'cuda', 'metal',
] as const);

export type OfxRenderBackendV1 = (typeof OFX_RENDER_BACKENDS_V1)[number];

export const OFX_RETRYABLE_GPU_ERROR_CODES_V1 = Object.freeze([
	'OFX_UNSUPPORTED_BACKEND',
	'OFX_GPU_EXECUTION_FAILED',
] as const);

export type OfxRetryableGpuErrorCodeV1 =
	(typeof OFX_RETRYABLE_GPU_ERROR_CODES_V1)[number];

/** A closed native/helper failure that alone authorizes one identical CPU retry. */
export class OfxRetryableGpuError extends Error {
	readonly code: OfxRetryableGpuErrorCodeV1;

	constructor(code: OfxRetryableGpuErrorCodeV1, message: string) {
		super(message);
		this.name = 'OfxRetryableGpuError';
		this.code = code;
	}
}

export function isOfxRetryableGpuError(value: unknown): value is Error & {
	readonly code: OfxRetryableGpuErrorCodeV1;
} {
	if (!(value instanceof Error) || value.name !== 'OfxRetryableGpuError') return false;
	return (OFX_RETRYABLE_GPU_ERROR_CODES_V1 as readonly unknown[])
		.includes((value as Error & { readonly code?: unknown }).code);
}

/** Admit only the native host's two exact retryable GPU failure documents. */
export function parseOfxRetryableNativeGpuErrorV1(stderr: string): OfxRetryableGpuError | null {
	let value: unknown;
	try { value = JSON.parse(stderr) as unknown; }
	catch { return null; }
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).length !== 2 || !Object.hasOwn(value, 'error')
		|| !Object.hasOwn(value, 'message')) return null;
	const { error, message } = value as Record<string, unknown>;
	if (typeof message !== 'string' || message.length < 1 || message.length > 4_096) return null;
	const code = error === 'unsupported-backend' ? 'OFX_UNSUPPORTED_BACKEND'
		: error === 'gpu-execution-failed' ? 'OFX_GPU_EXECUTION_FAILED' : null;
	if (code === null || stderr !== `${JSON.stringify({ error, message })}\n`) return null;
	return new OfxRetryableGpuError(code, message);
}

export const OFX_INTERACT_MODIFIERS_V1 = Object.freeze([
	'alt', 'control', 'meta', 'shift',
] as const);

export const OFX_HOST_EXECUTION_CONTRACT_V1 = Object.freeze({
	openfxVersion: '1.5.1' as const,
	contexts: OFX_CONTEXTS,
	suites: OFX_HOST_SUITES,
	parameterTypes: OFX_PARAMETER_TYPES,
	threadingDeclarations: OFX_THREADING_DECLARATIONS,
	actions: OFX_HOST_ACTIONS_V1,
	interacts: Object.freeze([
		'interact-v1', 'interact-v2', 'custom-parameter-interact', 'draw-suite-v1',
	] as const),
	cpuRenderingRequired: true as const,
	optionalGpuBackends: Object.freeze(['opengl', 'opencl', 'cuda', 'metal'] as const),
	abortPollingRequired: true as const,
	offscreenUiOnly: true as const,
	deniedAuthorities: Object.freeze([
		'network', 'arbitrary-filesystem', 'vendor-top-level-window',
	] as const),
});

export interface OfxRetimerSourceTimeWireV1 {
	readonly parameter: 'SourceTime';
	readonly outputOrdinal: number;
	readonly clipId: string;
	readonly sourceId: string;
	readonly numerator: string;
	readonly denominator: string;
}

export interface OfxHostInvocationV1 {
	readonly schemaVersion: 1;
	readonly invocationId: string;
	readonly unifiedPlanVersion: 12;
	readonly unifiedPlanSha256: string;
	readonly nodeId: string;
	readonly instanceId: string;
	readonly pluginId: string;
	readonly pluginBinarySha256: string;
	readonly pluginFingerprint: string;
	readonly context: OfxContext;
	readonly action: OfxHostActionV1;
	readonly stateSha256: string;
	readonly inputFrameStreamIds: readonly string[];
	readonly outputFrameStreamId: string | null;
	readonly outputOrdinal: number;
	readonly requestedBackend: OfxRenderBackendV1;
	readonly abortSignalId: string;
	readonly retimerSourceTime: OfxRetimerSourceTimeWireV1 | null;
}

export type OfxInteractEventV1 = Readonly<
	| {
		readonly kind: 'pointer';
		readonly sequence: number;
		readonly x: number;
		readonly y: number;
		readonly button: number;
		readonly modifiers: readonly ('alt' | 'control' | 'meta' | 'shift')[];
	}
	| {
		readonly kind: 'keyboard';
		readonly sequence: number;
		readonly key: string;
		readonly code: string;
		readonly pressed: boolean;
		readonly modifiers: readonly ('alt' | 'control' | 'meta' | 'shift')[];
	}
	| {
		readonly kind: 'focus';
		readonly sequence: number;
		readonly focused: boolean;
	}
>;

export interface OfxRenderBackendResolutionV1 {
	readonly backend: OfxRenderBackendV1;
	readonly retriedOnCpu: boolean;
	readonly reportsDegradation: boolean;
}

export interface OfxRuntimeProcessBatchV1 {
	readonly pluginFingerprint: string;
	readonly invocations: readonly OfxHostInvocationV1[];
}

export class OfxHostContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OfxHostContractError';
	}
}

const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,4095}$/u;
const SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]{0,1233})$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,1233})$/u;
const INVOCATION_KEYS = Object.freeze([
	'schemaVersion', 'invocationId', 'unifiedPlanVersion', 'unifiedPlanSha256',
	'nodeId', 'instanceId', 'pluginId', 'pluginBinarySha256',
	'pluginFingerprint', 'context', 'action', 'stateSha256',
	'inputFrameStreamIds', 'outputFrameStreamId', 'outputOrdinal', 'requestedBackend',
	'abortSignalId', 'retimerSourceTime',
]);
const SOURCE_TIME_KEYS = Object.freeze([
	'parameter', 'outputOrdinal', 'clipId', 'sourceId', 'numerator', 'denominator',
]);
const { digest, exactKeys, nonNegativeInteger, pattern, plainRecord: record } =
	createNativeValidators({
		subject: 'An OFX host invocation',
		article: 'An',
		requirePlainPrototype: true,
		raise: (message: string): never => { throw new OfxHostContractError(message); },
	});

export function createOfxHostInvocationV1(value: Readonly<Record<string, unknown>>): OfxHostInvocationV1 {
	const pluginId = pattern(value.pluginId, ID, 'pluginId');
	const pluginBinarySha256 = digest(value.pluginBinarySha256, 'pluginBinarySha256');
	const context = value.context;
	if (context === 'retimer') assertAuthenticatedOfxRetimerSourceTimeV1(value.retimerSourceTime);
	const invocation: OfxHostInvocationV1 = {
		schemaVersion: 1,
		invocationId: pattern(value.invocationId, ID, 'invocationId'),
		unifiedPlanVersion: 12,
		unifiedPlanSha256: digest(value.unifiedPlanSha256, 'unifiedPlanSha256'),
		nodeId: pattern(value.nodeId, GRAPH_ID, 'nodeId'),
		instanceId: pattern(value.instanceId, ID, 'instanceId'),
		pluginId,
		pluginBinarySha256,
		pluginFingerprint: `${pluginId}@${pluginBinarySha256}`,
		context: context as OfxContext,
		action: value.action as OfxHostActionV1,
		stateSha256: digest(value.stateSha256, 'stateSha256'),
		inputFrameStreamIds: snapshotIds(value.inputFrameStreamIds, 'inputFrameStreamIds', 16),
		outputFrameStreamId: value.outputFrameStreamId === null
			? null : pattern(value.outputFrameStreamId, ID, 'outputFrameStreamId'),
		outputOrdinal: nonNegativeInteger(value.outputOrdinal, 'outputOrdinal'),
		requestedBackend: value.requestedBackend as OfxRenderBackendV1,
		abortSignalId: pattern(value.abortSignalId, ID, 'abortSignalId'),
		retimerSourceTime: value.retimerSourceTime === undefined
			? null : snapshotSourceTime(value.retimerSourceTime),
	};
	assertOfxHostInvocationV1(invocation);
	return deepFreeze(invocation);
}

export function assertOfxHostInvocationV1(value: unknown): asserts value is OfxHostInvocationV1 {
	const invocation = record(value, 'OFX host invocation');
	exactKeys(invocation, INVOCATION_KEYS, 'OFX host invocation');
	if (invocation.schemaVersion !== 1) throw new OfxHostContractError('An OFX host invocation schema is unsupported.');
	pattern(invocation.invocationId, ID, 'invocationId');
	if (invocation.unifiedPlanVersion !== 12) {
		throw new OfxHostContractError('An OFX host invocation requires unified exact plan V12.');
	}
	digest(invocation.unifiedPlanSha256, 'unifiedPlanSha256');
	pattern(invocation.nodeId, GRAPH_ID, 'nodeId');
	pattern(invocation.instanceId, ID, 'instanceId');
	const pluginId = pattern(invocation.pluginId, ID, 'pluginId');
	const binarySha256 = digest(invocation.pluginBinarySha256, 'pluginBinarySha256');
	if (invocation.pluginFingerprint !== `${pluginId}@${binarySha256}`) {
		throw new OfxHostContractError('An OFX host invocation fingerprint does not match its exact binary.');
	}
	if (!(OFX_CONTEXTS as readonly unknown[]).includes(invocation.context)) {
		throw new OfxHostContractError('An OFX host invocation context is unsupported.');
	}
	if (!(OFX_HOST_ACTIONS_V1 as readonly unknown[]).includes(invocation.action)) {
		throw new OfxHostContractError('An OFX host invocation action is unsupported.');
	}
	digest(invocation.stateSha256, 'stateSha256');
	snapshotIds(invocation.inputFrameStreamIds, 'inputFrameStreamIds', 16);
	if (invocation.outputFrameStreamId !== null) {
		pattern(invocation.outputFrameStreamId, ID, 'outputFrameStreamId');
	}
	nonNegativeInteger(invocation.outputOrdinal, 'outputOrdinal');
	if (!(OFX_RENDER_BACKENDS_V1 as readonly unknown[]).includes(invocation.requestedBackend)) {
		throw new OfxHostContractError('An OFX host invocation render backend is unsupported.');
	}
	pattern(invocation.abortSignalId, ID, 'abortSignalId');
	if (invocation.context === 'retimer') {
		if (invocation.retimerSourceTime === null) {
			throw new OfxHostContractError('An OFX Retimer invocation requires exact SourceTime.');
		}
		snapshotSourceTime(invocation.retimerSourceTime);
	} else if (invocation.retimerSourceTime !== null) {
		throw new OfxHostContractError('Only an OFX Retimer invocation may carry SourceTime.');
	}
}

/** Enforce the one-binary-fingerprint-per-runtime-process isolation boundary. */
export function assertOfxRuntimeProcessBatchV1(
	value: unknown,
): asserts value is OfxRuntimeProcessBatchV1 {
	const batch = record(value, 'OFX runtime process batch');
	exactKeys(batch, ['pluginFingerprint', 'invocations'], 'OFX runtime process batch');
	if (!Array.isArray(batch.invocations) || batch.invocations.length < 1
		|| batch.invocations.length > 4_096) {
		throw new OfxHostContractError('An OFX runtime process batch must be bounded and non-empty.');
	}
	for (const invocation of batch.invocations) {
		assertOfxHostInvocationV1(invocation);
		if (invocation.pluginFingerprint !== batch.pluginFingerprint) {
			throw new OfxHostContractError('An OFX runtime process may host only one binary fingerprint.');
		}
	}
}

export function resolveOfxRenderBackendV1(value: unknown): OfxRenderBackendResolutionV1 {
	const input = record(value, 'OFX render backend request');
	exactKeys(
		input,
		['requestedBackend', 'qualifiedBackends', 'failedBackends'],
		'OFX render backend request',
	);
	const requested = backend(input.requestedBackend, 'requestedBackend');
	const qualified = snapshotBackends(input.qualifiedBackends, 'qualifiedBackends');
	const failed = new Set(snapshotBackends(input.failedBackends, 'failedBackends'));
	if (!qualified.includes('cpu')) {
		throw new OfxHostContractError('An OFX runtime must qualify mandatory CPU rendering.');
	}
	if (qualified.includes(requested) && !failed.has(requested)) {
		return Object.freeze({ backend: requested, retriedOnCpu: false, reportsDegradation: false });
	}
	if (failed.has('cpu')) throw new OfxHostContractError('The mandatory OFX CPU fallback is unavailable.');
	return Object.freeze({
		backend: 'cpu' as const,
		retriedOnCpu: requested !== 'cpu',
		reportsDegradation: requested !== 'cpu',
	});
}

export function normalizeOfxInteractEventV1(value: unknown): OfxInteractEventV1 {
	const event = record(value, 'offscreen OFX Interact event');
	if (event.kind === 'pointer') {
		exactKeys(event, ['kind', 'sequence', 'x', 'y', 'button', 'modifiers'], 'offscreen OFX Interact pointer event');
		const x = normalizedCoordinate(event.x, 'x');
		const y = normalizedCoordinate(event.y, 'y');
		const button = nonNegativeInteger(event.button, 'pointer button');
		if (button > 7) throw new OfxHostContractError('An OFX pointer button is unsupported.');
		return Object.freeze({
			kind: 'pointer', sequence: sequence(event.sequence), x, y, button,
			modifiers: modifiers(event.modifiers),
		});
	}
	if (event.kind === 'keyboard') {
		exactKeys(event, ['kind', 'sequence', 'key', 'code', 'pressed', 'modifiers'], 'offscreen OFX Interact keyboard event');
		if (typeof event.key !== 'string' || event.key.length > 64
			|| typeof event.code !== 'string' || event.code.length > 64) {
			throw new OfxHostContractError('An OFX keyboard event must carry bounded key identities.');
		}
		if (typeof event.pressed !== 'boolean') {
			throw new OfxHostContractError('An OFX keyboard event must state whether its key is pressed.');
		}
		return Object.freeze({
			kind: 'keyboard', sequence: sequence(event.sequence), key: event.key,
			code: event.code, pressed: event.pressed, modifiers: modifiers(event.modifiers),
		});
	}
	if (event.kind === 'focus') {
		exactKeys(event, ['kind', 'sequence', 'focused'], 'offscreen OFX Interact focus event');
		if (typeof event.focused !== 'boolean') {
			throw new OfxHostContractError('An OFX focus event must state its focus.');
		}
		return Object.freeze({ kind: 'focus', sequence: sequence(event.sequence), focused: event.focused });
	}
	throw new OfxHostContractError('An unsupported OFX interaction cannot escape the offscreen UI.');
}

function snapshotSourceTime(value: unknown): OfxRetimerSourceTimeWireV1 | null {
	if (value === null) return null;
	const sourceTime = record(value, 'OFX Retimer SourceTime');
	exactKeys(sourceTime, SOURCE_TIME_KEYS, 'OFX Retimer SourceTime');
	if (sourceTime.parameter !== 'SourceTime') {
		throw new OfxHostContractError('An OFX Retimer value must bind the standard SourceTime parameter.');
	}
	const numerator = pattern(sourceTime.numerator, SIGNED_INTEGER, 'SourceTime numerator');
	const denominator = pattern(sourceTime.denominator, UNSIGNED_INTEGER, 'SourceTime denominator');
	if (denominator === '0') throw new OfxHostContractError('An OFX Retimer SourceTime denominator must be positive.');
	return Object.freeze({
		parameter: 'SourceTime',
		outputOrdinal: nonNegativeInteger(sourceTime.outputOrdinal, 'SourceTime outputOrdinal'),
		clipId: pattern(sourceTime.clipId, ID, 'SourceTime clipId'),
		sourceId: pattern(sourceTime.sourceId, ID, 'SourceTime sourceId'),
		numerator,
		denominator,
	});
}

function snapshotIds(value: unknown, label: string, maximum: number): readonly string[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new OfxHostContractError(`An OFX host invocation ${label} must be a bounded array.`);
	}
	const ids = value.map((entry) => pattern(entry, ID, label));
	if (new Set(ids).size !== ids.length) {
		throw new OfxHostContractError(`An OFX host invocation ${label} must be unique.`);
	}
	return Object.freeze(ids);
}

function snapshotBackends(value: unknown, label: string): readonly OfxRenderBackendV1[] {
	if (!Array.isArray(value)) throw new OfxHostContractError(`An OFX ${label} value must be an array.`);
	const values = value.map((entry) => backend(entry, label));
	if (new Set(values).size !== values.length) throw new OfxHostContractError(`An OFX ${label} value must be unique.`);
	return Object.freeze(values);
}

function backend(value: unknown, label: string): OfxRenderBackendV1 {
	if (!(OFX_RENDER_BACKENDS_V1 as readonly unknown[]).includes(value)) {
		throw new OfxHostContractError(`An OFX ${label} value is unsupported.`);
	}
	return value as OfxRenderBackendV1;
}

function modifiers(value: unknown): readonly ('alt' | 'control' | 'meta' | 'shift')[] {
	if (!Array.isArray(value)) throw new OfxHostContractError('An OFX Interact modifier list must be an array.');
	const result = value.map((entry) => {
		if (!(OFX_INTERACT_MODIFIERS_V1 as readonly unknown[]).includes(entry)) {
			throw new OfxHostContractError('An OFX Interact modifier is unsupported.');
		}
		return entry as 'alt' | 'control' | 'meta' | 'shift';
	});
	if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && result[index - 1]! >= entry)) {
		throw new OfxHostContractError('OFX Interact modifiers must be sorted and unique.');
	}
	return Object.freeze(result);
}

function sequence(value: unknown): number {
	return nonNegativeInteger(value, 'Interact event sequence');
}

function normalizedCoordinate(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new OfxHostContractError(`An OFX Interact ${label} coordinate must be normalized.`);
	}
	return value;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}
