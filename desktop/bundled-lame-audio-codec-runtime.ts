/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for the exact reviewed LAME 4.0 WebAssembly encoder. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import { parseBundledMpegAudioStream } from './bundled-mpeg-audio-stream.ts';
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

export const BUNDLED_LAME_VERSION = '4.0';
export const BUNDLED_LAME_WASM_BYTE_LENGTH = 212_205;
export const BUNDLED_LAME_WASM_SHA256 = '654d08f946851134755513c8c0cd4486e8c9d2024df2318dc48b262e4ad7a502';
export const BUNDLED_LAME_WASM_URL = new URL(
	'../src/common/editor/lame/lame.wasm', import.meta.url,
);

const MAXIMUM_FRAME_COUNT = 8_388_608;
const MAXIMUM_CHANNEL_COUNT = 2;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const MINIMUM_ENCODER_BUFFER_BYTES = 7_200;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const ADMITTED_SAMPLE_RATES = new Set<number>([32_000, 44_100, 48_000]);

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code: number) => {
		throw new LameRuntimeError(`The reviewed LAME payload exited with code ${String(code)}.`);
	},
});

interface LameExports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly sclm_abi_version: () => number;
	readonly sclm_lame_major: () => number;
	readonly sclm_lame_minor: () => number;
	readonly sclm_maximum_channels: () => number;
	readonly sclm_maximum_frames: () => number;
	readonly sclm_initial_memory_bytes: () => number;
	readonly sclm_maximum_memory_bytes: () => number;
	readonly sclm_allocate: (bytes: number) => number;
	readonly sclm_free: (pointer: number) => void;
	readonly sclm_encode_float32: (
		input: number, frames: number, channels: number, sampleRate: number,
		bitrateKbps: number, output: number, outputCapacity: number,
	) => number;
}

interface LameCodec {
	encode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly bitrateKbps: number;
		readonly maximumOutputBytes: number;
	}>): Uint8Array;
}

export interface BundledLameRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledLameAudioCodecRuntime(
	options: BundledLameRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled LAME payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled LAME scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_LAME_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_LAME_WASM_SHA256) return null;
		const exports = await loadReviewedWasm(source);
		const codec = wasmCodec(exports);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_LAME_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: LameCodec,
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
			catch { return Object.freeze({ disposition: 'rejected', reason: 'The LAME request is invalid.' }); }
			if (request.operation !== 'audio-encode' || request.format !== 'mp3'
				|| options?.operation?.direction !== 'encode' || !matchingOperation(options.operation)) {
				return Object.freeze({
					disposition: 'rejected', reason: 'The LAME request does not match its admitted operation.',
				});
			}
			if (!encodeProfileSupported(request)) return Object.freeze({
				disposition: 'unsupported',
				reason: 'The bundled LAME profile does not admit this sample-rate/channel/bitrate tuple.',
			});
			return Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The LAME request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const tuple = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (tuple.disposition !== 'supported' || request.operation !== 'audio-encode'
				|| request.format !== 'mp3') {
				return failed('unavailable', 'The bundled LAME provider does not support this exact operation.');
			}
			if (!encodeProfileSupported(request)) return failed(
				'unavailable',
				'The bundled LAME profile does not admit this sample-rate/channel/bitrate tuple.',
			);
			try {
				await yieldControl();
				throwIfAborted(options.signal);
				const output = encode(request, codec);
				throwIfAborted(options.signal);
				return Object.freeze({ status: 'executed', output });
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof LamePcmInputError) {
					return failed('security-failed', 'The MP3 PCM input failed bounded validation.');
				}
				if (error instanceof LameOutputBoundError) return failed('result-failed', error.message);
				if (error instanceof LameOutputValidationError) {
					return failed('result-failed', 'LAME returned an MP3 stream outside its exact admitted tuple.');
				}
				return failed('execution-failed', 'The reviewed LAME payload could not complete the operation.');
			}
		},
	});
}

