/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TRACK_HIERARCHY_V12_LIMITS,
	type TrackNodeKindV12,
	type TrackNodeV12,
} from './track-hierarchy-v12.ts';

/** Stable machine-readable reasons for refusing a folder edit before it mutates a draft. */
export const TRACK_FOLDER_EDIT_CODES = Object.freeze({
	unknownSequence: 'track-folder/unknown-sequence',
	unknownNode: 'track-folder/unknown-node',
	unknownParent: 'track-folder/unknown-parent',
	parentNotFolder: 'track-folder/parent-not-folder',
	cyclicParent: 'track-folder/cyclic-parent',
	crossSequence: 'track-folder/cross-sequence',
	duplicateId: 'track-folder/duplicate-id',
	depthExceeded: 'track-folder/depth-exceeded',
	folderBudget: 'track-folder/folder-budget',
	nodeBudget: 'track-folder/node-budget',
	invalidIndex: 'track-folder/invalid-index',
});

export type TrackFolderEditCode =
	typeof TRACK_FOLDER_EDIT_CODES[keyof typeof TRACK_FOLDER_EDIT_CODES];

/**
 * Refusal raised before any draft mutation. Folder edits reject rather than
 * clamping or flattening, so the caller can localize and announce the reason
 * instead of surfacing a bare validator failure at commit time.
 */
export class TrackFolderEditError extends Error {
	readonly code: TrackFolderEditCode;

	constructor(code: TrackFolderEditCode, message: string) {
		super(message);
		this.name = 'TrackFolderEditError';
		this.code = code;
	}
}

export type TrackFolderRemovalDisposition = 'promote' | 'delete-contents';

export interface MutableTrackNodeV12 {
	kind: TrackNodeKindV12;
	id: string;
	parentFolderId: string | null;
}

export interface MutableHierarchySequenceV12 {
	id: string;
	trackNodes: MutableTrackNodeV12[];
	trackIds?: string[];
}

export interface TrackNodeSpanV12 {
	/** Inclusive first node index of the structural block. */
	readonly start: number;
	/** Exclusive last node index of the structural block. */
	readonly end: number;
}

export interface TrackNodeLaneGroupsV12 {
	/** Lane group ID per track ID; tracks outside a media lane pair are absent. */
	readonly laneGroupIdByTrackId: ReadonlyMap<string, string>;
}

export interface TrackFolderRemovalResultV12 {
	readonly removedTrackIds: readonly string[];
	readonly removedFolderIds: readonly string[];
}

/**
 * Resolve the contiguous preorder block a node owns: a folder covers itself and
 * every descendant, and a media lane track expands to cover its adjacent
 * partner so an A/V pair can never be split by a structural edit.
 */
export function resolveTrackNodeSpanV12(
	nodes: readonly TrackNodeV12[],
	nodeId: string,
	laneGroups?: TrackNodeLaneGroupsV12,
): TrackNodeSpanV12 {
	const index = nodes.findIndex((node) => node.id === nodeId);
	if (index < 0) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownNode,
			`Track node ${nodeId} is not part of the sequence.`,
		);
	}
	const node = requiredTrackNode(nodes, index);
	if (node.kind === 'folder') return Object.freeze({ start: index, end: subtreeEnd(nodes, index) });
	const laneGroupId = laneGroups?.laneGroupIdByTrackId.get(nodeId);
	if (laneGroupId == null) return Object.freeze({ start: index, end: index + 1 });
	let start = index;
	let end = index + 1;
	if (laneGroups?.laneGroupIdByTrackId.get(nodes[index - 1]?.id ?? '') === laneGroupId) start -= 1;
	if (laneGroups?.laneGroupIdByTrackId.get(nodes[end]?.id ?? '') === laneGroupId) end += 1;
	return Object.freeze({ start, end });
}

/** Resolve every open ancestor folder of a node, outermost first. */
export function resolveTrackNodeAncestorsV12(
	nodes: readonly TrackNodeV12[],
	nodeId: string,
): readonly string[] {
	const stacks = ancestorStacks(nodes);
	const index = nodes.findIndex((node) => node.id === nodeId);
	if (index < 0) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownNode,
			`Track node ${nodeId} is not part of the sequence.`,
		);
	}
	return requiredAncestorStack(stacks, index);
}

