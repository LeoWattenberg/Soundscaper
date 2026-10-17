/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import type { PhotoLibraryDevelopImportPortV1, PhotoLibraryDevelopImportRequestV1 } from '../src/common/editor/photo-library-develop-import-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { mergeImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { createPhotoDevelopWorkspaceV1, savePhotoDevelopSnapshotV1 } from '../src/lightscaper/catalog/photo-develop-workspace-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibraryPreparationOutcomeV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { developPresetArchiveRichRow } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const key = photoDevelopPresetsKeyV1('catalog-1');
const files = () => [1, 2, 3].map(index => new File([new Uint8Array([1, 2, 3])], `Photo ${index}.png`, { type: 'image/png' }));
const choice = (presetId = 'rich-0', expectedRevision = 51): PhotoLibraryDevelopImportRequestV1 => ({ schemaVersion: 1,
	developPreset: { schemaVersion: 1, catalogId: 'catalog-1', presetId, expectedRevision } });

async function fixture() {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-develop-import-media-${crypto.randomUUID()}`, locks: null, preferOpfs: false, syncWorkerClient: null });
	const anchor = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-develop-import-anchor-${crypto.randomUUID()}`, locks: null, preferOpfs: false, syncWorkerClient: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `lightscaper-develop-import-catalog-${crypto.randomUUID()}`, verifyOriginal: media.verifyOriginal });
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Develop import library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
	const row = developPresetArchiveRichRow(); await media.settingsRepository.put(key, row);
	await anchor.settingsRepository.put(key, normalizePhotoDevelopPresetRowV1({ ...row, revision: 7, presets: [] }, 'catalog-1'));
	let initialize = 0, preparation = 0, writes = 0, reads = 0, identity = 0;
	let failSelected: number | null = 1, writerWait: (() => Promise<void>) | null = null, readWait: (() => Promise<void>) | null = null;
	let preparedBoundary: (() => Promise<void>) | null = null, publishBoundary: (() => void) | null = null;
	let target = defaultImageDevelopStateV1();
	let decorate = (photo: PhotoDocumentV1) => photo;
	const selectedSettings = { ...media.settingsRepository, async readEntry(entryKey: string) {
		assert.equal(this, selectedSettings); reads++; const entry = await media.settingsRepository.readEntry(entryKey); await readWait?.(); return entry;
	} };
	const ports = {
		initialize: async () => { initialize++; const root = await catalog.loadCatalog('catalog-1'); assert.ok(root); return root; },
		closeResources: async () => { await catalog.close(); await media.close(); await anchor.close(); },
		createId: () => `develop-import-identity-${String(++identity)}`,
		exclusive: async <Result>(_id: string, operation: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal) => { await writerWait?.(); return operation(signal); },
		catalog: { loadCatalog: catalog.loadCatalog.bind(catalog), loadPhoto: catalog.loadPhoto.bind(catalog), saveCatalog: catalog.saveCatalog.bind(catalog),
			savePhoto: catalog.savePhoto.bind(catalog), readSummaryPage: catalog.readSummaryPage.bind(catalog),
			readQueryPage: catalog.readQueryPage.bind(catalog), rebuildQueryIndexPage: catalog.rebuildQueryIndexPage.bind(catalog),
			publishPhotos: async (...args: Parameters<PhotoCatalogRepositoryV1['publishPhotos']>) => { const root = await catalog.publishPhotos(...args); publishBoundary?.(); return root; } },
		media: { writeAsset: async (...args: Parameters<typeof media.mediaRepository.writeAsset>) => { writes++; return media.mediaRepository.writeAsset(...args); }, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, settings: anchor.settingsRepository, developPresetSettings: selectedSettings,
		prepare: async function* (): AsyncGenerator<PhotoLibraryPreparationOutcomeV1> {
			preparation++; await preparedBoundary?.();
			for (let index = 0; index < 3; index++) {
				const source = photoArchiveFixture(index + 1);
				if (index === failSelected) { yield { outcome: 'failed', index, fileName: source.photo.original.name, error: new Error('broken source') }; continue; }
				const photo = decorate(normalizePhotoDocumentV1({ ...source.photo, extractedMetadata: { schemaVersion: 1, container: 'png', exif: null, iptc: null, issues: [] },
					versions: source.photo.versions.map(version => ({ ...version, develop: target })) }));
				yield { ...source, photo, outcome: 'prepared', index, fileName: photo.original.name, keywordNames: [], notices: [] };
			}
		},
	};
	const session = new PhotoLibrarySessionV1(ports);
	const importer = () => {
		const capability = (session as PhotoLibrarySessionV1 & { developImport?: PhotoLibraryDevelopImportPortV1 }).developImport;
		assert.ok(capability, 'A separate Develop-preset import capability must preserve the old closed import request.'); return capability;
	};
	return { session, importer, catalog, media, anchor, row, ports, selectedSettings, backing,
		calls: () => ({ initialize, preparation, writes, reads }), failSelected: (index: number | null) => { failSelected = index; },
		writerWait: (run: () => Promise<void>) => { writerWait = run; }, readWait: (run: () => Promise<void>) => { readWait = run; },
		preparedBoundary: (run: () => Promise<void>) => { preparedBoundary = run; }, publishBoundary: (run: () => void) => { publishBoundary = run; },
		target: (value: unknown) => { target = normalizeImageDevelopStateV1(value); },
		decorate: (run: (photo: PhotoDocumentV1) => PhotoDocumentV1) => { decorate = run; } };
}

