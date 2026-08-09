/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TRACK_FOLDER_V12_LIMITS,
	validateTrackFoldersV12,
	type TrackFolderV12,
} from './track-folder-v12.ts';

export const TRACK_HIERARCHY_V12_LIMITS = Object.freeze({
	maximumFolders: TRACK_FOLDER_V12_LIMITS.maximumFolders,
	maximumNodes: 16_384,
	maximumSequences: 1_024,
	maximumFolderDepth: 32,
	maximumIdCodeUnits: TRACK_FOLDER_V12_LIMITS.maximumIdCodeUnits,
});

export type TrackNodeKindV12 = 'folder' | 'track';

export interface TrackNodeV12 {
	readonly kind: TrackNodeKindV12;
	readonly id: string;
	readonly parentFolderId: string | null;
}

export interface TrackHierarchySequenceV12 {
	readonly id: string;
	readonly trackNodes: readonly TrackNodeV12[];
	readonly trackIds: readonly string[];
}

export interface TrackHierarchyTrackMetadataV12 {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly laneGroupId?: string | null;
}

export interface TrackHierarchyContextV12 {
	readonly trackFolders: readonly TrackFolderV12[];
	readonly tracks: readonly TrackHierarchyTrackMetadataV12[];
}

export interface TrackHierarchySequenceOrderV12 {
	readonly sequenceId: string;
	readonly folderIds: readonly string[];
	readonly trackIds: readonly string[];
}

export interface TrackHierarchyOrderV12 {
	readonly folderIds: readonly string[];
	readonly trackIds: readonly string[];
	readonly sequences: readonly TrackHierarchySequenceOrderV12[];
}

type DataRecord = Record<string, unknown>;

interface NodeLocation {
	readonly kind: TrackNodeKindV12;
	readonly sequenceIndex: number;
	readonly nodeIndex: number;
	readonly parentFolderId: string | null;
}

interface HierarchyAnalysis {
	readonly order: TrackHierarchyOrderV12;
	readonly locations: ReadonlyMap<string, NodeLocation>;
}

interface HierarchyAdmissionBudget {
	nodes: number;
}

interface CanonicalTrackMetadata {
	readonly id: string;
	readonly type: TrackHierarchyTrackMetadataV12['type'];
	readonly laneGroupId: string | null;
}

const NODE_KEYS: ReadonlySet<string> = new Set(['kind', 'id', 'parentFolderId']);
const NODE_FACTORY_REQUIRED_KEYS: ReadonlySet<string> = new Set(['kind', 'id']);
const SEQUENCE_KEYS: ReadonlySet<string> = new Set(['id', 'trackNodes', 'trackIds']);
const SEQUENCE_FACTORY_REQUIRED_KEYS: ReadonlySet<string> = new Set(['id', 'trackNodes']);
const CONTEXT_KEYS: ReadonlySet<string> = new Set(['trackFolders', 'tracks']);
const TRACK_METADATA_KEYS: ReadonlySet<string> = new Set(['id', 'type', 'laneGroupId']);
const TRACK_METADATA_REQUIRED_KEYS: ReadonlySet<string> = new Set(['id', 'type']);
const INVALID_CANONICAL_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Create one immutable canonical flat hierarchy node; roots default to a null parent. */
export function createTrackNodeV12(value: unknown): TrackNodeV12 {
	const candidate = closedDataRecord(
		value,
		NODE_KEYS,
		NODE_FACTORY_REQUIRED_KEYS,
		'track node',
	);
	return Object.freeze({
		kind: nodeKind(candidate.kind, 'track node.kind'),
		id: hierarchyId(candidate.id, 'track node.id'),
		parentFolderId: Object.hasOwn(candidate, 'parentFolderId')
			? optionalHierarchyId(candidate.parentFolderId, 'track node.parentFolderId')
			: null,
	});
}

/** Create an immutable canonical node array without interpreting parent relationships. */
export function createTrackNodesV12(value: unknown): readonly TrackNodeV12[] {
	const candidates = canonicalArray(value, 'sequence.trackNodes', TRACK_HIERARCHY_V12_LIMITS.maximumNodes);
	return Object.freeze(candidates.map((candidate) => createTrackNodeV12(candidate)));
}

