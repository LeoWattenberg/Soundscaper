/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFrame,
	clipEndFrame,
	clipsOverlap,
	createStableId,
	normalizeFrameRange,
} from '../project.js';
import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	cloneVideoEffects,
} from '../video-effects.js';
import {
	collectRelatedClipIds,
} from './clip-basic-runtime.js';
import {
	assertPasteSequenceMaps,
	createAnnotationPasteGeometry,
	preparePasteAnnotationMaps,
} from './clipboard-annotation-command.ts';
import {
	normalizeAudioEditorClipboardDescriptor,
} from './clipboard-codec.ts';
import {
	clipboardContainsVideo,
	conformClipboardVideoPlacement,
	conformedPasteAnchors,
	pasteSpanForSequence,
	pasteSpanForTrack,
	pasteTrackGroups,
	sequenceForTrack,
} from './clipboard-time-runtime.js';
import {
	createTimelineAnnotationClipboardDescriptors,
	stageTimelineAnnotationClipboardPaste,
} from './timeline-annotation-clipboard.ts';
import {
	collectAvLinkedClipIds,
	collectLinkedTrackRippleTargets,
	deleteRange,
	prepareRangeDeleteCommand,
	processTrackRange,
} from './range-runtime.js';
import {
	assertClipSourceBounds,
	assertClipSpace,
	assertUnusedClipId,
	cloneVideoEffectsWithCommandIds,
	normalizeClipForProject,
	prepareVideoEffectIds,
	requireClip,
	requireClipTrack,
	requireTrack,
	segmentOfClip,
	sortTrack,
} from './shared-runtime.js';

// foundation-edit-matrix: paste
// foundation-edit-matrix: duplicate

