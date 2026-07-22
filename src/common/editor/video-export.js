import {
	isVisibleVideoTrack,
	resolveVideoCompositionIntervals,
	videoClipEndFrame,
} from './video-timeline.js';
import { normalizeVideoEffects } from './video-effects.js';

const DEFAULT_MAXIMUM_WIDTH = 1_280;
const DEFAULT_MAXIMUM_HEIGHT = 720;
const DEFAULT_MAXIMUM_FRAME_RATE = 30;
const DEFAULT_BACKGROUND_COLOR = '#000000';

export const VIDEO_EXPORT_FORMATS = deepFreeze({
	mp4: {
		id: 'mp4',
		label: 'MP4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		container: 'mp4',
		videoCodec: 'h264',
		videoEncoder: 'libx264',
		audioCodec: 'aac',
		audioEncoder: 'aac',
		pixelFormat: 'yuv420p',
		requiredEncoders: ['libx264', 'aac'],
		requiredMuxers: ['mp4'],
	},
	webm: {
		id: 'webm',
		label: 'WebM',
		extension: 'webm',
		mimeType: 'video/webm',
		container: 'webm',
		videoCodec: 'vp9',
		videoEncoder: 'libvpx-vp9',
		audioCodec: 'opus',
		audioEncoder: 'libopus',
		pixelFormat: 'yuv420p',
		requiredEncoders: ['libvpx-vp9', 'libopus'],
		requiredMuxers: ['webm'],
	},
});

export function canonicalVideoExportFormat(format) {
	const value = String(format || 'mp4').trim().toLowerCase();
	if (value === 'h264' || value === 'mpeg4') return 'mp4';
	if (value === 'vp9') return 'webm';
	return value;
}

export function getVideoExportFormat(format = 'mp4') {
	const id = canonicalVideoExportFormat(format);
	const descriptor = VIDEO_EXPORT_FORMATS[id];
	if (!descriptor) throw new RangeError(`Unsupported video export format: ${format}.`);
	return descriptor;
}

/**
 * Derive safe automatic canvas settings from the earliest visible timeline
 * video. Dimensions retain aspect ratio, never upscale, remain encoder-safe
 * even numbers, and fit within 1280x720 unless the caller narrows the limits.
 */
export function resolveVideoExportCanvas(project, options = {}) {
	const maximumWidth = positiveEvenLimit(options.maximumWidth ?? DEFAULT_MAXIMUM_WIDTH, 'maximumWidth');
	const maximumHeight = positiveEvenLimit(options.maximumHeight ?? DEFAULT_MAXIMUM_HEIGHT, 'maximumHeight');
	const maximumFrameRate = positiveFiniteNumber(
		options.maximumFrameRate ?? DEFAULT_MAXIMUM_FRAME_RATE,
		'maximumFrameRate',
	);
	const reference = firstVisibleTimelineVideo(project, options);
	const sourceWidth = optionalPositiveInteger(options.width, 'width')
		?? optionalPositiveInteger(reference?.source.width, 'source.width')
		?? maximumWidth;
	const sourceHeight = optionalPositiveInteger(options.height, 'height')
		?? optionalPositiveInteger(reference?.source.height, 'source.height')
		?? maximumHeight;
	const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
	const width = evenFloor(sourceWidth * scale);
	const height = evenFloor(sourceHeight * scale);
	const requestedFrameRate = optionalPositiveNumber(options.frameRate, 'frameRate')
		?? optionalPositiveNumber(reference?.source.frameRate, 'source.frameRate')
		?? maximumFrameRate;
	const frameRate = Math.min(maximumFrameRate, requestedFrameRate);

	return Object.freeze({
		width,
		height,
		frameRate,
		pixelFormat: 'yuv420p',
		backgroundColor: normalizeColor(options.backgroundColor),
		maximumWidth,
		maximumHeight,
		maximumFrameRate,
		referenceClipId: reference?.clip.id || null,
		referenceSourceId: reference?.source.id || null,
	});
}

/**
 * Produce a stable, serializable plan for an FFmpeg adapter. This helper does
 * not load FFmpeg or media bytes; it only resolves composition, trim/stretch,
 * canvas, codec, and staged-audio metadata.
 */
