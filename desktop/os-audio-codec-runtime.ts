/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canary-verified operating-system audio codec runtime for desktop main. */

import {
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
	desktopAudioMp3ConstantBitrateKbps,
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import {
	deriveDesktopAudioCodecOperation,
	type DesktopAudioCodecProviderExecutionResult,
	type DesktopAudioCodecProviderFailureReason,
	type DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.ts';
import {
	deriveDesktopAudioOperatingSystemCandidatesFromOperation,
} from './desktop-audio-os-codec-candidates.ts';
import {
	createOperatingSystemAudioCodecCanaryAdapter,
} from './os-audio-codec-canary-adapter.ts';
import {
	createOperatingSystemAudioCodecOperationRunner,
	type OperatingSystemAudioCodecAddonDescriptor,
	type OperatingSystemAudioCodecChild,
	type OperatingSystemAudioCodecChildConfiguration,
	type OperatingSystemAudioCodecOperationResult,
	type OperatingSystemAudioCodecTarget,
	type OperatingSystemAudioCodecUnavailableReason,
} from './os-audio-codec-operation-runner.ts';
import {
	inspectOperatingSystemAudioSource,
	type OperatingSystemAudioSourceFormat,
} from './os-audio-codec-source-inspection.ts';
import {
	verifyOperatingSystemCodecCapabilities,
	type OperatingSystemCodecCanaryRequest,
} from './os-codec-capability-adapter.ts';
import {
	createOperatingSystemCodecNativeCanaryRunner,
} from './os-codec-native-canary-runner.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import {
	createOperatingSystemDesktopCodecProvider,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';

export type OperatingSystemAudioCodecRuntimeTarget = DesktopCodecTarget | 'mac-x64';

export interface OperatingSystemAudioCodecRuntimeLoadOptions {
	readonly target: OperatingSystemAudioCodecRuntimeTarget;
	readonly osVersion: string;
	readonly scratchRoot: string;
	readonly verifyAddon: () => Promise<OperatingSystemAudioCodecAddonDescriptor>;
	readonly spawn: (
		configuration: OperatingSystemAudioCodecChildConfiguration,
	) => OperatingSystemAudioCodecChild;
	readonly maximumCanaryDurationMs?: number;
	readonly maximumOperationDurationMs?: number;
	readonly killWaitMs?: number;
	readonly signal?: AbortSignal;
}

const MP3_CANARY_OPERATION: DesktopCodecOperation = Object.freeze({
	direction: 'decode',
	mediaKind: 'audio',
	container: 'mp3',
	codec: 'mp3',
	profile: null,
	sampleFormat: 'f32',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});
const AAC_M4A_CANARY_OPERATION: DesktopCodecOperation = Object.freeze({
	direction: 'decode',
	mediaKind: 'audio',
	container: 'm4a',
	codec: 'aac',
	profile: 'lc',
	sampleFormat: 'f32p',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});
const AAC_M4A_ENCODE_CANARY_OPERATION: DesktopCodecOperation = Object.freeze({
	direction: 'encode',
	mediaKind: 'audio',
	container: 'm4a',
	codec: 'aac',
	profile: 'lc',
	sampleFormat: 'f32p',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});
const MP3_ENCODE_CANARY_OPERATION: DesktopCodecOperation = Object.freeze({
	direction: 'encode',
	mediaKind: 'audio',
	container: 'mp3',
	codec: 'mp3',
	profile: null,
	sampleFormat: 'f32p',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});
const CANARY_OPERATIONS = Object.freeze([
	MP3_CANARY_OPERATION, AAC_M4A_CANARY_OPERATION, AAC_M4A_ENCODE_CANARY_OPERATION,
	MP3_ENCODE_CANARY_OPERATION,
]);
const OPERATION_FIELDS = Object.freeze([
	'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat',
	'pixelFormat', 'sampleRate', 'channelCount', 'width', 'height',
] as const);
const NATIVE_TARGETS = new Set<string>(['win-x64', 'win-arm64', 'mac-arm64']);
const NON_NATIVE_TARGETS = new Set<string>(['linux-x64', 'linux-arm64', 'mac-x64']);
const SOURCE_TUPLE_REASON: Readonly<Record<OperatingSystemAudioSourceFormat, string>> = Object.freeze({
	mp3: 'The OS MP3 source geometry is outside the exact canary-verified tuple.',
	'aac-m4a': 'The OS AAC-LC M4A source is outside the exact canary-verified tuple.',
});
const AAC_ENCODE_TUPLE_REASON =
	'The OS AAC-LC M4A encoder admits only 48 kHz stereo float PCM at 160 kbps.';
const MP3_ENCODE_TUPLE_REASON =
	'The Windows OS MP3 encoder admits only 48 kHz stereo float PCM at 192 kbps.';

type RequestAdmission = Readonly<{
	readonly disposition: 'supported';
	readonly request: DesktopAudioCodecRequest;
}> | Readonly<{
	readonly disposition: 'rejected';
}> | Readonly<{
	readonly disposition: 'unsupported';
	readonly reason: string;
}>;

const FAILURE_REASON: Readonly<Record<
	OperatingSystemAudioCodecUnavailableReason,
	DesktopAudioCodecProviderFailureReason
>> = Object.freeze({
	'api-unavailable': 'unavailable',
	'tuple-unsupported': 'unavailable',
	cancelled: 'cancelled',
	'helper-protocol': 'security-failed',
	'payload-unavailable': 'security-failed',
	'request-rejected': 'security-failed',
	'output-invalid': 'result-failed',
	'helper-crashed': 'process-failed',
	'helper-failed': 'process-failed',
	'helper-timeout': 'process-failed',
	'spawn-failed': 'process-failed',
	busy: 'execution-failed',
	'cleanup-failed': 'execution-failed',
	'scratch-failed': 'execution-failed',
});

export async function loadOperatingSystemAudioCodecRuntime(
	options: OperatingSystemAudioCodecRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const requestedTarget = runtimeTarget(options?.target);
	if (NON_NATIVE_TARGETS.has(requestedTarget)) return null;
	const target = requestedTarget as OperatingSystemAudioCodecTarget;
	const runner = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot: options.scratchRoot,
		verifyAddon: async () => {
			const descriptor = await options.verifyAddon();
			if (descriptor?.target !== target) {
				throw new TypeError('The OS audio codec payload target does not match this runtime.');
			}
			return descriptor;
		},
		spawn: options.spawn,
		...(options.maximumOperationDurationMs === undefined
			? {} : { maximumDurationMs: options.maximumOperationDurationMs }),
		...(options.killWaitMs === undefined ? {} : { killWaitMs: options.killWaitMs }),
	});
	const adapter = createOperatingSystemAudioCodecCanaryAdapter({ target, runner });
	const canaryRunner = createOperatingSystemCodecNativeCanaryRunner(Object.freeze({
		runCanary: (request: OperatingSystemCodecCanaryRequest, signal: AbortSignal) => (
			adapter.runCanary(request, signal)
		),
	}));
	const candidates = Object.freeze(CANARY_OPERATIONS.flatMap((operation) => (
		deriveDesktopAudioOperatingSystemCandidatesFromOperation(target, operation).candidates
	)));
	const verification = await verifyOperatingSystemCodecCapabilities({
		target,
		osVersion: options.osVersion,
		candidates,
		runner: canaryRunner,
		...(options.maximumCanaryDurationMs === undefined
			? {} : { maximumDurationMs: options.maximumCanaryDurationMs }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	if (verification.status !== 'available') return null;
	const provider = createOperatingSystemDesktopCodecProvider(verification.providerOptions);

	return Object.freeze({
		provider,
		async preflightRequest(
			requestValue: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(executionOptions?.signal);
			const admission = requestAdmission(requestValue, executionOptions?.operation, target);
			return admission.disposition === 'rejected'
				? rejectedRequest()
				: admission.disposition === 'unsupported'
					? unsupportedTuple(admission.reason)
					: Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			throwIfAborted(executionOptions?.signal);
			const admission = requestAdmission(requestValue, executionOptions?.operation, target);
			if (admission.disposition !== 'supported') {
				return admission.disposition === 'rejected'
					? failed('security-failed', 'The OS audio request does not match its admitted operation.')
					: failed('unavailable', admission.reason);
			}
			const result = await runner.execute(admission.request, Object.freeze({
				...(executionOptions?.signal ? { signal: executionOptions.signal } : {}),
			}));
			return mapOperatingSystemAudioCodecOperationResult(result, admission.request.operation);
		},
	});
}

export function mapOperatingSystemAudioCodecOperationResult(
	value: OperatingSystemAudioCodecOperationResult,
	operation: 'audio-decode' | 'audio-encode' = 'audio-decode',
): DesktopAudioCodecProviderExecutionResult {
	if (!plainRecord(value)) return invalidRunnerResult();
	if (value.status === 'executed') {
		const fields = Reflect.ownKeys(value);
		const decoding = operation === 'audio-decode';
		if (fields.length !== (decoding ? 3 : 2)
			|| !fields.includes('status') || !fields.includes('output')
			|| decoding !== fields.includes('decodedGeometry')
			|| !(value.output instanceof Uint8Array)) {
			return invalidRunnerResult();
		}
		if (!decoding) {
			try { return Object.freeze({ status: 'executed', output: new Uint8Array(value.output) }); }
			catch { return invalidRunnerResult(); }
		}
		if (!('decodedGeometry' in value)) return invalidRunnerResult();
		const geometry = decodedGeometry(value.decodedGeometry);
		if (geometry === null) return invalidRunnerResult();
		const expectedBytes = geometry.frameCount * geometry.channelCount
			* Float32Array.BYTES_PER_ELEMENT;
		if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== value.output.byteLength) {
			return invalidRunnerResult();
		}
		try {
			return Object.freeze({
				status: 'executed',
				output: new Uint8Array(value.output),
				decodedGeometry: geometry,
			});
		} catch { return invalidRunnerResult(); }
	}
	if (value.status !== 'unavailable' || Reflect.ownKeys(value).length !== 3
		|| typeof value.reason !== 'string' || typeof value.detail !== 'string'
		|| value.detail.trim() === '' || value.detail.length > 512) return invalidRunnerResult();
	const reason = FAILURE_REASON[value.reason as OperatingSystemAudioCodecUnavailableReason];
	return reason === undefined
		? invalidRunnerResult()
		: failed(reason, value.detail);
}

function requestAdmission(
	requestValue: DesktopAudioCodecRequest,
	operationValue: DesktopCodecOperation | undefined,
	target: OperatingSystemAudioCodecTarget,
): RequestAdmission {
	let request: DesktopAudioCodecRequest;
	try { request = normalizeDesktopAudioCodecRequest(requestValue); }
	catch { return Object.freeze({ disposition: 'rejected' }); }
	if (!sameOperation(operationValue, deriveDesktopAudioCodecOperation(request))) {
		return Object.freeze({ disposition: 'rejected' });
	}
	if (request.operation === 'audio-encode') {
		if (request.format !== 'aac-m4a' && request.format !== 'mp3') {
			return Object.freeze({ disposition: 'rejected' });
		}
		if (request.format === 'mp3' && !target.startsWith('win-')) {
			return Object.freeze({ disposition: 'unsupported', reason: MP3_ENCODE_TUPLE_REASON });
		}
		const bitrateKbps = request.format === 'mp3' ? 192 : 160;
		const stated = request.format === 'mp3'
			? desktopAudioMp3ConstantBitrateKbps(request.settings)
			: (request.settings as Readonly<{ readonly bitrateKbps: number }>).bitrateKbps;
		return request.sampleRate === 48_000 && request.channelCount === 2
			&& stated === bitrateKbps
			? Object.freeze({ disposition: 'supported', request })
			: Object.freeze({ disposition: 'unsupported', reason: request.format === 'mp3'
				? MP3_ENCODE_TUPLE_REASON : AAC_ENCODE_TUPLE_REASON });
	}
	if (request.format !== 'mp3' && request.format !== 'aac-m4a') {
		return Object.freeze({ disposition: 'rejected' });
	}
	const geometry = inspectOperatingSystemAudioSource(request.format, request.input);
	const reviewedOperation = request.format === 'mp3' ? MP3_CANARY_OPERATION : AAC_M4A_CANARY_OPERATION;
	return geometry?.sampleRate === reviewedOperation.sampleRate
		&& geometry.channelCount === reviewedOperation.channelCount
		? Object.freeze({ disposition: 'supported', request })
		: Object.freeze({ disposition: 'unsupported', reason: SOURCE_TUPLE_REASON[request.format] });
}

function sameOperation(
	value: DesktopCodecOperation | undefined,
	expected: DesktopCodecOperation,
): boolean {
	if (!plainRecord(value)) return false;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const fields = Reflect.ownKeys(descriptors);
	if (fields.length !== OPERATION_FIELDS.length
		|| fields.some((field) => typeof field !== 'string' || !OPERATION_FIELDS.includes(
			field as typeof OPERATION_FIELDS[number],
		))
		|| fields.some((field) => !Object.hasOwn(descriptors[field as string]!, 'value'))) return false;
	return OPERATION_FIELDS.every((field) => value[field] === expected[field]);
}

function decodedGeometry(value: unknown): Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}> | null {
	if (!plainRecord(value)) return null;
	const fields = Reflect.ownKeys(value);
	if (fields.length !== 3 || !fields.includes('sampleRate')
		|| !fields.includes('channelCount') || !fields.includes('frameCount')) return null;
	if (!boundedInteger(
		value.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	) || !boundedInteger(value.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT)
		|| !boundedInteger(value.frameCount, 1, Number.MAX_SAFE_INTEGER)) return null;
	return Object.freeze({
		sampleRate: value.sampleRate,
		channelCount: value.channelCount,
		frameCount: value.frameCount,
	});
}

function runtimeTarget(value: unknown): OperatingSystemAudioCodecRuntimeTarget {
	if (typeof value !== 'string' || !NATIVE_TARGETS.has(value) && !NON_NATIVE_TARGETS.has(value)) {
		throw new TypeError('The OS audio codec runtime target is unsupported.');
	}
	return value as OperatingSystemAudioCodecRuntimeTarget;
}

function rejectedRequest(): DesktopCodecPreflightResult {
	return Object.freeze({
		disposition: 'rejected',
		reason: 'The OS audio request does not match its admitted operation.',
	});
}

function unsupportedTuple(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'unsupported', reason });
}

function invalidRunnerResult(): Extract<
	DesktopAudioCodecProviderExecutionResult,
	{ readonly status: 'failed' }
> {
	return failed('security-failed', 'The OS audio runner returned an invalid closed result.');
}

function failed(
	reason: DesktopAudioCodecProviderFailureReason,
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal === undefined) return;
	if (!(signal instanceof AbortSignal)) throw new TypeError('The OS audio AbortSignal is invalid.');
	signal.throwIfAborted();
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
