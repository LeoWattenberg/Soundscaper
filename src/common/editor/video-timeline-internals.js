/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';
import {
	isTrackFolderMediaStateProjectionV12,
} from './track-folder-media-runtime.ts';
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

export { createVisibleVideoTrackPredicate, isVisibleVideoTrack } from './video-track-visibility.js';
import { createVisibleVideoTrackPredicate } from './video-track-visibility.js';

/**
 * How a video timeline is read: track order, transitions, and the value guards.
 *
 * These sit apart from the resolvers that use them because they answer questions about one
 * clip, one track or one number, while the resolvers answer questions about the timeline.
 * The guards in particular are deliberately loud: a frame count that is not a safe integer
 * would silently produce a composition nobody asked for, so each one names the field it
 * refused rather than coercing it.
 */

export function videoClipEndFrame(clip) {
	return nonNegativeSafeInteger(clip?.timelineStartFrame, 'clip.timelineStartFrame')
		+ positiveSafeInteger(clip?.durationFrames, 'clip.durationFrames');
}


export function videoTrackVisibility(project, requested) {
	const visible = createVisibleVideoTrackPredicate(project?.tracks);
	if (typeof requested !== 'function') return visible;
	// An explicit predicate still replaces the default outright for a legacy project.
	if (!isTrackFolderMediaStateProjectionV12(project)) return requested;
	return (track) => visible(track) && requested(track);
}

export function normalizeClipLookup(value) {
	if (value instanceof Map) return value;
	if (Array.isArray(value)) return new Map(value.map((clip) => [clip.id, clip]));
	if (value && typeof value.get === 'function') return value;
	throw new TypeError('clipById must be a clip map or array.');
}

export function compareVideoClips(left, right) {
	return left.timelineStartFrame - right.timelineStartFrame
		|| videoClipEndFrame(left) - videoClipEndFrame(right)
		|| compareCodeUnits(String(left.id), String(right.id));
}

export function orderedVideoTrackClips(track, clipById) {
	return track.clipIds.map((clipId) => clipById.get(clipId)).filter((clip) => (
		!isProductVisualClip(clip)
	)).sort(compareVideoClips);
}

export function isProductVisualClip(clip) {
	return clip?.kind === 'still' || clip?.kind === 'generator' || clip?.kind === 'image';
}

export function videoSourceForClip(sourceById, clip) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Video clip ${clip.id} references missing source ${clip.sourceId}.`);
	if (source.kind !== 'video') {
		throw new TypeError(`Video clip ${clip.id} references non-video source ${source.id}.`);
	}
	return source;
}

export function videoTransition(track, outgoing, incoming) {
	const authored = (Array.isArray(track?.videoTransitions) ? track.videoTransitions : []).find((transition) => (
		transition?.outgoingClipId === outgoing.id && transition?.incomingClipId === incoming.id
	));
	return {
		startFrame: incoming.timelineStartFrame,
		endFrame: videoClipEndFrame(outgoing),
		...(authored?.curve == null ? {} : { curve: authored.curve }),
	};
}

export function clipComposition(clip) {
	return Object.hasOwn(clip, 'videoComposition')
		? normalizeVideoClipComposition(clip.videoComposition, `clip ${clip.id}.videoComposition`)
		: DEFAULT_VIDEO_CLIP_COMPOSITION;
}

export function assertCompatibleVideoTransitionComposition(outgoing, incoming, trackId) {
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

export function resolveClipRenderDescription(clip, source, renderCanvas, opacityStart, opacityEnd = opacityStart) {
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

export function sameVisual(segment, active) {
	if (segment.kind !== active.kind) return false;
	if (segment.kind === 'black') return segment.color === active.color;
	return segment.clipId === active.clipId && segment.trackId === active.trackId;
}

export function normalizeBlackColor(value) {
	const color = String(value || '#000000').trim();
	if (!color) throw new TypeError('blackColor must not be empty.');
	return color;
}

export function finiteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return number;
}

export function nonNegativeFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

export function positiveFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

export function nonNegativeSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

export function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}