test('full preset import captures selected namespace once and preserves source identity, bytes, failed slots and durable receipts', async () => {
	const f = await fixture(), observed: PhotoLibraryImportItemV1[] = [];
	try {
		const result = await f.importer().importFiles(files(), { ...choice(), settings: { rename: { template: '{stem}-{sequence}.{extension}', sequenceStart: 1, sequencePadding: 2 }, metadata: { creator: 'Authored' }, keywordIds: [] },
			onAcknowledged: item => { observed.push(item); } });
		assert.deepEqual(result.map(item => [item.index, item.fileName, item.status]), [[0, 'Photo 1.png', 'imported'], [1, 'Photo 2.png', 'failed'], [2, 'Photo 3.png', 'imported']]);
		assert.deepEqual(observed, [result[0], result[2]]); assert.deepEqual(result.map(item => item.reusedOriginal), [false, false, true]);
		for (const index of [1, 3]) {
			const photo = await f.catalog.loadPhoto('catalog-1', `photo-${index}`); assert.ok(photo);
			const source = photoArchiveFixture(index).photo, version = photo.versions[0]!;
			assert.deepEqual(version.develop, f.row.presets[0]!.settings.develop); assert.equal(photo.revision, 0);
			assert.deepEqual(photo.original, { ...source.original, storageKey: photoArchiveFixture(1).photo.original.storageKey }); assert.equal(photo.activeVersionId, source.activeVersionId);
			assert.equal(version.id, source.versions[0]!.id); assert.equal(version.createdAt, source.versions[0]!.createdAt);
			assert.equal(photo.metadata.fileName, `Photo ${index}-0${String(index)}.png`); assert.equal(photo.metadata.creator, 'Authored');
			assert.deepEqual(photo.extractedMetadata?.issues, []); await f.media.verifyOriginal(photo.original);
			assert.deepEqual(version.workspace?.entries.map(entry => entry.develop), [defaultImageDevelopStateV1(), version.develop]);
			assert.equal(version.workspace?.cursor, 1); assert.deepEqual(version.workspace?.snapshots, []);
		}
		assert.deepEqual(f.calls(), { initialize: 1, preparation: 1, writes: 1, reads: 1 });
		assert.deepEqual(await f.media.settingsRepository.get(key), f.row);
		assert.equal((await f.anchor.settingsRepository.get(key) as typeof f.row).revision, 7);
	} finally { await f.session.close(); }
});

test('partial Develop preset import merges the selected groups and retains unrelated white balance and geometry', async () => {
	const f = await fixture();
	const target = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects: [{ id: 'keep-wb', type: 'white-balance-v1', enabled: true, params: { temperature: -9 } }],
		geometry: { crop: { x: 0, y: 0, width: 0.5, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: true } });
	f.target(target);
	try {
		await f.importer().importFiles(files(), choice('rich-1'));
		const photo = await f.catalog.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
		assert.deepEqual(photo.versions[0]!.develop, mergeImageDevelopSettingsV1({ schemaVersion: 1, target, settings: f.row.presets[1]!.settings }));
		assert.deepEqual(photo.versions[0]!.develop.geometry, target.geometry);
		assert.deepEqual(photo.versions[0]!.develop.effects[0], target.effects[0]);
		assert.deepEqual(photo.versions[0]!.workspace?.entries[0]!.develop, target);
	} finally { await f.session.close(); }
});