/** Resolve the outermost folder owning a node, or null when the node sits at the sequence root. */
export function resolveRootFolderIdV12(
	nodes: readonly TrackNodeV12[],
	nodeId: string,
): string | null {
	return resolveTrackNodeAncestorsV12(nodes, nodeId)[0] ?? null;
}

/**
 * Move one structural block under a new parent at a child-relative index,
 * rejecting cycles, cross-sequence parents, and depth overflow before the
 * sequence is rewritten.
 */
export function moveTrackNodeV12(
	sequences: readonly MutableHierarchySequenceV12[],
	request: {
		readonly sequenceId: string;
		readonly nodeId: string;
		readonly parentFolderId: string | null;
		readonly index: number;
	},
	laneGroups?: TrackNodeLaneGroupsV12,
): void {
	const sequence = requireSequence(sequences, request.sequenceId);
	const nodes = sequence.trackNodes;
	const span = resolveTrackNodeSpanV12(nodes, request.nodeId, laneGroups);
	const block = nodes.slice(span.start, span.end);
	if (request.parentFolderId !== null) {
		assertParentIsFolder(sequences, request.sequenceId, request.parentFolderId);
		if (block.some((node) => node.id === request.parentFolderId)) {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.cyclicParent,
				`Track node ${request.nodeId} cannot move inside its own subtree.`,
			);
		}
	}
	const remaining = [...nodes.slice(0, span.start), ...nodes.slice(span.end)];
	const insertion = childInsertionIndex(remaining, request.parentFolderId, request.index);
	// Every sibling at the head of the block re-parents together. For a folder
	// subtree that is the folder alone, because its descendants point at nodes
	// inside the block; for a media lane pair it is both lanes, which the
	// validator requires to share one parent.
	const headParentFolderId = requiredTrackNode(block, 0).parentFolderId;
	const moved = block.map((node) => (
		node.parentFolderId === headParentFolderId
			? { ...node, parentFolderId: request.parentFolderId }
			: { ...node }
	));
	const next = [...remaining.slice(0, insertion), ...moved, ...remaining.slice(insertion)];
	assertDepthWithinLimit(next);
	sequence.trackNodes = next;
	syncSequenceTrackIds(sequence);
}

/**
 * Insert one new node under a parent at a child-relative index. Used for folder
 * creation and for folder-aware track insertion.
 */
export function insertTrackNodeV12(
	sequences: readonly MutableHierarchySequenceV12[],
	request: {
		readonly sequenceId: string;
		readonly node: MutableTrackNodeV12;
		readonly parentFolderId: string | null;
		readonly index: number;
	},
): void {
	const sequence = requireSequence(sequences, request.sequenceId);
	assertIdIsFree(sequences, request.node.id);
	if (request.parentFolderId !== null) {
		assertParentIsFolder(sequences, request.sequenceId, request.parentFolderId);
	}
	const nodes = sequence.trackNodes;
	const insertion = childInsertionIndex(nodes, request.parentFolderId, request.index);
	const next = [
		...nodes.slice(0, insertion),
		{ ...request.node, parentFolderId: request.parentFolderId },
		...nodes.slice(insertion),
	];
	assertBudgets(sequences, next, sequence.id);
	assertDepthWithinLimit(next);
	sequence.trackNodes = next;
	syncSequenceTrackIds(sequence);
}

/**
 * Remove one structural block. `promote` drops a folder and lifts its direct
 * children into the folder's own parent; `delete-contents` removes the whole
 * subtree and reports what left the document so the caller can clean up clips,
 * mixer routes, and control references in the same transaction.
 */
