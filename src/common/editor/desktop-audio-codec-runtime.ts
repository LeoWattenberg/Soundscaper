/* SPDX-License-Identifier: AGPL-3.0-only */
/** Renderer adapter for the pathless, main-owned desktop audio codec bridge. */
import {
	DESKTOP_AUDIO_CODEC_FORMATS, DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES,
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT, DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
	normalizeDesktopAudioCodecRequest, normalizeDesktopAudioCodecResult,
	type DesktopAudioCodecFormat, type DesktopAudioCodecRequest, type DesktopAudioCodecResult,
} from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import {
	normalizeDesktopAudioCodecCapabilityQuery, normalizeDesktopAudioCodecCapabilityResult, type DesktopAudioCodecCapabilityQuery,
	type DesktopAudioCodecCapabilityResult, type DesktopAudioCodecCapabilityTuple,
} from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import {
	createDesktopAudioCodecCapabilityQuery, desktopAudioCodecCapabilityReason,
	desktopAudioCodecMediaExportCapabilities, queryDesktopAudioCodecCapability,
	type DesktopAudioCodecCapabilities,
} from './desktop-audio-codec-capabilities.ts';
import {
	assertDesktopAudioCodecResultCorrelation, projectDesktopAudioDecodeResult,
	type DesktopAudioCodecDecodedResult,
} from './desktop-audio-codec-result.ts';
import {
	applyMediaChannelMapping, canonicalMediaExportFormat, createMediaExportCapabilities,
	normalizeMediaExportSettings,
} from './media-export.js';
import {
	FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES, abortFfmpegOutputSink,
	assertFfmpegOutputReady, streamFfmpegOutputFile, type FfmpegOutputSink,
} from './ffmpeg-output-stream.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from './desktop-main-audio-codec-runtime-marker.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import type { WavPcmDescriptor } from './wav-pcm-chunk-reader.ts';
export interface DesktopAudioCodecRendererBridge {
	capabilities(query: DesktopAudioCodecCapabilityQuery): unknown | Promise<unknown>;
	execute(request: DesktopAudioCodecRequest): unknown | Promise<unknown>;
	cancel(requestId: string): unknown | Promise<unknown>;
}
type DesktopAudioCodecLegacyRendererBridge = Pick<DesktopAudioCodecRendererBridge, 'execute' | 'cancel'>;
export interface DesktopAudioCodecRuntimeSettings {
	readonly format?: string; readonly backend?: string; readonly extension?: string; readonly mimeType?: string;
	readonly capabilities?: unknown; readonly sampleRate?: number; readonly inputChannelCount?: number; readonly channelCount?: number;
	readonly channelMapping?: unknown;
	readonly sampleFormat?: string; readonly bitDepth?: number;
	readonly floatingPoint?: boolean;
	readonly dither?: unknown;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly compressionLevel?: number; readonly quality?: number; readonly bitRate?: number;
	readonly applyDither?: boolean;
	readonly maximumOutputBytes?: number; readonly maximumOutputChunkBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface DesktopAudioCodecEncodedResult {
	readonly bytes: Uint8Array; readonly extension: string; readonly mimeType: string;
}

export type { DesktopAudioCodecDecodedResult } from './desktop-audio-codec-result.ts';

export interface DesktopAudioCodecStreamResult<Output> {
	readonly output: Output; readonly byteLength: number; readonly chunkCount: number;
	readonly extension: string; readonly mimeType: string;
}

export interface DesktopAudioCodecRuntime {
	load(): Promise<DesktopAudioCodecRuntime>;
	encode(wav: Blob | ArrayBuffer | ArrayBufferView, format: string,
		settings?: DesktopAudioCodecRuntimeSettings): Promise<DesktopAudioCodecEncodedResult>;
	encodeFile(file: Blob, format: string,
		settings?: DesktopAudioCodecRuntimeSettings): Promise<DesktopAudioCodecEncodedResult>;
	encodeFileToSink<Output>(
		file: Blob, format: string, sink: FfmpegOutputSink<Output>, settings?: DesktopAudioCodecRuntimeSettings,
	): Promise<DesktopAudioCodecStreamResult<Output>>;
	decode(file: Blob | ArrayBuffer | ArrayBufferView,
		settings?: DesktopAudioCodecRuntimeSettings): Promise<DesktopAudioCodecDecodedResult>;
	encodeVideo(...arguments_: unknown[]): Promise<never>;
	encodeVideoToSink(...arguments_: unknown[]): Promise<never>;
	probeVideoTiming(...arguments_: unknown[]): Promise<never>;
	conformVideoToCfr(...arguments_: unknown[]): Promise<never>;
	runVideoKeyframeEncoderOperation(...arguments_: unknown[]): Promise<never>;
	runTrimMediaOperation(...arguments_: unknown[]): Promise<never>;
	runProxyMediaOperation(...arguments_: unknown[]): Promise<never>;
	dispose(): void; capabilities(): DesktopAudioCodecCapabilities;
	desktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery): Promise<DesktopAudioCodecCapabilityResult>;
	readonly [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true;
}

interface NormalizedMediaSettings {
	readonly extension: string; readonly mimeType: string; readonly sampleRate: number;
	readonly inputChannelCount: number; readonly channelCount: number;
	readonly channelMapping: unknown;
	readonly bitDepth: number | null;
	readonly compressionLevel?: number; readonly quality?: number; readonly bitRate?: number;
	readonly metadata: Readonly<Record<string, unknown>>;
}

interface ActiveRequest { cancel(reason: unknown): void; }

const FORMATS = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);
const ENCODE_SETTING_FIELDS = new Set<string>([
	'format', 'backend', 'extension', 'mimeType', 'capabilities', 'sampleRate',
	'inputChannelCount', 'channelCount', 'channelMapping',
	'sampleFormat', 'bitDepth', 'floatingPoint', 'dither', 'metadata',
	'compressionLevel', 'quality', 'bitRate', 'applyDither', 'maximumOutputBytes',
	'maximumOutputChunkBytes', 'signal', 'assertCurrent',
]);
const DECODE_SETTING_FIELDS = new Set<string>([
	'format', 'sampleRate', 'channelCount', 'maximumOutputBytes', 'signal',
]);
const MIME_FORMATS: Readonly<Record<string, DesktopAudioCodecFormat>> = Object.freeze({
	'audio/flac': 'flac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg-vorbis',
	'audio/opus': 'opus', 'audio/wavpack': 'wavpack', 'audio/x-wavpack': 'wavpack',
	'audio/mp4': 'aac-m4a',
});
const EXTENSION_FORMATS: Readonly<Record<string, DesktopAudioCodecFormat>> = Object.freeze({
	flac: 'flac', mp3: 'mp3', ogg: 'ogg-vorbis', oga: 'ogg-vorbis', opus: 'opus',
	wv: 'wavpack', wavpack: 'wavpack', mp2: 'mp2', m4a: 'aac-m4a', mp4: 'aac-m4a',
});
const DEFAULT_CAPABILITY_QUERY = createDesktopAudioCodecCapabilityQuery({ sampleRate: 48_000, channelCount: 2 });
const CAPABILITIES = desktopAudioCodecMediaExportCapabilities(null, DEFAULT_CAPABILITY_QUERY);
const NORMALIZATION_CAPABILITIES = createMediaExportCapabilities();

