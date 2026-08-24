/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for exact reviewed libopus 1.6.1 plus libogg 1.3.6 WebAssembly. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import {
	BundledOpusStreamError,
	BundledOpusStreamUnsupportedError,
	parseBundledOpusStream,
} from './bundled-opus-stream.ts';
import {
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';

export const BUNDLED_OPUS_VERSION = 'libopus-1.6.1+libogg-1.3.6';
export const BUNDLED_OPUS_WASM_BYTE_LENGTH = 385_789;
export const BUNDLED_OPUS_WASM_SHA256 = 'c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853';
export const BUNDLED_OPUS_SAMPLE_RATE = 48_000;
export const BUNDLED_OPUS_MAXIMUM_CHANNELS = 2;
export const BUNDLED_OPUS_WASM_URL = new URL(
	'../src/common/editor/opus/opus.wasm', import.meta.url,
);

const MAXIMUM_FRAME_COUNT = 33_554_432;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const OPUS_CONTRACT_SAMPLE_RATES = new Set([8_000, 12_000, 16_000, 24_000, 48_000]);

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
});

interface OpusExports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly scop_abi_version: () => number;
	readonly scop_sample_rate: () => number;
	readonly scop_maximum_channels: () => number;
	readonly scop_maximum_frames: () => number;
	readonly scop_initial_memory_bytes: () => number;
	readonly scop_maximum_memory_bytes: () => number;
	readonly scop_allocate: (bytes: number) => number;
	readonly scop_free: (pointer: number) => void;
	readonly scop_encode_float32: (
		input: number, frames: number, channels: number, bitrate: number,
		output: number, outputCapacity: number,
	) => number;
	readonly scop_decode_float32: (
		input: number, inputBytes: number, frames: number, channels: number,
		output: number, outputBytes: number,
	) => number;
}

interface OpusEncodeOptions {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly bitrate: number;
	readonly maximumOutputBytes: number;
}

interface OpusDecodeOptions {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly outputBytes: number;
}

interface OpusCodec {
	encode(input: Uint8Array, options: Readonly<OpusEncodeOptions>): Uint8Array;
	decode(input: Uint8Array, options: Readonly<OpusDecodeOptions>): Uint8Array;
}

export interface BundledOpusRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledOpusAudioCodecRuntime(
	options: BundledOpusRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled Opus payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled Opus scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_OPUS_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_OPUS_WASM_SHA256) return null;
		const exports = await loadReviewedWasm(source);
		const codec = wasmCodec(exports);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_OPUS_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: OpusCodec,
	yieldControl: () => Promise<void>,
): DesktopAudioCodecProviderRuntime {
	const provider = bundledProvider(target);
	return Object.freeze({
		provider,
		async preflightRequest(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return Object.freeze({ disposition: 'rejected', reason: 'The Opus request is invalid.' }); }
			const direction = request.operation === 'audio-encode' ? 'encode' : 'decode';
			if (request.format !== 'opus' || direction !== options?.operation?.direction
				|| !matchingOperation(options.operation)) {
				return Object.freeze({
					disposition: 'rejected', reason: 'The Opus request does not match its admitted operation.',
				});
			}
			if (request.operation === 'audio-encode') return encodeProfileSupported(request)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled Opus provider requires 48 kHz mono or stereo PCM.',
				});
			try { parseBundledOpusStream(request.input); }
			catch (error) {
				if (error instanceof BundledOpusStreamUnsupportedError) return Object.freeze({
					disposition: 'unsupported',
					reason: 'The Ogg Opus input uses a valid profile outside the reviewed bundled subset.',
				});
				return Object.freeze({
					disposition: 'rejected',
					reason: 'The Ogg Opus input failed bounded structural or checksum validation.',
				});
			}
			return Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The Opus request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const tuple = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (tuple.disposition !== 'supported' || request.format !== 'opus') {
				return failed('unavailable', 'The bundled Opus provider does not support this exact operation.');
			}
			if (request.operation === 'audio-encode' && !encodeProfileSupported(request)) {
				return failed('unavailable', 'The bundled Opus provider requires 48 kHz mono or stereo PCM.');
			}
			try {
				await yieldControl();
				throwIfAborted(options.signal);
				const executed = request.operation === 'audio-encode'
					? Object.freeze({ status: 'executed' as const, output: encode(request, codec) })
					: Object.freeze({ status: 'executed' as const, ...decode(request, codec) });
				throwIfAborted(options.signal);
				return executed;
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof BundledOpusStreamUnsupportedError) {
					return failed('unavailable', 'The Ogg Opus input is outside the reviewed bundled profile.');
				}
				if (error instanceof BundledOpusStreamError || error instanceof OpusPcmInputError) {
					return failed('security-failed', 'The Ogg Opus stream or PCM failed bounded validation.');
				}
				if (error instanceof OpusOutputBoundError) return failed('result-failed', error.message);
				return failed('execution-failed', 'The reviewed Ogg Opus payload could not complete the operation.');
			}
		},
	});
}

