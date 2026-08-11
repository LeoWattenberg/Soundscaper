/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
	collectRelatedClipIds as collectLegacyRelatedClipIds,
} from './commands/clip-basic-runtime.js';
import {
	nonEmptyString,
	sameFrameTrimRate,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalRollRippleTrimMode } from './frame-canonical-roll-ripple-trim-domain.ts';
import {
	frameCanonicalTrimParticipant,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';

export interface FrameCanonicalRollRippleTrimTargets {
	readonly edge: readonly FrameCanonicalTrimParticipant[];
	readonly neighbors: readonly FrameCanonicalTrimParticipant[];
	readonly shifted: readonly FrameCanonicalTrimParticipant[];
}

const collectClipTransformIds = collectLegacyClipTransformIds as unknown as (
	project: FrameTrimDataRecord,
	activeClipId: string,
) => string[];

const collectRelatedClipIds = collectLegacyRelatedClipIds as unknown as (
	project: FrameTrimDataRecord,
	clipIds: readonly string[],
) => string[];

export function resolveFrameCanonicalRollRippleTrimTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	active: FrameCanonicalTrimParticipant,
	mode: FrameCanonicalRollRippleTrimMode,
	edge: FrameCanonicalTrimEdge,
): FrameCanonicalRollRippleTrimTargets {
	return mode === 'roll'
		? rollTargets(project, index, active, edge)
		: rippleTargets(project, index, active, edge);
}

function rollTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	active: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
): FrameCanonicalRollRippleTrimTargets {
	const editSample = edge === 'left' ? active.timelineStart : active.timelineEnd;
	const neighbor = uniqueTouchingNeighbor(index, active, edge, editSample);
	const participantIds = new Set([active.clipId, neighbor.clipId]);
	const selectedIds = selectionClipIds(project);
	if (selectedIds.includes(active.clipId)) for (const clipId of selectedIds) participantIds.add(clipId);
	let changed = true;
	while (changed) {
		changed = false;
		for (const clipId of collectRelatedClipIds(project, [...participantIds])) {
			if (!participantIds.has(clipId)) changed = true;
			participantIds.add(clipId);
		}
		const reachedTrackIds = new Set(stableParticipants(index, participantIds).map(({ trackId }) => trackId));
		for (const trackId of reachedTrackIds) {
			const lane = trackParticipants(index, trackId);
			const left = lane.filter((item) => item.timelineEnd === editSample);
			const right = lane.filter((item) => item.timelineStart === editSample);
			if (left.length !== 1 || right.length !== 1) {
				throw new RangeError(`Roll lane ${trackId} requires one left and one right adjacent clip.`);
			}
			assertNoRollStraddler(trackId, editSample, lane, left[0]!, right[0]!);
			for (const item of [left[0]!, right[0]!]) {
				if (!participantIds.has(item.clipId)) changed = true;
				participantIds.add(item.clipId);
			}
		}
	}
	const participants = stableParticipants(index, participantIds);
	const left = participants.filter((item) => item.timelineEnd === editSample);
	const right = participants.filter((item) => item.timelineStart === editSample);
	if (left.length + right.length !== participants.length) {
		throw new RangeError('Roll relation closure must share one exact touching edit point.');
	}
	const edgeParticipants = edge === 'right' ? left : right;
	const neighbors = edge === 'right' ? right : left;
	if (!edgeParticipants.some(({ clipId }) => clipId === active.clipId)) {
		throw new RangeError('The active clip is not on the requested roll side.');
	}
	return { edge: edgeParticipants, neighbors, shifted: [] };
}

function rippleTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	active: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
): FrameCanonicalRollRippleTrimTargets {
	const edgeIds = collectClipTransformIds(project, active.clipId);
	if (!edgeIds.length) throw new RangeError(`Active clip ${active.clipId} cannot seed a ripple trim.`);
	const edgeParticipants = edgeIds.map((clipId) => frameCanonicalTrimParticipant(index, clipId));
	const editSample = edge === 'left' ? active.timelineStart : active.timelineEnd;
	const seenLanes = new Set<string>();
	for (const item of edgeParticipants) {
		const itemEdge = edge === 'left' ? item.timelineStart : item.timelineEnd;
		if (itemEdge !== editSample) throw new RangeError('Ripple edge participants must share one edit point.');
		if (seenLanes.has(item.trackId)) throw new RangeError(`Ripple edge block has multiple clips on lane ${item.trackId}.`);
		seenLanes.add(item.trackId);
	}
	return {
		edge: edgeParticipants,
		neighbors: [],
		shifted: rippleSuffixClosure(project, index, edgeParticipants),
	};
}

