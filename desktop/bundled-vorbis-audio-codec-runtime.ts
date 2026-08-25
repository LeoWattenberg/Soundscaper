/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for exact reviewed libvorbis 1.3.7 plus libogg 1.3.6 WebAssembly. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import {
	BundledVorbisStreamError,
	BundledVorbisStreamUnsupportedError,
	parseBundledVorbisStream,
	type BundledVorbisStreamGeometry,
} from './bundled-vorbis-stream.ts';
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

export const BUNDLED_VORBIS_VERSION = 'libvorbis-1.3.7+libogg-1.3.6';
export const BUNDLED_VORBIS_WASM_BYTE_LENGTH = 523_227;
export const BUNDLED_VORBIS_WASM_SHA256 = 'c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5';
export const BUNDLED_VORBIS_WASM_URL = new URL(
	'../src/common/editor/vorbis/vorbis.wasm', import.meta.url,
);

const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 192_000;
const MAXIMUM_CHANNELS = 2;
const MAXIMUM_FRAME_COUNT = 33_554_432;
const INITIAL_MEMORY_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code: number) => {
		throw new VorbisRuntimeError(`The reviewed Vorbis payload exited with code ${String(code)}.`);
	},
});

interface VorbisExports {
	readonly memory: WebAssembly.Memory;
	readonly _initialize: () => void;
	readonly scvb_abi_version: () => number;
	readonly scvb_minimum_sample_rate: () => number;
	readonly scvb_maximum_sample_rate: () => number;
	readonly scvb_maximum_channels: () => number;
	readonly scvb_maximum_frames: () => number;
	readonly scvb_initial_memory_bytes: () => number;
	readonly scvb_maximum_memory_bytes: () => number;
	readonly scvb_allocate: (bytes: number) => number;
	readonly scvb_free: (pointer: number) => void;
	readonly scvb_validate: (input: number, inputBytes: number) => number;
	readonly scvb_probe: (
		input: number, inputBytes: number, frames: number, channels: number, sampleRate: number,
	) => number;
	readonly scvb_encode_float32: (
		input: number, frames: number, channels: number, sampleRate: number, quality: number,
		output: number, outputCapacity: number,
	) => number;
	readonly scvb_decode_float32: (
		input: number, inputBytes: number, frames: number, channels: number, sampleRate: number,
		output: number, outputBytes: number,
	) => number;
}

interface VorbisCodec {
	validate(input: Uint8Array): boolean;
	probe(input: Uint8Array, geometry: BundledVorbisStreamGeometry): boolean;
	encode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly quality: number;
		readonly maximumOutputBytes: number;
	}>): Uint8Array;
	decode(input: Uint8Array, options: Readonly<{
		readonly frameCount: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly outputBytes: number;
	}>): Uint8Array;
}

export interface BundledVorbisRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledVorbisAudioCodecRuntime(
	options: BundledVorbisRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled Vorbis payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled Vorbis scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_VORBIS_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_VORBIS_WASM_SHA256) return null;
		const codec = wasmCodec(await loadReviewedWasm(source));
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_VORBIS_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: VorbisCodec,
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
			catch { return rejected('The Vorbis request is invalid.'); }
			const direction = request.operation === 'audio-encode' ? 'encode' : 'decode';
			if (request.format !== 'ogg-vorbis' || direction !== options?.operation?.direction
				|| !matchingOperation(options.operation)) {
				return rejected('The Vorbis request does not match its admitted operation.');
			}
			if (request.operation === 'audio-encode') return encodeProfileSupported(request)
				? supported()
				: unsupported('The bundled Vorbis provider requires 8–192 kHz mono or stereo PCM.');
			try {
				const geometry = parseBundledVorbisStream(request.input);
				if (!codec.probe(request.input, geometry)) {
					return rejected('The Ogg Vorbis headers failed the reviewed decoder probe.');
				}
			} catch (error) {
				if (error instanceof BundledVorbisStreamUnsupportedError) return codec.validate(request.input)
					? unsupported('The Ogg Vorbis input uses a valid profile outside the reviewed bundled subset.')
					: rejected('The unreviewed Ogg Vorbis headers failed the bundled validity probe.');
				return rejected('The Ogg Vorbis input failed bounded structural, checksum, or header validation.');
			}
			return supported();
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The Vorbis request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const tuple = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (tuple.disposition !== 'supported' || request.format !== 'ogg-vorbis') {
				return failed('unavailable', 'The bundled Vorbis provider does not support this exact operation.');
			}
			if (request.operation === 'audio-encode' && !encodeProfileSupported(request)) {
				return failed('unavailable', 'The bundled Vorbis provider requires 8–192 kHz mono or stereo PCM.');
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
				if (error instanceof BundledVorbisStreamUnsupportedError) return failed(
					'unavailable', 'The Ogg Vorbis input is outside the reviewed bundled profile.',
				);
				if (error instanceof BundledVorbisStreamError || error instanceof VorbisPcmInputError
					|| error instanceof VorbisDecodeIntegrityError) return failed(
					'security-failed', 'The Ogg Vorbis stream or PCM failed bounded validation.',
				);
				if (error instanceof VorbisOutputBoundError) return failed('result-failed', error.message);
				return failed('execution-failed', 'The reviewed Ogg Vorbis payload could not complete the operation.');
			}
		},
	});
}

