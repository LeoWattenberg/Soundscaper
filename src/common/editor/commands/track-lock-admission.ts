/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './protocol.ts';
import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../runtime-clip-projection.ts';
import { isTrackLockProjectSchema } from '../project-schema-version.ts';

type DataRecord = Record<string, unknown>;
type SnapshotValue = unknown;
const BINARY_SNAPSHOT_BYTES = Symbol('track-lock-binary-snapshot-bytes');
const BINARY_SNAPSHOT_KIND = Symbol('track-lock-binary-snapshot-kind');

interface BinarySnapshot {
	readonly [BINARY_SNAPSHOT_BYTES]: Uint8Array;
	readonly [BINARY_SNAPSHOT_KIND]: 'array-buffer' | 'uint8-array';
}

interface TrackSnapshotContext {
	readonly project: DataRecord;
	readonly tracks: readonly DataRecord[];
	readonly clips: readonly DataRecord[];
	readonly clipById: ReadonlyMap<string, DataRecord>;
	readonly runtimeClipById: ReadonlyMap<string, DataRecord>;
	readonly runtimeTrackById: ReadonlyMap<string, DataRecord>;
	readonly sourceById: ReadonlyMap<string, DataRecord>;
}

interface TrackLockBaseline {
	readonly id: string;
	readonly raw: SnapshotValue;
	readonly final: SnapshotValue;
	readonly finalKind: 'persisted' | 'semantic';
}

export interface TrackLockAdmission {
	/** Reject destructive structural intent before its subject disappears or moves. */
	beforeCommand(project: unknown, command: AudioEditorCommand): void;
	/** Assert the raw command projection after every non-batch child and capture new locks. */
	afterCommand(project: unknown): void;
	/** Assert the fully reconciled persisted result before it leaves applyEditorCommand. */
	assertPersistedResult(project: unknown): void;
}

const NO_TRACK_LOCK_ADMISSION: Readonly<TrackLockAdmission> = Object.freeze({
	beforeCommand: () => undefined,
	afterCommand: () => undefined,
	assertPersistedResult: () => undefined,
});

const ALLOWED_TRACK_FIELDS = new Set([
	'locked',
	'name',
	'gain',
	'pan',
	'mute',
	'solo',
	'armed',
	'hidden',
	'displayMode',
	'color',
	'spectrogram',
	'envelope',
	'collapsed',
	'height',
	'effectsActive',
	'effects',
]);

const DERIVED_AUDIO_FIELDS = new Set([
	'timelineEndFrame', 'sourceEndFrame', 'sequenceStartFrame', 'sequenceEndFrame', 'coordinateDomain',
]);
const DERIVED_MUSICAL_AUDIO_FIELDS = new Set([
	'timelineStartFrame', 'timelineEndFrame', 'durationFrames', 'sourceEndFrame',
	'sequenceStartFrame', 'sequenceEndFrame', 'coordinateDomain',
]);
const DERIVED_VIDEO_FIELDS = new Set([
	'timelineStartFrame', 'timelineEndFrame', 'durationFrames',
	'sourceStartFrame', 'sourceEndFrame', 'sourceDurationFrames',
	'sequenceEndFrame', 'coordinateDomain',
]);

/**
 * Capture transaction-start locks and return the sole mutable admission context
 * for one top-level command. Newly locked IDs are added monotonically after the
 * child that established their baseline; unlocking never removes authority.
 */