export function removeTrackNodeV12(
	sequences: readonly MutableHierarchySequenceV12[],
	request: {
		readonly sequenceId: string;
		readonly nodeId: string;
		readonly disposition: TrackFolderRemovalDisposition;
	},
	laneGroups?: TrackNodeLaneGroupsV12,
): TrackFolderRemovalResultV12 {
	const sequence = requireSequence(sequences, request.sequenceId);
	const nodes = sequence.trackNodes;
	const span = resolveTrackNodeSpanV12(nodes, request.nodeId, laneGroups);
	const head = requiredTrackNode(nodes, span.start);
	if (request.disposition === 'promote' && head.kind === 'folder') {
		const promoted = nodes.slice(span.start + 1, span.end).map((node) => (
			node.parentFolderId === head.id ? { ...node, parentFolderId: head.parentFolderId } : { ...node }
		));
		sequence.trackNodes = [...nodes.slice(0, span.start), ...promoted, ...nodes.slice(span.end)];
		syncSequenceTrackIds(sequence);
		return Object.freeze({ removedTrackIds: Object.freeze([]), removedFolderIds: Object.freeze([head.id]) });
	}
	const removed = nodes.slice(span.start, span.end);
	sequence.trackNodes = [...nodes.slice(0, span.start), ...nodes.slice(span.end)];
	syncSequenceTrackIds(sequence);
	return Object.freeze({
		removedTrackIds: Object.freeze(removed.filter(({ kind }) => kind === 'track').map(({ id }) => id)),
		removedFolderIds: Object.freeze(removed.filter(({ kind }) => kind === 'folder').map(({ id }) => id)),
	});
}

/**
 * Reorder project-wide folder and track metadata into the exact hierarchy
 * preorder the V12 validator demands, preserving each record's identity.
 */
export function orderByHierarchyPreorderV12<T extends { readonly id?: unknown }>(
	records: readonly T[],
	order: readonly string[],
): T[] {
	const byId = new Map(records.map((record) => [String(record.id), record]));
	const ordered: T[] = [];
	for (const id of order) {
		const record = byId.get(id);
		if (record === undefined) {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.unknownNode,
				`Hierarchy preorder references missing record ${id}.`,
			);
		}
		byId.delete(id);
		ordered.push(record);
	}
	if (byId.size > 0) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownNode,
			`Hierarchy preorder omits ${String(byId.size)} record(s): ${[...byId.keys()].join(', ')}.`,
		);
	}
	return ordered;
}

/** Derive lane-group membership from project track metadata. */
export function trackNodeLaneGroupsV12(
	tracks: readonly { readonly id?: unknown; readonly laneGroupId?: unknown }[],
): TrackNodeLaneGroupsV12 {
	const laneGroupIdByTrackId = new Map<string, string>();
	for (const track of tracks) {
		if (track.laneGroupId == null) continue;
		laneGroupIdByTrackId.set(String(track.id), String(track.laneGroupId));
	}
	return Object.freeze({ laneGroupIdByTrackId });
}

function subtreeEnd(nodes: readonly TrackNodeV12[], folderIndex: number): number {
	const stacks = ancestorStacks(nodes);
	const folderId = requiredTrackNode(nodes, folderIndex).id;
	for (let index = folderIndex + 1; index < nodes.length; index += 1) {
		if (!requiredAncestorStack(stacks, index).includes(folderId)) return index;
	}
	return nodes.length;
}

function ancestorStacks(nodes: readonly TrackNodeV12[]): readonly (readonly string[])[] {
	const stacks: (readonly string[])[] = [];
	const active: string[] = [];
	for (const node of nodes) {
		if (node.parentFolderId === null) {
			active.length = 0;
		} else {
			const activeIndex = active.lastIndexOf(node.parentFolderId);
			if (activeIndex < 0) {
				throw new TrackFolderEditError(
					TRACK_FOLDER_EDIT_CODES.unknownParent,
					`Track node ${node.id} references a parent folder that is not open in preorder.`,
				);
			}
			active.length = activeIndex + 1;
		}
		stacks.push(Object.freeze([...active]));
		if (node.kind === 'folder') active.push(node.id);
	}
	return stacks;
}

function childInsertionIndex(
	nodes: readonly TrackNodeV12[],
	parentFolderId: string | null,
	index: number,
): number {
	if (!Number.isSafeInteger(index) || index < 0) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.invalidIndex,
			`Track node index must be a non-negative integer; received ${String(index)}.`,
		);
	}
	const stacks = ancestorStacks(nodes);
	const parentIndex = parentFolderId === null
		? -1
		: nodes.findIndex((node) => node.id === parentFolderId);
	const scanStart = parentIndex + 1;
	const scanEnd = parentFolderId === null ? nodes.length : subtreeEnd(nodes, parentIndex);
	let seen = 0;
	for (let cursor = scanStart; cursor < scanEnd; cursor += 1) {
		const stack = requiredAncestorStack(stacks, cursor);
		const isDirectChild = parentFolderId === null
			? stack.length === 0
			: stack.at(-1) === parentFolderId;
		if (!isDirectChild) continue;
		if (seen === index) return cursor;
		seen += 1;
	}
	return scanEnd;
}

