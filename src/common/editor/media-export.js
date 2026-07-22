const MAX_EXPORT_CHANNELS = 32;
const MAX_METADATA_FIELDS = 32;
const MAX_METADATA_VALUE_LENGTH = 4_096;
const MAX_CUSTOM_ARGUMENTS = 64;
const MAX_CUSTOM_ARGUMENT_LENGTH = 256;

/**
 * The checked-in FFmpeg package is the single-threaded upstream wasm core. Its
 * build configuration enables LAME, libvorbis, and libopus; FFmpeg's native
 * FLAC, WavPack, MP2, and AAC encoders are also present. Keeping this profile
 * explicit lets a later custom core replace it without changing export plans.
 */
export const BUNDLED_FFMPEG_EXPORT_PROFILE = deepFreeze({
	id: '@ffmpeg/core@0.12.10',
	singleThreaded: true,
	encoders: ['aac', 'flac', 'libmp3lame', 'libopus', 'libvorbis', 'mp2', 'wavpack'],
	muxers: ['flac', 'ipod', 'mp2', 'mp3', 'ogg', 'opus', 'wv'],
});

/**
 * @typedef {'wav'|'aiff'|'flac'|'mp3'|'ogg-vorbis'|'opus'|'wavpack'|'mp2'|'aac-m4a'|'custom-ffmpeg'} MediaExportFormatId
 * @typedef {'native-wav'|'native-aiff'|'ffmpeg'|'custom-ffmpeg'} MediaExportBackend
 * @typedef {'int16'|'int24'|'int32'|'float32'} MediaExportSampleFormat
 * @typedef {'none'|'triangular'|'triangular-highpass'} MediaExportDither
 * @typedef {{channel: number, gain: number}} MediaChannelContribution
 * @typedef {{inputs: MediaChannelContribution[]}} MediaOutputChannel
 * @typedef {{inputChannelCount: number, outputChannelCount: number, mode: string, channels: MediaOutputChannel[]}} MediaChannelMapping
 * @typedef {{available: boolean, reason: string|null, missingEncoders: string[], missingMuxers: string[]}} MediaExportFormatCapability
 */

