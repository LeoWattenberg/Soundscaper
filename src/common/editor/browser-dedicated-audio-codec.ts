/* SPDX-License-Identifier: AGPL-3.0-only */

/** Browser-safe adapters for the reviewed, file-producing audio codec payloads. */

import { assembleBundledWavPackChunks } from '../../../desktop/bundled-wavpack-stream.ts';
import {
	materializeBundledWavPackDecodeGroup,
	parseBundledWavPackStream,
} from '../../../desktop/bundled-wavpack-stream.ts';
import { parseBundledFlacStream } from '../../../desktop/bundled-flac-stream.ts';
import { parseBundledMpegAudioStream } from '../../../desktop/bundled-mpeg-audio-stream.ts';
import { parseBundledOpusStream } from '../../../desktop/bundled-opus-stream.ts';
import { parseBundledVorbisStream } from '../../../desktop/bundled-vorbis-stream.ts';
import { validateDedicatedAudioOutput } from './browser-dedicated-audio-output-validation.ts';

export type BrowserDedicatedAudioFormat =
	| 'flac'
	| 'mp3'
	| 'ogg-vorbis'
	| 'opus'
	| 'wavpack'
	| 'mp2';

export interface DedicatedAudioEncodeRequest {
	readonly format: BrowserDedicatedAudioFormat;
	readonly input: Uint8Array;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly settings: Readonly<Record<string, number>>;
	readonly maximumOutputBytes: number;
}

export interface DedicatedAudioCodecDependencies {
	readonly loadPayload?: (format: BrowserDedicatedAudioFormat, url: URL) => Promise<Uint8Array>;
}

export interface DedicatedAudioDecodeRequest {
	readonly format: BrowserDedicatedAudioFormat;
	readonly input: Uint8Array;
	readonly maximumOutputBytes: number;
}

