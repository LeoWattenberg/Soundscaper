/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryDevelopPortV1, PhotoLibraryDevelopCommandV1 } from '../src/common/editor/photo-library-develop-port-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const photoId = queryPhotoV1().id, time = '2026-10-09T12:00:00.000Z';
const read = { schemaVersion: 1 as const, photoId };
const edited = () => ({ ...queryPhotoV1().versions[0]!.develop,
	effects: [{ id: 'tone', type: 'tone-ladder-v1' as const, enabled: true,
		params: { exposure: 1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } }] });
const record = (): PhotoLibraryDevelopCommandV1 => ({ type: 'record-develop', versionId: 'master',
	develop: edited(), label: 'Exposure', createdAt: time });

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryV1({
		indexedDB: indexedDB as unknown as IDBFactory, databaseName: 'develop-session', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const calls = { initialize: 0, close: 0, locks: 0 };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, initialize: async () => { calls.initialize++; return (await repository.loadCatalog('catalog'))!; },
		closeResources: async () => { calls.close++; },
		exclusive: async (_catalog, operation, signal) => { calls.locks++; return operation(signal); },
		journal: { get: async () => undefined, putIfAbsent: async () => { throw new Error('Unexpected journal write'); },
			deleteIfCurrent: async () => { throw new Error('Unexpected journal write'); } },
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => { throw new Error('Unexpected digest scan'); }, stage: async () => { throw new Error('Unexpected custody stage'); },
			promote: async () => { throw new Error('Unexpected custody promotion'); }, releaseStaged: async () => { throw new Error('Unexpected custody release'); },
			readPage: async () => { throw new Error('Unexpected custody scan'); },
		} },
	};
	const owner = new PhotoLibrarySessionV1(ports) as PhotoLibrarySessionV1 & { readonly develop: PhotoLibraryDevelopPortV1 };
	const apply = async (revision: number, command: PhotoLibraryDevelopCommandV1, signal?: AbortSignal) => {
		const result = await owner.develop.apply({ schemaVersion: 1, photoId, expectedRevision: revision, command }, signal ? { signal } : {});
		assert.deepEqual(result.notices, []); return result.snapshot;
	};
	return { repository, ports, calls, owner, apply, close: async () => { await owner.close(); await repository.close(); } };
}

test('Develop Session reads detached active settings and scalar history without creating persisted history or borrowing originals', async () => {
	const f = await fixture(), before = await f.repository.loadPhoto('catalog', photoId);
	try {
		assert.equal(f.calls.initialize, 0);
		const snapshot = await f.owner.develop.read(read);
		assert.deepEqual(Object.keys(snapshot).sort(), ['activeVersionId', 'catalogId', 'develop', 'history', 'photoId', 'revision', 'schemaVersion', 'snapshots', 'versionId', 'versions']);
		assert.equal(snapshot.catalogId, 'catalog'); assert.equal(snapshot.photoId, photoId); assert.equal(snapshot.versionId, 'master'); assert.equal(snapshot.revision, 0);
		assert.deepEqual(snapshot.develop, before!.versions[0]!.develop);
		assert.deepEqual(snapshot.history, { cursor: 0, entries: [{ index: 0, label: 'Initial settings', createdAt: '2026-01-01T00:00:00.000Z' }] });
		assert.deepEqual(snapshot.snapshots, []); assert.ok(Object.isFrozen(snapshot.develop.effects));
		assert.deepEqual(await f.repository.loadPhoto('catalog', photoId), before);
		assert.equal(f.calls.locks, 1); // Existing startup recovery takes the catalog lease.
		await f.owner.develop.read(read); assert.equal(f.calls.locks, 1);
	} finally { await f.close(); }
});