function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
	codec: VorbisCodec,
): Uint8Array {
	const frameCount = request.input.byteLength / (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
	validateFiniteFloat32(request.input);
	try {
		return codec.encode(request.input, {
			frameCount, channelCount: request.channelCount, sampleRate: request.sampleRate,
			quality: (request.settings as Readonly<{ readonly quality: number }>).quality,
			maximumOutputBytes: request.maximumOutputBytes,
		});
	} catch (error) {
		if (error instanceof VorbisCodecResultError) throw new VorbisOutputBoundError(
			'The encoded Vorbis stream exceeds the requested output bound.',
		);
		throw error;
	}
}

function decode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-decode' }>,
	codec: VorbisCodec,
): Readonly<{
	readonly output: Uint8Array;
	readonly decodedGeometry: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> {
	const geometry = parseBundledVorbisStream(request.input);
	if (!codec.probe(request.input, geometry)) throw new VorbisDecodeIntegrityError();
	const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maximumOutputBytes) {
		throw new VorbisOutputBoundError('The decoded Vorbis PCM exceeds the requested output bound.');
	}
	const output = codec.decode(request.input, { ...geometry, outputBytes });
	validateFiniteFloat32(output);
	return Object.freeze({
		output,
		decodedGeometry: Object.freeze({
			sampleRate: geometry.sampleRate, channelCount: geometry.channelCount,
			frameCount: geometry.frameCount,
		}),
	});
}