export interface DedicatedAudioDecodeResult {
	readonly interleaved: Uint8Array<ArrayBuffer>;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

interface PayloadDescriptor {
	readonly url: URL;
	readonly byteLength: number;
	readonly sha256: string;
	readonly prefix: 'scfl' | 'sclm' | 'scvb' | 'scop' | 'scwp' | 'sctl' | 'scmp';
	/** Reviewed shim ABI; LAME moved to 2 when it gained its four bit-rate modes. */
	readonly abiVersion?: number;
}

interface ReviewedExports {
	readonly memory: WebAssembly.Memory;
	readonly allocate: (bytes: number) => number;
	readonly free: (pointer: number) => void;
	readonly invoke: (...arguments_: number[]) => number;
}

const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_WAVPACK_BLOCK_FRAMES = 65_536;
const MAXIMUM_WAVPACK_BLOCK_OVERHEAD_BYTES = 64 * 1024;
const MP3_BITRATES = new Set([32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const MP2_BITRATES = new Set([32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]);
const OPUS_BITRATES = new Set([16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 256]);
const MAXIMUM_MP3_VBR_QUALITY = 9;
const MAXIMUM_MP3_PRESET = 3;
const MAXIMUM_OPUS_VBR_MODE = 2;
const MP3_RATE_MODE_CONSTANT = 0;
const MP3_RATE_MODE_AVERAGE = 1;
const MP3_RATE_MODE_VARIABLE = 2;
const MP3_RATE_MODE_PRESET = 3;

const PAYLOADS: Readonly<Record<BrowserDedicatedAudioFormat, PayloadDescriptor>> = Object.freeze({
	flac: Object.freeze({
		url: new URL('./flac/flac.wasm', import.meta.url), byteLength: 153_076,
		sha256: '0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986', prefix: 'scfl',
	}),
	mp3: Object.freeze({
		url: new URL('./lame/lame.wasm', import.meta.url), byteLength: 213_293,
		sha256: 'd624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123',
		prefix: 'sclm', abiVersion: 2,
	}),
	'ogg-vorbis': Object.freeze({
		url: new URL('./vorbis/vorbis.wasm', import.meta.url), byteLength: 523_227,
		sha256: 'c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5', prefix: 'scvb',
	}),
	opus: Object.freeze({
		url: new URL('./opus/opus.wasm', import.meta.url), byteLength: 385_914,
		sha256: 'c972c5019a7f56dfe9c712cb15c25ebb54b55b16b19b3b99a5b02c31ef311685',
		prefix: 'scop', abiVersion: 2,
	}),
	wavpack: Object.freeze({
		url: new URL('./wavpack/wavpack.wasm', import.meta.url), byteLength: 145_537,
		sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908', prefix: 'scwp',
	}),
	mp2: Object.freeze({
		url: new URL('./twolame/twolame.wasm', import.meta.url), byteLength: 146_820,
		sha256: 'b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b', prefix: 'sctl',
	}),
});

const MPG123_PAYLOAD: PayloadDescriptor = Object.freeze({
	url: new URL('./mpg123/mpg123.wasm', import.meta.url), byteLength: 172_329,
	sha256: 'd2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae', prefix: 'scmp',
});

const ALLOWED_IMPORTS: Readonly<Record<string, (...arguments_: number[]) => number | void>> = Object.freeze({
	'env.abort': () => { throw new DedicatedAudioCodecError('The reviewed codec payload aborted.'); },
	'env.emscripten_notify_memory_growth': () => undefined,
	'wasi_snapshot_preview1.fd_close': () => 8,
	'wasi_snapshot_preview1.fd_read': () => 8,
	'wasi_snapshot_preview1.fd_seek': () => 8,
	'wasi_snapshot_preview1.fd_write': () => 8,
	'wasi_snapshot_preview1.proc_exit': (code: number) => {
		throw new DedicatedAudioCodecError(`The reviewed codec payload exited with code ${String(code)}.`);
	},
});

export class DedicatedAudioCodecError extends Error {
	readonly code = 'DEDICATED_AUDIO_CODEC_FAILED';

	constructor(message: string) {
		super(message);
		this.name = 'DedicatedAudioCodecError';
	}
}

/** Encode interleaved little-endian Float32 PCM into one complete media file. */
export async function encodeDedicatedAudioPcm(
	request: DedicatedAudioEncodeRequest,
	dependencies: DedicatedAudioCodecDependencies = {},
): Promise<Uint8Array<ArrayBuffer>> {
	const normalized = normalizeRequest(request);
	const descriptor = PAYLOADS[normalized.format];
	const payload = await (dependencies.loadPayload ?? fetchPayload)(normalized.format, descriptor.url);
	await verifyPayload(payload, descriptor);
	const module = await WebAssembly.compile(Uint8Array.from(payload).buffer);
	const instance = await WebAssembly.instantiate(module, importsFor(module));
	initialize(instance.exports, descriptor);
	const output = normalized.format === 'wavpack'
		? encodeWavPack(instance.exports, normalized)
		: encodeOneShot(instance.exports, descriptor, normalized);
	validateDedicatedAudioOutput(output, normalized);
	return output;
}

/** Decode a reviewed compressed file into interleaved little-endian Float32 PCM. */
export async function decodeDedicatedAudioFile(
	requestValue: DedicatedAudioDecodeRequest,
	dependencies: DedicatedAudioCodecDependencies = {},
): Promise<DedicatedAudioDecodeResult> {
	const request = normalizeDecodeRequest(requestValue);
	const descriptor = request.format === 'mp3' || request.format === 'mp2'
		? MPG123_PAYLOAD
		: PAYLOADS[request.format];
	const payload = await (dependencies.loadPayload ?? fetchPayload)(request.format, descriptor.url);
	await verifyPayload(payload, descriptor);
	const module = await WebAssembly.compile(Uint8Array.from(payload).buffer);
	const instance = await WebAssembly.instantiate(module, importsFor(module));
	initialize(instance.exports, descriptor);
	const wavPackGeometry = request.format === 'wavpack'
		? parseBundledWavPackStream(request.input)
		: null;
	const geometry = wavPackGeometry ?? decodeGeometry(request);
	const outputBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > request.maximumOutputBytes) {
		throw new RangeError('The dedicated decoded PCM exceeds its requested byte bound.');
	}
	const interleaved = wavPackGeometry !== null
		? decodeWavPack(instance.exports, request.input, wavPackGeometry, outputBytes)
		: decodeOneShot(instance.exports, descriptor, request, geometry, outputBytes);
	validateFinitePcm(interleaved);
	return Object.freeze({ interleaved, ...geometry });
}

function normalizeDecodeRequest(request: DedicatedAudioDecodeRequest): DedicatedAudioDecodeRequest {
	if (!request || typeof request !== 'object' || !(request.input instanceof Uint8Array)
		|| !Object.hasOwn(PAYLOADS, request.format)) {
		throw new TypeError('A dedicated compressed-audio decode request is required.');
	}
	if (request.input.byteLength < 1 || request.input.byteLength > 32 * 1024 * 1024) {
		throw new RangeError('The dedicated compressed-audio input exceeds 32 MiB.');
	}
	const maximumOutputBytes = positiveInteger(request.maximumOutputBytes, 'maximum output bytes');
	if (maximumOutputBytes > MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The dedicated decoded PCM bound exceeds 128 MiB.');
	}
	return Object.freeze({
		format: request.format,
		input: Uint8Array.from(request.input),
		maximumOutputBytes,
	});
}

function decodeGeometry(request: DedicatedAudioDecodeRequest): Readonly<{
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}> {
	switch (request.format) {
		case 'flac': return parseBundledFlacStream(request.input);
		case 'opus': return parseBundledOpusStream(request.input);
		case 'ogg-vorbis': return parseBundledVorbisStream(request.input);
		case 'wavpack': return parseBundledWavPackStream(request.input);
		case 'mp3': return parseBundledMpegAudioStream(request.input, 'mp3');
		case 'mp2': return parseBundledMpegAudioStream(request.input, 'mp2');
	}
}

function decodeOneShot(
	exportsValue: WebAssembly.Exports,
	descriptor: PayloadDescriptor,
	request: DedicatedAudioDecodeRequest,
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	outputBytes: number,
): Uint8Array<ArrayBuffer> {
	const reviewed = reviewedExports(exportsValue, descriptor, 'decode_float32');
	if (request.format === 'flac') {
		return invokeFixed(reviewed, request.input, outputBytes, outputBytes, (input, output) => (
			reviewed.invoke(
				input, request.input.byteLength, geometry.frameCount, geometry.channelCount,
				geometry.sampleRate, output, outputBytes,
			)
		));
	}
	const invokeDecode = (input: number, output: number): number => {
		if (request.format === 'mp3' || request.format === 'mp2') {
			return reviewed.invoke(
				input, request.input.byteLength, geometry.frameCount, geometry.sampleRate,
				geometry.channelCount, output, outputBytes,
			);
		}
		if (request.format === 'opus') {
			return reviewed.invoke(
				input, request.input.byteLength, geometry.frameCount, geometry.channelCount,
				output, outputBytes,
			);
		}
		return reviewed.invoke(
			input, request.input.byteLength, geometry.frameCount, geometry.channelCount,
			geometry.sampleRate, output, outputBytes,
		);
	};
	return invokeFixed(reviewed, request.input, outputBytes, geometry.frameCount, invokeDecode);
}

function decodeWavPack(
	exportsValue: WebAssembly.Exports,
	input: Uint8Array,
	geometry: ReturnType<typeof parseBundledWavPackStream>,
	outputBytes: number,
): Uint8Array<ArrayBuffer> {
	const reviewed = reviewedExports(exportsValue, PAYLOADS.wavpack, 'decode_float32');
	const output = new Uint8Array(outputBytes);
	for (const group of geometry.groups) {
		const encoded = materializeBundledWavPackDecodeGroup(input, group);
		const chunkBytes = group.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const planar = invoke(reviewed, encoded, chunkBytes, chunkBytes, (inputPointer, outputPointer) => (
			reviewed.invoke(
				inputPointer, encoded.byteLength, group.frameCount, geometry.channelCount,
				geometry.sampleRate, outputPointer, chunkBytes,
			)
		));
		interleavePlanar(planar, output, group.blockIndex, group.frameCount, geometry.channelCount);
	}
	return output;
}

function invokeFixed(
	reviewed: ReviewedExports,
	input: Uint8Array,
	outputBytes: number,
	expectedResult: number,
	operation: (inputPointer: number, outputPointer: number) => number,
): Uint8Array<ArrayBuffer> {
	const inputPointer = allocate(reviewed, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(reviewed, outputBytes);
		new Uint8Array(reviewed.memory.buffer, inputPointer, input.byteLength).set(input);
		if (operation(inputPointer, outputPointer) !== expectedResult) {
			throw new DedicatedAudioCodecError('The reviewed decoder returned incomplete PCM.');
		}
		return Uint8Array.from(new Uint8Array(reviewed.memory.buffer, outputPointer, outputBytes));
	} finally {
		if (outputPointer !== 0) reviewed.free(outputPointer);
		reviewed.free(inputPointer);
	}
}

function normalizeRequest(request: DedicatedAudioEncodeRequest): DedicatedAudioEncodeRequest {
	if (!request || typeof request !== 'object' || !(request.input instanceof Uint8Array)) {
		throw new TypeError('A dedicated audio encode request with Uint8Array PCM is required.');
	}
	if (!Object.hasOwn(PAYLOADS, request.format)) throw new RangeError('The dedicated audio format is unsupported.');
	const frameCount = positiveInteger(request.frameCount, 'frame count');
	const channelCount = positiveInteger(request.channelCount, 'channel count');
	const sampleRate = positiveInteger(request.sampleRate, 'sample rate');
	const maximumOutputBytes = positiveInteger(request.maximumOutputBytes, 'maximum output bytes');
	if (maximumOutputBytes > MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The dedicated audio output bound exceeds 128 MiB.');
	}
	if (request.input.byteLength !== frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT) {
		throw new RangeError('The dedicated audio PCM geometry is inconsistent.');
	}
	if (request.input.byteLength < 1 || request.input.byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The dedicated audio PCM exceeds its bounded input.');
	}
	if (!request.settings || typeof request.settings !== 'object' || Array.isArray(request.settings)) {
		throw new TypeError('Dedicated audio codec settings must be a record.');
	}
	validateFinitePcm(request.input);
	validateProfile(request.format, { frameCount, channelCount, sampleRate }, request.settings);
	return Object.freeze({
		format: request.format,
		input: Uint8Array.from(request.input),
		frameCount,
		channelCount,
		sampleRate,
		settings: Object.freeze({ ...request.settings }),
		maximumOutputBytes,
	});
}

function validateProfile(
	format: BrowserDedicatedAudioFormat,
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	settings: Readonly<Record<string, number>>,
): void {
	if (geometry.sampleRate < 8_000 || geometry.sampleRate > 192_000) {
		throw new RangeError('The dedicated codec sample rate must be between 8 and 192 kHz.');
	}
	if (geometry.channelCount > (format === 'mp3' || format === 'mp2' || format === 'opus'
		|| format === 'ogg-vorbis' ? 2 : 8)) {
		throw new RangeError(`The dedicated ${format} profile does not admit this channel count.`);
	}
	if ((format === 'mp3' || format === 'mp2')
		&& ![32_000, 44_100, 48_000].includes(geometry.sampleRate)) {
		throw new RangeError(`The dedicated ${format} profile requires 32, 44.1, or 48 kHz PCM.`);
	}
	if (format === 'opus' && geometry.sampleRate !== 48_000) {
		throw new RangeError('The dedicated Opus profile requires 48 kHz PCM.');
	}
	const maximumFrames = format === 'mp3' || format === 'mp2' ? 8_388_608 : 33_554_432;
	if (geometry.frameCount > maximumFrames) throw new RangeError(`The dedicated ${format} frame bound was exceeded.`);
	if (format === 'flac') exactIntegerSetting(settings, 'compressionLevel', 0, 8);
	else if (format === 'ogg-vorbis') exactIntegerSetting(settings, 'quality', 0, 10);
	else if (format === 'wavpack') exactIntegerSetting(settings, 'compressionLevel', 2, 2);
	else if (format === 'opus') validateOpusProfile(settings);
	else if (format === 'mp3') validateMp3Profile(geometry, settings);
	else {
		const bitrate = exactIntegerSetting(settings, 'bitrateKbps', 32, 384);
		admittedBitrate(bitrate, MP2_BITRATES, format);
		if (geometry.channelCount === 1 ? bitrate > 192 : bitrate < 64 || bitrate === 80) {
			throw new RangeError('The dedicated MP2 bitrate is outside its admitted channel tuple.');
		}
	}
}

function encodeOneShot(
	exportsValue: WebAssembly.Exports,
	descriptor: PayloadDescriptor,
	request: DedicatedAudioEncodeRequest,
): Uint8Array<ArrayBuffer> {
	const reviewed = reviewedExports(exportsValue, descriptor, `encode_float32`);
	const capacity = request.format === 'mp3'
		? Math.max(request.maximumOutputBytes, 7_200)
		: request.maximumOutputBytes;
	const arguments_ = encodeArguments(request);
	return invoke(reviewed, request.input, capacity, request.maximumOutputBytes, (input, output) => (
		reviewed.invoke(input, ...arguments_, output, capacity)
	));
}

function encodeArguments(request: DedicatedAudioEncodeRequest): number[] {
	const common = [request.frameCount, request.channelCount];
	switch (request.format) {
		case 'flac': return [...common, request.sampleRate, request.settings.compressionLevel!];
		case 'mp3': return [...common, request.sampleRate, ...mp3RateArguments(request.settings)];
		case 'ogg-vorbis': return [...common, request.sampleRate, request.settings.quality!];
		case 'opus': return [...common, request.settings.bitrateKbps! * 1_000, request.settings.vbrMode!];
		case 'mp2': return [...common, request.sampleRate, request.settings.bitrateKbps!];
		case 'wavpack': throw new Error('WavPack uses its bounded chunk encoder.');
	}
}

function encodeWavPack(
	exportsValue: WebAssembly.Exports,
	request: DedicatedAudioEncodeRequest,
): Uint8Array<ArrayBuffer> {
	const descriptor = PAYLOADS.wavpack;
	const reviewed = reviewedExports(exportsValue, descriptor, 'encode_float32');
	const chunks: Uint8Array[] = [];
	for (let frameOffset = 0; frameOffset < request.frameCount;) {
		const frames = Math.min(MAXIMUM_WAVPACK_BLOCK_FRAMES, request.frameCount - frameOffset);
		const input = planarChunk(request.input, frameOffset, frames, request.channelCount);
		const capacity = Math.min(
			input.byteLength * 2 + MAXIMUM_WAVPACK_BLOCK_OVERHEAD_BYTES,
			request.maximumOutputBytes + MAXIMUM_WAVPACK_BLOCK_OVERHEAD_BYTES,
		);
		chunks.push(invoke(reviewed, input, capacity, capacity, (inputPointer, outputPointer) => (
			reviewed.invoke(
				inputPointer, frames, request.channelCount, request.sampleRate, outputPointer, capacity,
			)
		)));
		frameOffset += frames;
	}
	return Uint8Array.from(assembleBundledWavPackChunks({
		chunks,
		sampleRate: request.sampleRate,
		channelCount: request.channelCount,
		frameCount: request.frameCount,
		maximumOutputBytes: request.maximumOutputBytes,
	}));
}

function reviewedExports(
	exportsValue: WebAssembly.Exports,
	descriptor: PayloadDescriptor,
	operation: string,
): ReviewedExports {
	const memory = exportsValue.memory;
	if (!(memory instanceof WebAssembly.Memory)) throw new DedicatedAudioCodecError('Codec memory is unavailable.');
	const allocate = exportedFunction(exportsValue, `${descriptor.prefix}_allocate`);
	const free = exportedFunction(exportsValue, `${descriptor.prefix}_free`);
	const invoke = exportedFunction(exportsValue, `${descriptor.prefix}_${operation}`);
	return Object.freeze({ memory, allocate, free, invoke });
}

function invoke(
	reviewed: ReviewedExports,
	input: Uint8Array,
	outputCapacity: number,
	maximumResultBytes: number,
	operation: (inputPointer: number, outputPointer: number) => number,
): Uint8Array<ArrayBuffer> {
	const inputPointer = allocate(reviewed, input.byteLength);
	let outputPointer = 0;
	try {
		outputPointer = allocate(reviewed, outputCapacity);
		new Uint8Array(reviewed.memory.buffer, inputPointer, input.byteLength).set(input);
		const result = operation(inputPointer, outputPointer);
		if (!Number.isSafeInteger(result) || result <= 0 || result > outputCapacity
			|| result > maximumResultBytes) {
			throw new DedicatedAudioCodecError('The reviewed codec exceeded its output bound.');
		}
		return Uint8Array.from(new Uint8Array(reviewed.memory.buffer, outputPointer, result));
	} finally {
		if (outputPointer !== 0) reviewed.free(outputPointer);
		reviewed.free(inputPointer);
	}
}

function allocate(reviewed: ReviewedExports, byteLength: number): number {
	const pointer = reviewed.allocate(byteLength);
	if (!Number.isSafeInteger(pointer) || pointer <= 0
		|| pointer + byteLength > reviewed.memory.buffer.byteLength) {
		if (Number.isSafeInteger(pointer) && pointer > 0) reviewed.free(pointer);
		throw new DedicatedAudioCodecError('The reviewed codec exceeded its linear-memory bound.');
	}
	return pointer;
}

function initialize(exportsValue: WebAssembly.Exports, descriptor: PayloadDescriptor): void {
	exportedFunction(exportsValue, '_initialize')();
	const abi = exportedFunction(exportsValue, `${descriptor.prefix}_abi_version`)();
	if (abi !== (descriptor.abiVersion ?? 1)) {
		throw new DedicatedAudioCodecError('The reviewed codec reports an unexpected ABI version.');
	}
}

function exportedFunction(exportsValue: WebAssembly.Exports, name: string): (...arguments_: number[]) => number {
	const value = exportsValue[name] ?? exportsValue[`_${name}`];
	if (typeof value !== 'function') throw new DedicatedAudioCodecError(`Codec export ${name} is unavailable.`);
	return value as (...arguments_: number[]) => number;
}

function importsFor(module: WebAssembly.Module): WebAssembly.Imports {
	const imports: Record<string, Record<string, (...arguments_: number[]) => number | void>> = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = ALLOWED_IMPORTS[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw new DedicatedAudioCodecError(`The reviewed codec imports forbidden authority ${key}.`);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	return imports;
}

async function fetchPayload(_format: BrowserDedicatedAudioFormat, url: URL): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new DedicatedAudioCodecError(`Codec payload request failed (${String(response.status)}).`);
	return new Uint8Array(await response.arrayBuffer());
}

async function verifyPayload(payload: Uint8Array, descriptor: PayloadDescriptor): Promise<void> {
	if (!(payload instanceof Uint8Array) || payload.byteLength !== descriptor.byteLength) {
		throw new DedicatedAudioCodecError('The reviewed codec payload has an unexpected byte length.');
	}
	if (!globalThis.crypto?.subtle) throw new DedicatedAudioCodecError('Payload verification is unavailable.');
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(payload).buffer));
	const actual = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
	if (actual !== descriptor.sha256) throw new DedicatedAudioCodecError('The reviewed codec payload digest is invalid.');
}