export function createClipboardDescriptor(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'clipboard range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const requestedTracks = requestedTrackIds.map((trackId) => requireTrack(project, trackId));
	const baseClipIds = options.clipIds
		? collectRelatedClipIds(project, options.clipIds)
		: requestedTracks.flatMap((track) => track.clipIds.filter((clipId) => {
			const clip = requireClip(project, clipId);
			return clip.timelineStartFrame < range.endFrame && clipEndFrame(clip) > range.startFrame;
		}));
	const includedClipIds = new Set(collectAvLinkedClipIds(project, baseClipIds));
	const trackIdSet = new Set(requestedTrackIds);
	for (const clipId of includedClipIds) trackIdSet.add(requireClipTrack(project, clipId).id);
	const trackIds = project.tracks
		.filter((track) => trackIdSet.has(track.id) && Array.isArray(track.clipIds))
		.map((track) => track.id);
	const pairedLaneGroupIds = new Set();
	const laneGroups = new Map();
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!track.laneGroupId) continue;
		const tracks = laneGroups.get(track.laneGroupId) || [];
		tracks.push(track);
		laneGroups.set(track.laneGroupId, tracks);
	}
	for (const [laneGroupId, tracks] of laneGroups) {
		if (
			tracks.length === 2
			&& tracks[0].type === 'video'
			&& tracks[1].type === 'audio'
		) pairedLaneGroupIds.add(laneGroupId);
	}
	const currentClipboard = isTimelineAnnotationProjectSchema(project.schemaVersion);
	const sourceSequenceIds = currentClipboard
		? [...new Set(trackIds.map((trackId) => sequenceForTrack(project, trackId).id))]
		: [];
	const descriptor = {
		schemaVersion: currentClipboard ? 3 : 2,
		sampleRate: project.sampleRate,
		durationFrames: range.durationFrames,
		tracks: trackIds.map((trackId) => {
			const track = requireTrack(project, trackId);
			const clips = track.clipIds.flatMap((clipId) => {
				if (!includedClipIds.has(clipId)) return [];
				const clip = requireClip(project, clipId);
				const startFrame = Math.max(range.startFrame, clip.timelineStartFrame);
				const endFrame = Math.min(range.endFrame, clipEndFrame(clip));
				if (endFrame <= startFrame) return [];
				const segment = segmentOfClip(clip, startFrame, endFrame, startFrame - range.startFrame, clip.id);
				return [{
					key: `${clip.id}:${startFrame}:${endFrame}`,
					kind: segment.kind || 'audio',
					sourceId: segment.sourceId,
					offsetFrame: segment.timelineStartFrame,
					sourceStartFrame: segment.sourceStartFrame,
					durationFrames: segment.durationFrames,
					title: segment.title,
					sourceDurationFrames: segment.sourceDurationFrames,
					trimStartFrames: segment.trimStartFrames,
					trimEndFrames: segment.trimEndFrames,
					groupId: segment.groupId,
					avLinkId: segment.avLinkId || null,
					color: segment.color,
					speedRatio: segment.speedRatio,
					...(segment.coordinateDomain === 'resolved-samples' ? {
						coordinateDomain: segment.coordinateDomain,
					} : {}),
					...(segment.anchor === 'sample' || segment.anchor === 'musical' ? {
						anchor: segment.anchor,
						musicalStartBeat: cloneRational(segment.musicalStartBeat),
						musicalExtent: segment.musicalExtent,
						musicalDurationBeats: cloneRational(segment.musicalDurationBeats),
						warpMap: cloneBreakpointMap(segment.warpMap),
					} : {}),
					...(segment.kind === 'video' ? {
						sequenceId: segment.sequenceId,
						sequenceFrameCount: segment.sequenceFrameCount,
						sourceInFrame: segment.sourceStartFrame,
						sourceFrameCount: segment.sourceDurationFrames,
						retimeMap: cloneBreakpointMap(segment.retimeMap),
					} : {}),
					...(Number.isFinite(segment.gain) ? { gain: segment.gain } : {}),
					...(Number.isSafeInteger(segment.fadeInFrames) ? { fadeInFrames: segment.fadeInFrames } : {}),
					...(Number.isSafeInteger(segment.fadeOutFrames) ? { fadeOutFrames: segment.fadeOutFrames } : {}),
					...(typeof segment.reversed === 'boolean' ? { reversed: segment.reversed } : {}),
					...(Array.isArray(segment.envelope) ? { envelope: segment.envelope } : {}),
					...(Number.isFinite(segment.pitchCents) ? { pitchCents: segment.pitchCents } : {}),
					...(typeof segment.preserveFormants === 'boolean' ? { preserveFormants: segment.preserveFormants } : {}),
					...(typeof segment.stretchToTempo === 'boolean' ? { stretchToTempo: segment.stretchToTempo } : {}),
					...(Number.isSafeInteger(segment.renderCacheRevision) ? {
						renderCacheRevision: segment.renderCacheRevision,
					} : {}),
					...(segment.kind === 'video' && Array.isArray(segment.videoEffects) ? {
						videoEffects: cloneVideoEffects(segment.videoEffects),
					} : {}),
				}];
			});
			return {
				sourceTrackId: track.id,
				sourceTrackName: track.name,
				sourceTrackType: track.type || 'audio',
				...(currentClipboard ? { sourceSequenceId: sequenceForTrack(project, track.id).id } : {}),
				sourceLaneGroupId: track.laneGroupId && pairedLaneGroupIds.has(track.laneGroupId)
					? track.laneGroupId
					: null,
				clips,
			};
		}),
		...(currentClipboard ? {
			annotations: createTimelineAnnotationClipboardDescriptors(project, {
				startFrame: range.startFrame,
				endFrame: range.endFrame,
				sourceSequenceIds,
				annotationIds: options.annotationIds,
			}),
		} : {}),
	};
	return normalizeAudioEditorClipboardDescriptor(descriptor);
}

export function preparePasteCommand(clipboard, options = {}, idFactory = createStableId) {
	const normalizedClipboard = normalizeAudioEditorClipboardDescriptor(clipboard);
	const mode = options.mode || 'reject';
	if (!['reject', 'overlap', 'insert-track', 'insert-all'].includes(mode)) throw new RangeError(`Unsupported paste mode: ${mode}.`);
	const clipIds = {};
	const groupIds = {};
	const avLinkIds = {};
	const videoEffectIds = {};
	for (const track of normalizedClipboard.tracks || []) {
		for (const clip of track.clips || []) {
			clipIds[clip.key] = idFactory('clip');
			if (clip.groupId && !groupIds[clip.groupId]) groupIds[clip.groupId] = idFactory('clip-group');
			if (clip.avLinkId && !avLinkIds[clip.avLinkId]) avLinkIds[clip.avLinkId] = idFactory('av-link');
			if (clip.kind === 'video' && clip.videoEffects?.length) {
				videoEffectIds[clip.key] = clip.videoEffects.map(() => idFactory('video-effect'));
			}
		}
	}
	const command = {
		type: 'clipboard/paste',
		clipboard: normalizedClipboard,
		atFrame: assertFrame(options.atFrame ?? 0, 'paste.atFrame'),
		trackMap: { ...(options.trackMap || {}) },
		clipIds,
		groupIds,
		avLinkIds,
		videoEffectIds,
		mode,
		splitClipIds: {},
		splitAvLinkIds: {},
	};
	preparePasteAnnotationMaps(normalizedClipboard, options, command, idFactory);
	if (options.project) preparePasteCollisionIds(options.project, command, idFactory);
	return command;
}

