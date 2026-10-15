/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../../common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';
import { array, field, id, integer, name, record, unique, utcTimestamp } from './value-validation.ts';

export type PhotoDevelopWorkspaceProfileV1 = 'legacy2' | 'current3' | 'current4';
type Develop<Profile extends PhotoDevelopWorkspaceProfileV1> = Profile extends 'legacy2' ? ImageDevelopStateV1 | ImageDevelopStateV2
	: Profile extends 'current3' ? ImageDevelopStateThroughV3 : ImageDevelopStateThroughV4;
export interface PhotoDevelopHistoryEntryForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1> {
	readonly label: string;
	readonly createdAt: string | null;
	readonly develop: Develop<Profile>;
}
export interface PhotoDevelopSnapshotForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1> {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly develop: Develop<Profile>;
}
export interface PhotoDevelopWorkspaceForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1> {
	readonly schemaVersion: Profile extends 'legacy2' ? 2 : Profile extends 'current3' ? 3 : 4;
	readonly kind: 'photo-develop-workspace';
	readonly entries: readonly PhotoDevelopHistoryEntryForProfileV1<Profile>[];
	readonly cursor: number;
	readonly snapshots: readonly PhotoDevelopSnapshotForProfileV1<Profile>[];
}
export type PhotoDevelopHistoryStepV1 = Readonly<{ label: string; createdAt: string | null }>;

const MAXIMUM_SNAPSHOTS = 100;

