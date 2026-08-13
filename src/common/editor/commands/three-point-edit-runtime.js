/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	clipEndFrame,
	createStableId,
	findSource,
	normalizeFrameRange,
} from '../project.js';
import { addClip } from './clip-basic-runtime.js';
import { processTrackRange } from './range-runtime.js';
import { resolveRangeSequenceGeometry } from './range-sequence-geometry.ts';
import {
	assertUnusedClipId,
	normalizeClipForProject,
	prepareVideoEffectIds,
	requireClip,
	requireStableCommandId,
	requireTrack,
	segmentOfClip,
} from './shared-runtime.js';

// foundation-edit-matrix: insert
// foundation-edit-matrix: overwrite
// foundation-edit-matrix: replace

/**
 * Insert and overwrite are two directions of one conformance rule. Both resolve
 * the operation span once per sequence, so a video clip and the audio linked to
 * it move by exactly the same resolved amount.
 *
 * Overwrite disturbs only the lanes it lands on. Insert ripples every media lane
 * in the sequence, because shifting only the targeted lanes would silently pull
 * everything else out of sync.
 *
 * Replace runs through the overwrite path unchanged: the controller derives its
 * range from the clip being replaced instead of from a selection, which is the
 * only difference between them and is why replace needs no rule of its own here.
 */

/** Which lanes an operation touches: its targets, or the whole sequence when it ripples. */
function affectedTrackIds(project, placements, ripples) {
	const targeted = placements.map((placement) => requireTrack(project, placement.trackId).id);
	if (!ripples) return targeted;
	const geometry = resolveRangeSequenceGeometry(project, targeted, { startFrame: 0, endFrame: 1 });
	const lanes = geometry.sequences.flatMap((sequence) => [...sequence.mediaTrackIds]);
	return lanes.length ? lanes : targeted;
}

/** Prepare a replay-safe three-point edit: every generated ID is allocated here. */
export function prepareThreePointEditCommand(project, options = {}, idFactory = createStableId) {
	const mode = options.mode === 'insert' ? 'insert' : 'overwrite';
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'edit range');
	const placements = (Array.isArray(options.placements) ? options.placements : []).map((placement) => {
		const sourceId = requireStableCommandId(placement?.sourceId, 'edit source');
		const source = findSource(project, sourceId);
		if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
		return {
			trackId: requireTrack(project, placement?.trackId).id,
			clipId: requireStableCommandId(placement?.clipId || idFactory('clip'), 'edit clip'),
			sourceId,
			// The media decides what kind of clip this is; the track type then has
			// to agree, which the clip runtime already enforces.
			kind: source.kind === 'video' ? 'video' : 'audio',
			sourceIn: placement?.sourceIn ?? 0,
			sourceCount: placement?.sourceCount,
			...(placement?.title == null ? {} : { title: String(placement.title) }),
		};
	});
	if (!placements.length) throw new RangeError('A three-point edit needs at least one targeted lane.');
	const trackIds = affectedTrackIds(project, placements, mode === 'insert');
	const geometry = resolveRangeSequenceGeometry(project, trackIds, range);
	const splitClipIds = {};
	const splitAvLinkIds = {};
	const videoEffectIds = {};
	for (const trackId of trackIds) {
		const operationRange = geometry.trackRanges.get(trackId) ?? range;
		if (!operationRange) continue;
		for (const clipId of requireTrack(project, trackId).clipIds) {
			const clip = requireClip(project, clipId);
			if (!splitsAt(clip, operationRange, mode)) continue;
			splitClipIds[clip.id] = idFactory('clip');
			const effectIds = prepareVideoEffectIds(clip, idFactory);
			if (effectIds) videoEffectIds[splitClipIds[clip.id]] = effectIds;
			if (clip.avLinkId && !splitAvLinkIds[clip.avLinkId]) {
				splitAvLinkIds[clip.avLinkId] = idFactory('av-link');
			}
		}
	}
	return {
		type: mode === 'insert' ? 'edit/insert' : 'edit/overwrite',
		...range,
		trackIds,
		placements,
		...(placements.length > 1 ? { avLinkId: options.avLinkId || idFactory('av-link') } : {}),
		splitClipIds,
		splitAvLinkIds,
		videoEffectIds,
	};
}

/**
 * Overwrite: lift the resolved range on the lanes that receive material, then
 * place it. Lanes the edit does not land on are untouched.
 */
