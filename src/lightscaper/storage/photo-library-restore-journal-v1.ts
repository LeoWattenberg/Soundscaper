/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { integer, oneOf } from '../catalog/value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { readPhotoLibraryLocationPointerV2, photoLibraryRestorePointerV2, resolvePhotoLibraryLocationV2,
	type PhotoLibraryLocationPointer, type PhotoLibraryLocationPointerV2, type PhotoLibraryLocationV2 } from './photo-library-location-v2.ts';

export const PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1 = 'photo-library:restore-active-v1';
export const PHOTO_LIBRARY_RESTORE_JOURNAL_MAXIMUM_BYTES_V1 = 4_096;
export const PHOTO_LIBRARY_RESTORE_COMMIT_MAXIMUM_BYTES_V1 = 4_096;
export const PHOTO_LIBRARY_RESTORE_READY_MAXIMUM_BYTES_V1 = 2_048;
export interface PhotoLibraryRestoreReadyReceiptV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-library-restore-ready';
	readonly catalogId: string;
	readonly catalogDatabaseName: string;
	readonly mediaDatabaseName: string;
	readonly catalogRevision: number;
	readonly photoCount: number;
	readonly stackCount: number;
	readonly savedCollectionCount: number;
	readonly indexRevision: 0;
	readonly originalCount: number;
	readonly originalByteLength: number;
}
export interface PhotoLibraryRestoreJournalV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-library-restore-journal';
	readonly allocation: Readonly<PhotoLibraryRestoreAllocationV1>;
	readonly expectedPointer: PhotoLibraryLocationPointer;
	readonly phase: 'staging' | 'ready';
	readonly candidateReceipt: Readonly<PhotoLibraryRestoreReadyReceiptV1> | null;
}
export interface PhotoLibraryRestoreCommitV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-library-restore-commit';
	readonly allocation: Readonly<PhotoLibraryRestoreAllocationV1>;
	readonly previousPointer: PhotoLibraryLocationPointer;
	readonly replacementPointer: Readonly<PhotoLibraryLocationPointerV2>;
	readonly candidateReceipt: Readonly<PhotoLibraryRestoreReadyReceiptV1>;
}
const READY_FIELDS = ['schemaVersion', 'kind', 'catalogId', 'catalogDatabaseName', 'mediaDatabaseName', 'catalogRevision',
	'photoCount', 'stackCount', 'savedCollectionCount', 'indexRevision', 'originalCount', 'originalByteLength'] as const;
const JOURNAL_FIELDS = ['schemaVersion', 'kind', 'allocation', 'expectedPointer', 'phase', 'candidateReceipt'] as const;
const COMMIT_FIELDS = ['schemaVersion', 'kind', 'allocation', 'previousPointer', 'replacementPointer', 'candidateReceipt'] as const;

/** A detached scalar description; the native owners and cooperative host prove readiness/custody. */
export function normalizePhotoLibraryRestoreReadyReceiptV1(value: unknown, allocationValue: unknown): Readonly<PhotoLibraryRestoreReadyReceiptV1> {
	const allocation = normalizePhotoLibraryRestoreAllocationV1(allocationValue), names = photoLibraryRestoreNamespacesV1(allocation);
	const input = readClosedDomainRecord(value, 'restore readiness receipt', READY_FIELDS);
	const field = (key: string) => readClosedDomainField(input, key, 'restore readiness receipt');
	if (field('schemaVersion') !== 1 || field('kind') !== 'photo-library-restore-ready') throw new RangeError('Unsupported restore readiness schema.');
	if (field('catalogId') !== allocation.catalogId || field('catalogDatabaseName') !== names.catalogDatabaseName
		|| field('mediaDatabaseName') !== names.mediaDatabaseName) throw new TypeError('Restore readiness belongs to another allocation.');
	const count = (key: string, maximum = Number.MAX_SAFE_INTEGER): number => {
		const raw = field(key); if (Object.is(raw, -0)) throw new RangeError('Restore readiness integers must be canonical.');
		return integer(raw, 0, maximum, `restore ${key}`);
	};
	const photoCount = count('photoCount', 10_000_000), originalCount = count('originalCount', photoCount), originalByteLength = count('originalByteLength');
	if ((photoCount === 0) !== (originalCount === 0) || (originalCount === 0) !== (originalByteLength === 0)) throw new TypeError('Restore original counts and bytes disagree.');
	const receipt = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-library-restore-ready' as const,
		catalogId: allocation.catalogId, ...names, catalogRevision: count('catalogRevision'), photoCount,
		stackCount: count('stackCount', photoCount), savedCollectionCount: count('savedCollectionCount', 10_000),
		indexRevision: count('indexRevision', 0) as 0, originalCount, originalByteLength });
	assertBytes(receipt, PHOTO_LIBRARY_RESTORE_READY_MAXIMUM_BYTES_V1); return receipt;
}

