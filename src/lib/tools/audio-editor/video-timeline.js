export const VIDEO_THUMBNAIL_BASE_INTERVAL_SECONDS = 5;
export const VIDEO_THUMBNAIL_MINIMUM_SPACING_PIXELS = 80;

/**
 * A video track participates in the visual stack unless it is explicitly
 * hidden. `mute` remains independent so a future UI can use it for media audio
 * without changing picture composition.
 */
export function isVisibleVideoTrack(track) {
	return Boolean(track && track.type === 'video' && track.hidden !== true);
}

export function videoClipEndFrame(clip) {
	return nonNegativeSafeInteger(clip?.timelineStartFrame, 'clip.timelineStartFrame')
		+ positiveSafeInteger(clip?.durationFrames, 'clip.durationFrames');
}

/**
 * The source range is the active, trimmed range. Comparing its wall-clock
 * duration with the timeline duration accounts for both source/project sample
 * rate differences and clip stretching.
 */
export function videoClipPlaybackRate(clip, projectSampleRate, sourceSampleRate = projectSampleRate) {
	const timelineRate = positiveFiniteNumber(projectSampleRate, 'projectSampleRate');
	const mediaRate = positiveFiniteNumber(sourceSampleRate, 'sourceSampleRate');
	const sourceDurationFrames = positiveSafeInteger(clip?.sourceDurationFrames, 'clip.sourceDurationFrames');
	const durationFrames = positiveSafeInteger(clip?.durationFrames, 'clip.durationFrames');
	return sourceDurationFrames / mediaRate / (durationFrames / timelineRate);
}

/**
 * Map a project timeline frame into the active source range. Fractional source
 * frames are intentionally retained: video seeking and FFmpeg trims operate in
 * time, and rounding here would accumulate drift across stretched edits.
 */
