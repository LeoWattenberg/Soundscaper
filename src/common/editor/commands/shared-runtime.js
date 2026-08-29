/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';
import { compareCodeUnits } from '../code-unit-order.ts';
import {
	clipEndFrame,
	findClip,
	findClipTrack,
	findProjectBinClip,
	findSource,
	findTrack,
} from '../project.js';
import {
	createMediaClip,
	createMediaSource,
	createMediaTrack,
} from '../project-media-factory.ts';
import {
	isRuntimeProjectProjection,
	resolveRuntimeClipProjection,
} from '../runtime-clip-projection.ts';
import {
	cloneVideoEffects,
} from '../video-effects.js';
import { trimAudioWarpClipToTimelineRange } from '../audio-warp-clip-edit.ts';
import { detachVideoCompositionCarrier } from './video-composition-carrier.ts';
import {
	detachVideoKeyframeCarrier,
} from './video-keyframe-carrier.ts';
import { finalizeVideoKeyframeSegmentCarrier } from './video-keyframe-segment-carrier.ts';

export function pruneMissingProjectSelections(project) {
	const trackIds = new Set(project.tracks.map((track) => track.id));
	const timelineClipIds = new Set(project.clips.map((clip) => clip.id));
	const timelineAnnotationIds = new Set(
		Array.isArray(project.timelineAnnotations)
			? project.timelineAnnotations.map((annotation) => annotation.id)
			: [],
	);
	if (Array.isArray(project.selection?.trackIds)) {
		project.selection.trackIds = project.selection.trackIds.filter((trackId) => trackIds.has(trackId));
	}
	if (Array.isArray(project.selection?.clipIds)) {
		project.selection.clipIds = project.selection.clipIds.filter((clipId) => timelineClipIds.has(clipId));
	}
	if (Array.isArray(project.selection?.annotationIds)) {
		project.selection.annotationIds = project.selection.annotationIds.filter(
			(annotationId) => timelineAnnotationIds.has(annotationId),
		);
	}
	if (Array.isArray(project.view?.selectedTrackIds)) {
		project.view.selectedTrackIds = project.view.selectedTrackIds.filter((trackId) => trackIds.has(trackId));
	}
}

export function withoutImportedPitchPreset(opaqueExtensions) {
	const output = { ...(opaqueExtensions || {}) };
	delete output.aup4PitchAndSpeedPreset;
	return output;
}

export function ensureMixer(project) {
	if (!project.mixer) project.mixer = { groups: [], sends: [], routes: {} };
	project.mixer.groups ||= [];
	project.mixer.sends ||= [];
	project.mixer.routes ||= {};
	return project.mixer;
}

export function mixerBusCollection(project, type) {
	const mixer = ensureMixer(project);
	if (type === 'group') return mixer.groups;
	if (type === 'send') return mixer.sends;
	throw new RangeError('Mixer bus type must be group or send.');
}

export function requireMixerBus(project, type, busId) {
	const bus = mixerBusCollection(project, type).find((candidate) => candidate.id === busId);
	if (!bus) throw new ReferenceError(`Unknown ${type} bus: ${busId}.`);
	return bus;
}

/**
 * Carry the gain a clip already described across the segment's own range.
 * Keeping only the points that fall inside it is not enough, because the
 * evaluator supplies its own values outside them: it ramps up from unity before
 * the first point and holds the last one after it. A cut between two points
 * would therefore flatten the left half and start the right half at full gain,
 * so a boundary the clip has no point on gains one holding the interpolated
 * value. A boundary that is also the clip's own edge keeps the evaluator's
 * existing behaviour and is left alone, so a full-extent segment is unchanged.
 */
function segmentEnvelope(clip, offsetFrames, durationFrames) {
	if (!Array.isArray(clip.envelope)) return undefined;
	if (clip.envelope.length === 0) return [];
	const endFrame = offsetFrames + durationFrames;
	const inside = clip.envelope.filter((point) => point.frame >= offsetFrames && point.frame <= endFrame);
	const valueAt = createEnvelopeValueEvaluator(clip.envelope, Math.max(1, clip.durationFrames));
	const boundaries = [];
	if (offsetFrames > 0 && !inside.some((point) => point.frame === offsetFrames)) {
		boundaries.push({ frame: offsetFrames, value: valueAt(offsetFrames) });
	}
	if (durationFrames > 0 && endFrame < clip.durationFrames
		&& !inside.some((point) => point.frame === endFrame)) {
		boundaries.push({ frame: endFrame, value: valueAt(endFrame) });
	}
	return [...inside, ...boundaries]
		.sort((left, right) => left.frame - right.frame)
		.map((point) => ({ ...point, frame: point.frame - offsetFrames }));
}

