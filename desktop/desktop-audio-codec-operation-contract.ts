/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed renderer/main contract for bounded desktop audio codec operations. */

export const DESKTOP_AUDIO_CODEC_FORMATS = Object.freeze([
	'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
] as const);
export type DesktopAudioCodecFormat = typeof DESKTOP_AUDIO_CODEC_FORMATS[number];

export const DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES = 32 * 1024 * 1024;
export const DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES = 128 * 1024 * 1024;
export const DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE = 8_000;
export const DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE = 192_000;
export const DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT = 8;

export type DesktopAudioDecodeSettings = Readonly<{ readonly sampleFormat: 'f32le' }>;
export type DesktopAudioFlacEncodeSettings = Readonly<{
	readonly compressionLevel: number;
	/** Explicit integer PCM representation written into the lossless FLAC stream. */
	readonly bitDepth: 16 | 24;
}>;
export type DesktopAudioMp3EncodeSettings = Readonly<{ readonly bitrateKbps: number }>;
export type DesktopAudioVorbisEncodeSettings = Readonly<{ readonly quality: number }>;
export type DesktopAudioOpusEncodeSettings = Readonly<{ readonly bitrateKbps: number }>;
export type DesktopAudioWavpackEncodeSettings = Readonly<{ readonly compressionLevel: number }>;
export type DesktopAudioMp2EncodeSettings = Readonly<{ readonly bitrateKbps: number }>;
export type DesktopAudioAacEncodeSettings = Readonly<{ readonly bitrateKbps: number }>;

interface DesktopAudioCodecRequestBase {
	readonly input: Uint8Array;
	readonly maximumOutputBytes: number;
	readonly requestId?: string;
}

export interface DesktopAudioDecodeRequest extends DesktopAudioCodecRequestBase {
	readonly operation: 'audio-decode';
	readonly format: DesktopAudioCodecFormat;
	/** Null means the admitted source stream, never project geometry, is authoritative. */
	readonly sampleRate: null;
	readonly channelCount: null;
	readonly settings: DesktopAudioDecodeSettings;
}

export type DesktopAudioEncodeRequest = DesktopAudioCodecRequestBase & Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
}> & (
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'flac'; readonly settings: DesktopAudioFlacEncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'mp3'; readonly settings: DesktopAudioMp3EncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'ogg-vorbis'; readonly settings: DesktopAudioVorbisEncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'opus'; readonly settings: DesktopAudioOpusEncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'wavpack'; readonly settings: DesktopAudioWavpackEncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'mp2'; readonly settings: DesktopAudioMp2EncodeSettings }>
	| Readonly<{ readonly operation: 'audio-encode'; readonly format: 'aac-m4a'; readonly settings: DesktopAudioAacEncodeSettings }>
);

export type DesktopAudioCodecRequest = DesktopAudioDecodeRequest | DesktopAudioEncodeRequest;