function planarChunk(
	input: Uint8Array,
	frameOffset: number,
	frameCount: number,
	channelCount: number,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT);
	const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
	const target = new DataView(output.buffer);
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			target.setUint32(
				(channel * frameCount + frame) * 4,
				source.getUint32(((frameOffset + frame) * channelCount + channel) * 4, true),
				true,
			);
		}
	}
	return output;
}

function interleavePlanar(
	input: Uint8Array,
	output: Uint8Array,
	frameOffset: number,
	frameCount: number,
	channelCount: number,
): void {
	if (input.byteLength !== frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT) {
		throw new DedicatedAudioCodecError('The WavPack decoder returned invalid planar PCM geometry.');
	}
	const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
	const target = new DataView(output.buffer, output.byteOffset, output.byteLength);
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			target.setUint32(
				((frameOffset + frame) * channelCount + channel) * 4,
				source.getUint32((channel * frameCount + frame) * 4, true),
				true,
			);
		}
	}
}

function validateFinitePcm(input: Uint8Array): void {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset < input.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		if (!Number.isFinite(view.getFloat32(offset, true))) {
			throw new RangeError('Dedicated audio PCM must contain only finite samples.');
		}
	}
}

/**
 * Opus carries a bitrate and Audacity's VBR Mode, which selects a constant rate,
 * an unconstrained variable rate, or a variable rate held inside the target.
 */