/** Validate one exact persisted hierarchy node. */
export function validateTrackNodeV12(value: unknown): value is TrackNodeV12 {
	validateNamedNode(value, 'track node');
	return true;
}

/** Validate an exact dense persisted node array without interpreting parent relationships. */
export function validateTrackNodesV12(value: unknown): value is readonly TrackNodeV12[] {
	const nodes = canonicalArray(value, 'sequence.trackNodes', TRACK_HIERARCHY_V12_LIMITS.maximumNodes);
	for (const [index, node] of nodes.entries()) {
		validateNamedNode(node, `sequence.trackNodes[${String(index)}]`);
	}
	return true;
}

/** Derive the authoritative leaf projection from one canonical flat node array. */
export function deriveTrackIdsV12(value: unknown): readonly string[] {
	validateTrackNodesV12(value);
	const nodes = value as readonly TrackNodeV12[];
	return Object.freeze(nodes.filter(({ kind }) => kind === 'track').map(({ id }) => id));
}

/** Derive folder preorder from one canonical flat node array. */
export function deriveTrackFolderIdsV12(value: unknown): readonly string[] {
	validateTrackNodesV12(value);
	const nodes = value as readonly TrackNodeV12[];
	return Object.freeze(nodes.filter(({ kind }) => kind === 'folder').map(({ id }) => id));
}

/**
 * Canonicalize sequence hierarchy projections, deriving omitted `trackIds` and
 * checking any supplied projection before validating project metadata order.
 */
export function createTrackHierarchyV12(
	value: unknown,
	context: unknown,
): readonly TrackHierarchySequenceV12[] {
	const candidates = canonicalSequenceArray(value);
	const budget: HierarchyAdmissionBudget = { nodes: 0 };
	const sequences = candidates.map((candidate, index) => createSequence(
		candidate,
		`project.sequences[${String(index)}]`,
		budget,
	));
	const frozen = Object.freeze(sequences);
	const analysis = analyzeHierarchy(frozen);
	validateContext(analysis, context);
	return frozen;
}

/** Validate exact sequence projections, authoritative DFS order, ownership, and A/V lane blocks. */
export function validateTrackHierarchyV12(
	value: unknown,
	context: unknown,
): value is readonly TrackHierarchySequenceV12[] {
	const sequences = exactSequences(value);
	const analysis = analyzeHierarchy(sequences);
	validateContext(analysis, context);
	return true;
}

/** Derive immutable per-sequence and project-wide folder/leaf preorder from an exact hierarchy. */
export function deriveTrackHierarchyOrderV12(value: unknown): TrackHierarchyOrderV12 {
	return analyzeHierarchy(exactSequences(value)).order;
}

function createSequence(
	value: unknown,
	name: string,
	budget: HierarchyAdmissionBudget,
): TrackHierarchySequenceV12 {
	const candidate = closedDataRecord(
		value,
		SEQUENCE_KEYS,
		SEQUENCE_FACTORY_REQUIRED_KEYS,
		name,
	);
	admitTrackNodeCount(candidate.trackNodes, name, budget);
	const trackNodes = createTrackNodesV12(candidate.trackNodes);
	const derivedTrackIds = deriveTrackIdsV12(trackNodes);
	if (Object.hasOwn(candidate, 'trackIds')) {
		const suppliedTrackIds = hierarchyIdArray(candidate.trackIds, `${name}.trackIds`);
		assertExactOrder(suppliedTrackIds, derivedTrackIds, `${name}.trackIds must equal its derived leaf order`);
	}
	return Object.freeze({
		id: hierarchyId(candidate.id, `${name}.id`),
		trackNodes,
		trackIds: derivedTrackIds,
	});
}

