/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopImportPortCurrentV1 } from '../src/common/editor/photo-library-develop-import-port-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { brushSettingsRecipe } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { ORIGINAL } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
const OPTIONS = { concurrency: false, timeout: 10_000 };
function importer(f: Fixture) {
	const descriptor = Object.getOwnPropertyDescriptor(f.session, 'developImportCurrent');
	const current = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as PhotoLibraryDevelopImportPortCurrentV1 | undefined : undefined;
	return { owner: current ?? f.session.developImport, schemaVersion: current ? 3 : 2 };
}
function choice(f: Fixture, presetId = 'repair-preset', expectedRevision = 1) {
	const { schemaVersion } = importer(f);
	return { schemaVersion, developPreset: { schemaVersion, catalogId: f.root.id, presetId, expectedRevision } };
}
function importFiles(f: Fixture, files: readonly File[], request: unknown = choice(f)): Promise<readonly PhotoLibraryImportItemV1[]> {
	const { owner } = importer(f); return Reflect.apply(owner.importFiles, owner, [files, request]) as Promise<readonly PhotoLibraryImportItemV1[]>;
}
function files(f: Fixture, count = 1): File[] { return Array.from({ length: count }, (_, index) => new File([f.bytes], `Current ${String(index + 1)}.png`, { type: 'image/png', lastModified: 0 })); }
async function saved(f: Fixture, id = 'repair-preset', expectedRevision = 0) {
	const brush = await f.installBrush(), draft = brushSettingsRecipe(brush.reference), cap = f.session.develop.presetsCurrent!;
	assert.ok(cap); const packet = await f.selectedPacket(draft), preset = cap.create({ schemaVersion: 3, id, name: 'Imported repair', settings: packet });
	const ack = await cap.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision, preset } });
	return { draft, brush, preset, ack };
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function restoreProperty(owner: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key);
}
async function atBoundary<Value>(entered: Promise<void>, work: ReturnType<typeof observed<Value>>) {
	await Promise.race([entered, work.then(outcome => { if (!outcome.ok) throw outcome.error; assert.fail('Real operation settled before its held native boundary.'); })]);
}

// These explicit Node image ports only permit actual preparation/publication to
// proceed. Native browser decoding and rendered pixels are qualified separately.
function imagePorts(): () => void {
	const values = { ImageDecoder: undefined, createImageBitmap: () => Promise.resolve({ width: 3, height: 1, close() {} }),
		OffscreenCanvas: class { constructor(readonly width: number, readonly height: number) {}
			getContext() { return { clearRect() {}, drawImage() {}, getImageData() { return { data: Uint8ClampedArray.from(ORIGINAL) }; } }; }
		} };
	const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
	return () => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}
async function nativePhoto(f: Fixture, photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	try {
		await anchor.ready(); const { location } = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Import observation cannot initialize another namespace.'); } });
		media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: location.mediaDatabaseName, preferOpfs: false });
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const photo = await catalog.loadPhoto(f.root.id, photoId); assert.ok(photo); await media.verifyOriginal(photo.original);
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
		const roots = await media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id, importId: null });
		return { photo, bytes: new Uint8Array(await body.arrayBuffer()), roots };
	} finally { await Promise.all([catalog?.close(), media?.close(), anchor.close()]); }
}

