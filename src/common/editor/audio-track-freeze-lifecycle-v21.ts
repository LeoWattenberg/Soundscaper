/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import { normalizeMixerGraphV21 } from './mixer-graph-v21.ts';
import {
	classifyAudioTrackFreezeFreshnessV1,
	normalizeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	sameAudioTrackFreezeV1,
	type AudioTrackFreezeV1,
} from './audio-track-freeze-v21.ts';

export interface InstallAudioTrackFreezeCandidateV21 {
	readonly trackId: string;
	readonly expectedFreeze: AudioTrackFreezeV1 | null;
	readonly replacementFreeze: AudioTrackFreezeV1;
	readonly derivedSource: unknown;
	readonly sourceContentIdentities: readonly Readonly<{
		readonly sourceId: string;
		readonly contentSha256: string;
	}>[];
}

export interface RemoveAudioTrackFreezeCandidateV21 {
	readonly trackId: string;
	readonly expectedFreeze: AudioTrackFreezeV1;
}

export interface CommitAudioTrackFreezeCandidateV21 {
	readonly trackId: string;
	readonly expectedFreeze: AudioTrackFreezeV1;
	readonly operationDigests: unknown;
	readonly derivedSourceContentSha256: string;
	readonly derivedClip: unknown;
}

type CandidateProject = Readonly<Record<string, unknown>>;
type DataRecord = Readonly<Record<string, unknown>>;

