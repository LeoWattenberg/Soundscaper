/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for the exact reviewed TwoLAME 0.4.0 WebAssembly encoder. */

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

export const BUNDLED_TWOLAME_VERSION = '0.4.0';
export const BUNDLED_TWOLAME_WASM_BYTE_LENGTH = 146_820;
export const BUNDLED_TWOLAME_WASM_SHA256 = 'b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b';
export const BUNDLED_TWOLAME_WASM_URL = new URL(
	'../src/common/editor/twolame/twolame.wasm', import.meta.url,
);

const MAXIMUM_FRAME_COUNT = 8_388_608;
const MAXIMUM_CHANNEL_COUNT = 2;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const ADMITTED_SAMPLE_RATES = new Set<number>([32_000, 44_100, 48_000]);
const ADMITTED_BITRATES = new Set<number>([
	32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
]);

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
});

interface TwolameExports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly sctl_abi_version: () => number;
	readonly sctl_twolame_major: () => number;
	readonly sctl_twolame_minor: () => number;
	readonly sctl_twolame_patch: () => number;
	readonly sctl_maximum_channels: () => number;
	readonly sctl_maximum_frames: () => number;
	readonly sctl_initial_memory_bytes: () => number;
	readonly sctl_maximum_memory_bytes: () => number;
	readonly sctl_allocate: (bytes: number) => number;
	readonly sctl_free: (pointer: number) => void;
	readonly sctl_encode_float32: (
		input: number, frames: number, channels: number, sampleRate: number,
		bitrateKbps: number, output: number, outputCapacity: number,
	) => number;
}

interface TwolameCodec {
	encode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly bitrateKbps: number;
		readonly maximumOutputBytes: number;
	}>): Uint8Array;
}

export interface BundledTwolameRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledTwolameAudioCodecRuntime(
	options: BundledTwolameRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled TwoLAME payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled TwoLAME scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_TWOLAME_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_TWOLAME_WASM_SHA256) return null;
		const exports = await loadReviewedWasm(source);
		const codec = wasmCodec(exports);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_TWOLAME_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: TwolameCodec,
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
			catch { return Object.freeze({ disposition: 'rejected', reason: 'The TwoLAME request is invalid.' }); }
			if (request.operation !== 'audio-encode' || request.format !== 'mp2'
				|| options?.operation?.direction !== 'encode' || !matchingOperation(options.operation)) {
				return Object.freeze({
					disposition: 'rejected', reason: 'The TwoLAME request does not match its admitted operation.',
				});
			}
			return admittedCombination(request.channelCount, request.settings.bitrateKbps)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'TwoLAME cannot encode this valid MPEG-1 Layer II channel/bitrate combination.',
				});
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The TwoLAME request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const tuple = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (tuple.disposition !== 'supported' || request.operation !== 'audio-encode'
				|| request.format !== 'mp2'
				|| !admittedCombination(request.channelCount, request.settings.bitrateKbps)) {
				return failed('unavailable', 'The bundled TwoLAME provider does not support this exact operation.');
			}
			try {
				await yieldControl();
				throwIfAborted(options.signal);
				const output = encode(request, codec);
				throwIfAborted(options.signal);
				return Object.freeze({ status: 'executed', output });
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof TwolamePcmInputError) {
					return failed('security-failed', 'The MP2 PCM input failed bounded validation.');
				}
				if (error instanceof TwolameOutputBoundError) return failed('result-failed', error.message);
				if (error instanceof TwolameOutputValidationError) {
					return failed('result-failed', 'TwoLAME returned an MP2 stream outside its exact admitted tuple.');
				}
				return failed('execution-failed', 'The reviewed TwoLAME payload could not complete the operation.');
			}
		},
	});
}

function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode'; readonly format: 'mp2' }>,
	codec: TwolameCodec,
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
		if (error instanceof TwolameCodecOutputBoundError) {
			throw new TwolameOutputBoundError('The encoded MP2 stream exceeds the requested output bound.');
		}
		throw error;
	}
	try {
		const geometry = parseBundledMpegAudioStream(output, 'mp2');
		const mpegFrameCount = Math.ceil(frameCount / 1_152);
		if (geometry.format !== 'mp2' || geometry.layer !== 2 || geometry.mpegVersion !== 1
			|| geometry.sampleRate !== request.sampleRate
			|| geometry.channelCount !== request.channelCount
			|| geometry.bitrateKbps !== request.settings.bitrateKbps
			|| geometry.mpegFrameCount !== mpegFrameCount
			|| geometry.frameCount !== mpegFrameCount * 1_152
			|| geometry.gapless !== 'none' || geometry.encoderDelay !== 0 || geometry.endPadding !== 0) {
			throw new TwolameOutputValidationError();
		}
	} catch (error) {
		if (error instanceof TwolameOutputValidationError) throw error;
		throw new TwolameOutputValidationError();
	}
	return output;
}