export function segmentOfClip(project, clip, segmentStartFrame, segmentEndFrame, timelineStartFrame, id, videoEffectIds = undefined) {
	const offsetFrames = segmentStartFrame - clip.timelineStartFrame;
	const durationFrames = segmentEndFrame - segmentStartFrame;
	const sourceDuration = clip.sourceDurationFrames ?? clip.durationFrames;
	const { sourceOffsetFrames, segmentSourceDuration } = sourceRangeForSegment(
		clip,
		segmentStartFrame,
		segmentEndFrame,
		sourceDuration,
	);
	const sourceStartFrame = clip.reversed
		? clip.sourceStartFrame + sourceDuration - sourceOffsetFrames - segmentSourceDuration
		: clip.sourceStartFrame + sourceOffsetFrames;
	// A full-extent segment keeps the clip's own map, so only a narrowed segment
	// re-derives one.
	const warpSegment = clip.kind === 'audio' && clip.warpMap != null
		&& (segmentStartFrame !== clip.timelineStartFrame || segmentEndFrame !== clipEndFrame(clip))
		? trimAudioWarpClipToTimelineRange(project, clip, segmentStartFrame, segmentEndFrame)
		: null;
	const envelope = segmentEnvelope(clip, offsetFrames, durationFrames);
	let value = detachVideoKeyframeCarrier(detachVideoCompositionCarrier({
		...clip,
		id,
		timelineStartFrame,
		sourceStartFrame: warpSegment ? warpSegment.sourceStartFrame : sourceStartFrame,
		durationFrames,
		sourceDurationFrames: warpSegment ? warpSegment.sourceDurationFrames : segmentSourceDuration,
		trimStartFrames: segmentStartFrame === clip.timelineStartFrame ? clip.trimStartFrames : 0,
		trimEndFrames: segmentEndFrame === clipEndFrame(clip) ? clip.trimEndFrames : 0,
		...(warpSegment ? { warpMap: warpSegment.warpMap } : {}),
		...(envelope ? { envelope } : {}),
		...(Number.isSafeInteger(clip.fadeInFrames) ? {
			fadeInFrames: segmentStartFrame === clip.timelineStartFrame
				? Math.min(clip.fadeInFrames, durationFrames)
				: 0,
		} : {}),
		...(Number.isSafeInteger(clip.fadeOutFrames) ? {
			fadeOutFrames: segmentEndFrame === clipEndFrame(clip)
				? Math.min(clip.fadeOutFrames, durationFrames)
				: 0,
		} : {}),
	}, clip, `Segment ${id}`), clip, `Segment ${id}`);
	if (clip.kind === 'video' && id !== clip.id && clip.videoEffects?.length) {
		value.videoEffects = cloneVideoEffectsWithCommandIds(
			clip.videoEffects,
			videoEffectIds,
			`Segment ${id}`,
		);
	}
	value = finalizeVideoKeyframeSegmentCarrier(
		project,
		value,
		clip,
		segmentStartFrame,
		segmentEndFrame,
		clip.kind === 'video' && id !== clip.id && Boolean(clip.videoEffects?.length),
		`Segment ${id}`,
	);
	return value;
}

/**
 * A warped clip owns its source range through its map, so a changed timeline
 * extent re-derives one exact child map instead of keeping the full-extent one.
 * Outer positions are relative to the clip's own anchor, so an extent that only
 * moves keeps its map; a boundary the map cannot cut exactly is refused here,
 * and interactive producers snap the requested edge before they ask.
 */
export function warpSegmentForExtent(project, clip, changes, timelineStartFrame, durationFrames) {
	if (durationFrames === clip.durationFrames) return null;
	return warpSegmentForTimelineRange(project, clip, changes, timelineStartFrame, durationFrames);
}

export function warpSegmentForTimelineRange(project, clip, changes, timelineStartFrame, durationFrames) {
	if (clip.kind !== 'audio' || clip.warpMap == null) return null;
	const segment = trimAudioWarpClipToTimelineRange(
		project,
		clip,
		timelineStartFrame,
		timelineStartFrame + durationFrames,
	);
	if (Object.hasOwn(changes, 'sourceStartFrame') && changes.sourceStartFrame !== segment.sourceStartFrame) {
		throw new RangeError('Audio warp trim source start must match the exact map boundary.');
	}
	if (Object.hasOwn(changes, 'sourceDurationFrames')
		&& changes.sourceDurationFrames !== segment.sourceDurationFrames) {
		throw new RangeError('Audio warp trim source duration must match the exact map boundaries.');
	}
	return segment;
}

