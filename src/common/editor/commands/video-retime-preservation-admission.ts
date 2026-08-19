/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './protocol.ts';
import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../runtime-clip-projection.ts';
import { isVideoRetimeCurveProjectSchema } from '../project-schema-version.ts';

type DataRecord = Record<string, unknown>;
type SnapshotValue = unknown;
type ClipStore = 'timeline' | 'project-bin';

const DERIVED_VIDEO_FIELDS = new Set([
	'timelineStartFrame', 'timelineEndFrame', 'durationFrames',
	'sourceStartFrame', 'sourceEndFrame', 'sourceDurationFrames',
	'sequenceEndFrame', 'coordinateDomain',
]);
const BINARY_BYTES = Symbol('video-retime-preservation-bytes');
const BINARY_KIND = Symbol('video-retime-preservation-kind');

interface BinarySnapshot {
	readonly [BINARY_BYTES]: Uint8Array;
	readonly [BINARY_KIND]: 'array-buffer' | 'uint8-array';
}

interface ClipEntry {
	readonly id: string;
	readonly store: ClipStore;
	readonly clip: DataRecord;
}

interface SnapshotContext {
	readonly project: DataRecord;
	readonly entries: readonly ClipEntry[];
	readonly runtimeByKey: ReadonlyMap<string, DataRecord>;
	readonly sourceById: ReadonlyMap<string, DataRecord>;
}

interface RetimeBaseline {
	readonly id: string;
	readonly raw: SnapshotValue;
	readonly persisted: SnapshotValue;
}

export interface VideoRetimePreservationAdmission {
	beforeCommand(project: unknown, command: AudioEditorCommand): void;
	afterCommand(project: unknown): void;
	assertPersistedResult(project: unknown): void;
}

const NO_ADMISSION: Readonly<VideoRetimePreservationAdmission> = Object.freeze({
	beforeCommand: () => undefined,
	afterCommand: () => undefined,
	assertPersistedResult: () => undefined,
});

/** Freeze every transaction-start V16 retime curve while authoring is unavailable. */
export function createVideoRetimePreservationAdmission(
	persistedBaseValue: unknown,
	commandProjectionValue: unknown,
): Readonly<VideoRetimePreservationAdmission> {
	const persistedBase = record(persistedBaseValue, 'persisted project');
	if (!isVideoRetimeCurveProjectSchema(persistedBase.schemaVersion)) return NO_ADMISSION;
	const commandProjection = record(commandProjectionValue, 'command project');
	const persistedContext = createContext(persistedBase, false);
	const rawContext = createContext(commandProjection, true);
	const persistedEntries = retimedEntries(persistedContext.entries);
	const rawEntries = retimedEntries(rawContext.entries);
	assertSameProtectedIds(persistedEntries, rawEntries);
	const baselines = new Map<string, RetimeBaseline>();
	for (const entry of persistedEntries.values()) {
		const rawEntry = rawEntries.get(entry.id);
		if (!rawEntry) refuse(entry.id);
		baselines.set(entry.id, Object.freeze({
			id: entry.id,
			raw: protectedClipSnapshot(rawContext, rawEntry),
			persisted: protectedClipSnapshot(persistedContext, entry),
		}));
	}
	const protectedSourceIds = new Set([...baselines.keys()].map((id) => {
		const entry = persistedEntries.get(id);
		return entry ? stableId(dataValue(entry.clip, 'sourceId'), `clip ${id}.sourceId`) : '';
	}).filter(Boolean));

	function beforeCommand(_projectValue: unknown, command: AudioEditorCommand): void {
		if (commandIntroducesRetimeState(command)) refuseSet();
		const subject = protectedCommandSubject(command, baselines, protectedSourceIds);
		if (subject !== null) refuse(subject);
	}

	function afterCommand(projectValue: unknown): void {
		assertContext(createContext(record(projectValue, 'command project'), true), 'raw');
	}

	function assertPersistedResult(projectValue: unknown): void {
		assertContext(createContext(record(projectValue, 'persisted project'), false), 'persisted');
	}

	function assertContext(context: SnapshotContext, mode: 'raw' | 'persisted'): void {
		const actualEntries = retimedEntries(context.entries);
		if (actualEntries.size !== baselines.size) refuseSet();
		for (const baseline of baselines.values()) {
			const entry = actualEntries.get(baseline.id);
			if (!entry) refuse(baseline.id);
			const expected = mode === 'raw' ? baseline.raw : baseline.persisted;
			if (!sameSnapshot(protectedClipSnapshot(context, entry), expected)) refuse(baseline.id);
		}
	}

	return Object.freeze({ beforeCommand, afterCommand, assertPersistedResult });
}