export function mapVideoTimelineFrameToSource(clip, timelineFrame, options = {}) {
	const timelineStartFrame = nonNegativeSafeInteger(clip?.timelineStartFrame, 'clip.timelineStartFrame');
	const durationFrames = positiveSafeInteger(clip?.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip?.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(clip?.sourceDurationFrames, 'clip.sourceDurationFrames');
	const requestedFrame = finiteNumber(timelineFrame, 'timelineFrame');
	const timelineEndFrame = timelineStartFrame + durationFrames;
	const mappedTimelineFrame = boundedPosition(
		requestedFrame,
		timelineStartFrame,
		timelineEndFrame,
		Boolean(options.clamp),
		'timelineFrame',
	);
	const progress = (mappedTimelineFrame - timelineStartFrame) / durationFrames;
	const sourceFrame = sourceStartFrame + progress * sourceDurationFrames;
	const sourceSampleRate = optionalPositiveRate(options.sourceSampleRate ?? options.source?.sampleRate, 'sourceSampleRate');
	const projectSampleRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');

	return Object.freeze({
		timelineFrame: mappedTimelineFrame,
		timelineTimeSeconds: projectSampleRate == null ? null : mappedTimelineFrame / projectSampleRate,
		localTimelineFrame: mappedTimelineFrame - timelineStartFrame,
		progress,
		sourceFrame,
		sourceTimeSeconds: sourceSampleRate == null ? null : sourceFrame / sourceSampleRate,
	});
}

/** Map an active source frame back to its project timeline position. */
export function mapVideoSourceFrameToTimeline(clip, sourceFrame, options = {}) {
	const timelineStartFrame = nonNegativeSafeInteger(clip?.timelineStartFrame, 'clip.timelineStartFrame');
	const durationFrames = positiveSafeInteger(clip?.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip?.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(clip?.sourceDurationFrames, 'clip.sourceDurationFrames');
	const requestedFrame = finiteNumber(sourceFrame, 'sourceFrame');
	const sourceEndFrame = sourceStartFrame + sourceDurationFrames;
	const mappedSourceFrame = boundedPosition(
		requestedFrame,
		sourceStartFrame,
		sourceEndFrame,
		Boolean(options.clamp),
		'sourceFrame',
	);
	const progress = (mappedSourceFrame - sourceStartFrame) / sourceDurationFrames;
	const timelineFrame = timelineStartFrame + progress * durationFrames;
	const sourceSampleRate = optionalPositiveRate(options.sourceSampleRate ?? options.source?.sampleRate, 'sourceSampleRate');
	const projectSampleRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');

	return Object.freeze({
		sourceFrame: mappedSourceFrame,
		sourceTimeSeconds: sourceSampleRate == null ? null : mappedSourceFrame / sourceSampleRate,
		localSourceFrame: mappedSourceFrame - sourceStartFrame,
		progress,
		timelineFrame,
		timelineTimeSeconds: projectSampleRate == null ? null : timelineFrame / projectSampleRate,
	});
}

/**
 * Resolve the picture at a timeline frame. Project track order is visual order:
 * the first visible video track is the top layer. A gap is an explicit black
 * result rather than a missing value, which keeps preview/export behavior
 * identical.
 */
export function resolveActiveVideoClip(project, timelineFrame, options = {}) {
	const frame = nonNegativeFiniteNumber(timelineFrame, 'timelineFrame');
	const sampleRate = positiveFiniteNumber(project?.sampleRate, 'project.sampleRate');
	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
	const visible = typeof options.isTrackVisible === 'function'
		? options.isTrackVisible
		: isVisibleVideoTrack;
	const orderedTrackIndexes = tracks.map((_, index) => index);
	if (options.topTrackFirst === false) orderedTrackIndexes.reverse();

	for (const trackIndex of orderedTrackIndexes) {
		const track = tracks[trackIndex];
		if (!visible(track)) continue;
		const activeClips = [];
		for (const clipId of track.clipIds || []) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${track.id} references missing clip ${clipId}.`);
			if (clip.kind !== 'video') {
				throw new TypeError(`Video track ${track.id} contains non-video clip ${clip.id}.`);
			}
			const startFrame = nonNegativeSafeInteger(clip.timelineStartFrame, `clip ${clip.id} timelineStartFrame`);
			const endFrame = startFrame + positiveSafeInteger(clip.durationFrames, `clip ${clip.id} durationFrames`);
			if (frame >= startFrame && frame < endFrame) activeClips.push(clip);
		}
		if (activeClips.length > 1) {
			throw new RangeError(`Video track ${track.id} has overlapping clips at timeline frame ${frame}.`);
		}
		if (!activeClips.length) continue;

		const clip = activeClips[0];
		const source = sourceById.get(clip.sourceId);
		if (!source) throw new ReferenceError(`Video clip ${clip.id} references missing source ${clip.sourceId}.`);
		if (source.kind !== 'video') {
			throw new TypeError(`Video clip ${clip.id} references non-video source ${source.id}.`);
		}
		const mapping = mapVideoTimelineFrameToSource(clip, frame, {
			projectSampleRate: sampleRate,
			sourceSampleRate: source.sampleRate,
		});
		return Object.freeze({
			kind: 'video',
			timelineFrame: frame,
			timelineTimeSeconds: frame / sampleRate,
			track,
			trackId: track.id,
			trackIndex,
			clip,
			clipId: clip.id,
			source,
			sourceId: source.id,
			sourceFrame: mapping.sourceFrame,
			sourceTimeSeconds: mapping.sourceTimeSeconds,
			playbackRate: videoClipPlaybackRate(clip, sampleRate, source.sampleRate),
		});
	}

	return Object.freeze({
		kind: 'black',
		color: normalizeBlackColor(options.blackColor),
		timelineFrame: frame,
		timelineTimeSeconds: frame / sampleRate,
	});
}

/**
 * Resolve a range into complete, non-overlapping picture segments. The result
 * covers the whole requested range, including explicit black gaps.
 */
export function resolveVideoTimelineSegments(project, options = {}) {
	const startFrame = nonNegativeSafeInteger(options.startFrame ?? 0, 'startFrame');
	const endFrame = nonNegativeSafeInteger(
		options.endFrame ?? videoTimelineDurationFrames(project),
		'endFrame',
	);
	if (endFrame < startFrame) throw new RangeError('endFrame cannot precede startFrame.');
	if (endFrame === startFrame) return Object.freeze([]);

	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const visible = typeof options.isTrackVisible === 'function'
		? options.isTrackVisible
		: isVisibleVideoTrack;
	const boundaries = new Set([startFrame, endFrame]);

	for (const track of project?.tracks || []) {
		if (!visible(track)) continue;
		for (const clipId of track.clipIds || []) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${track.id} references missing clip ${clipId}.`);
			if (clip.kind !== 'video') {
				throw new TypeError(`Video track ${track.id} contains non-video clip ${clip.id}.`);
			}
			const clipStart = nonNegativeSafeInteger(clip.timelineStartFrame, `clip ${clip.id} timelineStartFrame`);
			const clipEnd = clipStart + positiveSafeInteger(clip.durationFrames, `clip ${clip.id} durationFrames`);
			if (clipEnd <= startFrame || clipStart >= endFrame) continue;
			boundaries.add(Math.max(startFrame, clipStart));
			boundaries.add(Math.min(endFrame, clipEnd));
		}
	}

	const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
	const segments = [];
	for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
		const segmentStart = sortedBoundaries[index];
		const segmentEnd = sortedBoundaries[index + 1];
		if (segmentEnd <= segmentStart) continue;
		const active = resolveActiveVideoClip(project, segmentStart, options);
		const previous = segments.at(-1);
		if (previous && previous.timelineEndFrame === segmentStart && sameVisual(previous, active)) {
			previous.timelineEndFrame = segmentEnd;
			previous.durationFrames = segmentEnd - previous.timelineStartFrame;
			if (previous.kind === 'video') {
				const sourceEnd = mapVideoTimelineFrameToSource(previous.clip, segmentEnd, {
					sourceSampleRate: previous.source.sampleRate,
				});
				previous.sourceEndFrame = sourceEnd.sourceFrame;
				previous.sourceDurationFrames = previous.sourceEndFrame - previous.sourceStartFrame;
				previous.sourceEndTimeSeconds = sourceEnd.sourceTimeSeconds;
			}
			continue;
		}

		if (active.kind === 'black') {
			segments.push({
				kind: 'black',
				color: active.color,
				timelineStartFrame: segmentStart,
				timelineEndFrame: segmentEnd,
				durationFrames: segmentEnd - segmentStart,
			});
			continue;
		}

		const sourceStart = mapVideoTimelineFrameToSource(active.clip, segmentStart, {
			sourceSampleRate: active.source.sampleRate,
		});
		const sourceEnd = mapVideoTimelineFrameToSource(active.clip, segmentEnd, {
			sourceSampleRate: active.source.sampleRate,
		});
		segments.push({
			kind: 'video',
			timelineStartFrame: segmentStart,
			timelineEndFrame: segmentEnd,
			durationFrames: segmentEnd - segmentStart,
			trackId: active.trackId,
			trackIndex: active.trackIndex,
			clipId: active.clipId,
			sourceId: active.sourceId,
			track: active.track,
			clip: active.clip,
			source: active.source,
			sourceStartFrame: sourceStart.sourceFrame,
			sourceEndFrame: sourceEnd.sourceFrame,
			sourceDurationFrames: sourceEnd.sourceFrame - sourceStart.sourceFrame,
			sourceStartTimeSeconds: sourceStart.sourceTimeSeconds,
			sourceEndTimeSeconds: sourceEnd.sourceTimeSeconds,
			playbackRate: active.playbackRate,
		});
	}

	return Object.freeze(segments.map((segment) => Object.freeze(segment)));
}