function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
	codec: OpusCodec,
): Uint8Array {
	const frameCount = request.input.byteLength / (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
	const settings = request.settings as Readonly<{ readonly bitrateKbps: number }>;
	validateFiniteFloat32(request.input);
	try {
		return codec.encode(request.input, {
			frameCount, channelCount: request.channelCount,
			bitrate: settings.bitrateKbps * 1_000,
			maximumOutputBytes: request.maximumOutputBytes,
		});
	} catch (error) {
		if (error instanceof OpusCodecResultError) {
			throw new OpusOutputBoundError('The encoded Opus stream exceeds the requested output bound.');
		}
		throw error;
	}
}

function decode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-decode' }>,
	codec: OpusCodec,
): Readonly<{
	readonly output: Uint8Array;
	readonly decodedGeometry: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> {
	const geometry = parseBundledOpusStream(request.input);
	const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maximumOutputBytes) {
		throw new OpusOutputBoundError('The decoded Opus PCM exceeds the requested output bound.');
	}
	const output = codec.decode(request.input, {
		frameCount: geometry.frameCount, channelCount: geometry.channelCount, outputBytes,
	});
	validateFiniteFloat32(output);
	return Object.freeze({
		output,
		decodedGeometry: Object.freeze({
			sampleRate: BUNDLED_OPUS_SAMPLE_RATE, channelCount: geometry.channelCount,
			frameCount: geometry.frameCount,
		}),
	});
}

async function loadReviewedWasm(source: Uint8Array): Promise<OpusExports> {
	const ownedSource = Uint8Array.from(source);
	const module = await WebAssembly.compile(ownedSource);
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new OpusRuntimeError(`The reviewed Opus payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.scop_abi_version() !== 1 || exports.scop_sample_rate() !== BUNDLED_OPUS_SAMPLE_RATE
		|| exports.scop_maximum_channels() !== BUNDLED_OPUS_MAXIMUM_CHANNELS
		|| exports.scop_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.scop_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.scop_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new OpusRuntimeError('The reviewed Opus payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): OpusExports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new OpusRuntimeError('Opus memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'scop_abi_version', 'scop_sample_rate', 'scop_maximum_channels',
		'scop_maximum_frames', 'scop_initial_memory_bytes', 'scop_maximum_memory_bytes',
		'scop_allocate', 'scop_free', 'scop_encode_float32', 'scop_decode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new OpusRuntimeError(`Opus export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as OpusExports;
}

function wasmCodec(exports: OpusExports): OpusCodec {
	const codec: OpusCodec = {
		encode(input, options) {
			return invokeCodec(exports, input, options.maximumOutputBytes, null, (inputPointer, outputPointer) => (
				exports.scop_encode_float32(
					inputPointer, options.frameCount, options.channelCount, options.bitrate,
					outputPointer, options.maximumOutputBytes,
				)
			));
		},
		decode(input, options) {
			return invokeCodec(exports, input, options.outputBytes, options.frameCount,
				(inputPointer, outputPointer) => exports.scop_decode_float32(
					inputPointer, input.byteLength, options.frameCount, options.channelCount,
					outputPointer, options.outputBytes,
				));
		},
	};
	return Object.freeze(codec);
}

function invokeCodec(
	exports: OpusExports,
	input: Uint8Array,
	outputCapacity: number,
	expectedResult: number | null,
	invoke: (inputPointer: number, outputPointer: number) => number,
): Uint8Array {
	if (!(input instanceof Uint8Array) || input.byteLength < 1
		|| !Number.isSafeInteger(outputCapacity) || outputCapacity < 1
		|| outputCapacity > MAXIMUM_OUTPUT_BYTES) throw new OpusRuntimeError('Opus ABI bounds are invalid.');
	const inputPointer = allocate(exports, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(exports, outputCapacity);
		new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
		const result = invoke(inputPointer, outputPointer);
		if (!Number.isSafeInteger(result) || (expectedResult === null
			? result <= 0 || result > outputCapacity : result !== expectedResult)) {
			throw new OpusCodecResultError();
		}
		const resultBytes = expectedResult === null ? result : outputCapacity;
		return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, resultBytes));
	} finally {
		if (outputPointer !== 0) exports.scop_free(outputPointer);
		exports.scop_free(inputPointer);
	}
}