const INSTALL_FIELDS = Object.freeze([
	'trackId', 'expectedFreeze', 'replacementFreeze', 'derivedSource', 'sourceContentIdentities',
]);
const SOURCE_IDENTITY_FIELDS = Object.freeze(['sourceId', 'contentSha256']);
const REMOVE_FIELDS = Object.freeze(['trackId', 'expectedFreeze']);
const COMMIT_FIELDS = Object.freeze([
	'trackId', 'expectedFreeze', 'operationDigests', 'derivedSourceContentSha256', 'derivedClip',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_COLLECTION_ENTRIES = 100_000;
const MAXIMUM_SNAPSHOT_NODES = 250_000;
const DOCUMENT_BODY_FIELDS = new Set([
	'audioBuffer', 'base64', 'blob', 'bytes', 'channelData', 'chunks', 'data', 'payload', 'pcm',
]);

/** Install or refresh a verified freeze relationship using exact expected-state CAS. */
export function installAudioTrackFreezeCandidateV21(
	projectValue: CandidateProject,
	requestValue: InstallAudioTrackFreezeCandidateV21,
): CandidateProject {
	const project = inspectDataRecord(projectValue, 'audio freeze project');
	const request = readClosedDomainRecord(requestValue, 'audio freeze install candidate', INSTALL_FIELDS);
	const trackId = stableId(field(request, 'trackId', 'audio freeze install candidate'), 'audio track');
	const expectedValue = field(request, 'expectedFreeze', 'audio freeze install candidate');
	const expected = expectedValue === null ? null : normalizeAudioTrackFreezeV1(expectedValue);
	const replacement = normalizeAudioTrackFreezeV1(
		field(request, 'replacementFreeze', 'audio freeze install candidate'),
	);
	const target = targetAudioTrack(project, trackId);
	assertExpectedFreeze(target.track, expected, trackId);
	const sourceContentIdentities = normalizeSourceContentIdentities(
		project,
		target.track,
		field(request, 'sourceContentIdentities', 'audio freeze install candidate'),
	);
	const derivedSource = normalizeDerivedSource(
		field(request, 'derivedSource', 'audio freeze install candidate'), replacement, project,
	);
	const tracks = projectArray(project, 'tracks');
	const sources = projectArray(project, 'sources');
	const existingSourceIndex = exactRecordIndexById(sources, replacement.derivedSourceId, 'project source');
	const currentDerivedId = currentFreeze(target.track)?.derivedSourceId ?? null;
	if (existingSourceIndex !== -1 && replacement.derivedSourceId !== currentDerivedId) {
		throw new RangeError(`Derived source ID ${replacement.derivedSourceId} collides with an existing source.`);
	}
	if (existingSourceIndex !== -1 && sourceIdReferenced(project, replacement.derivedSourceId)) {
		throw new RangeError('A refresh cannot replace a derived source that is referenced by a canonical clip.');
	}
	const nextTrack = updateRecord(target.track, { audioFreeze: replacement });
	const nextTracks = replaceAt(tracks, target.index, nextTrack);
	let nextSources = sources
		.filter((_, index) => index !== existingSourceIndex)
		.map((candidate, index) => {
			const source = inspectDataRecord(candidate, `project source ${String(index)}`);
			const contentSha256 = sourceContentIdentities.get(recordId(source, `project source ${String(index)}`));
			return contentSha256 === undefined ? candidate : updateRecord(source, { contentSha256 });
		});
	if (currentDerivedId && currentDerivedId !== replacement.derivedSourceId
		&& !sourceIdReferenced(project, currentDerivedId)
		&& !freezeSourceReferenced(nextTracks, currentDerivedId)) {
		nextSources = nextSources.filter((source, index) => recordId(source, `project source ${String(index)}`) !== currentDerivedId);
	}
	nextSources.push(derivedSource);
	return updateRecord(project, {
		tracks: Object.freeze(nextTracks),
		sources: Object.freeze(nextSources),
	});
}

function normalizeSourceContentIdentities(
	project: DataRecord,
	track: DataRecord,
	value: unknown,
): ReadonlyMap<string, string> {
	const clips = projectArray(project, 'clips');
	const sources = projectArray(project, 'sources');
	const ownedSourceIds = new Set<string>();
	for (const clipId of uniqueIds(track.clipIds, `audio track ${String(track.id)}.clipIds`, 1)) {
		const clipIndex = exactRecordIndexById(clips, clipId, 'project clip');
		if (clipIndex === -1) throw new ReferenceError(`The frozen editable clip ${clipId} no longer exists.`);
		const clip = inspectDataRecord(clips[clipIndex], `project clip ${clipId}`);
		ownedSourceIds.add(stableId(clip.sourceId, `project clip ${clipId} source`));
	}
	const identities = readClosedDomainArray(
		value,
		'audio freeze source content identities',
		1,
		MAXIMUM_COLLECTION_ENTRIES,
	);
	const result = new Map<string, string>();
	for (const [index, candidate] of identities.entries()) {
		const record = readClosedDomainRecord(
			candidate,
			`audio freeze source content identity ${String(index)}`,
			SOURCE_IDENTITY_FIELDS,
		);
		const sourceId = stableId(
			field(record, 'sourceId', 'audio freeze source content identity'),
			'audio freeze source',
		);
		const contentSha256 = sha256Digest(
			field(record, 'contentSha256', 'audio freeze source content identity'),
			`audio source ${sourceId} content`,
		);
		if (result.has(sourceId)) throw new RangeError(`Audio freeze source identity ${sourceId} is duplicated.`);
		if (!ownedSourceIds.has(sourceId)) {
			throw new RangeError(`Audio freeze source identity ${sourceId} is outside the target track.`);
		}
		const sourceIndex = exactRecordIndexById(sources, sourceId, 'project source');
		if (sourceIndex === -1) throw new ReferenceError(`Audio freeze source ${sourceId} does not exist.`);
		const source = inspectDataRecord(sources[sourceIndex], `project source ${sourceId}`);
		if (Object.hasOwn(source, 'contentSha256') && source.contentSha256 !== contentSha256) {
			throw new Error(`Audio source ${sourceId} content digest changed before freeze installation.`);
		}
		result.set(sourceId, contentSha256);
	}
	if (result.size !== ownedSourceIds.size) {
		throw new RangeError('Audio freeze source identities do not cover the exact target track inputs.');
	}
	return result;
}

/** Remove one exact freeze relationship while leaving its retained editable rack and clips untouched. */
export function removeAudioTrackFreezeCandidateV21(
	projectValue: CandidateProject,
	requestValue: RemoveAudioTrackFreezeCandidateV21,
): CandidateProject {
	const project = inspectDataRecord(projectValue, 'audio freeze project');
	const request = readClosedDomainRecord(requestValue, 'audio freeze remove candidate', REMOVE_FIELDS);
	const trackId = stableId(field(request, 'trackId', 'audio freeze remove candidate'), 'audio track');
	const expected = normalizeAudioTrackFreezeV1(field(request, 'expectedFreeze', 'audio freeze remove candidate'));
	const target = targetAudioTrack(project, trackId);
	assertExpectedFreeze(target.track, expected, trackId);
	const tracks = projectArray(project, 'tracks');
	const nextTrack = updateRecord(target.track, {}, ['audioFreeze']);
	const nextTracks = replaceAt(tracks, target.index, nextTrack);
	let sources = projectArray(project, 'sources');
	if (!sourceIdReferenced(project, expected.derivedSourceId)
		&& !freezeSourceReferenced(nextTracks, expected.derivedSourceId)) {
		sources = sources.filter((source, index) => (
			recordId(source, `project source ${String(index)}`) !== expected.derivedSourceId
		));
	}
	return updateRecord(project, {
		tracks: Object.freeze(nextTracks),
		sources: Object.freeze(sources),
	});
}

/** Bake one fresh verified freeze into a neutral derived clip and clear only insert-rack authority. */
export function commitAudioTrackFreezeCandidateV21(
	projectValue: CandidateProject,
	requestValue: CommitAudioTrackFreezeCandidateV21,
): CandidateProject {
	const project = inspectDataRecord(projectValue, 'audio freeze project');
	const request = readClosedDomainRecord(requestValue, 'audio freeze commit candidate', COMMIT_FIELDS);
	const trackId = stableId(field(request, 'trackId', 'audio freeze commit candidate'), 'audio track');
	const expected = normalizeAudioTrackFreezeV1(field(request, 'expectedFreeze', 'audio freeze commit candidate'));
	const operationDigests = normalizeAudioTrackFreezeDigestsV1(
		field(request, 'operationDigests', 'audio freeze commit candidate'),
	);
	if (classifyAudioTrackFreezeFreshnessV1(expected, operationDigests).status !== 'fresh') {
		throw new Error('The audio track freeze is stale at commit digest admission.');
	}
	const expectedContentSha256 = sha256Digest(
		field(request, 'derivedSourceContentSha256', 'audio freeze commit candidate'),
		'derived source content',
	);
	const target = targetAudioTrack(project, trackId);
	assertExpectedFreeze(target.track, expected, trackId);
	const sources = projectArray(project, 'sources');
	const sourceIndex = exactRecordIndexById(sources, expected.derivedSourceId, 'project source');
	if (sourceIndex === -1) throw new ReferenceError('The frozen derived source no longer exists.');
	const source = inspectDataRecord(sources[sourceIndex], `derived source ${expected.derivedSourceId}`);
	if (source.contentSha256 !== expectedContentSha256) {
		throw new Error('The derived source content digest failed commit admission.');
	}
	const derivedClip = normalizeCommittedClip(
		field(request, 'derivedClip', 'audio freeze commit candidate'), expected,
	);
	const tracks = projectArray(project, 'tracks');
	const clips = projectArray(project, 'clips');
	const ownedClipIds = uniqueIds(target.track.clipIds, `audio track ${trackId}.clipIds`, 1);
	const ownedClipIdSet = new Set(ownedClipIds);
	const removedSourceIds = new Set<string>();
	for (const clipId of ownedClipIds) {
		const index = exactRecordIndexById(clips, clipId, 'project clip');
		if (index === -1) throw new ReferenceError(`The frozen editable clip ${clipId} no longer exists.`);
		const clip = inspectDataRecord(clips[index], `project clip ${clipId}`);
		removedSourceIds.add(stableId(clip.sourceId, `project clip ${clipId} source`));
	}
	const remainingClips = clips.filter((clip, index) => !ownedClipIdSet.has(recordId(clip, `project clip ${String(index)}`)));
	const derivedClipId = stableId(derivedClip.id, 'committed derived clip');
	if (exactRecordIndexById(remainingClips, derivedClipId, 'remaining project clip') !== -1) {
		throw new RangeError(`Committed derived clip ID ${derivedClipId} collides with an existing clip.`);
	}
	const nextClips = Object.freeze([...remainingClips, derivedClip]);
	const nextTrack = updateRecord(target.track, {
		clipIds: Object.freeze([derivedClipId]),
		effectsActive: true,
		effects: Object.freeze([]),
	}, ['audioFreeze']);
	const nextTracks = Object.freeze(replaceAt(tracks, target.index, nextTrack));
	const lanes = projectArray(project, 'automationLanes').map((lane) => normalizeAutomationLaneV21(lane));
	const nextLanes = Object.freeze(lanes.filter((lane) => !(
		lane.address.kind === 'effect' && lane.address.strip.kind === 'track'
		&& lane.address.strip.id === trackId
	)));
	const retainedSourceIds = clipSourceIds(nextClips);
	for (const sourceId of projectBinClipSourceIds(project)) retainedSourceIds.add(sourceId);
	const nextSources = Object.freeze(sources.filter((candidate, index) => {
		const sourceId = recordId(candidate, `project source ${String(index)}`);
		return !removedSourceIds.has(sourceId) || retainedSourceIds.has(sourceId)
			|| sourceId === expected.derivedSourceId;
	}));
	const replacements: Record<string, unknown> = {
		tracks: nextTracks,
		clips: nextClips,
		sources: nextSources,
		automationLanes: nextLanes,
	};
	const nextMixer = mixerWithoutCommittedRackSidechains(project, trackId);
	if (nextMixer !== undefined) replacements.mixer = nextMixer;
	return updateRecord(project, replacements);
}

function mixerWithoutCommittedRackSidechains(project: DataRecord, trackId: string): unknown {
	if (!Object.hasOwn(project, 'mixer')) return undefined;
	const value = inspectDataRecord(project.mixer, 'project.mixer');
	if (!Object.hasOwn(value, 'edges')) return project.mixer;
	const graph = normalizeMixerGraphV21(value);
	const edges = graph.edges.filter((edge) => edge.destination.kind !== 'effect-sidechain'
		|| edge.destination.strip.kind !== 'track'
		|| edge.destination.strip.id !== trackId);
	if (edges.length === graph.edges.length) return project.mixer;
	return normalizeMixerGraphV21({ ...graph, edges });
}

function normalizeDerivedSource(value: unknown, freeze: AudioTrackFreezeV1, project: DataRecord): DataRecord {
	const source = snapshotJsonRecord(value, 'audio freeze derived source');
	assertNoDocumentBodyFields(source, 'audio freeze derived source');
	if (source.id !== freeze.derivedSourceId) throw new RangeError('The derived source ID must match the freeze record.');
	if (source.kind !== 'audio') throw new RangeError('An audio freeze derived source must be audio.');
	sha256Digest(source.contentSha256, 'derived source content');
	if (source.frameCount !== freeze.renderFrameCount) {
		throw new RangeError('The derived source frame count must match the freeze render range.');
	}
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	if (source.sampleRate !== sampleRate) throw new RangeError('The derived source sample rate must match the project.');
	stableId(source.storageKey, 'derived source storage');
	positiveSafeInteger(source.channelCount, 'derived source channelCount');
	return source;
}

function normalizeCommittedClip(value: unknown, freeze: AudioTrackFreezeV1): DataRecord {
	const clip = snapshotJsonRecord(value, 'committed freeze clip');
	assertNoDocumentBodyFields(clip, 'committed freeze clip');
	if (clip.kind !== 'audio' || clip.sourceId !== freeze.derivedSourceId) {
		throw new RangeError('The committed freeze clip must reference the derived audio source.');
	}
	if (clip.anchor !== 'sample' || clip.timelineStartFrame !== freeze.renderStartFrame
		|| clip.durationFrames !== freeze.renderFrameCount
		|| clip.sourceStartFrame !== 0 || clip.sourceDurationFrames !== freeze.renderFrameCount) {
		throw new RangeError('The committed freeze clip range must match the complete rendered source.');
	}
	for (const [fieldName, expected] of [
		['trimStartFrames', 0], ['trimEndFrames', 0], ['gain', 1],
		['fadeInFrames', 0], ['fadeOutFrames', 0], ['reversed', false],
		['pitchCents', 0], ['speedRatio', 1],
	] as const) {
		if (clip[fieldName] !== expected) throw new RangeError(`The committed freeze clip.${fieldName} must be neutral.`);
	}
	if (!Array.isArray(clip.envelope) || clip.envelope.length !== 0) {
		throw new RangeError('The committed freeze clip envelope must be empty.');
	}
	stableId(clip.id, 'committed derived clip');
	return clip;
}

function targetAudioTrack(project: DataRecord, trackId: string): { readonly track: DataRecord; readonly index: number } {
	const tracks = projectArray(project, 'tracks');
	const matches: { track: DataRecord; index: number }[] = [];
	for (const [index, candidate] of tracks.entries()) {
		const track = inspectDataRecord(candidate, `project track ${String(index)}`);
		if (track.id === trackId) matches.push({ track, index });
	}
	if (matches.length !== 1) throw new ReferenceError(`Audio track ${trackId} must exist exactly once.`);
	const target = matches[0]!;
	if (target.track.type !== 'audio') throw new RangeError(`Track ${trackId} is not audio.`);
	return target;
}

function assertExpectedFreeze(track: DataRecord, expected: AudioTrackFreezeV1 | null, trackId: string): void {
	const current = currentFreeze(track);
	const matches = expected === null ? current === undefined
		: current !== undefined && sameAudioTrackFreezeV1(current, expected);
	if (!matches) throw new Error(`Audio track ${trackId} freeze state changed from the expected value.`);
}

function currentFreeze(track: DataRecord): AudioTrackFreezeV1 | undefined {
	return Object.hasOwn(track, 'audioFreeze') ? normalizeAudioTrackFreezeV1(track.audioFreeze) : undefined;
}

function sourceIdReferenced(project: DataRecord, sourceId: string): boolean {
	return clipSourceIds(projectArray(project, 'clips')).has(sourceId)
		|| projectBinClipSourceIds(project).has(sourceId);
}

function freezeSourceReferenced(tracks: readonly unknown[], sourceId: string): boolean {
	return tracks.some((candidate, index) => {
		const track = inspectDataRecord(candidate, `project track ${String(index)}`);
		return Object.hasOwn(track, 'audioFreeze') && currentFreeze(track)?.derivedSourceId === sourceId;
	});
}

function clipSourceIds(clips: readonly unknown[]): Set<string> {
	const result = new Set<string>();
	for (const [index, candidate] of clips.entries()) {
		const clip = inspectDataRecord(candidate, `project clip ${String(index)}`);
		result.add(stableId(clip.sourceId, `project clip ${String(index)} source`));
	}
	return result;
}

function projectBinClipSourceIds(project: DataRecord): Set<string> {
	if (!Object.hasOwn(project, 'projectBin')) return new Set<string>();
	const projectBin = inspectDataRecord(project.projectBin, 'project.projectBin');
	if (!Object.hasOwn(projectBin, 'clips')) return new Set<string>();
	return clipSourceIds(readClosedDomainArray(
		projectBin.clips, 'project.projectBin.clips', 0, MAXIMUM_COLLECTION_ENTRIES,
	));
}

function projectArray(project: DataRecord, name: string): unknown[] {
	return [...readClosedDomainArray(project[name], `project.${name}`, 0, MAXIMUM_COLLECTION_ENTRIES)];
}

function exactRecordIndexById(values: readonly unknown[], id: string, name: string): number {
	let match = -1;
	for (const [index, value] of values.entries()) {
		if (recordId(value, `${name} ${String(index)}`) !== id) continue;
		if (match !== -1) throw new RangeError(`${name} ID ${id} is duplicated.`);
		match = index;
	}
	return match;
}

function recordId(value: unknown, name: string): string {
	return stableId(inspectDataRecord(value, name).id, name);
}

function replaceAt(values: readonly unknown[], index: number, replacement: unknown): unknown[] {
	const result = [...values];
	result[index] = replacement;
	return result;
}

function updateRecord(value: DataRecord, fields: DataRecord, omitted: readonly string[] = []): DataRecord {
	const omittedSet = new Set(omitted);
	const output: Record<string, unknown> = Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>;
	for (const [key, entry] of Object.entries(value)) if (!omittedSet.has(key)) output[key] = entry;
	for (const [key, entry] of Object.entries(fields)) output[key] = entry;
	return Object.freeze(output);
}

function snapshotJsonRecord(value: unknown, name: string): DataRecord {
	const snapshot = snapshotJson(value, name, { remaining: MAXIMUM_SNAPSHOT_NODES }, new Set<object>());
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError(`${name} must be a record.`);
	return snapshot as DataRecord;
}

function snapshotJson(value: unknown, name: string, budget: { remaining: number }, seen: Set<object>): unknown {
	budget.remaining -= 1;
	if (budget.remaining < 0) throw new RangeError(`${name} exceeds the document snapshot budget.`);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${name} contains a noncanonical number.`);
		return value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new TypeError(`${name} must not be cyclic.`);
		seen.add(value);
		const input = readClosedDomainArray(value, name, 0, MAXIMUM_COLLECTION_ENTRIES);
		const output = input.map((entry, index) => snapshotJson(entry, `${name}[${String(index)}]`, budget, seen));
		seen.delete(value);
		return Object.freeze(output);
	}
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must contain only inert JSON document data.`);
	if (seen.has(value)) throw new TypeError(`${name} must not be cyclic.`);
	seen.add(value);
	const input = inspectDataRecord(value, name);
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(input)) output[key] = snapshotJson(input[key], `${name}.${key}`, budget, seen);
	seen.delete(value);
	return Object.freeze(output);
}

function inspectDataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} must contain only named own data properties.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
			throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
		}
		output[key] = descriptor.value;
	}
	return Object.freeze(output);
}

function assertNoDocumentBodyFields(record: DataRecord, name: string): void {
	const pending: { readonly value: unknown; readonly path: string }[] = [{ value: record, path: name }];
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (Array.isArray(current.value)) {
			for (const [index, entry] of current.value.entries()) {
				pending.push({ value: entry, path: `${current.path}[${String(index)}]` });
			}
			continue;
		}
		if (!current.value || typeof current.value !== 'object') continue;
		for (const [key, entry] of Object.entries(current.value as DataRecord)) {
			if (DOCUMENT_BODY_FIELDS.has(key)) {
				throw new TypeError(`${current.path} cannot contain PCM or binary payload field ${key}.`);
			}
			pending.push({ value: entry, path: `${current.path}.${key}` });
		}
	}
}

function uniqueIds(value: unknown, name: string, minimum: number): readonly string[] {
	const input = readClosedDomainArray(value, name, minimum, MAXIMUM_COLLECTION_ENTRIES);
	const output: string[] = [];
	const seen = new Set<string>();
	for (const [index, candidate] of input.entries()) {
		const id = stableId(candidate, `${name}[${String(index)}]`);
		if (seen.has(id)) throw new RangeError(`${name} contains duplicate ID ${id}.`);
		seen.add(id);
		output.push(id);
	}
	return Object.freeze(output);
}

function field(record: ClosedDomainRecord, name: string, label: string): unknown {
	return readClosedDomainField(record, name, label);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function sha256Digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