test('Current import menu lists the actual retained native Preset3 row as scalar identities', OPTIONS, async () => {
	const f = await repairPresetsFixture();
	try { const retained = await saved(f), before = await f.inspect(), { owner } = importer(f), menu = await owner.listPresets();
		assert.equal(menu.schemaVersion, 3); assert.equal(menu.catalogId, f.root.id); assert.equal(menu.revision, retained.ack.snapshot.revision);
		assert.deepEqual(menu.presets.map(preset => preset.id), ['repair-preset']); assert.ok(menu.presets.every(preset => !Object.hasOwn(preset, 'settings')));
		assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('actual Current import retains repairs and unused brush in native Photo3 history with durable receipt and original custody', OPTIONS, async () => {
	const f = await repairPresetsFixture(), restore = imagePorts(), acknowledged: PhotoLibraryImportItemV1[] = [];
	try { const retained = await saved(f), before = await f.inspect(), row = await f.row();
		const items = await importFiles(f, files(f), { ...choice(f), settings: { rename: null, metadata: { creator: 'Current importer' }, keywordIds: [] }, onAcknowledged: (item: PhotoLibraryImportItemV1) => { acknowledged.push(item); } });
		assert.equal(items[0]?.status, 'imported'); assert.deepEqual(acknowledged, items); assert.ok(items[0]?.photoId);
		const stored = await nativePhoto(f, items[0].photoId); assert.equal(stored.photo.schemaVersion, 3); assert.equal(stored.photo.revision, 0);
		const active = stored.photo.versions.find(version => version.id === stored.photo.activeVersionId)!;
		assert.deepEqual(active.develop, retained.draft); assert.equal(active.workspace?.cursor, 1); assert.equal(active.workspace?.entries.length, 2);
		assert.deepEqual(active.workspace?.entries[1]?.develop, retained.draft); assert.equal(stored.photo.metadata.creator, 'Current importer');
		assert.deepEqual(stored.bytes, f.bytes); assert.equal(stored.roots.roots.some(root => root.photoId === stored.photo.id), true);
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(await f.row(), row); assert.ok(f.borrowed.every(body => body.every(byte => byte === 0)));
	} finally { restore(); await f.close(); }
});

test('inherited V2 import readers and requests remain strict after Current Preset3 storage', OPTIONS, async () => {
	const f = await repairPresetsFixture(), restore = imagePorts();
	try { await saved(f); const before = await f.inspect();
		await assert.rejects(f.session.developImport.listPresets());
		await assert.rejects(f.session.developImport.importFiles(files(f), { schemaVersion: 2, developPreset: { schemaVersion: 2, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 } }));
		await assert.rejects(async () => Reflect.apply(f.session.developImport.importFiles, f.session.developImport, [files(f), { schemaVersion: 3, developPreset: { schemaVersion: 3, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 } }]) as Promise<unknown>);
		assert.deepEqual(await f.inspect(), before); assert.equal((await f.session.readPage()).totalCount, f.photos.length);
	} finally { restore(); await f.close(); }
});

test('Current import closed request and File admission refuse before lazy initialization or borrowed getters', OPTIONS, async () => {
	const f = await repairPresetsFixture(), descriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'loadCatalog');
	const load = PhotoCatalogRepositoryCurrentV1.prototype.loadCatalog; let initialized = 0, getters = 0;
	Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'loadCatalog', { ...descriptor, value: function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof load>) {
		initialized++; return Reflect.apply(load, this, args) as ReturnType<typeof load>;
	} });
	try {
		const selected = choice(f), accessor = Object.defineProperty({ ...selected.developPreset }, 'presetId', { enumerable: true, get() { getters++; return 'repair-preset'; } });
		for (const value of [{ ...selected, developPreset: accessor }, { ...selected, future: true }, { ...selected, schemaVersion: 9 }]) await assert.rejects(importFiles(f, files(f), value));
		const sparse = new Array<File>(1); await assert.rejects(importFiles(f, sparse));
		const borrowed = Object.defineProperty([], '0', { enumerable: true, get() { getters++; return files(f)[0]; } });
		await assert.rejects(importFiles(f, borrowed as File[])); assert.equal(getters, 0); assert.equal(initialized, 0);
	} finally { restoreProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'loadCatalog', descriptor); await f.close(); }
});