export function createTrackLockAdmission(
	persistedBaseValue: unknown,
	commandProjectionValue: unknown,
): Readonly<TrackLockAdmission> {
	const persistedBase = record(persistedBaseValue, 'persisted project');
	if (!isTrackLockProjectSchema(persistedBase)) return NO_TRACK_LOCK_ADMISSION;
	const commandProjection = record(commandProjectionValue, 'command project');
	const baselines = new Map<string, TrackLockBaseline>();
	const initiallyLocked = records(persistedBase.tracks, 'project.tracks')
		.filter((track) => track.locked === true);
	if (initiallyLocked.length > 0) {
		const rawContext = createSnapshotContext(commandProjection);
		const persistedContext = createSnapshotContext(persistedBase);
		for (const track of initiallyLocked) {
			const id = stableId(track.id, 'track ID');
			baselines.set(id, Object.freeze({
				id,
				raw: protectedTrackSnapshot(rawContext, id, 'raw-full'),
				final: protectedTrackSnapshot(persistedContext, id, 'persisted-full'),
				finalKind: 'persisted',
			}));
		}
	}

	function beforeCommand(projectValue: unknown, command: AudioEditorCommand): void {
		if (command.type === 'batch' || baselines.size === 0) return;
		const project = record(projectValue, 'command project');
		let lockedId: string | null = null;
		switch (command.type) {
			case 'track/remove':
			case 'track/reorder':
				lockedId = firstLockedLaneMember(project, command.trackId, baselines);
				break;
			case 'track-node/move':
				lockedId = firstLockedNodeDescendant(
					project,
					command.nodeId,
					baselines,
					command.sequenceId,
				);
				break;
			case 'track-folder/remove':
				lockedId = firstLockedNodeDescendant(project, command.folderId, baselines);
				break;
			case 'take-comp/group-add':
			case 'take-comp/group-update':
			case 'take-comp/group-remove':
			case 'take-comp/flatten':
				lockedId = firstLockedTakeCompTrack(project, command, baselines);
				break;
			case 'audio-warp/set':
			case 'audio-warp/clear':
			case 'audio-warp/quantize':
				lockedId = firstLockedClipOwner(project, command.clipId, baselines);
				break;
			default:
				break;
		}
		if (lockedId !== null) refuseLockedTrack(lockedId);
	}

	function afterCommand(projectValue: unknown): void {
		const project = record(projectValue, 'command project');
		const tracks = records(project.tracks, 'project.tracks');
		const newlyLocked = tracks.filter((track) => (
			track.locked === true && !baselines.has(stableId(track.id, 'track ID'))
		));
		if (baselines.size === 0 && newlyLocked.length === 0) return;
		const context = createSnapshotContext(project);
		for (const baseline of baselines.values()) {
			const actual = protectedTrackSnapshot(context, baseline.id, 'raw-full');
			if (!sameSnapshot(actual, baseline.raw)) refuseLockedTrack(baseline.id);
		}
		for (const track of newlyLocked) {
			const id = stableId(track.id, 'track ID');
			baselines.set(id, Object.freeze({
				id,
				raw: protectedTrackSnapshot(context, id, 'raw-full'),
				final: protectedTrackSnapshot(context, id, 'raw-semantic'),
				finalKind: 'semantic',
			}));
		}
	}

	function assertPersistedResult(projectValue: unknown): void {
		if (baselines.size === 0) return;
		const project = record(projectValue, 'persisted project');
		const context = createSnapshotContext(project);
		for (const baseline of baselines.values()) {
			const actual = protectedTrackSnapshot(
				context,
				baseline.id,
				baseline.finalKind === 'persisted' ? 'persisted-full' : 'persisted-semantic',
			);
			if (!sameSnapshot(actual, baseline.final)) refuseLockedTrack(baseline.id);
		}
	}

	return Object.freeze({ beforeCommand, afterCommand, assertPersistedResult });
}

type SnapshotMode = 'raw-full' | 'persisted-full' | 'raw-semantic' | 'persisted-semantic';