async function loadReviewedWasm(source: Uint8Array): Promise<VorbisExports> {
	const module = await WebAssembly.compile(Uint8Array.from(source));
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new VorbisRuntimeError(`The reviewed Vorbis payload imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const exports = normalizeExports(instance.exports);
	exports._initialize();
	if (exports.scvb_abi_version() !== 1
		|| exports.scvb_minimum_sample_rate() !== MINIMUM_SAMPLE_RATE
		|| exports.scvb_maximum_sample_rate() !== MAXIMUM_SAMPLE_RATE
		|| exports.scvb_maximum_channels() !== MAXIMUM_CHANNELS
		|| exports.scvb_maximum_frames() !== MAXIMUM_FRAME_COUNT
		|| exports.scvb_initial_memory_bytes() !== INITIAL_MEMORY_BYTES
		|| exports.scvb_maximum_memory_bytes() !== MAXIMUM_MEMORY_BYTES
		|| exports.memory.buffer.byteLength !== INITIAL_MEMORY_BYTES) {
		throw new VorbisRuntimeError('The reviewed Vorbis payload reports unexpected ABI limits.');
	}
	return exports;
}

function normalizeExports(exports: WebAssembly.Exports): VorbisExports {
	const memory = exports.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new VorbisRuntimeError('Vorbis memory is unavailable.');
	const result: Record<string, WebAssembly.Memory | ((...arguments_: number[]) => number | void)> = { memory };
	for (const name of [
		'_initialize', 'scvb_abi_version', 'scvb_minimum_sample_rate', 'scvb_maximum_sample_rate',
		'scvb_maximum_channels', 'scvb_maximum_frames', 'scvb_initial_memory_bytes',
		'scvb_maximum_memory_bytes', 'scvb_allocate', 'scvb_free', 'scvb_validate', 'scvb_probe',
		'scvb_encode_float32', 'scvb_decode_float32',
	]) {
		const value = exports[name] ?? exports[`_${name}`];
		if (typeof value !== 'function') throw new VorbisRuntimeError(`Vorbis export ${name} is unavailable.`);
		result[name] = value as (...arguments_: number[]) => number;
	}
	return result as unknown as VorbisExports;
}

function wasmCodec(exports: VorbisExports): VorbisCodec {
	const codec: VorbisCodec = {
		validate(input) {
			return invokeInput(exports, input, (pointer) => (
				exports.scvb_validate(pointer, input.byteLength)
			)) === 1;
		},
		probe(input, geometry) {
			return invokeInput(exports, input, (pointer) => exports.scvb_probe(
				pointer, input.byteLength, geometry.frameCount, geometry.channelCount, geometry.sampleRate,
			)) === 1;
		},
		encode(input, options) {
			return invokeOutput(exports, input, options.maximumOutputBytes, null, (inputPointer, outputPointer) => (
				exports.scvb_encode_float32(
					inputPointer, options.frameCount, options.channelCount, options.sampleRate, options.quality,
					outputPointer, options.maximumOutputBytes,
				)
			));
		},
		decode(input, options) {
			return invokeOutput(exports, input, options.outputBytes, options.frameCount,
				(inputPointer, outputPointer) => exports.scvb_decode_float32(
					inputPointer, input.byteLength, options.frameCount, options.channelCount,
					options.sampleRate, outputPointer, options.outputBytes,
				));
		},
	};
	return Object.freeze(codec);
}

function invokeInput(
	exports: VorbisExports,
	input: Uint8Array,
	invoke: (inputPointer: number) => number,
): number {
	const inputPointer = allocate(exports, input.byteLength);
	try {
		new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
		return invoke(inputPointer);
	} finally { exports.scvb_free(inputPointer); }
}

function invokeOutput(
	exports: VorbisExports,
	input: Uint8Array,
	outputCapacity: number,
	expectedResult: number | null,
	invoke: (inputPointer: number, outputPointer: number) => number,
): Uint8Array {
	if (!(input instanceof Uint8Array) || input.byteLength < 1
		|| !Number.isSafeInteger(outputCapacity) || outputCapacity < 1
		|| outputCapacity > MAXIMUM_OUTPUT_BYTES) throw new VorbisRuntimeError('Vorbis ABI bounds are invalid.');
	const inputPointer = allocate(exports, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(exports, outputCapacity);
		new Uint8Array(exports.memory.buffer, inputPointer, input.byteLength).set(input);
		const result = invoke(inputPointer, outputPointer);
		if (!Number.isSafeInteger(result) || (expectedResult === null
			? result <= 0 || result > outputCapacity : result !== expectedResult)) {
			throw new VorbisCodecResultError();
		}
		const resultBytes = expectedResult === null ? result : outputCapacity;
		return Uint8Array.from(new Uint8Array(exports.memory.buffer, outputPointer, resultBytes));
	} finally {
		if (outputPointer !== 0) exports.scvb_free(outputPointer);
		exports.scvb_free(inputPointer);
	}
}

function allocate(exports: VorbisExports, byteLength: number): number {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new VorbisRuntimeError('The reviewed Vorbis allocation bound is invalid.');
	}
	const pointer = exports.scvb_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > exports.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) exports.scvb_free(pointer);
		throw new VorbisRuntimeError('The reviewed Vorbis payload exceeded its memory bound.');
	}
	return pointer;
}

function verifyCanary(codec: VorbisCodec): void {
	const frameCount = 4_800;
	const channelCount = 2;
	const sampleRate = 48_000;
	const source = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame++) {
		source[frame * channelCount] = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.35;
		source[frame * channelCount + 1] = Math.sin(2 * Math.PI * 660 * frame / sampleRate) * 0.25;
	}
	const input = new Uint8Array(source.buffer);
	const encoded = codec.encode(input, {
		frameCount, channelCount, sampleRate, quality: 6, maximumOutputBytes: 64 * 1024,
	});
	const geometry = parseBundledVorbisStream(encoded);
	if (!codec.probe(encoded, geometry)) throw new VorbisRuntimeError('The Vorbis canary probe failed.');
	const decoded = codec.decode(encoded, { ...geometry, outputBytes: input.byteLength });
	const output = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);
	let signal = 0;
	let error = 0;
	for (let index = 0; index < source.length; index++) {
		if (!Number.isFinite(output[index])) throw new VorbisRuntimeError('The Vorbis canary returned non-finite PCM.');
		signal += source[index]! ** 2;
		error += (source[index]! - output[index]!) ** 2;
	}
	if (geometry.frameCount !== frameCount || geometry.channelCount !== channelCount
		|| geometry.sampleRate !== sampleRate || 10 * Math.log10(signal / error) < 20) {
		throw new VorbisRuntimeError('The reviewed Vorbis payload failed its startup canary.');
	}
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return Object.freeze({
		kind: 'bundled', id: `bundled-libvorbis-libogg-wasm-${target}`,
		implementation: 'libvorbis-libogg-wasm-f32', version: BUNDLED_VORBIS_VERSION,
		capabilityGeneration: `libvorbis-libogg-${BUNDLED_VORBIS_WASM_SHA256}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(options?.signal);
			return supportedOperation(operation) ? supported() : unsupported(
				'The bundled libvorbis/libogg payload supports bounded 8–192 kHz mono/stereo only.',
			);
		},
	});
}

