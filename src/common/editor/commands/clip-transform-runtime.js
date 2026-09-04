/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	assertNonOverlappingClips,
	conformedOverwriteCut,
	overwriteClipRanges,
} from './clip-overwrite-ranges.js';
import {
	assertFrame,
	clipEndFrame,
	clipsOverlap,
	createStableId,
	findClip,
	findClipTrack,
	findTrack,
} from '../project.js';
import {
	hasCoreEditingProjectAuthority,
	hasProjectBinMediaAuthority,
} from '../project-schema-version.ts';
import {
	assertClipSourceBounds,
	assertClipSpace,
	assertUnusedClipId,
	envelopeForTrimmedBounds,
	normalizeClipForProject,
	normalizeCommandIds,
	prepareVideoEffectIds,
	replaceClip,
	requireClip,
	requireClipTrack,
	requireStableCommandId,
	requireTrack,
	reserveReplacementClipId,
	segmentOfClip,
	sortTrack,
	warpSegmentFields,
	warpSegmentForExtent,
	warpSegmentForTimelineRange,
	withoutImportedPitchPreset,
} from './shared-runtime.js';
import { applyCanonicalVideoKeyframeTransform, finalizeVideoKeyframeSegmentCarrier, markVideoKeyframeCarrierEdited, transformVideoKeyframeCarrierForOverwrite } from './video-keyframe-segment-carrier.ts';

// foundation-edit-matrix: move
// foundation-edit-matrix: roll
// foundation-edit-matrix: slip
// foundation-edit-matrix: slide
// foundation-edit-matrix: rate-stretch

/**
 * Prepares an atomic transform for selected/grouped clips. When overwrite is
 * enabled, stable IDs are reserved for any inactive clip that is split into
 * multiple surviving segments, including fresh A/V links for matching
 * survivor pairs.
 */

export function prepareTransformClipsCommand(project, transforms, options = {}, idFactory = createStableId) {
	const state = buildClipTransformState(project, transforms);
	const overwrite = Boolean(options.overwrite);
	validateClipTransformState(project, state, overwrite);
	const splitClipIds = {};
	const splitAvLinkIds = {};
	const videoEffectIds = {};
	if (overwrite) {
		const rangesByClipId = overwriteClipRanges(project, state);
		const splitCountsByAvLinkId = new Map();
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			const splitCount = Math.max(0, (ranges?.length || 0) - 1);
			if (!splitCount) continue;
			splitClipIds[clip.id] = Array.from({ length: splitCount }, () => idFactory('clip'));
			for (const splitId of splitClipIds[clip.id]) {
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) videoEffectIds[splitId] = effectIds;
			}
			if (clip.avLinkId) {
				const previousCount = splitCountsByAvLinkId.get(clip.avLinkId);
				if (previousCount != null && previousCount !== splitCount) {
					throw new RangeError(`Linked A/V clips require matching overwrite segments: ${clip.avLinkId}.`);
				}
				splitCountsByAvLinkId.set(clip.avLinkId, splitCount);
			}
		}
		for (const [avLinkId, splitCount] of splitCountsByAvLinkId) {
			splitAvLinkIds[avLinkId] = Array.from({ length: splitCount }, () => idFactory('av-link'));
		}
	}
	return {
		type: 'clip/transform-many',
		transforms: state.map((item) => ({
			clipId: item.clip.id,
			trackId: item.track.id,
			changes: { ...item.changes },
			...(item.sequencePlacement ? {
				sequencePlacement: { ...item.sequencePlacement },
			} : {}),
			...(item.sequenceTrimRange ? { sequenceTrimRange: { ...item.sequenceTrimRange } } : {}),
		})),
		overwrite,
		splitClipIds,
		splitAvLinkIds,
		videoEffectIds,
	};
}

