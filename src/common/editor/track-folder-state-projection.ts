/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TRACK_HIERARCHY_V12_LIMITS,
	validateTrackHierarchyV12,
	type TrackHierarchySequenceV12,
} from './track-hierarchy-v12.ts';
import type { TrackFolderV12 } from './track-folder-v12.ts';

export interface TrackFolderStateAudioTrackV12 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio';
	readonly laneGroupId?: string | null;
	readonly mute: boolean;
	readonly solo: boolean;
}

export interface TrackFolderStateVideoTrackV12 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'video';
	readonly laneGroupId?: string | null;
	readonly hidden: boolean;
}

export interface TrackFolderStateLabelTrackV12 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'label';
	readonly laneGroupId?: string | null;
}

export type TrackFolderStateTrackV12 =
	| TrackFolderStateAudioTrackV12
	| TrackFolderStateVideoTrackV12
	| TrackFolderStateLabelTrackV12;

export interface TrackFolderStateProjectionContextV12 {
	readonly trackFolders: readonly TrackFolderV12[];
	readonly tracks: readonly TrackFolderStateTrackV12[];
}

interface TrackFolderNodeStateV12 {
	readonly id: string;
	readonly sequenceId: string;
	readonly parentFolderId: string | null;
	readonly ancestorFolderIds: readonly string[];
	readonly depth: number;
	readonly rowHidden: boolean;
}

export interface TrackFolderFolderStateV12 extends TrackFolderNodeStateV12 {
	readonly kind: 'folder';
	readonly collapsed: boolean;
	readonly hidden: boolean;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly hasAudioDescendant: boolean;
}

interface TrackFolderLeafStateV12 extends TrackFolderNodeStateV12 {
	readonly kind: 'track';
	readonly laneGroupId: string | null;
}

export interface TrackFolderAudioStateV12 extends TrackFolderLeafStateV12 {
	readonly type: 'audio';
	readonly mute: boolean;
	readonly solo: boolean;
	readonly effectiveMuted: boolean;
	readonly effectiveSoloed: boolean;
}

export interface TrackFolderVideoStateV12 extends TrackFolderLeafStateV12 {
	readonly type: 'video';
	readonly hidden: boolean;
	readonly effectiveHidden: boolean;
}

export interface TrackFolderLabelStateV12 extends TrackFolderLeafStateV12 {
	readonly type: 'label';
}

export type TrackFolderStateNodeV12 =
	| TrackFolderFolderStateV12
	| TrackFolderAudioStateV12
	| TrackFolderVideoStateV12
	| TrackFolderLabelStateV12;

export interface TrackFolderSequenceStateV12 {
	readonly sequenceId: string;
	readonly nodes: readonly TrackFolderStateNodeV12[];
}

export interface TrackFolderStateProjectionV12 {
	readonly structuralSoloActive: boolean;
	readonly sequences: readonly TrackFolderSequenceStateV12[];
}

type DataRecord = Record<string, unknown>;

interface CanonicalTrackState {
	readonly id: string;
	readonly type: TrackFolderStateTrackV12['type'];
	readonly laneGroupId: string | null;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly hidden: boolean;
}

interface PendingNodeState {
	readonly kind: 'folder' | 'track';
	readonly id: string;
	readonly sequenceId: string;
	readonly parentFolderId: string | null;
	readonly ancestorFolderIds: readonly string[];
	readonly depth: number;
	readonly rowHidden: boolean;
}

const CONTEXT_KEYS: ReadonlySet<string> = new Set(['trackFolders', 'tracks']);

/**
 * Derive the non-persisted nested-folder state for an exact V12 hierarchy.
 *
 * Folder mute, solo, hidden, and collapse remain separate domains. Structural
 * solo exclusion stays separate from effective mute so a routing consumer can
 * also account for its own solo state. The input hierarchy, local flags, and
 * any opaque track extensions (including routing records) are never changed.
 */
