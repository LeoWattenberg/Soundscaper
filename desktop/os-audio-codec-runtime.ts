/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canary-qualified operating-system MP3 decode runtime for desktop main. */

import {
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
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
	qualifyOperatingSystemCodecCapabilities,
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
const OPERATION_FIELDS = Object.freeze([
	'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat',
	'pixelFormat', 'sampleRate', 'channelCount', 'width', 'height',
] as const);
const NATIVE_TARGETS = new Set<string>(['win-x64', 'win-arm64', 'mac-arm64']);
const NON_NATIVE_TARGETS = new Set<string>(['linux-x64', 'linux-arm64', 'mac-x64']);
const MP3_MPEG1_LAYER3_BITRATES_KBPS = Object.freeze([
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
]);
const MP3_MPEG1_SAMPLE_RATES = Object.freeze([44_100, 48_000, 32_000]);
const SOURCE_TUPLE_REASON = 'The OS MP3 source geometry is outside the exact canary-qualified tuple.';

type RequestAdmission = Readonly<{
	readonly disposition: 'supported';
	readonly request: DesktopAudioCodecRequest;
}> | Readonly<{
	readonly disposition: 'rejected' | 'unsupported';
}>;

interface Mp3FrameHeader {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameBytes: number;
}

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
	const candidateSet = deriveDesktopAudioOperatingSystemCandidatesFromOperation(
		target, MP3_CANARY_OPERATION,
	);
	const admission = await qualifyOperatingSystemCodecCapabilities({
		target,
		osVersion: options.osVersion,
		candidates: candidateSet.candidates,
		runner: canaryRunner,
		...(options.maximumCanaryDurationMs === undefined
			? {} : { maximumDurationMs: options.maximumCanaryDurationMs }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	if (admission.status !== 'available') return null;
	const provider = createOperatingSystemDesktopCodecProvider(admission.providerOptions);

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
			const admission = requestAdmission(requestValue, executionOptions?.operation);
			return admission.disposition === 'rejected'
				? rejectedRequest()
				: admission.disposition === 'unsupported'
					? unsupportedSourceTuple()
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
			const admission = requestAdmission(requestValue, executionOptions?.operation);
			if (admission.disposition !== 'supported') {
				return admission.disposition === 'rejected'
					? failed('security-failed', 'The OS MP3 request does not match its admitted operation.')
					: failed('unavailable', SOURCE_TUPLE_REASON);
			}
			const result = await runner.execute(admission.request, Object.freeze({
				...(executionOptions?.signal ? { signal: executionOptions.signal } : {}),
			}));
			return mapOperatingSystemAudioCodecOperationResult(result);
		},
	});
}

export function mapOperatingSystemAudioCodecOperationResult(
	value: OperatingSystemAudioCodecOperationResult,
): DesktopAudioCodecProviderExecutionResult {
	if (!plainRecord(value)) return invalidRunnerResult();
	if (value.status === 'executed') {
		const fields = Reflect.ownKeys(value);
		if (fields.length !== 3 || !fields.includes('status') || !fields.includes('output')
			|| !fields.includes('decodedGeometry') || !(value.output instanceof Uint8Array)) {
			return invalidRunnerResult();
		}
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
): RequestAdmission {
	let request: DesktopAudioCodecRequest;
	try { request = normalizeDesktopAudioCodecRequest(requestValue); }
	catch { return Object.freeze({ disposition: 'rejected' }); }
	if (request.operation !== 'audio-decode' || request.format !== 'mp3'
		|| !sameOperation(operationValue, deriveDesktopAudioCodecOperation(request))) {
		return Object.freeze({ disposition: 'rejected' });
	}
	const geometry = inspectMp3SourceGeometry(request.input);
	return geometry?.sampleRate === MP3_CANARY_OPERATION.sampleRate
		&& geometry.channelCount === MP3_CANARY_OPERATION.channelCount
		? Object.freeze({ disposition: 'supported', request })
		: Object.freeze({ disposition: 'unsupported' });
}

function inspectMp3SourceGeometry(input: Uint8Array): Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
}> | null {
	let offset = 0;
	if (input.byteLength >= 3 && input[0] === 0x49 && input[1] === 0x44 && input[2] === 0x33) {
		if (input.byteLength < 10 || input[6]! >= 0x80 || input[7]! >= 0x80
			|| input[8]! >= 0x80 || input[9]! >= 0x80) return null;
		const tagBytes = input[6]! << 21 | input[7]! << 14 | input[8]! << 7 | input[9]!;
		const footerBytes = (input[5]! & 0x10) === 0 ? 0 : 10;
		offset = 10 + tagBytes + footerBytes;
		if (!Number.isSafeInteger(offset) || offset > input.byteLength) return null;
	}
	let geometry: Pick<Mp3FrameHeader, 'sampleRate' | 'channelCount'> | null = null;
	let frameCount = 0;
	while (offset + 4 <= input.byteLength) {
		const frame = mp3FrameHeader(input, offset);
		if (frame === null) break;
		if (geometry !== null && (frame.sampleRate !== geometry.sampleRate
			|| frame.channelCount !== geometry.channelCount)) return null;
		geometry ??= frame;
		frameCount += 1;
		offset += frame.frameBytes;
	}
	if (geometry === null || frameCount < 2) return null;
	const id3v1 = input.byteLength - offset === 128
		&& input[offset] === 0x54 && input[offset + 1] === 0x41 && input[offset + 2] === 0x47;
	if (offset !== input.byteLength && !id3v1) return null;
	return Object.freeze({ sampleRate: geometry.sampleRate, channelCount: geometry.channelCount });
}

function mp3FrameHeader(input: Uint8Array, offset: number): Mp3FrameHeader | null {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > input.byteLength) return null;
	const header = new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
	const version = header >>> 19 & 0x03;
	const layer = header >>> 17 & 0x03;
	const bitrateIndex = header >>> 12 & 0x0f;
	const sampleRateIndex = header >>> 10 & 0x03;
	if (header >>> 21 !== 0x7ff || version !== 3 || layer !== 1
		|| bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 3) return null;
	const bitrateKbps = MP3_MPEG1_LAYER3_BITRATES_KBPS[bitrateIndex];
	const sampleRate = MP3_MPEG1_SAMPLE_RATES[sampleRateIndex];
	if (bitrateKbps === undefined || bitrateKbps === 0 || sampleRate === undefined) return null;
	const padding = header >>> 9 & 0x01;
	const frameBytes = Math.floor(144_000 * bitrateKbps / sampleRate) + padding;
	if (frameBytes < 4 || offset + frameBytes > input.byteLength) return null;
	return Object.freeze({
		sampleRate,
		channelCount: (header >>> 6 & 0x03) === 3 ? 1 : 2,
		frameBytes,
	});
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
		reason: 'The OS MP3 request does not match its admitted operation.',
	});
}

function unsupportedSourceTuple(): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'unsupported', reason: SOURCE_TUPLE_REASON });
}

function invalidRunnerResult(): Extract<
	DesktopAudioCodecProviderExecutionResult,
	{ readonly status: 'failed' }
> {
	return failed('security-failed', 'The OS MP3 runner returned an invalid closed result.');
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
	if (!(signal instanceof AbortSignal)) throw new TypeError('The OS MP3 AbortSignal is invalid.');
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
