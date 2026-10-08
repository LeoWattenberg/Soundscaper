/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import type { OpfsSyncStoragePort } from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function fixture({ holdSuccess = false } = {}) {
	const backing = createInstrumentedIndexedDB();
	const databaseName = `lightscaper-media-test-${crypto.randomUUID()}`;
	const opened: IDBDatabase[] = [];
	const names: string[] = [];
	let closed = 0;
	let resume!: () => void;
	let began!: () => void;
	const started = new Promise<void>((resolve) => { began = resolve; });
	const factory = {
		open(name: string, version: number) {
			names.push(name);
			const request = backing.open(name, version);
			return new Proxy(request, {
				set(target, key, value: unknown) {
					if (key !== 'onsuccess') { Reflect.set(target, key, value); return true; }
					Reflect.set(target, 'onsuccess', (event: Event) => {
						const database = target.result as unknown as IDBDatabase;
						const close = database.close.bind(database);
						database.close = () => { closed++; close(); };
						opened.push(database);
						resume = () => { Reflect.apply(value as (event: Event) => void, target, [event]); };
						began();
						if (!holdSuccess) resume();
					});
					return true;
				},
			});
		},
	} as unknown as IDBFactory;
	const create = () => new PhotoMediaStoreV1({ indexedDB: factory, databaseName, locks: null, preferOpfs: false });
	return { backing, factory, databaseName, opened, names, create, started, resume: () => resume(), closed: () => closed };
}

test('Photo media storage opens lazily in independent Light namespaces with shared v2 custody', async () => {
	const setup = fixture();
	const store = new PhotoMediaStoreV1({ indexedDB: setup.factory, locks: null, preferOpfs: false });
	assert.deepEqual(setup.names, []);
	try {
		assert.equal(await store.ready(), store);
		assert.deepEqual(setup.names, [PHOTO_MEDIA_NAMESPACES_V1.databaseName]);
		assert.equal(setup.opened[0]?.version, 2);
		assert.ok(setup.opened[0]?.objectStoreNames.contains('catalogOriginalRoots'));
		for (const value of Object.values(PHOTO_MEDIA_NAMESPACES_V1)) assert.match(value, /^lightscaper-/u);
	} finally { await store.close(); }
	assert.equal(setup.closed(), 1);
});

test('durable originals, scalar journal and protective roots survive a Photo media owner reopening', async () => {
	const setup = fixture();
	const fixturePhoto = photoArchiveFixture();
	const first = setup.create();
	await first.mediaRepository.writeAsset(fixturePhoto.photo.original.storageKey, fixturePhoto.original);
	await first.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: fixturePhoto.photo.id,
		assetId: fixturePhoto.photo.original.storageKey, sourceId: fixturePhoto.photo.original.id,
		sha256: fixturePhoto.photo.original.contentSha256, size: fixturePhoto.photo.original.byteLength }]);
	const journal = { catalogId: 'catalog-1', importId: 'import-1', state: 'staged' };
	assert.equal(await first.settingsRepository.putIfAbsent('photo-import:catalog-1', journal), true);
	assert.equal(await first.settingsRepository.putIfAbsent('photo-import:catalog-1', journal), false);
	await first.close();
	assert.equal(setup.backing.recordCount(setup.databaseName, 'settings'), 1);
	const reopened = setup.create();
	try {
		await reopened.ready();
		await reopened.verifyOriginal(fixturePhoto.photo.original);
		assert.deepEqual(await reopened.settingsRepository.get('photo-import:catalog-1'), journal);
		const next = { ...journal, state: 'published' };
		assert.equal(await reopened.settingsRepository.replaceIfCurrent('photo-import:catalog-1', journal, next), true);
		assert.equal(await reopened.settingsRepository.deleteIfCurrent('photo-import:catalog-1', journal), false);
		assert.equal(await reopened.settingsRepository.deleteIfCurrent('photo-import:catalog-1', next), true);
		await assert.rejects(reopened.mediaRepository.deleteAsset(fixturePhoto.photo.original.storageKey), /catalog original/u);
		const original = await reopened.mediaRepository.loadAsset(fixturePhoto.photo.original.storageKey);
		assert.ok(original);
		assert.deepEqual(new Uint8Array(await original.arrayBuffer()), new Uint8Array([1, 2, 3]));
	} finally { await reopened.close(); }
});

