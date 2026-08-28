/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	clipEndFrame,
	cloneProject,
	createStableId,
	findClip,
	normalizeFrameRange,
} from '../project.js';
import {
	addClip,
	mergeEditingRanges,
} from './clip-basic-runtime.js';
import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	isFoundationProjectAuthority,
	projectForCommandConsumers,
} from '../project-current-runtime.ts';
import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
} from '../runtime-clip-projection.ts';
import {
	assertUnusedClipId,
	assertUnusedId,
	normalizeClipForProject,
	normalizeRangeReplacementSource,
	prepareVideoEffectIds,
	pruneMissingProjectSelections,
	requireClip,
	requireClipTrack,
	requireStableCommandId,
	requireTrack,
	reserveReplacementClipId,
	segmentOfClip,
	validateTrackReplacement,
} from './shared-runtime.js';
import { resolveRangeSequenceGeometry } from './range-sequence-geometry.ts';
import {
	createTimelineAnnotationRippleOperations,
	stageTimelineAnnotationRippleMutation,
} from './timeline-annotation-ripple.ts';
import { planTakeGraphRangeDelete } from './take-graph-range-edit.ts';

// foundation-edit-matrix: ripple
// foundation-edit-matrix: range-delete

export function deleteRange(project, command, rippleMode) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'delete range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const affectedClipIds = Array.isArray(command.clipIds) ? new Set(command.clipIds) : null;
	const geometry = resolveRangeSequenceGeometry(project, trackIds, range);
	if (rippleMode !== 'track' && Object.hasOwn(command, 'annotationRippleOperations')) {
		throw new RangeError('Annotation ripple operations are only valid for range/ripple-delete.');
	}
	const commitAnnotationRipple = rippleMode === 'track'
		? stageTimelineAnnotationRippleMutation(
			project,
			command,
			createTimelineAnnotationRippleOperations(
				project,
				geometry,
				Array.isArray(command.clipIds) ? command.clipIds : clipIdsForTracks(project, trackIds),
			),
		)
		: () => undefined;
	const commitTakeGraph = planTakeGraphRangeDelete(
		project,
		takeGraphTrackRanges(project, trackIds, geometry, range),
		rippleMode === 'track',
	);
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		const operationRange = geometry.trackRanges.has(trackId) ? geometry.trackRanges.get(trackId) : range;
		if (!operationRange) continue;
		processTrackRange(
			project,
			track,
			operationRange,
			rippleMode,
			command.splitClipIds || {},
			command.splitAvLinkIds || {},
			command.videoEffectIds || {},
			affectedClipIds,
		);
	}
	commitAnnotationRipple();
	commitTakeGraph?.();
}

/** The range each edited track is losing, which is what its take graph answers to. */
function takeGraphTrackRanges(project, trackIds, geometry, range) {
	const ranges = new Map();
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		const operationRange = geometry.trackRanges.has(trackId) ? geometry.trackRanges.get(trackId) : range;
		if (operationRange) ranges.set(String(trackId), operationRange);
	}
	return ranges;
}

function clipIdsForTracks(project, trackIds) {
	return trackIds.flatMap((trackId) => {
		const track = requireTrack(project, trackId);
		return Array.isArray(track.clipIds) ? track.clipIds : [];
	});
}

