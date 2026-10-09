/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDevelopV1 } from './develop-state.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDevelopV1 } from './types.ts';
import { array, field, id, integer, name, record, unique, utcTimestamp } from './value-validation.ts';

export interface PhotoDevelopHistoryEntryV1 {
	readonly label: string;
	/** Legacy settings commands have no event clock; retain unknown time as null. */
	readonly createdAt: string | null;
	readonly develop: PhotoDevelopV1;
}

export interface PhotoDevelopSnapshotV1 {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly develop: PhotoDevelopV1;
}

/** One version's authored settings; original identity and catalog authority are absent. */
export interface PhotoDevelopWorkspaceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-develop-workspace';
	readonly entries: readonly PhotoDevelopHistoryEntryV1[];
	readonly cursor: number;
	readonly snapshots: readonly PhotoDevelopSnapshotV1[];
}

type Step = Readonly<{ label: string; createdAt: string | null }>;
const MAXIMUM_SNAPSHOTS = 100;

export function normalizePhotoDevelopWorkspaceV1(value: unknown): PhotoDevelopWorkspaceV1 {
	const input = record(value, 'photo develop workspace', ['schemaVersion', 'kind', 'entries', 'cursor', 'snapshots']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported photo develop workspace version.');
	if (field(input, 'kind') !== 'photo-develop-workspace') throw new RangeError('Unsupported photo develop workspace kind.');
	let admittedBytes = 0;
	const admit = <Value>(candidate: Value): Value => {
		admittedBytes += byteLength(candidate);
		assertByteLength(admittedBytes);
		return candidate;
	};
	const entries = array(field(input, 'entries'), 'photo develop history', 1, LIMITS.maximumHistoryEntries)
		.map(candidate => admit(normalizeEntry(candidate)));
	const cursor = integer(field(input, 'cursor'), 0, entries.length - 1, 'photo develop history cursor');
	const snapshots = array(field(input, 'snapshots'), 'photo develop snapshots', 0, MAXIMUM_SNAPSHOTS)
		.map(candidate => admit(normalizeSnapshot(candidate)));
	unique(snapshots.map(snapshot => snapshot.id), 'photo develop snapshots');
	return freezeWorkspace(entries, cursor, snapshots);
}

export function createPhotoDevelopWorkspaceV1(develop: unknown, step: Step): PhotoDevelopWorkspaceV1 {
	return freezeWorkspace([normalizeEntry({ ...readStep(step), develop })], 0, []);
}

/** An edit appends one immutable state, discards redo, then evicts oldest history under the bounded budget. */
export function commitPhotoDevelopWorkspaceV1(value: unknown, develop: unknown, step: Step): PhotoDevelopWorkspaceV1 {
	const workspace = normalizePhotoDevelopWorkspaceV1(value);
	const next = normalizeEntry({ ...readStep(step), develop });
	if (JSON.stringify(next.develop) === JSON.stringify(workspace.entries[workspace.cursor]!.develop)) return workspace;
	const entries = [...workspace.entries.slice(0, workspace.cursor + 1), next].slice(-LIMITS.maximumHistoryEntries);
	while (byteLength(workspaceValue(entries, entries.length - 1, workspace.snapshots)) > LIMITS.maximumDocumentBytes) {
		if (entries.length === 1) throw new RangeError('Photo develop workspace exceeds its byte budget.');
		entries.shift();
	}
	return freezeWorkspace(entries, entries.length - 1, workspace.snapshots);
}

/** Selecting history retains every recorded redo state until the next edit. */
export function selectPhotoDevelopHistoryV1(value: unknown, cursorValue: number): PhotoDevelopWorkspaceV1 {
	const workspace = normalizePhotoDevelopWorkspaceV1(value);
	const cursor = integer(cursorValue, 0, workspace.entries.length - 1, 'photo develop history cursor');
	return freezeWorkspace(workspace.entries, cursor, workspace.snapshots);
}

/** Snapshot settings are captured once. A duplicate identity cannot replace their contents. */
export function savePhotoDevelopSnapshotV1(value: unknown,
	request: Readonly<{ id: string; name: string; createdAt: string }>): PhotoDevelopWorkspaceV1 {
	const workspace = normalizePhotoDevelopWorkspaceV1(value);
	const input = record(request, 'photo develop snapshot request', ['id', 'name', 'createdAt']);
	const snapshot = normalizeSnapshot({ id: field(input, 'id'), name: field(input, 'name'), createdAt: field(input, 'createdAt'),
		develop: workspace.entries[workspace.cursor]!.develop });
	if (workspace.snapshots.some(candidate => candidate.id === snapshot.id)) throw new RangeError('Duplicate photo develop snapshot ID.');
	if (workspace.snapshots.length === MAXIMUM_SNAPSHOTS) throw new RangeError('Photo develop snapshot capacity is exhausted.');
	return freezeWorkspace(workspace.entries, workspace.cursor, [...workspace.snapshots, snapshot]);
}

export function restorePhotoDevelopSnapshotV1(value: unknown,
	request: Readonly<{ snapshotId: string; label: string; createdAt: string }>): PhotoDevelopWorkspaceV1 {
	const workspace = normalizePhotoDevelopWorkspaceV1(value);
	const input = record(request, 'restore photo develop snapshot', ['snapshotId', 'label', 'createdAt']);
	const snapshotId = id(field(input, 'snapshotId'), 'photo develop snapshot ID');
	const snapshot = workspace.snapshots.find(candidate => candidate.id === snapshotId);
	if (!snapshot) throw new ReferenceError('The photo develop snapshot is missing.');
	return commitPhotoDevelopWorkspaceV1(workspace, snapshot.develop, { label: name(field(input, 'label'), 'photo develop history label'),
		createdAt: utcTimestamp(field(input, 'createdAt'), 'photo develop history time') });
}

/** Explicit deletion releases only this snapshot; it cannot edit active settings or historical states. */
export function deletePhotoDevelopSnapshotV1(value: unknown, snapshotIdValue: string): PhotoDevelopWorkspaceV1 {
	const workspace = normalizePhotoDevelopWorkspaceV1(value);
	const snapshotId = id(snapshotIdValue, 'photo develop snapshot ID');
	if (!workspace.snapshots.some(snapshot => snapshot.id === snapshotId)) throw new ReferenceError('The photo develop snapshot is missing.');
	return freezeWorkspace(workspace.entries, workspace.cursor, workspace.snapshots.filter(snapshot => snapshot.id !== snapshotId));
}

export function serializePhotoDevelopWorkspaceV1(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopWorkspaceV1(value));
}