function allocate(exports: OpusExports, byteLength: number): number {
	const pointer = exports.scop_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.scop_free(pointer);
		throw new OpusRuntimeError('The reviewed Opus payload exceeded its memory bound.');
	}
	return pointer;
}

function verifyCanary(codec: OpusCodec): void {
	const frames = 4_800;
	const channels = 2;
	const source = new Float32Array(frames * channels);
	for (let frame = 0; frame < frames; frame++) {
		source[frame * channels] = Math.sin(2 * Math.PI * 440 * frame / BUNDLED_OPUS_SAMPLE_RATE) * 0.35;
		source[frame * channels + 1] = Math.sin(2 * Math.PI * 660 * frame / BUNDLED_OPUS_SAMPLE_RATE) * 0.25;
	}
	const input = new Uint8Array(source.buffer);
	const encoded = codec.encode(input, {
		frameCount: frames, channelCount: channels, bitrate: 128_000, maximumOutputBytes: 64 * 1024,
	});
	const geometry = parseBundledOpusStream(encoded);
	const decoded = codec.decode(encoded, {
		frameCount: frames, channelCount: channels, outputBytes: input.byteLength,
	});
	const output = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);
	let signalEnergy = 0;
	let errorEnergy = 0;
	for (let index = 0; index < source.length; index++) {
		if (!Number.isFinite(output[index])) throw new OpusRuntimeError('The Opus canary returned non-finite PCM.');
		signalEnergy += source[index]! ** 2;
		errorEnergy += (source[index]! - output[index]!) ** 2;
	}
	if (geometry.frameCount !== frames || geometry.channelCount !== channels
		|| geometry.sampleRate !== BUNDLED_OPUS_SAMPLE_RATE
		|| 10 * Math.log10(signalEnergy / errorEnergy) < 20) {
		throw new OpusRuntimeError('The reviewed Opus payload failed its startup canary.');
	}
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-libopus-libogg-wasm-${target}`,
		implementation: 'libopus-libogg-wasm-f32', version: BUNDLED_OPUS_VERSION,
		capabilityGeneration: `libopus-libogg-${BUNDLED_OPUS_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return supportedOperation(operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled libopus/libogg payload supports 48 kHz family-0 mono/stereo only.',
				});
		},
	});
}

function supportedOperation(operation: DesktopCodecOperation): boolean {
	const encodeGeometry = operation.direction === 'encode'
		&& operation.sampleRate === BUNDLED_OPUS_SAMPLE_RATE
		&& Number.isSafeInteger(operation.channelCount)
		&& operation.channelCount! >= 1 && operation.channelCount! <= BUNDLED_OPUS_MAXIMUM_CHANNELS;
	const decodeGeometry = operation.direction === 'decode'
		&& operation.sampleRate === null && operation.channelCount === null;
	return matchingOperation(operation) && (encodeGeometry || decodeGeometry);
}

function matchingOperation(operation: DesktopCodecOperation): boolean {
	const contractGeometry = operation.direction === 'decode'
		? operation.sampleRate === null && operation.channelCount === null
		: operation.sampleRate !== null && OPUS_CONTRACT_SAMPLE_RATES.has(operation.sampleRate)
			&& Number.isSafeInteger(operation.channelCount)
			&& operation.channelCount! >= 1 && operation.channelCount! <= 8;
	return !!operation && operation.mediaKind === 'audio'
		&& (operation.direction === 'encode' || operation.direction === 'decode')
		&& operation.container === 'ogg' && operation.codec === 'opus' && operation.profile === null
		&& operation.sampleFormat === 'f32p' && operation.pixelFormat === null
		&& operation.width === null && operation.height === null
		&& contractGeometry;
}

function encodeProfileSupported(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
): boolean {
	return request.sampleRate === BUNDLED_OPUS_SAMPLE_RATE
		&& request.channelCount >= 1 && request.channelCount <= BUNDLED_OPUS_MAXIMUM_CHANNELS;
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new OpusPcmInputError();
	}
}

class OpusRuntimeError extends Error {}
class OpusCodecResultError extends Error {}
class OpusOutputBoundError extends Error {}
class OpusPcmInputError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled Opus desktop target is unsupported.');
	}
	return value as DesktopCodecTarget;
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal?: AbortSignal, fallback?: unknown): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	if (fallback instanceof Error && isAbortError(fallback)) return fallback;
	return new DOMException('The bundled Opus operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
