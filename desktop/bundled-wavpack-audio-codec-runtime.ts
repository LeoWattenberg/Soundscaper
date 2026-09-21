/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process runtime for the exact reviewed WavPack 5.9.0 WebAssembly payload. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import { BUNDLED_AUDIO_CODEC_IDENTITIES, createBundledAudioCodecProvider } from './bundled-audio-codec-identity.ts';
import {
	assembleBundledWavPackChunks,
	BundledWavPackStreamError,
	inspectBundledWavPackStream,
	materializeBundledWavPackDecodeGroup,
	parseBundledWavPackStream,
} from './bundled-wavpack-stream.ts';
import {
	assertDesktopAudioCodecRequest,
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
import { DESKTOP_BUNDLED_WAVPACK_COMPRESSION_LEVEL } from '../src/common/editor/desktop-wavpack-codec-profile.ts';
import {
	interleavePlanarFloat32Chunk,
	planarFloat32Chunk,
} from '../src/common/editor/wavpack-float32-chunk-layout.ts';
import { loadWavPackWasm } from '../src/common/editor/wavpack/runtime.js';

export const BUNDLED_WAVPACK_VERSION = BUNDLED_AUDIO_CODEC_IDENTITIES.wavpack.version;
export const BUNDLED_WAVPACK_WASM_BYTE_LENGTH = 148_868;
export const BUNDLED_WAVPACK_WASM_SHA256 = BUNDLED_AUDIO_CODEC_IDENTITIES.wavpack.wasmSha256;
// The reviewed ABI fixes libwavpack at CONFIG_FAST_FLAG. Soundscaper's existing
// WavPack default (level 2) is the sole explicit product mapping to that mode.
export const BUNDLED_WAVPACK_COMPRESSION_LEVEL = DESKTOP_BUNDLED_WAVPACK_COMPRESSION_LEVEL;
export const BUNDLED_WAVPACK_WASM_URL = new URL(
	'../src/common/editor/wavpack/wavpack.wasm', import.meta.url,
);

const MAXIMUM_BLOCK_FRAMES = 65_536;
const MAXIMUM_BLOCK_OVERHEAD_BYTES = 64 * 1024;
const MAXIMUM_SAMPLE_RATE = 192_000;
const MAXIMUM_CHANNEL_COUNT = 8;
const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);

interface WavPackExports {
	readonly memory: WebAssembly.Memory;
	readonly scwp_allocate: (bytes: number) => number;
	readonly scwp_free: (pointer: number) => void;
	readonly scwp_encode_float32: (
		input: number, frames: number, channels: number, sampleRate: number,
		output: number, outputCapacity: number,
	) => number;
	readonly scwp_decode_float32: (
		input: number, inputBytes: number, frames: number, channels: number,
		sampleRate: number, output: number, outputBytes: number,
	) => number;
}

interface ReviewedWavPackRuntime {
	readonly memory: WebAssembly.Memory;
	readonly exports: WavPackExports;
}