export function processTrackRange(
	project,
	track,
	range,
	rippleMode,
	splitClipIds,
	splitAvLinkIds = {},
	videoEffectIds = {},
	affectedClipIds = null,
) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		if (affectedClipIds && !affectedClipIds.has(clip.id)) {
			replacements.push(clip);
			continue;
		}
		const start = clip.timelineStartFrame;
		const end = clipEndFrame(clip);
		if (end <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (start >= range.endFrame) {
			replacements.push({
				...clip,
				timelineStartFrame: rippleMode === 'track' ? start - range.durationFrames : start,
			});
			continue;
		}

		const hasLeft = start < range.startFrame;
		const hasRight = end > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(project, clip, start, range.startFrame, start, clip.id));
		if (hasRight) {
			const rightId = hasLeft ? splitClipIds[clip.id] : clip.id;
			if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
			if (hasLeft) assertUnusedClipId(project, rightId);
			const timelineStartFrame = rippleMode === 'track'
				? range.startFrame
				: rippleMode === 'clip'
					? Math.max(start, range.startFrame)
					: range.endFrame;
			let right = segmentOfClip(
				project,
				clip,
				range.endFrame,
				end,
				timelineStartFrame,
				rightId,
				videoEffectIds[rightId],
			);
			if (hasLeft && clip.avLinkId) {
				const rightAvLinkId = splitAvLinkIds[clip.avLinkId];
				if (!rightAvLinkId) throw new TypeError(`A stable split A/V link ID is required for ${clip.avLinkId}.`);
				right = normalizeClipForProject(project, { ...right, avLinkId: rightAvLinkId, id: right.id });
			}
			replacements.push(right);
		}
	}

	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame)
		.map((clip) => clip.id);
}

export function keepRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'kept range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const affectedClipIds = Array.isArray(command.clipIds) ? new Set(command.clipIds) : null;
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
		const deletedIds = new Set(track.clipIds);
		const replacements = [];
		for (const clip of originals) {
			if (affectedClipIds && !affectedClipIds.has(clip.id)) {
				replacements.push(clip);
				continue;
			}
			const start = Math.max(range.startFrame, clip.timelineStartFrame);
			const end = Math.min(range.endFrame, clipEndFrame(clip));
			if (end <= start) continue;
			replacements.push(segmentOfClip(project, clip, start, end, start, clip.id));
		}
		project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
		project.clips.push(...replacements);
		track.clipIds = replacements
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
			.map((clip) => clip.id);
	}
}

export function prepareRangeDeleteCommand(project, options = {}, idFactory = createStableId) {
	const rippleMode = options.rippleMode || (options.ripple ? 'track' : 'none');
	if (!['none', 'clip', 'track'].includes(rippleMode)) throw new RangeError(`Unsupported ripple mode: ${rippleMode}.`);
	const type = rippleMode === 'clip'
		? 'range/per-clip-ripple-delete'
		: rippleMode === 'track'
			? 'range/ripple-delete'
			: 'range/lift-delete';
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'delete range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const { trackIds, clipIds } = collectLinkedRangeTargets(project, requestedTrackIds, {
		expandTracks: rippleMode === 'track',
	});
	const geometry = resolveRangeSequenceGeometry(project, trackIds, range);
	const clipIdSet = new Set(clipIds);
	const splitClipIds = {};
	const splitAvLinkIds = {};
	const videoEffectIds = {};
	for (const trackId of trackIds) {
		const operationRange = geometry.trackRanges.has(trackId) ? geometry.trackRanges.get(trackId) : range;
		if (!operationRange) continue;
		for (const clipId of requireTrack(project, trackId).clipIds) {
			if (!clipIdSet.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			if (clip.timelineStartFrame < operationRange.startFrame && clipEndFrame(clip) > operationRange.endFrame) {
				splitClipIds[clip.id] = idFactory('clip');
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) videoEffectIds[splitClipIds[clip.id]] = effectIds;
				if (clip.avLinkId && !splitAvLinkIds[clip.avLinkId]) {
					splitAvLinkIds[clip.avLinkId] = idFactory('av-link');
				}
			}
		}
	}
	const command = { type, trackIds, clipIds, ...range, splitClipIds, splitAvLinkIds, videoEffectIds };
	return type === 'range/ripple-delete' && isTimelineAnnotationProjectSchema(project)
		? {
			...command,
			annotationRippleOperations: createTimelineAnnotationRippleOperations(project, geometry, clipIds),
		}
		: command;
}

/**
 * Prepare several independent range deletions as one replay-safe command.
 * Commands are prepared and simulated from right to left so every subsequent
 * command references the clip IDs produced by the preceding split/ripple.
 */