export class DesktopAudioCodecRuntimeDisposedError extends Error {
	readonly code = 'DESKTOP_AUDIO_CODEC_RUNTIME_DISPOSED';
	constructor() { super('The desktop audio codec runtime was disposed.'); this.name = 'DesktopAudioCodecRuntimeDisposedError'; }
}
export class DesktopAudioCodecRuntimeUnsupportedError extends Error {
	readonly code = 'DESKTOP_AUDIO_CODEC_RUNTIME_UNSUPPORTED';
	constructor(message: string) { super(message); this.name = 'DesktopAudioCodecRuntimeUnsupportedError'; }
}

export function createDesktopAudioCodecRuntime(bridgeValue: DesktopAudioCodecRendererBridge | DesktopAudioCodecLegacyRendererBridge): DesktopAudioCodecRuntime {
	const bridge = rendererBridge(bridgeValue);
	const active = new Map<string, ActiveRequest>();
	let disposed = false;

	const rejectVideo = (): Promise<never> => Promise.reject(new DesktopAudioCodecRuntimeUnsupportedError(
		'Desktop video operations are not admitted by the audio codec bridge.',
	));

	const runtime: DesktopAudioCodecRuntime = Object.freeze({
		async load(): Promise<DesktopAudioCodecRuntime> {
			assertActive();
			return runtime;
		},
		async encode(wav: Blob | ArrayBuffer | ArrayBufferView, formatValue: string,
			settingsValue: DesktopAudioCodecRuntimeSettings = {}): Promise<DesktopAudioCodecEncodedResult> {
			return encodeStagedWav(wavBlob(wav), formatValue, settingsValue);
		},
		async encodeFile(file: Blob, formatValue: string,
			settingsValue: DesktopAudioCodecRuntimeSettings = {}): Promise<DesktopAudioCodecEncodedResult> {
			if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
			return encodeStagedWav(file, formatValue, settingsValue);
		},
		async encodeFileToSink<Output>(file: Blob, formatValue: string, sink: FfmpegOutputSink<Output>,
			settingsValue: DesktopAudioCodecRuntimeSettings = {},
		): Promise<DesktopAudioCodecStreamResult<Output>> {
			let streamOwnsFailure = false;
			const settings = settingsRecord(settingsValue, ENCODE_SETTING_FIELDS, 'encode');
			try {
				assertFfmpegOutputReady(settings);
				const encoded = await encodeStagedWav(file, formatValue, settings);
				assertFfmpegOutputReady(settings);
				streamOwnsFailure = true;
				const streamed = await streamFfmpegOutputFile({
					async statFile() { return { size: encoded.bytes.byteLength }; },
					async readFileRange(_name, offset, maximumBytes) {
						return encoded.bytes.slice(offset, offset + maximumBytes);
					},
				}, 'desktop-audio-codec-result', sink, {
					signal: settings.signal,
					assertCurrent: settings.assertCurrent,
					maximumChunkBytes: settings.maximumOutputChunkBytes
						?? FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
				});
				streamOwnsFailure = false;
				return Object.freeze({
					...streamed, extension: encoded.extension, mimeType: encoded.mimeType,
				});
			} catch (error) {
				if (streamOwnsFailure) throw error;
				const primary = settings.signal?.aborted ? abortReason(settings.signal) : error;
				throw await abortFfmpegOutputSink(sink, primary);
			}
		},
		async decode(file: Blob | ArrayBuffer | ArrayBufferView,
			settingsValue: DesktopAudioCodecRuntimeSettings = {}): Promise<DesktopAudioCodecDecodedResult> {
			assertActive();
			const settings = settingsRecord(settingsValue, DECODE_SETTING_FIELDS, 'decode');
			throwIfAborted(settings.signal);
			const input = await boundedInputBytes(file, settings.signal);
			const format = decodeFormat(file, input, settings.format);
			const maximumOutputBytes = settings.maximumOutputBytes ?? DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES;
			const request = normalizeDesktopAudioCodecRequest({
				operation: 'audio-decode', format, input, sampleRate: null, channelCount: null,
				settings: { sampleFormat: 'f32le' }, maximumOutputBytes,
				requestId: mintRequestId(active),
			});
			const result = await executeRequest(request, settings.signal);
			return projectDesktopAudioDecodeResult(result);
		},
		encodeVideo: rejectVideo,
		encodeVideoToSink: rejectVideo,
		probeVideoTiming: rejectVideo,
		conformVideoToCfr: rejectVideo,
		runVideoKeyframeEncoderOperation: rejectVideo,
		runTrimMediaOperation: rejectVideo,
		runProxyMediaOperation: rejectVideo,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			const reason = new DesktopAudioCodecRuntimeDisposedError();
			for (const request of [...active.values()]) request.cancel(reason);
		},
		[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
		capabilities: () => CAPABILITIES,
		async desktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
			assertActive(); const normalized = normalizeDesktopAudioCodecCapabilityQuery(query);
			return normalizeDesktopAudioCodecCapabilityResult(await bridge.capabilities(normalized), normalized);
		},
	});
	return runtime;

	async function encodeStagedWav(file: Blob, formatValue: string,
		settingsValue: DesktopAudioCodecRuntimeSettings,
	): Promise<DesktopAudioCodecEncodedResult> {
		assertActive();
		const format = desktopFormat(formatValue);
		const settings = settingsRecord(settingsValue, ENCODE_SETTING_FIELDS, 'encode');
		throwIfAborted(settings.signal);
		const staged = await stagedPcm(file, format, settings);
		const codecSettings = encodeSettings(format, staged.media);
		await assertCapability({
			operation: 'audio-encode', format,
			sampleRate: staged.media.sampleRate, channelCount: staged.media.channelCount,
			settings: codecSettings as DesktopAudioCodecCapabilityTuple['settings'],
		}, settings.signal);
		const request = normalizeDesktopAudioCodecRequest({
			operation: 'audio-encode', format, input: staged.input,
			sampleRate: staged.media.sampleRate, channelCount: staged.media.channelCount,
			settings: codecSettings,
			maximumOutputBytes: settings.maximumOutputBytes ?? DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
			requestId: mintRequestId(active),
		});
		const result = await executeRequest(request, settings.signal);
		if (result.operation !== 'audio-encode') throw new Error('The desktop audio bridge returned a decode result for encode.');
		return Object.freeze({
			bytes: result.bytes,
			extension: `.${staged.media.extension}`,
			mimeType: staged.media.mimeType,
		});
	}

	async function executeRequest(request: DesktopAudioCodecRequest, signal?: AbortSignal,
	): Promise<DesktopAudioCodecResult> {
		assertActive();
		throwIfAborted(signal);
		const requestId = request.requestId;
		if (requestId === undefined) throw new Error('The desktop audio request has no cancellation identity.');
		let rejectCancellation!: (reason: unknown) => void;
		let cancelled = false;
		const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
		const state: ActiveRequest = Object.freeze({
			cancel(reason: unknown): void {
				if (cancelled) return;
				cancelled = true;
				void Promise.resolve().then(() => bridge.cancel(requestId)).catch(() => undefined);
				rejectCancellation(reason);
			},
		});
		const onAbort = (): void => { state.cancel(signal ? abortReason(signal) : abortError()); };
		active.set(requestId, state);
		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted === true) onAbort();
		try {
			const execution = Promise.resolve().then(() => cancelled ? cancellation : bridge.execute(request));
			const value = await Promise.race([execution, cancellation]);
			const result = normalizeDesktopAudioCodecResult(value, request.maximumOutputBytes);
			assertDesktopAudioCodecResultCorrelation(result, request);
			return result;
		} finally {
			signal?.removeEventListener('abort', onAbort);
			active.delete(requestId);
		}
	}

	async function assertCapability(tuple: DesktopAudioCodecCapabilityTuple, signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		const capability = await queryDesktopAudioCodecCapability(
			(query) => bridge.capabilities(query), tuple,
		);
		throwIfAborted(signal);
		if (!capability.available) {
			throw new DesktopAudioCodecRuntimeUnsupportedError(
				desktopAudioCodecCapabilityReason(capability.reason),
			);
		}
	}

	function assertActive(): void {
		if (disposed) throw new DesktopAudioCodecRuntimeDisposedError();
	}
}