function protectedTrackSnapshot(
	context: TrackSnapshotContext,
	trackId: string,
	mode: SnapshotMode,
): SnapshotValue {
	const { project } = context;
	const track = context.tracks.find((candidate) => candidate.id === trackId);
	if (!track) return Object.freeze({ missingTrack: trackId });
	const semantic = mode.endsWith('semantic');
	const raw = mode.startsWith('raw');
	const clipIds = stringArray(track.clipIds, `track ${trackId}.clipIds`);
	const clips = clipIds.map((clipId) => {
		const clip = context.clipById.get(clipId);
		if (!clip) return Object.freeze({ id: clipId, missing: true });
		const runtimeClip = context.runtimeClipById.get(clipId);
		return Object.freeze({
			id: clipId,
			data: semantic ? clipSemanticData(clip) : snapshotRecord(clip),
			resolved: clipResolvedSnapshot(clip, runtimeClip, raw),
		});
	});
	const labels = labelSnapshots(track, context.runtimeTrackById, trackId, semantic);
	const sourceIds = [...new Set(clipIds.flatMap((clipId) => {
		const clip = context.clipById.get(clipId);
		return typeof clip?.sourceId === 'string' ? [clip.sourceId] : [];
	}))].sort();
	const sources = sourceIds.map((sourceId) => {
		const source = context.sourceById.get(sourceId);
		return source
			? Object.freeze({ id: sourceId, data: sourceSnapshot(source) })
			: Object.freeze({ id: sourceId, missing: true });
	});
	return Object.freeze({
		track: protectedTrackData(track),
		locations: trackLocations(project, trackId),
		laneMembers: laneMembers(context.tracks, track),
		clips: Object.freeze(clips),
		labels,
		groups: relatedMemberships(context.clips, clipIds, 'groupId'),
		avLinks: relatedMemberships(context.clips, clipIds, 'avLinkId'),
		takeGroups: takeGraphSnapshot(project, trackId),
		sources: Object.freeze(sources),
	});
}

/**
 * A take group names its own track, so a locked track owns its take graph the
 * way it owns its clips. Without it here the generic after-command check - the
 * thing that keeps the lock closed against commands it has never heard of - was
 * blind to any command that moved a locked track's graph as a side effect,
 * which is precisely what the take-graph range planners do.
 */
function takeGraphSnapshot(project: DataRecord, trackId: string): SnapshotValue {
	if (!Array.isArray(project.takeGroups)) return Object.freeze([]);
	return Object.freeze(records(project.takeGroups, 'project.takeGroups')
		.filter((group) => group.trackId === trackId)
		.map((group) => snapshotRecord(group)));
}

function protectedTrackData(track: DataRecord): SnapshotValue {
	const result: DataRecord = {};
	for (const key of Object.keys(track).sort()) {
		if (ALLOWED_TRACK_FIELDS.has(key) || key === 'labels') continue;
		result[key] = snapshotValue(dataValue(track, key));
	}
	return Object.freeze(result);
}

function clipSemanticData(clip: DataRecord): SnapshotValue {
	const omitted = clip.kind === 'video'
		? DERIVED_VIDEO_FIELDS
		: clip.anchor === 'musical'
			? DERIVED_MUSICAL_AUDIO_FIELDS
			: DERIVED_AUDIO_FIELDS;
	return snapshotRecordWithout(clip, omitted);
}

function clipResolvedSnapshot(
	clip: DataRecord,
	runtimeClip: DataRecord | undefined,
	raw: boolean,
): SnapshotValue {
	const resolved = raw && clip.kind === 'video' ? clip : runtimeClip ?? clip;
	return Object.freeze({
		timelineStartFrame: snapshotValue(resolved.timelineStartFrame),
		durationFrames: snapshotValue(resolved.durationFrames),
		sourceStartFrame: snapshotValue(resolved.sourceStartFrame),
		sourceDurationFrames: snapshotValue(resolved.sourceDurationFrames),
	});
}

function labelSnapshots(
	track: DataRecord,
	runtimeTrackById: ReadonlyMap<string, DataRecord>,
	trackId: string,
	semantic: boolean,
): SnapshotValue {
	if (track.type !== 'label') return Object.freeze([]);
	const runtimeTrack = runtimeTrackById.get(trackId);
	const runtimeLabels = indexById(records(runtimeTrack?.labels ?? [], 'runtime labels'), 'runtime label');
	return Object.freeze(records(track.labels, `track ${trackId}.labels`).map((label) => {
		const id = stableId(label.id, 'label ID');
		const resolved = runtimeLabels.get(id) ?? label;
		const data = semantic && label.anchor === 'musical'
			? snapshotRecordWithout(label, new Set(['startFrame', 'endFrame', 'coordinateDomain']))
			: snapshotRecord(label);
		return Object.freeze({
			id,
			data,
			resolved: Object.freeze({
				startFrame: snapshotValue(resolved.startFrame),
				endFrame: snapshotValue(resolved.endFrame),
			}),
		});
	}));
}

function sourceSnapshot(source: DataRecord): SnapshotValue {
	return source.kind === 'video'
		? snapshotRecordWithout(source, new Set(['frameCount']))
		: snapshotRecord(source);
}