export function prepareCut(project, options = {}, idFactory = createStableId) {
	return {
		clipboard: createClipboardDescriptor(project, options),
		command: prepareRangeDeleteCommand(project, { ...options, ripple: Boolean(options.ripple) }, idFactory),
	};
}

export function pasteClipboard(project, command) {
	const clipboard = normalizeAudioEditorClipboardDescriptor(command.clipboard);
	const atFrame = assertFrame(command.atFrame, 'paste.atFrame');
	const scale = project.sampleRate / clipboard.sampleRate;
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('The clipboard sample rate is invalid.');
	const pastedDurationFrames = Math.max(1, Math.round(clipboard.durationFrames * scale));
	const conformsToVideoGrid = project.schemaVersion >= 10 && clipboardContainsVideo(clipboard);
	const conformedAnchorBySequenceId = conformedPasteAnchors(
		project,
		clipboard,
		command,
		atFrame,
		pastedDurationFrames,
	);
	const mode = command.mode || 'reject';
	if (!['reject', 'overlap', 'insert-track', 'insert-all'].includes(mode)) {
		throw new RangeError(`Unsupported paste mode: ${mode}.`);
	}
	const targetTracks = new Set();
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		const sourceTrackType = clipboardTrack.sourceTrackType || clipboardTrack.clips?.[0]?.kind || 'audio';
		if (project.schemaVersion >= 4 && targetTrack.type !== sourceTrackType) {
			throw new RangeError(`A ${sourceTrackType} clipboard track cannot be pasted into a ${targetTrack.type} track.`);
		}
		targetTracks.add(targetTrack);
	}
	assertPasteSequenceMaps(project, clipboard, command);
	const commitAnnotationPaste = stageTimelineAnnotationClipboardPaste(
		project,
		clipboard,
		command,
		mode,
		createAnnotationPasteGeometry(
			project,
			atFrame,
			pastedDurationFrames,
			conformsToVideoGrid,
			conformedAnchorBySequenceId,
		),
	);
	if (mode === 'overlap' && project.schemaVersion < 2) {
		const range = normalizeFrameRange(atFrame, atFrame + pastedDurationFrames, 'paste overlap range');
		for (const track of targetTracks) processTrackRange(
			project,
			track,
			range,
			'none',
			command.splitClipIds || {},
			{},
			command.videoEffectIds || {},
		);
	} else if (mode === 'overlap' && command.collisionClipIds?.length) {
		const collisionTrackIds = command.collisionTrackIds || [];
		const groups = pasteTrackGroups(project, collisionTrackIds, conformsToVideoGrid);
		const clipTrackId = new Map(command.collisionClipIds.map((clipId) => (
			[clipId, requireClipTrack(project, clipId).id]
		)));
		for (const group of groups) {
			const span = pasteSpanForSequence(
				project,
				group.sequence,
				atFrame,
				pastedDurationFrames,
			);
			const trackIdSet = new Set(group.trackIds);
			deleteRange(project, {
				...span,
				trackIds: group.trackIds,
				clipIds: command.collisionClipIds.filter((clipId) => trackIdSet.has(clipTrackId.get(clipId))),
				splitClipIds: command.splitClipIds || {},
				splitAvLinkIds: command.splitAvLinkIds || {},
				videoEffectIds: command.videoEffectIds || {},
			}, 'none');
		}
	} else if (mode === 'insert-track' || mode === 'insert-all') {
		const tracks = command.collisionTrackIds?.length
			? command.collisionTrackIds.map((trackId) => requireTrack(project, trackId))
			: mode === 'insert-all'
				? project.tracks.filter((track) => Array.isArray(track.clipIds))
				: [...targetTracks];
		const affectedClipIds = command.collisionClipIds?.length ? new Set(command.collisionClipIds) : null;
		for (const track of tracks) {
			const span = pasteSpanForTrack(
				project,
				track.id,
				atFrame,
				pastedDurationFrames,
				conformsToVideoGrid,
			);
			insertSpaceOnTrack(
				project,
				track,
				span.startFrame,
				span.durationFrames,
				command.splitClipIds || {},
				command.splitAvLinkIds || {},
				command.videoEffectIds || {},
				affectedClipIds,
			);
		}
	}
	const additions = [];
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		const targetSequence = project.schemaVersion >= 10 ? sequenceForTrack(project, targetTrack.id) : null;
		const conformedAnchor = targetSequence ? conformedAnchorBySequenceId.get(targetSequence.id) : null;
		for (const descriptor of clipboardTrack.clips || []) {
			const id = command.clipIds?.[descriptor.key];
			if (!id) throw new TypeError(`A stable pasted clip ID is required for ${descriptor.key}.`);
			assertUnusedClipId(project, id);
			const clip = normalizeClipForProject(project, scaleClipboardClip(
				descriptor,
				scale,
				atFrame,
				id,
				command.groupIds || {},
					command.avLinkIds || {},
					command.videoEffectIds?.[descriptor.key],
					targetSequence,
					conformedAnchor,
				));
			assertClipSourceBounds(project, clip);
			if (mode === 'reject') {
				const existing = targetTrack.clipIds.map((clipId) => requireClip(project, clipId));
				const pending = additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip);
				if ([...existing, ...pending].some((candidate) => clipsOverlap(candidate, clip))) {
					throw new RangeError(`Clip overlaps existing material on track ${targetTrack.id}.`);
				}
			}
			assertClipSpace(project, targetTrack, clip, null, additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip));
			additions.push({ track: targetTrack, clip });
		}
	}
	for (const { track, clip } of additions) {
		project.clips.push(clip);
		track.clipIds.push(clip.id);
	}
	for (const track of new Set(additions.map((addition) => addition.track))) sortTrack(project, track);
	commitAnnotationPaste();
}