test('original verification reads trusted immutable metadata and refuses mismatches or legacy digest claims', async (context) => {
	const setup = fixture();
	const store = setup.create();
	const fixturePhoto = photoArchiveFixture();
	try {
		await store.mediaRepository.writeAsset(fixturePhoto.photo.original.storageKey, fixturePhoto.original);
		context.mock.method(Blob.prototype, 'arrayBuffer', async () => { throw new Error('Verification must not load original bytes.'); });
		await store.verifyOriginal(fixturePhoto.photo.original);
		await assert.rejects(store.verifyOriginal({ ...fixturePhoto.photo.original, byteLength: 4 }), /identity/u);
		await assert.rejects(store.verifyOriginal({ ...fixturePhoto.photo.original, contentSha256: '0'.repeat(64) }), /identity/u);
		const row = setup.backing.records(setup.databaseName, 'mediaAssets')[0];
		setup.backing.seedRecord(setup.databaseName, 'mediaAssets', { ...row, mediaContentDigestVersion: 0 });
		await assert.rejects(store.verifyOriginal(fixturePhoto.photo.original), /identity/u);
	} finally { await store.close(); }
});

test('verification honors cancellation before and after metadata lookup', async () => {
	const setup = fixture();
	const store = setup.create();
	const fixturePhoto = photoArchiveFixture();
	try {
		await store.mediaRepository.writeAsset(fixturePhoto.photo.original.storageKey, fixturePhoto.original);
		await assert.rejects(store.verifyOriginal(fixturePhoto.photo.original, AbortSignal.abort()), { name: 'AbortError' });
		const controller = new AbortController();
		setup.backing.onNextGetForStore('mediaAssets', () => controller.abort());
		await assert.rejects(store.verifyOriginal(fixturePhoto.photo.original, controller.signal), { name: 'AbortError' });
	} finally { await store.close(); }
});

test('unavailable durable storage rejects every admission without process-local publication', async () => {
	const databaseName = `lightscaper-unavailable-${crypto.randomUUID()}`;
	const store = new PhotoMediaStoreV1({ indexedDB: null, databaseName, locks: null, preferOpfs: false });
	await assert.rejects(store.ready(), /durable IndexedDB/u);
	await assert.rejects(store.mediaRepository.writeAsset('original', new Blob(['bytes'])), /durable IndexedDB/u);
	await assert.rejects(store.settingsRepository.put('journal', { state: 'staged' }), /durable IndexedDB/u);
	assert.equal(getMemoryDatabase(databaseName).mediaAssets.size, 0);
	assert.equal(getMemoryDatabase(databaseName).settings.size, 0);
	await store.close();
});

test('a failed lazy database open can retry without a new Photo media owner', async () => {
	const setup = fixture();
	const failure = new DOMException('temporarily denied', 'SecurityError');
	let attempts = 0;
	const factory = { open(name: string, version: number) { if (++attempts === 1) throw failure; return setup.factory.open(name, version); } };
	const store = new PhotoMediaStoreV1({ indexedDB: factory as unknown as IDBFactory, databaseName: setup.databaseName, locks: null, preferOpfs: false });
	await assert.rejects(store.ready(), (error: unknown) => error === failure);
	assert.equal(await store.ready(), store);
	assert.equal(attempts, 2);
	await store.close();
});

test('close joins a pending open, rejects later admission and closes its late connection once', async () => {
	const setup = fixture({ holdSuccess: true });
	const store = setup.create();
	const ready = Promise.allSettled([store.ready()]);
	await setup.started;
	const closing = store.close();
	assert.equal(store.close(), closing);
	await assert.rejects(store.settingsRepository.get('later'), { code: 'STORE_CLOSED' });
	let finished = false;
	void closing.then(() => { finished = true; });
	await Promise.resolve();
	assert.equal(finished, false);
	setup.resume();
	await closing;
	assert.equal((await ready)[0]?.status, 'rejected');
	assert.equal(setup.closed(), 1);
	assert.equal(setup.backing.recordCount(setup.databaseName, 'settings'), 0);
	assert.equal(store.close(), closing);
});

test('closing an unopened store refuses future opens without touching IndexedDB', async () => {
	const setup = fixture();
	const store = setup.create();
	const closing = store.close();
	assert.equal(store.close(), closing);
	await closing;
	await assert.rejects(store.ready(), { code: 'STORE_CLOSED' });
	await assert.rejects(store.mediaRepository.writeAsset('late', new Blob(['bytes'])), /closed/u);
	await assert.rejects(store.settingsRepository.put('late', {}), { code: 'STORE_CLOSED' });
	assert.deepEqual(setup.names, []);
});

test('version change uses terminal cleanup and refuses reopening the stale owner', async () => {
	const setup = fixture();
	const store = setup.create();
	await store.ready();
	setup.opened[0]!.onversionchange!(new Event('versionchange') as IDBVersionChangeEvent);
	await assert.rejects(store.ready(), { code: 'STORE_VERSION_STALE' });
	await store.close();
	assert.equal(setup.closed(), 1);
	assert.equal(setup.backing.recordCount(setup.databaseName, 'settings'), 0);
	assert.equal(setup.names.length, 1);
});

