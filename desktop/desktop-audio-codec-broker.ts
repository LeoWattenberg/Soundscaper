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
} from './desktop-audio-codec-operation-contract.ts';
import {
	createDesktopCodecCoordinator,
	type DesktopCodecExecutionResult,
	type DesktopCodecOperation,
	type DesktopCodecOperationReceipt,
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
	| Readonly<{ readonly status: 'executed'; readonly output: Uint8Array }>
	| Readonly<{
		readonly status: 'failed';
		readonly reason: DesktopAudioCodecProviderFailureReason;
		readonly detail: string;
	}>;

export interface DesktopAudioCodecProviderRuntime {
	readonly provider: DesktopCodecProvider;
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
		decodeSampleFormat: 's24', encodeSampleFormat: 's24',
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
	const coordinator = createDesktopCodecCoordinator({ providers: runtimes.map(({ provider }) => provider) });
	const runtimesByProvider = new Map(runtimes.map((runtime) => [runtime.provider.id, runtime] as const));

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
			const coordinated = await coordinator.execute(operation, {
				inputDigests: Object.freeze([inputDigest]),
				...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
				run: async (selection): Promise<DesktopCodecExecutionResult<DesktopAudioCodecResult>> => {
					const runtime = runtimesByProvider.get(selection.provider.id);
					if (runtime === undefined || runtime.provider !== selection.provider) {
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
	const inspected = inspectProviderResult(rawResult);
	if (inspected.status === 'failed') {
		throw providerError(runtime.provider, inspected.reason, inspected.detail);
	}
	let result: DesktopAudioCodecResult;
	try {
		result = normalizeDesktopAudioCodecResult(
			createDesktopAudioCodecResult(request, inspected.output),
			request.maximumOutputBytes,
		);
	} catch {
		throw providerError(
			runtime.provider, 'result-failed',
			'The selected provider returned invalid desktop audio bytes.',
		);
	}
	return Object.freeze({
		value: result,
		outputDigest: sha256(result.bytes),
		timing: null,
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
			|| typeof runtime.execute !== 'function') throw runtimeOrderError();
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

function inspectProviderResult(value: unknown): DesktopAudioCodecProviderExecutionResult {
	if (!plainRecord(value)) return failedResult();
	const keys = Reflect.ownKeys(value);
	if (value.status === 'executed') {
		if (keys.length !== 2 || !keys.includes('status') || !keys.includes('output')
			|| !(value.output instanceof Uint8Array)) return failedResult();
		return Object.freeze({ status: 'executed', output: new Uint8Array(value.output) });
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
