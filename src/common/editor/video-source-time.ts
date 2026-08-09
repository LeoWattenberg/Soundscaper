/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_THUMBNAIL_BASE_INTERVAL_SECONDS = 5;
export const VIDEO_THUMBNAIL_MINIMUM_SPACING_PIXELS = 80;

type DataRecord = Readonly<Record<string, unknown>>;

/** Compare the active source range with the timeline range in wall-clock time. */
export function videoClipPlaybackRate(
	clipValue: unknown,
	projectSampleRate: number,
	sourceSampleRate = projectSampleRate,
): number {
	const clip = record(clipValue, 'clip');
	const timelineRate = positiveFiniteNumber(projectSampleRate, 'projectSampleRate');
	const mediaRate = positiveFiniteNumber(sourceSampleRate, 'sourceSampleRate');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	return sourceDurationFrames / mediaRate / (durationFrames / timelineRate);
}

/** Map a project timeline position into the active source coordinate range. */
export function mapVideoTimelineFrameToSource(
	clipValue: unknown,
	timelineFrame: number,
	options: Readonly<Record<string, unknown>> = {},
) {
	const clip = record(clipValue, 'clip');
	const timelineStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const requestedFrame = finiteNumber(timelineFrame, 'timelineFrame');
	const timelineEndFrame = timelineStartFrame + durationFrames;
	const mappedTimelineFrame = boundedPosition(
		requestedFrame, timelineStartFrame, timelineEndFrame, Boolean(options.clamp), 'timelineFrame',
	);
	const progress = (mappedTimelineFrame - timelineStartFrame) / durationFrames;
	const sourceFrame = sourceStartFrame + progress * sourceDurationFrames;
	const optionSource = optionalRecord(options.source, 'options.source');
	const sourceRate = optionalPositiveRate(options.sourceSampleRate ?? optionSource?.sampleRate, 'sourceSampleRate');
	const projectRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');
	return Object.freeze({
		timelineFrame: mappedTimelineFrame,
		timelineTimeSeconds: projectRate == null ? null : mappedTimelineFrame / projectRate,
		localTimelineFrame: mappedTimelineFrame - timelineStartFrame,
		progress,
		sourceFrame,
		sourceTimeSeconds: sourceRate == null ? null : sourceFrame / sourceRate,
	});
}

/** Map an active source coordinate back to its project timeline position. */
export function mapVideoSourceFrameToTimeline(
	clipValue: unknown,
	sourceFrameValue: number,
	options: Readonly<Record<string, unknown>> = {},
) {
	const clip = record(clipValue, 'clip');
	const timelineStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const requestedFrame = finiteNumber(sourceFrameValue, 'sourceFrame');
	const sourceEndFrame = sourceStartFrame + sourceDurationFrames;
	const sourceFrame = boundedPosition(
		requestedFrame, sourceStartFrame, sourceEndFrame, Boolean(options.clamp), 'sourceFrame',
	);
	const progress = (sourceFrame - sourceStartFrame) / sourceDurationFrames;
	const timelineFrame = timelineStartFrame + progress * durationFrames;
	const optionSource = optionalRecord(options.source, 'options.source');
	const sourceRate = optionalPositiveRate(options.sourceSampleRate ?? optionSource?.sampleRate, 'sourceSampleRate');
	const projectRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');
	return Object.freeze({
		sourceFrame,
		sourceTimeSeconds: sourceRate == null ? null : sourceFrame / sourceRate,
		localSourceFrame: sourceFrame - sourceStartFrame,
		progress,
		timelineFrame,
		timelineTimeSeconds: projectRate == null ? null : timelineFrame / projectRate,
	});
}

/** Resolve the five-second source grid to a zoom-readable interval. */
export function videoThumbnailIntervalSeconds(options: Readonly<Record<string, unknown>> = {}): number {
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
	return baseIntervalSeconds * Math.max(
		1,
		Math.ceil(minimumSpacingPixels / baseGridPixels - Number.EPSILON),
	);
}