test('terminal close aborts and cleans an admitted streamed original writer', async () => {
	const setup = fixture();
	const store = setup.create();
	const bytes = new Uint8Array(4 * 1024 * 1024 + 1).fill(7);
	const writer = await store.mediaRepository.beginAssetWrite('staged', {}, { expectedBytes: bytes.length,
		expectedSha256: createHash('sha256').update(bytes).digest('hex') });
	await writer.write(bytes.subarray(0, 4 * 1024 * 1024));
	await writer.write(bytes.subarray(4 * 1024 * 1024));
	await store.close();
	await assert.rejects(writer.commit(), /closed/u);
	assert.equal(setup.backing.recordCount(setup.databaseName, 'mediaAssetChunks'), 0);
	assert.equal(setup.backing.recordCount(setup.databaseName, 'mediaAssets'), 0);
	assert.equal(setup.backing.records(setup.databaseName, 'mediaAssetStaging').some((row: { kind: string }) => row.kind === 'media-asset-stage'), false);
	assert.equal(setup.closed(), 1);
});

test('cleanup failures aggregate while OPFS and actual database release are both attempted', async () => {
	const setup = fixture();
	const releaseFailure = new Error('session release failed');
	const workerFailure = new Error('OPFS worker close failed');
	let workerCloses = 0;
	const client: OpfsSyncStoragePort = {
		async initialize() { return false; },
		async read() { throw new Error('Unused'); },
		async snapshot() { throw new Error('Unused'); },
		async openWriter() { throw new Error('Unused'); },
		async remove() {},
		close() { workerCloses++; throw workerFailure; },
	};
	const store = new PhotoMediaStoreV1({ indexedDB: setup.factory, databaseName: setup.databaseName,
		locks: null, preferOpfs: false, syncWorkerClient: client });
	await store.ready();
	setup.opened[0]!.transaction = () => { throw releaseFailure; };
	const closing = store.close();
	await assert.rejects(closing, (error: unknown) => error instanceof AggregateError
		&& error.errors.includes(releaseFailure) && error.errors.includes(workerFailure));
	assert.equal(workerCloses, 1);
	assert.equal(setup.closed(), 1);
	assert.equal(store.close(), closing);
	await assert.rejects(store.ready(), { code: 'STORE_CLOSED' });
});

test('namespace overrides are bounded Light names and accessors never execute', () => {
	for (const key of ['databaseName', 'opfsDirectoryName', 'opfsWorkerName'] as const) {
		for (const value of ['audio-editor', '../lightscaper-path', 'lightscaper-' + 'a'.repeat(128)]) {
			assert.throws(() => new PhotoMediaStoreV1({ [key]: value }), /namespace/u);
		}
	}
	const hostile = Object.defineProperty({}, 'databaseName', { enumerable: true, get() { assert.fail('Namespace accessor ran.'); } });
	assert.throws(() => new PhotoMediaStoreV1(hostile), /data property/u);
});

test('an OPFS namespace override reaches only its own Light directory', async () => {
	const setup = fixture();
	const directories: string[] = [];
	const root = { async getDirectoryHandle(name: string) {
		directories.push(name);
		return { async getFileHandle() { throw new DOMException('No file writer', 'NotSupportedError'); } };
	} };
	const store = new PhotoMediaStoreV1({ indexedDB: setup.factory, databaseName: setup.databaseName,
		locks: null, opfsRoot: root as unknown as FileSystemDirectoryHandle, syncWorkerClient: null,
		opfsDirectoryName: 'lightscaper-photo-directory-test', opfsWorkerName: 'lightscaper-photo-worker-test' });
	try {
		await store.mediaRepository.writeAsset('original', new Blob(['bytes']));
		assert.deepEqual(directories, ['lightscaper-photo-directory-test']);
	} finally { await store.close(); }
});

test('a blocked opening closes late success even after the owner has closed', async () => {
	const setup = fixture({ holdSuccess: true });
	const factory = { open(name: string, version: number) {
		const request = setup.factory.open(name, version);
		queueMicrotask(() => { request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent); });
		return request;
	} };
	const store = new PhotoMediaStoreV1({ indexedDB: factory as unknown as IDBFactory, databaseName: setup.databaseName,
		locks: null, preferOpfs: false });
	await assert.rejects(store.ready(), { code: 'STORE_BLOCKED' });
	await setup.started;
	await store.close();
	assert.equal(setup.closed(), 0);
	setup.resume();
	assert.equal(setup.closed(), 1);
	await assert.rejects(store.ready(), { code: 'STORE_CLOSED' });
});