export interface BundledWavPackRuntimeLoadOptions {
	readonly target: DesktopCodecTarget;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadBundledWavPackAudioCodecRuntime(
	options: BundledWavPackRuntimeLoadOptions,
): Promise<DesktopAudioCodecProviderRuntime | null> {
	const target = desktopTarget(options?.target);
	if (options.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError('The bundled WavPack payload reader is invalid.');
	}
	if (options.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError('The bundled WavPack scheduler is invalid.');
	}
	try {
		const source = await (options.readPayload ?? readReviewedPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== BUNDLED_WAVPACK_WASM_BYTE_LENGTH
			|| sha256(source) !== BUNDLED_WAVPACK_WASM_SHA256) return null;
		const loadReviewedWasm = loadWavPackWasm as unknown as (
			value: Uint8Array,
		) => Promise<ReviewedWavPackRuntime>;
		const loaded = await loadReviewedWasm(source);
		const codec = wasmCodec(loaded);
		verifyCanary(codec);
		return createRuntime(target, codec, options.yieldControl ?? yieldToMainLoop);
	} catch {
		return null;
	}
}

async function readReviewedPayload(): Promise<Uint8Array> {
	return await readFile(BUNDLED_WAVPACK_WASM_URL);
}

function createRuntime(
	target: DesktopCodecTarget,
	codec: WavPackCodec,
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
			try {
				assertDesktopAudioCodecRequest(requestValue);
				request = requestValue;
			}
			catch {
				return Object.freeze({ disposition: 'rejected', reason: 'The WavPack request is invalid.' });
			}
			const direction = request.operation === 'audio-encode' ? 'encode' : 'decode';
			if (request.format !== 'wavpack' || direction !== options?.operation?.direction
				|| !supportedOperation(options.operation)) {
				return Object.freeze({
					disposition: 'rejected', reason: 'The WavPack request does not match its admitted operation.',
				});
			}
			if (request.operation === 'audio-encode') return request.settings.compressionLevel
				=== BUNDLED_WAVPACK_COMPRESSION_LEVEL
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({
					disposition: 'unsupported',
					reason: 'The bundled WavPack provider supports only compression level 2 (reviewed fast mode).',
				});
			const inspection = inspectBundledWavPackStream(request.input);
			if (inspection.disposition === 'rejected') return Object.freeze({
				disposition: 'rejected',
				reason: 'The WavPack input failed bounded structural or checksum validation.',
			});
			if (inspection.disposition === 'unsupported') return Object.freeze({
				disposition: 'unsupported',
				reason: 'The WavPack input uses a valid profile outside the reviewed float32 checksum surface.',
			});
			return Object.freeze({ disposition: 'supported', reason: null });
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return failed('security-failed', 'The WavPack request failed main-process validation.'); }
			throwIfAborted(options?.signal);
			const preflight = await provider.preflight(options?.operation, Object.freeze({
				...(options?.signal ? { signal: options.signal } : {}),
			}));
			if (preflight.disposition !== 'supported' || request.format !== 'wavpack') {
				return failed('unavailable', 'The bundled WavPack provider does not support this exact operation.');
			}
			if (request.operation === 'audio-encode'
				&& request.settings.compressionLevel !== BUNDLED_WAVPACK_COMPRESSION_LEVEL) {
				return failed(
					'unavailable',
					'The bundled WavPack provider supports only compression level 2 (reviewed fast mode).',
				);
			}
			try {
				const executed = request.operation === 'audio-encode'
					? Object.freeze({
						status: 'executed' as const,
						output: await encode(request, codec, yieldControl, options.signal),
					})
					: Object.freeze({
						status: 'executed' as const,
						...await decode(request, codec, yieldControl, options.signal),
					});
				throwIfAborted(options.signal);
				return executed;
			} catch (error) {
				if (options.signal?.aborted || isAbortError(error)) throw abortReason(options.signal, error);
				if (error instanceof BundledWavPackStreamError) {
					return failed('security-failed', 'The WavPack input stream failed bounded validation.');
				}
				if (error instanceof WavPackOutputBoundError) {
					return failed('result-failed', error.message);
				}
				return failed('execution-failed', 'The reviewed WavPack payload could not complete the operation.');
			}
		},
	});
}