export function deriveTrackFolderStateProjectionV12(
	hierarchyValue: unknown,
	contextValue: unknown,
): TrackFolderStateProjectionV12 {
	const context = closedDataRecord(contextValue, CONTEXT_KEYS, 'track folder state context');
	const tracks = canonicalTrackStates(context.tracks);
	const hierarchyContext = {
		trackFolders: context.trackFolders,
		tracks: tracks.map(({ id, type, laneGroupId }) => ({ id, type, laneGroupId })),
	};
	validateTrackHierarchyV12(hierarchyValue, hierarchyContext);
	const hierarchy = hierarchyValue as readonly TrackHierarchySequenceV12[];
	const folders = context.trackFolders as readonly TrackFolderV12[];
	const folderById = new Map(folders.map((folder) => [folder.id, folder]));
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	const audioDescendantFolderIds = new Set<string>();
	const pendingSequences = hierarchy.map((sequence) => analyzeSequence(
		sequence,
		folderById,
		trackById,
		audioDescendantFolderIds,
	));
	const structuralSoloActive = tracks.some((track) => track.type === 'audio' && track.solo)
		|| folders.some((folder) => folder.solo && audioDescendantFolderIds.has(folder.id));
	const sequences = pendingSequences.map(({ sequenceId, nodes }) => Object.freeze({
		sequenceId,
		nodes: Object.freeze(nodes.map((node) => projectNodeState(
			node,
			folderById,
			trackById,
			audioDescendantFolderIds,
		))),
	}));
	return Object.freeze({
		structuralSoloActive,
		sequences: Object.freeze(sequences),
	});
}

function analyzeSequence(
	sequence: TrackHierarchySequenceV12,
	folderById: ReadonlyMap<string, TrackFolderV12>,
	trackById: ReadonlyMap<string, CanonicalTrackState>,
	audioDescendantFolderIds: Set<string>,
): Readonly<{ sequenceId: string; nodes: readonly PendingNodeState[] }> {
	const activeFolderIds: string[] = [];
	const nodes: PendingNodeState[] = [];
	for (const node of sequence.trackNodes) {
		if (node.parentFolderId === null) {
			activeFolderIds.length = 0;
		} else {
			const parentIndex = activeFolderIds.lastIndexOf(node.parentFolderId);
			if (parentIndex < 0) throw new ReferenceError(`Missing active parent folder ${node.parentFolderId}.`);
			activeFolderIds.length = parentIndex + 1;
		}
		const ancestorFolderIds = Object.freeze([...activeFolderIds]);
		const rowHidden = ancestorFolderIds.some((id) => folderById.get(id)?.collapsed === true);
		nodes.push({
			kind: node.kind,
			id: node.id,
			sequenceId: sequence.id,
			parentFolderId: node.parentFolderId,
			ancestorFolderIds,
			depth: ancestorFolderIds.length,
			rowHidden,
		});
		if (node.kind === 'folder') {
			activeFolderIds.push(node.id);
		} else if (trackById.get(node.id)?.type === 'audio') {
			for (const folderId of ancestorFolderIds) audioDescendantFolderIds.add(folderId);
		}
	}
	return { sequenceId: sequence.id, nodes };
}

