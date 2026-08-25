/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for the exact reviewed mpg123 1.33.7 WebAssembly decoder. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import {
	BundledMpegAudioStreamError,
	BundledMpegAudioStreamUnsupportedError,
	parseBundledMpegAudioStream,
	type BundledMpegAudioFormat,
} from './bundled-mpeg-audio-stream.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.ts';
import {
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';

export const BUNDLED_MPG123_VERSION = 'mpg123-1.33.7';
export const BUNDLED_MPG123_WASM_BYTE_LENGTH = 172_327;
export const BUNDLED_MPG123_WASM_SHA256 = '2c5a60ce737adb0adb98df8301c76804bffeb59373fe7fbce2c8383e926dd7be';
export const BUNDLED_MPG123_WASM_URL = new URL(
	'../src/common/editor/mpg123/mpg123.wasm', import.meta.url,
);

const MAXIMUM_FRAME_COUNT = 33_554_432;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const SAMPLE_RATES = new Set([32_000, 44_100, 48_000]);
const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
});

interface Mpg123Exports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly scmp_abi_version: () => number;
	readonly scmp_maximum_frames: () => number;
	readonly scmp_initial_memory_bytes: () => number;
	readonly scmp_maximum_memory_bytes: () => number;
	readonly scmp_allocate: (bytes: number) => number;
	readonly scmp_free: (pointer: number) => void;
	readonly scmp_decode_float32: (
		input: number, inputBytes: number, frames: number, sampleRate: number,
		channels: number, output: number, outputBytes: number,
	) => number;
}

interface Mpg123Codec {
	decode(input: Uint8Array, options: Mpg123DecodeOptions): Uint8Array;
}

interface Mpg123DecodeOptions {
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly outputBytes: number;
}

export interface BundledMpg123RuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledMpg123AudioCodecRuntime(
	options: BundledMpg123RuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled mpg123 payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled mpg123 scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_MPG123_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_MPG123_WASM_SHA256) return null;
		const exports = await loadReviewedWasm(source);
		const codec = wasmCodec(exports);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_MPG123_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: Mpg123Codec,
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
			catch { return rejected('The mpg123 request is invalid.'); }
			if (request.operation !== 'audio-decode' || !isMpegFormat(request.format)
				|| options?.operation?.direction !== 'decode' || !matchingOperation(options.operation)) {
				return rejected('The mpg123 request does not match its admitted decode operation.');
			}
			try { parseBundledMpegAudioStream(request.input, request.format); }
			catch (error) {
				if (error instanceof BundledMpegAudioStreamUnsupportedError) return Object.freeze({
					disposition: 'unsupported',
					reason: 'The MPEG audio input uses a valid profile outside the reviewed bundled subset.',
				});
				return rejected('The MPEG audio input failed bounded structural validation.');
			}
			return Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The mpg123 request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			if (request.operation !== 'audio-decode' || !isMpegFormat(request.format)
				|| !matchingOperation(options?.operation)) {
				return failed('unavailable', 'The bundled mpg123 provider supports MP3 and MP2 decoding only.');
			}
			try {
				const geometry = parseBundledMpegAudioStream(request.input, request.format);
				const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
				if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maximumOutputBytes) {
					return failed('result-failed', 'The decoded MPEG audio PCM exceeds the requested output bound.');
				}
				await yieldControl();
				throwIfAborted(options.signal);
				const output = codec.decode(request.input, { ...geometry, outputBytes });
				validateFiniteFloat32(output);
				throwIfAborted(options.signal);
				return Object.freeze({
					status: 'executed', output,
					decodedGeometry: Object.freeze({
						sampleRate: geometry.sampleRate, channelCount: geometry.channelCount,
						frameCount: geometry.frameCount,
					}),
				});
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof BundledMpegAudioStreamUnsupportedError) {
					return failed('unavailable', 'The MPEG audio input is outside the reviewed bundled profile.');
				}
				if (error instanceof BundledMpegAudioStreamError || error instanceof Mpg123CodecResultError) {
					return failed('security-failed', 'The MPEG audio stream failed bounded validation or decoding.');
				}
				return failed('execution-failed', 'The reviewed mpg123 payload could not complete the operation.');
			}
		},
	});
}

