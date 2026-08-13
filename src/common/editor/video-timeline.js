import {
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
} from './runtime-clip-projection.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	isTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from './track-folder-media-runtime.ts';
import {
	mapVideoTimelineFrameToSource,
	videoClipPlaybackRate,
	videoSourceCoordinateRate,
} from './video-source-time.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from './video-clip-composition.ts';
import { resolveVideoRenderDescription } from './video-render-description.ts';
import { resolveVideoSourceDisplaySize } from './video-source-presentation.ts';
export {
	mapVideoSourceFrameToTimeline,
	mapVideoTimelineFrameToSource,
	selectVideoThumbnailTimestamps,
	videoClipPlaybackRate,
	videoThumbnailIntervalSeconds,
	VIDEO_THUMBNAIL_BASE_INTERVAL_SECONDS,
	VIDEO_THUMBNAIL_MINIMUM_SPACING_PIXELS,
} from './video-source-time.ts';

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
 * Validate the transition geometry for one video track.
 *
 * Video clips may be disjoint, touch at their edges, or overlap as a proper
 * transition where the later clip also ends later. Nested/equal-boundary
 * overlaps and any interval with three active clips are ambiguous and rejected.
 */
export function validateVideoTrackComposition(track, clipById) {
	if (!track || track.type !== 'video') throw new TypeError('A video track is required.');
	if (!Array.isArray(track.clipIds)) throw new TypeError(`Video track ${track.id} must contain clip IDs.`);
	const lookup = normalizeClipLookup(clipById);
	const clips = track.clipIds.map((clipId) => {
		const clip = lookup.get(clipId);
		if (!clip) throw new ReferenceError(`Video track ${track.id} references missing clip ${clipId}.`);
		if (clip.kind !== 'video') {
			throw new TypeError(`Video track ${track.id} contains non-video clip ${clip.id}.`);
		}
		return clip;
	}).sort(compareVideoClips);
	const active = [];

	for (const clip of clips) {
		const startFrame = nonNegativeSafeInteger(
			clip.timelineStartFrame,
			`clip ${clip.id} timelineStartFrame`,
		);
		const endFrame = startFrame + positiveSafeInteger(
			clip.durationFrames,
			`clip ${clip.id} durationFrames`,
		);
		for (let index = active.length - 1; index >= 0; index -= 1) {
			if (active[index].endFrame <= startFrame) active.splice(index, 1);
		}
		if (active.length >= 2) {
			throw new RangeError(
				`Video clips overlap on track ${track.id}; overlapping clips cannot create a three-way transition.`,
			);
		}
		if (active.length === 1) {
			const earlier = active[0];
			if (!(
				earlier.startFrame < startFrame
				&& startFrame < earlier.endFrame
				&& earlier.endFrame < endFrame
			)) {
				throw new RangeError(
					`Video clips overlap on track ${track.id}; overlapping clips must form a proper edge transition.`,
				);
			}
			assertCompatibleVideoTransitionComposition(earlier.clip, clip, track.id);
		}
		active.push({ clip, startFrame, endFrame });
	}

	return true;
}

/**
 * Resolve every visible video track at a timeline frame. Project track order is
 * foreground-first, while the returned array is bottom-to-top painter order.
 */