export function transformClips(project, command) {
	const state = buildClipTransformState(project, command.transforms);
	const overwrite = Boolean(command.overwrite);
	validateClipTransformState(project, state, overwrite);
	const movingIds = new Set(state.map((item) => item.clip.id));
	const replacementsById = new Map();
	const reservedIds = new Set();

	if (overwrite) {
		const rangesByClipId = overwriteClipRanges(project, state);
		const splitCountsByAvLinkId = new Map();
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			if (!ranges) continue;
			const splitIds = command.splitClipIds?.[clip.id] || [];
			const splitCount = Math.max(0, ranges.length - 1);
			if (!Array.isArray(splitIds) || splitIds.length !== splitCount) {
				throw new TypeError(`Stable split clip IDs are required for ${clip.id}.`);
			}
			for (const splitId of splitIds) {
				const stableId = requireStableCommandId(splitId, 'split clip');
				reserveReplacementClipId(project, stableId, reservedIds);
			}
			if (clip.avLinkId && splitCount) {
				const previousCount = splitCountsByAvLinkId.get(clip.avLinkId);
				if (previousCount != null && previousCount !== splitCount) {
					throw new RangeError(`Linked A/V clips require matching overwrite segments: ${clip.avLinkId}.`);
				}
				splitCountsByAvLinkId.set(clip.avLinkId, splitCount);
			}
		}
		const existingAvLinkIds = new Set(project.clips.map((clip) => clip.avLinkId).filter(Boolean));
		const reservedAvLinkIds = new Set();
		for (const [avLinkId, splitCount] of splitCountsByAvLinkId) {
			const splitIds = command.splitAvLinkIds?.[avLinkId] || [];
			if (!Array.isArray(splitIds) || splitIds.length !== splitCount) {
				throw new TypeError(`Stable split A/V link IDs are required for ${avLinkId}.`);
			}
			for (const splitId of splitIds) {
				const stableId = requireStableCommandId(splitId, 'split A/V link');
				if (existingAvLinkIds.has(stableId) || reservedAvLinkIds.has(stableId)) {
					throw new RangeError(`Duplicate A/V link ID: ${stableId}.`);
				}
				reservedAvLinkIds.add(stableId);
			}
		}
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			if (!ranges) continue;
			const ids = [clip.id, ...(command.splitClipIds?.[clip.id] || [])];
			replacementsById.set(clip.id, ranges.map(([startFrame, endFrame], index) => {
				let segment = segmentOfClip(
					project,
					clip,
					startFrame,
					endFrame,
					startFrame,
					ids[index],
					command.videoEffectIds?.[ids[index]],
				);
				if (clip.avLinkId && index > 0) {
					segment = normalizeClipForProject(project, {
						...segment,
						avLinkId: command.splitAvLinkIds[clip.avLinkId][index - 1],
						id: segment.id,
					});
				}
				return segment;
			}));
		}
	}

	const updatedById = new Map(state.map((item) => [item.clip.id, item.updated]));
	project.clips = project.clips.flatMap((clip) => {
		if (updatedById.has(clip.id)) return [updatedById.get(clip.id)];
		if (replacementsById.has(clip.id)) return replacementsById.get(clip.id);
		return [clip];
	});

	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const clips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.flatMap((clipId) => replacementsById.has(clipId)
				? replacementsById.get(clipId)
				: [requireClip(project, clipId)])
			.concat(state.filter((item) => item.track.id === track.id).map((item) => item.updated))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || compareCodeUnits(left.id, right.id));
		track.clipIds = clips.map((clip) => clip.id);
	}
}