function commandIntroducesRetimeState(command: AudioEditorCommand): boolean {
	switch (command.type) {
		case 'clip/add':
		case 'project-bin/add':
			return hasV2RetimeMap(command.clip);
		case 'clip/update':
		case 'project-bin/update':
			return hasV2RetimeMap(command.changes);
		case 'clip/overwrite':
			return hasV2RetimeMap(command.changes);
		case 'clip/transform-many':
			return command.transforms.some(({ changes }) => hasV2RetimeMap(changes));
		case 'project-bin/place':
			return command.placements?.some(hasV2RetimeMap) ?? false;
		case 'project-bin/replace-media':
			return command.templates?.some(hasV2RetimeMap) ?? false;
		case 'clipboard/paste':
			return command.clipboard.tracks.some((track) => track.clips.some(hasV2RetimeMap));
		default:
			return false;
	}
}

function hasV2RetimeMap(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'retimeMap');
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
	const retimeMap = descriptor.value;
	if (!retimeMap || typeof retimeMap !== 'object' || Array.isArray(retimeMap)) return false;
	const feature = Object.getOwnPropertyDescriptor(retimeMap, 'feature');
	const version = Object.getOwnPropertyDescriptor(retimeMap, 'version');
	return Object.hasOwn(feature ?? {}, 'value') && feature?.value === 'video-retime'
		&& Object.hasOwn(version ?? {}, 'value') && version?.value === 2;
}

function protectedClipSnapshot(context: SnapshotContext, entry: ClipEntry): SnapshotValue {
	const { clip, id, store } = entry;
	const sourceId = stableId(dataValue(clip, 'sourceId'), `clip ${id}.sourceId`);
	const source = context.sourceById.get(sourceId);
	const runtime = context.runtimeByKey.get(entryKey(store, id));
	const groupId = optionalId(clip.groupId);
	const avLinkId = optionalId(clip.avLinkId);
	const binItemId = optionalId(clip.binItemId);
	return Object.freeze({
		id,
		store,
		clip: snapshotRecordWithout(clip, DERIVED_VIDEO_FIELDS),
		resolved: resolvedSnapshot(runtime ?? clip),
		source: source ? snapshotRecordWithout(source, new Set(['frameCount'])) : Object.freeze({ missing: sourceId }),
		owner: store === 'timeline'
			? timelineOwnerSnapshot(context.project, id, clip)
			: Object.freeze({
				binItemId,
				members: relatedBinMembers(context.entries, binItemId),
			}),
		groupMembers: relationshipMembers(context.entries, 'groupId', groupId),
		avLinkMembers: relationshipMembers(context.entries, 'avLinkId', avLinkId),
	});
}

function timelineOwnerSnapshot(project: DataRecord, clipId: string, clip: DataRecord): SnapshotValue {
	const tracks = records(project.tracks, 'project.tracks');
	const owners = tracks.filter((track) => stringArray(track.clipIds).includes(clipId));
	const sequenceId = stableId(dataValue(clip, 'sequenceId'), `clip ${clipId}.sequenceId`);
	const sequence = records(project.sequences, 'project.sequences')
		.find((candidate) => candidate.id === sequenceId);
	return Object.freeze({
		trackIds: Object.freeze(owners.map((track) => stableId(track.id, 'track ID')).sort()),
		sequenceId,
		sequenceRate: sequence ? snapshotValue(dataValue(sequence, 'rate')) : Object.freeze({ missing: sequenceId }),
	});
}