function projectNodeState(
	node: PendingNodeState,
	folderById: ReadonlyMap<string, TrackFolderV12>,
	trackById: ReadonlyMap<string, CanonicalTrackState>,
	audioDescendantFolderIds: ReadonlySet<string>,
): TrackFolderStateNodeV12 {
	const common = {
		id: node.id,
		sequenceId: node.sequenceId,
		parentFolderId: node.parentFolderId,
		ancestorFolderIds: node.ancestorFolderIds,
		depth: node.depth,
		rowHidden: node.rowHidden,
	};
	if (node.kind === 'folder') {
		const folder = requiredMapValue(folderById, node.id, 'folder');
		return Object.freeze({
			kind: 'folder' as const,
			...common,
			collapsed: folder.collapsed,
			hidden: folder.hidden,
			mute: folder.mute,
			solo: folder.solo,
			hasAudioDescendant: audioDescendantFolderIds.has(folder.id),
		});
	}
	const track = requiredMapValue(trackById, node.id, 'track');
	const leaf = { ...common, laneGroupId: track.laneGroupId };
	if (track.type === 'audio') {
		const ancestorMuted = node.ancestorFolderIds.some((id) => folderById.get(id)?.mute === true);
		const effectiveSoloed = track.solo
			|| node.ancestorFolderIds.some((id) => folderById.get(id)?.solo === true);
		return Object.freeze({
			kind: 'track' as const,
			type: 'audio' as const,
			...leaf,
			mute: track.mute,
			solo: track.solo,
			effectiveMuted: track.mute || ancestorMuted,
			effectiveSoloed,
		});
	}
	if (track.type === 'video') {
		const ancestorHidden = node.ancestorFolderIds.some((id) => folderById.get(id)?.hidden === true);
		return Object.freeze({
			kind: 'track' as const,
			type: 'video' as const,
			...leaf,
			hidden: track.hidden,
			effectiveHidden: track.hidden || ancestorHidden,
		});
	}
	return Object.freeze({ kind: 'track' as const, type: 'label' as const, ...leaf });
}

function canonicalTrackStates(value: unknown): readonly CanonicalTrackState[] {
	const candidates = canonicalArray(value, 'track folder state context.tracks');
	return candidates.map((value, index) => {
		const name = `track folder state context.tracks[${String(index)}]`;
		if (!isPlainRecord(value)) throw new TypeError(`${name} must be a plain data object.`);
		const id = requiredDataProperty(value, 'id', name);
		const type = requiredDataProperty(value, 'type', name);
		const laneGroupId = Object.hasOwn(value, 'laneGroupId')
			? requiredDataProperty(value, 'laneGroupId', name)
			: null;
		if (type === 'audio') return {
			id: id as string,
			type,
			laneGroupId: laneGroupId as string | null,
			mute: booleanDataProperty(value, 'mute', name),
			solo: booleanDataProperty(value, 'solo', name),
			hidden: false,
		};
		if (type === 'video') return {
			id: id as string,
			type,
			laneGroupId: laneGroupId as string | null,
			mute: false,
			solo: false,
			hidden: booleanDataProperty(value, 'hidden', name),
		};
		return {
			id: id as string,
			type: type as TrackFolderStateTrackV12['type'],
			laneGroupId: laneGroupId as string | null,
			mute: false,
			solo: false,
			hidden: false,
		};
	});
}

function booleanDataProperty(value: DataRecord, key: string, name: string): boolean {
	const property = requiredDataProperty(value, key, name);
	if (typeof property !== 'boolean') throw new TypeError(`${name}.${key} must be a boolean.`);
	return property;
}

function requiredDataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function closedDataRecord(value: unknown, allowed: ReadonlySet<string>, name: string): DataRecord {
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be a plain data object.`);
	const snapshot: DataRecord = Object.create(null) as DataRecord;
	const present = new Set<string>();
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		present.add(key);
		snapshot[key] = descriptor.value;
	}
	for (const key of allowed) {
		if (!present.has(key)) throw new TypeError(`${name} is missing required field: ${key}.`);
	}
	return snapshot;
}

function canonicalArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a canonical array.`);
	}
	if (value.length > TRACK_HIERARCHY_V12_LIMITS.maximumNodes) {
		throw new RangeError(`${name} cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumNodes)} entries.`);
	}
	const snapshot: unknown[] = [];
	const allowed = new Set<string>(['length']);
	for (let index = 0; index < value.length; index += 1) {
		const key = String(index);
		allowed.add(key);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must be a dense canonical array of enumerable data elements.`);
		}
		snapshot.push(descriptor.value);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported canonical array field: ${String(key)}.`);
		}
	}
	return snapshot;
}

function requiredMapValue<Value>(map: ReadonlyMap<string, Value>, id: string, kind: string): Value {
	const value = map.get(id);
	if (value === undefined) throw new ReferenceError(`Missing ${kind} state for ${id}.`);
	return value;
}

function isPlainRecord(value: unknown): value is DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