/** Literal built-in policies only. No caller-provided normalization functions. */
export function normalizePhotoDevelopWorkspaceForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(
	profile: Profile, value: unknown,
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const version = profileVersion(profile);
	const input = record(value, 'photo develop workspace', ['schemaVersion', 'kind', 'entries', 'cursor', 'snapshots']);
	if (field(input, 'schemaVersion') !== version) throw new RangeError('Unsupported photo develop workspace version.');
	if (field(input, 'kind') !== 'photo-develop-workspace') throw new RangeError('Unsupported photo develop workspace kind.');
	let admittedBytes = 0;
	const admit = <Value>(candidate: Value): Value => { admittedBytes += byteLength(candidate); assertByteLength(admittedBytes); return candidate; };
	const entries = array(field(input, 'entries'), 'photo develop history', 1, LIMITS.maximumHistoryEntries).map(candidate => admit(entry(profile, candidate)));
	const cursor = integer(field(input, 'cursor'), 0, entries.length - 1, 'photo develop history cursor');
	const snapshots = array(field(input, 'snapshots'), 'photo develop snapshots', 0, MAXIMUM_SNAPSHOTS).map(candidate => admit(snapshot(profile, candidate)));
	unique(snapshots.map(candidate => candidate.id), 'photo develop snapshots');
	return freezeWorkspace(profile, entries, cursor, snapshots);
}
export function createPhotoDevelopWorkspaceForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(
	profile: Profile, develop: unknown, step: PhotoDevelopHistoryStepV1,
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	profileVersion(profile); return freezeWorkspace(profile, [entry(profile, { ...readStep(step), develop })], 0, []);
}
export function commitPhotoDevelopWorkspaceForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(
	profile: Profile, value: unknown, develop: unknown, step: PhotoDevelopHistoryStepV1,
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const workspace = normalizePhotoDevelopWorkspaceForProfileV1(profile, value), next = entry(profile, { ...readStep(step), develop });
	if (JSON.stringify(next.develop) === JSON.stringify(workspace.entries[workspace.cursor]!.develop)) return workspace;
	const entries = [...workspace.entries.slice(0, workspace.cursor + 1), next].slice(-LIMITS.maximumHistoryEntries);
	while (byteLength(workspaceValue(profile, entries, entries.length - 1, workspace.snapshots)) > LIMITS.maximumDocumentBytes) {
		if (entries.length === 1) throw new RangeError('Photo develop workspace exceeds its byte budget.');
		entries.shift();
	}
	return freezeWorkspace(profile, entries, entries.length - 1, workspace.snapshots);
}
export function selectPhotoDevelopHistoryForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile, value: unknown, cursorValue: number): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const workspace = normalizePhotoDevelopWorkspaceForProfileV1(profile, value);
	return freezeWorkspace(profile, workspace.entries, integer(cursorValue, 0, workspace.entries.length - 1, 'photo develop history cursor'), workspace.snapshots);
}
export function savePhotoDevelopSnapshotForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(
	profile: Profile, value: unknown, request: Readonly<{ id: string; name: string; createdAt: string }>,
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const workspace = normalizePhotoDevelopWorkspaceForProfileV1(profile, value);
	const input = record(request, 'photo develop snapshot request', ['id', 'name', 'createdAt']);
	const next = snapshot(profile, { id: field(input, 'id'), name: field(input, 'name'), createdAt: field(input, 'createdAt'), develop: workspace.entries[workspace.cursor]!.develop });
	if (workspace.snapshots.some(candidate => candidate.id === next.id)) throw new RangeError('Duplicate photo develop snapshot ID.');
	if (workspace.snapshots.length === MAXIMUM_SNAPSHOTS) throw new RangeError('Photo develop snapshot capacity is exhausted.');
	return freezeWorkspace(profile, workspace.entries, workspace.cursor, [...workspace.snapshots, next]);
}
export function restorePhotoDevelopSnapshotForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(
	profile: Profile, value: unknown, request: Readonly<{ snapshotId: string; label: string; createdAt: string }>,
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const workspace = normalizePhotoDevelopWorkspaceForProfileV1(profile, value);
	const input = record(request, 'restore photo develop snapshot', ['snapshotId', 'label', 'createdAt']);
	const snapshotId = id(field(input, 'snapshotId'), 'photo develop snapshot ID');
	const retained = workspace.snapshots.find(candidate => candidate.id === snapshotId);
	if (!retained) throw new ReferenceError('The photo develop snapshot is missing.');
	return commitPhotoDevelopWorkspaceForProfileV1(profile, workspace, retained.develop, { label: name(field(input, 'label'), 'photo develop history label'),
		createdAt: utcTimestamp(field(input, 'createdAt'), 'photo develop history time') });
}
export function deletePhotoDevelopSnapshotForProfileV1<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile, value: unknown, snapshotIdValue: string): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const workspace = normalizePhotoDevelopWorkspaceForProfileV1(profile, value), snapshotId = id(snapshotIdValue, 'photo develop snapshot ID');
	if (!workspace.snapshots.some(candidate => candidate.id === snapshotId)) throw new ReferenceError('The photo develop snapshot is missing.');
	return freezeWorkspace(profile, workspace.entries, workspace.cursor, workspace.snapshots.filter(candidate => candidate.id !== snapshotId));
}
function profileVersion(value: PhotoDevelopWorkspaceProfileV1): 2 | 3 | 4 {
	if (value === 'legacy2') return 2;
	if (value === 'current3') return 3;
	if (value === 'current4') return 4;
	throw new TypeError('Unsupported fixed photo workspace profile.');
}
function readStep(value: unknown): PhotoDevelopHistoryStepV1 {
	const input = record(value, 'photo develop history step', ['label', 'createdAt']);
	return Object.freeze({ label: name(field(input, 'label'), 'photo develop history label'), createdAt: historyTime(field(input, 'createdAt')) });
}
function entry<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile, value: unknown): PhotoDevelopHistoryEntryForProfileV1<Profile> {
	const input = record(value, 'photo develop history entry', ['label', 'createdAt', 'develop']);
	return Object.freeze({ label: name(field(input, 'label'), 'photo develop history label'), createdAt: historyTime(field(input, 'createdAt')),
		develop: develop(profile, field(input, 'develop')) });
}
function snapshot<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile, value: unknown): PhotoDevelopSnapshotForProfileV1<Profile> {
	const input = record(value, 'photo develop snapshot', ['id', 'name', 'createdAt', 'develop']);
	return Object.freeze({ id: id(field(input, 'id'), 'photo develop snapshot ID'), name: name(field(input, 'name'), 'photo develop snapshot name'),
		createdAt: utcTimestamp(field(input, 'createdAt'), 'photo develop snapshot time'), develop: develop(profile, field(input, 'develop')) });
}
function develop<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile, value: unknown): Develop<Profile> {
	profileVersion(profile);
	return (profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(value)
		: profile === 'current3' ? normalizeImageDevelopStateThroughV3(value) : normalizeImageDevelopStateThroughV4(value)) as Develop<Profile>;
}
function workspaceValue<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile,
	entries: readonly PhotoDevelopHistoryEntryForProfileV1<Profile>[], cursor: number, snapshots: readonly PhotoDevelopSnapshotForProfileV1<Profile>[],
) { return { schemaVersion: profileVersion(profile), kind: 'photo-develop-workspace' as const, entries, cursor, snapshots }; }
function freezeWorkspace<Profile extends PhotoDevelopWorkspaceProfileV1>(profile: Profile,
	entries: readonly PhotoDevelopHistoryEntryForProfileV1<Profile>[], cursor: number, snapshots: readonly PhotoDevelopSnapshotForProfileV1<Profile>[],
): PhotoDevelopWorkspaceForProfileV1<Profile> {
	const result = Object.freeze({ ...workspaceValue(profile, entries, cursor, snapshots), entries: Object.freeze([...entries]), snapshots: Object.freeze([...snapshots]) });
	assertByteLength(byteLength(result));
	// The literal profile selects both the strict recipe owner and schema above.
	return result as PhotoDevelopWorkspaceForProfileV1<Profile>;
}
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function historyTime(value: unknown): string | null { return value === null ? null : utcTimestamp(value, 'photo develop history time'); }
function assertByteLength(value: number): void { if (value > LIMITS.maximumDocumentBytes) throw new RangeError('Photo develop workspace exceeds its byte budget.'); }