test('close joins an admitted settings CAS before releasing the connection', async () => {
	const setup = fixture();
	const store = setup.create();
	const initial = { catalogId: 'catalog', importId: 'import', state: 'staged' };
	await store.settingsRepository.put('photo-import:catalog', initial);
	let closing: Promise<void> | undefined;
	setup.backing.onNextGetForStore('settings', () => { closing = store.close(); });
	assert.equal(await store.settingsRepository.replaceIfCurrent('photo-import:catalog', initial, { ...initial, state: 'published' }), true);
	assert.ok(closing);
	await closing;
	assert.equal(setup.backing.records(setup.databaseName, 'settings')[0]?.value.state, 'published');
	assert.equal(setup.closed(), 1);
});

test('same-turn close fences custody admission and drains a transaction already holding the database', async () => {
	for (const captured of [false, true]) {
		const setup = fixture();
		const store = setup.create();
		const metadata = await store.mediaRepository.writeAsset('original', new Blob(['bytes']));
		let closing: Promise<void> | undefined;
		if (captured) setup.backing.onNextGetForStore('mediaAssets', () => { closing = store.close(); });
		const staging = store.mediaRepository.catalogOriginals.stage('catalog', 'import', [{ photoId: 'photo',
			assetId: 'original', sourceId: 'logical-original', sha256: metadata.sha256, size: metadata.size }]);
		const result = Promise.allSettled([staging]);
		if (!captured) closing = store.close();
		assert.equal((await result)[0]?.status, 'rejected');
		assert.ok(closing);
		await closing;
		assert.equal(setup.backing.recordCount(setup.databaseName, 'catalogOriginalRoots'), 0);
		assert.equal(setup.backing.recordCount(setup.databaseName, 'mediaAssets'), 1);
		assert.equal(setup.closed(), 1);
	}
});

test('original accessors are refused before metadata lookup', async () => {
	const setup = fixture();
	const store = setup.create();
	const original = { ...photoArchiveFixture().photo.original };
	Object.defineProperty(original, 'contentSha256', { enumerable: true, get() { assert.fail('Original digest accessor ran.'); } });
	await assert.rejects(store.verifyOriginal(original), /data property/u);
	assert.deepEqual(setup.names, []);
	await store.close();
});

test('the bound original verifier supplies the catalog publication callback directly', async () => {
	const setup = fixture();
	const media = setup.create();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: setup.factory,
		databaseName: `lightscaper-catalog-test-${crypto.randomUUID()}`, verifyOriginal: media.verifyOriginal });
	const fixturePhoto = photoArchiveFixture();
	try {
		await media.mediaRepository.writeAsset(fixturePhoto.photo.original.storageKey, fixturePhoto.original);
		await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
			id: 'catalog-1', name: 'Photo library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await catalog.publishPhotos('catalog-1', 0, [fixturePhoto.photo]);
		assert.deepEqual(await catalog.loadPhoto('catalog-1', fixturePhoto.photo.id), fixturePhoto.photo);
	} finally {
		await catalog.close();
		await media.close();
	}
});

test('the public media port exposes only originals and custody', async () => {
	const setup = fixture();
	const store = setup.create();
	assert.equal(Object.isFrozen(store.mediaRepository), true);
	assert.deepEqual(Object.keys(store.mediaRepository).sort(), ['beginAssetWrite', 'catalogOriginals',
		'deleteAsset', 'getAssetMetadata', 'inspectCatalogOriginalBody', 'loadAsset', 'restoreCatalogOriginalBody', 'writeAsset']);
	for (const method of ['saveDerivative', 'loadDerivative', 'assetRecords', 'beginAssetMaintenance']) {
		assert.equal(Reflect.has(store.mediaRepository, method), false);
	}
	await store.close();
});

test('close joins original deletion after it has captured the database and started OPFS cleanup', async () => {
	const setup = fixture();
	let resume!: () => void;
	let began!: () => void;
	const started = new Promise<void>((resolve) => { began = resolve; });
	const gate = new Promise<void>((resolve) => { resume = resolve; });
	const directory = {
		async getFileHandle() { return { async createWritable() { return { async write() {}, async close() {}, async abort() {} }; } }; },
		async removeEntry() { began(); await gate; },
	};
	const root = { async getDirectoryHandle() { return directory; } };
	const store = new PhotoMediaStoreV1({ indexedDB: setup.factory, databaseName: setup.databaseName,
		locks: null, opfsRoot: root as unknown as FileSystemDirectoryHandle, syncWorkerClient: null });
	await store.mediaRepository.writeAsset('original', new Blob(['bytes']));
	const deleting = store.mediaRepository.deleteAsset('original');
	await started;
	const closing = store.close();
	try {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		while (setup.backing.stats.activeTransactions > 0) {
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		}
		assert.equal(setup.closed(), 0);
		await assert.rejects(store.mediaRepository.getAssetMetadata('original'), { code: 'STORE_CLOSED' });
	} finally {
		resume();
		await deleting;
		await closing;
	}
	assert.equal(setup.closed(), 1);
	assert.equal(setup.backing.recordCount(setup.databaseName, 'mediaAssets'), 0);
});
