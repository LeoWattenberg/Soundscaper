/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned provider selection and integrity receipts for closed desktop audio operations. */

import { createHash } from 'node:crypto';

import {
	createDesktopAudioCodecResult,
	normalizeDesktopAudioCodecRequest,
	normalizeDesktopAudioCodecResult,
	type DesktopAudioCodecFormat,
	type DesktopAudioCodecRequest,
	type DesktopAudioCodecResult,
	type DesktopDecodedAudioGeometry,
} from './desktop-audio-codec-operation-contract.ts';
import {
	createDesktopCodecCoordinator,
	type DesktopCodecExecutionResult,
	type DesktopCodecOperation,
	type DesktopCodecOperationReceipt,
	type DesktopCodecPreflightResult,
	type DesktopCodecProvider,
	type DesktopCodecProviderKind,
} from '../src/common/editor/desktop-codec-coordinator.ts';

export type DesktopAudioCodecProviderFailureReason =
	| 'unavailable'
	| 'cancelled'
	| 'execution-failed'
	| 'security-failed'
	| 'process-failed'
	| 'result-failed';

export type DesktopAudioCodecProviderExecutionResult =
	| Readonly<{
		readonly status: 'executed';
		readonly output: Uint8Array;
		readonly decodedGeometry?: DesktopDecodedAudioGeometry;
	}>
	| Readonly<{
		readonly status: 'failed';
		readonly reason: DesktopAudioCodecProviderFailureReason;
		readonly detail: string;
	}>;

export interface DesktopAudioCodecProviderRuntime {
	readonly provider: DesktopCodecProvider;
	/** Resolve an aggregate bundled tier to the exact runtime bound to this request. */
	selectRequestRuntime?(
		request: DesktopAudioCodecRequest,
		options: Readonly<{
			readonly operation: DesktopCodecOperation;
			readonly signal?: AbortSignal;
		}>,
	): Promise<DesktopAudioCodecProviderRuntime | null>;
	/** Optional exact-request gate evaluated after the provider's tuple preflight. */
	preflightRequest?(
		request: DesktopAudioCodecRequest,
		options: Readonly<{
			readonly operation: DesktopCodecOperation;
			readonly signal?: AbortSignal;
		}>,
	): Promise<DesktopCodecPreflightResult>;
	execute(
		request: DesktopAudioCodecRequest,
		options: Readonly<{
			readonly operation: DesktopCodecOperation;
			readonly signal?: AbortSignal;
		}>,
	): Promise<unknown>;
}

export type DesktopAudioCodecProviderRuntimeTuple = readonly [
	DesktopAudioCodecProviderRuntime,
	DesktopAudioCodecProviderRuntime,
	DesktopAudioCodecProviderRuntime,
];

export interface DesktopAudioCodecBroker {
	execute(
		request: unknown,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<Readonly<{
		readonly result: DesktopAudioCodecResult;
		readonly receipt: DesktopCodecOperationReceipt;
	}>>;
}

export class DesktopAudioCodecProviderError extends Error {
	readonly code = 'DESKTOP_AUDIO_CODEC_PROVIDER_FAILED' as const;
	readonly providerId: string;
	readonly providerKind: DesktopCodecProviderKind;
	readonly reason: DesktopAudioCodecProviderFailureReason;

