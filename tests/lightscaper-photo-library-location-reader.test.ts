/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { photoLibraryRestoreCommitKeyV1, photoLibraryRestoreCommitV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const allocation = Object.freeze({ schemaVersion: 1, kind: 'photo-library-restore-allocation',
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog' });
const previous = Object.freeze({ kind: 'photo-library', catalogId: 'previous', schemaVersion: 1 });
function commit() {
	return photoLibraryRestoreCommitV1({ schemaVersion: 1, kind: 'photo-library-restore-journal', allocation,
		expectedPointer: previous, phase: 'ready', candidateReceipt: { schemaVersion: 1, kind: 'photo-library-restore-ready',
			catalogId: 'catalog', ...photoLibraryRestoreNamespacesV1(allocation), catalogRevision: 9, photoCount: 2,
			stackCount: 1, savedCollectionCount: 1, indexRevision: 0, originalCount: 1, originalByteLength: 4 } });
}

test('legacy pointer selection preserves its stored order and needs no restore history or default initialization', async () => {
	const keys: string[] = [];
	const selected = await readPhotoLibrarySessionLocationV2({ settings: { async get(key: string) { keys.push(key); return previous; } },
		initializeDefault: () => Promise.reject(new Error('Existing library was recreated.')) });
	assert.deepEqual(keys, [PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1]); assert.deepEqual(Object.keys(selected.pointer), Object.keys(previous));
	assert.deepEqual(selected.location, { catalogId: 'previous', namespaceToken: null,
		catalogDatabaseName: 'lightscaper-photo-catalog-v1', mediaDatabaseName: 'lightscaper-photo-media-v2' });
	assert.equal(selected.allocation, null);
});

test('restored selection authenticates permanent history before deriving either selected resource name', async () => {
	const durable = commit(), keys: string[] = [];
	const selected = await readPhotoLibrarySessionLocationV2({ settings: { async get(key: string) {
		keys.push(key); return key === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 ? durable.replacementPointer : durable;
	} }, initializeDefault: () => Promise.reject(new Error('Restored library fell back to legacy storage.')) });
	assert.deepEqual(keys, [PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, photoLibraryRestoreCommitKeyV1(allocation.namespaceToken)]);
	assert.deepEqual(selected.location, { catalogId: 'catalog', namespaceToken: allocation.namespaceToken,
		...photoLibraryRestoreNamespacesV1(allocation) });
	assert.deepEqual(selected.allocation, allocation); assert.equal(Object.isFrozen(selected.allocation), true);
});

test('missing, malformed and mismatched permanent history never fall back to the default library', async () => {
	const durable = commit();
	for (const history of [undefined, {}, { ...durable, allocation: { ...allocation, catalogId: 'foreign' } }]) {
		let initialized = false;
		await assert.rejects(readPhotoLibrarySessionLocationV2({ settings: { async get(key: string) {
			return key === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 ? durable.replacementPointer : history;
		} }, initializeDefault: async () => { initialized = true; return previous; } }));
		assert.equal(initialized, false);
	}
});

test('an absent pointer invokes the captured default initializer once and admits its closed pointer', async () => {
	let initialized = 0;
	const selected = await readPhotoLibrarySessionLocationV2({ settings: { get: async () => undefined },
		initializeDefault: async () => { initialized++; return previous; } });
	assert.equal(initialized, 1); assert.deepEqual(selected.pointer, previous);
});

test('the fixed-anchor reader and initializer methods are captured before the first awaited read', async () => {
	const durable = commit();
	const settings = { async get(key: string) {
		if (key === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1) {
			settings.get = () => Promise.reject(new Error('Replacement reader was used.'));
			return durable.replacementPointer;
		}
		return durable;
	} };
	assert.equal((await readPhotoLibrarySessionLocationV2({ settings,
		initializeDefault: async () => previous })).location.namespaceToken, allocation.namespaceToken);
});

test('cancelled pointer reads preserve an opaque reason and never read commit history', async () => {
	const stop = new AbortController(); let reads = 0, inspected = 0, failure: unknown;
	const opaque = new Proxy({}, { get() { inspected++; throw new Error('Reason read.'); },
		getPrototypeOf() { inspected++; throw new Error('Reason prototype read.'); } });
	try {
		await readPhotoLibrarySessionLocationV2({ settings: { async get() { reads++; stop.abort(opaque); return commit().replacementPointer; } },
			initializeDefault: async () => previous }, stop.signal);
	} catch (error) { failure = error; }
	assert.equal(failure, opaque); assert.equal(inspected, 0); assert.equal(reads, 1);
});

test('cancellation during default initialization vetoes subsequent resource selection without inspecting the reason', async () => {
	const stop = new AbortController(); let inspected = 0, failure: unknown;
	const opaque = new Proxy({}, { get() { inspected++; throw new Error('Reason read.'); },
		getPrototypeOf() { inspected++; throw new Error('Reason prototype read.'); } });
	try {
		await readPhotoLibrarySessionLocationV2({ settings: { get: async () => undefined },
			initializeDefault: async () => { stop.abort(opaque); return previous; } }, stop.signal);
	} catch (error) { failure = error; }
	assert.equal(failure, opaque); assert.equal(inspected, 0);
});