function relationshipMembers(
	entries: readonly ClipEntry[],
	field: 'groupId' | 'avLinkId',
	value: string | null,
): SnapshotValue {
	if (value === null) return Object.freeze([]);
	return Object.freeze(entries
		.filter((entry) => entry.clip[field] === value)
		.map((entry) => entryKey(entry.store, entry.id))
		.sort());
}

function relatedBinMembers(entries: readonly ClipEntry[], binItemId: string | null): SnapshotValue {
	if (binItemId === null) return Object.freeze([]);
	return Object.freeze(entries
		.filter((entry) => entry.store === 'project-bin' && entry.clip.binItemId === binItemId)
		.map((entry) => entry.id)
		.sort());
}

function resolvedSnapshot(value: DataRecord): SnapshotValue {
	return Object.freeze({
		timelineStartFrame: snapshotValue(value.timelineStartFrame),
		durationFrames: snapshotValue(value.durationFrames),
		sourceStartFrame: snapshotValue(value.sourceStartFrame),
		sourceDurationFrames: snapshotValue(value.sourceDurationFrames),
		sequenceStartFrame: snapshotValue(value.sequenceStartFrame),
		sequenceFrameCount: snapshotValue(value.sequenceFrameCount),
		sourceInFrame: snapshotValue(value.sourceInFrame),
		sourceFrameCount: snapshotValue(value.sourceFrameCount),
	});
}

function createContext(project: DataRecord, raw: boolean): SnapshotContext {
	const entries = clipEntries(project);
	const protectedEntries = entries.filter((entry) => isV2VideoRetime(entry.clip));
	const runtimeByKey = raw
		? new Map(protectedEntries.map((entry) => [entryKey(entry.store, entry.id), entry.clip]))
		: new Map(protectedEntries.map((entry) => [
			entryKey(entry.store, entry.id),
			resolveRuntimeClipProjection(
				project as RuntimeClipProject,
				entry.clip,
			) as unknown as DataRecord,
		]));
	return Object.freeze({
		project,
		entries,
		runtimeByKey,
		sourceById: new Map(records(project.sources, 'project.sources')
			.map((source) => [stableId(source.id, 'source ID'), source])),
	});
}

function clipEntries(project: DataRecord): readonly ClipEntry[] {
	const timeline = records(project.clips, 'project.clips').map((clip) => Object.freeze({
		id: stableId(clip.id, 'clip ID'), store: 'timeline' as const, clip,
	}));
	const projectBin = record(project.projectBin, 'project.projectBin');
	const bin = records(projectBin.clips, 'project.projectBin.clips').map((clip) => Object.freeze({
		id: stableId(clip.id, 'Project Bin clip ID'), store: 'project-bin' as const, clip,
	}));
	const entries = [...timeline, ...bin];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry.id)) throw new RangeError(`Duplicate media clip ID: ${entry.id}.`);
		seen.add(entry.id);
	}
	return Object.freeze(entries);
}

function retimedEntries(entries: readonly ClipEntry[]): ReadonlyMap<string, ClipEntry> {
	return new Map(entries.filter((entry) => isV2VideoRetime(entry.clip)).map((entry) => [entry.id, entry]));
}

function isV2VideoRetime(clip: DataRecord): boolean {
	if (dataValue(clip, 'kind') !== 'video') return false;
	const value = dataValue(clip, 'retimeMap');
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as DataRecord;
	return dataValue(candidate, 'feature') === 'video-retime' && dataValue(candidate, 'version') === 2;
}

function assertSameProtectedIds(
	left: ReadonlyMap<string, ClipEntry>,
	right: ReadonlyMap<string, ClipEntry>,
): void {
	if (left.size !== right.size || [...left.keys()].some((id) => !right.has(id))) refuseSet();
}