export function prepareDisjointRangeDeleteCommand(project, options = {}, idFactory = createStableId) {
	const ranges = mergeEditingRanges(options.ranges || []);
	if (!ranges.length) throw new RangeError('At least one delete range is required.');
	let working = project;
	const commands = [];
	for (const range of [...ranges].reverse()) {
		const command = prepareRangeDeleteCommand(working, {
			...range,
			trackIds: options.trackIds,
			rippleMode: options.rippleMode,
		}, idFactory);
		commands.push(command);
		const commandProject = isRuntimeProjectProjection(working)
			? working
			: projectForCommandConsumers(working);
		working = cloneProject(commandProject);
		if (isFoundationProjectAuthority(working)) {
			brandRuntimeProjectProjection(working);
		}
		deleteRange(working, command, rangeDeleteRippleMode(command.type));
		pruneMissingProjectSelections(working);
	}
	return commands.length === 1 ? commands[0] : { type: 'batch', commands };
}

function rangeDeleteRippleMode(type) {
	if (type === 'range/ripple-delete') return 'track';
	if (type === 'range/per-clip-ripple-delete') return 'clip';
	return 'none';
}

export function prepareKeepRangeCommand(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'kept range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const { trackIds, clipIds } = collectLinkedRangeTargets(project, requestedTrackIds);
	return { type: 'range/keep', trackIds, clipIds, ...range };
}

function collectLinkedRangeTargets(project, requestedTrackIds, options = {}) {
	const tracks = requestedTrackIds.map((trackId) => {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
		return track;
	});
	if (options.expandTracks) return collectLinkedTrackRippleTargets(project, tracks.map((track) => track.id));
	const clipIds = collectAvLinkedClipIds(project, tracks.flatMap((track) => track.clipIds));
	const clipIdSet = new Set(clipIds);
	return {
		trackIds: project.tracks
			.filter((track) => Array.isArray(track.clipIds) && track.clipIds.some((clipId) => clipIdSet.has(clipId)))
			.map((track) => track.id),
		clipIds,
	};
}

export function collectLinkedTrackRippleTargets(project, requestedTrackIds) {
	const trackIdSet = new Set(requestedTrackIds);
	const clipIdSet = new Set();
	let previousTrackCount = -1;
	while (trackIdSet.size !== previousTrackCount) {
		previousTrackCount = trackIdSet.size;
		for (const track of project.tracks) {
			if (!trackIdSet.has(track.id)) continue;
			if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
			for (const clipId of track.clipIds) clipIdSet.add(clipId);
		}
		for (const clipId of collectAvLinkedClipIds(project, [...clipIdSet])) {
			clipIdSet.add(clipId);
			trackIdSet.add(requireClipTrack(project, clipId).id);
		}
	}
	return {
		trackIds: project.tracks
			.filter((track) => trackIdSet.has(track.id) && Array.isArray(track.clipIds))
			.map((track) => track.id),
		clipIds: project.clips.filter((clip) => clipIdSet.has(clip.id)).map((clip) => clip.id),
	};
}

export function collectAvLinkedClipIds(project, clipIds) {
	const ids = new Set((Array.isArray(clipIds) ? clipIds : [clipIds])
		.filter((clipId) => findClip(project, clipId)));
	const avLinkIds = new Set([...ids]
		.map((clipId) => findClip(project, clipId)?.avLinkId)
		.filter(Boolean));
	for (const clip of project.clips) {
		if (clip.avLinkId && avLinkIds.has(clip.avLinkId)) ids.add(clip.id);
	}
	return project.clips.filter((clip) => ids.has(clip.id)).map((clip) => clip.id);
}

/** @returns {AudioEditorClipboardV2} */

export function preparePunchCommand(project, options = {}, idFactory = createStableId) {
	const rangeCommand = prepareRangeDeleteCommand(project, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: [options.trackId],
	}, idFactory);
	return {
		type: 'punch/replace',
		trackId: options.trackId,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		sourceId: options.sourceId,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		...(options.sourceDurationFrames == null ? {} : { sourceDurationFrames: options.sourceDurationFrames }),
		clipId: options.clipId || idFactory('clip'),
		splitClipIds: rangeCommand.splitClipIds,
		videoEffectIds: rangeCommand.videoEffectIds,
	};
}