function rippleSuffixClosure(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	edgeParticipants: readonly FrameCanonicalTrimParticipant[],
): readonly FrameCanonicalTrimParticipant[] {
	const edgeVideo = edgeParticipants.find(({ video }) => video !== null)?.video ?? null;
	const edgeIds = new Set(edgeParticipants.map(({ clipId }) => clipId));
	const cutByTrackId = new Map(edgeParticipants.map((item) => [item.trackId, item.timelineEnd]));
	const fallbackCut = Math.min(...cutByTrackId.values());
	const shiftedIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const [trackId, cut] of cutByTrackId) {
			for (const item of trackParticipants(index, trackId)) {
				if (edgeIds.has(item.clipId)) continue;
				if (item.timelineStart < cut && item.timelineEnd > cut) {
					throw new RangeError(`Clip ${item.clipId} straddles ripple suffix cut ${String(cut)}.`);
				}
				if (item.timelineStart >= cut && !shiftedIds.has(item.clipId)) {
					shiftedIds.add(item.clipId);
					changed = true;
				}
			}
		}
		for (const clipId of collectRelatedClipIds(project, [...shiftedIds])) {
			if (edgeIds.has(clipId)) throw new RangeError(`Ripple relation ${clipId} crosses the stationary cut.`);
			if (shiftedIds.has(clipId)) continue;
			const item = frameCanonicalTrimParticipant(index, clipId);
			if (item.video && edgeVideo && (
				item.video.sequenceId !== edgeVideo.sequenceId
				|| !sameFrameTrimRate(item.video.sequenceRate, edgeVideo.sequenceRate)
			)) {
				throw new RangeError(`Ripple relation video ${clipId} uses a different sequence or rate.`);
			}
			const cut = cutByTrackId.get(item.trackId) ?? fallbackCut;
			if (item.timelineStart < cut) {
				throw new RangeError(`Ripple relation peer ${clipId} lies on the stationary side of its suffix cut.`);
			}
			if (!cutByTrackId.has(item.trackId)) cutByTrackId.set(item.trackId, fallbackCut);
			shiftedIds.add(clipId);
			changed = true;
		}
	}
	return stableParticipants(index, shiftedIds);
}

function uniqueTouchingNeighbor(
	index: FrameTrimProjectIndex,
	active: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
	editSample: number,
): FrameCanonicalTrimParticipant {
	const candidates = trackParticipants(index, active.trackId).filter((item) => (
		item.clipId !== active.clipId
		&& (edge === 'right' ? item.timelineStart === editSample : item.timelineEnd === editSample)
	));
	if (candidates.length !== 1) {
		throw new RangeError(`Roll requires one adjacent clip that touches ${active.clipId}.`);
	}
	return candidates[0]!;
}

function assertNoRollStraddler(
	trackId: string,
	editSample: number,
	lane: readonly FrameCanonicalTrimParticipant[],
	left: FrameCanonicalTrimParticipant,
	right: FrameCanonicalTrimParticipant,
): void {
	for (const item of lane) {
		if (item.clipId === left.clipId || item.clipId === right.clipId) continue;
		if (item.timelineStart < editSample && item.timelineEnd > editSample) {
			throw new RangeError(`Roll lane ${trackId} has a transition or third clip across the edit point.`);
		}
	}
}

function stableParticipants(
	index: FrameTrimProjectIndex,
	ids: ReadonlySet<string>,
): readonly FrameCanonicalTrimParticipant[] {
	return index.clips
		.filter((clip) => ids.has(nonEmptyString(clip.id, 'clip.id')))
		.map((clip) => frameCanonicalTrimParticipant(index, nonEmptyString(clip.id, 'clip.id')));
}

function trackParticipants(
	index: FrameTrimProjectIndex,
	trackId: string,
): readonly FrameCanonicalTrimParticipant[] {
	const track = index.trackById.get(trackId);
	if (!track || !Array.isArray(track.clipIds)) throw new RangeError(`Media lane ${trackId} is missing clip ownership.`);
	return track.clipIds.map((value) => frameCanonicalTrimParticipant(
		index, nonEmptyString(value, `track ${trackId} clip ID`),
	));
}

function selectionClipIds(project: FrameTrimDataRecord): readonly string[] {
	const selection = project.selection;
	if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return [];
	const clipIds = (selection as FrameTrimDataRecord).clipIds;
	if (!Array.isArray(clipIds)) return [];
	return clipIds.map((value) => nonEmptyString(value, 'selection clip ID'));
}