export function resolveActiveVideoLayers(project, timelineFrame, options = {}) {
	project = runtimeProject(project);
	const frame = nonNegativeFiniteNumber(timelineFrame, 'timelineFrame');
	const sampleRate = positiveFiniteNumber(project?.sampleRate, 'project.sampleRate');
	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
	const visible = videoTrackVisibility(project, options.isTrackVisible);
	const orderedTrackIndexes = tracks.map((_, index) => index).reverse();
	const layers = [];

	for (const trackIndex of orderedTrackIndexes) {
		const track = tracks[trackIndex];
		if (track?.type !== 'video' || !visible(track)) continue;
		validateVideoTrackComposition(track, clipById);
		const activeClips = orderedVideoTrackClips(track, clipById)
			.filter((clip) => frame >= clip.timelineStartFrame && frame < videoClipEndFrame(clip));
		if (!activeClips.length) continue;

		const transition = activeClips.length === 2
			? videoTransition(activeClips[0], activeClips[1])
			: null;
		if (options.renderCanvas != null && activeClips.length === 2) {
			assertCompatibleVideoTransitionComposition(activeClips[0], activeClips[1], track.id);
		}
		const clips = activeClips.map((clip, clipIndex) => {
			const source = videoSourceForClip(sourceById, clip);
			const sourceCoordinateRate = videoSourceCoordinateRate(clip, source);
			const mapping = mapVideoTimelineFrameToSource(clip, frame, {
				projectSampleRate: sampleRate,
				sourceSampleRate: sourceCoordinateRate,
				source,
			});
			const role = transition == null
				? 'single'
				: clipIndex === 0 ? 'outgoing' : 'incoming';
			const transitionOpacity = transition == null
				? 1
				: videoTransitionOpacity(transition, role, frame);
			const renderDescription = options.renderCanvas == null
				? null
				: resolveClipRenderDescription(clip, source, options.renderCanvas, transitionOpacity);
			return Object.freeze({
				kind: 'video',
				role,
				clip,
				clipId: clip.id,
				source,
				sourceId: source.id,
				sourceFrame: mapping.sourceFrame,
				sourceTimeSeconds: mapping.sourceTimeSeconds,
				playbackRate: videoClipPlaybackRate(clip, sampleRate, sourceCoordinateRate, source),
				opacity: renderDescription?.opacityStart ?? transitionOpacity,
				...(renderDescription == null ? {} : { renderDescription }),
			});
		});
		layers.push(Object.freeze({
			kind: 'video-track',
			timelineFrame: frame,
			timelineTimeSeconds: frame / sampleRate,
			track,
			trackId: track.id,
			trackIndex,
			clips: Object.freeze(clips),
		}));
	}
	if (options.renderCanvas != null) {
		layers.sort((left, right) => (
			left.clips[0].renderDescription.compositingOrder
				- right.clips[0].renderDescription.compositingOrder
			|| right.trackIndex - left.trackIndex
		));
	}

	return Object.freeze(layers);
}

/**
 * Resolve layered composition intervals over a requested timeline range.
 * Opacity values are evaluated at absolute interval boundaries so a range that
 * begins partway through a transition retains the correct fade progress.
 */