	constructor(options: Readonly<{
		readonly provider: DesktopCodecProvider;
		readonly reason: DesktopAudioCodecProviderFailureReason;
		readonly detail: string;
	}>) {
		super(`Desktop audio codec provider ${options.provider.id} failed: ${options.detail}`);
		this.name = 'DesktopAudioCodecProviderError';
		this.providerId = options.provider.id;
		this.providerKind = options.provider.kind;
		this.reason = options.reason;
	}
}

interface AudioOperationDescriptor {
	readonly container: string;
	readonly codec: string;
	readonly profile: string | null;
	readonly decodeSampleFormat: string;
	readonly encodeSampleFormat: string;
}

const AUDIO_OPERATIONS: Readonly<Record<DesktopAudioCodecFormat, Readonly<AudioOperationDescriptor>>> = Object.freeze({
	flac: Object.freeze({
		container: 'flac', codec: 'flac', profile: null,
		decodeSampleFormat: 'f32', encodeSampleFormat: 's24',
	}),
	mp3: Object.freeze({
		container: 'mp3', codec: 'mp3', profile: null,
		decodeSampleFormat: 'f32', encodeSampleFormat: 'f32p',
	}),
	'ogg-vorbis': Object.freeze({
		container: 'ogg', codec: 'vorbis', profile: null,
		decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p',
	}),
	opus: Object.freeze({
		container: 'ogg', codec: 'opus', profile: null,
		decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p',
	}),
	wavpack: Object.freeze({
		container: 'wavpack', codec: 'wavpack', profile: null,
		decodeSampleFormat: 'f32', encodeSampleFormat: 'f32',
	}),
	mp2: Object.freeze({
		container: 'mp2', codec: 'mp2', profile: null,
		decodeSampleFormat: 'f32', encodeSampleFormat: 'f32p',
	}),
	'aac-m4a': Object.freeze({
		container: 'm4a', codec: 'aac', profile: 'lc',
		decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p',
	}),
});

const PROVIDER_ORDER = Object.freeze([
	'bundled', 'operating-system', 'external-ffmpeg',
] as const satisfies readonly DesktopCodecProviderKind[]);
const FAILURE_REASONS = new Set<DesktopAudioCodecProviderFailureReason>([
	'unavailable', 'cancelled', 'execution-failed', 'security-failed', 'process-failed', 'result-failed',
]);

export function deriveDesktopAudioCodecOperation(requestValue: unknown): DesktopCodecOperation {
	return operationFromRequest(normalizeDesktopAudioCodecRequest(requestValue));
}

export function createDesktopAudioCodecBroker(options: Readonly<{
	readonly runtimes: DesktopAudioCodecProviderRuntimeTuple;
}>): DesktopAudioCodecBroker {
	const runtimes = validateRuntimes(options?.runtimes);

	return Object.freeze({
		async execute(
			requestValue: unknown,
			executionOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
		): Promise<Readonly<{
			readonly result: DesktopAudioCodecResult;
			readonly receipt: DesktopCodecOperationReceipt;
		}>> {
			validateExecutionOptions(executionOptions);
			const request = normalizeDesktopAudioCodecRequest(requestValue);
			const operation = operationFromRequest(request);
			const inputDigest = sha256(request.input);
			const bindings = await bindRuntimesToRequest(
				runtimes, request, operation, executionOptions.signal,
			);
			const coordinator = createDesktopCodecCoordinator({
				providers: bindings.map(({ provider }) => provider),
			});
			const runtimesByProvider = new Map(bindings.map(({ provider, runtime }) => (
				[provider, runtime] as const
			)));
			const coordinated = await coordinator.execute(operation, {
				inputDigests: Object.freeze([inputDigest]),
				settings: request.settings,
				...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
				run: async (selection): Promise<DesktopCodecExecutionResult<DesktopAudioCodecResult>> => {
					const runtime = runtimesByProvider.get(selection.provider);
					if (runtime === undefined) {
						throw providerError(selection.provider, 'security-failed',
							'The selected provider runtime did not match its admitted provider.');
					}
					return runSelectedRuntime(runtime, request, selection.operation, selection.signal);
				},
			});
			return Object.freeze({ result: coordinated.value, receipt: coordinated.receipt });
		},
	});
}

async function bindRuntimesToRequest(
	runtimes: DesktopAudioCodecProviderRuntimeTuple,
	request: DesktopAudioCodecRequest,
	operation: DesktopCodecOperation,
	signal: AbortSignal | undefined,
): Promise<readonly Readonly<{
	readonly provider: DesktopCodecProvider;
	readonly runtime: DesktopAudioCodecProviderRuntime;
}>[]> {
	const bindings = [];
	for (const runtime of runtimes) {
		bindings.push(await bindRuntimeToRequest(runtime, request, operation, signal));
	}
	return Object.freeze(bindings);
}

async function bindRuntimeToRequest(
	runtime: DesktopAudioCodecProviderRuntime,
	request: DesktopAudioCodecRequest,
	operation: DesktopCodecOperation,
	signal: AbortSignal | undefined,
): Promise<Readonly<{
	readonly provider: DesktopCodecProvider;
	readonly runtime: DesktopAudioCodecProviderRuntime;
}>> {
	const selected = await selectedRuntime(runtime, request, operation, signal);
	const preflightRequest = selected.preflightRequest;
	if (preflightRequest === undefined) return Object.freeze({ provider: selected.provider, runtime: selected });
	const source = selected.provider;
	const provider: DesktopCodecProvider = Object.freeze({
		kind: source.kind, id: source.id, implementation: source.implementation,
		version: source.version, capabilityGeneration: source.capabilityGeneration,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		) {
			const tuple = await source.preflight(operation, options);
			if (tuple.disposition !== 'supported') return tuple;
			return await preflightRequest.call(selected, request, Object.freeze({
				operation, ...(options.signal ? { signal: options.signal } : {}),
			}));
		},
	});
	return Object.freeze({ provider, runtime: selected });
}

