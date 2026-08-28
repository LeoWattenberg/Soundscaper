/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	assertVideoTransitionProjectLimitV1,
	validateVideoTransitionCollectionV1,
	type VideoTransitionV1,
} from '../common/editor/video-transition-v1.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectFeatureRequirementsTransitions,
	framescaperProjectFeatureRequirementsForRetimeFoundationTransitions,
} from './editor-project-feature-requirements-transitions.ts';
import { assertFramescaperProjectTransitionsCandidateProfile } from './editor-domain-runtime-profile.ts';
import { admitFramescaperProjectRetimeStructure } from './editor-project-retime-structural-admission.ts';
import {
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';

export const FRAMESCAPER_PROJECT_TRANSITIONS_SCHEMA_VERSION = 1 as const;

export interface FramescaperVideoTrackTransitions extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'video';
	readonly clipIds: readonly string[];
	readonly videoTransitions: readonly VideoTransitionV1[];
}

export interface FramescaperNonVideoTrackTransitions extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio' | 'label';
	readonly videoTransitions?: never;
}

export interface FramescaperProjectTransitions extends Record<string, unknown> {
	readonly schemaFamily: 'framescaper';
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaVersion: 1;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly (FramescaperVideoTrackTransitions | FramescaperNonVideoTrackTransitions)[];
	readonly projectBin: Readonly<{ readonly clips: readonly Readonly<Record<string, unknown>>[] }>;
	readonly sequences: readonly Readonly<Record<string, unknown>>[];
}

interface ProperOverlap {
	readonly trackId: string;
	readonly outgoing: Record<string, unknown>;
	readonly incoming: Record<string, unknown>;
	readonly start: number;
	readonly end: number;
}

