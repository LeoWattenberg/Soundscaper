/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for the exact reviewed libFLAC 1.5.0 WebAssembly payload. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import {
	BundledFlacStreamError,
	parseBundledFlacStream,
} from './bundled-flac-stream.ts';
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

export const BUNDLED_FLAC_VERSION = '1.5.0';
export const BUNDLED_FLAC_WASM_BYTE_LENGTH = 153_044;
export const BUNDLED_FLAC_WASM_SHA256 = '34acff0d67e3ac7f34816217ed7f5f859bf9a1c70f33eb3c347049f5fdf0d443';
export const BUNDLED_FLAC_PCM_BIT_DEPTH = 24;
export const BUNDLED_FLAC_WASM_URL = new URL(
	'../src/common/editor/flac/flac.wasm', import.meta.url,
);

const MAXIMUM_FRAME_COUNT = 33_554_432;
const MAXIMUM_SAMPLE_RATE = 192_000;
const MAXIMUM_CHANNEL_COUNT = 8;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.abort': () => { throw new FlacRuntimeError('The reviewed FLAC payload aborted.'); },
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_read': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code: number) => {
		throw new FlacRuntimeError(`The reviewed FLAC payload exited with code ${String(code)}.`);
	},
});

interface FlacExports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly scfl_abi_version: () => number;
	readonly scfl_maximum_channels: () => number;
	readonly scfl_maximum_frames: () => number;
	readonly scfl_initial_memory_bytes: () => number;
	readonly scfl_maximum_memory_bytes: () => number;
	readonly scfl_allocate: (bytes: number) => number;
	readonly scfl_free: (pointer: number) => void;
	readonly scfl_encode_float32: (
		input: number, frames: number, channels: number, sampleRate: number,
		compressionLevel: number, output: number, outputCapacity: number,
	) => number;
	readonly scfl_decode_float32: (
		input: number, inputBytes: number, frames: number, channels: number,
		sampleRate: number, output: number, outputBytes: number,
	) => number;
}

interface FlacCodec {
	encode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly compressionLevel: number;
		readonly maximumOutputBytes: number;
	}>): Uint8Array;
	decode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly outputBytes: number;
	}>): Uint8Array;
}

export interface BundledFlacRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledFlacAudioCodecRuntime(
	options: BundledFlacRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled FLAC payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled FLAC scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_FLAC_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_FLAC_WASM_SHA256) return null;
		const exports = await loadReviewedWasm(source);
		const codec = wasmCodec(exports);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_FLAC_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: FlacCodec,
	yieldControl: () => Promise<void>,
): DesktopAudioCodecProviderRuntime {
	const provider = bundledProvider(target);
	return Object.freeze({
		provider,
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The FLAC request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const preflight = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (preflight.disposition !== 'supported' || request.format !== 'flac') {
				return failed('unavailable', 'The bundled FLAC provider does not support this exact operation.');
			}
			if (request.operation === 'audio-encode' && request.format === 'flac') {
				const settings = request.settings as Readonly<{
					readonly compressionLevel: number;
					readonly bitDepth: 16 | 24;
				}>;
				if (settings.bitDepth !== BUNDLED_FLAC_PCM_BIT_DEPTH) {
					return failed('unavailable', 'The bundled FLAC provider supports only signed 24-bit PCM.');
				}
				if (settings.compressionLevel > 8) {
					return failed('unavailable', 'The bundled FLAC provider supports compression levels 0 through 8.');
				}
			}
			try {
				await yieldControl();
				throwIfAborted(options.signal);
				const output = request.operation === 'audio-encode'
					? encode(request, codec)
					: decode(request, codec);
				throwIfAborted(options.signal);
				return Object.freeze({ status: 'executed', output });
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof BundledFlacStreamError || error instanceof FlacDecodeIntegrityError
					|| error instanceof FlacPcmInputError) {
					return failed('security-failed', error instanceof FlacGeometryMismatchError
						? 'The FLAC source geometry does not match the decode request.'
						: 'The FLAC input stream or PCM failed bounded validation.');
				}
				if (error instanceof FlacGeometryMismatchError) {
					return failed('security-failed', 'The FLAC source geometry does not match the decode request.');
				}
				if (error instanceof FlacOutputBoundError) return failed('result-failed', error.message);
				return failed('execution-failed', 'The reviewed FLAC payload could not complete the operation.');
			}
		},
	});
}

function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
	codec: FlacCodec,
): Uint8Array {
	const frameCount = request.input.byteLength / (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
	const settings = request.settings as Readonly<{ readonly compressionLevel: number }>;
	validateFiniteFloat32(request.input);
	try {
		return codec.encode(request.input, {
			frameCount, channelCount: request.channelCount, sampleRate: request.sampleRate,
			compressionLevel: settings.compressionLevel,
			maximumOutputBytes: request.maximumOutputBytes,
		});
	} catch (error) {
		if (error instanceof FlacCodecResultError) {
			throw new FlacOutputBoundError('The encoded FLAC stream exceeds the requested output bound.');
		}
		throw error;
	}
}

function decode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-decode' }>,
	codec: FlacCodec,
): Uint8Array {
	const geometry = parseBundledFlacStream(request.input);
	if (geometry.sampleRate !== request.sampleRate || geometry.channelCount !== request.channelCount) {
		throw new FlacGeometryMismatchError();
	}
	const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maximumOutputBytes) {
		throw new FlacOutputBoundError('The decoded FLAC PCM exceeds the requested output bound.');
	}
	try {
		return codec.decode(request.input, {
			frameCount: geometry.frameCount, channelCount: geometry.channelCount,
			sampleRate: geometry.sampleRate, outputBytes,
		});
	} catch (error) {
		if (error instanceof FlacCodecResultError) throw new FlacDecodeIntegrityError();
		throw error;
	}
}