export function normalizePhotoLibraryRestoreJournalV1(value: unknown): Readonly<PhotoLibraryRestoreJournalV1> {
	const input = readClosedDomainRecord(value, 'restore journal', JOURNAL_FIELDS);
	const field = (key: string) => readClosedDomainField(input, key, 'restore journal');
	if (field('schemaVersion') !== 1 || field('kind') !== 'photo-library-restore-journal') throw new RangeError('Unsupported restore journal schema.');
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field('allocation'));
	const expectedPointer = previousPointer(field('expectedPointer'), allocation), phase = oneOf(field('phase'), ['staging', 'ready'] as const, 'restore phase');
	const rawReceipt = field('candidateReceipt');
	if ((phase === 'staging') !== (rawReceipt === null)) throw new TypeError('Restore journal phase and readiness disagree.');
	const candidateReceipt = rawReceipt === null ? null : normalizePhotoLibraryRestoreReadyReceiptV1(rawReceipt, allocation);
	const journal = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-library-restore-journal' as const,
		allocation, expectedPointer, phase, candidateReceipt });
	assertBytes(journal, PHOTO_LIBRARY_RESTORE_JOURNAL_MAXIMUM_BYTES_V1); return journal;
}

export function normalizePhotoLibraryRestoreCommitV1(value: unknown): Readonly<PhotoLibraryRestoreCommitV1> {
	const input = readClosedDomainRecord(value, 'restore permanent commit', COMMIT_FIELDS);
	const field = (key: string) => readClosedDomainField(input, key, 'restore permanent commit');
	if (field('schemaVersion') !== 1 || field('kind') !== 'photo-library-restore-commit') throw new RangeError('Unsupported restore commit schema.');
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field('allocation')), replacementPointer = photoLibraryRestorePointerV2(allocation);
	if (!samePointer(readPhotoLibraryLocationPointerV2(field('replacementPointer')), replacementPointer)) throw new TypeError('Restore commit replacement differs from its allocation.');
	const commit = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-library-restore-commit' as const, allocation,
		previousPointer: previousPointer(field('previousPointer'), allocation), replacementPointer,
		candidateReceipt: normalizePhotoLibraryRestoreReadyReceiptV1(field('candidateReceipt'), allocation) });
	assertBytes(commit, PHOTO_LIBRARY_RESTORE_COMMIT_MAXIMUM_BYTES_V1); return commit;
}

export function photoLibraryRestoreCommitV1(value: unknown): Readonly<PhotoLibraryRestoreCommitV1> {
	const journal = normalizePhotoLibraryRestoreJournalV1(value);
	if (journal.phase !== 'ready' || journal.candidateReceipt === null) throw new TypeError('Only a ready restore journal can publish.');
	return normalizePhotoLibraryRestoreCommitV1({ schemaVersion: 1, kind: 'photo-library-restore-commit', allocation: journal.allocation,
		previousPointer: journal.expectedPointer, replacementPointer: photoLibraryRestorePointerV2(journal.allocation), candidateReceipt: journal.candidateReceipt });
}

export function photoLibraryRestoreCommitKeyV1(namespaceToken: string): string {
	if (typeof namespaceToken !== 'string' || !/^[a-f0-9]{32}$/u.test(namespaceToken)) throw new TypeError('Restore commit key requires a namespace token.');
	return `photo-library:restore-commit-v1:${namespaceToken}`;
}

/** Any existing history protects its namespace, even when malformed or from an uncertain writer. */
export function classifyPhotoLibraryRestoreCommitV1(value: unknown, expectedValue: unknown): 'absent' | 'matching' | 'protected' {
	const expected = normalizePhotoLibraryRestoreCommitV1(expectedValue);
	if (value === undefined) return 'absent';
	try {
		const current = normalizePhotoLibraryRestoreCommitV1(value);
		return JSON.stringify(current.allocation) === JSON.stringify(expected.allocation)
			&& JSON.stringify(current.candidateReceipt) === JSON.stringify(expected.candidateReceipt)
			&& samePointer(current.previousPointer, expected.previousPointer) ? 'matching' : 'protected';
	} catch { return 'protected'; }
}

export function resolveCommittedPhotoLibraryLocationV2(pointerValue: unknown, commitValue: unknown): Readonly<PhotoLibraryLocationV2> {
	const pointer = readPhotoLibraryLocationPointerV2(pointerValue), commit = normalizePhotoLibraryRestoreCommitV1(commitValue);
	if (!samePointer(pointer, commit.replacementPointer)) throw new TypeError('Active library differs from its permanent restore commit.');
	return resolvePhotoLibraryLocationV2(pointer, commit.allocation);
}
function previousPointer(value: unknown, allocation: PhotoLibraryRestoreAllocationV1): PhotoLibraryLocationPointer {
	const pointer = readPhotoLibraryLocationPointerV2(value);
	if (pointer.schemaVersion === 2 && pointer.namespaceToken === allocation.namespaceToken) throw new TypeError('A restore requires a fresh namespace distinct from the previous library.');
	return pointer;
}
function samePointer(left: PhotoLibraryLocationPointer, right: PhotoLibraryLocationPointer): boolean {
	return left.schemaVersion === right.schemaVersion && left.catalogId === right.catalogId
		&& (left.schemaVersion === 1 || (right.schemaVersion === 2 && left.namespaceToken === right.namespaceToken));
}
function assertBytes(value: PhotoLibraryRestoreJournalV1 | PhotoLibraryRestoreCommitV1 | PhotoLibraryRestoreReadyReceiptV1, maximum: number): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) throw new RangeError('Restore scalar record exceeds its byte bound.');
}