/** Select reusable source-grid timestamps for the visible portion of a clip. */
export function selectVideoThumbnailTimestamps(
	clipValue: unknown,
	sourceValue: unknown,
	options: Readonly<Record<string, unknown>> = {},
) {
	const clip = record(clipValue, 'clip');
	const source = record(sourceValue, 'source');
	const projectSampleRate = positiveFiniteNumber(options.projectSampleRate, 'projectSampleRate');
	const sourceRate = videoSourceCoordinateRate(clip, source);
	const clipStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
	const clipEndFrame = clipStartFrame + positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const visibleStartFrame = Math.max(
		clipStartFrame,
		finiteNumber(options.visibleStartFrame ?? clipStartFrame, 'visibleStartFrame'),
	);
	const visibleEndFrame = Math.min(
		clipEndFrame,
		finiteNumber(options.visibleEndFrame ?? clipEndFrame, 'visibleEndFrame'),
	);
	if (visibleEndFrame <= visibleStartFrame) return Object.freeze([]);
	const intervalSeconds = videoThumbnailIntervalSeconds({
		...options,
		playbackRate: videoClipPlaybackRate(clip, projectSampleRate, sourceRate),
	});
	const intervalFrames = Math.max(1, Math.round(intervalSeconds * sourceRate));
	const sourceStart = mapVideoTimelineFrameToSource(clip, visibleStartFrame, {
		sourceSampleRate: sourceRate,
	}).sourceFrame;
	const sourceEnd = mapVideoTimelineFrameToSource(clip, visibleEndFrame, {
		sourceSampleRate: sourceRate,
	}).sourceFrame;
	const candidates: number[] = [];
	const firstGridFrame = Math.ceil(sourceStart / intervalFrames) * intervalFrames;
	if (firstGridFrame > sourceStart) candidates.push(sourceStart);
	for (let frame = firstGridFrame; frame < sourceEnd; frame += intervalFrames) candidates.push(frame);
	if (!candidates.length) candidates.push(sourceStart);
	const seen = new Set<number>();
	return Object.freeze(candidates.flatMap((candidate) => {
		const sourceFrame = Math.max(sourceStart, Math.min(sourceEnd, candidate));
		const cacheFrame = Math.round(sourceFrame);
		if (seen.has(cacheFrame)) return [];
		seen.add(cacheFrame);
		const mapped = mapVideoSourceFrameToTimeline(clip, sourceFrame, {
			projectSampleRate,
			sourceSampleRate: sourceRate,
			clamp: true,
		});
		return [Object.freeze({
			sourceFrame: cacheFrame,
			sourceTimeSeconds: cacheFrame / sourceRate,
			timelineFrame: mapped.timelineFrame,
			timelineTimeSeconds: mapped.timelineTimeSeconds,
			gridIndex: Math.round(cacheFrame / intervalFrames),
			intervalSeconds,
		})];
	}));
}

/** Foundation source ranges use video frames; legacy source ranges use sample frames. */
export function videoSourceCoordinateRate(clipValue: unknown, sourceValue: unknown): number {
	const clip = record(clipValue, 'clip');
	const source = record(sourceValue, 'source');
	if (!Object.hasOwn(clip, 'sourceInFrame')) {
		return positiveFiniteNumber(source.sampleRate, 'source.sampleRate');
	}
	const rate = record(source.frameRate, 'source.frameRate');
	return positiveSafeInteger(rate.num, 'source.frameRate.num')
		/ positiveSafeInteger(rate.den, 'source.frameRate.den');
}

function boundedPosition(value: number, minimum: number, maximum: number, clamp: boolean, name: string): number {
	if (value >= minimum && value <= maximum) return value;
	if (clamp) return Math.max(minimum, Math.min(maximum, value));
	throw new RangeError(`${name} must be inside the active clip range.`);
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function optionalRecord(value: unknown, name: string): DataRecord | null {
	return value == null ? null : record(value, name);
}

function optionalPositiveRate(value: unknown, name: string): number | null {
	return value == null ? null : positiveFiniteNumber(value, name);
}

function finiteNumber(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return number;
}

function positiveFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}