function preparePasteCollisionIds(project, command, idFactory) {
	const scale = project.sampleRate / command.clipboard.sampleRate;
	const durationFrames = Math.max(1, Math.round(command.clipboard.durationFrames * scale));
	const conformsToVideoGrid = project.schemaVersion >= 10 && clipboardContainsVideo(command.clipboard);
	const targetIds = new Set((command.clipboard.tracks || []).map((track) => command.trackMap?.[track.sourceTrackId] || track.sourceTrackId));
	const targetTracks = command.mode === 'insert-all'
		? project.tracks.filter((track) => Array.isArray(track.clipIds))
		: project.tracks.filter((track) => targetIds.has(track.id) && Array.isArray(track.clipIds));
	let baseClipIds;
	if (command.mode === 'overlap' && project.schemaVersion >= 2) {
		const pastedVideoTrackIds = new Set((command.clipboard.tracks || [])
			.filter((track) => (track.sourceTrackType || track.clips?.[0]?.kind || 'audio') === 'video')
			.map((track) => command.trackMap?.[track.sourceTrackId] || track.sourceTrackId));
		baseClipIds = project.tracks
			.filter((track) => pastedVideoTrackIds.has(track.id))
			.flatMap((track) => track.clipIds.filter((clipId) => {
				const clip = requireClip(project, clipId);
				const span = pasteSpanForTrack(
					project,
					track.id,
					command.atFrame,
					durationFrames,
					conformsToVideoGrid,
				);
				return (
					clip.timelineStartFrame < span.endFrame
					&& clipEndFrame(clip) > span.startFrame
				);
			}));
	} else {
		baseClipIds = targetTracks.flatMap((track) => track.clipIds);
	}
	const collisionClipIds = command.mode === 'insert-track' || command.mode === 'insert-all'
		? collectLinkedTrackRippleTargets(project, targetTracks.map((track) => track.id)).clipIds
		: collectAvLinkedClipIds(project, baseClipIds);
	const collisionClipIdSet = new Set(collisionClipIds);
	const tracks = project.tracks.filter((track) => (
		Array.isArray(track.clipIds)
		&& track.clipIds.some((clipId) => collisionClipIdSet.has(clipId))
	));
	command.collisionClipIds = collisionClipIds;
	command.collisionTrackIds = tracks.map((track) => track.id);
	for (const track of tracks) {
		for (const clipId of track.clipIds) {
			if (!collisionClipIdSet.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			const span = pasteSpanForTrack(
				project,
				track.id,
				command.atFrame,
				durationFrames,
				conformsToVideoGrid,
			);
			const spansBoundary = command.mode === 'overlap'
				? clip.timelineStartFrame < span.startFrame && clipEndFrame(clip) > span.endFrame
				: (command.mode === 'insert-track' || command.mode === 'insert-all')
					&& clip.timelineStartFrame < span.startFrame && clipEndFrame(clip) > span.startFrame;
			if (spansBoundary) {
				command.splitClipIds[clip.id] = idFactory('clip');
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) command.videoEffectIds[command.splitClipIds[clip.id]] = effectIds;
				if (clip.avLinkId && !command.splitAvLinkIds[clip.avLinkId]) {
					command.splitAvLinkIds[clip.avLinkId] = idFactory('av-link');
				}
			}
		}
	}
}