function trackLocations(project: DataRecord, trackId: string): SnapshotValue {
	const locations: SnapshotValue[] = [];
	for (const sequence of records(project.sequences, 'project.sequences')) {
		const nodes = records(sequence.trackNodes, `sequence ${String(sequence.id)}.trackNodes`);
		const node = nodes.find((candidate) => candidate.kind === 'track' && candidate.id === trackId);
		if (!node) continue;
		const folders = new Map(nodes
			.filter((candidate) => candidate.kind === 'folder')
			.map((candidate) => [String(candidate.id), candidate]));
		const ancestors: string[] = [];
		let parentId = optionalId(node.parentFolderId);
		const visited = new Set<string>();
		while (parentId !== null) {
			if (visited.has(parentId)) break;
			visited.add(parentId);
			ancestors.unshift(parentId);
			parentId = optionalId(folders.get(parentId)?.parentFolderId);
		}
		locations.push(Object.freeze({
			sequenceId: snapshotValue(sequence.id),
			parentFolderId: optionalId(node.parentFolderId),
			ancestors: Object.freeze(ancestors),
		}));
	}
	return Object.freeze(locations);
}

function laneMembers(tracks: readonly DataRecord[], track: DataRecord): SnapshotValue {
	const laneGroupId = optionalId(track.laneGroupId);
	if (laneGroupId === null) return Object.freeze([]);
	return Object.freeze(tracks
		.filter((candidate) => candidate.laneGroupId === laneGroupId)
		.map((candidate) => Object.freeze({ id: snapshotValue(candidate.id), type: snapshotValue(candidate.type) })));
}

function relatedMemberships(
	clips: readonly DataRecord[],
	ownedClipIds: readonly string[],
	field: 'groupId' | 'avLinkId',
): SnapshotValue {
	const owned = new Set(ownedClipIds);
	const relationshipIds = [...new Set(clips
		.filter((clip) => owned.has(String(clip.id)) && typeof clip[field] === 'string')
		.map((clip) => String(clip[field])))].sort();
	return Object.freeze(relationshipIds.map((relationshipId) => Object.freeze({
		id: relationshipId,
		members: Object.freeze(clips
			.filter((clip) => clip[field] === relationshipId)
			.map((clip) => stableId(clip.id, 'clip ID'))
			.sort()),
	})));
}

function firstLockedLaneMember(
	project: DataRecord,
	trackId: string,
	baselines: ReadonlyMap<string, TrackLockBaseline>,
): string | null {
	const tracks = records(project.tracks, 'project.tracks');
	const requested = tracks.find((track) => track.id === trackId);
	if (!requested) return null;
	const laneGroupId = optionalId(requested.laneGroupId);
	const affected = laneGroupId === null
		? [requested]
		: tracks.filter((track) => track.laneGroupId === laneGroupId);
	return affected.map((track) => String(track.id)).find((id) => baselines.has(id)) ?? null;
}

function firstLockedNodeDescendant(
	project: DataRecord,
	nodeId: string,
	baselines: ReadonlyMap<string, TrackLockBaseline>,
	sequenceId?: string,
): string | null {
	for (const sequence of records(project.sequences, 'project.sequences')) {
		if (sequenceId !== undefined && sequence.id !== sequenceId) continue;
		const nodes = records(sequence.trackNodes, `sequence ${String(sequence.id)}.trackNodes`);
		const parentByNodeId = new Map(nodes.map((node) => [String(node.id), optionalId(node.parentFolderId)]));
		for (const node of nodes) {
			const trackId = String(node.id);
			if (node.kind !== 'track' || !baselines.has(trackId)) continue;
			if (trackId === nodeId) return trackId;
			let parentId = parentByNodeId.get(trackId) ?? null;
			const visited = new Set<string>();
			while (parentId !== null && !visited.has(parentId)) {
				if (parentId === nodeId) return trackId;
				visited.add(parentId);
				parentId = parentByNodeId.get(parentId) ?? null;
			}
		}
	}
	return null;
}