test('Develop Session durable edits, history selection and immutable snapshots survive reopening with original facts unchanged', async () => {
	const f = await fixture(), before = await f.repository.loadPhoto('catalog', photoId);
	try {
		let snapshot = await f.apply(0, record());
		assert.equal(snapshot.revision, 1); assert.equal(snapshot.history.cursor, 1); assert.equal(snapshot.develop.effects[0]?.params.exposure, 1);
		snapshot = await f.apply(1, { type: 'save-develop-snapshot', versionId: 'master', id: 'snapshot', name: 'Bright', createdAt: time });
		assert.deepEqual(snapshot.snapshots, [{ id: 'snapshot', name: 'Bright', createdAt: time }]);
		snapshot = await f.apply(2, { type: 'select-develop-history', versionId: 'master', cursor: 0 });
		assert.equal(snapshot.develop.effects.length, 0); assert.equal(snapshot.history.cursor, 0);
		snapshot = await f.apply(3, { type: 'restore-develop-snapshot', versionId: 'master', snapshotId: 'snapshot', label: 'Restore Bright', createdAt: time });
		assert.equal(snapshot.develop.effects[0]?.params.exposure, 1); assert.equal(snapshot.history.entries.at(-1)?.label, 'Restore Bright');
		const stored = await f.repository.loadPhoto('catalog', photoId); assert.ok(stored);
		assert.deepEqual(stored.original, before!.original); assert.deepEqual(stored.extractedMetadata, before!.extractedMetadata);
		assert.deepEqual(stored.metadata, before!.metadata); assert.deepEqual(stored.versions[0]?.workspace?.snapshots[0]?.develop, edited());
		await f.owner.close();
		const replacement = new PhotoLibrarySessionV1(f.ports) as typeof f.owner;
		try { assert.deepEqual(await replacement.develop.read(read), snapshot); }
		finally { await replacement.close(); }
	} finally { await f.close(); }
});

test('Develop Session virtual copies have independent history and explicit version selection', async () => {
	const f = await fixture();
	try {
		await f.apply(0, record());
		let snapshot = await f.apply(1, { type: 'create-virtual-copy', id: 'copy', name: 'Alternative', createdAt: time, sourceVersionId: 'master' });
		assert.equal(snapshot.activeVersionId, 'copy'); assert.equal(snapshot.versionId, 'copy'); assert.equal(snapshot.history.entries.length, 1);
		snapshot = await f.apply(2, { type: 'record-develop', versionId: 'copy', develop: queryPhotoV1().versions[0]!.develop, label: 'Reset', createdAt: time });
		assert.equal(snapshot.history.entries.length, 2); assert.equal(snapshot.develop.effects.length, 0);
		const master = await f.owner.develop.read({ ...read, versionId: 'master' });
		assert.equal(master.activeVersionId, 'copy'); assert.equal(master.versionId, 'master'); assert.equal(master.develop.effects[0]?.params.exposure, 1);
		await f.apply(3, { type: 'activate-version', versionId: 'master' });
		await assert.rejects(f.apply(4, { type: 'delete-virtual-copy', versionId: 'master' }), /master/iu);
		snapshot = await f.apply(4, { type: 'delete-virtual-copy', versionId: 'copy' }); assert.equal(snapshot.versions.length, 1);
		await assert.rejects(f.owner.develop.read({ ...read, versionId: 'copy' }), /missing/iu);
	} finally { await f.close(); }
});

test('Develop Session rejects stale revision after external edits instead of replaying settings on current state', async () => {
	const f = await fixture();
	try {
		await f.apply(0, record());
		const current = await f.repository.loadPhoto('catalog', photoId); assert.ok(current);
		await f.repository.savePhoto({ ...current, rating: 5 }, 1);
		await assert.rejects(f.apply(1, { type: 'select-develop-history', versionId: 'master', cursor: 0 }),
			(error: unknown) => error instanceof Error && 'code' in error && error.code === 'PHOTO_REVISION_CONFLICT');
		const stored = await f.repository.loadPhoto('catalog', photoId); assert.equal(stored?.rating, 5);
		assert.equal(stored?.versions[0]?.develop.effects[0]?.params.exposure, 1); assert.equal(stored?.revision, 2);
	} finally { await f.close(); }
});

test('Develop command admission detaches before lazy initialization and rejects accessors or unrelated commands without calling them', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const hostile = Object.defineProperty({}, 'command', { enumerable: true, get() { getters++; return record(); } });
		const invalid = [hostile, { schemaVersion: 2, photoId, expectedRevision: 0, command: record() },
			{ schemaVersion: 1, photoId, expectedRevision: -1, command: record() },
			{ schemaVersion: 1, photoId, expectedRevision: 0, command: { type: 'set-metadata', changes: { title: 'wrong API' } } },
			{ schemaVersion: 1, photoId, expectedRevision: 0, command: { ...record(), versionId: undefined } },
			{ schemaVersion: 1, photoId, expectedRevision: 0, command: { type: 'select-develop-history', versionId: 'master', cursor: 100 } }];
		for (const value of invalid) await assert.rejects(f.owner.develop.apply(value as Parameters<PhotoLibraryDevelopPortV1['apply']>[0]));
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'aborted', { get() { getters++; return false; } });
		await assert.rejects(f.owner.develop.read(read, { signal }));
		assert.equal(getters, 0); assert.equal(f.calls.initialize, 0); assert.equal(f.calls.locks, 0);
		const entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize;
		f.ports.initialize = async admitted => { entered.resolve(); await release.promise; return initialize(admitted); };
		const develop = edited(), command = { type: 'record-develop' as const, versionId: 'master', develop, label: 'Before', createdAt: time };
		const work = f.apply(0, command); await entered.promise;
		develop.effects[0]!.params.exposure = 5; command.label = 'After'; release.resolve();
		const result = await work; assert.equal(result.develop.effects[0]?.params.exposure, 1); assert.equal(result.history.entries[1]?.label, 'Before');
	} finally { await f.close(); }
});