function insertSpaceOnTrack(
	project,
	track,
	atFrame,
	durationFrames,
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
		if (clip.timelineStartFrame >= atFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: clip.timelineStartFrame + durationFrames,
				id: clip.id,
			}));
			continue;
		}
		if (clipEndFrame(clip) <= atFrame) {
			replacements.push(clip);
			continue;
		}
		const rightId = splitClipIds[clip.id];
		if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
		assertUnusedClipId(project, rightId);
		replacements.push(segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id));
		let right = segmentOfClip(
			clip,
			atFrame,
			clipEndFrame(clip),
			atFrame + durationFrames,
			rightId,
			videoEffectIds[rightId],
		);
		if (clip.avLinkId) {
			const rightAvLinkId = splitAvLinkIds[clip.avLinkId];
			if (!rightAvLinkId) throw new TypeError(`A stable split A/V link ID is required for ${clip.avLinkId}.`);
			right = normalizeClipForProject(project, { ...right, avLinkId: rightAvLinkId, id: right.id });
		}
		replacements.push(right);
	}
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
		.map((clip) => clip.id);
}

function scaleClipboardClip(
	descriptor,
	scale,
	atFrame,
	id,
	groupIds,
	avLinkIds,
	videoEffectIds = undefined,
	targetSequence = null,
	conformedAnchor = null,
) {
	const durationFrames = Math.max(1, Math.round(descriptor.durationFrames * scale));
	const videoPlacement = descriptor.kind === 'video' && targetSequence && conformedAnchor
		? conformClipboardVideoPlacement(descriptor, scale, targetSequence, conformedAnchor)
		: null;
	const timelineStartFrame = videoPlacement?.timelineStartFrame
		?? atFrame + Math.round(descriptor.offsetFrame * scale) + (conformedAnchor?.sampleDelta ?? 0);
	const timelineDurationFrames = videoPlacement?.durationFrames ?? durationFrames;
	return {
		...descriptor,
		kind: descriptor.kind || 'audio',
		id,
		binItemId: null,
		groupId: descriptor.groupId ? groupIds[descriptor.groupId] || null : null,
		avLinkId: descriptor.avLinkId ? avLinkIds[descriptor.avLinkId] || null : null,
		timelineStartFrame,
		durationFrames: timelineDurationFrames,
		...(videoPlacement || {}),
		fadeInFrames: Math.min(timelineDurationFrames, Math.round((descriptor.fadeInFrames || 0) * scale)),
		fadeOutFrames: Math.min(timelineDurationFrames, Math.round((descriptor.fadeOutFrames || 0) * scale)),
		...(descriptor.kind === 'video' && Array.isArray(descriptor.videoEffects) ? {
			videoEffects: cloneVideoEffectsWithCommandIds(
				descriptor.videoEffects,
				videoEffectIds,
				`Pasted clip ${descriptor.key}`,
			),
		} : {}),
		...(Array.isArray(descriptor.envelope) ? {
			envelope: descriptor.envelope.map((point) => ({
				...point,
				frame: Math.min(durationFrames, Math.max(0, Math.round(point.frame * scale))),
			})).filter((point, index, values) => !index || point.frame > values[index - 1].frame),
		} : {}),
	};
}

function cloneRational(value) {
	return value && typeof value === 'object'
		? { num: value.num, den: value.den }
		: value ?? null;
}

function cloneBreakpointMap(value) {
	if (value?.feature === 'video-retime' && value?.version === 2
		&& Array.isArray(value.points) && Array.isArray(value.segments)) {
		return {
			...value,
			points: value.points.map((point) => ({
				...point,
				sourceFrame: cloneRational(point.sourceFrame),
			})),
			segments: value.segments.map((segment) => ({
				...segment,
				...(segment.startVelocity ? { startVelocity: cloneRational(segment.startVelocity) } : {}),
				...(segment.endVelocity ? { endVelocity: cloneRational(segment.endVelocity) } : {}),
			})),
		};
	}
	return value && typeof value === 'object' && Array.isArray(value.points)
		? {
			...value,
			points: value.points.map((point) => ({
				...point,
				outer: cloneRational(point.outer),
				source: cloneRational(point.source),
			})),
		}
		: value ?? null;
}