/** @type {Readonly<Record<MediaExportFormatId, Object>>} */
export const MEDIA_EXPORT_FORMATS = deepFreeze({
	wav: {
		id: 'wav', label: 'WAV', backend: 'native-wav', extension: 'wav', mimeType: 'audio/wav',
		container: 'WAV', codec: 'PCM', lossless: true, maximumChannels: 32,
		sampleFormats: ['int16', 'int24', 'float32'], defaults: { sampleFormat: 'int24' },
	},
	aiff: {
		id: 'aiff', label: 'AIFF', backend: 'native-aiff', extension: 'aiff', mimeType: 'audio/aiff',
		container: 'AIFF/AIFF-C', codec: 'PCM', lossless: true, maximumChannels: 32,
		sampleFormats: ['int16', 'int24', 'int32', 'float32'], defaults: { sampleFormat: 'int24' },
	},
	flac: {
		id: 'flac', label: 'FLAC', backend: 'ffmpeg', extension: 'flac', mimeType: 'audio/flac',
		container: 'FLAC', codec: 'flac', lossless: true, maximumChannels: 8,
		sampleFormats: ['int16', 'int24'], defaults: { sampleFormat: 'int24', compressionLevel: 5 },
		requiredEncoders: ['flac'], requiredMuxers: [['flac']],
	},
	mp3: {
		id: 'mp3', label: 'MP3', backend: 'ffmpeg', extension: 'mp3', mimeType: 'audio/mpeg',
		container: 'MP3', codec: 'libmp3lame', lossless: false, maximumChannels: 2,
		sampleFormats: [], defaults: { bitRate: 192 },
		requiredEncoders: ['libmp3lame'], requiredMuxers: [['mp3']],
	},
	'ogg-vorbis': {
		id: 'ogg-vorbis', label: 'Ogg Vorbis', backend: 'ffmpeg', extension: 'ogg', mimeType: 'audio/ogg; codecs=vorbis',
		container: 'Ogg', codec: 'libvorbis', lossless: false, maximumChannels: 8,
		sampleFormats: [], defaults: { quality: 5 },
		requiredEncoders: ['libvorbis'], requiredMuxers: [['ogg']],
	},
	opus: {
		id: 'opus', label: 'Opus', backend: 'ffmpeg', extension: 'opus', mimeType: 'audio/ogg; codecs=opus',
		container: 'Ogg Opus', codec: 'libopus', lossless: false, maximumChannels: 8,
		sampleFormats: [], defaults: { bitRate: 160 },
		requiredEncoders: ['libopus'], requiredMuxers: [['opus', 'ogg']],
	},
	wavpack: {
		id: 'wavpack', label: 'WavPack', backend: 'ffmpeg', extension: 'wv', mimeType: 'audio/x-wavpack',
		container: 'WavPack', codec: 'wavpack', lossless: true, maximumChannels: 8,
		sampleFormats: ['int16', 'int24', 'int32', 'float32'], defaults: { sampleFormat: 'int24', compressionLevel: 2 },
		requiredEncoders: ['wavpack'], requiredMuxers: [['wv']],
	},
	mp2: {
		id: 'mp2', label: 'MP2', backend: 'ffmpeg', extension: 'mp2', mimeType: 'audio/mpeg',
		container: 'MPEG audio', codec: 'mp2', lossless: false, maximumChannels: 2,
		sampleFormats: [], defaults: { bitRate: 256 },
		requiredEncoders: ['mp2'], requiredMuxers: [['mp2']],
	},
	'aac-m4a': {
		id: 'aac-m4a', label: 'AAC / M4A', backend: 'ffmpeg', extension: 'm4a', mimeType: 'audio/mp4',
		container: 'M4A', codec: 'aac', lossless: false, maximumChannels: 8,
		sampleFormats: [], defaults: { bitRate: 192 },
		requiredEncoders: ['aac'], requiredMuxers: [['ipod', 'mp4']],
	},
	'custom-ffmpeg': {
		id: 'custom-ffmpeg', label: 'Custom FFmpeg', backend: 'custom-ffmpeg', extension: null, mimeType: 'application/octet-stream',
		container: 'Custom', codec: 'Custom', lossless: null, maximumChannels: 32,
		sampleFormats: ['int16', 'int24', 'int32', 'float32'], defaults: { sampleFormat: 'float32' },
		requiredEncoders: [], requiredMuxers: [],
	},
});

const FORMAT_ALIASES = Object.freeze({
	aif: 'aiff',
	ogg: 'ogg-vorbis',
	vorbis: 'ogg-vorbis',
	m4a: 'aac-m4a',
	aac: 'aac-m4a',
	custom: 'custom-ffmpeg',
});

const BIT_RATES = Object.freeze({
	mp3: [128, 192, 256, 320],
	opus: [64, 96, 128, 160, 192, 256, 320],
	mp2: [128, 160, 192, 224, 256, 320, 384],
	'aac-m4a': [96, 128, 160, 192, 256, 320],
});

export class MediaExportUnavailableError extends Error {
	constructor(format, reason) {
		const descriptor = getMediaExportFormat(format);
		super(`${descriptor.label} export is unavailable: ${reason || 'the required encoder is not available'}.`);
		this.name = 'MediaExportUnavailableError';
		this.code = 'MEDIA_EXPORT_UNAVAILABLE';
		this.format = descriptor.id;
		this.reason = reason || 'unavailable';
	}
}

/** @returns {Readonly<Object>} */
export function getMediaExportFormat(format) {
	const id = canonicalMediaExportFormat(format);
	const descriptor = MEDIA_EXPORT_FORMATS[id];
	if (!descriptor) throw new RangeError(`Unsupported export format: ${format}.`);
	return descriptor;
}

