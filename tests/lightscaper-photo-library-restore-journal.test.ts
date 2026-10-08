/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoLibraryRestoreJournalV1, normalizePhotoLibraryRestoreReadyReceiptV1,
	normalizePhotoLibraryRestoreCommitV1, photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1,
	classifyPhotoLibraryRestoreCommitV1, resolveCommittedPhotoLibraryLocationV2 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const allocation = { schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog' };
const names = photoLibraryRestoreNamespacesV1(allocation);
const receipt = { schemaVersion: 1, kind: 'photo-library-restore-ready', catalogId: 'catalog', ...names,
	catalogRevision: Number.MAX_SAFE_INTEGER, photoCount: 3, stackCount: 1, savedCollectionCount: 2, indexRevision: 0,
	originalCount: 2, originalByteLength: 10 };
const expectedPointer = { catalogId: 'old', kind: 'photo-library', schemaVersion: 1 };
const journal = { schemaVersion: 1, kind: 'photo-library-restore-journal', allocation, expectedPointer, phase: 'ready', candidateReceipt: receipt };

test('ready journal binds complete scalar receipt and preserves detached expected CAS order', () => {
	const raw = structuredClone(journal), admitted = normalizePhotoLibraryRestoreJournalV1(raw);
	raw.allocation.ownerToken = 'c'.repeat(32); raw.expectedPointer.catalogId = 'changed'; raw.candidateReceipt.photoCount = 8;
	assert.deepEqual(admitted, journal); assert.deepEqual(Object.keys(admitted.expectedPointer), Object.keys(expectedPointer));
	for (const object of [admitted, admitted.allocation, admitted.expectedPointer, admitted.candidateReceipt]) assert.equal(Object.isFrozen(object), true);
});

test('staging intent is physically explicit before any candidate exists and cannot publish', () => {
	const staging = normalizePhotoLibraryRestoreJournalV1({ ...journal, phase: 'staging', candidateReceipt: null });
	assert.equal(staging.candidateReceipt, null); assert.throws(() => photoLibraryRestoreCommitV1(staging));
	assert.throws(() => normalizePhotoLibraryRestoreJournalV1({ ...journal, candidateReceipt: null }));
	assert.throws(() => normalizePhotoLibraryRestoreJournalV1({ ...journal, phase: 'staging' }));
});

test('receipt rejects wrong component names/catalog, inconsistent counts and noncanonical numbers', () => {
	for (const delta of [{ catalogId: 'other' }, { catalogDatabaseName: 'other' }, { mediaDatabaseName: 'other' },
		{ catalogRevision: -0 }, { catalogRevision: Number.MAX_SAFE_INTEGER + 1 }, { stackCount: 4 }, { savedCollectionCount: 10_001 },
		{ originalCount: 4 }, { originalCount: 0 }, { originalByteLength: 0 }, { indexRevision: 1 }, { photoCount: 10_000_001 },
		{ schemaVersion: 2 }, { extra: true }]) assert.throws(() => normalizePhotoLibraryRestoreReadyReceiptV1({ ...receipt, ...delta }, allocation));
	const empty = { ...receipt, photoCount: 0, stackCount: 0, originalCount: 0, originalByteLength: 0 };
	assert.deepEqual(normalizePhotoLibraryRestoreReadyReceiptV1(empty, allocation), empty);
});

test('permanent commit protects published namespace independently of subsequent pointer winners', () => {
	const commit = photoLibraryRestoreCommitV1(journal);
	assert.equal(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken), `photo-library:restore-commit-v1:${allocation.namespaceToken}`);
	assert.equal(classifyPhotoLibraryRestoreCommitV1(undefined, commit), 'absent');
	assert.equal(classifyPhotoLibraryRestoreCommitV1(structuredClone(commit), commit), 'matching');
	for (const value of [null, { ...commit, schemaVersion: 2 }, { ...commit, extra: true },
		{ ...commit, allocation: { ...allocation, ownerToken: 'c'.repeat(32) } }, { hostile: true }]) {
		assert.equal(classifyPhotoLibraryRestoreCommitV1(value, commit), 'protected');
	}
	assert.throws(() => photoLibraryRestoreCommitKeyV1('A'.repeat(32)));
	assert.deepEqual(normalizePhotoLibraryRestoreCommitV1(commit), commit);
	assert.deepEqual(resolveCommittedPhotoLibraryLocationV2(commit.replacementPointer, commit),
		{ catalogId: 'catalog', namespaceToken: allocation.namespaceToken, ...names });
	assert.throws(() => resolveCommittedPhotoLibraryLocationV2({ ...commit.replacementPointer, catalogId: 'other' }, commit));
});

test('closed journal and commit boundaries suppress getters, toJSON and Proxy value inspection', () => {
	let inspected = 0; const hostile = () => { inspected++; throw new Error('Behavior invoked.'); };
	for (const value of [{ ...journal, get allocation() { return hostile(); } }, { ...journal, toJSON: hostile },
		{ ...journal, [Symbol('unknown')]: true }, { ...journal, expectedPointer: { ...expectedPointer, get catalogId() { return hostile(); } } }]) {
		assert.throws(() => normalizePhotoLibraryRestoreJournalV1(value));
	}
	const commit = photoLibraryRestoreCommitV1(journal);
	assert.deepEqual(normalizePhotoLibraryRestoreCommitV1(new Proxy(commit, { get: hostile })), commit);
	assert.equal(classifyPhotoLibraryRestoreCommitV1({ ...commit, get candidateReceipt() { return hostile(); } }, commit), 'protected');
	assert.equal(inspected, 0);
});