test('Develop Session Close joins a held read, refuses publication and preserves an opaque caller cancellation reason', async () => {
	for (const close of [false, true]) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const reason = new Proxy({}, { getPrototypeOf() { throw new Error('Reason reflected'); } }), load = f.repository.loadPhoto.bind(f.repository);
		f.repository.loadPhoto = async (...args) => { const result = await load(...args); entered.resolve(); await release.promise; return result; };
		const work = f.owner.develop.read(read, { signal: stop.signal }); await entered.promise;
		const refused = close ? assert.rejects(work, { name: 'AbortError' }) : assert.rejects(work, error => error === reason);
		const closing = close ? f.owner.close() : null; if (!close) stop.abort(reason);
		try {
			assert.equal(await remainsPending(work), true);
			if (closing) { assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0); }
			release.resolve(); await refused; await closing;
			f.repository.loadPhoto = load;
			if (!close) assert.equal((await f.owner.develop.read(read)).revision, 0);
		} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
	}
});

test('Develop Session returns an acknowledged edit even when cancellation and Close arrive while durable completion is held', async () => {
	const f = await fixture(), committed = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const save = f.repository.savePhoto.bind(f.repository), reason = Object.freeze({ stop: 'after commit' });
	f.repository.savePhoto = async (...args) => { const result = await save(...args); committed.resolve(); await release.promise; return result; };
	const work = f.apply(0, record(), stop.signal); await committed.promise;
	try {
		stop.abort(reason); const closing = f.owner.close();
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
		release.resolve(); const result = await work; await closing;
		assert.equal(result.revision, 1); assert.equal(result.develop.effects[0]?.params.exposure, 1);
		assert.equal((await f.repository.loadPhoto('catalog', photoId))?.revision, 1);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
});

test('Develop Session retains the acknowledged snapshot with a bounded notice when the catalog lease cleanup fails', async () => {
	const f = await fixture(), cleanup = new Error('Lease cleanup failed after commit');
	try {
		await f.owner.develop.read(read);
		f.ports.exclusive = async (_catalog, operation, signal) => { await operation(signal); throw cleanup; };
		const result = await f.owner.develop.apply({ schemaVersion: 1, photoId, expectedRevision: 0, command: record() });
		assert.deepEqual(result.notices, ['cleanup-failed']); assert.equal(result.snapshot.revision, 1);
		assert.equal(result.snapshot.develop.effects[0]?.params.exposure, 1);
		assert.equal((await f.repository.loadPhoto('catalog', photoId))?.revision, 1);
		const failure = new Error('Lease acquisition failed before commit');
		f.ports.exclusive = async () => { throw failure; };
		await assert.rejects(f.apply(1, { type: 'select-develop-history', versionId: 'master', cursor: 0 }), error => error === failure);
		assert.equal((await f.repository.loadPhoto('catalog', photoId))?.revision, 1);
	} finally { await f.close(); }
});

test('shape-valid oversized Develop settings refuse before lazy initialization or a catalog lease', async () => {
	const f = await fixture();
	try {
		const develop = normalizePhotoDevelopV1({ ...edited(), masks: Array.from({ length: 3 }, (_, index) => ({
			schemaVersion: 1, id: `mask-${index}`, kind: 'mask', inputs: [], outputNodeId: 'path',
			nodes: [{ id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
				points: Array.from({ length: 16_000 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null })) }] }],
		})) });
		assert.ok(new TextEncoder().encode(JSON.stringify(develop)).byteLength > 2_097_152);
		await assert.rejects(f.apply(0, { type: 'record-develop', versionId: 'master', develop, label: 'Oversized', createdAt: time }), /byte/iu);
		assert.equal(f.calls.initialize, 0); assert.equal(f.calls.locks, 0);
	} finally { await f.close(); }
});