async function stagedPcm(file: Blob, format: DesktopAudioCodecFormat,
	settings: DesktopAudioCodecRuntimeSettings,
): Promise<Readonly<{ readonly input: Uint8Array; readonly media: NormalizedMediaSettings }>> {
	if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
	const signal = settings.signal;
	const descriptor = await inspectWavBlobPcm(file, signal ? { signal } : {}) as WavPcmDescriptor;
	if (settings.inputChannelCount !== undefined && settings.inputChannelCount !== descriptor.channelCount) {
		throw new RangeError('The staged WAV channel count does not match the export settings.');
	}
	const media = normalizeMediaExportSettings(format, {
		...settings,
		capabilities: NORMALIZATION_CAPABILITIES,
		inputChannelCount: descriptor.channelCount,
		sampleRate: settings.sampleRate ?? descriptor.sampleRate,
	}) as NormalizedMediaSettings;
	// The closed broker has no metadata field; desktop compressed metadata is intentionally dropped.
	if (media.sampleRate !== descriptor.sampleRate) {
		throw new DesktopAudioCodecRuntimeUnsupportedError(
			'The desktop audio bridge cannot resample a staged WAV before encoding.',
		);
	}
	if (media.channelCount > DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT
		|| ((format === 'mp3' || format === 'mp2') && media.channelCount > 2)) {
		throw new DesktopAudioCodecRuntimeUnsupportedError(
			`${format === 'mp3' || format === 'mp2' ? format.toUpperCase() : 'The desktop audio bridge'} supports at most ${format === 'mp3' || format === 'mp2' ? '2' : String(DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT)} output channels.`,
		);
	}
	const byteLength = descriptor.frameCount * media.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(byteLength) || byteLength < 1
		|| byteLength > DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES) {
		throw new DesktopAudioCodecRuntimeUnsupportedError(
			`The staged WAV requires ${String(byteLength)} interleaved PCM bytes; the desktop audio bridge limit is ${String(DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES)}.`,
		);
	}
	const input = new Uint8Array(byteLength);
	const view = new DataView(input.buffer);
	await streamWavBlobPcm(file, {
		descriptor,
		signal,
		onChunk(packet: readonly Float32Array[], details: Readonly<{ frameOffset: number }>) {
			const channels = applyMediaChannelMapping(packet, media.channelMapping as string) as readonly Float32Array[];
			if (channels.length !== media.channelCount) {
				throw new Error('The staged WAV channel mapping returned unexpected geometry.');
			}
			for (let frame = 0; frame < (channels[0]?.length ?? 0); frame += 1) {
				for (let channel = 0; channel < channels.length; channel += 1) {
					const sample = channels[channel]?.[frame];
					view.setFloat32(
						((details.frameOffset + frame) * channels.length + channel) * 4,
						Number.isFinite(sample) ? Number(sample) : 0,
						true,
					);
				}
			}
		},
	});
	return Object.freeze({ input, media });
}

