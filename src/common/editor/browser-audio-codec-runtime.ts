/* SPDX-License-Identifier: AGPL-3.0-only */

/** Browser composition for complete-file audio codecs, with no FFmpeg runtime. */

import {
	type BrowserDedicatedAudioFormat,
	type DedicatedAudioDecodeRequest,
	type DedicatedAudioDecodeResult,
	type DedicatedAudioEncodeRequest,
} from './browser-dedicated-audio-codec.ts';
import type { BrowserAacEncodeRequest } from './browser-webcodecs-aac.ts';
import { browserAacMetadataTags } from './browser-aac-metadata.ts';
import {
	probeBrowserWebCodecsAudioEncoding,
	type BrowserAudioEncoderProbe,
} from './browser-webcodecs-audio-profile.ts';
import {
	FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
	streamFfmpegOutputFile,
	type FfmpegOutputSink,
} from './ffmpeg-output-stream.ts';
import {
	applyMediaChannelMapping,
	canonicalMediaExportFormat,
	createMediaExportCapabilities,
	mp3CodecRateSettings,
	normalizeMediaExportSettings,
	opusCodecRateSettings,
} from './media-export.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import type { WavPcmDescriptor } from './wav-pcm-chunk-reader.ts';

export interface BrowserDedicatedAudioCodecClient {
	encode(request: DedicatedAudioEncodeRequest, options?: Readonly<{ signal?: AbortSignal }>): Promise<Uint8Array>;
	decode(request: DedicatedAudioDecodeRequest, options?: Readonly<{ signal?: AbortSignal }>): Promise<DedicatedAudioDecodeResult>;
	dispose(): void;
}

export interface BrowserAudioCodecRuntimeOptions {
	readonly codecClient?: BrowserDedicatedAudioCodecClient;
	readonly webCodecsAac?: boolean;
	readonly encodeAac?: (request: BrowserAacEncodeRequest) => Promise<Uint8Array>;
	readonly audioEncoderProbe?: BrowserAudioEncoderProbe;
	readonly [key: string]: unknown;
}

export interface BrowserAudioCodecRuntimeSettings {
	readonly capabilities?: unknown;
	readonly sampleRate?: number;
	readonly inputChannelCount?: number;
	readonly channelCount?: number;
	readonly channelMapping?: unknown;
	readonly sampleFormat?: string;
	readonly bitDepth?: number;
	readonly dither?: unknown;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly compressionLevel?: number;
	readonly quality?: number;
	readonly bitRate?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumOutputChunkBytes?: number;
	readonly frameCount?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

interface NormalizedMediaSettings {
	readonly extension: string;
	readonly mimeType: string;
	readonly sampleRate: number;
	readonly inputChannelCount: number;
	readonly channelCount: number;
	readonly channelMapping: unknown;
	readonly sampleFormat: string | null;
	readonly metadata: Readonly<Record<string, string>>;
	readonly compressionLevel?: number;
	readonly quality?: number;
	readonly bitRate?: number;
}

interface BrowserAudioCapabilities {
	readonly profileId: string;
	readonly ffmpegAvailable: false;
	readonly encoders: readonly string[];
	readonly muxers: readonly string[];
	readonly formats: Readonly<Record<string, Readonly<{
		readonly available: boolean;
		readonly reason: string | null;
		readonly missingEncoders: readonly string[];
		readonly missingMuxers: readonly string[];
	}>>>;
}

const DEDICATED_FORMATS = new Set<string>([
	'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2',
]);
type BrowserAudioFileFormat = BrowserDedicatedAudioFormat | 'aac-m4a';
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

export class BrowserCodecRuntimeUnsupportedError extends Error {
	readonly code = 'BROWSER_CODEC_RUNTIME_UNSUPPORTED';

	constructor(message: string) {
		super(message);
		this.name = 'BrowserCodecRuntimeUnsupportedError';
	}
}

export class BrowserCodecRuntimeDisposedError extends Error {
	readonly code = 'BROWSER_CODEC_RUNTIME_DISPOSED';