export function warpSegmentFields(segment) {
	return {
		sourceStartFrame: segment.sourceStartFrame,
		sourceDurationFrames: segment.sourceDurationFrames,
		warpMap: segment.warpMap,
	};
}

function sourceRangeForSegment(clip, segmentStartFrame, segmentEndFrame, sourceDuration) {
	const timelineDuration = clip.durationFrames;
	const startOffset = segmentStartFrame - clip.timelineStartFrame;
	let sourceStartOffset = Math.round(startOffset * sourceDuration / timelineDuration);
	let segmentSourceDuration = segmentEndFrame === clipEndFrame(clip)
		? sourceDuration - sourceStartOffset
		: Math.max(1, Math.round((segmentEndFrame - segmentStartFrame) * sourceDuration / timelineDuration));
	if (clip.kind === 'video' && (
		segmentSourceDuration < 1
		|| sourceStartOffset < 0
		|| sourceStartOffset + segmentSourceDuration > sourceDuration
	)) {
		// A slow or held source span can map several positive timeline ranges
		// onto one discrete source frame. Retain that in-bounds frame in every
		// survivor instead of emitting an impossible zero-length source range.
		sourceStartOffset = Math.max(0, Math.min(sourceDuration - 1, sourceStartOffset));
		segmentSourceDuration = Math.max(1, Math.min(
			segmentSourceDuration,
			sourceDuration - sourceStartOffset,
		));
	}
	return {
		sourceOffsetFrames: sourceStartOffset,
		segmentSourceDuration,
	};
}

/** A trimmed extent is a segment of the same clip, so it keeps the same gain. */
export function envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames) {
	return segmentEnvelope(clip, timelineStartFrame - clip.timelineStartFrame, durationFrames) ?? [];
}

export function assertClipSourceBounds(project, clip) {
	const source = findSource(project, clip.sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${clip.sourceId}.`);
	const sourceFrames = source.kind === 'video' ? (source.sourceFrameCount ?? source.frameCount) : source.frameCount;
	if (clip.sourceStartFrame + (clip.sourceDurationFrames ?? clip.durationFrames) > sourceFrames) throw new RangeError('Clip exceeds its source bounds.');
}

export function assertClipSpace() {}

export function validateTrackReplacement(project, _track, deletedIds, clips) {
	const ids = new Set(project.clips.filter((clip) => !deletedIds.has(clip.id)).map((clip) => clip.id));
	for (const clip of clips) {
		if (ids.has(clip.id)) throw new RangeError(`Duplicate clip ID: ${clip.id}.`);
		ids.add(clip.id);
		assertClipSourceBounds(project, clip);
	}
}

export function normalizeRangeReplacementSource(project, value) {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new TypeError('A stable replacement source ID is required.');
	}
	if (!Number.isSafeInteger(value.frameCount) || value.frameCount <= 0) {
		throw new RangeError('Range replacement output must contain at least one frame.');
	}
	return normalizeSourceForProject(project, value);
}

export function requireStableCommandId(value, name) {
	if (typeof value !== 'string' || !value) throw new TypeError(`A stable ${name} ID is required.`);
	return value;
}

export function cloneVideoEffectsWithCommandIds(effects, ids, name) {
	const stack = Array.isArray(effects) ? effects : [];
	if (!stack.length) return [];
	if (!Array.isArray(ids) || ids.length !== stack.length) {
		throw new TypeError(`${name} requires one stable ID for every video effect.`);
	}
	let index = 0;
	return cloneVideoEffects(stack, {
		regenerateIds: true,
		idFactory: () => requireStableCommandId(ids[index++], `${name} video effect`),
	});
}

export function prepareVideoEffectIds(clip, idFactory) {
	return clip.kind === 'video' && clip.videoEffects?.length
		? clip.videoEffects.map(() => idFactory('video-effect'))
		: undefined;
}

export function reserveReplacementClipId(project, id, reservedIds) {
	assertUnusedClipId(project, id);
	if (reservedIds.has(id)) throw new RangeError(`Duplicate replacement clip ID: ${id}.`);
	reservedIds.add(id);
}

export function sortTrack(project, track) {
	track.clipIds.sort((firstId, secondId) => {
		const first = requireClip(project, firstId);
		const second = requireClip(project, secondId);
		return first.timelineStartFrame - second.timelineStartFrame
			|| compareCodeUnits(first.id, second.id);
	});
}

export function replaceClip(project, value) {
	const index = project.clips.findIndex((clip) => clip.id === value.id);
	if (index < 0) throw new ReferenceError(`Unknown clip: ${value.id}.`);
	project.clips[index] = value;
}

export function requireSource(project, sourceId) {
	const source = findSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	return source;
}

export function requireTrack(project, trackId) {
	const track = findTrack(project, trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
	return track;
}

export function requireLabelTrack(project, trackId) {
	const track = requireTrack(project, trackId);
	if (track.type !== 'label') throw new RangeError(`Track ${trackId} is not a label track.`);
	return track;
}

export function requireClip(project, clipId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip: ${clipId}.`);
	return clip;
}