function exactSequences(value: unknown): readonly TrackHierarchySequenceV12[] {
	const candidates = canonicalSequenceArray(value);
	const budget: HierarchyAdmissionBudget = { nodes: 0 };
	const sequences: TrackHierarchySequenceV12[] = [];
	for (const [index, value] of candidates.entries()) {
		const name = `project.sequences[${String(index)}]`;
		const candidate = closedDataRecord(value, SEQUENCE_KEYS, SEQUENCE_KEYS, name);
		hierarchyId(candidate.id, `${name}.id`);
		admitTrackNodeCount(candidate.trackNodes, name, budget);
		validateTrackNodesV12(candidate.trackNodes);
		const suppliedTrackIds = hierarchyIdArray(candidate.trackIds, `${name}.trackIds`);
		const derivedTrackIds = (candidate.trackNodes as readonly TrackNodeV12[])
			.filter(({ kind }) => kind === 'track')
			.map(({ id }) => id);
		assertExactOrder(
			suppliedTrackIds,
			derivedTrackIds,
			`${name}.trackIds must equal its derived leaf order`,
		);
		sequences.push(candidate as unknown as TrackHierarchySequenceV12);
	}
	return sequences;
}

function canonicalSequenceArray(value: unknown): readonly unknown[] {
	const sequences = canonicalArray(
		value,
		'project.sequences',
		TRACK_HIERARCHY_V12_LIMITS.maximumSequences,
	);
	if (sequences.length === 0) throw new RangeError('project.sequences must contain at least one sequence.');
	return sequences;
}