	constructor() {
		super('The browser-native codec runtime was disposed.');
		this.name = 'BrowserCodecRuntimeDisposedError';
	}
}

export function createBrowserAudioCodecRuntime(options: BrowserAudioCodecRuntimeOptions = {}) {
	const client = options.codecClient ?? createLazyBrowserDedicatedAudioCodecClient();
	const encodeAac = options.encodeAac ?? (async (request: BrowserAacEncodeRequest) => (
		await import('./browser-webcodecs-aac.ts')
	).encodeBrowserAacM4a(request));
	const capabilities = browserAudioCapabilities(options.webCodecsAac ?? hasWebCodecsAac());
	const lifetimeAbort = new AbortController();
	let disposed = false;
	const runtime = Object.freeze({
		async load() {
			assertActive();
			return runtime;
		},
		async encode(
			wav: Blob | ArrayBuffer | ArrayBufferView,
			format: string,
			settings: BrowserAudioCodecRuntimeSettings = {},
		) {
			return encodeFile(wavBlob(wav), format, settings);
		},
		async preflightEncodeFile(
			formatValue: string,
			settingsValue: BrowserAudioCodecRuntimeSettings,
		): Promise<void> {
			assertActive();
			const signal = operationSignal(settingsValue.signal, lifetimeAbort.signal);
			const canonicalFormat = canonicalMediaExportFormat(formatValue) as string;
			if (!DEDICATED_FORMATS.has(canonicalFormat)
				&& canonicalFormat !== 'aac-m4a' && canonicalFormat !== 'custom-ffmpeg') return;
			const format = admittedFormat(formatValue, capabilities);
			throwIfAborted(signal);
			const media = normalizeMediaExportSettings(format, {
				...settingsValue,
				capabilities,
			}) as NormalizedMediaSettings;
			const frameCount = requiredPositiveInteger(settingsValue.frameCount, 'frame count');
			assertBrowserCodecInput(format, media, frameCount);
			if (format === 'aac-m4a') {
				browserAacMetadataTags(media.metadata);
				const supported = await probeBrowserWebCodecsAudioEncoding('aac', {
					sampleRate: media.sampleRate,
					channelCount: media.channelCount,
					bitrate: requiredInteger(media.bitRate, 'bitrate') * 1_000,
				}, options.audioEncoderProbe);
				throwIfAborted(signal);
				if (!supported) throw new BrowserCodecRuntimeUnsupportedError(
					'This browser does not encode the requested AAC/M4A configuration.',
				);
			}
		},
		encodeFile,
		async encodeFileToSink<Output>(
			file: Blob,
			format: string,
			sink: FfmpegOutputSink<Output>,
			settings: BrowserAudioCodecRuntimeSettings = {},
		) {
			const signal = operationSignal(settings.signal, lifetimeAbort.signal);
			const encoded = await encodeFile(file, format, { ...settings, signal });
			const streamed = await streamFfmpegOutputFile({
				async statFile() { return { size: encoded.bytes.byteLength }; },
				async readFileRange(_path, offset, maximumBytes) {
					return encoded.bytes.slice(offset, offset + maximumBytes);
				},
			}, 'browser-dedicated-audio-result', sink, {
				signal,
				...(settings.assertCurrent ? { assertCurrent: settings.assertCurrent } : {}),
				maximumChunkBytes: settings.maximumOutputChunkBytes
					?? FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
			});
			return Object.freeze({
				...streamed,
				extension: encoded.extension,
				mimeType: encoded.mimeType,
			});
		},
		async decode(
			file: Blob | ArrayBuffer | ArrayBufferView,
			settings: BrowserAudioCodecRuntimeSettings = {},
		) {
			assertActive();
			throwIfAborted(settings.signal);
			const input = await compressedInput(file);
			throwIfAborted(settings.signal);
			const decoded = await client.decode({
				format: compressedFormat(file, input),
				input,
				maximumOutputBytes: maximumOutputBytes(settings.maximumOutputBytes),
			}, settings.signal ? { signal: settings.signal } : {});
			throwIfAborted(settings.signal);
			settings.assertCurrent?.();
			return decodedChannels(decoded);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			lifetimeAbort.abort(new BrowserCodecRuntimeDisposedError());
			client.dispose();
		},
		capabilities: () => capabilities,
	});
	return runtime;

	async function encodeFile(
		file: Blob,
		formatValue: string,
		settingsValue: BrowserAudioCodecRuntimeSettings = {},
	) {
		assertActive();
		if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
		const format = admittedFormat(formatValue, capabilities);
		const signal = operationSignal(settingsValue.signal, lifetimeAbort.signal);
		const operationSettings = { ...settingsValue, signal };
		throwIfAborted(signal);
		const staged = await stagedPcm(file, format as BrowserAudioFileFormat, operationSettings, capabilities);
		throwIfAborted(signal);
		settingsValue.assertCurrent?.();
		const outputBound = maximumOutputBytes(settingsValue.maximumOutputBytes);
		const bytes = format === 'aac-m4a'
			? await encodeAac({
				input: staged.input,
				frameCount: staged.frameCount,
				channelCount: staged.media.channelCount,
				sampleRate: staged.media.sampleRate,
				bitrate: requiredInteger(staged.media.bitRate, 'bitrate') * 1_000,
				maximumOutputBytes: outputBound,
				...(Object.keys(staged.media.metadata).length > 0
					? { metadata: staged.media.metadata }
					: {}),
				signal,
			})
			: await client.encode({
				format: format as BrowserDedicatedAudioFormat,
				input: staged.input,
				frameCount: staged.frameCount,
				channelCount: staged.media.channelCount,
				sampleRate: staged.media.sampleRate,
				settings: codecSettings(format as BrowserDedicatedAudioFormat, staged.media),
				maximumOutputBytes: outputBound,
			}, { signal });
		throwIfAborted(signal);
		settingsValue.assertCurrent?.();
		if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
			throw new Error('The dedicated browser codec returned no file bytes.');
		}
		return Object.freeze({
			bytes: Uint8Array.from(bytes),
			extension: `.${staged.media.extension}`,
			mimeType: staged.media.mimeType,
		});
	}