/** @returns {MediaExportFormatId} */
export function canonicalMediaExportFormat(format) {
	const value = String(format || 'wav').trim().toLowerCase();
	return /** @type {MediaExportFormatId} */ (FORMAT_ALIASES[value] || value);
}

/**
 * Builds a serializable capability report. A runtime probe can pass exact
 * encoder/muxer sets; otherwise the pinned bundled-core profile is used.
 */
export function createMediaExportCapabilities(options = {}) {
	const ffmpegAvailable = options.ffmpegAvailable !== false;
	const profile = options.profile || BUNDLED_FFMPEG_EXPORT_PROFILE;
	const encoders = new Set(options.encoders || profile.encoders || []);
	const muxers = new Set(options.muxers || profile.muxers || []);
	const checkMuxers = options.muxers != null || profile.muxers != null;
	const formats = {};

	for (const descriptor of Object.values(MEDIA_EXPORT_FORMATS)) {
		let reason = null;
		const missingEncoders = [];
		const missingMuxers = [];
		if (descriptor.backend === 'ffmpeg' || descriptor.backend === 'custom-ffmpeg') {
			if (!ffmpegAvailable) {
				reason = 'FFmpeg core could not be loaded';
			} else {
				for (const encoder of descriptor.requiredEncoders || []) {
					if (!encoders.has(encoder)) missingEncoders.push(encoder);
				}
				if (checkMuxers) {
					for (const alternatives of descriptor.requiredMuxers || []) {
						if (!alternatives.some((muxer) => muxers.has(muxer))) missingMuxers.push(alternatives.join('|'));
					}
				}
				if (missingEncoders.length) reason = `missing FFmpeg encoder ${missingEncoders.join(', ')}`;
				else if (missingMuxers.length) reason = `missing FFmpeg muxer ${missingMuxers.join(', ')}`;
			}
		}
		formats[descriptor.id] = Object.freeze({
			available: reason === null,
			reason,
			missingEncoders: Object.freeze(missingEncoders),
			missingMuxers: Object.freeze(missingMuxers),
		});
	}

	return Object.freeze({
		profileId: String(profile.id || 'runtime-probe'),
		ffmpegAvailable,
		encoders: Object.freeze([...encoders].sort()),
		muxers: Object.freeze([...muxers].sort()),
		formats: Object.freeze(formats),
	});
}

export function getMediaExportCapability(format, capabilities = createMediaExportCapabilities()) {
	const descriptor = getMediaExportFormat(format);
	const report = capabilities?.formats ? capabilities : createMediaExportCapabilities(capabilities || {});
	return report.formats[descriptor.id];
}

export function assertMediaExportAvailable(format, capabilities = createMediaExportCapabilities()) {
	const capability = getMediaExportCapability(format, capabilities);
	if (!capability?.available) throw new MediaExportUnavailableError(format, capability?.reason);
	return capability;
}

export function listMediaExportFormats(capabilities = createMediaExportCapabilities()) {
	const report = capabilities?.formats ? capabilities : createMediaExportCapabilities(capabilities || {});
	return Object.values(MEDIA_EXPORT_FORMATS).map((descriptor) => Object.freeze({
		...descriptor,
		capability: report.formats[descriptor.id],
	}));
}

/**
 * Normalizes codec, mapping, dither, and metadata settings into a stable plan
 * shared by native encoders and the FFmpeg adapter.
 */