function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode'; readonly format: 'mp3' }>,
	codec: LameCodec,
): Uint8Array {
	validateFiniteFloat32(request.input);
	const frameCount = request.input.byteLength
		/ (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
	let output: Uint8Array;
	try {
		output = codec.encode(request.input, {
			frameCount, channelCount: request.channelCount, sampleRate: request.sampleRate,
			bitrateKbps: request.settings.bitrateKbps,
			maximumOutputBytes: request.maximumOutputBytes,
		});
	} catch (error) {
		if (error instanceof LameCodecOutputBoundError) {
			throw new LameOutputBoundError('The encoded MP3 stream exceeds the requested output bound.');
		}
		throw error;
	}
	try {
		const geometry = parseBundledMpegAudioStream(output, 'mp3');
		if (geometry.format !== 'mp3' || geometry.layer !== 3
			|| geometry.sampleRate !== request.sampleRate
			|| geometry.channelCount !== request.channelCount
			|| geometry.frameCount !== frameCount
			|| geometry.bitrateKbps !== request.settings.bitrateKbps
			|| geometry.gapless !== 'lame' || geometry.encoderDelay < 1 || geometry.endPadding < 0) {
			throw new LameOutputValidationError();
		}
	} catch (error) {
		if (error instanceof LameOutputValidationError) throw error;
		throw new LameOutputValidationError();
	}
	return output;
}

async function loadReviewedWasm(source: Uint8Array): Promise<LameExports> {
	const ownedSource = new Uint8Array(source.byteLength);
	ownedSource.set(source);
	const module = await WebAssembly.compile(ownedSource);
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new LameRuntimeError(`The reviewed LAME payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.sclm_abi_version() !== 1
		|| exports.sclm_lame_major() !== 4 || exports.sclm_lame_minor() !== 0
		|| exports.sclm_maximum_channels() !== MAXIMUM_CHANNEL_COUNT
		|| exports.sclm_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.sclm_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.sclm_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new LameRuntimeError('The reviewed LAME payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): LameExports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new LameRuntimeError('LAME memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'sclm_abi_version', 'sclm_lame_major', 'sclm_lame_minor',
		'sclm_maximum_channels', 'sclm_maximum_frames', 'sclm_initial_memory_bytes',
		'sclm_maximum_memory_bytes', 'sclm_allocate', 'sclm_free', 'sclm_encode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new LameRuntimeError(`LAME export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as LameExports;
}

function wasmCodec(exports: LameExports): LameCodec {
	return Object.freeze({
		encode(input: Uint8Array, options: Readonly<{
			readonly frameCount: number;
			readonly channelCount: number;
			readonly sampleRate: number;
			readonly bitrateKbps: number;
			readonly maximumOutputBytes: number;
		}>): Uint8Array {
			const capacity = Math.max(options.maximumOutputBytes, MINIMUM_ENCODER_BUFFER_BYTES);
			const inputPointer = allocate(exports, input.byteLength);
			let outputPointer = 0;
			try {
				outputPointer = allocate(exports, capacity);
				new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
				const result = exports.sclm_encode_float32(
					inputPointer, options.frameCount, options.channelCount, options.sampleRate,
					options.bitrateKbps, outputPointer, capacity,
				);
				if (result === -1 || result > options.maximumOutputBytes) {
					throw new LameCodecOutputBoundError();
				}
				if (!Number.isSafeInteger(result) || result <= 0 || result > capacity) {
					throw new LameRuntimeError('The reviewed LAME encoder returned an invalid result.');
				}
				return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, result));
			} finally {
				if (outputPointer !== 0) exports.sclm_free(outputPointer);
				exports.sclm_free(inputPointer);
			}
		},
	});
}

function allocate(exports: LameExports, byteLength: number): number {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new LameRuntimeError('The LAME allocation bound is invalid.');
	}
	const pointer = exports.sclm_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.sclm_free(pointer);
		throw new LameRuntimeError('The reviewed LAME payload exceeded its memory bound.');
	}
	return pointer;
}

function verifyCanary(codec: LameCodec): void {
	const frameCount = 1_153;
	const channelCount = 1;
	const sampleRate = 48_000;
	const bitrateKbps = 128;
	const input = new Uint8Array(new Float32Array(frameCount).buffer);
	const output = codec.encode(input, {
		frameCount, channelCount, sampleRate, bitrateKbps, maximumOutputBytes: 64 * 1024,
	});
	const geometry = parseBundledMpegAudioStream(output, 'mp3');
	if (geometry.format !== 'mp3' || geometry.layer !== 3 || geometry.frameCount !== frameCount
		|| geometry.sampleRate !== sampleRate || geometry.channelCount !== channelCount
		|| geometry.bitrateKbps !== bitrateKbps || geometry.gapless !== 'lame') {
		throw new LameRuntimeError('The reviewed LAME payload failed its startup canary.');
	}
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-lame-wasm-${target}`,
		implementation: 'lame-wasm-f32-mp3', version: BUNDLED_LAME_VERSION,
		capabilityGeneration: `lame-${BUNDLED_LAME_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return matchingOperation(operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled LAME payload supports bounded MP3 CBR encoding only.',
				});
		},
	});
}

function matchingOperation(operation: DesktopCodecOperation): boolean {
	return !!operation && operation.direction === 'encode' && operation.mediaKind === 'audio'
		&& operation.container === 'mp3' && operation.codec === 'mp3' && operation.profile === null
		&& operation.sampleFormat === 'f32p' && operation.pixelFormat === null
		&& operation.sampleRate !== null && ADMITTED_SAMPLE_RATES.has(operation.sampleRate)
		&& Number.isSafeInteger(operation.channelCount) && operation.channelCount! >= 1
		&& operation.channelCount! <= MAXIMUM_CHANNEL_COUNT
		&& operation.width === null && operation.height === null;
}

function encodeProfileSupported(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode'; readonly format: 'mp3' }>,
): boolean {
	const minimumBitrate = request.sampleRate === 32_000
		? request.channelCount === 1 ? 40 : 48
		: request.sampleRate === 44_100 && request.channelCount === 1 ? 56 : 64;
	return request.settings.bitrateKbps >= minimumBitrate;
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new LamePcmInputError();
	}
}

class LameRuntimeError extends Error {}
class LameCodecOutputBoundError extends Error {}
class LameOutputBoundError extends Error {}
class LameOutputValidationError extends Error {}
class LamePcmInputError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled LAME desktop target is unsupported.');
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
	return new DOMException('The bundled LAME operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