	function assertActive(): void {
		if (disposed) throw new BrowserCodecRuntimeDisposedError();
	}
}

function createLazyBrowserDedicatedAudioCodecClient(): BrowserDedicatedAudioCodecClient {
	let loaded: Promise<BrowserDedicatedAudioCodecClient> | null = null;
	let disposed = false;
	const load = async (): Promise<BrowserDedicatedAudioCodecClient> => {
		if (disposed) throw new BrowserCodecRuntimeDisposedError();
		loaded ??= import('./browser-dedicated-audio-worker-client.ts').then((module) => {
			const client = module.createBrowserDedicatedAudioCodecClient();
			if (disposed) {
				client.dispose();
				throw new BrowserCodecRuntimeDisposedError();
			}
			return client;
		});
		return loaded;
	};
	return Object.freeze({
		async encode(
			request: DedicatedAudioEncodeRequest,
			options?: Readonly<{ signal?: AbortSignal }>,
		) { return (await load()).encode(request, options); },
		async decode(
			request: DedicatedAudioDecodeRequest,
			options?: Readonly<{ signal?: AbortSignal }>,
		) { return (await load()).decode(request, options); },
		dispose() {
			if (disposed) return;
			disposed = true;
			if (loaded) void loaded.then((client) => client.dispose()).catch(() => undefined);
		},
	});
}