export function normalizeMediaExportSettings(format, options = {}) {
	const descriptor = getMediaExportFormat(format);
	if (options.capabilities) assertMediaExportAvailable(descriptor.id, options.capabilities);
	const sampleRate = integerInRange(options.sampleRate ?? 48_000, 8_000, 384_000, 'Export sample rate');
	const inputChannelCount = integerInRange(options.inputChannelCount ?? 2, 1, MAX_EXPORT_CHANNELS, 'Input channel count');
	let requestedMapping = options.channelMapping;
	if (requestedMapping == null && options.channelCount != null && Number(options.channelCount) !== inputChannelCount) {
		if (Number(options.channelCount) === 1) requestedMapping = 'mono';
		else if (Number(options.channelCount) === 2) requestedMapping = 'stereo';
		else throw new RangeError('A custom channel mapping is required for this output channel count.');
	}
	const channelMapping = normalizeMediaChannelMapping(inputChannelCount, requestedMapping);
	if (channelMapping.outputChannelCount > descriptor.maximumChannels) {
		throw new RangeError(`${descriptor.label} supports at most ${descriptor.maximumChannels} output channels.`);
	}

	const sampleFormat = normalizeSampleFormat(descriptor, options);
	const dither = normalizeDither(options.dither, Boolean(sampleFormat && sampleFormat !== 'float32'));
	const metadata = normalizeMediaMetadata(options.metadata);
	const settings = {
		format: descriptor.id,
		backend: descriptor.backend,
		extension: descriptor.extension,
		mimeType: descriptor.mimeType,
		sampleRate,
		inputChannelCount,
		channelCount: channelMapping.outputChannelCount,
		channelMapping,
		sampleFormat,
		bitDepth: sampleFormat ? Number(sampleFormat.replace(/\D/g, '')) : null,
		floatingPoint: sampleFormat === 'float32',
		dither,
		metadata,
	};

	if (descriptor.id === 'flac') {
		settings.compressionLevel = integerInRange(options.compressionLevel ?? descriptor.defaults.compressionLevel, 0, 8, 'FLAC compression level');
	} else if (descriptor.id === 'wavpack') {
		settings.compressionLevel = integerInRange(options.compressionLevel ?? descriptor.defaults.compressionLevel, 0, 5, 'WavPack compression level');
	} else if (descriptor.id === 'ogg-vorbis') {
		settings.quality = numberInRange(options.quality ?? descriptor.defaults.quality, -1, 10, 'Vorbis quality');
	} else if (BIT_RATES[descriptor.id]) {
		settings.bitRate = allowedNumber(options.bitRate ?? descriptor.defaults.bitRate, BIT_RATES[descriptor.id], `${descriptor.label} bitrate`);
	}

	if (descriptor.id === 'custom-ffmpeg') {
		settings.extension = normalizeExtension(options.extension || options.outputExtension);
		settings.mimeType = normalizeMimeType(options.mimeType);
		settings.customArguments = normalizeCustomFfmpegArguments(options.customArguments || options.arguments);
		if (!settings.customArguments.length) throw new RangeError('Custom FFmpeg export requires at least one output argument.');
	}
	return Object.freeze(settings);
}

/** @returns {MediaChannelMapping} */
export function normalizeMediaChannelMapping(inputChannelCount, value = 'preserve') {
	const inputCount = integerInRange(inputChannelCount, 1, MAX_EXPORT_CHANNELS, 'Input channel count');
	if (value == null || value === 'preserve') {
		return freezeMapping(inputCount, 'preserve', Array.from({ length: inputCount }, (_, channel) => ({ inputs: [{ channel, gain: 1 }] })));
	}
	if (value === 'mono') {
		const gain = 1 / inputCount;
		return freezeMapping(inputCount, 'mono', [{ inputs: Array.from({ length: inputCount }, (_, channel) => ({ channel, gain })) }]);
	}
	if (value === 'stereo') {
		if (inputCount === 1) return freezeMapping(inputCount, 'stereo', [0, 0].map(() => ({ inputs: [{ channel: 0, gain: 1 }] })));
		return freezeMapping(inputCount, 'stereo', [0, 1].map((channel) => ({ inputs: [{ channel, gain: 1 }] })));
	}

	const rawChannels = Array.isArray(value) ? value : value?.channels;
	if (!Array.isArray(rawChannels) || rawChannels.length < 1 || rawChannels.length > MAX_EXPORT_CHANNELS) {
		throw new RangeError('A custom channel mapping must contain 1 to 32 output channels.');
	}
	const channels = rawChannels.map((channel, outputIndex) => normalizeOutputChannel(channel, inputCount, outputIndex));
	return freezeMapping(inputCount, 'custom', channels);
}

