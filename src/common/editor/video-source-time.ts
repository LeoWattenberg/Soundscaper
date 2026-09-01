/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_THUMBNAIL_BASE_INTERVAL_SECONDS = 5;
export const VIDEO_THUMBNAIL_MINIMUM_SPACING_PIXELS = 80;

export interface RuntimeVideoTimingIndex {
	readonly encoding?: string;
	readonly timescale: number;
	readonly frameCount: number;
	readonly presentationTicks: readonly bigint[];
	readonly finalFrameDurationTicks: bigint;
	readonly endTicks: bigint;
}

const VIDEO_TIMING_INDEXES = new Map<string, RuntimeVideoTimingIndex>();
const VIDEO_TIMING_LEASES = new Map<string, VideoTimingLeaseRegistration>();
let VIDEO_TIMING_REGISTRY_TOKEN: Readonly<object> = Object.freeze({});

interface VideoTimingLeaseRegistration {
	readonly index: RuntimeVideoTimingIndex;
	readonly previousIndex: RuntimeVideoTimingIndex | undefined;
	readonly previousLease: VideoTimingLeaseRegistration | undefined;
	released: boolean;
}

export interface VideoTimingIndexLease {
	release(): boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Register a verified timing index for synchronous preview/export source-time mapping. */
export function registerVideoTimingIndex(sourceValue: unknown, indexValue: RuntimeVideoTimingIndex): void {
	const source = record(sourceValue, 'source');
	const index = timingIndex(indexValue);
	const key = videoTimingKey(source);
	VIDEO_TIMING_INDEXES.set(key, index);
	VIDEO_TIMING_LEASES.delete(key);
	advanceVideoTimingRegistryToken();
}

/** Temporarily own a verified index without clobbering an independent preview registration. */
export function acquireVideoTimingIndex(
	sourceValue: unknown,
	indexValue: RuntimeVideoTimingIndex,
): VideoTimingIndexLease {
	const source = record(sourceValue, 'source');
	const index = timingIndex(indexValue);
	const key = videoTimingKey(source);
	const registration: VideoTimingLeaseRegistration = {
		index,
		previousIndex: VIDEO_TIMING_INDEXES.get(key),
		previousLease: VIDEO_TIMING_LEASES.get(key),
		released: false,
	};
	VIDEO_TIMING_INDEXES.set(key, index);
	VIDEO_TIMING_LEASES.set(key, registration);
	advanceVideoTimingRegistryToken();
	return Object.freeze({
		release(): boolean {
			if (registration.released) return false;
			registration.released = true;
			if (VIDEO_TIMING_LEASES.get(key) !== registration) return false;
			let previousIndex = registration.previousIndex;
			let previousLease = registration.previousLease;
			while (previousLease?.released) {
				previousIndex = previousLease.previousIndex;
				previousLease = previousLease.previousLease;
			}
			if (previousLease) {
				VIDEO_TIMING_INDEXES.set(key, previousLease.index);
				VIDEO_TIMING_LEASES.set(key, previousLease);
			} else {
				if (previousIndex) VIDEO_TIMING_INDEXES.set(key, previousIndex);
				else VIDEO_TIMING_INDEXES.delete(key);
				VIDEO_TIMING_LEASES.delete(key);
			}
			advanceVideoTimingRegistryToken();
			return true;
		},
	});
}

export function unregisterVideoTimingIndex(sourceValue: unknown): void {
	let changed = false;
	if (typeof sourceValue === 'string' && sourceValue) {
		for (const key of VIDEO_TIMING_INDEXES.keys()) if (key.startsWith(`${sourceValue}:`)) {
			changed = true;
			VIDEO_TIMING_INDEXES.delete(key);
			VIDEO_TIMING_LEASES.delete(key);
		}
		if (changed) advanceVideoTimingRegistryToken();
		return;
	}
	const key = videoTimingKey(record(sourceValue, 'source'));
	changed = VIDEO_TIMING_INDEXES.has(key) || VIDEO_TIMING_LEASES.has(key);
	VIDEO_TIMING_INDEXES.delete(key);
	VIDEO_TIMING_LEASES.delete(key);
	if (changed) advanceVideoTimingRegistryToken();
}

/** Read the exact active registry object without copying or re-validating its timing payload. */
export function registeredVideoTimingIndex(sourceValue: unknown): RuntimeVideoTimingIndex | undefined {
	return VIDEO_TIMING_INDEXES.get(videoTimingKey(record(sourceValue, 'source')));
}

/** Identity changes whenever exact timing availability or lease restoration changes. */
export function videoTimingRegistryToken(): Readonly<object> {
	return VIDEO_TIMING_REGISTRY_TOKEN;
}

function advanceVideoTimingRegistryToken(): void {
	VIDEO_TIMING_REGISTRY_TOKEN = Object.freeze({});
}

/** Compare the active source range with the timeline range in wall-clock time. */
export function videoClipPlaybackRate(
	clipValue: unknown,
	projectSampleRate: number,
	sourceSampleRate = projectSampleRate,
	sourceValue?: unknown,
): number {
	const clip = record(clipValue, 'clip');
	const timelineRate = positiveFiniteNumber(projectSampleRate, 'projectSampleRate');
	const mediaRate = positiveFiniteNumber(sourceSampleRate, 'sourceSampleRate');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const index = timingIndexForClip(clip, sourceValue);
	const sourceDurationSeconds = index
		? sourceTimingRange(clip, index).durationSeconds
		: sourceDurationFrames / mediaRate;
	return sourceDurationSeconds / (durationFrames / timelineRate);
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
	const optionSource = optionalRecord(options.source, 'options.source');
	const sourceRate = optionalPositiveRate(options.sourceSampleRate ?? optionSource?.sampleRate, 'sourceSampleRate');
	const projectRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');
	const index = timingIndexForClip(clip, optionSource);
	const timing = index ? sourceTimingRange(clip, index) : null;
	const resolvedSourceTime = timing
		? timing.startTimeSeconds + progress * timing.durationSeconds
		: null;
	const sourceFrame = resolvedSourceTime == null || !index
		? sourceStartFrame + progress * sourceDurationFrames
		: sourceTimeSecondsToFrame(resolvedSourceTime, index);
	return Object.freeze({
		timelineFrame: mappedTimelineFrame,
		timelineTimeSeconds: projectRate == null ? null : mappedTimelineFrame / projectRate,
		localTimelineFrame: mappedTimelineFrame - timelineStartFrame,
		progress,
		sourceFrame,
		sourceTimeSeconds: resolvedSourceTime ?? (sourceRate == null ? null : sourceFrame / sourceRate),
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
	const optionSource = optionalRecord(options.source, 'options.source');
	const sourceRate = optionalPositiveRate(options.sourceSampleRate ?? optionSource?.sampleRate, 'sourceSampleRate');
	const projectRate = optionalPositiveRate(options.projectSampleRate, 'projectSampleRate');
	const index = timingIndexForClip(clip, optionSource);
	const resolvedSourceTime = index ? sourceFrameTimeSeconds(sourceFrame, index) : null;
	const timing = index ? sourceTimingRange(clip, index) : null;
	const progress = resolvedSourceTime == null || timing == null
		? (sourceFrame - sourceStartFrame) / sourceDurationFrames
		: boundedProgress((resolvedSourceTime - timing.startTimeSeconds) / timing.durationSeconds);
	const timelineFrame = timelineStartFrame + progress * durationFrames;
	return Object.freeze({
		sourceFrame,
		sourceTimeSeconds: resolvedSourceTime ?? (sourceRate == null ? null : sourceFrame / sourceRate),
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
	const spacingRatio = minimumSpacingPixels / baseGridPixels;
	const spacingTolerance = Number.isFinite(spacingRatio)
		? Number.EPSILON * Math.max(1, spacingRatio) * 4
		: 0;
	return baseIntervalSeconds * Math.max(
		1,
		Math.ceil(spacingRatio - spacingTolerance),
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
		playbackRate: videoClipPlaybackRate(clip, projectSampleRate, sourceRate, source),
	});
	const intervalFrames = Math.max(1, Math.round(intervalSeconds * sourceRate));
	const sourceStart = mapVideoTimelineFrameToSource(clip, visibleStartFrame, {
		sourceSampleRate: sourceRate,
		source,
	}).sourceFrame;
	const sourceEnd = mapVideoTimelineFrameToSource(clip, visibleEndFrame, {
		sourceSampleRate: sourceRate,
		source,
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
			source,
			clamp: true,
		});
		return [Object.freeze({
			sourceFrame: cacheFrame,
			sourceTimeSeconds: sourceFrameTimeSeconds(
				cacheFrame,
				timingIndexForClip(clip, source),
			) ?? cacheFrame / sourceRate,
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

function videoTimingKey(source: DataRecord): string {
	if (typeof source.id !== 'string' || !source.id) throw new TypeError('A video timing source requires an ID.');
	return `${source.id}:${typeof source.contentSha256 === 'string' ? source.contentSha256 : ''}`;
}

function timingIndexForClip(
	clip: DataRecord,
	sourceValue: unknown,
): RuntimeVideoTimingIndex | undefined {
	if (!Object.hasOwn(clip, 'sourceInFrame') || sourceValue == null) return undefined;
	return VIDEO_TIMING_INDEXES.get(videoTimingKey(record(sourceValue, 'source')));
}

function sourceTimingRange(
	clip: DataRecord,
	index: RuntimeVideoTimingIndex,
): Readonly<{ startTimeSeconds: number; endTimeSeconds: number; durationSeconds: number }> {
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const sourceEndFrame = sourceStartFrame + sourceDurationFrames;
	if (!Number.isSafeInteger(sourceEndFrame) || sourceEndFrame > index.frameCount) {
		throw new RangeError('The active clip source range exceeds its timing index.');
	}
	const startTimeSeconds = sourceFrameTimeSeconds(sourceStartFrame, index);
	const endTimeSeconds = sourceFrameTimeSeconds(sourceEndFrame, index);
	if (startTimeSeconds == null || endTimeSeconds == null || endTimeSeconds <= startTimeSeconds) {
		throw new RangeError('The active clip source range has no positive timing span.');
	}
	return Object.freeze({
		startTimeSeconds,
		endTimeSeconds,
		durationSeconds: endTimeSeconds - startTimeSeconds,
	});
}

function timingIndex(value: RuntimeVideoTimingIndex): RuntimeVideoTimingIndex {
	if (!value || typeof value !== 'object') throw new TypeError('A video timing index is required.');
	positiveSafeInteger(value.timescale, 'timing.timescale');
	const frameCount = positiveSafeInteger(value.frameCount, 'timing.frameCount');
	if (!Array.isArray(value.presentationTicks) || value.presentationTicks.length !== frameCount
		|| value.presentationTicks.some((tick) => typeof tick !== 'bigint')) {
		throw new RangeError('Video timing PTS must match its frame count.');
	}
	if (typeof value.finalFrameDurationTicks !== 'bigint' || value.finalFrameDurationTicks <= 0n
		|| typeof value.endTicks !== 'bigint' || value.endTicks <= 0n) {
		throw new RangeError('Video timing endpoints must be positive integer ticks.');
	}
	return value;
}

function sourceFrameTimeSeconds(sourceFrame: number, index: RuntimeVideoTimingIndex | undefined): number | null {
	if (!index) return null;
	const bounded = Math.max(0, Math.min(index.frameCount, finiteNumber(sourceFrame, 'sourceFrame')));
	if (bounded === index.frameCount) return Number(index.endTicks) / index.timescale;
	const lower = Math.floor(bounded);
	const progress = bounded - lower;
	const start = index.presentationTicks[lower];
	const end = lower + 1 < index.frameCount
		? index.presentationTicks[lower + 1]
		: index.endTicks;
	if (start === undefined || end === undefined) throw new RangeError('The video timing index is incomplete.');
	return (Number(start) + Number(end - start) * progress) / index.timescale;
}

function sourceTimeSecondsToFrame(sourceTimeSeconds: number, index: RuntimeVideoTimingIndex): number {
	const target = finiteNumber(sourceTimeSeconds, 'sourceTimeSeconds');
	const first = Number(index.presentationTicks[0]) / index.timescale;
	const end = Number(index.endTicks) / index.timescale;
	if (target <= first) return 0;
	if (target >= end) return index.frameCount;
	let lower = 0;
	let upper = index.frameCount;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		const middleTime = Number(index.presentationTicks[middle]) / index.timescale;
		if (middleTime <= target) lower = middle;
		else upper = middle;
	}
	const start = Number(index.presentationTicks[lower]) / index.timescale;
	const next = lower + 1 < index.frameCount
		? Number(index.presentationTicks[lower + 1]) / index.timescale
		: end;
	return lower + boundedProgress((target - start) / (next - start));
}

function boundedProgress(value: number): number {
	return Math.max(0, Math.min(1, value));
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