async function loadReviewedWasm(source: Uint8Array): Promise<FlacExports> {
	const ownedSource = new Uint8Array(source.byteLength);
	ownedSource.set(source);
	const module = await WebAssembly.compile(ownedSource);
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new FlacRuntimeError(`The reviewed FLAC payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.scfl_abi_version() !== 1
		|| exports.scfl_maximum_channels() !== MAXIMUM_CHANNEL_COUNT
		|| exports.scfl_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.scfl_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.scfl_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new FlacRuntimeError('The reviewed FLAC payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): FlacExports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new FlacRuntimeError('FLAC memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'scfl_abi_version', 'scfl_maximum_channels', 'scfl_maximum_frames',
		'scfl_initial_memory_bytes', 'scfl_maximum_memory_bytes', 'scfl_allocate', 'scfl_free',
		'scfl_encode_float32', 'scfl_decode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new FlacRuntimeError(`FLAC export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as FlacExports;
}

function wasmCodec(exports: FlacExports): FlacCodec {
	const codec: FlacCodec = {
		encode(input, options) {
			return invokeCodec(exports, input, options.maximumOutputBytes, (inputPointer, outputPointer) => (
				exports.scfl_encode_float32(
					inputPointer, options.frameCount, options.channelCount, options.sampleRate,
					options.compressionLevel, outputPointer, options.maximumOutputBytes,
				)
			));
		},
		decode(input, options) {
			const output = invokeCodec(exports, input, options.outputBytes, (inputPointer, outputPointer) => (
				exports.scfl_decode_float32(
					inputPointer, input.byteLength, options.frameCount, options.channelCount,
					options.sampleRate, outputPointer, options.outputBytes,
				)
			));
			if (output.byteLength !== options.outputBytes) throw new FlacCodecResultError();
			return output;
		},
	};
	return Object.freeze(codec);
}

function invokeCodec(
	exports: FlacExports,
	input: Uint8Array,
	outputCapacity: number,
	invoke: (inputPointer: number, outputPointer: number) => number,
): Uint8Array {
	if (!(input instanceof Uint8Array) || input.byteLength < 1
		|| !Number.isSafeInteger(outputCapacity) || outputCapacity < 1
		|| outputCapacity > MAXIMUM_OUTPUT_BYTES) throw new FlacRuntimeError('FLAC ABI bounds are invalid.');
	const inputPointer = allocate(exports, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(exports, outputCapacity);
		new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
		const result = invoke(inputPointer, outputPointer);
		if (!Number.isSafeInteger(result) || result <= 0 || result > outputCapacity) {
			throw new FlacCodecResultError();
		}
		return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, result));
	} finally {
		if (outputPointer !== 0) exports.scfl_free(outputPointer);
		exports.scfl_free(inputPointer);
	}
}

function allocate(exports: FlacExports, byteLength: number): number {
	const pointer = exports.scfl_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.scfl_free(pointer);
		throw new FlacRuntimeError('The reviewed FLAC payload exceeded its memory bound.');
	}
	return pointer;
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new FlacPcmInputError();
	}
}

function verifyCanary(codec: FlacCodec): void {
	const frameCount = 64;
	const input = new Uint8Array(frameCount * 2 * Float32Array.BYTES_PER_ELEMENT);
	const encoded = codec.encode(input, {
		frameCount, channelCount: 2, sampleRate: 48_000, compressionLevel: 5,
		maximumOutputBytes: 64 * 1024,
	});
	const geometry = parseBundledFlacStream(encoded);
	const decoded = codec.decode(encoded, {
		frameCount, channelCount: 2, sampleRate: 48_000, outputBytes: input.byteLength,
	});
	if (geometry.frameCount !== frameCount || geometry.channelCount !== 2
		|| geometry.sampleRate !== 48_000 || geometry.bitsPerSample !== BUNDLED_FLAC_PCM_BIT_DEPTH
		|| decoded.some((byte) => byte !== 0)) {
		throw new FlacRuntimeError('The reviewed FLAC payload failed its startup canary.');
	}
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-libflac-wasm-${target}`,
		implementation: 'libflac-wasm-f32-to-s24', version: BUNDLED_FLAC_VERSION,
		capabilityGeneration: `libflac-${BUNDLED_FLAC_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return supportedOperation(operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled libFLAC payload supports bounded f32 decode and signed-24 encode only.',
				});
		},
	});
}

function supportedOperation(operation: DesktopCodecOperation): boolean {
	return !!operation && operation.mediaKind === 'audio'
		&& (operation.direction === 'encode' || operation.direction === 'decode')
		&& operation.container === 'flac' && operation.codec === 'flac'
		&& operation.profile === null
		&& operation.sampleFormat === (operation.direction === 'encode' ? 's24' : 'f32')
		&& operation.pixelFormat === null && operation.width === null && operation.height === null
		&& Number.isSafeInteger(operation.sampleRate) && operation.sampleRate! >= 8_000
		&& operation.sampleRate! <= MAXIMUM_SAMPLE_RATE
		&& Number.isSafeInteger(operation.channelCount) && operation.channelCount! >= 1
		&& operation.channelCount! <= MAXIMUM_CHANNEL_COUNT;
}

class FlacRuntimeError extends Error {}
class FlacCodecResultError extends Error {}
class FlacDecodeIntegrityError extends Error {}
class FlacGeometryMismatchError extends Error {}
class FlacOutputBoundError extends Error {}
class FlacPcmInputError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled FLAC desktop target is unsupported.');
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
	return new DOMException('The bundled FLAC operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