function admitTrackNodeCount(
	value: unknown,
	sequenceName: string,
	budget: HierarchyAdmissionBudget,
): void {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${sequenceName}.trackNodes must be a canonical array.`);
	}
	if (value.length > TRACK_HIERARCHY_V12_LIMITS.maximumNodes) {
		throw new RangeError(
			`${sequenceName}.trackNodes cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumNodes)} entries.`,
		);
	}
	if (budget.nodes > TRACK_HIERARCHY_V12_LIMITS.maximumNodes - value.length) {
		throw new RangeError(
			`Track hierarchy cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumNodes)} total nodes.`,
		);
	}
	budget.nodes += value.length;
}

function analyzeHierarchy(sequences: readonly TrackHierarchySequenceV12[]): HierarchyAnalysis {
	const sequenceIds = new Set<string>();
	const locations = new Map<string, NodeLocation>();
	let totalNodes = 0;
	let totalFolders = 0;
	for (const [sequenceIndex, sequence] of sequences.entries()) {
		if (sequenceIds.has(sequence.id)) {
			throw new RangeError(`project.sequences contains duplicate sequence ID: ${sequence.id}.`);
		}
		sequenceIds.add(sequence.id);
		totalNodes += sequence.trackNodes.length;
		if (totalNodes > TRACK_HIERARCHY_V12_LIMITS.maximumNodes) {
			throw new RangeError(
				`Track hierarchy cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumNodes)} total nodes.`,
			);
		}
		for (const [nodeIndex, node] of sequence.trackNodes.entries()) {
			if (locations.has(node.id)) {
				throw new RangeError(`Track and folder IDs must be globally disjoint; duplicate ID: ${node.id}.`);
			}
			locations.set(node.id, {
				kind: node.kind,
				sequenceIndex,
				nodeIndex,
				parentFolderId: node.parentFolderId,
			});
			if (node.kind === 'folder') totalFolders += 1;
		}
	}
	if (totalFolders > TRACK_HIERARCHY_V12_LIMITS.maximumFolders) {
		throw new RangeError(
			`Track hierarchy cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumFolders)} folders.`,
		);
	}

	const folderIds: string[] = [];
	const trackIds: string[] = [];
	const sequenceOrders: TrackHierarchySequenceOrderV12[] = [];
	for (const [sequenceIndex, sequence] of sequences.entries()) {
		const activeFolders: string[] = [];
		const sequenceFolderIds: string[] = [];
		const sequenceTrackIds: string[] = [];
		for (const [nodeIndex, node] of sequence.trackNodes.entries()) {
			if (node.parentFolderId === null) {
				activeFolders.length = 0;
			} else {
				const parent = locations.get(node.parentFolderId);
				if (!parent) {
					throw new ReferenceError(`Track node ${node.id} references missing parent folder ${node.parentFolderId}.`);
				}
				if (parent.kind !== 'folder') {
					throw new RangeError(`Track node ${node.id} parent ${node.parentFolderId} must be a folder.`);
				}
				if (parent.sequenceIndex !== sequenceIndex) {
					throw new RangeError(`Track node ${node.id} cannot use a cross-sequence parent folder.`);
				}
				if (parent.nodeIndex >= nodeIndex) {
					throw new RangeError(`Track node ${node.id} cannot reference itself or a later parent folder.`);
				}
				const activeIndex = activeFolders.lastIndexOf(node.parentFolderId);
				if (activeIndex < 0) {
					throw new RangeError(
						`Track node ${node.id} cannot reopen a closed folder; its parent must be active in DFS preorder.`,
					);
				}
				activeFolders.length = activeIndex + 1;
			}
			if (node.kind === 'folder') {
				const depth = activeFolders.length;
				if (depth > TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth) {
					throw new RangeError(
						`Track folder ${node.id} exceeds maximum folder depth ${String(TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth)}.`,
					);
				}
				activeFolders.push(node.id);
				sequenceFolderIds.push(node.id);
				folderIds.push(node.id);
			} else {
				sequenceTrackIds.push(node.id);
				trackIds.push(node.id);
			}
		}
		assertExactOrder(
			sequence.trackIds,
			sequenceTrackIds,
			`project.sequences[${String(sequenceIndex)}].trackIds must equal its derived leaf order`,
		);
		sequenceOrders.push(Object.freeze({
			sequenceId: sequence.id,
			folderIds: Object.freeze(sequenceFolderIds),
			trackIds: Object.freeze(sequenceTrackIds),
		}));
	}
	return {
		locations,
		order: Object.freeze({
			folderIds: Object.freeze(folderIds),
			trackIds: Object.freeze(trackIds),
			sequences: Object.freeze(sequenceOrders),
		}),
	};
}

function validateContext(analysis: HierarchyAnalysis, value: unknown): void {
	const context = closedDataRecord(value, CONTEXT_KEYS, CONTEXT_KEYS, 'track hierarchy context');
	validateTrackFoldersV12(context.trackFolders);
	const trackFolders = context.trackFolders as readonly TrackFolderV12[];
	const trackMetadata = canonicalTrackMetadata(context.tracks);
	const folderIds = trackFolders.map(({ id }) => id);
	const metadataTrackIds = trackMetadata.map(({ id }) => id);
	const folderIdSet = new Set(folderIds);
	for (const trackId of metadataTrackIds) {
		if (folderIdSet.has(trackId)) {
			throw new RangeError(`Track and folder IDs must be globally disjoint: ${trackId}.`);
		}
	}
	assertExactOrder(
		folderIds,
		analysis.order.folderIds,
		'project.trackFolders must contain every folder in exact hierarchy preorder',
	);
	assertExactOrder(
		metadataTrackIds,
		analysis.order.trackIds,
		'project.tracks must contain every track in exact hierarchy preorder',
	);
	validateLaneGroups(trackMetadata, analysis.locations);
}

function canonicalTrackMetadata(value: unknown): readonly CanonicalTrackMetadata[] {
	const candidates = canonicalArray(value, 'track hierarchy context.tracks', TRACK_HIERARCHY_V12_LIMITS.maximumNodes);
	const tracks: CanonicalTrackMetadata[] = [];
	const ids = new Set<string>();
	for (const [index, value] of candidates.entries()) {
		const name = `track hierarchy context.tracks[${String(index)}]`;
		const candidate = closedDataRecord(
			value,
			TRACK_METADATA_KEYS,
			TRACK_METADATA_REQUIRED_KEYS,
			name,
		);
		const id = hierarchyId(candidate.id, `${name}.id`);
		if (ids.has(id)) throw new RangeError(`Track metadata contains duplicate track ID: ${id}.`);
		ids.add(id);
		const type = trackType(candidate.type, `${name}.type`);
		const laneGroupId = Object.hasOwn(candidate, 'laneGroupId')
			? optionalHierarchyId(candidate.laneGroupId, `${name}.laneGroupId`)
			: null;
		tracks.push({ id, type, laneGroupId });
	}
	return tracks;
}

function validateLaneGroups(
	tracks: readonly CanonicalTrackMetadata[],
	locations: ReadonlyMap<string, NodeLocation>,
): void {
	const groups = new Map<string, CanonicalTrackMetadata[]>();
	for (const track of tracks) {
		if (track.laneGroupId === null) continue;
		const entries = groups.get(track.laneGroupId) ?? [];
		entries.push(track);
		groups.set(track.laneGroupId, entries);
	}
	for (const [laneGroupId, entries] of groups) {
		if (entries.length !== 2 || entries[0]?.type !== 'video' || entries[1]?.type !== 'audio') {
			throw new RangeError(`Media lane group ${laneGroupId} must contain exactly one video/audio track pair.`);
		}
		const video = locations.get(entries[0].id);
		const audio = locations.get(entries[1].id);
		if (!video || !audio || video.kind !== 'track' || audio.kind !== 'track') {
			throw new ReferenceError(`Media lane group ${laneGroupId} references missing hierarchy tracks.`);
		}
		if (video.sequenceIndex !== audio.sequenceIndex) {
			throw new RangeError(`Media lane group ${laneGroupId} must stay in the same sequence.`);
		}
		if (audio.nodeIndex !== video.nodeIndex + 1) {
			throw new RangeError(`Media lane group ${laneGroupId} video/audio tracks must be adjacent hierarchy nodes.`);
		}
		if (video.parentFolderId !== audio.parentFolderId) {
			throw new RangeError(`Media lane group ${laneGroupId} tracks must have the same parent folder.`);
		}
	}
}

function validateNamedNode(value: unknown, name: string): asserts value is TrackNodeV12 {
	const candidate = closedDataRecord(value, NODE_KEYS, NODE_KEYS, name);
	nodeKind(candidate.kind, `${name}.kind`);
	hierarchyId(candidate.id, `${name}.id`);
	optionalHierarchyId(candidate.parentFolderId, `${name}.parentFolderId`);
}

function hierarchyIdArray(value: unknown, name: string): readonly string[] {
	const candidates = canonicalArray(value, name, TRACK_HIERARCHY_V12_LIMITS.maximumNodes);
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const [index, value] of candidates.entries()) {
		const id = hierarchyId(value, `${name}[${String(index)}]`);
		if (seen.has(id)) throw new RangeError(`${name} contains duplicate ID: ${id}.`);
		seen.add(id);
		ids.push(id);
	}
	return candidates.every((candidate, index) => candidate === ids[index]) ? candidates as readonly string[] : ids;
}

function nodeKind(value: unknown, name: string): TrackNodeKindV12 {
	if (value !== 'folder' && value !== 'track') throw new RangeError(`${name} must be folder or track.`);
	return value;
}

function trackType(value: unknown, name: string): TrackHierarchyTrackMetadataV12['type'] {
	if (value !== 'audio' && value !== 'video' && value !== 'label') {
		throw new RangeError(`${name} must be audio, video, or label.`);
	}
	return value;
}

function optionalHierarchyId(value: unknown, name: string): string | null {
	return value === null ? null : hierarchyId(value, name);
}

function hierarchyId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	if (value !== value.trim()) throw new TypeError(`${name} must be a canonical string.`);
	if (value.length > TRACK_HIERARCHY_V12_LIMITS.maximumIdCodeUnits) {
		throw new RangeError(`${name} length exceeds its maximum.`);
	}
	if (INVALID_CANONICAL_TEXT.test(value)) {
		throw new TypeError(`${name} must be single-line and contain no control or formatting characters.`);
	}
	return value;
}

function assertExactOrder(actual: readonly string[], expected: readonly string[], name: string): void {
	if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
		throw new RangeError(`${name}.`);
	}
}

function closedDataRecord(
	value: unknown,
	allowed: ReadonlySet<string>,
	required: ReadonlySet<string>,
	name: string,
): DataRecord {
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
	for (const key of required) {
		if (!present.has(key)) throw new TypeError(`${name} is missing required field: ${key}.`);
	}
	return snapshot;
}

function canonicalArray(value: unknown, name: string, maximumLength?: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a canonical array.`);
	}
	if (maximumLength !== undefined && value.length > maximumLength) {
		throw new RangeError(`${name} cannot exceed ${String(maximumLength)} entries.`);
	}
	const allowed = new Set<string>(['length']);
	const snapshot: unknown[] = [];
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

function isPlainRecord(value: unknown): value is DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