function validateOpusProfile(settings: Readonly<Record<string, number>>): void {
	exactIntegerSettings(settings, ['bitrateKbps', 'vbrMode'], 'opus');
	if (!Number.isSafeInteger(settings.vbrMode)
		|| settings.vbrMode! < 0 || settings.vbrMode! > MAXIMUM_OPUS_VBR_MODE) {
		throw new RangeError('Dedicated audio setting vbrMode is outside its profile.');
	}
	if (!Number.isSafeInteger(settings.bitrateKbps)
		|| settings.bitrateKbps! < 16 || settings.bitrateKbps! > 256) {
		throw new RangeError('Dedicated audio setting bitrateKbps is outside its profile.');
	}
	admittedBitrate(settings.bitrateKbps!, OPUS_BITRATES, 'opus');
}

/**
 * MP3 admits one bit-rate strategy per request, named by the request's only
 * setting key. The four strategies are Audacity's: `preset` selects a named
 * LAME preset 0 (Excessive) through 3 (Medium), `vbrQuality` LAME's variable
 * rate at quality 0 (best) through 9, `averageBitrateKbps` its average rate,
 * and `bitrateKbps` its constant rate. `exactIntegerSetting` rejects a request
 * that names more than one.
 */
function validateMp3Profile(
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	settings: Readonly<Record<string, number>>,
): void {
	if (Object.hasOwn(settings, 'preset')) {
		exactIntegerSetting(settings, 'preset', 0, MAXIMUM_MP3_PRESET);
		return;
	}
	if (Object.hasOwn(settings, 'vbrQuality')) {
		exactIntegerSetting(settings, 'vbrQuality', 0, MAXIMUM_MP3_VBR_QUALITY);
		return;
	}
	const key = Object.hasOwn(settings, 'averageBitrateKbps') ? 'averageBitrateKbps' : 'bitrateKbps';
	const bitrate = exactIntegerSetting(settings, key, 32, 320);
	admittedBitrate(bitrate, MP3_BITRATES, 'mp3');
	const minimum = geometry.sampleRate === 32_000
		? geometry.channelCount === 1 ? 40 : 48
		: geometry.sampleRate === 44_100 && geometry.channelCount === 1 ? 56 : 64;
	if (bitrate < minimum) throw new RangeError('The dedicated MP3 bitrate is outside its admitted tuple.');
}