function encodeSettings(format: DesktopAudioCodecFormat, media: NormalizedMediaSettings,
): Readonly<Record<string, number>> {
	if (format === 'flac') {
		return Object.freeze({
			compressionLevel: requiredInteger(media.compressionLevel, 'flac compression level'),
			bitDepth: requiredInteger(media.bitDepth, 'flac bit depth'),
		});
	}
	if (format === 'wavpack') {
		return Object.freeze({ compressionLevel: requiredInteger(media.compressionLevel, `${format} compression level`) });
	}
	if (format === 'ogg-vorbis') {
		return Object.freeze({ quality: requiredInteger(media.quality, 'Vorbis quality') });
	}
	return Object.freeze({ bitrateKbps: requiredInteger(media.bitRate, `${format} bitrate`) });
}

async function boundedInputBytes(value: Blob | ArrayBuffer | ArrayBufferView, signal?: AbortSignal,
): Promise<Uint8Array> {
	throwIfAborted(signal);
	if (value instanceof Blob) {
		if (value.size < 1 || value.size > DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES) {
			throw new RangeError('The desktop audio decode input exceeds its 32 MiB bound.');
		}
		const buffer = await value.arrayBuffer();
		throwIfAborted(signal);
		if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== value.size) {
			throw new Error('The desktop audio decode Blob returned unexpected bytes.');
		}
		return new Uint8Array(buffer);
	}
	const bytes = ownedBytes(value);
	if (bytes.byteLength < 1 || bytes.byteLength > DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES) {
		throw new RangeError('The desktop audio decode input exceeds its 32 MiB bound.');
	}
	return bytes;
}