test('one detached preset body survives later replacement for every imported photo without reading a mixed recipe', async () => {
	const f = await fixture(); f.failSelected(null);
	f.preparedBoundary(async () => { await f.media.settingsRepository.put(key, normalizePhotoDevelopPresetRowV1({ ...f.row, revision: 52, presets: [] }, 'catalog-1')); });
	try {
		const result = await f.importer().importFiles(files(), choice()); assert.ok(result.every(item => item.status === 'imported'));
		for (let index = 1; index <= 3; index++) assert.deepEqual((await f.catalog.loadPhoto('catalog-1', `photo-${index}`))!.versions[0]!.develop, f.row.presets[0]!.settings.develop);
		assert.equal(f.calls().reads, 1); assert.equal((await f.media.settingsRepository.get(key) as typeof f.row).revision, 52);
	} finally { await f.session.close(); }
});

test('stale revision, foreign catalog, absent recipe and physically malformed preset slot refuse before preparation or original storage', async () => {
	for (const input of [choice('rich-0', 50), choice('removed'), { ...choice(), developPreset: { ...choice().developPreset, catalogId: 'foreign' } }]) {
		const f = await fixture();
		try { await assert.rejects(f.importer().importFiles(files(), input)); assert.equal(f.calls().preparation, 0); assert.equal(f.calls().writes, 0); assert.equal((await f.catalog.loadCatalog('catalog-1'))!.photoCount, 0); }
		finally { await f.session.close(); }
	}
	for (const raw of [undefined, null, 7]) {
		const f = await fixture();
		try { await f.media.settingsRepository.put(key, raw); await assert.rejects(f.importer().importFiles(files(), choice())); assert.equal(f.calls().preparation, 0); assert.equal(f.calls().writes, 0); }
		finally { await f.session.close(); }
	}
});

test('closed Develop-import admission rejects accessors and extra fields before lazy acquisition and leaves V1 closed', async () => {
	const f = await fixture(); let touched = 0;
	try {
		const access = Object.defineProperty({ ...choice().developPreset }, 'presetId', { enumerable: true, get: () => { touched++; return 'rich-0'; } });
		for (const input of [{ ...choice(), developPreset: access }, { ...choice(), schemaVersion: 2 }, { ...choice(), developPreset: { ...choice().developPreset, body: f.row.presets[0] } }]) {
			await assert.rejects(f.importer().importFiles(files(), input as PhotoLibraryDevelopImportRequestV1));
		}
		await assert.rejects(f.session.importFiles(files(), choice()));
		assert.equal(touched, 0); assert.deepEqual(f.calls(), { initialize: 0, preparation: 0, writes: 0, reads: 0 });
	} finally { await f.session.close(); }
});

test('choice and selected point-reader are pinned before the held writer and late flat-port replacement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	f.writerWait(async () => { entered.resolve(); await release.promise; });
	try {
		const request = choice(), importing = f.importer().importFiles(files(), request); await entered.promise;
		Object.assign(request.developPreset, { presetId: 'removed', expectedRevision: 7 });
		f.ports.developPresetSettings = f.anchor.settingsRepository;
		f.selectedSettings.readEntry = async () => { throw new Error('Late reader replacement must not run.'); };
		release.resolve(); await importing;
		assert.deepEqual((await f.catalog.loadPhoto('catalog-1', 'photo-1'))!.versions[0]!.develop, f.row.presets[0]!.settings.develop);
		assert.equal(f.calls().reads, 1);
	} finally { release.resolve(); await f.session.close(); }
});

test('cancel and Close join a held preset read before releasing resources, with exact opaque cancellation', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = new Proxy({}, { get() { throw new Error('Cancellation must stay opaque.'); }, getOwnPropertyDescriptor() { throw new Error('Cancellation must stay opaque.'); } });
	f.readWait(async () => { entered.resolve(); await release.promise; });
	try {
		const importing = f.importer().importFiles(files(), { ...choice(), signal: stop.signal });
		// node:assert rejects reads error.code; observe this opaque reason by identity only.
		const failed = importing.then(() => { assert.fail('Import must reject after cancellation.'); }, error => { assert.equal(error, reason); }); await entered.promise; stop.abort(reason);
		const closing = f.session.close(); assert.equal(await remainsPending(importing), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); await failed; await closing;
		assert.equal(f.calls().preparation, 0); assert.equal(f.calls().writes, 0);
	} finally { release.resolve(); await f.session.close(); }
});