async function encode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-encode' }>,
	codec: WavPackCodec,
	yieldControl: () => Promise<void>,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const frameCount = request.input.byteLength / (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
	const chunks: Uint8Array[] = [];
	for (let frameOffset = 0; frameOffset < frameCount;) {
		throwIfAborted(signal);
		const frames = Math.min(MAXIMUM_BLOCK_FRAMES, frameCount - frameOffset);
		const planar = planarFloat32Chunk(request.input, frameOffset, frames, request.channelCount);
		const maximumChunkBytes = Math.min(
			planar.byteLength * 2 + MAXIMUM_BLOCK_OVERHEAD_BYTES,
			request.maximumOutputBytes + MAXIMUM_BLOCK_OVERHEAD_BYTES,
		);
		const encoded = codec.encode(planar, {
			frames, channelCount: request.channelCount, sampleRate: request.sampleRate,
			maximumOutputBytes: maximumChunkBytes,
		});
		chunks.push(encoded);
		frameOffset += frames;
		if (frameOffset < frameCount) await yieldControl();
	}
	throwIfAborted(signal);
	try {
		return assembleBundledWavPackChunks({
			chunks, sampleRate: request.sampleRate, channelCount: request.channelCount,
			frameCount, maximumOutputBytes: request.maximumOutputBytes,
		});
	} catch (error) {
		if (error instanceof RangeError && /output bound/iu.test(error.message)) {
			throw new WavPackOutputBoundError('The encoded WavPack stream exceeds the requested output bound.');
		}
		throw error;
	}
}

async function decode(
	request: Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-decode' }>,
	codec: WavPackCodec,
	yieldControl: () => Promise<void>,
	signal?: AbortSignal,
): Promise<Readonly<{
	readonly output: Uint8Array;
	readonly decodedGeometry: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}>> {
	const geometry = parseBundledWavPackStream(request.input);
	const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maximumOutputBytes) {
		throw new WavPackOutputBoundError('The decoded WavPack PCM exceeds the requested output bound.');
	}
	const output = new Uint8Array(outputBytes);
	for (let index = 0; index < geometry.groups.length; index += 1) {
		throwIfAborted(signal);
		const group = geometry.groups[index]!;
		const encoded = materializeBundledWavPackDecodeGroup(request.input, group);
		const planar = codec.decode(encoded, {
			frames: group.frameCount, channelCount: geometry.channelCount,
			sampleRate: geometry.sampleRate,
		});
		interleavePlanarFloat32Chunk(
			planar,
			output,
			group.blockIndex,
			group.frameCount,
			geometry.channelCount,
			() => new Error('The WavPack decoder returned invalid planar PCM geometry.'),
		);
		if (index + 1 < geometry.groups.length) await yieldControl();
	}
	throwIfAborted(signal);
	return Object.freeze({
		output,
		decodedGeometry: Object.freeze({
			sampleRate: geometry.sampleRate, channelCount: geometry.channelCount,
			frameCount: geometry.frameCount,
		}),
	});
}

interface WavPackCodec {
	encode(input: Uint8Array, geometry: Readonly<{
		readonly frames: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly maximumOutputBytes: number;
	}>): Uint8Array;
	decode(input: Uint8Array, geometry: Readonly<{
		readonly frames: number;
		readonly channelCount: number;
		readonly sampleRate: number;
	}>): Uint8Array;
}

function wasmCodec(runtime: ReviewedWavPackRuntime): WavPackCodec {
	if (!(runtime?.memory instanceof WebAssembly.Memory) || runtime.exports?.memory !== runtime.memory
		|| typeof runtime.exports.scwp_allocate !== 'function'
		|| typeof runtime.exports.scwp_free !== 'function'
		|| typeof runtime.exports.scwp_encode_float32 !== 'function'
		|| typeof runtime.exports.scwp_decode_float32 !== 'function') {
		throw new TypeError('The reviewed WavPack ABI is unavailable.');
	}
	const codec: WavPackCodec = {
		encode(input, geometry) {
			return invokeCodec(runtime, input, geometry.maximumOutputBytes, (inputPointer, outputPointer) => (
				runtime.exports.scwp_encode_float32(
					inputPointer, geometry.frames, geometry.channelCount, geometry.sampleRate,
					outputPointer, geometry.maximumOutputBytes,
				)
			));
		},
		decode(input, geometry) {
			const outputBytes = geometry.frames * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
			const output = invokeCodec(runtime, input, outputBytes, (inputPointer, outputPointer) => (
				runtime.exports.scwp_decode_float32(
					inputPointer, input.byteLength, geometry.frames, geometry.channelCount,
					geometry.sampleRate, outputPointer, outputBytes,
				)
			));
			if (output.byteLength !== outputBytes) throw new Error('WavPack returned incomplete decoded PCM.');
			return output;
		},
	};
	return Object.freeze(codec);
}