function supportedOperation(operation: DesktopCodecOperation): boolean {
	const resolved = Number.isSafeInteger(operation.sampleRate)
		&& operation.sampleRate! >= MINIMUM_SAMPLE_RATE && operation.sampleRate! <= MAXIMUM_SAMPLE_RATE
		&& Number.isSafeInteger(operation.channelCount)
		&& operation.channelCount! >= 1 && operation.channelCount! <= MAXIMUM_CHANNELS;
	const geometry = resolved || operation.direction === 'decode'
		&& operation.sampleRate === null && operation.channelCount === null;
	return matchingOperation(operation) && geometry;
}

function matchingOperation(operation: DesktopCodecOperation): boolean {
	const geometry = operation.direction === 'decode'
		&& operation.sampleRate === null && operation.channelCount === null
		|| Number.isSafeInteger(operation.sampleRate) && operation.sampleRate! >= MINIMUM_SAMPLE_RATE
			&& operation.sampleRate! <= MAXIMUM_SAMPLE_RATE && Number.isSafeInteger(operation.channelCount)
			&& operation.channelCount! >= 1 && operation.channelCount! <= 8;
	return !!operation && operation.mediaKind === 'audio'
		&& (operation.direction === 'encode' || operation.direction === 'decode')
		&& operation.container === 'ogg' && operation.codec === 'vorbis' && operation.profile === null
		&& operation.sampleFormat === 'f32p' && operation.pixelFormat === null
		&& operation.width === null && operation.height === null && geometry;
}

function encodeProfileSupported(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
): boolean {
	return request.sampleRate >= MINIMUM_SAMPLE_RATE && request.sampleRate <= MAXIMUM_SAMPLE_RATE
		&& request.channelCount >= 1 && request.channelCount <= MAXIMUM_CHANNELS;
}

function validateFiniteFloat32(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) throw new VorbisPcmInputError();
	}
}

function supported(): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'supported', reason: null });
}

function unsupported(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'unsupported', reason });
}

function rejected(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'rejected', reason });
}

class VorbisRuntimeError extends Error {}
class VorbisCodecResultError extends Error {}
class VorbisOutputBoundError extends Error {}
class VorbisPcmInputError extends Error {}
class VorbisDecodeIntegrityError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled Vorbis desktop target is unsupported.');
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
	return new DOMException('The bundled Vorbis operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