export function createVideoExportPlan(project, options = {}) {
	const projectSampleRate = positiveSafeInteger(project?.sampleRate, 'project.sampleRate');
	const format = getVideoExportFormat(options.format || 'mp4');
	const range = resolveExportRange(project, options.range || 'project');
	if (range.durationFrames <= 0) throw new RangeError('Video export range must contain at least one frame.');
	const canvas = resolveVideoExportCanvas(project, options.canvas || {});
	const compositionIntervals = resolveVideoCompositionIntervals(project, {
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		blackColor: canvas.backgroundColor,
		isTrackVisible: options.isTrackVisible,
		topTrackFirst: options.topTrackFirst,
	});
	const inputs = [];
	const inputIndexBySourceId = new Map();
	for (const interval of compositionIntervals) {
		for (const layer of interval.layers) {
			for (const clip of layer.clips) {
				if (inputIndexBySourceId.has(clip.sourceId)) continue;
				const inputIndex = inputs.length;
				inputIndexBySourceId.set(clip.sourceId, inputIndex);
				inputs.push(Object.freeze({
					kind: 'video-source',
					inputIndex,
					sourceId: clip.sourceId,
					storageKey: clip.source.storageKey,
					mimeType: clip.source.mimeType,
				}));
			}
		}
	}

	const includeAudio = options.includeAudio !== false;
	const audioInputIndex = includeAudio ? inputs.length : null;
	const audioInput = includeAudio
		? Object.freeze({
			kind: 'staged-audio-mix',
			inputIndex: audioInputIndex,
			fileName: String(options.audioFileName || 'audio-mix.wav'),
			sampleRate: projectSampleRate,
			startFrame: range.startFrame,
			durationFrames: range.durationFrames,
		})
		: null;
	if (audioInput) inputs.push(audioInput);

	const intervals = compositionIntervals.map((interval, index) => Object.freeze({
		index,
		kind: interval.kind,
		timelineStartFrame: interval.timelineStartFrame,
		timelineEndFrame: interval.timelineEndFrame,
		outputStartFrame: interval.timelineStartFrame - range.startFrame,
		durationFrames: interval.durationFrames,
		durationSeconds: interval.durationFrames / projectSampleRate,
		...(interval.kind === 'black' ? { color: interval.color } : {}),
		layers: interval.layers.map((layer) => Object.freeze({
			trackId: layer.trackId,
			trackIndex: layer.trackIndex,
			clips: layer.clips.map((clip) => Object.freeze({
				role: clip.role,
				clipId: clip.clipId,
				sourceId: clip.sourceId,
				inputIndex: inputIndexBySourceId.get(clip.sourceId),
				sourceStartFrame: clip.sourceStartFrame,
				sourceEndFrame: clip.sourceEndFrame,
				sourceDurationFrames: clip.sourceDurationFrames,
				sourceStartTimeSeconds: clip.sourceStartTimeSeconds,
				sourceEndTimeSeconds: clip.sourceEndTimeSeconds,
				playbackRate: clip.playbackRate,
				opacityStart: clip.opacityStart,
				opacityEnd: clip.opacityEnd,
				videoEffects: normalizeVideoEffects(
					clip.clip?.videoEffects ?? [],
					`clip ${clip.clipId}.videoEffects`,
				),
			})),
		})),
	}));
	const filterPlan = createFilterPlan(intervals, canvas, projectSampleRate, {
		audioInput,
		format,
	});
	const durationSeconds = range.durationFrames / projectSampleRate;

	return deepFreeze({
		version: 3,
		format: format.id,
		container: format.container,
		extension: format.extension,
		mimeType: format.mimeType,
		codecs: {
			video: format.videoCodec,
			videoEncoder: format.videoEncoder,
			audio: includeAudio ? format.audioCodec : null,
			audioEncoder: includeAudio ? format.audioEncoder : null,
			pixelFormat: format.pixelFormat,
		},
		range,
		durationSeconds,
		outputFrameCount: Math.max(1, Math.ceil(durationSeconds * canvas.frameRate)),
		canvas,
		inputs,
		intervals,
		filterPlan,
	});
}

function createFilterPlan(intervals, canvas, projectSampleRate, options) {
	const filters = intervals.map((interval) => ({
		kind: interval.kind,
		intervalIndex: interval.index,
		outputLabel: `video_interval_${interval.index}`,
		durationSeconds: interval.durationSeconds,
		base: {
			name: 'color',
			color: interval.color || canvas.backgroundColor,
			width: canvas.width,
			height: canvas.height,
			frameRate: canvas.frameRate,
			pixelFormat: 'rgba',
		},
		layers: interval.layers.map((layer, layerIndex) => ({
			trackId: layer.trackId,
			trackIndex: layer.trackIndex,
			outputLabel: `video_interval_${interval.index}_track_${layerIndex}`,
			clips: layer.clips.map((clip, clipIndex) => ({
				clipId: clip.clipId,
				sourceId: clip.sourceId,
				inputIndex: clip.inputIndex,
				role: clip.role,
				opacityStart: clip.opacityStart,
				opacityEnd: clip.opacityEnd,
				outputLabel: `video_interval_${interval.index}_track_${layerIndex}_clip_${clipIndex}`,
				operations: [
					{
						name: 'trim',
						startSeconds: clip.sourceStartTimeSeconds,
						endSeconds: clip.sourceEndTimeSeconds,
					},
					{
						name: 'setpts',
						origin: 'PTS-STARTPTS',
						playbackRate: clip.playbackRate,
						multiplier: 1 / clip.playbackRate,
					},
					{
						name: 'scale',
						width: canvas.width,
						height: canvas.height,
						forceOriginalAspectRatio: 'decrease',
					},
					{ name: 'format', pixelFormat: 'rgba' },
					{ name: 'fps', frameRate: canvas.frameRate },
					...clip.videoEffects
						.filter((effect) => effect.enabled)
						.map((effect) => ({ name: 'video-effect', effect })),
					{
						name: 'pad',
						width: canvas.width,
						height: canvas.height,
						x: '(ow-iw)/2',
						y: '(oh-ih)/2',
						color: 'black@0',
					},
					{ name: 'premultiply', inplace: true },
					{ name: 'setsar', value: 1 },
				],
			})),
			blend: layer.clips.length === 2
				? {
					name: 'blend',
					opacityStart: layer.clips.map((clip) => clip.opacityStart),
					opacityEnd: layer.clips.map((clip) => clip.opacityEnd),
				}
				: null,
		})),
		overlays: interval.layers.map((layer) => ({
			name: 'overlay',
			trackId: layer.trackId,
			alpha: 'premultiplied',
		})),
	}));
	return {
		strategy: 'layered-composition',
		backgroundColor: canvas.backgroundColor,
		intervals: filters,
		concat: {
			name: 'concat',
			inputLabels: filters.map((filter) => filter.outputLabel),
			videoStreams: 1,
			audioStreams: 0,
			outputLabel: 'video_out',
		},
		audio: options.audioInput
			? {
				strategy: 'staged-mix',
				inputIndex: options.audioInput.inputIndex,
				startFrame: options.audioInput.startFrame,
				durationFrames: options.audioInput.durationFrames,
				sampleRate: projectSampleRate,
				codec: options.format.audioCodec,
			}
			: { strategy: 'none' },
		output: {
			videoLabel: 'video_out',
			videoCodec: options.format.videoEncoder,
			audioCodec: options.audioInput ? options.format.audioEncoder : null,
			pixelFormat: options.format.pixelFormat,
		},
	};
}

