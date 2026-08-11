/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
	collectRelatedClipIds as collectLegacyRelatedClipIds,
} from './commands/clip-basic-runtime.js';
import {
	nonEmptyString,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalSlipSlideRole } from './frame-canonical-slip-slide-domain.ts';
import {
	frameCanonicalLinkedVideoCompanions,
	frameCanonicalTrimParticipant,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';

export interface FrameCanonicalSlipTargets {
	readonly participants: readonly FrameCanonicalTrimParticipant[];
}

export interface FrameCanonicalSlideTargets {
	readonly left: readonly FrameCanonicalTrimParticipant[];
	readonly center: readonly FrameCanonicalTrimParticipant[];
	readonly right: readonly FrameCanonicalTrimParticipant[];
	readonly participants: readonly FrameCanonicalTrimParticipant[];
	readonly roleByClipId: ReadonlyMap<string, FrameCanonicalSlipSlideRole>;
}

const collectClipTransformIds = collectLegacyClipTransformIds as unknown as (
	project: FrameTrimDataRecord,
	activeClipId: string,
) => string[];

const collectRelatedClipIds = collectLegacyRelatedClipIds as unknown as (
	project: FrameTrimDataRecord,
	clipIds: readonly string[],
) => string[];

export function resolveFrameCanonicalSlipTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	activeClipId: string,
): FrameCanonicalSlipTargets {
	const ids = collectClipTransformIds(project, activeClipId);
	if (!ids.length) throw new RangeError(`Active clip ${activeClipId} cannot seed a slip.`);
	const participants = stableParticipants(index, new Set(ids));
	assertSimpleAvLinks(participants);
	return { participants };
}

export function resolveFrameCanonicalSlideTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	activeClipId: string,
): FrameCanonicalSlideTargets {
	const centerIds = collectClipTransformIds(project, activeClipId);
	if (!centerIds.length) throw new RangeError(`Active clip ${activeClipId} cannot seed a slide.`);
	const roleByClipId = new Map<string, FrameCanonicalSlipSlideRole>();
	for (const clipId of centerIds) assignRole(roleByClipId, clipId, 'center');
	let changed = true;
	while (changed) {
		changed = expandRelations(project, roleByClipId);
		const laneRoles = rolesByLane(index, roleByClipId);
		for (const [trackId, roles] of laneRoles) {
			const lane = trackParticipants(index, trackId);
			const triplet = completeTriplet(trackId, lane, roles);
			for (const [role, participant] of triplet) {
				if (!roleByClipId.has(participant.clipId)) changed = true;
				assignRole(roleByClipId, participant.clipId, role);
			}
		}
	}
	const participants = stableParticipants(index, new Set(roleByClipId.keys()));
	const left = participants.filter(({ clipId }) => roleByClipId.get(clipId) === 'left');
	const center = participants.filter(({ clipId }) => roleByClipId.get(clipId) === 'center');
	const right = participants.filter(({ clipId }) => roleByClipId.get(clipId) === 'right');
	for (const roleParticipants of [left, center, right]) assertSimpleAvLinks(roleParticipants);
	const finalLanes = rolesByLane(index, roleByClipId);
	for (const [trackId, roles] of finalLanes) {
		if (roles.size !== 3 || [...roles.values()].some((values) => values.length !== 1)) {
			throw new RangeError(`Slide lane ${trackId} does not contain one left, center, and right clip.`);
		}
		completeTriplet(trackId, trackParticipants(index, trackId), roles);
	}
	return { left, center, right, participants, roleByClipId };
}

function expandRelations(
	project: FrameTrimDataRecord,
	roleByClipId: Map<string, FrameCanonicalSlipSlideRole>,
): boolean {
	let changed = false;
	for (const [clipId, role] of [...roleByClipId]) {
		for (const relatedId of collectRelatedClipIds(project, [clipId])) {
			if (!roleByClipId.has(relatedId)) changed = true;
			assignRole(roleByClipId, relatedId, role);
		}
	}
	return changed;
}