function wavBlob(value: Blob | ArrayBuffer | ArrayBufferView): Blob {
	if (value instanceof Blob) return value;
	return new Blob([ownedBytes(value)], { type: 'audio/wav' });
}

function ownedBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}
	throw new TypeError('Expected a Blob, ArrayBuffer, or typed-array payload.');
}

function decodeFormat(file: Blob | ArrayBuffer | ArrayBufferView, bytes: Uint8Array,
	explicit: unknown,
): DesktopAudioCodecFormat {
	if (explicit !== undefined) return desktopFormat(explicit);
	const fileName = typeof File === 'function' && file instanceof File ? file.name : '';
	const extension = /\.([A-Za-z0-9]+)$/u.exec(fileName)?.[1]?.toLowerCase();
	if (extension && EXTENSION_FORMATS[extension]) return EXTENSION_FORMATS[extension];
	const signature = signatureFormat(bytes);
	if (signature !== null) return signature;
	const mimeType = file instanceof Blob ? file.type.split(';', 1)[0]?.trim().toLowerCase() : '';
	if (mimeType && MIME_FORMATS[mimeType]) return MIME_FORMATS[mimeType];
	throw new TypeError('The desktop audio runtime cannot determine the compressed input format.');
}

function signatureFormat(bytes: Uint8Array): DesktopAudioCodecFormat | null {
	if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
	if (ascii(bytes, 0, 4) === 'wvpk') return 'wavpack';
	if (ascii(bytes, 0, 4) === 'OggS') {
		if (containsAscii(bytes.subarray(0, Math.min(bytes.byteLength, 256)), 'OpusHead')) return 'opus';
		return 'ogg-vorbis';
	}
	if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
	if (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
		const layer = (bytes[1]! >> 1) & 0x03;
		if (layer === 2) return 'mp2';
		if (layer === 1) return 'mp3';
	}
	if (ascii(bytes, 4, 4) === 'ftyp') return 'aac-m4a';
	return null;
}