export function resolveVideoCompositionIntervals(project, options = {}) {
	project = runtimeProject(project);
	positiveFiniteNumber(project?.sampleRate, 'project.sampleRate');
	const startFrame = nonNegativeSafeInteger(options.startFrame ?? 0, 'startFrame');
	const endFrame = nonNegativeSafeInteger(
		options.endFrame ?? videoTimelineDurationFrames(project),
		'endFrame',
	);
	if (endFrame < startFrame) throw new RangeError('endFrame cannot precede startFrame.');
	if (endFrame === startFrame) return Object.freeze([]);

	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const visible = videoTrackVisibility(project, options.isTrackVisible);
	const boundaries = new Set([startFrame, endFrame]);
	for (const track of project?.tracks || []) {
		if (track?.type !== 'video' || !visible(track)) continue;
		validateVideoTrackComposition(track, clipById);
		for (const clip of orderedVideoTrackClips(track, clipById)) {
			const clipStart = clip.timelineStartFrame;
			const clipEnd = videoClipEndFrame(clip);
			if (clipEnd <= startFrame || clipStart >= endFrame) continue;
			boundaries.add(Math.max(startFrame, clipStart));
			boundaries.add(Math.min(endFrame, clipEnd));
		}
	}

	const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
	const blackColor = normalizeBlackColor(options.blackColor);
	const intervals = [];
	for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
		const intervalStart = sortedBoundaries[index];
		const intervalEnd = sortedBoundaries[index + 1];
		if (intervalEnd <= intervalStart) continue;
		const midpoint = intervalStart + (intervalEnd - intervalStart) / 2;
		const activeLayers = resolveActiveVideoLayers(project, midpoint, options);
		const layers = activeLayers.map((layer) => Object.freeze({
			kind: 'video-track',
			track: layer.track,
			trackId: layer.trackId,
			trackIndex: layer.trackIndex,
			clips: Object.freeze(layer.clips.map((activeClip) => {
				const sourceCoordinateRate = videoSourceCoordinateRate(activeClip.clip, activeClip.source);
				const sourceStart = mapVideoTimelineFrameToSource(activeClip.clip, intervalStart, {
					sourceSampleRate: sourceCoordinateRate,
					source: activeClip.source,
				});
				const sourceEnd = mapVideoTimelineFrameToSource(activeClip.clip, intervalEnd, {
					sourceSampleRate: sourceCoordinateRate,
					source: activeClip.source,
				});
				const transition = layer.clips.length === 2
					? videoTransition(layer.clips[0].clip, layer.clips[1].clip)
					: null;
				const transitionOpacityStart = transition == null
					? 1
					: videoTransitionOpacity(transition, activeClip.role, intervalStart);
				const transitionOpacityEnd = transition == null
					? 1
					: videoTransitionOpacity(transition, activeClip.role, intervalEnd);
				const renderDescription = options.renderCanvas == null
					? null
					: resolveClipRenderDescription(
						activeClip.clip,
						activeClip.source,
						options.renderCanvas,
						transitionOpacityStart,
						transitionOpacityEnd,
					);
				return Object.freeze({
					kind: 'video',
					role: activeClip.role,
					clip: activeClip.clip,
					clipId: activeClip.clipId,
					source: activeClip.source,
					sourceId: activeClip.sourceId,
					sourceStartFrame: sourceStart.sourceFrame,
					sourceEndFrame: sourceEnd.sourceFrame,
					sourceDurationFrames: sourceEnd.sourceFrame - sourceStart.sourceFrame,
					sourceStartTimeSeconds: sourceStart.sourceTimeSeconds,
					sourceEndTimeSeconds: sourceEnd.sourceTimeSeconds,
					playbackRate: activeClip.playbackRate,
					opacityStart: renderDescription?.opacityStart ?? transitionOpacityStart,
					opacityEnd: renderDescription?.opacityEnd ?? transitionOpacityEnd,
					...(renderDescription == null ? {} : { renderDescription }),
				});
			})),
		}));
		const interval = {
			kind: layers.length ? 'composition' : 'black',
			timelineStartFrame: intervalStart,
			timelineEndFrame: intervalEnd,
			durationFrames: intervalEnd - intervalStart,
			layers: Object.freeze(layers),
		};
		if (!layers.length) interval.color = blackColor;
		intervals.push(Object.freeze(interval));
	}
	return Object.freeze(intervals);
}

/**
 * Resolve the foreground picture for compatibility with the original
 * single-video API. Layer-aware preview/export code should use
 * resolveActiveVideoLayers().
 *
 * @deprecated Use resolveActiveVideoLayers().
 */