function resolveExportRange(project, requested) {
	let startFrame;
	let endFrame;
	if (requested === 'project') {
		startFrame = 0;
		endFrame = projectTimelineDurationFrames(project);
	} else if (requested === 'selection') {
		startFrame = project?.selection?.startFrame;
		endFrame = project?.selection?.endFrame;
	} else if (requested === 'loop') {
		if (!project?.loop?.enabled) throw new RangeError('The project loop is not enabled.');
		startFrame = project.loop.startFrame;
		endFrame = project.loop.endFrame;
	} else if (requested && typeof requested === 'object' && !Array.isArray(requested)) {
		startFrame = requested.startFrame;
		endFrame = requested.endFrame;
	} else {
		throw new RangeError('Video export range must be project, selection, loop, or an explicit frame range.');
	}
	startFrame = nonNegativeSafeInteger(startFrame, 'range.startFrame');
	endFrame = nonNegativeSafeInteger(endFrame, 'range.endFrame');
	if (endFrame < startFrame) throw new RangeError('range.endFrame cannot precede range.startFrame.');
	return Object.freeze({
		startFrame,
		endFrame,
		durationFrames: endFrame - startFrame,
	});
}

function projectTimelineDurationFrames(project) {
	let durationFrames = 0;
	for (const clip of project?.clips || []) {
		durationFrames = Math.max(durationFrames, videoClipEndFrame(clip));
	}
	for (const track of project?.tracks || []) {
		if (track.type !== 'label') continue;
		for (const label of track.labels || []) {
			durationFrames = Math.max(durationFrames, nonNegativeSafeInteger(label.endFrame, 'label.endFrame'));
		}
	}
	return durationFrames;
}

function firstVisibleTimelineVideo(project, options) {
	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	const visible = typeof options.isTrackVisible === 'function'
		? options.isTrackVisible
		: isVisibleVideoTrack;
	const candidates = [];
	for (const [trackIndex, track] of (project?.tracks || []).entries()) {
		if (!visible(track)) continue;
		for (const clipId of track.clipIds || []) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${track.id} references missing clip ${clipId}.`);
			if (clip.kind !== 'video') throw new TypeError(`Video track ${track.id} contains non-video clip ${clip.id}.`);
			const source = sourceById.get(clip.sourceId);
			if (!source) throw new ReferenceError(`Video clip ${clip.id} references missing source ${clip.sourceId}.`);
			if (source.kind !== 'video') throw new TypeError(`Video clip ${clip.id} references non-video source ${source.id}.`);
			candidates.push({ trackIndex, track, clip, source });
		}
	}
	candidates.sort((left, right) => (
		left.clip.timelineStartFrame - right.clip.timelineStartFrame
		|| left.trackIndex - right.trackIndex
		|| left.clip.id.localeCompare(right.clip.id)
	));
	return candidates[0] || null;
}

function normalizeColor(value) {
	const color = String(value || DEFAULT_BACKGROUND_COLOR).trim();
	if (!color) throw new TypeError('backgroundColor must not be empty.');
	return color;
}

function evenFloor(value) {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function positiveEvenLimit(value, name) {
	const number = positiveSafeInteger(value, name);
	if (number < 2) throw new RangeError(`${name} must be at least 2.`);
	return evenFloor(number);
}

function optionalPositiveInteger(value, name) {
	if (value == null) return null;
	return positiveSafeInteger(value, name);
}

function optionalPositiveNumber(value, name) {
	if (value == null) return null;
	return positiveFiniteNumber(value, name);
}

function positiveFiniteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.isFrozen(value) ? value : Object.freeze(value);
}