async function selectedRuntime(
	runtime: DesktopAudioCodecProviderRuntime,
	request: DesktopAudioCodecRequest,
	operation: DesktopCodecOperation,
	signal: AbortSignal | undefined,
): Promise<DesktopAudioCodecProviderRuntime> {
	const selector = runtime.selectRequestRuntime;
	if (selector === undefined) return runtime;
	const selected = await selector.call(runtime, request, Object.freeze({
		operation, ...(signal ? { signal } : {}),
	}));
	if (selected === null) return runtime;
	if (!selected || typeof selected !== 'object' || Array.isArray(selected)
		|| !selected.provider || selected.provider.kind !== runtime.provider.kind
		|| typeof selected.provider.preflight !== 'function'
		|| typeof selected.execute !== 'function'
		|| selected.preflightRequest !== undefined && typeof selected.preflightRequest !== 'function') {
		throw new TypeError('The request-scoped desktop audio codec runtime selection is invalid.');
	}
	return selected;
}

async function runSelectedRuntime(
	runtime: DesktopAudioCodecProviderRuntime,
	request: DesktopAudioCodecRequest,
	operation: DesktopCodecOperation,
	signal: AbortSignal | undefined,
): Promise<DesktopCodecExecutionResult<DesktopAudioCodecResult>> {
	let rawResult: unknown;
	try {
		rawResult = await runtime.execute(request, Object.freeze({
			operation, ...(signal ? { signal } : {}),
		}));
	} catch (error) {
		const cancelled = signal?.aborted || isAbortError(error);
		throw providerError(
			runtime.provider,
			cancelled ? 'cancelled' : 'execution-failed',
			cancelled ? 'The selected provider operation was cancelled.'
				: 'The selected provider could not execute the operation.',
		);
	}
	if (signal?.aborted) throw providerError(
		runtime.provider, 'cancelled', 'The selected provider operation was cancelled.',
	);
	const inspected = inspectProviderResult(rawResult, request);
	if (inspected.status === 'failed') {
		throw providerError(runtime.provider, inspected.reason, inspected.detail);
	}
	let result: DesktopAudioCodecResult;
	try {
		result = normalizeDesktopAudioCodecResult(
			createDesktopAudioCodecResult(request, inspected.output, inspected.decodedGeometry),
			request.maximumOutputBytes,
		);
	} catch {
		throw providerError(
			runtime.provider, 'result-failed',
			'The selected provider returned invalid desktop audio bytes.',
		);
	}
	const resolvedOperation = result.operation === 'audio-decode'
		? Object.freeze({
			...operation,
			sampleRate: result.metadata.sampleRate,
			channelCount: result.metadata.channelCount,
		})
		: undefined;
	return Object.freeze({
		value: result,
		outputDigest: sha256(result.bytes),
		timing: null,
		...(resolvedOperation === undefined ? {} : { resolvedOperation }),
	});
}

function operationFromRequest(request: DesktopAudioCodecRequest): DesktopCodecOperation {
	const descriptor = AUDIO_OPERATIONS[request.format];
	const direction = request.operation === 'audio-decode' ? 'decode' : 'encode';
	return Object.freeze({
		direction,
		mediaKind: 'audio',
		container: descriptor.container,
		codec: descriptor.codec,
		profile: descriptor.profile,
		sampleFormat: direction === 'decode'
			? descriptor.decodeSampleFormat
			: request.format === 'flac' && request.operation === 'audio-encode'
				? `s${String(request.settings.bitDepth)}`
				: descriptor.encodeSampleFormat,
		pixelFormat: null,
		sampleRate: request.sampleRate,
		channelCount: request.channelCount,
		width: null,
		height: null,
	});
}