/** Resolve the five-second source grid to a zoom-readable interval. */
export function videoThumbnailIntervalSeconds(options = {}) {
	const baseIntervalSeconds = positiveFiniteNumber(
		options.baseIntervalSeconds ?? VIDEO_THUMBNAIL_BASE_INTERVAL_SECONDS,
		'baseIntervalSeconds',
	);
	if (options.pixelsPerSecond == null) return baseIntervalSeconds;
	const pixelsPerSecond = positiveFiniteNumber(options.pixelsPerSecond, 'pixelsPerSecond');
	const playbackRate = positiveFiniteNumber(options.playbackRate ?? 1, 'playbackRate');
	const minimumSpacingPixels = positiveFiniteNumber(
		options.minimumSpacingPixels ?? VIDEO_THUMBNAIL_MINIMUM_SPACING_PIXELS,
		'minimumSpacingPixels',
	);
	const baseGridPixels = baseIntervalSeconds / playbackRate * pixelsPerSecond;
	const multiplier = Math.max(1, Math.ceil(minimumSpacingPixels / baseGridPixels - Number.EPSILON));
	return baseIntervalSeconds * multiplier;
}

/**
 * Select source timestamps for the visible portion of a clip. Grid points are
 * anchored at source time zero so generated thumbnails can be reused by every
 * placement of a Project Bin item.
 */