test('publication acknowledged before later cancellation retains the developed photo and original custody recovery', async () => {
	const f = await fixture(), stop = new AbortController(), observed: PhotoLibraryImportItemV1[] = []; f.failSelected(0);
	f.publishBoundary(() => { stop.abort(); });
	try {
		await assert.rejects(f.importer().importFiles(files(), { ...choice(), signal: stop.signal, onAcknowledged: item => { observed.push(item); } }), { name: 'AbortError' });
		assert.deepEqual(observed.map(item => [item.index, item.photoId]), [[1, 'photo-2']]);
		await f.session.readPage();
		const photo = await f.catalog.loadPhoto('catalog-1', 'photo-2'); assert.ok(photo);
		assert.deepEqual(photo.versions[0]!.develop, f.row.presets[0]!.settings.develop); await f.media.verifyOriginal(photo.original);
		const custody = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: null }); assert.equal(custody.roots.length, 1);
	} finally { await f.session.close(); }
});

test('empty-library import menu reads only scalar preset identities from the selected namespace', async () => {
	const f = await fixture();
	try {
		const menu = await f.importer().listPresets();
		assert.equal(menu.catalogId, 'catalog-1'); assert.equal(menu.revision, 51);
		assert.deepEqual(menu.presets.map(preset => [preset.id, preset.scope]), [['rich-0', 'full'], ['rich-1', 'partial']]);
		assert.ok(menu.presets.every(preset => !Object.hasOwn(preset, 'settings')));
		assert.deepEqual(f.calls(), { initialize: 1, preparation: 0, writes: 0, reads: 1 });
	} finally { await f.session.close(); }
});

test('ordinary import does not read preset storage or create preset history', async () => {
	const f = await fixture();
	try {
		await f.session.importFiles(files());
		const photo = await f.catalog.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
		assert.deepEqual(photo.versions, photoArchiveFixture(1).photo.versions);
		assert.equal(f.calls().reads, 0);
	} finally { await f.session.close(); }
});

test('preset import changes only the active prepared version, keeps named snapshots and can undo through the actual Develop owner', async () => {
	const f = await fixture(), prepared = new Map<string, PhotoDocumentV1>();
	f.decorate(photo => {
		const version = photo.versions[0]!, workspace = savePhotoDevelopSnapshotV1(createPhotoDevelopWorkspaceV1(version.develop,
			{ label: 'Prepared settings', createdAt: version.createdAt }), { id: `${version.id}-snapshot`, name: 'Prepared snapshot', createdAt: version.createdAt });
		const active = { ...version, id: `${version.id}-copy`, kind: 'virtual-copy' as const, name: 'Imported copy', workspace };
		const value = normalizePhotoDocumentV1({ ...photo, versions: [{ ...version, workspace }, active], activeVersionId: active.id });
		prepared.set(value.id, value); return value;
	});
	try {
		await f.importer().importFiles(files(), choice());
		const before = prepared.get('photo-1'), after = await f.catalog.loadPhoto('catalog-1', 'photo-1'); assert.ok(before); assert.ok(after);
		assert.deepEqual(after.versions[0], before.versions[0]); assert.equal(after.activeVersionId, before.activeVersionId);
		assert.deepEqual(after.versions[1]!.workspace!.snapshots, before.versions[1]!.workspace!.snapshots);
		assert.deepEqual(after.versions[1]!.workspace!.entries[0], before.versions[1]!.workspace!.entries[0]);
		assert.deepEqual(after.versions[1]!.develop, f.row.presets[0]!.settings.develop);
		const ack = await f.session.develop.apply({ schemaVersion: 1, photoId: after.id, expectedRevision: 0,
			command: { type: 'select-develop-history', versionId: after.activeVersionId, cursor: 0 } });
		assert.deepEqual(ack.snapshot.develop, before.versions[1]!.develop); assert.equal(ack.snapshot.revision, 1);
		const undone = await f.catalog.loadPhoto('catalog-1', 'photo-1'); assert.ok(undone);
		assert.deepEqual(undone.original, after.original); assert.deepEqual(undone.versions[0], before.versions[0]);
		assert.deepEqual(undone.versions[1]!.workspace!.snapshots, before.versions[1]!.workspace!.snapshots);
		await f.media.verifyOriginal(undone.original);
	} finally { await f.session.close(); }
});

test('missing selected settings capability refuses before lazy initialization', async () => {
	const f = await fixture(), missing = new PhotoLibrarySessionV1({ ...f.ports, settings: undefined, developPresetSettings: undefined });
	try {
		await assert.rejects(missing.developImport.importFiles(files(), choice()), TypeError);
		await assert.rejects(missing.developImport.listPresets(), TypeError);
		assert.deepEqual(f.calls(), { initialize: 0, preparation: 0, writes: 0, reads: 0 });
	} finally { await missing.close(); await f.session.close(); }
});