export function requireProjectBin(project) {
	if (!project.projectBin || !Array.isArray(project.projectBin.clips)) {
		throw new RangeError('Project-bin commands require a project bin.');
	}
	return project.projectBin;
}

export function requireProjectBinClip(project, clipId) {
	requireProjectBin(project);
	const clip = findProjectBinClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	return clip;
}

export function requireClipTrack(project, clipId) {
	const track = findClipTrack(project, clipId);
	if (!track) throw new ReferenceError(`Clip ${clipId} is not assigned to a track.`);
	return track;
}

export function assertUnusedId(items, id, type) {
	if (items.some((item) => item.id === id)) throw new RangeError(`Duplicate ${type} ID: ${id}.`);
}

export function assertUnusedClipId(project, id) {
	if (project.clips.some((clip) => clip.id === id) || findProjectBinClip(project, id)) {
		throw new RangeError(`Duplicate clip ID: ${id}.`);
	}
}

export function insertionIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Insertion index is out of bounds.');
	return index;
}

export function normalizeCommandIds(values, name) {
	if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array.`);
	const result = values.map((value, index) => {
		if (typeof value !== 'string' || !value) throw new TypeError(`${name}[${index}] must be a stable ID.`);
		return value;
	});
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

export function normalizeSelectionIds(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	if (!values.length) return [];
	return normalizeCommandIds(values, name);
}

export function normalizeFrequencyRange(value, sampleRate) {
	if (value == null) return null;
	const minimumFrequency = Number(value.minimumFrequency);
	const maximumFrequency = Number(value.maximumFrequency);
	if (
		!Number.isFinite(minimumFrequency)
		|| !Number.isFinite(maximumFrequency)
		|| minimumFrequency < 0
		|| maximumFrequency <= minimumFrequency
		|| maximumFrequency > sampleRate / 2
	) {
		throw new RangeError('Selection frequency range is outside the project bandwidth.');
	}
	return { minimumFrequency, maximumFrequency };
}

export function normalizeSourceForProject(project, value) {
	const source = createMediaSource({ ...value, kind: value?.kind || 'audio' }, project.sampleRate);
	return source.kind === 'video' ? { ...source, frameCount: source.sampleFrameCount } : source;
}

export function normalizeTrackForProject(project, value) {
	const track = createMediaTrack({ ...value, type: value?.type || 'audio' }, project.sampleRate);
	const descriptor = Object.getOwnPropertyDescriptor(track, 'locked');
	if (descriptor === undefined) return { ...track, locked: false };
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean') {
		throw new TypeError('A track lock must be an own enumerable boolean data property.');
	}
	return track;
}

export function normalizeClipForProject(project, value) {
	if (isRuntimeProjectProjection(project) && value?.coordinateDomain === 'resolved-samples') {
		const timelineStartFrame = Number(value.timelineStartFrame);
		const durationFrames = Number(value.durationFrames);
		const sourceStartFrame = Number(value.sourceStartFrame);
		const sourceDurationFrames = Number(value.sourceDurationFrames);
		return detachVideoKeyframeCarrier(detachVideoCompositionCarrier({
			...value,
			timelineEndFrame: timelineStartFrame + durationFrames,
			sourceEndFrame: sourceStartFrame + sourceDurationFrames,
		}, value, `Clip ${String(value?.id ?? '')}`), value, `Clip ${String(value?.id ?? '')}`);
	}
	const source = requireSource(project, value.sourceId);
	const sequenceId = value.sequenceId || project.primarySequenceId;
	const sequence = project.sequences.find((candidate) => candidate.id === sequenceId);
	if (!sequence) throw new ReferenceError(`Unknown sequence: ${sequenceId}.`);
	const clip = createMediaClip({
		...value,
		kind: value?.kind || 'audio',
		binItemId: value?.binItemId ?? null,
		avLinkId: value?.avLinkId ?? null,
	}, {
		projectSampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
		sequence,
		source,
	});
	return detachVideoKeyframeCarrier(detachVideoCompositionCarrier(
		resolveRuntimeClipProjection(project, clip),
		value,
		`Clip ${String(value?.id ?? '')}`,
	), value, `Clip ${String(value?.id ?? '')}`);
}