async function loadReviewedWasm(source: Uint8Array): Promise<TwolameExports> {
	const ownedSource = new Uint8Array(source.byteLength);
	ownedSource.set(source);
	const module = await WebAssembly.compile(ownedSource);
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	const descriptors = WebAssembly.Module.imports(module);
	if (descriptors.length !== Object.keys(ALLOWED_IMPORTS).length) {
		throw new TwolameRuntimeError('The reviewed TwoLAME payload import inventory changed.');
	}
	for (const descriptor of descriptors) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new TwolameRuntimeError(`The reviewed TwoLAME payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.sctl_abi_version() !== 1 || exports.sctl_twolame_major() !== 0
		|| exports.sctl_twolame_minor() !== 4 || exports.sctl_twolame_patch() !== 0
		|| exports.sctl_maximum_channels() !== MAXIMUM_CHANNEL_COUNT
		|| exports.sctl_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.sctl_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.sctl_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new TwolameRuntimeError('The reviewed TwoLAME payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): TwolameExports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new TwolameRuntimeError('TwoLAME memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'sctl_abi_version', 'sctl_twolame_major', 'sctl_twolame_minor',
		'sctl_twolame_patch', 'sctl_maximum_channels', 'sctl_maximum_frames',
		'sctl_initial_memory_bytes', 'sctl_maximum_memory_bytes', 'sctl_allocate',
		'sctl_free', 'sctl_encode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new TwolameRuntimeError(`TwoLAME export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as TwolameExports;
}

function wasmCodec(exports: TwolameExports): TwolameCodec {
	return Object.freeze({
		encode(input: Uint8Array, options: Parameters<TwolameCodec['encode']>[1]): Uint8Array {
			const inputPointer = allocate(exports, input.byteLength);
			let outputPointer = 0;
			try {
				outputPointer = allocate(exports, options.maximumOutputBytes);
				new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
				const result = exports.sctl_encode_float32(
					inputPointer, options.frameCount, options.channelCount, options.sampleRate,
					options.bitrateKbps, outputPointer, options.maximumOutputBytes,
				);
				if (result === -1) throw new TwolameCodecOutputBoundError();
				if (!Number.isSafeInteger(result) || result <= 0 || result > options.maximumOutputBytes) {
					throw new TwolameRuntimeError('The reviewed TwoLAME encoder returned an invalid result.');
				}
				return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, result));
			} finally {
				if (outputPointer !== 0) exports.sctl_free(outputPointer);
				exports.sctl_free(inputPointer);
			}
		},
	});
}

function allocate(exports: TwolameExports, byteLength: number): number {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new TwolameRuntimeError('The TwoLAME allocation bound is invalid.');
	}
	const pointer = exports.sctl_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.sctl_free(pointer);
		throw new TwolameRuntimeError('The reviewed TwoLAME payload exceeded its memory bound.');
	}
	return pointer;
}

function verifyCanary(codec: TwolameCodec): void {
	const frameCount = 1_153;
	const channelCount = 1;
	const sampleRate = 48_000;
	const bitrateKbps = 128;
	const input = new Uint8Array(new Float32Array(frameCount).buffer);
	const output = codec.encode(input, {
		frameCount, channelCount, sampleRate, bitrateKbps, maximumOutputBytes: 64 * 1024,
	});
	const geometry = parseBundledMpegAudioStream(output, 'mp2');
	if (geometry.format !== 'mp2' || geometry.layer !== 2 || geometry.mpegVersion !== 1
		|| geometry.frameCount !== 2_304 || geometry.mpegFrameCount !== 2
		|| geometry.sampleRate !== sampleRate || geometry.channelCount !== channelCount
		|| geometry.bitrateKbps !== bitrateKbps || geometry.gapless !== 'none') {
		throw new TwolameRuntimeError('The reviewed TwoLAME payload failed its startup canary.');
	}
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-twolame-wasm-${target}`,
		implementation: 'twolame-wasm-f32-mp2', version: BUNDLED_TWOLAME_VERSION,
		capabilityGeneration: `twolame-${BUNDLED_TWOLAME_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return matchingOperation(operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled TwoLAME payload supports bounded MPEG-1 Layer II encoding only.',
				});
		},
	});
}

function matchingOperation(operation: DesktopCodecOperation): boolean {
	return !!operation && operation.direction === 'encode' && operation.mediaKind === 'audio'
		&& operation.container === 'mp2' && operation.codec === 'mp2' && operation.profile === null
		&& operation.sampleFormat === 'f32p' && operation.pixelFormat === null
		&& operation.sampleRate !== null && ADMITTED_SAMPLE_RATES.has(operation.sampleRate)
		&& Number.isSafeInteger(operation.channelCount) && operation.channelCount! >= 1
		&& operation.channelCount! <= MAXIMUM_CHANNEL_COUNT
		&& operation.width === null && operation.height === null;
}

function admittedCombination(channelCount: number, bitrateKbps: number): boolean {
	return ADMITTED_BITRATES.has(bitrateKbps) && (channelCount === 1
		? bitrateKbps <= 192
		: channelCount === 2 && bitrateKbps >= 64 && bitrateKbps !== 80);
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new TwolamePcmInputError();
	}
}

class TwolameRuntimeError extends Error {}
class TwolameCodecOutputBoundError extends Error {}
class TwolameOutputBoundError extends Error {}
class TwolameOutputValidationError extends Error {}
class TwolamePcmInputError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled TwoLAME desktop target is unsupported.');
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
	return new DOMException('The bundled TwoLAME operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
