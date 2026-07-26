import type {
	TimelineIndexClip,
	TimelineIndexSource,
	TimelineIndexTrack,
	TimelineProjectIndex,
	TimelineProjectLike,
	TimelineViewportClip,
	TimelineViewportProjection,
	ViewportClipProjection,
	ViewportProjectionOptions,
} from './types.ts';
import {
	MAXIMUM_FRAME,
	addFrames,
	clamp,
	nonNegativeSafeInteger,
	normalizeSampleRate,
	positiveSafeInteger,
} from './validation.ts';

/** Build shared clip/source/track lookups at the project boundary. */
export function createTimelineProjectIndex<
	Clip extends TimelineIndexClip = TimelineIndexClip,
	Source extends TimelineIndexSource = TimelineIndexSource,
	Track extends TimelineIndexTrack = TimelineIndexTrack,
>(project: TimelineProjectLike<Clip, Source, Track> | null | undefined): TimelineProjectIndex<Clip, Source, Track> {
	const clips: readonly Clip[] = Array.isArray(project?.clips) ? project.clips : [];
	const sources: readonly Source[] = Array.isArray(project?.sources) ? project.sources : [];
	const tracks: readonly Track[] = Array.isArray(project?.tracks) ? project.tracks : [];
	const clipById = new Map(clips.map((clip) => [clip.id, clip]));
	const sourceById = new Map(sources.map((source) => [source.id, source]));
	const clipsByTrackId = new Map<string, Clip[]>();
	const trackByClipId = new Map<string, Track>();

	for (const track of tracks) {
		const trackClips: Clip[] = [];
		for (const clipId of Array.isArray(track.clipIds) ? track.clipIds : []) {
			const clip = clipById.get(clipId);
			if (!clip) continue;
			trackClips.push(clip);
			trackByClipId.set(clipId, track);
		}
		clipsByTrackId.set(track.id, trackClips);
	}

	return {
		clipById,
		sourceById,
		clipsByTrackId,
		trackByClipId,
	};
}

/** Project canonical clips into viewport-relative design-system coordinates. */
export function projectClipsToViewport<Clip extends TimelineViewportClip>(
	clips: readonly Clip[],
	options: ViewportProjectionOptions,
): TimelineViewportProjection<Clip> {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	const viewportStartFrame = nonNegativeSafeInteger(options.viewportStartFrame ?? 0, 'viewportStartFrame');
	const viewportDurationFrames = positiveSafeInteger(options.viewportDurationFrames, 'viewportDurationFrames');
	const viewportEndFrame = addFrames(viewportStartFrame, viewportDurationFrames, 'viewport');
	const overscanStartFrame = Math.max(0, viewportStartFrame - viewportDurationFrames);
	const overscanEndFrame = Math.min(MAXIMUM_FRAME, viewportEndFrame + viewportDurationFrames);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const viewportDurationSeconds = viewportDurationFrames / sampleRate;

	const projectedClips: Array<Clip & ViewportClipProjection> = [];
	for (const clip of clips) {
		if (!clip || typeof clip !== 'object') throw new TypeError('Each clip must be an object.');
		const clipStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const clipDurationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
		const clipEndFrame = addFrames(clipStartFrame, clipDurationFrames, 'clip');
		if (clipStartFrame >= overscanEndFrame || clipEndFrame <= overscanStartFrame) continue;

		const projectedStartFrame = Math.max(clipStartFrame, overscanStartFrame);
		const projectedEndFrame = Math.min(clipEndFrame, overscanEndFrame);
		const start = (projectedStartFrame - viewportStartFrame) / sampleRate;
		const end = (projectedEndFrame - viewportStartFrame) / sampleRate;
		projectedClips.push({
			...clip,
			start,
			duration: (projectedEndFrame - projectedStartFrame) / sampleRate,
			timelineStartSeconds: clipStartFrame / sampleRate,
			timelineDurationSeconds: clipDurationFrames / sampleRate,
			clipStartSeconds: (clipStartFrame - viewportStartFrame) / sampleRate,
			clipEndSeconds: (clipEndFrame - viewportStartFrame) / sampleRate,
			viewportStartSeconds: start,
			viewportEndSeconds: end,
			waveformStartFrame: projectedStartFrame - clipStartFrame,
			waveformEndFrame: projectedEndFrame - clipStartFrame,
			clippedAtStart: projectedStartFrame !== clipStartFrame,
			clippedAtEnd: projectedEndFrame !== clipEndFrame,
			visibleStartSeconds: clamp(start, 0, viewportDurationSeconds),
			visibleEndSeconds: clamp(end, 0, viewportDurationSeconds),
			isVisible: clipStartFrame < viewportEndFrame && clipEndFrame > viewportStartFrame,
		});
	}

	return {
		viewportStartFrame,
		viewportEndFrame,
		viewportDurationFrames,
		viewportStartSeconds: viewportStartFrame / sampleRate,
		viewportDurationSeconds,
		overscanStartFrame,
		overscanEndFrame,
		clips: projectedClips,
	};
}

/** Return the visible clip nearest the viewport's right edge. */
export function rightmostVisibleClip<Clip extends Pick<
	ViewportClipProjection,
	'isVisible' | 'visibleEndSeconds' | 'visibleStartSeconds'
>>(clips: readonly Clip[]): Clip | null {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	let result: Clip | null = null;
	for (const clip of clips) {
		if (!clip?.isVisible) continue;
		if (!result || clip.visibleEndSeconds > result.visibleEndSeconds
			|| (clip.visibleEndSeconds === result.visibleEndSeconds
				&& clip.visibleStartSeconds >= result.visibleStartSeconds)) {
			result = clip;
		}
	}
	return result;
}