export function mediaChannelMappingToFfmpegFilter(mapping) {
	const normalized = normalizeMediaChannelMapping(mapping?.inputChannelCount, mapping);
	const expressions = normalized.channels.map((output, index) => {
		const expression = output.inputs.length
			? output.inputs.map(({ channel, gain }) => `${formatGain(gain)}*c${channel}`).join('+')
			: '0*c0';
		return `c${index}=${expression}`;
	});
	return `pan=${normalized.outputChannelCount}c|${expressions.join('|')}`;
}

/** Applies an already-bounded mapping to planar Float32 PCM. */
export function applyMediaChannelMapping(inputChannels, mapping = 'preserve') {
	if (!Array.isArray(inputChannels) || !inputChannels.length) throw new TypeError('Planar input channels are required.');
	const channels = inputChannels.map((channel, index) => {
		if (!(channel instanceof Float32Array)) throw new TypeError(`Input channel ${index} must be Float32 PCM.`);
		return channel;
	});
	const frameCount = channels[0].length;
	if (channels.some((channel) => channel.length !== frameCount)) throw new RangeError('All input channels must have the same frame count.');
	const normalized = normalizeMediaChannelMapping(channels.length, mapping);
	return normalized.channels.map((output) => {
		const result = new Float32Array(frameCount);
		for (const { channel, gain } of output.inputs) {
			const source = channels[channel];
			for (let frame = 0; frame < frameCount; frame += 1) result[frame] += source[frame] * gain;
		}
		return result;
	});
}

export function normalizeMediaMetadata(value = {}) {
	if (value == null) return Object.freeze({});
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Export metadata must be an object.');
	const entries = Object.entries(value).filter(([, item]) => item != null && String(item) !== '');
	if (entries.length > MAX_METADATA_FIELDS) throw new RangeError(`Export metadata supports at most ${MAX_METADATA_FIELDS} fields.`);
	const result = {};
	for (const [rawKey, rawValue] of entries) {
		const key = String(rawKey).trim();
		if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new RangeError(`Invalid metadata field name: ${rawKey}.`);
		const text = String(rawValue);
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new RangeError(`Metadata field ${key} contains control characters.`);
		if (text.length > MAX_METADATA_VALUE_LENGTH) throw new RangeError(`Metadata field ${key} is too long.`);
		result[key] = text;
	}
	return Object.freeze(result);
}

export function mediaMetadataToFfmpegArgs(metadata = {}) {
	const normalized = normalizeMediaMetadata(metadata);
	return Object.entries(normalized).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
}

/**
 * Validates the target rate shared by the FFmpeg decoder and the V2 project
 * model. The default remains 48 kHz for standalone callers, while the editor
 * passes its current project rate explicitly.
 */
export function normalizeMediaDecodeSampleRate(value = 48_000) {
	return integerInRange(value, 8_000, 384_000, 'Decode sample rate');
}

/** Pure command builder used by the lazy FFmpeg import fallback. */
export function buildMediaFfmpegDecoderArgs(input, output, options = {}) {
	const sampleRate = options.sampleRate === null
		? null
		: normalizeMediaDecodeSampleRate(options.sampleRate);
	const channelCount = options.channelCount === null
		? null
		: integerInRange(options.channelCount ?? 2, 1, MAX_EXPORT_CHANNELS, 'Decode channel count');
	const outputFormat = options.outputFormat ?? 'f32le';
	if (outputFormat !== 'f32le' && outputFormat !== 'wav') {
		throw new RangeError('Decode output format must be f32le or wav.');
	}
	const args = ['-i', String(input), '-vn', '-map', '0:a:0'];
	if (channelCount !== null) args.push('-ac', String(channelCount));
	if (sampleRate !== null) args.push('-ar', String(sampleRate));
	args.push('-c:a', 'pcm_f32le', '-f', outputFormat, '-y', String(output));
	return args;
}

