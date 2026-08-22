/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	normalizeVideoTransitionAllocationsV1,
	normalizeVideoTransitionV1,
	type VideoTransitionAllocationV1,
	type VideoTransitionV1,
} from '../common/editor/video-transition-v1.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import { validateFramescaperProjectV22, type FramescaperProjectV22 } from './editor-project-v22.ts';

export interface FramescaperVideoClipboardV7 {
	readonly schemaVersion: 7;
	readonly kind: 'framescaper-video-fragment';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly sourceTrackId: string;
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly transitions: readonly VideoTransitionV1[];
}

export interface FramescaperVideoClipboardPasteV7 {
	readonly trackId: string;
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly transitions: readonly VideoTransitionV1[];
	readonly videoTransitionAllocations: readonly VideoTransitionAllocationV1[];
}

const CARRIER_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'sourceTrackId', 'clips', 'transitions',
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function createFramescaperVideoClipboardV7(
	profile: unknown,
	project: unknown,
	selection: Readonly<{ trackId: string; clipIds: readonly string[] }>,
): FramescaperVideoClipboardV7 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectV22(profile, project);
	const candidate = project as FramescaperProjectV22;
	const trackId = stableId(selection.trackId, 'clipboard trackId');
	const track = candidate.tracks.find(({ id }) => id === trackId);
	if (!track || track.type !== 'video') throw new ReferenceError(`Video track ${trackId} does not exist.`);
	const selected = new Set(selection.clipIds.map((id) => stableId(id, 'clipboard clip ID')));
	if (selected.size !== selection.clipIds.length) throw new RangeError('Clipboard clip IDs must be unique.');
	for (const clipId of selected) {
		if (!track.clipIds.includes(clipId)) throw new RangeError(`Clip ${clipId} is not owned by ${trackId}.`);
	}
	const clips = candidate.clips.filter(({ id }) => selected.has(String(id))).map((clip) => structuredClone(clip));
	const transitions = track.videoTransitions.filter((transition) => (
		selected.has(transition.outgoingClipId) && selected.has(transition.incomingClipId)
	)).map((transition) => normalizeVideoTransitionV1(transition));
	return normalizeFramescaperVideoClipboardV7({
		schemaVersion: 7,
		kind: 'framescaper-video-fragment',
		originProjectId: candidate.id,
		originRevision: candidate.revision,
		sourceTrackId: trackId,
		clips,
		transitions,
	});
}

export function normalizeFramescaperVideoClipboardV7(value: unknown): FramescaperVideoClipboardV7 {
	const input = readClosedDomainRecord(value, 'Framescaper video clipboard V7', CARRIER_FIELDS);
	if (field(input, 'schemaVersion') !== 7) {
		throw new RangeError('Framescaper transition clipboard requires V7 recopy.');
	}
	if (field(input, 'kind') !== 'framescaper-video-fragment') {
		throw new RangeError('Framescaper clipboard kind is unsupported.');
	}
	const clips = readClosedDomainArray(field(input, 'clips'), 'Framescaper clipboard clips', 1, 100_000)
		.map((clip, index) => snapshotPlainValue(clip, `clipboard clips[${String(index)}]`) as Readonly<Record<string, unknown>>);
	const clipIds = new Set<string>();
	for (const clip of clips) {
		const clipId = stableId(ownData(clip, 'id', 'clipboard clip'), 'clipboard clip ID');
		if (clipIds.has(clipId)) throw new RangeError(`Duplicate clipboard clip ID ${clipId}.`);
		clipIds.add(clipId);
	}
	const transitions = readClosedDomainArray(
		field(input, 'transitions'), 'Framescaper clipboard transitions', 0, 100_000,
	).map((transition, index) => normalizeVideoTransitionV1(
		transition, `clipboard transitions[${String(index)}]`,
	));
	const transitionIds = new Set<string>();
	for (const transition of transitions) {
		if (!clipIds.has(transition.outgoingClipId) || !clipIds.has(transition.incomingClipId)) {
			throw new ReferenceError('A clipboard transition must carry both participant clips.');
		}
		if (transitionIds.has(transition.id)) throw new RangeError('Clipboard transition IDs must be unique.');
		transitionIds.add(transition.id);
	}
	return Object.freeze({
		schemaVersion: 7 as const,
		kind: 'framescaper-video-fragment' as const,
		originProjectId: stableId(field(input, 'originProjectId'), 'originProjectId'),
		originRevision: nonNegativeInteger(field(input, 'originRevision'), 'originRevision'),
		sourceTrackId: stableId(field(input, 'sourceTrackId'), 'sourceTrackId'),
		clips: Object.freeze(clips),
		transitions: Object.freeze(transitions),
	});
}