export function resolveActiveVideoClip(project, timelineFrame, options = {}) {
	project = runtimeProject(project);
	const frame = nonNegativeFiniteNumber(timelineFrame, 'timelineFrame');
	const sampleRate = positiveFiniteNumber(project?.sampleRate, 'project.sampleRate');
	const layers = resolveActiveVideoLayers(project, frame, options);
	const layer = options.topTrackFirst === false ? layers[0] : layers.at(-1);
	if (layer) {
		const active = layer.clips.reduce((selected, candidate) => (
			selected == null || candidate.opacity >= selected.opacity ? candidate : selected
		), null);
		return Object.freeze({
			kind: 'video',
			timelineFrame: frame,
			timelineTimeSeconds: frame / sampleRate,
			track: layer.track,
			trackId: layer.trackId,
			trackIndex: layer.trackIndex,
			clip: active.clip,
			clipId: active.clipId,
			source: active.source,
			sourceId: active.sourceId,
			sourceFrame: active.sourceFrame,
			sourceTimeSeconds: active.sourceTimeSeconds,
			playbackRate: active.playbackRate,
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
 *
 * @deprecated Use resolveVideoCompositionIntervals().
 */
export function resolveVideoTimelineSegments(project, options = {}) {
	project = runtimeProject(project);
	const startFrame = nonNegativeSafeInteger(options.startFrame ?? 0, 'startFrame');
	const endFrame = nonNegativeSafeInteger(
		options.endFrame ?? videoTimelineDurationFrames(project),
		'endFrame',
	);
	if (endFrame < startFrame) throw new RangeError('endFrame cannot precede startFrame.');
	if (endFrame === startFrame) return Object.freeze([]);

	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const visible = videoTrackVisibility(project, options.isTrackVisible);
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
					sourceSampleRate: videoSourceCoordinateRate(previous.clip, previous.source),
					source: previous.source,
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

		const sourceCoordinateRate = videoSourceCoordinateRate(active.clip, active.source);
		const sourceStart = mapVideoTimelineFrameToSource(active.clip, segmentStart, {
			sourceSampleRate: sourceCoordinateRate,
			source: active.source,
		});
		const sourceEnd = mapVideoTimelineFrameToSource(active.clip, segmentEnd, {
			sourceSampleRate: sourceCoordinateRate,
			source: active.source,
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

export function videoTimelineDurationFrames(project) {
	project = runtimeProject(project);
	let durationFrames = 0;
	for (const clip of project?.clips || []) {
		if (clip?.kind !== 'video') continue;
		durationFrames = Math.max(durationFrames, videoClipEndFrame(clip));
	}
	return durationFrames;
}

function runtimeProject(project) {
	const mediaProject = projectTrackFolderMediaStateV12(project);
	if (isRuntimeProjectProjection(mediaProject)) return mediaProject;
	return inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		resolveRuntimeProjectProjection(mediaProject),
	);
}

function videoTrackVisibility(project, requested) {
	if (typeof requested !== 'function') return isVisibleVideoTrack;
	if (!isTrackFolderMediaStateProjectionV12(project)) return requested;
	return (track) => isVisibleVideoTrack(track) && requested(track);
}

function normalizeClipLookup(value) {
	if (value instanceof Map) return value;
	if (Array.isArray(value)) return new Map(value.map((clip) => [clip.id, clip]));
	if (value && typeof value.get === 'function') return value;
	throw new TypeError('clipById must be a clip map or array.');
}

function compareVideoClips(left, right) {
	return left.timelineStartFrame - right.timelineStartFrame
		|| videoClipEndFrame(left) - videoClipEndFrame(right)
		|| String(left.id).localeCompare(String(right.id));
}

function orderedVideoTrackClips(track, clipById) {
	return track.clipIds.map((clipId) => clipById.get(clipId)).sort(compareVideoClips);
}

function videoSourceForClip(sourceById, clip) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Video clip ${clip.id} references missing source ${clip.sourceId}.`);
	if (source.kind !== 'video') {
		throw new TypeError(`Video clip ${clip.id} references non-video source ${source.id}.`);
	}
	return source;
}

function videoTransition(outgoing, incoming) {
	return {
		startFrame: incoming.timelineStartFrame,
		endFrame: videoClipEndFrame(outgoing),
	};
}

function videoTransitionOpacity(transition, role, frame) {
	const progress = Math.max(0, Math.min(
		1,
		(frame - transition.startFrame) / (transition.endFrame - transition.startFrame),
	));
	return role === 'outgoing' ? 1 - progress : progress;
}

function clipComposition(clip) {
	return Object.hasOwn(clip, 'videoComposition')
		? normalizeVideoClipComposition(clip.videoComposition, `clip ${clip.id}.videoComposition`)
		: DEFAULT_VIDEO_CLIP_COMPOSITION;
}

function assertCompatibleVideoTransitionComposition(outgoing, incoming, trackId) {
	const outgoingComposition = clipComposition(outgoing);
	const incomingComposition = clipComposition(incoming);
	if (outgoingComposition.blendMode !== incomingComposition.blendMode) {
		throw new RangeError(
			`A same-track transition on ${trackId} requires one blend mode across both clips.`,
		);
	}
	if (outgoingComposition.compositingOrder !== incomingComposition.compositingOrder) {
		throw new RangeError(
			`A same-track transition on ${trackId} requires one compositing order across both clips.`,
		);
	}
}

function resolveClipRenderDescription(clip, source, renderCanvas, opacityStart, opacityEnd = opacityStart) {
	const sourceDisplaySize = resolveVideoSourceDisplaySize(source);
	if (!sourceDisplaySize) {
		throw new RangeError(`Video source ${source.id} has no resolvable display size.`);
	}
	return resolveVideoRenderDescription({
		composition: clipComposition(clip),
		sourceDisplaySize,
		canvas: renderCanvas,
		opacityStart,
		opacityEnd,
	});
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