function rolesByLane(
	index: FrameTrimProjectIndex,
	roleByClipId: ReadonlyMap<string, FrameCanonicalSlipSlideRole>,
): Map<string, Map<FrameCanonicalSlipSlideRole, FrameCanonicalTrimParticipant[]>> {
	const result = new Map<string, Map<FrameCanonicalSlipSlideRole, FrameCanonicalTrimParticipant[]>>();
	for (const [clipId, role] of roleByClipId) {
		const participant = frameCanonicalTrimParticipant(index, clipId);
		const roles = result.get(participant.trackId) ?? new Map();
		const values = roles.get(role) ?? [];
		values.push(participant);
		roles.set(role, values);
		result.set(participant.trackId, roles);
	}
	for (const [trackId, roles] of result) for (const [role, values] of roles) {
		if (values.length !== 1) throw new RangeError(`Slide lane ${trackId} has multiple ${role} clips.`);
	}
	return result;
}

function completeTriplet(
	trackId: string,
	lane: readonly FrameCanonicalTrimParticipant[],
	roles: ReadonlyMap<FrameCanonicalSlipSlideRole, readonly FrameCanonicalTrimParticipant[]>,
): ReadonlyMap<FrameCanonicalSlipSlideRole, FrameCanonicalTrimParticipant> {
	const knownLeft = roles.get('left')?.[0];
	const knownCenter = roles.get('center')?.[0];
	const knownRight = roles.get('right')?.[0];
	let center = knownCenter;
	if (!center && knownLeft) center = uniqueAtBoundary(
		trackId, lane, knownLeft.timelineEnd, 'start', knownLeft.clipId, 'center',
	);
	if (!center && knownRight) center = uniqueAtBoundary(
		trackId, lane, knownRight.timelineStart, 'end', knownRight.clipId, 'center',
	);
	if (!center) throw new RangeError(`Slide lane ${trackId} has no center clip.`);
	const left = knownLeft ?? uniqueAtBoundary(
		trackId, lane, center.timelineStart, 'end', center.clipId, 'left neighbor',
	);
	const right = knownRight ?? uniqueAtBoundary(
		trackId, lane, center.timelineEnd, 'start', center.clipId, 'right neighbor',
	);
	if (left.timelineEnd !== center.timelineStart || center.timelineEnd !== right.timelineStart) {
		throw new RangeError(`Slide lane ${trackId} must be an exact touching triplet.`);
	}
	if (left.timelineStart >= center.timelineStart || center.timelineEnd >= right.timelineEnd) {
		throw new RangeError(`Slide lane ${trackId} roles are equal, nested, or out of order.`);
	}
	for (const item of lane) {
		if ([left.clipId, center.clipId, right.clipId].includes(item.clipId)) continue;
		if (item.timelineStart < right.timelineEnd && item.timelineEnd > left.timelineStart) {
			throw new RangeError(`Slide lane ${trackId} has a transition, overlapping, or nested clip in its triplet.`);
		}
	}
	return new Map([
		['left', left],
		['center', center],
		['right', right],
	]);
}

function uniqueAtBoundary(
	trackId: string,
	lane: readonly FrameCanonicalTrimParticipant[],
	boundary: number,
	edge: 'start' | 'end',
	excludedClipId: string,
	label: string,
): FrameCanonicalTrimParticipant {
	const candidates = lane.filter((item) => item.clipId !== excludedClipId
		&& (edge === 'start' ? item.timelineStart : item.timelineEnd) === boundary);
	if (candidates.length !== 1) {
		throw new RangeError(`Slide lane ${trackId} requires one touching ${label}.`);
	}
	return candidates[0]!;
}

function assertSimpleAvLinks(participants: readonly FrameCanonicalTrimParticipant[]): void {
	frameCanonicalLinkedVideoCompanions(
		participants,
		participants.filter(({ video }) => video !== null),
	);
}

function assignRole(
	roleByClipId: Map<string, FrameCanonicalSlipSlideRole>,
	clipId: string,
	role: FrameCanonicalSlipSlideRole,
): void {
	const prior = roleByClipId.get(clipId);
	if (prior && prior !== role) throw new RangeError(`Slide relation ${clipId} crosses ${prior} and ${role} roles.`);
	roleByClipId.set(clipId, role);
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
		index,
		nonEmptyString(value, `track ${trackId} clip ID`),
	));
}