export function validateFramescaperProjectTransitions(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectTransitions {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	admitFramescaperProjectRetimeStructure(project);
	const candidate = record(project, 'Framescaper transitions project');
	if (data(candidate, 'schemaVersion') !== FRAMESCAPER_PROJECT_TRANSITIONS_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(data(candidate, 'schemaVersion'))}.`);
	}
	validateFramescaperProjectRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		framescaperProjectRetimeFoundationTransitions(profile, candidate),
	);
	validateTransitionOwnership(candidate);
	validateFramescaperProjectFeatureRequirementsTransitions(profile, candidate);
	return true;
}

/** Build a detached transient exact-retime document with no transition backdoor. */
export function framescaperProjectRetimeFoundationTransitions(
	profile: unknown,
	project: unknown,
): FramescaperProjectRetime {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const candidate = record(project, 'Framescaper transitions project');
	const result = structuredClone(candidate) as Record<string, unknown>;
	result.schemaVersion =  1;
	result.featureRequirements = framescaperProjectFeatureRequirementsForRetimeFoundationTransitions(
		profile,
		candidate,
	);
	for (const track of records(result.tracks, 'tracks')) delete track.videoTransitions;
	return result as unknown as FramescaperProjectRetime;
}

/** Return every canonical proper overlap, independent of persisted transition objects. */
export function framescaperProjectProperOverlapsTransitions(project: unknown): readonly ProperOverlap[] {
	const candidate = record(project, 'Framescaper transitions project');
	const clips = new Map(records(data(candidate, 'clips'), 'clips').map((clip) => [id(clip), clip]));
	const result: ProperOverlap[] = [];
	for (const track of records(data(candidate, 'tracks'), 'tracks')) {
		if (data(track, 'type') !== 'video') continue;
		const trackId = id(track);
		const ordered = ids(data(track, 'clipIds'), `${trackId}.clipIds`).map((clipId) => {
			const clip = clips.get(clipId);
			if (!clip || data(clip, 'kind') !== 'video') {
				throw new ReferenceError(`Framescaper video track ${trackId} references missing video clip ${clipId}.`);
			}
			return clip;
		}).sort(compareClips);
		assertAtMostTwoActive(ordered, trackId);
		for (let index = 1; index < ordered.length; index += 1) {
			const outgoing = ordered[index - 1]!;
			const incoming = ordered[index]!;
			const outgoingStart = start(outgoing);
			const incomingStart = start(incoming);
			const outgoingEnd = safeEnd(outgoing);
			const incomingEnd = safeEnd(incoming);
			if (incomingStart >= outgoingEnd) continue;
			if (!(outgoingStart < incomingStart && outgoingEnd < incomingEnd)) {
				throw new RangeError(`Video track ${trackId} contains a nested or equal-boundary overlap.`);
			}
			result.push(Object.freeze({
				trackId, outgoing, incoming, start: incomingStart, end: outgoingEnd,
			}));
		}
	}
	return Object.freeze(result);
}

function validateTransitionOwnership(project: Record<string, unknown>): void {
	const overlaps = framescaperProjectProperOverlapsTransitions(project);
	const overlapByPair = new Map(overlaps.map((overlap) => [pairKey(
		overlap.trackId, id(overlap.outgoing), id(overlap.incoming),
	), overlap]));
	const transitionCollections: unknown[][] = [];
	const transitionIds = new Set<string>();
	const allIds = projectIdentities(project);
	for (const track of records(data(project, 'tracks'), 'tracks')) {
		const trackId = id(track);
		const descriptor = Object.getOwnPropertyDescriptor(track, 'videoTransitions');
		if (data(track, 'type') !== 'video') {
			if (descriptor) throw new TypeError(`Non-video track ${trackId} must not carry videoTransitions.`);
			continue;
		}
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) {
			throw new TypeError(`Video track ${trackId}.videoTransitions must be an own enumerable data array.`);
		}
		transitionCollections.push(descriptor.value);
		const starts = new Map<string, number>();
		for (const value of descriptor.value) {
			const transition = record(value, `${trackId} transition`);
			const transitionId = String(data(transition, 'id'));
			const overlap = overlapByPair.get(pairKey(
				trackId,
				String(data(transition, 'outgoingClipId')),
				String(data(transition, 'incomingClipId')),
			));
			if (!overlap) throw new RangeError(`Transition ${transitionId} has no exact proper overlap on ${trackId}.`);
			starts.set(transitionId, overlap.start);
		}
		const transitions = validateVideoTransitionCollectionV1(
			descriptor.value,
			starts,
			`Framescaper video track ${trackId}.videoTransitions`,
		);
		for (const transition of transitions) {
			if (allIds.has(transition.id) || transitionIds.has(transition.id)) {
				throw new RangeError(`Video transition identity ${transition.id} collides with project identity.`);
			}
			transitionIds.add(transition.id);
			const overlap = overlapByPair.get(pairKey(
				trackId, transition.outgoingClipId, transition.incomingClipId,
			))!;
			if (transition.durationFrames !== overlap.end - overlap.start) {
				throw new RangeError(`Transition ${transition.id} duration does not equal its proper overlap.`);
			}
			overlapByPair.delete(pairKey(trackId, transition.outgoingClipId, transition.incomingClipId));
		}
	}
	assertVideoTransitionProjectLimitV1(transitionCollections);
	if (overlapByPair.size > 0) {
		throw new RangeError('Every proper video overlap requires exactly one transition object.');
	}
	const projectBin = record(data(project, 'projectBin'), 'projectBin');
	if (Object.hasOwn(projectBin, 'videoTransitions')) {
		throw new TypeError('The Project Bin must not own videoTransitions.');
	}
}

function assertAtMostTwoActive(clips: readonly Record<string, unknown>[], trackId: string): void {
	const events = clips.flatMap((clip) => [
		{ frame: start(clip), delta: 1 },
		{ frame: safeEnd(clip), delta: -1 },
	]).sort((left, right) => left.frame - right.frame || left.delta - right.delta);
	let active = 0;
	for (const event of events) {
		active += event.delta;
		if (active > 2) throw new RangeError(`Video track ${trackId} contains a three-way overlap.`);
	}
}

function projectIdentities(project: Record<string, unknown>): Set<string> {
	const values: unknown[] = [project];
	for (const key of ['sources', 'clips', 'tracks', 'sequences', 'subsequences', 'multicameraGroups']) {
		const descriptor = Object.getOwnPropertyDescriptor(project, key);
		if (descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)) {
			values.push(...descriptor.value);
		}
	}
	const bin = record(data(project, 'projectBin'), 'projectBin');
	values.push(...records(data(bin, 'clips'), 'projectBin.clips'));
	return new Set(values.map((value) => id(record(value, 'identity owner'))));
}

function compareClips(left: Record<string, unknown>, right: Record<string, unknown>): number {
	return start(left) - start(right) || compareText(id(left), id(right));
}

function pairKey(trackId: string, outgoing: string, incoming: string): string {
	return JSON.stringify([trackId, outgoing, incoming]);
}

function start(clip: Record<string, unknown>): number {
	const value = data(clip, 'sequenceStartFrame');
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('Video clip start is invalid.');
	return Number(value);
}

function safeEnd(clip: Record<string, unknown>): number {
	const count = data(clip, 'sequenceFrameCount');
	if (!Number.isSafeInteger(count) || Number(count) <= 0) throw new RangeError('Video clip duration is invalid.');
	const end = start(clip) + Number(count);
	if (!Number.isSafeInteger(end)) throw new RangeError('Video clip sequence range overflows.');
	return end;
}

function id(value: Record<string, unknown>): string {
	const candidate = data(value, 'id');
	if (typeof candidate !== 'string' || candidate.length === 0) throw new TypeError('Project identity is invalid.');
	return candidate;
}

function ids(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate) => String(candidate));
}

function data(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