async function stagedPcm(
	file: Blob,
	format: BrowserAudioFileFormat,
	settings: BrowserAudioCodecRuntimeSettings,
	capabilities: BrowserAudioCapabilities,
): Promise<Readonly<{
	readonly input: Uint8Array<ArrayBuffer>;
	readonly frameCount: number;
	readonly media: NormalizedMediaSettings;
}>> {
	const descriptor = await inspectWavBlobPcm(file, settings.signal ? { signal: settings.signal } : {}) as WavPcmDescriptor;
	if (settings.inputChannelCount !== undefined && settings.inputChannelCount !== descriptor.channelCount) {
		throw new RangeError('The staged WAV channel count does not match the browser codec settings.');
	}
	const media = normalizeMediaExportSettings(format, {
		...settings,
		capabilities,
		inputChannelCount: descriptor.channelCount,
		sampleRate: settings.sampleRate ?? descriptor.sampleRate,
	}) as NormalizedMediaSettings;
	if (media.sampleRate !== descriptor.sampleRate) {
		throw new BrowserCodecRuntimeUnsupportedError(
			'The staged WAV must already have the requested browser codec sample rate.',
		);
	}
	assertBrowserCodecInput(format, media, descriptor.frameCount);
	const byteLength = descriptor.frameCount * media.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > DEFAULT_MAXIMUM_OUTPUT_BYTES) {
		throw new BrowserCodecRuntimeUnsupportedError(
			'The staged PCM exceeds the dedicated browser codec input bound.',
		);
	}
	const input = new Uint8Array(byteLength);
	const view = new DataView(input.buffer);
	await streamWavBlobPcm(file, {
		descriptor,
		...(settings.signal ? { signal: settings.signal } : {}),
		onChunk(packet: readonly Float32Array[], details: Readonly<{ frameOffset: number }>) {
			const channels = applyMediaChannelMapping(packet, media.channelMapping as never) as readonly Float32Array[];
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
	return Object.freeze({ input, frameCount: descriptor.frameCount, media });
}

function admittedFormat(formatValue: string, capabilities: BrowserAudioCapabilities): BrowserAudioFileFormat {
	const format = canonicalMediaExportFormat(formatValue) as string;
	if (format === 'custom-ffmpeg') throw new BrowserCodecRuntimeUnsupportedError(
		'Custom FFmpeg export is not available in the browser-native codec runtime.',
	);
	if (format === 'aac-m4a' && !capabilities.formats[format]?.available) {
		throw new BrowserCodecRuntimeUnsupportedError(capabilities.formats[format]?.reason
			?? 'This browser cannot encode AAC/M4A with WebCodecs.');
	}
	if (!DEDICATED_FORMATS.has(format) && format !== 'aac-m4a') {
		throw new BrowserCodecRuntimeUnsupportedError(`No dedicated browser codec owns ${format} export.`);
	}
	return format as BrowserAudioFileFormat;
}

function assertBrowserCodecInput(
	format: BrowserAudioFileFormat,
	media: NormalizedMediaSettings,
	frameCount: number,
): void {
	if (format !== 'aac-m4a') {
		assertDedicatedProfile(format, media);
		if (Object.keys(media.metadata).length > 0) throw new BrowserCodecRuntimeUnsupportedError(
			`The dedicated ${format} browser encoder does not write metadata tags.`,
		);
	}
	const maximumFrames = format === 'mp3' || format === 'mp2' ? 8_388_608 : 33_554_432;
	const byteLength = frameCount * media.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (frameCount > maximumFrames || !Number.isSafeInteger(byteLength)
		|| byteLength < 1 || byteLength > DEFAULT_MAXIMUM_OUTPUT_BYTES) {
		throw new BrowserCodecRuntimeUnsupportedError(
			'This export exceeds the complete-file browser codec input bound.',
		);
	}
}

function assertDedicatedProfile(format: BrowserDedicatedAudioFormat, media: NormalizedMediaSettings): void {
	if ((format === 'mp3' || format === 'mp2' || format === 'opus' || format === 'ogg-vorbis')
		&& media.channelCount > 2) {
		throw new BrowserCodecRuntimeUnsupportedError(`The dedicated ${format} browser profile supports mono or stereo.`);
	}
	if (format === 'opus' && media.sampleRate !== 48_000) {
		throw new BrowserCodecRuntimeUnsupportedError('The dedicated Opus browser profile requires 48 kHz export.');
	}
	if ((format === 'mp3' || format === 'mp2') && ![32_000, 44_100, 48_000].includes(media.sampleRate)) {
		throw new BrowserCodecRuntimeUnsupportedError(`The dedicated ${format} browser profile does not admit this sample rate.`);
	}
	if (format === 'flac' && media.sampleFormat !== 'int24') {
		throw new BrowserCodecRuntimeUnsupportedError('The dedicated FLAC browser profile writes signed 24-bit FLAC.');
	}
	if (format === 'wavpack' && media.sampleFormat !== 'float32') {
		throw new BrowserCodecRuntimeUnsupportedError('The dedicated WavPack browser profile writes lossless float32 WavPack.');
	}
}

function codecSettings(
	format: BrowserDedicatedAudioFormat,
	media: NormalizedMediaSettings,
): Readonly<Record<string, number>> {
	if (format === 'flac' || format === 'wavpack') {
		return Object.freeze({ compressionLevel: requiredInteger(media.compressionLevel, 'compression level') });
	}
	if (format === 'ogg-vorbis') return Object.freeze({ quality: requiredInteger(media.quality, 'quality') });
	if (format === 'mp3') return mp3CodecRateSettings(media);
	if (format === 'opus') return opusCodecRateSettings(media);
	return Object.freeze({ bitrateKbps: requiredInteger(media.bitRate, 'bitrate') });
}

function browserAudioCapabilities(webCodecsAac: boolean): BrowserAudioCapabilities {
	const baseline = createMediaExportCapabilities();
	const formats: Record<string, Readonly<{
		available: boolean;
		reason: string | null;
		missingEncoders: readonly string[];
		missingMuxers: readonly string[];
	}>> = {};
	for (const id of Object.keys(baseline.formats)) {
		const available = !['custom-ffmpeg', 'aac-m4a'].includes(id) || id === 'aac-m4a' && webCodecsAac;
		formats[id] = Object.freeze({
			available,
			reason: available ? null : id === 'aac-m4a'
				? 'This browser does not provide WebCodecs AAC encoding.'
				: 'Custom FFmpeg commands are intentionally unavailable in browsers.',
			missingEncoders: Object.freeze([]),
			missingMuxers: Object.freeze([]),
		});
	}
	return Object.freeze({
		profileId: 'browser-dedicated-codecs-v1',
		ffmpegAvailable: false as const,
		encoders: Object.freeze(['flac', 'lame', 'libopus', 'libvorbis', 'twolame', 'wavpack']),
		muxers: Object.freeze(['flac', 'mp2', 'mp3', 'ogg', 'opus', 'wv', ...(webCodecsAac ? ['mp4'] : [])]),
		formats: Object.freeze(formats),
	});
}

function hasWebCodecsAac(): boolean {
	return typeof (globalThis as Readonly<Record<string, unknown>>).AudioEncoder === 'function'
		&& typeof (globalThis as Readonly<Record<string, unknown>>).AudioData === 'function';
}

async function compressedInput(value: Blob | ArrayBuffer | ArrayBufferView): Promise<Uint8Array<ArrayBuffer>> {
	if (value instanceof Blob) {
		if (value.size < 1 || value.size > 32 * 1024 * 1024) {
			throw new RangeError('The dedicated compressed-audio input exceeds 32 MiB.');
		}
		return new Uint8Array(await value.arrayBuffer());
	}
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}
	throw new TypeError('Expected a compressed-audio Blob, ArrayBuffer, or typed array.');
}

function compressedFormat(
	file: Blob | ArrayBuffer | ArrayBufferView,
	bytes: Uint8Array,
): BrowserDedicatedAudioFormat {
	const fileName = typeof File === 'function' && file instanceof File ? file.name : '';
	const extension = /\.([A-Za-z0-9]+)$/u.exec(fileName)?.[1]?.toLowerCase();
	if (extension === 'flac') return 'flac';
	if (extension === 'wv' || extension === 'wavpack') return 'wavpack';
	if (extension === 'opus') return 'opus';
	if (extension === 'ogg' || extension === 'oga') return containsAscii(bytes, 'OpusHead') ? 'opus' : 'ogg-vorbis';
	if (extension === 'mp2') return 'mp2';
	if (extension === 'mp3') return 'mp3';
	if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
	if (ascii(bytes, 0, 4) === 'wvpk') return 'wavpack';
	if (ascii(bytes, 0, 4) === 'OggS') return containsAscii(bytes, 'OpusHead') ? 'opus' : 'ogg-vorbis';
	if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
	if (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
		const layer = (bytes[1]! >> 1) & 0x03;
		if (layer === 2) return 'mp2';
		if (layer === 1) return 'mp3';
	}
	throw new BrowserCodecRuntimeUnsupportedError(
		'This compressed file is outside the dedicated browser decoder profiles.',
	);
}

function decodedChannels(decoded: DedicatedAudioDecodeResult) {
	const expectedBytes = decoded.frameCount * decoded.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!(decoded.interleaved instanceof Uint8Array) || decoded.interleaved.byteLength !== expectedBytes) {
		throw new Error('The dedicated browser decoder returned inconsistent PCM geometry.');
	}
	const channels = Array.from(
		{ length: decoded.channelCount },
		() => new Float32Array(decoded.frameCount),
	);
	const view = new DataView(
		decoded.interleaved.buffer,
		decoded.interleaved.byteOffset,
		decoded.interleaved.byteLength,
	);
	for (let frame = 0; frame < decoded.frameCount; frame += 1) {
		for (let channel = 0; channel < decoded.channelCount; channel += 1) {
			channels[channel]![frame] = view.getFloat32(
				(frame * decoded.channelCount + channel) * Float32Array.BYTES_PER_ELEMENT,
				true,
			);
		}
	}
	return Object.freeze({
		sampleRate: decoded.sampleRate,
		channels: Object.freeze(channels),
		frameCount: decoded.frameCount,
	});
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	if (offset + length > bytes.byteLength) return '';
	let result = '';
	for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]!);
	return result;
}