test('Current import selected preset identity and Files are captured before the held native row read', OPTIONS, async () => {
	const f = await repairPresetsFixture(), restore = imagePorts(), entered = deferred<void>(), release = deferred<void>();
	const descriptor = Object.getOwnPropertyDescriptor(KeyValueRepository.prototype, 'readEntry')!, read = KeyValueRepository.prototype.readEntry;
	let held = false, work: ReturnType<typeof observed<readonly PhotoLibraryImportItemV1[]>> | undefined;
	try { const retained = await saved(f); Object.defineProperty(KeyValueRepository.prototype, 'readEntry', { ...descriptor, value: async function (this: KeyValueRepository, key: string) {
		const value = await Reflect.apply(read, this, [key]) as Awaited<ReturnType<typeof read>>;
		if (key === f.key && !held) { held = true; entered.resolve(); await release.promise; } return value;
	} });
		const selected = files(f), request = choice(f); work = observed(importFiles(f, selected, request)); await atBoundary(entered.promise, work);
		selected.splice(0, 1, new File([Uint8Array.of(9)], 'replacement.png')); Object.assign(request.developPreset, { presetId: 'removed', expectedRevision: 99 });
		release.resolve(); const outcome = await work; if (!outcome.ok) throw outcome.error;
		assert.equal(outcome.value[0]?.status, 'imported'); assert.equal(outcome.value[0]?.fileName, 'Current 1.png'); assert.ok(outcome.value[0]?.photoId);
		assert.deepEqual((await nativePhoto(f, outcome.value[0].photoId)).photo.versions[0]?.develop, retained.draft);
	} finally { release.resolve(); await work; restoreProperty(KeyValueRepository.prototype, 'readEntry', descriptor); restore(); await f.close(); }
});

test('Current import cancel and Close join actual native brush authentication and preserve the opaque first reason', OPTIONS, async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let work: ReturnType<typeof observed<readonly PhotoLibraryImportItemV1[]>> | undefined, closing: Promise<void> | undefined;
	try { await saved(f); const before = await f.inspect(), row = await f.row(); f.borrowed.splice(0);
		f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		work = observed(importFiles(f, files(f), { ...choice(f), signal: stop.signal })); await atBoundary(entered.promise, work); stop.abort(opaque.proxy);
		closing = f.session.close(); assert.equal(f.session.close(), closing); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		assert.ok(f.borrowed.some(body => body.some(byte => byte !== 0))); release.resolve(); const outcome = await work; await closing;
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, opaque.proxy), true);
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(await f.row(), row); assert.ok(f.borrowed.every(body => body.every(byte => byte === 0)));
	} finally { release.resolve(); await work; await closing; await f.close(); }
});

test('native preset row drift between import ACKs retains the first receipt and refuses a mixed later Photo', OPTIONS, async () => {
	const f = await repairPresetsFixture(), restore = imagePorts(), acknowledged: PhotoLibraryImportItemV1[] = [];
	const descriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos'), publish = PhotoCatalogRepositoryCurrentV1.prototype.publishPhotos;
	let changed = false, reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
	try { await saved(f); const before = await f.inspect(); Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos', { ...descriptor, value: async function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof publish>) {
		const root = await Reflect.apply(publish, this, args) as Awaited<ReturnType<typeof publish>>;
		if (args[0] === f.root.id && !changed) { assert.equal(root.photoCount, f.photos.length + 1); changed = true;
			const row = await f.row() as Record<string, unknown>; await f.writeRow({ ...row, revision: 2 }); } return root;
	} });
		// The actual Session pins its native publisher during composition. Reopen
		// after installing the observer so it borrows this transparent method.
		reopened = await f.reopen(); const selected = { ...f, session: reopened };
		const receipt = await importFiles(selected, files(f, 2), { ...choice(selected), onAcknowledged: (item: PhotoLibraryImportItemV1) => { acknowledged.push(item); } });
		assert.equal(changed, true); assert.deepEqual(receipt.map(item => item.status), ['imported', 'failed']); assert.deepEqual(acknowledged, [receipt[0]]);
		assert.equal((await reopened.readPage()).totalCount, f.photos.length + 1); assert.ok(receipt[0]?.photoId);
		assert.deepEqual((await nativePhoto(f, receipt[0].photoId)).bytes, f.bytes); assert.deepEqual(await f.inspect(), before);
	} finally { restoreProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos', descriptor); restore(); await reopened?.close(); await f.close(); }
});