function protectedCommandSubject(
	command: AudioEditorCommand,
	clips: ReadonlyMap<string, RetimeBaseline>,
	sources: ReadonlySet<string>,
): string | null {
	const protectedClip = (id: unknown): string | null => typeof id === 'string' && clips.has(id) ? id : null;
	const protectedClips = (ids: readonly string[] | undefined): string | null => (
		ids?.find((id) => clips.has(id)) ?? null
	);
	switch (command.type) {
		case 'source/remove':
		case 'source/update':
		case 'source/reprobe':
		case 'source/rewrite-media':
			return sources.has(command.sourceId) ? command.sourceId : null;
		case 'project-bin/move-from-timeline':
		case 'clip/remove-many':
		case 'clip/group':
		case 'clip/ungroup':
		case 'clip/join':
			return protectedClips(command.clipIds);
		case 'project-bin/place':
			return protectedClip(command.binClipId);
		case 'project-bin/update':
		case 'project-bin/remove':
		case 'project-bin/remove-from-project':
		case 'project-bin/replace-media':
		case 'clip/remove':
		case 'clip/update':
		case 'clip/replace-source':
		case 'clip/move':
		case 'clip/overwrite':
		case 'clip/trim':
		case 'clip/split':
		case 'clip/unlink-av':
		case 'video-effect/add':
		case 'video-effect/update':
		case 'video-effect/remove':
		case 'video-effect/reorder':
			return protectedClip(command.clipId);
		case 'clip/link-av':
			return protectedClip(command.videoClipId) ?? protectedClip(command.audioClipId);
		case 'clip/transform-many':
			return protectedClips(command.transforms.map(({ clipId }) => clipId));
		case 'clip/render-replace-many':
			return protectedClips(command.entries.map(({ clipId }) => clipId));
		default:
			return null;
	}
}

function snapshotRecordWithout(value: DataRecord, omitted: ReadonlySet<string>): SnapshotValue {
	const result: DataRecord = {};
	for (const key of Object.keys(value).sort()) {
		if (omitted.has(key)) continue;
		result[key] = snapshotValue(dataValue(value, key));
	}
	return Object.freeze(result);
}

function snapshotValue(value: unknown): SnapshotValue {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Uint8Array) return binarySnapshot(value, 'uint8-array');
	if (value instanceof ArrayBuffer) return binarySnapshot(new Uint8Array(value), 'array-buffer');
	if (Array.isArray(value)) return Object.freeze(value.map(snapshotValue));
	return snapshotRecordWithout(record(value, 'snapshot value'), new Set());
}

function sameSnapshot(left: SnapshotValue, right: SnapshotValue): boolean {
	if (Object.is(left, right)) return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftBytes = binaryBytes(left);
	const rightBytes = binaryBytes(right);
	if (leftBytes !== null || rightBytes !== null) {
		return leftBytes !== null && rightBytes !== null
			&& binaryKind(left) === binaryKind(right)
			&& leftBytes.byteLength === rightBytes.byteLength
			&& leftBytes.every((value, index) => value === rightBytes[index]);
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right)
			&& left.length === right.length
			&& left.every((value, index) => sameSnapshot(value, right[index]));
	}
	const leftRecord = left as DataRecord;
	const rightRecord = right as DataRecord;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key, index) => key === rightKeys[index]
			&& sameSnapshot(dataValue(leftRecord, key), dataValue(rightRecord, key)));
}

function binarySnapshot(value: Uint8Array, kind: BinarySnapshot[typeof BINARY_KIND]): BinarySnapshot {
	return Object.freeze({ [BINARY_BYTES]: new Uint8Array(value), [BINARY_KIND]: kind });
}

function binaryBytes(value: object): Uint8Array | null {
	return Object.hasOwn(value, BINARY_BYTES) ? (value as BinarySnapshot)[BINARY_BYTES] : null;
}

function binaryKind(value: object): BinarySnapshot[typeof BINARY_KIND] | null {
	return Object.hasOwn(value, BINARY_KIND) ? (value as BinarySnapshot)[BINARY_KIND] : null;
}

function dataValue(value: DataRecord, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Video-retime preservation requires ${key} to be an own data property.`);
	}
	return descriptor.value;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => record(candidate, `${name}[${String(index)}]`));
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== 'string')) return [];
	return value as string[];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function optionalId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function entryKey(store: ClipStore, id: string): string {
	return `${store}:${id}`;
}

function refuse(clipId: string): never {
	throw new RangeError(`Video retime state for ${clipId} is protected while retime authoring is unavailable.`);
}

function refuseSet(): never {
	throw new RangeError('Video retime state is protected while retime authoring is unavailable.');
}