function assertParentIsFolder(
	sequences: readonly MutableHierarchySequenceV12[],
	sequenceId: string,
	parentFolderId: string,
): void {
	for (const sequence of sequences) {
		const node = sequence.trackNodes.find((candidate) => candidate.id === parentFolderId);
		if (node === undefined) continue;
		if (node.kind !== 'folder') {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.parentNotFolder,
				`Track node parent ${parentFolderId} must be a folder.`,
			);
		}
		if (sequence.id !== sequenceId) {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.crossSequence,
				`Track node parent ${parentFolderId} belongs to another sequence.`,
			);
		}
		return;
	}
	throw new TrackFolderEditError(
		TRACK_FOLDER_EDIT_CODES.unknownParent,
		`Track node parent ${parentFolderId} does not exist.`,
	);
}

function assertIdIsFree(sequences: readonly MutableHierarchySequenceV12[], id: string): void {
	for (const sequence of sequences) {
		if (sequence.trackNodes.some((node) => node.id === id)) {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.duplicateId,
				`Track and folder IDs must be globally disjoint; duplicate ID: ${id}.`,
			);
		}
	}
}

function assertDepthWithinLimit(nodes: readonly TrackNodeV12[]): void {
	const stacks = ancestorStacks(nodes);
	for (const [index, node] of nodes.entries()) {
		if (node.kind !== 'folder') continue;
		if (requiredAncestorStack(stacks, index).length > TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth) {
			throw new TrackFolderEditError(
				TRACK_FOLDER_EDIT_CODES.depthExceeded,
				`Track folder ${node.id} exceeds maximum folder depth ${String(TRACK_HIERARCHY_V12_LIMITS.maximumFolderDepth)}.`,
			);
		}
	}
}

function requiredTrackNode<T extends TrackNodeV12>(nodes: readonly T[], index: number): T {
	const node = nodes[index];
	if (!node) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownNode,
			'The track hierarchy contains an incomplete node span.',
		);
	}
	return node;
}

function requiredAncestorStack(stacks: readonly (readonly string[])[], index: number): readonly string[] {
	const stack = stacks[index];
	if (!stack) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownNode,
			'The track hierarchy contains an incomplete ancestor stack.',
		);
	}
	return stack;
}

function assertBudgets(
	sequences: readonly MutableHierarchySequenceV12[],
	nextNodes: readonly TrackNodeV12[],
	sequenceId: string,
): void {
	let nodes = 0;
	let folders = 0;
	for (const sequence of sequences) {
		const entries = sequence.id === sequenceId ? nextNodes : sequence.trackNodes;
		nodes += entries.length;
		folders += entries.filter(({ kind }) => kind === 'folder').length;
	}
	if (nodes > TRACK_HIERARCHY_V12_LIMITS.maximumNodes) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.nodeBudget,
			`Track hierarchy cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumNodes)} total nodes.`,
		);
	}
	if (folders > TRACK_HIERARCHY_V12_LIMITS.maximumFolders) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.folderBudget,
			`Track hierarchy cannot exceed ${String(TRACK_HIERARCHY_V12_LIMITS.maximumFolders)} folders.`,
		);
	}
}

function requireSequence(
	sequences: readonly MutableHierarchySequenceV12[],
	sequenceId: string,
): MutableHierarchySequenceV12 {
	const sequence = sequences.find((candidate) => candidate.id === sequenceId);
	if (sequence === undefined) {
		throw new TrackFolderEditError(
			TRACK_FOLDER_EDIT_CODES.unknownSequence,
			`Unknown sequence: ${sequenceId}.`,
		);
	}
	return sequence;
}

function syncSequenceTrackIds(sequence: MutableHierarchySequenceV12): void {
	if (!Array.isArray(sequence.trackIds)) return;
	sequence.trackIds = sequence.trackNodes
		.filter(({ kind }) => kind === 'track')
		.map(({ id }) => id);
}