function containsAscii(bytes: Uint8Array, expected: string): boolean {
	const needle = new TextEncoder().encode(expected);
	const limit = Math.min(bytes.byteLength, 4_096);
	for (let offset = 0; offset <= limit - needle.byteLength; offset += 1) {
		if (needle.every((byte, index) => bytes[offset + index] === byte)) return true;
	}
	return false;
}

function wavBlob(value: Blob | ArrayBuffer | ArrayBufferView): Blob {
	if (value instanceof Blob) return value;
	if (value instanceof ArrayBuffer) return new Blob([value.slice(0)], { type: 'audio/wav' });
	if (ArrayBuffer.isView(value)) {
		return new Blob([Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))], {
			type: 'audio/wav',
		});
	}
	throw new TypeError('Expected a Blob, ArrayBuffer, or typed-array WAV.');
}

function maximumOutputBytes(value: number | undefined): number {
	const result = value ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
	if (!Number.isSafeInteger(result) || result < 1 || result > DEFAULT_MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The browser codec output bound must be between 1 byte and 128 MiB.');
	}
	return result;
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`The browser codec ${label} is invalid.`);
	return Number(value);
}

function requiredPositiveInteger(value: unknown, label: string): number {
	const result = requiredInteger(value, label);
	if (result < 1) throw new RangeError(`The browser codec ${label} must be positive.`);
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
}

function operationSignal(signal: AbortSignal | undefined, lifetime: AbortSignal): AbortSignal {
	return signal ? AbortSignal.any([signal, lifetime]) : lifetime;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The browser codec operation was aborted.', 'AbortError')
		: Object.assign(new Error('The browser codec operation was aborted.'), { name: 'AbortError' });
}
