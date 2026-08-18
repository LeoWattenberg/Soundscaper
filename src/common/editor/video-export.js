import {
	createVisibleVideoTrackPredicate,
	resolveVideoCompositionIntervals,
	videoClipEndFrame,
} from './video-timeline.js';
import { isTrackFolderMediaStateProjectionV12 } from './track-folder-media-runtime.ts';
import { normalizeVideoEffects } from './video-effects.js';
import { assertStaticVideoKeyframesForExport } from './video-keyframe-export-admission.ts';
import { approximatePositiveRational } from './rational-approximation.ts';
import {
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
} from './runtime-clip-projection.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from './track-folder-media-runtime.ts';
import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from './video-source-presentation.ts';
import { compareRationals, normalizeRational } from './timeline-time.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from './video-export-plan-version.ts';
import {
	isVideoCanvasFit,
	VIDEO_CANVAS_FIT_MODES,
	VIDEO_CANVAS_MAXIMUM_EXTENT,
	VIDEO_CANVAS_MAXIMUM_FRAME_RATE,
} from './video-canvas-fit.ts';
import { createFilterPlan } from './video-export-filter-plan.js';
import { normalizeVideoDeliveryColor } from './video-delivery-color.ts';
import { normalizeVideoDeliveryQuality } from './video-delivery-quality.ts';
import { normalizeVideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import {
	isVideoCaptionSidecarFormat,
	resolveVideoCaptionCues,
	VIDEO_CAPTION_SIDECAR_FORMATS,
} from './video-caption-cues.ts';

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
		// 3GPP timed text is what an MP4 carries captions as; a container with no
		// caption codec states null here and delivers a sidecar instead.
		subtitleCodec: 'mov_text',
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
		subtitleCodec: 'webvtt',
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
 * Resolve the delivery canvas, either automatically or as the caller stated it.
 *
 * Without `size`, dimensions derive from the earliest visible timeline video:
 * they retain aspect ratio, never upscale, remain encoder-safe even numbers,
 * and fit within 1280x720 unless the caller narrows the limits. The reference
 * is the source's display geometry rather than the size a particular decoder
 * presented, so the same project renders the same canvas on every engine even
 * where one of them ignores a pixel aspect ratio.
 *
 * With `size`, the canvas is a delivery decision rather than a derivation: it
 * is used exactly, the automatic ceiling does not apply, and `fit` decides how
 * a source of another aspect lands in it.
 */
export function resolveVideoExportCanvas(project, options = {}) {
	const runtimeProject = ensureRuntimeProject(project);
	const exact = exactVideoExportCanvas(runtimeProject, options);
	return Object.freeze({
		...exact,
		frameRate: exact.frameRate.num / exact.frameRate.den,
		maximumFrameRate: exact.maximumFrameRate.num / exact.maximumFrameRate.den,
	});
}

/** Resolve encoder canvas geometry while retaining the canonical rational rate. */
export function resolveExactVideoExportCanvas(project, options = {}) {
	const runtimeProject = ensureRuntimeProject(project);
	return exactVideoExportCanvas(runtimeProject, options);
}

function exactVideoExportCanvas(runtimeProject, options) {
	const stated = statedCanvasSize(options);
	const fit = canvasFit(options);
	// A stated canvas answers to itself: reporting its own extents as the
	// maximums keeps the plan's "within its declared maximum" claim true and
	// honest, because nothing capped this delivery below the size it asked for.
	const maximumWidth = stated
		? stated.width
		: positiveEvenLimit(options.maximumWidth ?? DEFAULT_MAXIMUM_WIDTH, 'maximumWidth');
	const maximumHeight = stated
		? stated.height
		: positiveEvenLimit(options.maximumHeight ?? DEFAULT_MAXIMUM_HEIGHT, 'maximumHeight');
	const statedRate = statedFrameRate(options);
	const maximumFrameRate = statedRate ?? positiveExactRate(
		options.maximumFrameRate ?? DEFAULT_MAXIMUM_FRAME_RATE,
		'maximumFrameRate',
	);
	const reference = firstVisibleTimelineVideo(runtimeProject, options);
	const display = reference ? resolveVideoSourceDisplaySize(reference.source) : null;
	const sourceWidth = optionalPositiveInteger(options.width, 'width')
		?? optionalPositiveInteger(display?.width, 'source.width')
		?? maximumWidth;
	const sourceHeight = optionalPositiveInteger(options.height, 'height')
		?? optionalPositiveInteger(display?.height, 'source.height')
		?? maximumHeight;
	const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
	const width = stated ? stated.width : evenFloor(sourceWidth * scale);
	const height = stated ? stated.height : evenFloor(sourceHeight * scale);
	// A derived rate answers to the ceiling; a stated one is the delivery decision
	// and is its own ceiling, exactly as a stated size is.
	const derivedFrameRate = optionalPositiveExactRate(reference?.source.frameRate, 'source.frameRate')
		?? maximumFrameRate;
	const frameRate = statedRate ?? (compareRationals(derivedFrameRate, maximumFrameRate) > 0
		? maximumFrameRate
		: derivedFrameRate);

	return Object.freeze({
		width,
		height,
		frameRate,
		fit,
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
 * The delivery canvas the caller stated outright, or null for the derived one.
 *
 * Stating a size and also stating a ceiling for it is a contradiction rather
 * than a precedence question, so it is refused instead of resolved: silently
 * capping a stated 1080x1920 back to 405x720 is exactly the kind of hidden
 * delivery decision this milestone exists to remove.
 */
function statedCanvasSize(options) {
	if (options.size == null) return null;
	const size = options.size;
	if (typeof size !== 'object' || Array.isArray(size)) {
		throw new TypeError('canvas.size must be an object stating width and height.');
	}
	for (const key of Object.keys(size)) {
		if (key !== 'width' && key !== 'height') throw new RangeError(`Unsupported canvas.size option: ${key}.`);
	}
	for (const conflicting of ['width', 'height', 'maximumWidth', 'maximumHeight']) {
		if (options[conflicting] != null) {
			throw new RangeError(`canvas.size states the delivery canvas, so canvas.${conflicting} cannot also apply.`);
		}
	}
	return Object.freeze({
		width: canvasExtent(size.width, 'canvas.size.width'),
		height: canvasExtent(size.height, 'canvas.size.height'),
	});
}

/**
 * The frame rate the caller stated outright, or null for the derived one.
 *
 * Same rule as the canvas: a stated rate is delivered exactly and the automatic
 * ceiling does not apply to it, and stating a rate alongside a ceiling for it is
 * a contradiction rather than a precedence question.
 */
function statedFrameRate(options) {
	if (options.frameRate == null) return null;
	if (options.maximumFrameRate != null) {
		throw new RangeError('canvas.frameRate states the delivery rate, so canvas.maximumFrameRate cannot also apply.');
	}
	const rate = positiveExactRate(options.frameRate, 'canvas.frameRate');
	if (rate.num > VIDEO_CANVAS_MAXIMUM_FRAME_RATE * rate.den) {
		throw new RangeError(`canvas.frameRate must be at most ${VIDEO_CANVAS_MAXIMUM_FRAME_RATE}.`);
	}
	return rate;
}

function canvasFit(options) {
	const fit = options.fit ?? 'contain';
	if (!isVideoCanvasFit(fit)) {
		throw new RangeError(`canvas.fit must be one of ${VIDEO_CANVAS_FIT_MODES.join(', ')}.`);
	}
	return fit;
}

function canvasExtent(value, name) {
	const extent = positiveSafeInteger(value, name);
	if (extent % 2 !== 0) {
		throw new RangeError(`${name} must be even, because the delivered pixel format subsamples chroma.`);
	}
	if (extent > VIDEO_CANVAS_MAXIMUM_EXTENT) {
		throw new RangeError(`${name} must be at most ${VIDEO_CANVAS_MAXIMUM_EXTENT}.`);
	}
	return extent;
}

/**
 * Produce a stable, serializable plan for an FFmpeg adapter. This helper does
 * not load FFmpeg or media bytes; it only resolves composition, trim/stretch,
 * canvas, codec, and staged-audio metadata.
 */
export function createVideoExportPlan(project, options = {}) {
	const runtimeProject = ensureRuntimeProject(project);
	const projectSampleRate = positiveSafeInteger(runtimeProject.sampleRate, 'project.sampleRate');
	const format = getVideoExportFormat(options.format || 'mp4');
	const range = resolveVideoExportRange(runtimeProject, options.range || 'project');
	if (range.durationFrames <= 0) throw new RangeError('Video export range must contain at least one frame.');
	const canvas = resolveVideoExportCanvas(runtimeProject, options.canvas || {});
	const compositionIntervals = resolveVideoCompositionIntervals(runtimeProject, {
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		blackColor: canvas.backgroundColor,
		isTrackVisible: options.isTrackVisible,
		topTrackFirst: options.topTrackFirst,
		renderCanvas: canvas,
	});
	assertStaticVideoKeyframesForExport(compositionIntervals.flatMap((interval) => (
		interval.layers.flatMap((layer) => layer.clips.map((clip) => clip.clip))
	)));
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
					// Null states that this source is presented as it decodes, which
					// is a different claim from having nothing to say about it.
					presentation: resolveVideoSourcePresentation(clip.source),
				}));
			}
		}
	}

	// Captions are staged before the audio mix so the mix stays the final input,
	// which is the ordering every reader of this plan already relies on.
	const captions = resolveCaptionDelivery(runtimeProject, format, range, options.captions);
	if (captions?.mux) {
		inputs.push(Object.freeze({
			kind: 'staged-captions',
			inputIndex: inputs.length,
			fileName: String(options.captionFileName || 'captions.srt'),
			format: 'srt',
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
			// What the staged mix must already be, rather than what an encoder
			// should do to it: both delivery paths read the same staged file.
			channelLayout: normalizeVideoDeliveryAudioLayout(options.audioLayout, 'audioLayout'),
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
				renderDescription: clip.renderDescription,
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
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
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
		// The intent, not the encoder settings it becomes: an adapter reads the
		// tier, so the same plan can be replayed by an encoder that spells its
		// effort differently.
		quality: normalizeVideoDeliveryQuality(options.quality, 'quality'),
		captions,
		range,
		durationSeconds,
		outputFrameCount: Math.max(1, Math.ceil(durationSeconds * canvas.frameRate)),
		canvas,
		inputs,
		intervals,
		filterPlan,
	});
}


/**
 * What this delivery does about captions, or null for the deliveries that do
 * nothing — which is every delivery that shipped before this option existed.
 *
 * A container states whether it can carry a caption track. Where it cannot,
 * asking to mux is refused rather than silently downgraded to a sidecar: the
 * caller chose a container and a delivery, and quietly changing one of them is
 * the hidden behaviour this milestone exists to remove. The report says so for
 * the caller who did not choose.
 *
 * The muxed document is always SubRip. It is the interchange both subtitle
 * encoders read losslessly for plain cues, so the muxed track does not vary
 * with the sidecar the caller happened to pick.
 */
function resolveCaptionDelivery(runtimeProject, format, range, requested) {
	if (requested == null) return null;
	if (typeof requested !== 'object' || Array.isArray(requested)) {
		throw new TypeError('captions must be an object stating a track and a delivery.');
	}
	for (const key of Object.keys(requested)) {
		if (!['trackId', 'mux', 'sidecar'].includes(key)) {
			throw new RangeError(`Unsupported captions option: ${key}.`);
		}
	}
	const mux = requested.mux ?? true;
	if (typeof mux !== 'boolean') throw new TypeError('captions.mux must be boolean.');
	const sidecar = requested.sidecar ?? null;
	if (sidecar !== null && !isVideoCaptionSidecarFormat(sidecar)) {
		throw new RangeError(`captions.sidecar must be null or one of ${VIDEO_CAPTION_SIDECAR_FORMATS.join(', ')}.`);
	}
	if (!mux && sidecar === null) {
		throw new RangeError('captions must be muxed, delivered as a sidecar, or both.');
	}
	if (mux && !format.subtitleCodec) {
		throw new RangeError(`The ${format.id} container cannot carry a caption track; deliver a sidecar instead.`);
	}
	const cues = resolveVideoCaptionCues(runtimeProject, {
		trackId: requested.trackId,
		startFrame: range.startFrame,
		endFrame: range.endFrame,
	});
	return Object.freeze({
		trackId: requested.trackId,
		cueCount: cues.length,
		mux,
		subtitleCodec: mux ? format.subtitleCodec : null,
		sidecarFormat: sidecar,
	});
}

/** Resolve the canonical sample-frame range shared by legacy and exact video export. */
export function resolveVideoExportRange(project, requested = 'project') {
	const runtimeProject = ensureRuntimeProject(project);
	let startFrame;
	let endFrame;
	if (requested === 'project') {
		startFrame = 0;
		endFrame = projectTimelineDurationFrames(runtimeProject);
	} else if (requested === 'selection') {
		startFrame = runtimeProject?.selection?.startFrame;
		endFrame = runtimeProject?.selection?.endFrame;
	} else if (requested === 'loop') {
		if (!runtimeProject?.loop?.enabled) throw new RangeError('The project loop is not enabled.');
		startFrame = runtimeProject.loop.startFrame;
		endFrame = runtimeProject.loop.endFrame;
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
	const visible = videoTrackVisibility(project, options.isTrackVisible);
	const range = options.range == null ? null : resolveVideoExportRange(project, options.range);
	const candidates = [];
	for (const [trackIndex, track] of (project?.tracks || []).entries()) {
		if (!visible(track)) continue;
		for (const clipId of track.clipIds || []) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${track.id} references missing clip ${clipId}.`);
			if (clip.kind !== 'video') throw new TypeError(`Video track ${track.id} contains non-video clip ${clip.id}.`);
			if (range && (
				videoClipEndFrame(clip) <= range.startFrame
				|| clip.timelineStartFrame >= range.endFrame
			)) continue;
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
	return normalizeVideoDeliveryColor(value ?? DEFAULT_BACKGROUND_COLOR, 'canvas.backgroundColor');
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

function optionalPositiveExactRate(value, name) {
	if (value == null) return null;
	return positiveExactRate(value, name);
}

function positiveExactRate(value, name) {
	let normalized;
	try {
		normalized = typeof value === 'number'
			? approximatePositiveRational(value)
			: normalizeRational(value, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	} catch (cause) {
		throw new RangeError(`${name} must be a positive exact rational.`, { cause });
	}
	if (normalized.num <= 0) throw new RangeError(`${name} must be positive.`);
	return normalized;
}

function ensureRuntimeProject(project) {
	const mediaProject = projectTrackFolderMediaStateV12(project);
	if (isRuntimeProjectProjection(mediaProject)) return mediaProject;
	return inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		resolveRuntimeProjectProjection(mediaProject),
	);
}

function videoTrackVisibility(project, requested) {
	const visible = createVisibleVideoTrackPredicate(project?.tracks);
	if (typeof requested !== 'function') return visible;
	// An explicit predicate still replaces the default outright for a legacy project.
	if (!isTrackFolderMediaStateProjectionV12(project)) return requested;
	return (track) => visible(track) && requested(track);
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