function invokeCodec(
	runtime: ReviewedWavPackRuntime,
	input: Uint8Array,
	outputCapacity: number,
	invoke: (inputPointer: number, outputPointer: number) => number,
): Uint8Array {
	if (!(input instanceof Uint8Array) || input.byteLength < 1
		|| !Number.isSafeInteger(outputCapacity) || outputCapacity < 1 || outputCapacity > 128 * 1024 * 1024) {
		throw new RangeError('The WavPack ABI buffer bounds are invalid.');
	}
	const inputPointer = allocate(runtime, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(runtime, outputCapacity);
		new Uint8Array(runtime.memory.buffer, inputPointer, input.byteLength).set(input);
		const result = invoke(inputPointer, outputPointer);
		if (result <= 0 || result > outputCapacity) throw new Error(`WavPack ABI failure ${String(result)}.`);
		return Uint8Array.from(new Uint8Array(runtime.memory.buffer, outputPointer, result));
	} finally {
		if (outputPointer !== 0) runtime.exports.scwp_free(outputPointer);
		runtime.exports.scwp_free(inputPointer);
	}
}

function allocate(runtime: ReviewedWavPackRuntime, byteLength: number): number {
	const pointer = runtime.exports.scwp_allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + byteLength > runtime.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) runtime.exports.scwp_free(pointer);
		throw new Error('The WavPack ABI allocation failed.');
	}
	return pointer;
}

function bundledProvider(target: DesktopCodecTarget): DesktopCodecProvider {
	return createBundledAudioCodecProvider('wavpack', target, {
		matches: supportedOperation,
		unsupportedReason: 'The bundled WavPack payload supports only bounded float32 WavPack audio.',
		throwIfAborted,
	});
}

function supportedOperation(operation: DesktopCodecOperation): boolean {
	const resolvedGeometry = Number.isSafeInteger(operation.sampleRate) && operation.sampleRate! >= 8_000
		&& operation.sampleRate! <= MAXIMUM_SAMPLE_RATE
		&& Number.isSafeInteger(operation.channelCount) && operation.channelCount! >= 1
		&& operation.channelCount! <= MAXIMUM_CHANNEL_COUNT;
	const geometrySupported = resolvedGeometry || operation.direction === 'decode'
		&& operation.sampleRate === null && operation.channelCount === null;
	return !!operation && operation.mediaKind === 'audio'
		&& (operation.direction === 'encode' || operation.direction === 'decode')
		&& operation.container === 'wavpack' && operation.codec === 'wavpack'
		&& operation.profile === null && operation.sampleFormat === 'f32'
		&& operation.pixelFormat === null && operation.width === null && operation.height === null
		&& geometrySupported;
}

function verifyCanary(codec: WavPackCodec): void {
	const frames = 64;
	const source = new Uint8Array(frames * 2 * Float32Array.BYTES_PER_ELEMENT);
	const encoded = codec.encode(source, {
		frames, channelCount: 2, sampleRate: 48_000,
		maximumOutputBytes: source.byteLength * 2 + MAXIMUM_BLOCK_OVERHEAD_BYTES,
	});
	const geometry = parseBundledWavPackStream(encoded);
	if (geometry.frameCount !== frames || geometry.channelCount !== 2 || geometry.sampleRate !== 48_000
		|| codec.decode(encoded, { frames, channelCount: 2, sampleRate: 48_000 }).some((byte) => byte !== 0)) {
		throw new Error('The reviewed WavPack payload failed its startup canary.');
	}
}

class WavPackOutputBoundError extends Error {}

function failed(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled WavPack desktop target is unsupported.');
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
	return new DOMException('The bundled WavPack operation was cancelled.', 'AbortError');
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

async function yieldToMainLoop(): Promise<void> {
	await waitImmediate();
}