function validateRuntimes(value: unknown): DesktopAudioCodecProviderRuntimeTuple {
	if (!Array.isArray(value) || value.length !== PROVIDER_ORDER.length) throw runtimeOrderError();
	for (let index = 0; index < PROVIDER_ORDER.length; index += 1) {
		const runtime = value[index] as DesktopAudioCodecProviderRuntime | undefined;
		if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
			|| !runtime.provider || runtime.provider.kind !== PROVIDER_ORDER[index]
			|| typeof runtime.execute !== 'function'
			|| runtime.preflightRequest !== undefined
				&& typeof runtime.preflightRequest !== 'function'
			|| runtime.selectRequestRuntime !== undefined
				&& (runtime.provider.kind !== 'bundled' || typeof runtime.selectRequestRuntime !== 'function')) {
			throw runtimeOrderError();
		}
	}
	return Object.freeze([...value]) as unknown as DesktopAudioCodecProviderRuntimeTuple;
}

function runtimeOrderError(): TypeError {
	return new TypeError(
		'Three desktop audio codec provider runtimes ordered bundled, operating-system, external-ffmpeg are required.',
	);
}

function validateExecutionOptions(value: unknown): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !plainRecord(value)
		|| Reflect.ownKeys(value).some((key) => key !== 'signal')
		|| ('signal' in value && value.signal !== undefined && !(value.signal instanceof AbortSignal))) {
		throw new TypeError('Desktop audio codec broker execution options are invalid.');
	}
}

function inspectProviderResult(
	value: unknown,
	request: DesktopAudioCodecRequest,
): DesktopAudioCodecProviderExecutionResult {
	if (!plainRecord(value)) return failedResult();
	const keys = Reflect.ownKeys(value);
	if (value.status === 'executed') {
		const decode = request.operation === 'audio-decode';
		const expectedKeys = decode ? 3 : 2;
		if (keys.length !== expectedKeys || !keys.includes('status') || !keys.includes('output')
			|| decode !== keys.includes('decodedGeometry')
			|| !(value.output instanceof Uint8Array)) return failedResult();
		if (!decode) return Object.freeze({ status: 'executed', output: new Uint8Array(value.output) });
		const geometry = cloneDecodedGeometry(value.decodedGeometry);
		if (geometry === null) return failedResult();
		return Object.freeze({
			status: 'executed', output: new Uint8Array(value.output), decodedGeometry: geometry,
		});
	}
	if (value.status === 'failed') {
		if (keys.length !== 3 || !keys.includes('status') || !keys.includes('reason') || !keys.includes('detail')
			|| typeof value.reason !== 'string'
			|| !FAILURE_REASONS.has(value.reason as DesktopAudioCodecProviderFailureReason)
			|| typeof value.detail !== 'string' || value.detail.trim() === '' || value.detail.length > 512) {
			return failedResult();
		}
		return Object.freeze({
			status: 'failed', reason: value.reason as DesktopAudioCodecProviderFailureReason,
			detail: value.detail,
		});
	}
	return failedResult();
}

function cloneDecodedGeometry(value: unknown): DesktopDecodedAudioGeometry | null {
	if (!plainRecord(value)) return null;
	const fields = ['sampleRate', 'channelCount', 'frameCount'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		return null;
	}
	return Object.freeze({
		sampleRate: value.sampleRate as number,
		channelCount: value.channelCount as number,
		frameCount: value.frameCount as number,
	});
}

function failedResult(): Extract<DesktopAudioCodecProviderExecutionResult, { status: 'failed' }> {
	return Object.freeze({
		status: 'failed', reason: 'result-failed',
		detail: 'The selected provider returned an invalid execution result.',
	});
}

function providerError(
	provider: DesktopCodecProvider,
	reason: DesktopAudioCodecProviderFailureReason,
	detail: string,
): DesktopAudioCodecProviderError {
	return new DesktopAudioCodecProviderError({ provider, reason, detail });
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function isAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function plainRecord(value: unknown): value is Record<PropertyKey, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
	});
}
