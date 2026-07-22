import { projectEffectTailFrames } from './effects.js';
import {
	AUDIO_EDITOR_MASTER_CHANNELS,
	AUDIO_EDITOR_SAMPLE_RATE,
	aggregateStereoMinutes,
	projectDurationFrames,
	normalizeFrameRange,
} from './project.js';
import {
	canonicalMediaExportFormat,
	getMediaExportFormat,
	normalizeMediaExportSettings,
} from './media-export.js';

export const EXPORT_FORMAT_DEFAULTS = Object.freeze({
	wav: { bitDepth: 24 },
	aiff: { bitDepth: 24 },
	flac: { bitDepth: 24, compressionLevel: 5 },
	mp3: { bitRate: 192 },
	'ogg-vorbis': { quality: 5 },
	opus: { bitRate: 160 },
	wavpack: { bitDepth: 24, compressionLevel: 2 },
	mp2: { bitRate: 256 },
	'aac-m4a': { bitRate: 192 },
	'custom-ffmpeg': {},
});

export const FAST_RENDER_THRESHOLDS = Object.freeze({
	mobile: { outputBytes: 96 * 1024 ** 2, totalBytes: 320 * 1024 ** 2 },
	desktop: { outputBytes: 384 * 1024 ** 2, totalBytes: 1024 * 1024 ** 2 },
});

/**
 * @typedef {Object} AudioExportPlan
 * @property {'mix' | 'stems'} mode
 * @property {import('./media-export.js').MediaExportFormatId} format
 * @property {number} sampleRate
 * @property {number} outputFrames
 * @property {number} outputBytesPerRender
 * @property {{ strategy: 'offline' | 'realtime-stream', fast: boolean }} render
 * @property {Array<{kind: string, fileName: string, trackId: string | null}>} outputs
 */

export function estimatePcmBytes(frameCount, channelCount = AUDIO_EDITOR_MASTER_CHANNELS, bytesPerSample = 4) {
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new RangeError('PCM frame count must be a non-negative integer.');
	if (!Number.isInteger(channelCount) || channelCount <= 0) throw new RangeError('PCM channel count must be positive.');
	return frameCount * channelCount * bytesPerSample;
}

export function estimateProjectPcmBytes(project) {
	return project.sources
		.filter((source) => source.kind !== 'video')
		.reduce((bytes, source) => bytes + estimatePcmBytes(source.frameCount, source.channelCount), 0);
}

export function chooseRenderStrategy(options = {}) {
	const thresholds = options.mobile ? FAST_RENDER_THRESHOLDS.mobile : FAST_RENDER_THRESHOLDS.desktop;
	const outputBytes = Number(options.outputBytes) || 0;
	const livePcmBytes = Number(options.livePcmBytes) || 0;
	const totalBytes = outputBytes + livePcmBytes;
	const fast = outputBytes <= thresholds.outputBytes && totalBytes <= thresholds.totalBytes;
	return {
		strategy: fast ? 'offline' : 'realtime-stream',
		fast,
		outputBytes,
		livePcmBytes,
		totalBytes,
		thresholds,
		reason: fast ? null : outputBytes > thresholds.outputBytes ? 'output-memory' : 'total-memory',
	};
}

export function sanitizeExportName(value, fallback = 'audio-project') {
	const normalized = String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '')
		.slice(0, 96);
	return normalized || fallback;
}

export function createExportFileName(project, options = {}) {
	const extension = options.extension || exportExtension(options.format || 'wav');
	if (options.mode === 'stem') {
		const index = Number(options.trackIndex ?? 0) + 1;
		return `${String(index).padStart(2, '0')}-${sanitizeExportName(options.trackName, 'track')}.${extension}`;
	}
	const date = isoDate(options.date);
	return `${sanitizeExportName(project.title)}-mix-${date}.${extension}`;
}