function buildClipTransformState(project, transforms) {
	if (!Array.isArray(transforms) || !transforms.length) throw new TypeError('Clip transforms must be a non-empty array.');
	const ids = normalizeCommandIds(transforms.map((transform) => transform?.clipId), 'transforms.clipIds');
	const allowed = new Set([
		'timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames',
		'trimStartFrames', 'trimEndFrames', 'fadeInFrames', 'fadeOutFrames',
		'envelope', 'pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo',
		'renderCacheRevision',
	]);
	return transforms.map((transform, index) => {
		const clip = requireClip(project, ids[index]);
		const oldTrack = requireClipTrack(project, clip.id);
		const track = requireTrack(project, transform.trackId || oldTrack.id);
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Media clips cannot be transformed onto track ${track.id}.`);
		if (hasProjectBinMediaAuthority(project) && track.type !== clip.kind) {
			throw new RangeError(`A ${clip.kind} clip cannot be transformed onto a ${track.type} track.`);
		}
		const changes = transform.changes || {};
		if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Clip transform changes must be an object.');
		for (const key of Object.keys(changes)) {
			if (!allowed.has(key)) throw new RangeError(`Clip field cannot be transformed: ${key}.`);
		}
		const durationFrames = changes.durationFrames ?? clip.durationFrames;
		const timelineStartFrame = Object.hasOwn(changes, 'timelineStartFrame')
			? assertFrame(changes.timelineStartFrame, 'clip transform destination')
			: clip.timelineStartFrame;
		const warpSegment = warpSegmentForExtent(project, clip, changes, timelineStartFrame, durationFrames);
		let updated = normalizeClipForProject(project, {
			...clip,
			...changes,
			...(warpSegment ? warpSegmentFields(warpSegment) : {}),
			...(Object.hasOwn(changes, 'preserveFormants') ? {
				opaqueExtensions: withoutImportedPitchPreset(clip.opaqueExtensions),
			} : {}),
			...(!Object.hasOwn(changes, 'envelope') && durationFrames !== clip.durationFrames ? {
				envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
			} : {}),
			id: clip.id,
		});
		const sequencePlacement = applyCanonicalVideoKeyframeTransform(
			project, clip, track, updated, transform.sequencePlacement,
			transform.sequenceTrimRange, changes, `Transformed clip ${clip.id}`,
		);
		if (sequencePlacement) {
			updated = sequencePlacement.updated;
			markVideoKeyframeCarrierEdited(project, updated);
		}
		assertClipSourceBounds(project, updated);
		return {
			clip, oldTrack, track, updated, changes: { ...changes },
			sequencePlacement: sequencePlacement?.sequencePlacement ?? null,
			sequenceTrimRange: sequencePlacement?.sequenceTrimRange ?? null,
		};
	});
}

function validateClipTransformState(project, state, overwrite) {
	if (hasCoreEditingProjectAuthority(project)) return;
	const movingIds = new Set(state.map((item) => item.clip.id));
	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const activeClips = state.filter((item) => item.track.id === track.id).map((item) => item.updated);
		assertNonOverlappingClips(track.id, activeClips);
		if (overwrite) continue;
		const inactiveClips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.map((clipId) => requireClip(project, clipId));
		assertNonOverlappingClips(track.id, [...inactiveClips, ...activeClips]);
	}
}

export function overwriteClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const requestedChanges = command.changes || {};
	const timelineStartFrame = Object.hasOwn(requestedChanges, 'timelineStartFrame')
		? assertFrame(requestedChanges.timelineStartFrame, 'clip overwrite destination')
		: clip.timelineStartFrame;
	const durationFrames = requestedChanges.durationFrames ?? clip.durationFrames;
	const warpSegment = warpSegmentForExtent(
		project,
		clip,
		requestedChanges,
		timelineStartFrame,
		durationFrames,
	);
	let updated = normalizeClipForProject(project, {
		...clip,
		...requestedChanges,
		...(warpSegment ? warpSegmentFields(warpSegment) : {}),
		...(!Object.hasOwn(requestedChanges, 'envelope') && durationFrames !== clip.durationFrames ? {
			envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		} : {}),
		id: clip.id,
	});
	updated = transformVideoKeyframeCarrierForOverwrite(project, updated, clip, requestedChanges, `Overwritten clip ${clip.id}`);
	markVideoKeyframeCarrierEdited(project, updated);
	assertClipSourceBounds(project, updated);
	const overwriteCut = conformedOverwriteCut(project, { clip, updated, track: targetTrack });

	const replacements = [];
	const removedIds = new Set(targetTrack.clipIds);
	for (const clipId of targetTrack.clipIds) {
		if (clipId === clip.id) continue;
		const inactiveClip = requireClip(project, clipId);
		if (!clipsOverlap(inactiveClip, overwriteCut)) {
			replacements.push(inactiveClip);
			continue;
		}
		removedIds.add(inactiveClip.id);
		const inactiveStart = inactiveClip.timelineStartFrame;
		const inactiveEnd = clipEndFrame(inactiveClip);
		const activeStart = overwriteCut.timelineStartFrame;
		const activeEnd = clipEndFrame(overwriteCut);
		const hasLeadingSegment = inactiveStart < activeStart;
		const hasTrailingSegment = inactiveEnd > activeEnd;
		if (hasLeadingSegment) {
			replacements.push(segmentOfClip(project, inactiveClip, inactiveStart, activeStart, inactiveStart, inactiveClip.id));
		}
		if (hasTrailingSegment) {
			const id = hasLeadingSegment ? command.splitClipIds?.[inactiveClip.id] : inactiveClip.id;
			if (!id) throw new TypeError(`A stable split clip ID is required for ${inactiveClip.id}.`);
			if (hasLeadingSegment) assertUnusedClipId(project, id);
			replacements.push(segmentOfClip(
				project,
				inactiveClip,
				activeEnd,
				inactiveEnd,
				activeEnd,
				id,
				command.videoEffectIds?.[id],
			));
		}
	}

	project.clips = project.clips.filter((item) => item.id !== updated.id && !removedIds.has(item.id));
	project.clips.push(updated, ...replacements);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((clipId) => clipId !== clip.id);
	}
	targetTrack.clipIds = [...replacements.map((item) => item.id), updated.id];
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

export function prepareOverwriteClipCommand(project, clipId, options = {}, idFactory = createStableId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip ${clipId}.`);
	const targetTrack = findTrack(project, options.trackId) || findClipTrack(project, clipId);
	if (!targetTrack) throw new ReferenceError(`Unknown target track for clip ${clipId}.`);
	const changes = options.changes || {};
	if (Object.hasOwn(changes, 'timelineStartFrame')) {
		assertFrame(changes.timelineStartFrame, 'clip overwrite destination');
	}
	const candidate = normalizeClipForProject(project, { ...clip, ...changes, id: clip.id });
	const overwriteCut = conformedOverwriteCut(project, { clip, updated: candidate, track: targetTrack });
	const splitClipIds = {};
	const videoEffectIds = {};
	for (const targetClipId of targetTrack.clipIds) {
		if (targetClipId === clip.id) continue;
		const inactiveClip = requireClip(project, targetClipId);
		if (
			clipsOverlap(inactiveClip, overwriteCut)
			&& inactiveClip.timelineStartFrame < overwriteCut.timelineStartFrame
			&& clipEndFrame(inactiveClip) > clipEndFrame(overwriteCut)
		) {
			splitClipIds[inactiveClip.id] = idFactory('clip');
			const effectIds = prepareVideoEffectIds(inactiveClip, idFactory);
			if (effectIds) videoEffectIds[splitClipIds[inactiveClip.id]] = effectIds;
		}
	}
	return {
		type: 'clip/overwrite',
		clipId,
		trackId: targetTrack.id,
		changes: { ...(options.changes || {}) },
		splitClipIds,
		videoEffectIds,
	};
}

export function trimClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const timelineStartFrame = command.timelineStartFrame == null
		? clip.timelineStartFrame
		: assertFrame(command.timelineStartFrame, 'clip trim destination');
	const durationFrames = command.durationFrames ?? clip.durationFrames;
	const warpSegment = warpSegmentForTimelineRange(
		project,
		clip,
		command,
		timelineStartFrame,
		durationFrames,
	);
	const sourceStartFrame = warpSegment?.sourceStartFrame
		?? command.sourceStartFrame
		?? clip.sourceStartFrame;
	const sourceDurationFrames = warpSegment?.sourceDurationFrames
		?? command.sourceDurationFrames
		?? Math.max(
			1,
			Math.round((clip.sourceDurationFrames ?? clip.durationFrames) * durationFrames / clip.durationFrames),
		);
	let updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame,
		sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		...(warpSegment ? { warpMap: warpSegment.warpMap } : {}),
		trimStartFrames: command.trimStartFrames ?? clip.trimStartFrames,
		trimEndFrames: command.trimEndFrames ?? clip.trimEndFrames,
		envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		...optionalTrimmedFade('fadeInFrames', command, clip, durationFrames),
		...optionalTrimmedFade('fadeOutFrames', command, clip, durationFrames),
		id: clip.id,
	});
	updated = finalizeVideoKeyframeSegmentCarrier(
		project,
		updated,
		clip,
		timelineStartFrame,
		clipEndFrame(updated),
		false,
		`Trimmed clip ${clip.id}`,
	);
	markVideoKeyframeCarrierEdited(project, updated);
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
	sortTrack(project, track);
}

function optionalTrimmedFade(field, command, clip, durationFrames) {
	const value = command[field] ?? clip[field];
	return Number.isSafeInteger(value) ? { [field]: Math.min(value, durationFrames) } : {};
}