/** Marshal the chosen strategy into the payload's rate-mode, rate-value pair. */
function mp3RateArguments(settings: Readonly<Record<string, number>>): number[] {
	if (Object.hasOwn(settings, 'preset')) return [MP3_RATE_MODE_PRESET, settings.preset!];
	if (Object.hasOwn(settings, 'vbrQuality')) return [MP3_RATE_MODE_VARIABLE, settings.vbrQuality!];
	if (Object.hasOwn(settings, 'averageBitrateKbps')) {
		return [MP3_RATE_MODE_AVERAGE, settings.averageBitrateKbps!];
	}
	return [MP3_RATE_MODE_CONSTANT, settings.bitrateKbps!];
}

function exactIntegerSetting(
	settings: Readonly<Record<string, number>>,
	key: string,
	minimum: number,
	maximum: number,
): number {
	const keys = Reflect.ownKeys(settings);
	const descriptor = Object.getOwnPropertyDescriptor(settings, key);
	const value = descriptor?.value;
	if (keys.length !== 1 || keys[0] !== key || descriptor === undefined
		|| !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(value)
		|| Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`Dedicated audio setting ${key} is outside its profile.`);
	}
	return Number(value);
}

/** A request states exactly the settings its profile names, and nothing else. */
function exactIntegerSettings(
	settings: Readonly<Record<string, number>>,
	keys: readonly string[],
	format: string,
): void {
	const own = Reflect.ownKeys(settings);
	if (own.length !== keys.length || keys.some((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(settings, key);
		return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
	})) throw new RangeError(`Dedicated ${format} settings are outside their profile.`);
}

function admittedBitrate(
	bitrate: number,
	admitted: ReadonlySet<number>,
	format: BrowserDedicatedAudioFormat,
): void {
	if (!admitted.has(bitrate)) throw new RangeError(`The dedicated ${format} bitrate is unsupported.`);
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Dedicated audio ${label} must be a positive integer.`);
	}
	return value;
}