export function overwriteThreePointEdit(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'edit range');
	const geometry = editGeometry(project, command, range);
	for (const trackId of trackIdsOf(command)) {
		const track = requireTrack(project, trackId);
		const operationRange = geometry.trackRanges.get(trackId) ?? range;
		if (!operationRange) continue;
		processTrackRange(
			project,
			track,
			operationRange,
			'none',
			command.splitClipIds || {},
			command.splitAvLinkIds || {},
			command.videoEffectIds || {},
		);
	}
	placeEditedClips(project, command, range);
}

/**
 * Insert: open the resolved span on every media lane in the sequence, then place
 * the material. A clip the insert point falls inside is split and its tail moves
 * with everything after it.
 */
export function insertThreePointEdit(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'edit range');
	const geometry = editGeometry(project, command, range);
	for (const trackId of trackIdsOf(command)) {
		const track = requireTrack(project, trackId);
		const operationRange = geometry.trackRanges.get(trackId) ?? range;
		if (!operationRange) continue;
		openTrackRange(
			project,
			track,
			operationRange,
			command.splitClipIds || {},
			command.splitAvLinkIds || {},
			command.videoEffectIds || {},
		);
	}
	placeEditedClips(project, command, range);
}

/** Split at the insert point and move everything from there on to the right. */
function openTrackRange(project, track, range, splitClipIds, splitAvLinkIds, videoEffectIds) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const deletedIds = new Set(track.clipIds);
	const replacements = [];
	for (const clip of originals) {
		const start = clip.timelineStartFrame;
		const end = clipEndFrame(clip);
		if (end <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (start >= range.startFrame) {
			replacements.push({ ...clip, timelineStartFrame: start + range.durationFrames });
			continue;
		}
		const rightId = splitClipIds[clip.id];
		if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
		assertUnusedClipId(project, rightId);
		replacements.push(segmentOfClip(project, clip, start, range.startFrame, start, clip.id));
		let right = segmentOfClip(
			project,
			clip,
			range.startFrame,
			end,
			range.endFrame,
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
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame)
		.map((clip) => clip.id);
}

/**
 * Place the edited material. A linked pair shares one A/V link so the audio's
 * presentation is derived from the video's conformed endpoints rather than
 * converted a second time.
 */
function placeEditedClips(project, command, range) {
	const placements = Array.isArray(command.placements) ? command.placements : [];
	if (!placements.length) throw new RangeError('A three-point edit needs at least one targeted lane.');
	const avLinkId = placements.length > 1
		? requireStableCommandId(command.avLinkId, 'edit A/V link')
		: null;
	for (const placement of placements) {
		// The source range is stated in the source's own domain — video frames for
		// a video source, samples for an audio one — so it is named into the
		// authority each kind persists rather than converted through the other.
		const video = placement.kind === 'video';
		addClip(project, requireTrack(project, placement.trackId).id, {
			id: requireStableCommandId(placement.clipId, 'edit clip'),
			sourceId: requireStableCommandId(placement.sourceId, 'edit source'),
			kind: video ? 'video' : 'audio',
			timelineStartFrame: range.startFrame,
			durationFrames: range.durationFrames,
			...(video
				? {
					sourceInFrame: placement.sourceIn ?? 0,
					...(placement.sourceCount == null ? {} : { sourceFrameCount: placement.sourceCount }),
				}
				: {
					sourceStartFrame: placement.sourceIn ?? 0,
					...(placement.sourceCount == null ? {} : { sourceDurationFrames: placement.sourceCount }),
				}),
			...(placement.title == null ? {} : { title: placement.title }),
			...(avLinkId ? { avLinkId } : {}),
		});
	}
}

function editGeometry(project, command, range) {
	return resolveRangeSequenceGeometry(project, trackIdsOf(command), range);
}

function trackIdsOf(command) {
	const trackIds = Array.isArray(command.trackIds) ? command.trackIds : [];
	if (!trackIds.length) throw new RangeError('A three-point edit names the lanes it operates on.');
	return trackIds;
}

/** Overwrite splits a clip its range is strictly inside; insert splits at its point. */
function splitsAt(clip, range, mode) {
	const start = clip.timelineStartFrame;
	const end = clipEndFrame(clip);
	return mode === 'insert'
		? start < range.startFrame && end > range.startFrame
		: start < range.startFrame && end > range.endFrame;
}