export function parsePhotoDevelopWorkspaceV1(value: string): PhotoDevelopWorkspaceV1 {
	if (typeof value !== 'string') throw new TypeError('Photo develop workspace requires JSON text.');
	assertByteLength(value.length);
	assertByteLength(new TextEncoder().encode(value).byteLength);
	const decoded: unknown = JSON.parse(value);
	return normalizePhotoDevelopWorkspaceV1(decoded);
}

function readStep(value: unknown): Step {
	const input = record(value, 'photo develop history step', ['label', 'createdAt']);
	return Object.freeze({ label: name(field(input, 'label'), 'photo develop history label'),
		createdAt: historyTime(field(input, 'createdAt')) });
}

function normalizeEntry(value: unknown): PhotoDevelopHistoryEntryV1 {
	const input = record(value, 'photo develop history entry', ['label', 'createdAt', 'develop']);
	return Object.freeze({ label: name(field(input, 'label'), 'photo develop history label'),
		createdAt: historyTime(field(input, 'createdAt')),
		develop: normalizePhotoDevelopV1(field(input, 'develop')) });
}

function normalizeSnapshot(value: unknown): PhotoDevelopSnapshotV1 {
	const input = record(value, 'photo develop snapshot', ['id', 'name', 'createdAt', 'develop']);
	return Object.freeze({ id: id(field(input, 'id'), 'photo develop snapshot ID'),
		name: name(field(input, 'name'), 'photo develop snapshot name'),
		createdAt: utcTimestamp(field(input, 'createdAt'), 'photo develop snapshot time'),
		develop: normalizePhotoDevelopV1(field(input, 'develop')) });
}

function workspaceValue(entries: readonly PhotoDevelopHistoryEntryV1[], cursor: number, snapshots: readonly PhotoDevelopSnapshotV1[]) {
	return { schemaVersion: 1 as const, kind: 'photo-develop-workspace' as const, entries, cursor, snapshots };
}

function freezeWorkspace(entries: readonly PhotoDevelopHistoryEntryV1[], cursor: number,
	snapshots: readonly PhotoDevelopSnapshotV1[]): PhotoDevelopWorkspaceV1 {
	const result = Object.freeze({ ...workspaceValue(entries, cursor, snapshots), entries: Object.freeze([...entries]),
		snapshots: Object.freeze([...snapshots]) });
	assertByteLength(byteLength(result));
	return result;
}

function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function historyTime(value: unknown): string | null {
	return value === null ? null : utcTimestamp(value, 'photo develop history time');
}
function assertByteLength(value: number): void {
	if (value > LIMITS.maximumDocumentBytes) throw new RangeError('Photo develop workspace exceeds its byte budget.');
}
