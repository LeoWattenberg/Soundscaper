import {
	isVisibleVideoTrack,
	resolveVideoTimelineSegments,
	videoClipEndFrame,
} from './video-timeline.js';

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
	const timelineSegments = resolveVideoTimelineSegments(project, {
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		blackColor: canvas.backgroundColor,
		isTrackVisible: options.isTrackVisible,
		topTrackFirst: options.topTrackFirst,
	});
	const inputs = [];
	const inputIndexBySourceId = new Map();
	for (const segment of timelineSegments) {
		if (segment.kind !== 'video' || inputIndexBySourceId.has(segment.sourceId)) continue;
		const inputIndex = inputs.length;
		inputIndexBySourceId.set(segment.sourceId, inputIndex);
		inputs.push(Object.freeze({
			kind: 'video-source',
			inputIndex,
			sourceId: segment.sourceId,
			storageKey: segment.source.storageKey,
			mimeType: segment.source.mimeType,
		}));
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

	const segments = timelineSegments.map((segment, index) => Object.freeze({
		index,
		kind: segment.kind,
		timelineStartFrame: segment.timelineStartFrame,
		timelineEndFrame: segment.timelineEndFrame,
		outputStartFrame: segment.timelineStartFrame - range.startFrame,
		durationFrames: segment.durationFrames,
		durationSeconds: segment.durationFrames / projectSampleRate,
		...(segment.kind === 'black'
			? { color: segment.color }
			: {
				trackId: segment.trackId,
				clipId: segment.clipId,
				sourceId: segment.sourceId,
				inputIndex: inputIndexBySourceId.get(segment.sourceId),
				sourceStartFrame: segment.sourceStartFrame,
				sourceEndFrame: segment.sourceEndFrame,
				sourceStartTimeSeconds: segment.sourceStartTimeSeconds,
				sourceEndTimeSeconds: segment.sourceEndTimeSeconds,
				playbackRate: segment.playbackRate,
			}),
	}));
	const filterPlan = createFilterPlan(segments, canvas, projectSampleRate, {
		audioInput,
		format,
	});
	const durationSeconds = range.durationFrames / projectSampleRate;

	return deepFreeze({
		version: 1,
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
		segments,
		filterPlan,
	});
}

function createFilterPlan(segments, canvas, projectSampleRate, options) {
	const filters = segments.map((segment) => {
		const outputLabel = `video_segment_${segment.index}`;
		if (segment.kind === 'black') {
			return {
				kind: 'color',
				segmentIndex: segment.index,
				outputLabel,
				color: segment.color,
				width: canvas.width,
				height: canvas.height,
				frameRate: canvas.frameRate,
				durationSeconds: segment.durationSeconds,
			};
		}
		return {
			kind: 'input',
			segmentIndex: segment.index,
			inputIndex: segment.inputIndex,
			outputLabel,
			operations: [
				{
					name: 'trim',
					startSeconds: segment.sourceStartTimeSeconds,
					endSeconds: segment.sourceEndTimeSeconds,
				},
				{
					name: 'setpts',
					origin: 'PTS-STARTPTS',
					playbackRate: segment.playbackRate,
					multiplier: 1 / segment.playbackRate,
				},
				{
					name: 'scale',
					width: canvas.width,
					height: canvas.height,
					forceOriginalAspectRatio: 'decrease',
				},
				{
					name: 'pad',
					width: canvas.width,
					height: canvas.height,
					x: '(ow-iw)/2',
					y: '(oh-ih)/2',
					color: canvas.backgroundColor,
				},
				{ name: 'fps', frameRate: canvas.frameRate },
				{ name: 'setsar', value: 1 },
			],
		};
	});
	return {
		strategy: 'timeline-segments',
		backgroundColor: canvas.backgroundColor,
		segments: filters,
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
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