async function loadReviewedWasm(source: Uint8Array): Promise<Mpg123Exports> {
	const module = await WebAssembly.compile(Uint8Array.from(source));
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new Mpg123RuntimeError(`The reviewed mpg123 payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.scmp_abi_version() !== 1 || exports.scmp_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.scmp_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.scmp_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new Mpg123RuntimeError('The reviewed mpg123 payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): Mpg123Exports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new Mpg123RuntimeError('mpg123 memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'scmp_abi_version', 'scmp_maximum_frames', 'scmp_initial_memory_bytes',
		'scmp_maximum_memory_bytes', 'scmp_allocate', 'scmp_free', 'scmp_decode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new Mpg123RuntimeError(`mpg123 export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as Mpg123Exports;
}

function wasmCodec(exports: Mpg123Exports): Mpg123Codec {
	return Object.freeze({
		decode(input: Uint8Array, options: Mpg123DecodeOptions): Uint8Array {
			if (!(input instanceof Uint8Array) || input.byteLength < 4
				|| !Number.isSafeInteger(options.outputBytes) || options.outputBytes < 1
				|| options.outputBytes > MAXIMUM_OUTPUT_BYTES) throw new Mpg123RuntimeError('mpg123 ABI bounds are invalid.');
			const inputPointer = allocate(exports, input.byteLength);
			let outputPointer = 0;
			try {
				outputPointer = allocate(exports, options.outputBytes);
				new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
				const result = exports.scmp_decode_float32(
					inputPointer, input.byteLength, options.frameCount, options.sampleRate,
					options.channelCount, outputPointer, options.outputBytes,
				);
				if (result !== options.frameCount) throw new Mpg123CodecResultError();
				return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, options.outputBytes));
			} finally {
				if (outputPointer !== 0) exports.scmp_free(outputPointer);
				exports.scmp_free(inputPointer);
			}
		},
	});
}

function allocate(exports: Mpg123Exports, byteLength: number): number {
	const pointer = exports.scmp_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.scmp_free(pointer);
		throw new Mpg123RuntimeError('The reviewed mpg123 payload exceeded its memory bound.');
	}
	return pointer;
}

function verifyCanary(codec: Mpg123Codec): void {
	for (const candidate of [
		{ format: 'mp3' as const, layer: 3 as const, sampleRate: 44_100, channelCount: 2, bitrate: 128 },
		{ format: 'mp2' as const, layer: 2 as const, sampleRate: 48_000, channelCount: 1, bitrate: 192 },
	] as const) {
		const input = canaryStream(candidate.layer, candidate.sampleRate, candidate.channelCount, candidate.bitrate);
		const geometry = parseBundledMpegAudioStream(input, candidate.format);
		const outputBytes = geometry.frameCount * geometry.channelCount * 4;
		const output = codec.decode(input, { ...geometry, outputBytes });
		validateFiniteFloat32(output);
		if (output.byteLength !== outputBytes) throw new Mpg123RuntimeError('The mpg123 canary geometry changed.');
	}
}

function canaryStream(layer: 2 | 3, sampleRate: number, channelCount: 1 | 2, bitrate: number): Uint8Array {
	const bitrateTable = layer === 2
		? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
		: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
	const rateIndex = [44_100, 48_000, 32_000].indexOf(sampleRate);
	const bitrateIndex = bitrateTable.indexOf(bitrate);
	const frames: Uint8Array[] = [];
	for (let index = 0; index < 4; index++) {
		const padding = index & 1;
		const bytes = Math.floor(144 * bitrate * 1_000 / sampleRate) + padding;
		const header = (0x7ff << 21) | (3 << 19) | ((layer === 2 ? 2 : 1) << 17) | (1 << 16)
			| (bitrateIndex << 12) | (rateIndex << 10) | (padding << 9)
			| ((channelCount === 1 ? 3 : 0) << 6);
		const frame = new Uint8Array(bytes);
		new DataView(frame.buffer).setUint32(0, header >>> 0, false);
		frames.push(frame);
	}
	const result = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
	let offset = 0;
	for (const frame of frames) { result.set(frame, offset); offset += frame.byteLength; }
	return result;
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-mpg123-wasm-${target}`,
		implementation: 'libmpg123-wasm-feed-f32', version: BUNDLED_MPG123_VERSION,
		capabilityGeneration: `mpg123-${BUNDLED_MPG123_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return matchingOperation(operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled mpg123 payload supports MPEG-1 Layer II/III mono/stereo decoding only.',
				});
		},
	});
}

function matchingOperation(operation: DesktopCodecOperation): boolean {
	const geometry = operation?.sampleRate === null && operation.channelCount === null
		|| SAMPLE_RATES.has(operation?.sampleRate as number)
			&& (operation.channelCount === 1 || operation.channelCount === 2);
	const format = operation?.container === 'mp3' && operation.codec === 'mp3'
		|| operation?.container === 'mp2' && operation.codec === 'mp2';
	return !!operation && operation.direction === 'decode' && operation.mediaKind === 'audio'
		&& format && operation.profile === null && operation.sampleFormat === 'f32'
		&& operation.pixelFormat === null && operation.width === null && operation.height === null
		&& geometry;
}

function isMpegFormat(value: string): value is BundledMpegAudioFormat {
	return value === 'mp3' || value === 'mp2';
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += 4) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new Mpg123CodecResultError();
	}
}

function rejected(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'rejected', reason });
}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed', detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

class Mpg123RuntimeError extends Error {}
class Mpg123CodecResultError extends Error {}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) throw new TypeError('The bundled mpg123 desktop target is unsupported.');
	return value as DesktopCodecTarget;
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortReason(signal); }
function isAbortError(value: unknown): boolean { return value instanceof Error && value.name === 'AbortError'; }
function abortReason(signal?: AbortSignal, fallback?: unknown): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	if (fallback instanceof Error && isAbortError(fallback)) return fallback;
	return new DOMException('The bundled mpg123 operation was cancelled.', 'AbortError');
}
async function yieldToMainLoop(): Promise<void> { await waitImmediate(); }