function firstLockedTakeCompTrack(
	project: DataRecord,
	command: Extract<AudioEditorCommand, { readonly type: `take-comp/${string}` }>,
	baselines: ReadonlyMap<string, TrackLockBaseline>,
): string | null {
	const affected: string[] = [];
	if (command.type === 'take-comp/group-add' || command.type === 'take-comp/group-update') {
		const group = record(command.group, 'take comp command group');
		affected.push(stableId(dataValue(group, 'trackId'), 'take comp track ID'));
	}
	if (command.type !== 'take-comp/group-add') {
		const groupId = stableId(command.groupId, 'take group ID');
		const takeGroups = Array.isArray(project.takeGroups)
			? records(project.takeGroups, 'project.takeGroups')
			: [];
		const current = takeGroups.find((group) => group.id === groupId);
		if (current) affected.push(stableId(dataValue(current, 'trackId'), 'take comp track ID'));
	}
	return affected.find((trackId) => baselines.has(trackId)) ?? null;
}

function firstLockedClipOwner(
	project: DataRecord,
	clipId: string,
	baselines: ReadonlyMap<string, TrackLockBaseline>,
): string | null {
	for (const track of records(project.tracks, 'project.tracks')) {
		const clipIds = stringArray(track.clipIds, `track ${String(track.id)}.clipIds`);
		const trackId = stableId(track.id, 'track ID');
		if (clipIds.includes(clipId) && baselines.has(trackId)) return trackId;
	}
	return null;
}

function runtimeSnapshot(project: DataRecord): DataRecord {
	return resolveRuntimeProjectProjection(project as RuntimeClipProject) as unknown as DataRecord;
}

function createSnapshotContext(project: DataRecord): TrackSnapshotContext {
	const runtime = runtimeSnapshot(project);
	const tracks = records(project.tracks, 'project.tracks');
	const clips = records(project.clips, 'project.clips');
	return Object.freeze({
		project,
		tracks,
		clips,
		clipById: indexById(clips, 'clip'),
		runtimeClipById: indexById(records(runtime.clips, 'runtime clips'), 'runtime clip'),
		runtimeTrackById: indexById(records(runtime.tracks, 'runtime tracks'), 'runtime track'),
		sourceById: indexById(records(project.sources, 'project.sources'), 'source'),
	});
}

function indexById(values: readonly DataRecord[], name: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const value of values) result.set(stableId(value.id, `${name} ID`), value);
	return result;
}

function snapshotRecord(value: DataRecord): SnapshotValue {
	return snapshotRecordWithout(value, new Set());
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
	return snapshotRecord(record(value, 'snapshot value'));
}

function sameSnapshot(left: SnapshotValue, right: SnapshotValue): boolean {
	if (Object.is(left, right)) return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftBytes = binarySnapshotBytes(left);
	const rightBytes = binarySnapshotBytes(right);
	if (leftBytes !== null || rightBytes !== null) {
		return leftBytes !== null && rightBytes !== null
			&& binarySnapshotKind(left) === binarySnapshotKind(right)
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

function binarySnapshot(
	value: Uint8Array,
	kind: BinarySnapshot[typeof BINARY_SNAPSHOT_KIND],
): BinarySnapshot {
	return Object.freeze({
		[BINARY_SNAPSHOT_BYTES]: new Uint8Array(value),
		[BINARY_SNAPSHOT_KIND]: kind,
	});
}

function binarySnapshotBytes(value: object): Uint8Array | null {
	if (!Object.hasOwn(value, BINARY_SNAPSHOT_BYTES)) return null;
	return (value as BinarySnapshot)[BINARY_SNAPSHOT_BYTES];
}

function binarySnapshotKind(value: object): BinarySnapshot[typeof BINARY_SNAPSHOT_KIND] | null {
	if (!Object.hasOwn(value, BINARY_SNAPSHOT_KIND)) return null;
	return (value as BinarySnapshot)[BINARY_SNAPSHOT_KIND];
}

function dataValue(value: DataRecord, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Track-lock snapshots require ${key} to be an own data property.`);
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

function stringArray(value: unknown, name: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== 'string')) {
		throw new TypeError(`${name} must be an array of strings.`);
	}
	return value as string[];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function optionalId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function refuseLockedTrack(trackId: string): never {
	throw new RangeError(`Track ${trackId} is locked.`);
}