export function prepareFramescaperVideoClipboardPasteV7(
	clipboardValue: unknown,
	options: Readonly<{
		trackId: string;
		clipIdMap: ReadonlyMap<string, string>;
		videoTransitionAllocations: readonly unknown[];
	}>,
): FramescaperVideoClipboardPasteV7 {
	const clipboard = normalizeFramescaperVideoClipboardV7(clipboardValue);
	const trackId = stableId(options.trackId, 'paste trackId');
	if (trackId === clipboard.sourceTrackId) throw new RangeError('Paste requires a fresh destination track identity.');
	const clipIdMap = allocationMap(options.clipIdMap);
	const allocations = normalizeVideoTransitionAllocationsV1(options.videoTransitionAllocations);
	const allocationByPair = new Map(allocations.map((allocation) => [JSON.stringify([
		allocation.trackId, allocation.outgoingClipId, allocation.incomingClipId,
	]), allocation]));
	const used = new Set<string>();
	const usedClipIds = new Set<string>();
	const oldTransitionIds = new Set(clipboard.transitions.map(({ id }) => id));
	const oldIds = new Set<string>([
		clipboard.sourceTrackId, ...clipIdMap.keys(), ...oldTransitionIds,
	]);
	if (oldIds.has(trackId)) throw new RangeError('Paste destination track identity must be fresh.');
	const freshIds = new Set<string>([trackId]);
	for (const [source, targetValue] of clipIdMap) {
		stableId(source, 'clip allocation source');
		const target = stableId(targetValue, 'clip allocation target');
		if (oldIds.has(target)) throw new RangeError('Paste clip allocations must be fresh.');
		if (freshIds.has(target)) throw new RangeError('Paste clip allocations must be unique and collision-free.');
		freshIds.add(target);
	}
	for (const allocation of allocations) {
		if (oldIds.has(allocation.transitionId)) {
			throw new RangeError('Paste transition allocations must be fresh.');
		}
		if (freshIds.has(allocation.transitionId)) {
			throw new RangeError('Paste transition allocations collide with another fresh identity.');
		}
		freshIds.add(allocation.transitionId);
	}
	const remap = (id: string): string => {
		const mapped = clipIdMap.get(id);
		if (!mapped) throw new ReferenceError(`Paste has no fresh mapping for clip ${id}.`);
		usedClipIds.add(id);
		return stableId(mapped, `mapped clip ${id}`);
	};
	const clips = clipboard.clips.map((clip) => Object.freeze({
		...structuredClone(clip), id: remap(String(clip.id)),
	}));
	const transitions = clipboard.transitions.map((transition) => {
		const outgoingClipId = remap(transition.outgoingClipId);
		const incomingClipId = remap(transition.incomingClipId);
		const key = JSON.stringify([trackId, outgoingClipId, incomingClipId]);
		const allocation = allocationByPair.get(key);
		if (!allocation) throw new RangeError(`Pasted transition pair ${key} requires an exact allocation.`);
		used.add(key);
		return normalizeVideoTransitionV1({
			...transition,
			id: allocation.transitionId,
			outgoingClipId,
			incomingClipId,
		});
	});
	if (used.size !== allocations.length) throw new RangeError('Paste contains an unused transition allocation.');
	for (const source of clipIdMap.keys()) {
		if (!usedClipIds.has(source)) throw new RangeError(`Paste contains an unused clip allocation ${source}.`);
	}
	return Object.freeze({
		trackId,
		clips: Object.freeze(clips),
		transitions: Object.freeze(transitions),
		videoTransitionAllocations: allocations,
	});
}

function allocationMap(value: unknown): ReadonlyMap<string, string> {
	if (!value || typeof value !== 'object'
		|| typeof (value as ReadonlyMap<unknown, unknown>).get !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).entries !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).keys !== 'function'
		|| !Number.isSafeInteger((value as ReadonlyMap<unknown, unknown>).size)
		|| (value as ReadonlyMap<unknown, unknown>).size > 100_000) {
		throw new TypeError('Paste requires a bounded explicit clip ID map.');
	}
	return value as ReadonlyMap<string, string>;
}

function snapshotPlainValue(value: unknown, name: string): unknown {
	try {
		return structuredClone(value);
	} catch (cause) {
		throw new TypeError(`${name} must contain only structured-clone data.`, { cause });
	}
}

function field(record: Readonly<Record<string, unknown>>, key: string): unknown {
	return readClosedDomainField(record, key, 'Framescaper video clipboard V7');
}

function ownData(value: Readonly<Record<string, unknown>>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
