/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverPhotoLibraryRestoreV1 } from '../src/lightscaper/storage/photo-library-restore-recovery-v1.ts';
import { photoLibraryRestoreCommitV1, PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1,
	photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const allocation = { schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: 'c'.repeat(32),
	namespaceToken: 'c'.repeat(32), ownerToken: 'd'.repeat(32), catalogId: 'catalog' };
const previous = { schemaVersion: 1, kind: 'photo-library', catalogId: 'old' };
function journal(ready = false) {
	return { schemaVersion: 1, kind: 'photo-library-restore-journal', allocation, expectedPointer: previous,
		phase: ready ? 'ready' : 'staging', candidateReceipt: ready ? { schemaVersion: 1, kind: 'photo-library-restore-ready',
			catalogId: 'catalog', ...photoLibraryRestoreNamespacesV1(allocation), catalogRevision: 2,
			photoCount: 0, stackCount: 0, savedCollectionCount: 0, indexRevision: 0, originalCount: 0, originalByteLength: 0 } : null };
}
function fixture() {
	const values = new Map<string, unknown>([[PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, previous]]);
	const calls: string[] = [], names = photoLibraryRestoreNamespacesV1(allocation);
	const statuses = new Map<string, 'absent' | 'owned' | 'foreign'>([[names.catalogDatabaseName, 'owned'], [names.mediaDatabaseName, 'owned']]);
	let readHook: ((key: string) => void) | null = null;
	const settings = { async get(key: string) { calls.push(`read:${key}`); readHook?.(key); return values.get(key); },
		async deleteIfCurrent(key: string, expected: unknown) {
			calls.push('delete-journal'); if (values.get(key) !== expected) return false;
			values.delete(key); return true;
		} };
	const locks = { async request(name: string, _options: unknown, run: (lock: Lock) => Promise<unknown>) {
		calls.push(`lock:${name}`); return run({ name, mode: 'exclusive' });
	} } as unknown as Pick<LockManager, 'request'>;
	return { values, calls, statuses, names, hook: (value: (key: string) => void) => { readHook = value; },
		options: { settings, locks, namespaces: {
			async inspect(name: string) { calls.push(`inspect:${name}`); return statuses.get(name)!; },
			async remove(name: string) { calls.push(`remove:${name}`); statuses.set(name, 'absent'); },
		} } };
}

test('a journal persisted before either schema exists retires cleanly without creating or deleting a namespace', async () => {
	const f = fixture(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal());
	for (const name of f.statuses.keys()) f.statuses.set(name, 'absent');
	assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'discarded');
	assert.equal(f.calls.some(value => value.startsWith('remove:')), false);
	assert.equal(f.values.has(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1), false);
	assert.equal(f.values.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1), previous);
});

test('unpublished owned resources are reclaimed only under namespace and initialization leases', async () => {
	const f = fixture(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal());
	assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'discarded');
	assert.deepEqual(f.calls.filter(value => value.startsWith('remove:')), [`remove:${f.names.catalogDatabaseName}`, `remove:${f.names.mediaDatabaseName}`]);
	const admission = f.calls.indexOf('lock:lightscaper-photo-catalog:photo-library-default');
	assert.equal(admission < f.calls.indexOf(`remove:${f.names.catalogDatabaseName}`), true);
	assert.equal(f.values.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1), previous);
});

test('foreign markers preserve both namespaces and the recovery journal', async () => {
	const f = fixture(), value = journal(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, value);
	f.statuses.set(f.names.mediaDatabaseName, 'foreign');
	assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'protected');
	assert.equal(f.calls.some(call => call.startsWith('remove:')), false);
	assert.equal(f.values.get(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1), value);
});

test('every existing permanent record protects published namespaces, including malformed history', async () => {
	for (const history of [{}, { schemaVersion: 3 }, photoLibraryRestoreCommitV1(journal(true))]) {
		const f = fixture(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal());
		f.values.set(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken), history);
		assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'protected');
		assert.equal(f.calls.some(call => call.startsWith('remove:')), false);
	}
});

test('matching permanent history reconciles publication even when a later pointer has won', async () => {
	const f = fixture(), value = journal(true), committed = photoLibraryRestoreCommitV1(value);
	f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, value);
	f.values.set(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken), committed);
	f.values.set(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { ...previous, catalogId: 'later' });
	const result = await recoverPhotoLibraryRestoreV1(f.options);
	assert.equal(result.outcome, 'published');
	assert.equal(f.calls.some(call => call.startsWith('remove:')), false);
	assert.equal(f.values.has(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1), false);
	assert.equal((f.values.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1) as { catalogId: string }).catalogId, 'later');
});

test('an active candidate pointer protects resources even if permanent history is absent', async () => {
	const f = fixture(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal());
	f.values.set(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 2, kind: 'photo-library', catalogId: 'catalog', namespaceToken: allocation.namespaceToken });
	assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'protected');
	assert.equal(f.calls.some(call => call.startsWith('remove:')), false);
});

test('history is rechecked after ownership probes and any intervening commit vetoes every deletion', async () => {
	const f = fixture(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal());
	let histories = 0;
	f.hook(key => { if (key === photoLibraryRestoreCommitKeyV1(allocation.namespaceToken) && ++histories === 2) f.values.set(key, {}); });
	assert.equal((await recoverPhotoLibraryRestoreV1(f.options)).outcome, 'protected');
	assert.equal(f.calls.some(call => call.startsWith('remove:')), false);
});

test('unreadable history, malformed journals and native delete failures retain recovery evidence', async () => {
	const unreadable = fixture(), raw = journal(); unreadable.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, raw);
	unreadable.hook(key => { if (key.startsWith('photo-library:restore-commit')) throw new Error('History unavailable.'); });
	assert.equal((await recoverPhotoLibraryRestoreV1(unreadable.options)).outcome, 'protected');
	assert.equal(unreadable.calls.some(call => call.startsWith('remove:')), false);
	const malformed = fixture(); malformed.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, { allocation });
	assert.equal((await recoverPhotoLibraryRestoreV1(malformed.options)).outcome, 'protected');
	const failed = fixture(); failed.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, raw);
	failed.options.namespaces.remove = () => Promise.reject(new Error('Native delete failed.'));
	await assert.rejects(recoverPhotoLibraryRestoreV1(failed.options), /native delete/iu);
	assert.equal(failed.values.get(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1), raw);
});

test('opaque cancellation joins a held native deletion and retains the journal for remaining recovery', async () => {
	const f = fixture(), value = journal(), stop = new AbortController(); f.values.set(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, value);
	let release!: () => void, entered!: () => void, settled = false, inspected = 0, failure: unknown;
	const held = new Promise<void>(resolve => { release = resolve; }), admitted = new Promise<void>(resolve => { entered = resolve; });
	const opaque = new Proxy({}, { get() { inspected++; throw new Error('Opaque reason read.'); },
		getPrototypeOf() { inspected++; throw new Error('Opaque reason prototype read.'); } });
	f.options.namespaces.remove = async name => { entered(); await held; f.statuses.set(name, 'absent'); };
	const running = recoverPhotoLibraryRestoreV1({ ...f.options, signal: stop.signal }).then(() => { settled = true; }, error => {
		failure = error; settled = true;
	});
	await admitted; stop.abort(opaque); await Promise.resolve();
	assert.equal(settled, false); assert.equal(f.calls.includes('delete-journal'), false);
	release(); await running;
	assert.equal(failure, opaque); assert.equal(inspected, 0);
	assert.equal(f.values.get(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1), value);
	assert.equal(f.statuses.get(f.names.mediaDatabaseName), 'owned');
});