/**
 * Prepare an Audacity-style replacement of one track range with an immutable
 * source. The source's complete frame range becomes the replacement clip, and
 * later material on that track ripples by outputFrames - inputFrames.
 */

export function prepareRangeReplacementCommand(project, options = {}, idFactory = createStableId) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'replacement range');
	const track = requireTrack(project, options.trackId);
	const sourceId = options.source?.id || idFactory('source');
	const source = normalizeRangeReplacementSource(project, { ...(options.source || {}), id: sourceId });
	assertUnusedId(project.sources, source.id, 'source');
	const clipId = requireStableCommandId(options.clipId || idFactory('clip'), 'replacement clip');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);
	const splitClipIds = {};
	const videoEffectIds = {};
	for (const existingClipId of track.clipIds) {
		const clip = requireClip(project, existingClipId);
		if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
			const rightId = requireStableCommandId(idFactory('clip'), `right segment for ${clip.id}`);
			reserveReplacementClipId(project, rightId, generatedClipIds);
			splitClipIds[clip.id] = rightId;
			const effectIds = prepareVideoEffectIds(clip, idFactory);
			if (effectIds) videoEffectIds[rightId] = effectIds;
		}
	}
	return {
		type: 'range/replace',
		trackId: track.id,
		...range,
		source,
		clipId,
		splitClipIds,
		videoEffectIds,
	};
}

export function replaceRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'replacement range');
	const track = requireTrack(project, command.trackId);
	const source = normalizeRangeReplacementSource(project, command.source);
	const clipId = requireStableCommandId(command.clipId, 'replacement clip');
	assertUnusedId(project.sources, source.id, 'source');
	project.sources.push(source);
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);

	const originals = track.clipIds.map((id) => requireClip(project, id));
	const deletedIds = new Set(track.clipIds);
	const replacements = [];
	const timelineDelta = source.frameCount - range.durationFrames;
	for (const clip of originals) {
		const startFrame = clip.timelineStartFrame;
		const endFrame = clipEndFrame(clip);
		if (endFrame <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (startFrame >= range.endFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: startFrame + timelineDelta,
				id: clip.id,
			}));
			continue;
		}

		const hasLeft = startFrame < range.startFrame;
		const hasRight = endFrame > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(project, clip, startFrame, range.startFrame, startFrame, clip.id));
		if (hasRight) {
			const rightId = hasLeft
				? requireStableCommandId(command.splitClipIds?.[clip.id], `right segment for ${clip.id}`)
				: clip.id;
			if (hasLeft) reserveReplacementClipId(project, rightId, generatedClipIds);
			replacements.push(segmentOfClip(
				project,
				clip,
				range.endFrame,
				endFrame,
				range.startFrame + source.frameCount,
				rightId,
				command.videoEffectIds?.[rightId],
			));
		}
	}

	const replacement = normalizeClipForProject(project, {
		id: clipId,
		sourceId: source.id,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: source.frameCount,
		durationFrames: source.frameCount,
	});
	const nextTrackClips = [...replacements, replacement]
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id));
	validateTrackReplacement(project, track, deletedIds, nextTrackClips);
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...nextTrackClips);
	track.clipIds = nextTrackClips.map((clip) => clip.id);
}

export function punchReplace(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'punch range');
	const track = requireTrack(project, command.trackId);
	processTrackRange(
		project,
		track,
		range,
		false,
		command.splitClipIds || {},
		{},
		command.videoEffectIds || {},
	);
	addClip(project, track.id, {
		id: command.clipId,
		sourceId: command.sourceId,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: command.sourceStartFrame ?? 0,
		...(command.sourceDurationFrames == null ? {} : { sourceDurationFrames: command.sourceDurationFrames }),
		durationFrames: range.durationFrames,
	});
}