/** Pure command builder used by the lazy FFmpeg runtime. */
export function buildMediaFfmpegEncoderArgs(input, output, format, options = {}) {
	const settings = normalizeMediaExportSettings(format, options);
	const descriptor = getMediaExportFormat(settings.format);
	if (descriptor.backend !== 'ffmpeg' && descriptor.backend !== 'custom-ffmpeg') {
		throw new RangeError(`${descriptor.label} uses a native encoder, not FFmpeg.`);
	}
	const args = ['-i', String(input), '-vn', '-map_metadata', '-1', '-ar', String(settings.sampleRate)];
	const filters = [];
	if (settings.channelMapping?.mode !== 'preserve') filters.push(mediaChannelMappingToFfmpegFilter(settings.channelMapping));
	if (options.applyDither === true && settings.dither !== 'none') {
		const method = settings.dither === 'triangular-highpass' ? 'triangular_hp' : 'triangular';
		filters.push(`aresample=dither_method=${method}`);
	}
	if (filters.length) args.push('-filter:a', filters.join(','));
	args.push('-ac', String(settings.channelCount));

	if (descriptor.id === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${settings.bitRate}k`, '-f', 'mp3');
	else if (descriptor.id === 'flac') args.push('-c:a', 'flac', '-sample_fmt', settings.sampleFormat === 'int16' ? 's16' : 's32', '-compression_level', String(settings.compressionLevel), '-f', 'flac');
	else if (descriptor.id === 'ogg-vorbis') args.push('-c:a', 'libvorbis', '-q:a', String(settings.quality), '-f', 'ogg');
	else if (descriptor.id === 'opus') args.push('-c:a', 'libopus', '-b:a', `${settings.bitRate}k`, '-vbr', 'on', '-f', 'ogg');
	else if (descriptor.id === 'wavpack') args.push('-c:a', 'wavpack', '-sample_fmt', ffmpegSampleFormat(settings.sampleFormat), '-compression_level', String(settings.compressionLevel), '-f', 'wv');
	else if (descriptor.id === 'mp2') args.push('-c:a', 'mp2', '-b:a', `${settings.bitRate}k`, '-f', 'mp2');
	else if (descriptor.id === 'aac-m4a') args.push('-c:a', 'aac', '-b:a', `${settings.bitRate}k`, '-movflags', '+faststart', '-f', 'ipod');
	else args.push(...settings.customArguments);

	args.push(...mediaMetadataToFfmpegArgs(settings.metadata));
	args.push('-y', String(output));
	return args;
}

function normalizeSampleFormat(descriptor, options) {
	if (!descriptor.sampleFormats.length) return null;
	let value = options.sampleFormat;
	if (!value && options.bitDepth != null) {
		const bitDepth = Number(options.bitDepth);
		if (bitDepth === 16) value = 'int16';
		else if (bitDepth === 24) value = 'int24';
		else if (bitDepth === 32) value = options.floatingPoint === false && descriptor.sampleFormats.includes('int32') ? 'int32' : 'float32';
	}
	value ||= descriptor.defaults.sampleFormat;
	if (!descriptor.sampleFormats.includes(value)) {
		throw new RangeError(`${descriptor.label} does not support the ${value} sample format.`);
	}
	return value;
}

function normalizeDither(value, defaultEnabled) {
	if (value == null) return defaultEnabled ? 'triangular' : 'none';
	if (value === true) return 'triangular';
	if (value === false) return 'none';
	if (!['none', 'triangular', 'triangular-highpass'].includes(value)) throw new RangeError(`Unsupported dither mode: ${value}.`);
	return value;
}

function normalizeOutputChannel(value, inputCount, outputIndex) {
	if (Number.isInteger(value)) return { inputs: [{ channel: integerInRange(value, 0, inputCount - 1, `Output channel ${outputIndex} input`), gain: 1 }] };
	if (Array.isArray(value)) {
		if (value.length !== inputCount || value.some((gain) => !Number.isFinite(Number(gain)))) {
			throw new RangeError(`Output channel ${outputIndex} must provide one finite gain per input channel.`);
		}
		return { inputs: value.map((gain, channel) => ({ channel, gain: gainInRange(gain, outputIndex) })).filter(({ gain }) => gain !== 0) };
	}
	if (!value || typeof value !== 'object' || !Array.isArray(value.inputs)) throw new TypeError(`Output channel ${outputIndex} is invalid.`);
	return {
		inputs: value.inputs.map((input, inputIndex) => ({
			channel: integerInRange(input?.channel, 0, inputCount - 1, `Output channel ${outputIndex} input ${inputIndex}`),
			gain: gainInRange(input?.gain ?? 1, outputIndex),
		})),
	};
}

function freezeMapping(inputChannelCount, mode, channels) {
	const frozenChannels = channels.map((channel) => Object.freeze({
		inputs: Object.freeze(channel.inputs.map((input) => Object.freeze({ ...input }))),
	}));
	return Object.freeze({
		inputChannelCount,
		outputChannelCount: frozenChannels.length,
		mode,
		channels: Object.freeze(frozenChannels),
	});
}

function gainInRange(value, outputIndex) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < -8 || number > 8) throw new RangeError(`Output channel ${outputIndex} gain must be between -8 and 8.`);
	return number;
}

function formatGain(value) {
	if (Object.is(value, -0)) return '0';
	return Number(value.toFixed(8)).toString();
}

function normalizeCustomFfmpegArguments(value) {
	if (!Array.isArray(value)) throw new TypeError('Custom FFmpeg arguments must be an array.');
	if (value.length > MAX_CUSTOM_ARGUMENTS) throw new RangeError(`Custom FFmpeg export supports at most ${MAX_CUSTOM_ARGUMENTS} arguments.`);
	const forbidden = new Set(['-i', '-y', '-n', '-progress', '-report']);
	return Object.freeze(value.map((item, index) => {
		const argument = String(item);
		if (!argument || argument.length > MAX_CUSTOM_ARGUMENT_LENGTH || /[\u0000\r\n]/.test(argument)) {
			throw new RangeError(`Custom FFmpeg argument ${index} is invalid.`);
		}
		if (forbidden.has(argument) || /^(?:https?|ftp|file|concat|crypto|data):/i.test(argument)) {
			throw new RangeError(`Custom FFmpeg argument ${argument} is not allowed.`);
		}
		return argument;
	}));
}

function normalizeExtension(value) {
	const extension = String(value || '').trim().replace(/^\./, '').toLowerCase();
	if (!/^[a-z0-9]{1,10}$/.test(extension)) throw new RangeError('A custom export extension of 1 to 10 letters or digits is required.');
	return extension;
}

function normalizeMimeType(value) {
	const mimeType = String(value || 'application/octet-stream').trim().toLowerCase();
	if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) throw new RangeError('The custom export MIME type is invalid.');
	return mimeType;
}

function ffmpegSampleFormat(value) {
	if (value === 'int16') return 's16';
	if (value === 'float32') return 'flt';
	return 's32';
}

function integerInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	return number;
}

function numberInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be from ${minimum} to ${maximum}.`);
	return number;
}

function allowedNumber(value, allowed, name) {
	const number = Number(value);
	if (!allowed.includes(number)) throw new RangeError(`${name} must be one of ${allowed.join(', ')} kbps.`);
	return number;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