/** @returns {AudioExportPlan} */
export function createExportPlan(project, options = {}) {
	const mode = options.mode || 'mix';
	if (mode !== 'mix' && mode !== 'stems') throw new RangeError('Export mode must be mix or stems.');
	const format = canonicalMediaExportFormat(options.format || 'wav');
	const encoding = normalizeMediaExportSettings(format, {
		...options,
		sampleRate: options.sampleRate ?? project.sampleRate ?? AUDIO_EDITOR_SAMPLE_RATE,
		inputChannelCount: options.inputChannelCount ?? project.masterChannels ?? AUDIO_EDITOR_MASTER_CHANNELS,
	});
	const sampleRate = encoding.sampleRate;
	const range = resolveExportRange(project, options.range || 'project');
	const tailFrames = determineTailFrames(project, mode, options.includeTail !== false);
	const rangeOutputFrames = Math.ceil(range.durationFrames * sampleRate / project.sampleRate);
	const tailOutputFrames = Math.ceil(tailFrames * sampleRate / project.sampleRate);
	const outputFrames = rangeOutputFrames + tailOutputFrames;
	const outputBytes = estimatePcmBytes(outputFrames, encoding.channelCount);
	const render = chooseRenderStrategy({
		mobile: Boolean(options.mobile),
		outputBytes,
		livePcmBytes: options.livePcmBytes ?? estimateProjectPcmBytes(project),
	});
	const outputs = mode === 'mix'
		? [{
			kind: 'mix',
			fileName: createExportFileName(project, { format, extension: encoding.extension, date: options.date }),
			trackId: null,
			includeMaster: true,
			respectMuteSolo: true,
		}]
		: project.tracks.filter((track) => track.type !== 'label' && track.type !== 'video').map((track, trackIndex) => ({
			kind: 'stem',
			fileName: createExportFileName(project, { format, extension: encoding.extension, mode: 'stem', trackIndex, trackName: track.name }),
			trackId: track.id,
			includeMaster: false,
			respectMuteSolo: false,
		}));

	return {
		mode,
		format,
		mimeType: encoding.mimeType,
		sampleRate,
		channelCount: encoding.channelCount,
		channelMapping: encoding.channelMapping,
		encoding,
		dither: encoding.dither !== 'none',
		ditherMode: encoding.dither,
		metadata: encoding.metadata,
		range,
		tailFrames,
		outputFrames,
		outputBytesPerRender: outputBytes,
		render,
		outputs,
		archiveName: mode === 'stems'
			? `${sanitizeExportName(project.title)}-stems-${isoDate(options.date)}.zip`
			: null,
		aggregateStereoMinutes: aggregateStereoMinutes(project),
	};
}

function resolveExportRange(project, requestedRange) {
	if (requestedRange === 'project') return normalizeFrameRange(0, projectDurationFrames(project), 'export range');
	if (requestedRange === 'selection') {
		return normalizeFrameRange(project.selection.startFrame, project.selection.endFrame, 'export selection');
	}
	if (requestedRange === 'loop') {
		if (!project.loop?.enabled) throw new RangeError('The project loop is not enabled.');
		return normalizeFrameRange(project.loop.startFrame, project.loop.endFrame, 'export loop');
	}
	if (requestedRange && typeof requestedRange === 'object') {
		return normalizeFrameRange(requestedRange.startFrame, requestedRange.endFrame, 'export range');
	}
	throw new RangeError('Export range must be project, selection, or an explicit frame range.');
}

function determineTailFrames(project, mode, includeTail) {
	if (!includeTail) return 0;
	return projectEffectTailFrames(project, {
		includeMaster: mode === 'mix',
		maximumSeconds: 10,
	});
}

function exportExtension(format) {
	const descriptor = getMediaExportFormat(format);
	if (!descriptor.extension) throw new RangeError('Custom FFmpeg exports require an output extension.');
	return descriptor.extension;
}

function isoDate(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid export date is required.');
	return date.toISOString().slice(0, 10);
}
