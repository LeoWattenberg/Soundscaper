/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoMediaRestoreCandidateV1 } from '../src/lightscaper/storage/photo-media-restore-candidate-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { mediaRestoreFixture, mediaRestoreAllocation, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { developPresetArchiveRow as row } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const options = (f: ReturnType<typeof mediaRestoreFixture>, developPresets: Readonly<{ revision: number; presetCount: number }> | null = null, signal?: AbortSignal) => ({
	indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(0), developPresets, signal,
});
const key = photoDevelopPresetsKeyV1('catalog-1');

test('Fresh candidate preserves exact archived preset revisions/full bodies and positive empty rows', async () => {
	for (const value of [row(Number.MAX_SAFE_INTEGER, 16), row(91, 0)]) {
		const f = mediaRestoreFixture(), catalog = await f.catalog([]), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: value.revision, presetCount: value.presets.length }));
		try {
			await owner.writeDevelopPresets(value); assert.equal((await owner.finish()).photoCount, 0);
			assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').find(record => record.key === key), { key, value });
		} finally { await owner.rollback(); await catalog.rollback(); }
	}
});

test('Absent profile creates no preset row and refuses injected physical state or missing declared delivery', async () => {
	for (const inject of [false, true]) {
		const f = mediaRestoreFixture(), catalog = await f.catalog([]), owner = await createPhotoMediaRestoreCandidateV1(options(f));
		try {
			if (inject) { f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key, value: row() }); await assert.rejects(owner.finish(), /preset|absen/iu); }
			else { await owner.finish(); assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').some(record => record.key === key), false); }
		} finally { await owner.rollback(); await catalog.rollback(); }
	}
	const f = mediaRestoreFixture(), catalog = await f.catalog([]), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }));
	try { await assert.rejects(owner.finish(), /preset|deliver/iu); } finally { await owner.rollback(); await catalog.rollback(); }
});

test('Closed preset header refuses accessors/ranges before native resources, and writes detach before the first await', async () => {
	let inspected = 0;
	for (const value of [{ revision: 0, presetCount: 2 }, { revision: 91, presetCount: 17 }, { revision: 91, presetCount: 2, extra: true },
		Object.defineProperty({ revision: 91, presetCount: 2 }, 'revision', { enumerable: true, get() { inspected++; return 91; } })]) {
		const f = mediaRestoreFixture(); await assert.rejects(createPhotoMediaRestoreCandidateV1(options(f, value))); assert.equal(f.opens.length, 0);
	} assert.equal(inspected, 0);
	const f = mediaRestoreFixture(), catalog = await f.catalog([]), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }));
	try {
		const value = structuredClone(row()), work = owner.writeDevelopPresets(value); Object.assign(value.presets[0]!.identity, { name: 'Changed synchronously' });
		await work; await owner.finish(); assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').find(record => record.key === key)?.value, row());
	} finally { await owner.rollback(); await catalog.rollback(); }
});

test('Same-revision coherent body drift and wrapper/catalog corruption refuse before readiness', async () => {
	for (const value of [row(91, 2, 'Changed'), { ...row(), catalogId: 'foreign' }]) {
		const f = mediaRestoreFixture(), catalog = await f.catalog([]), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }));
		try { await owner.writeDevelopPresets(row()); f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key, value }); await assert.rejects(owner.finish(), /preset|foreign/iu); }
		finally { await owner.rollback(); await catalog.rollback(); }
	}
});

test('Malformed or duplicate preset writes fail the candidate without retaining another queued packet', async () => {
	for (const value of [{ ...row(), revision: 92 }, { ...row(), presets: [] }, { ...row(), future: true }]) {
		const f = mediaRestoreFixture(), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }));
		try { await assert.rejects(owner.writeDevelopPresets(value)); await assert.rejects(owner.finish(), /failed|retired/u); }
		finally { await owner.rollback(); }
	}
	const f = mediaRestoreFixture(), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }));
	try { await owner.writeDevelopPresets(row()); await assert.rejects(owner.writeDevelopPresets(row()), /already|deliver/iu); await assert.rejects(owner.finish(), /failed|retired/u); }
	finally { await owner.rollback(); }
});

test('Held instrumented preset request delivery owns exclusion through cancel/rollback until the borrowed callback settles', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), owner = await createPhotoMediaRestoreCandidateV1(options(f, { revision: 91, presetCount: 2 }, stop.signal));
	const entered = deferred<void>(), release = deferred<void>(); let armed = true;
	f.observeTransactions((transaction, stores, mode) => {
		if (!armed || mode !== 'readwrite' || [...(typeof stores === 'string' ? [stores] : stores)].join(',') !== 'settings') return;
		armed = false; const objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = name => {
			const store = objectStore(name), add = store.add.bind(store);
			store.add = (...args) => {
				const native = add(...args); let success: IDBRequest['onsuccess'] = null;
				Object.defineProperty(native, 'onsuccess', { configurable: true, set(value: IDBRequest['onsuccess']) { success = value; },
					get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => { success?.call(native, event); }); }; } });
				return native;
			}; return store;
		};
	});
	let failure: unknown; const work = owner.writeDevelopPresets(row()).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; await assert.rejects(owner.writeDevelopPresets(new Proxy({}, { ownKeys() { throw new Error('Overlap inspected'); } })), /pending/u);
		const reason = Object.freeze({ cancelled: 'preset write' }); stop.abort(reason); const removal = owner.rollback();
		assert.equal(await remainsPending(removal), true); assert.deepEqual(f.deleted, []);
		release.resolve(); await work; await removal; assert.equal(failure, reason);
		assert.equal(f.raw(f.names.mediaDatabaseName).stats.activeTransactions, 0);
	} finally { release.resolve(); await work; await owner.rollback(); }
});