function desktopFormat(value: unknown): DesktopAudioCodecFormat {
	const canonical = canonicalMediaExportFormat(value) as string;
	if (canonical === 'custom-ffmpeg') {
		throw new DesktopAudioCodecRuntimeUnsupportedError(
			'Custom FFmpeg operations are not admitted by the desktop audio codec bridge.',
		);
	}
	if (!FORMATS.has(canonical)) throw new TypeError('The desktop audio codec format is unsupported.');
	return canonical as DesktopAudioCodecFormat;
}

function settingsRecord(value: unknown, permitted: ReadonlySet<string>, operation: string,
): DesktopAudioCodecRuntimeSettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`Desktop audio ${operation} settings must be a plain record.`);
	}
	const result: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !permitted.has(key)) {
			throw new TypeError(`Desktop audio ${operation} settings contain an unsupported field.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Desktop audio ${operation} settings must contain only data properties.`);
		}
		result[key] = descriptor.value;
	}
	if (result.signal !== undefined && !(result.signal instanceof AbortSignal)) {
		throw new TypeError(`Desktop audio ${operation} signal must be an AbortSignal.`);
	}
	if (result.assertCurrent !== undefined && typeof result.assertCurrent !== 'function') {
		throw new TypeError('Desktop audio encode assertCurrent must be a function.');
	}
	return Object.freeze(result) as DesktopAudioCodecRuntimeSettings;
}

function rendererBridge(value: unknown): DesktopAudioCodecRendererBridge {
	const execute = dataMethod(value, 'execute', 'desktop audio codec bridge');
	const cancel = dataMethod(value, 'cancel', 'desktop audio codec bridge');
	return Object.freeze({
		capabilities(query: DesktopAudioCodecCapabilityQuery) {
			return Reflect.apply(dataMethod(value, 'capabilities', 'desktop audio codec bridge'), value, [query]);
		},
		execute(request: DesktopAudioCodecRequest) {
			return Reflect.apply(execute, value, [request]);
		},
		cancel(requestId: string) {
			return Reflect.apply(cancel, value, [requestId]);
		},
	});
}

function dataMethod(value: unknown, key: string, label: string): (...arguments_: never[]) => unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	let owner: object | null = value;
	while (owner !== null) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
				throw new TypeError(`The ${label}.${key} method is invalid.`);
			}
			return descriptor.value as (...arguments_: never[]) => unknown;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`The ${label}.${key} method is unavailable.`);
}

function mintRequestId(active: ReadonlyMap<string, ActiveRequest>): string {
	const cryptoValue = globalThis.crypto;
	if (!cryptoValue || typeof cryptoValue.getRandomValues !== 'function') {
		throw new Error('Secure desktop audio request IDs are unavailable.');
	}
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const entropy = cryptoValue.getRandomValues(new Uint8Array(16));
		const requestId = `desktop-audio-${[...entropy].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
		if (!active.has(requestId)) return requestId;
	}
	throw new Error('A unique desktop audio request ID could not be minted.');
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) {
		throw new DesktopAudioCodecRuntimeUnsupportedError(`The normalized ${label} cannot be represented by the desktop bridge.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? abortError();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The desktop audio operation was aborted.', 'AbortError')
		: Object.assign(new Error('The desktop audio operation was aborted.'), { name: 'AbortError' });
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	if (offset + length > bytes.byteLength) return '';
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]!);
	return value;
}

function containsAscii(bytes: Uint8Array, expected: string): boolean {
	const needle = new TextEncoder().encode(expected);
	for (let offset = 0; offset <= bytes.byteLength - needle.byteLength; offset += 1) {
		if (needle.every((value, index) => bytes[offset + index] === value)) return true;
	}
	return false;
}