export function selectVideoThumbnailTimestamps(clip, source, options = {}) {
	const projectSampleRate = positiveFiniteNumber(options.projectSampleRate, 'projectSampleRate');
	const sourceSampleRate = positiveFiniteNumber(source?.sampleRate, 'source.sampleRate');
	const clipStartFrame = nonNegativeSafeInteger(clip?.timelineStartFrame, 'clip.timelineStartFrame');
	const clipEndFrame = videoClipEndFrame(clip);
	const visibleStartFrame = Math.max(
		clipStartFrame,
		finiteNumber(options.visibleStartFrame ?? clipStartFrame, 'visibleStartFrame'),
	);
	const visibleEndFrame = Math.min(
		clipEndFrame,
		finiteNumber(options.visibleEndFrame ?? clipEndFrame, 'visibleEndFrame'),
	);
	if (visibleEndFrame <= visibleStartFrame) return Object.freeze([]);

	const playbackRate = videoClipPlaybackRate(clip, projectSampleRate, sourceSampleRate);
	const intervalSeconds = videoThumbnailIntervalSeconds({
		...options,
		playbackRate,
	});
	const intervalFrames = Math.max(1, Math.round(intervalSeconds * sourceSampleRate));
	const sourceStart = mapVideoTimelineFrameToSource(clip, visibleStartFrame, {
		sourceSampleRate,
	}).sourceFrame;
	const sourceEnd = mapVideoTimelineFrameToSource(clip, visibleEndFrame, {
		sourceSampleRate,
	}).sourceFrame;
	const candidateFrames = [];
	const firstGridFrame = Math.ceil(sourceStart / intervalFrames) * intervalFrames;
	if (firstGridFrame > sourceStart && firstGridFrame >= sourceEnd) {
		candidateFrames.push(sourceStart);
	} else if (firstGridFrame > sourceStart) {
		candidateFrames.push(sourceStart);
	}
	for (let sourceFrame = firstGridFrame; sourceFrame < sourceEnd; sourceFrame += intervalFrames) {
		candidateFrames.push(sourceFrame);
	}
	if (!candidateFrames.length) candidateFrames.push(sourceStart);

	const seen = new Set();
	const timestamps = [];
	for (const candidate of candidateFrames) {
		const sourceFrame = Math.max(sourceStart, Math.min(sourceEnd, candidate));
		const cacheFrame = Math.round(sourceFrame);
		if (seen.has(cacheFrame)) continue;
		seen.add(cacheFrame);
		const mapped = mapVideoSourceFrameToTimeline(clip, sourceFrame, {
			projectSampleRate,
			sourceSampleRate,
			clamp: true,
		});
		timestamps.push(Object.freeze({
			sourceFrame: cacheFrame,
			sourceTimeSeconds: cacheFrame / sourceSampleRate,
			timelineFrame: mapped.timelineFrame,
			timelineTimeSeconds: mapped.timelineTimeSeconds,
			gridIndex: Math.round(cacheFrame / intervalFrames),
			intervalSeconds,
		}));
	}
	return Object.freeze(timestamps);
}

export function videoTimelineDurationFrames(project) {
	let durationFrames = 0;
	for (const clip of project?.clips || []) {
		if (clip?.kind !== 'video') continue;
		durationFrames = Math.max(durationFrames, videoClipEndFrame(clip));
	}
	return durationFrames;
}

function sameVisual(segment, active) {
	if (segment.kind !== active.kind) return false;
	if (segment.kind === 'black') return segment.color === active.color;
	return segment.clipId === active.clipId && segment.trackId === active.trackId;
}

function normalizeBlackColor(value) {
	const color = String(value || '#000000').trim();
	if (!color) throw new TypeError('blackColor must not be empty.');
	return color;
}

function boundedPosition(value, minimum, maximum, clamp, name) {
	if (value >= minimum && value <= maximum) return value;
	if (clamp) return Math.max(minimum, Math.min(maximum, value));
	throw new RangeError(`${name} must be inside the active clip range.`);
}

function optionalPositiveRate(value, name) {
	if (value == null) return null;
	return positiveFiniteNumber(value, name);
}

function finiteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return number;
}

function nonNegativeFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
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