export interface DesktopDecodedAudioMetadata {
	readonly kind: 'decoded-audio';
	readonly sourceFormat: DesktopAudioCodecFormat;
	readonly sampleFormat: 'f32le';
	readonly interleaving: 'interleaved';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Geometry measured by the selected decoder from the admitted source stream. */
export interface DesktopDecodedAudioGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export interface DesktopEncodedAudioMetadata {
	readonly kind: 'encoded-audio';
	readonly format: DesktopAudioCodecFormat;
	readonly mimeType: string;
	readonly fileExtension: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	/** Present only for FLAC, whose f32 broker input is explicitly converted before lossless coding. */
	readonly sourceSampleFormat?: 'f32le';
	readonly encodedSampleFormat?: 's16' | 's24';
	readonly pcmConversion?: 'clamp-unit-range-to-signed-16' | 'clamp-unit-range-to-signed-24';
}

interface DesktopAudioCodecResultBase {
	readonly bytes: Uint8Array;
	readonly requestId?: string;
}

export interface DesktopAudioDecodeResult extends DesktopAudioCodecResultBase {
	readonly operation: 'audio-decode';
	readonly metadata: Readonly<DesktopDecodedAudioMetadata>;
}

export interface DesktopAudioEncodeResult extends DesktopAudioCodecResultBase {
	readonly operation: 'audio-encode';
	readonly metadata: Readonly<DesktopEncodedAudioMetadata>;
}

export type DesktopAudioCodecResult = DesktopAudioDecodeResult | DesktopAudioEncodeResult;

interface FormatDescriptor {
	readonly mimeType: string;
	readonly fileExtension: string;
}

const FORMATS = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);
const REQUEST_FIELDS = Object.freeze([
	'operation', 'format', 'input', 'sampleRate', 'channelCount', 'settings',
	'maximumOutputBytes', 'requestId',
] as const);
const REQUIRED_REQUEST_FIELDS = Object.freeze(REQUEST_FIELDS.filter((field) => field !== 'requestId'));
const RESULT_FIELDS = Object.freeze(['operation', 'bytes', 'metadata', 'requestId'] as const);
const REQUIRED_RESULT_FIELDS = Object.freeze(RESULT_FIELDS.filter((field) => field !== 'requestId'));
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMON_SAMPLE_RATES = new Set([
	8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000,
	88_200, 96_000, 176_400, 192_000,
]);
const MPEG_AUDIO_SAMPLE_RATES = new Set([
	8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000,
]);
const MP2_SAMPLE_RATES = new Set([32_000, 44_100, 48_000]);
const OPUS_SAMPLE_RATES = new Set([8_000, 12_000, 16_000, 24_000, 48_000]);
const MP3_BITRATES = new Set([32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const OPUS_BITRATES = new Set([16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 256]);
const MP2_BITRATES = new Set([32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]);
const AAC_BITRATES = new Set([32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const FORMAT_DESCRIPTORS: Readonly<Record<DesktopAudioCodecFormat, Readonly<FormatDescriptor>>> = Object.freeze({
	flac: Object.freeze({ mimeType: 'audio/flac', fileExtension: '.flac' }),
	mp3: Object.freeze({ mimeType: 'audio/mpeg', fileExtension: '.mp3' }),
	'ogg-vorbis': Object.freeze({ mimeType: 'audio/ogg', fileExtension: '.ogg' }),
	opus: Object.freeze({ mimeType: 'audio/ogg', fileExtension: '.opus' }),
	wavpack: Object.freeze({ mimeType: 'audio/wavpack', fileExtension: '.wv' }),
	mp2: Object.freeze({ mimeType: 'audio/mpeg', fileExtension: '.mp2' }),
	'aac-m4a': Object.freeze({ mimeType: 'audio/mp4', fileExtension: '.m4a' }),
});

export function assertDesktopAudioCodecRequest(value: unknown): asserts value is DesktopAudioCodecRequest {
	const record = exactRecord(value, 'request');
	exactKeys(record, REQUIRED_REQUEST_FIELDS, REQUEST_FIELDS, 'request');
	const operation = record.operation;
	if (operation !== 'audio-decode' && operation !== 'audio-encode') {
		throw new TypeError('The desktop audio codec operation is unsupported.');
	}
	const format = audioFormat(record.format);
	bytes(record.input, DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES, 'input');
	integer(record.maximumOutputBytes, 1, DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES, 'maximum output');
	if (Object.hasOwn(record, 'requestId')) requestId(record.requestId);
	if (operation === 'audio-decode') {
		if (record.sampleRate !== null || record.channelCount !== null) {
			throw new TypeError('Desktop audio decode geometry must be source-authoritative null values.');
		}
		validateDecodeSettings(record.settings);
	} else {
		const sampleRate = integer(
			record.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
			DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'sample rate',
		);
		const channelCount = integer(
			record.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT, 'channel count',
		);
		if (channelCount > maximumChannelCount(format)) {
			throw new RangeError(`The desktop audio ${format} channel count is unsupported.`);
		}
		validateEncodeSampleRate(format, sampleRate);
		validateEncodeSettings(format, record.settings);
		if ((record.input as Uint8Array).byteLength % (Float32Array.BYTES_PER_ELEMENT * channelCount) !== 0) {
			throw new RangeError('The desktop audio codec input must contain complete PCM frames.');
		}
	}
}

export function normalizeDesktopAudioCodecRequest(value: unknown): DesktopAudioCodecRequest {
	assertDesktopAudioCodecRequest(value);
	return Object.freeze({
		operation: value.operation,
		format: value.format,
		input: new Uint8Array(value.input),
		sampleRate: value.sampleRate,
		channelCount: value.channelCount,
		settings: Object.freeze({ ...value.settings }),
		maximumOutputBytes: value.maximumOutputBytes,
		...(value.requestId === undefined ? {} : { requestId: value.requestId }),
	}) as DesktopAudioCodecRequest;
}

export function createDesktopAudioCodecResult(
	request: DesktopAudioCodecRequest,
	outputBytes: Uint8Array,
	decodedGeometry?: DesktopDecodedAudioGeometry,
): DesktopAudioCodecResult {
	assertDesktopAudioCodecRequest(request);
	bytes(outputBytes, request.maximumOutputBytes, 'result bytes');
	const ownedBytes = new Uint8Array(outputBytes);
	if (request.operation === 'audio-decode') {
		const geometry = validateDecodedGeometry(decodedGeometry, request.format, ownedBytes);
		return Object.freeze({
			operation: request.operation, bytes: ownedBytes,
			metadata: Object.freeze({
				kind: 'decoded-audio', sourceFormat: request.format, sampleFormat: 'f32le',
				interleaving: 'interleaved', ...geometry,
			}),
			...(request.requestId === undefined ? {} : { requestId: request.requestId }),
		});
	}
	const descriptor = FORMAT_DESCRIPTORS[request.format];
	return Object.freeze({
		operation: request.operation, bytes: ownedBytes,
		metadata: Object.freeze({
			kind: 'encoded-audio', format: request.format, mimeType: descriptor.mimeType,
			fileExtension: descriptor.fileExtension, sampleRate: request.sampleRate,
			channelCount: request.channelCount,
			frameCount: request.input.byteLength / (Float32Array.BYTES_PER_ELEMENT * request.channelCount),
			...(request.format === 'flac' ? {
				sourceSampleFormat: 'f32le' as const,
				encodedSampleFormat: `s${String(request.settings.bitDepth)}` as 's16' | 's24',
				pcmConversion: `clamp-unit-range-to-signed-${String(request.settings.bitDepth)}` as
					'clamp-unit-range-to-signed-16' | 'clamp-unit-range-to-signed-24',
			} : {}),
		}),
		...(request.requestId === undefined ? {} : { requestId: request.requestId }),
	});
}

function validateDecodedGeometry(
	value: unknown,
	format: DesktopAudioCodecFormat,
	output: Uint8Array,
): DesktopDecodedAudioGeometry {
	const geometry = exactRecord(value, 'decoded geometry');
	const fields = ['sampleRate', 'channelCount', 'frameCount'];
	exactKeys(geometry, fields, fields, 'decoded geometry');
	const sampleRate = integer(
		geometry.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'decoded sample rate',
	);
	const channelCount = integer(
		geometry.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
		'decoded channel count',
	);
	if (channelCount > maximumChannelCount(format)) {
		throw new RangeError(`The decoded desktop audio ${format} channel count is unsupported.`);
	}
	const frameCount = integer(geometry.frameCount, 1, Number.MAX_SAFE_INTEGER, 'decoded frame count');
	if (frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT !== output.byteLength) {
		throw new RangeError('The decoded desktop audio frame count is invalid.');
	}
	return Object.freeze({ sampleRate, channelCount, frameCount });
}

export function assertDesktopAudioCodecResult(
	value: unknown,
	maximumBytes = DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
): asserts value is DesktopAudioCodecResult {
	integer(maximumBytes, 1, DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES, 'result byte bound');
	const record = exactRecord(value, 'result');
	exactKeys(record, REQUIRED_RESULT_FIELDS, RESULT_FIELDS, 'result');
	bytes(record.bytes, maximumBytes, 'result bytes');
	if (Object.hasOwn(record, 'requestId')) requestId(record.requestId);
	if (record.operation === 'audio-decode') validateDecodedMetadata(record.metadata, record.bytes as Uint8Array);
	else if (record.operation === 'audio-encode') validateEncodedMetadata(record.metadata);
	else throw new TypeError('The desktop audio codec result operation is unsupported.');
}

export function normalizeDesktopAudioCodecResult(
	value: unknown,
	maximumBytes = DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
): DesktopAudioCodecResult {
	assertDesktopAudioCodecResult(value, maximumBytes);
	return Object.freeze({
		operation: value.operation, bytes: new Uint8Array(value.bytes),
		metadata: Object.freeze({ ...value.metadata }),
		...(value.requestId === undefined ? {} : { requestId: value.requestId }),
	}) as DesktopAudioCodecResult;
}

export function getDesktopAudioFormatDescriptor(format: DesktopAudioCodecFormat): Readonly<FormatDescriptor> {
	return FORMAT_DESCRIPTORS[audioFormat(format)];
}

function validateDecodeSettings(value: unknown): void {
	const settings = exactRecord(value, 'decode settings');
	exactKeys(settings, ['sampleFormat'], ['sampleFormat'], 'decode settings');
	if (settings.sampleFormat !== 'f32le') {
		throw new TypeError('The desktop audio decode sample format must be f32le.');
	}
}

function validateEncodeSettings(format: DesktopAudioCodecFormat, value: unknown): void {
	const settings = exactRecord(value, `${format} encode settings`);
	if (format === 'flac') {
		exactKeys(settings, ['compressionLevel', 'bitDepth'], ['compressionLevel', 'bitDepth'], 'flac encode settings');
		integer(settings.compressionLevel, 0, 12, 'flac compression level');
		if (settings.bitDepth !== 16 && settings.bitDepth !== 24) {
			throw new RangeError('The desktop audio FLAC bit depth must be 16 or 24.');
		}
		return;
	}
	if (format === 'wavpack') {
		exactKeys(settings, ['compressionLevel'], ['compressionLevel'], `${format} encode settings`);
		integer(settings.compressionLevel, 0, 8, `${format} compression level`);
		return;
	}
	if (format === 'ogg-vorbis') {
		exactKeys(settings, ['quality'], ['quality'], 'ogg-vorbis encode settings');
		integer(settings.quality, 0, 10, 'ogg-vorbis quality');
		return;
	}
	exactKeys(settings, ['bitrateKbps'], ['bitrateKbps'], `${format} encode settings`);
	const permitted = format === 'mp3' ? MP3_BITRATES
		: format === 'opus' ? OPUS_BITRATES
			: format === 'mp2' ? MP2_BITRATES : AAC_BITRATES;
	if (!Number.isSafeInteger(settings.bitrateKbps) || !permitted.has(Number(settings.bitrateKbps))) {
		throw new RangeError(`The desktop audio ${format} bitrate is unsupported.`);
	}
}

function validateEncodeSampleRate(format: DesktopAudioCodecFormat, sampleRate: number): void {
	const permitted = format === 'opus' ? OPUS_SAMPLE_RATES
		: format === 'mp2' ? MP2_SAMPLE_RATES
			: format === 'mp3' ? MPEG_AUDIO_SAMPLE_RATES : COMMON_SAMPLE_RATES;
	if (!permitted.has(sampleRate)) {
		throw new RangeError(`The desktop audio ${format} sample rate is unsupported.`);
	}
}

function validateDecodedMetadata(value: unknown, output: Uint8Array): void {
	const metadata = exactRecord(value, 'decoded result metadata');
	const fields = ['kind', 'sourceFormat', 'sampleFormat', 'interleaving', 'sampleRate', 'channelCount', 'frameCount'];
	exactKeys(metadata, fields, fields, 'decoded result metadata');
	if (metadata.kind !== 'decoded-audio' || metadata.sampleFormat !== 'f32le'
		|| metadata.interleaving !== 'interleaved') {
		throw new TypeError('The decoded desktop audio metadata representation is invalid.');
	}
	const sourceFormat = audioFormat(metadata.sourceFormat);
	integer(metadata.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'decoded sample rate');
	const channels = integer(metadata.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
		'decoded channel count');
	if (channels > maximumChannelCount(sourceFormat)) {
		throw new RangeError('The decoded desktop audio channel count is unsupported.');
	}
	const bytesPerFrame = Float32Array.BYTES_PER_ELEMENT * channels;
	if (output.byteLength % bytesPerFrame !== 0
		|| metadata.frameCount !== output.byteLength / bytesPerFrame) {
		throw new RangeError('The decoded desktop audio frame count is invalid.');
	}
}

function validateEncodedMetadata(value: unknown): void {
	const metadata = exactRecord(value, 'encoded result metadata');
	if (metadata.kind !== 'encoded-audio') {
		throw new TypeError('The encoded desktop audio metadata kind is invalid.');
	}
	const format = audioFormat(metadata.format);
	const fields = [
		'kind', 'format', 'mimeType', 'fileExtension', 'sampleRate', 'channelCount', 'frameCount',
		...(format === 'flac' ? ['sourceSampleFormat', 'encodedSampleFormat', 'pcmConversion'] : []),
	];
	exactKeys(metadata, fields, fields, 'encoded result metadata');
	const descriptor = FORMAT_DESCRIPTORS[format];
	if (metadata.mimeType !== descriptor.mimeType || metadata.fileExtension !== descriptor.fileExtension) {
		throw new TypeError('The encoded desktop audio metadata format descriptor is invalid.');
	}
	integer(metadata.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'encoded sample rate');
	const channels = integer(metadata.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT, 'encoded channel count');
	if (channels > maximumChannelCount(format)) {
		throw new RangeError('The encoded desktop audio channel count is unsupported.');
	}
	integer(metadata.frameCount, 1, Number.MAX_SAFE_INTEGER, 'encoded frame count');
	if (format === 'flac' && (metadata.sourceSampleFormat !== 'f32le'
		|| (metadata.encodedSampleFormat !== 's16' && metadata.encodedSampleFormat !== 's24')
		|| metadata.pcmConversion !== `clamp-unit-range-to-signed-${String(metadata.encodedSampleFormat).slice(1)}`)) {
		throw new TypeError('The encoded FLAC PCM conversion report is invalid.');
	}
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The desktop audio codec ${label} must be a plain record.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).some((key) => {
		const descriptor = descriptors[key as keyof typeof descriptors];
		return descriptor !== undefined && !Object.hasOwn(descriptor, 'value');
	})) throw new TypeError(`The desktop audio codec ${label} must contain only data properties.`);
	return value as Record<string, unknown>;
}

function maximumChannelCount(format: DesktopAudioCodecFormat): number {
	return format === 'mp3' || format === 'mp2' ? 2 : DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT;
}

function exactKeys(
	record: Record<string, unknown>, required: readonly string[], permitted: readonly string[], label: string,
): void {
	const keys = Reflect.ownKeys(record);
	if (required.some((field) => !Object.hasOwn(record, field))
		|| keys.some((key) => typeof key !== 'string' || !permitted.includes(key))) {
		throw new TypeError(`The desktop audio codec ${label} has an inexact shape.`);
	}
}

function audioFormat(value: unknown): DesktopAudioCodecFormat {
	if (typeof value !== 'string' || !FORMATS.has(value)) {
		throw new TypeError('The desktop audio codec format is unsupported.');
	}
	return value as DesktopAudioCodecFormat;
}

function bytes(value: unknown, maximum: number, label: string): asserts value is Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum) {
		throw new RangeError(`The desktop audio codec ${label} must be a non-empty bounded Uint8Array.`);
	}
}

function requestId(value: unknown): string {
	if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
		throw new TypeError('The desktop audio codec request ID is invalid.');
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The desktop audio codec ${label} is outside its bound.`);
	}
	return Number(value);
}
