/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryImportSettingsPortV1, PhotoLibraryImportSettingsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibraryPreparationOutcomeV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const settings: PhotoLibraryImportSettingsV1 = { rename: { template: '{stem}-{sequence}.{extension}', sequenceStart: 10, sequencePadding: 3 },
	metadata: { title: '', creator: 'Authored creator' }, keywordIds: ['existing-keyword'] };
const files = () => [1, 2, 3].map(index => new File([new Uint8Array([1, 2, 3])], `Photo ${index}.png`, { type: 'image/png' }));

async function fixture(keywordCount = 1) {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-settings-session-media-${crypto.randomUUID()}`,
		locks: null, preferOpfs: false, syncWorkerClient: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `lightscaper-settings-session-catalog-${crypto.randomUUID()}`, verifyOriginal: media.verifyOriginal });
	const keywords = Array.from({ length: keywordCount }, (_, index) => ({ id: index === 0 ? 'existing-keyword' : `existing-keyword-${index}`, name: `Keyword ${index}`, parentId: null }));
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Import settings library', revision: 0, photoCount: 0, folders: [], keywords, collections: [] }));
	let initialize = 0, preparation = 0, identity = 0, writes = 0;
	let failSelected: number | null = 1;
	let publishBoundary: (() => void) | null = null;
	let presetRead: ((key: string) => Promise<unknown>) | null = null;
	let presetCreate: ((operation: () => Promise<boolean>) => Promise<boolean>) | null = null;
	let writerWait: (() => Promise<void>) | null = null;
	const ports = {
		initialize: async () => { initialize++; const root = await catalog.loadCatalog('catalog-1'); assert.ok(root); return root; },
		closeResources: async () => { await catalog.close(); await media.close(); },
		createId: () => `settings-identity-${String(++identity)}`,
		exclusive: async <Result>(_id: string, operation: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal) => { await writerWait?.(); return operation(signal); },
		catalog: {
			loadCatalog: catalog.loadCatalog.bind(catalog), loadPhoto: catalog.loadPhoto.bind(catalog), saveCatalog: catalog.saveCatalog.bind(catalog),
			savePhoto: catalog.savePhoto.bind(catalog), readSummaryPage: catalog.readSummaryPage.bind(catalog),
			readQueryPage: catalog.readQueryPage.bind(catalog), rebuildQueryIndexPage: catalog.rebuildQueryIndexPage.bind(catalog),
			publishPhotos: async (...args: Parameters<PhotoCatalogRepositoryV1['publishPhotos']>) => {
				const root = await catalog.publishPhotos(...args); publishBoundary?.(); return root;
			},
		},
		media: { writeAsset: async (...args: Parameters<typeof media.mediaRepository.writeAsset>) => { writes++; return media.mediaRepository.writeAsset(...args); },
			custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository,
		settings: { get: (key: string) => presetRead ? presetRead(key) : media.settingsRepository.get(key),
			putIfAbsent: (key: string, value: unknown) => presetCreate ? presetCreate(() => media.settingsRepository.putIfAbsent(key, value)) : media.settingsRepository.putIfAbsent(key, value),
			replaceIfCurrent: media.settingsRepository.replaceIfCurrent },
		prepare: async function* (): AsyncGenerator<PhotoLibraryPreparationOutcomeV1> {
			preparation++;
			for (let index = 0; index < 3; index++) {
				const source = photoArchiveFixture(index + 1);
				if (index === failSelected) {
					yield { outcome: 'failed', index, fileName: source.photo.original.name, error: new Error('broken source') }; continue;
				}
				const photo = normalizePhotoDocumentV1({ ...source.photo,
					metadata: { ...source.photo.metadata, title: 'Source title', caption: 'Source caption', creator: 'Source creator', copyright: 'Source copyright', location: 'Source location' },
					extractedMetadata: { schemaVersion: 1, container: 'png', exif: null, iptc: null, issues: ['unsupported-text-encoding'] } });
				yield { ...source, photo, outcome: 'prepared', index, fileName: photo.original.name, keywordNames: ['Extracted keyword'], notices: [] };
			}
		},
	};
	const session = new PhotoLibrarySessionV1(ports) as PhotoLibrarySessionV1 & PhotoLibraryImportSettingsPortV1;
	return { session, catalog, media, calls: () => ({ initialize, preparation, writes }),
		failSelected: (index: number | null) => { failSelected = index; },
		publishBoundary: (run: () => void) => { publishBoundary = run; },
		presetRead: (run: (key: string) => Promise<unknown>) => { presetRead = run; },
		presetCreate: (run: (operation: () => Promise<boolean>) => Promise<boolean>) => { presetCreate = run; },
		writerWait: (run: () => Promise<void>) => { writerWait = run; },
	};
}

test('session applies one import recipe after preparation and keeps failed sequence slots and source receipt names', async () => {
	const f = await fixture(), observed: PhotoLibraryImportItemV1[] = [];
	try {
		const result = await f.session.importFiles(files(), { settings, onAcknowledged: item => { observed.push(item); } });
		assert.deepEqual(result.map(item => [item.index, item.fileName, item.status]), [[0, 'Photo 1.png', 'imported'], [1, 'Photo 2.png', 'failed'], [2, 'Photo 3.png', 'imported']]);
		assert.deepEqual(observed, [result[0], result[2]]);
		for (const index of [1, 3]) {
			const photo = await f.catalog.loadPhoto('catalog-1', `photo-${index}`), original = photoArchiveFixture(index).photo;
			assert.ok(photo); await f.media.verifyOriginal(photo.original);
			assert.equal(photo.metadata.fileName, `Photo ${index}-0${9 + index}.png`);
			assert.equal(photo.metadata.title, ''); assert.equal(photo.metadata.creator, 'Authored creator');
			assert.equal(photo.metadata.caption, 'Source caption'); assert.equal(photo.metadata.copyright, 'Source copyright');
			assert.equal(photo.metadata.location, 'Source location');
			assert.equal(photo.original.name, original.original.name); assert.equal(photo.original.contentSha256, original.original.contentSha256);
			assert.deepEqual(photo.versions, original.versions); assert.deepEqual(photo.extractedMetadata?.issues, ['unsupported-text-encoding']);
			assert.ok(photo.keywordIds.includes('existing-keyword')); assert.equal(photo.keywordIds.length, 2);
		}
		assert.deepEqual(result.map(item => item.reusedOriginal), [false, false, true]);
		assert.deepEqual(f.calls(), { initialize: 1, preparation: 1, writes: 1 });
	} finally { await f.session.close(); }
});

test('explicit keyword memberships take priority over extracted names at the existing 1024-membership limit', async () => {
	const f = await fixture(1024); f.failSelected(null);
	try {
		const root = await f.catalog.loadCatalog('catalog-1'); assert.ok(root);
		const recipe = { ...settings, keywordIds: root.keywords.map(keyword => keyword.id) };
		const result = await f.session.importFiles(files(), { settings: recipe });
		assert.deepEqual(result.map(item => item.status), ['imported', 'imported', 'imported']);
		assert.ok(result.every(item => item.hasMetadataNotices));
		const photo = await f.catalog.loadPhoto('catalog-1', 'photo-3'); assert.ok(photo);
		assert.deepEqual(photo.keywordIds, [...recipe.keywordIds].sort());
		assert.equal((await f.catalog.loadCatalog('catalog-1'))?.keywords.length, 1024);
	} finally { await f.session.close(); }
});

test('missing fresh keyword references and any invalid gesture name refuse before preparing or storing originals', async () => {
	const f = await fixture();
	try {
		await assert.rejects(f.session.importFiles(files(), { settings: { ...settings, keywordIds: ['removed-keyword'] } }), /keyword/iu);
		const selected = files(); selected[2] = new File(['bad'], 'x'.repeat(256));
		await assert.rejects(f.session.importFiles(selected, { settings }), /name/iu);
		assert.equal(f.calls().preparation, 0); assert.equal(f.calls().writes, 0);
		assert.equal((await f.catalog.loadCatalog('catalog-1'))?.photoCount, 0);
	} finally { await f.session.close(); }
});

test('recipe admission snapshots authored choices and rejects accessors before lazy session initialization', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const hostile = Object.defineProperty({}, 'title', { enumerable: true, get: () => { getters++; return 'bad'; } });
		await assert.rejects(f.session.importFiles(files(), { settings: { ...settings, metadata: hostile } }), TypeError);
		const options = Object.defineProperty({}, 'settings', { enumerable: true, get: () => { getters++; return settings; } });
		await assert.rejects(f.session.importFiles(files(), options), TypeError);
		assert.equal(getters, 0); assert.deepEqual(f.calls(), { initialize: 0, preparation: 0, writes: 0 });
		const recipe = { ...settings, metadata: { creator: 'Before' } };
		const importing = f.session.importFiles(files(), { settings: recipe }); recipe.metadata.creator = 'After';
		await importing;
		assert.equal((await f.catalog.loadPhoto('catalog-1', 'photo-1'))?.metadata.creator, 'Before');
	} finally { await f.session.close(); }
});

test('late cancellation reports the durable selected-file acknowledgment and the same session recovers before its next read', async () => {
	const f = await fixture(), stop = new AbortController(), observed: PhotoLibraryImportItemV1[] = [];
	f.failSelected(0); f.publishBoundary(() => { stop.abort(); });
	try {
		await assert.rejects(f.session.importFiles(files(), { signal: stop.signal, settings, onAcknowledged: item => { observed.push(item); } }), { name: 'AbortError' });
		assert.deepEqual(observed.map(item => [item.index, item.fileName, item.photoId, item.status]), [[1, 'Photo 2.png', 'photo-2', 'imported']]);
		assert.equal((await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: null })).roots.length, 0);
		assert.notEqual(await f.media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
		const page = await f.session.readPage(); assert.equal(page.totalCount, 1);
		assert.equal(f.calls().initialize, 2);
		assert.equal(await f.media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
		assert.equal((await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, 1);
	} finally { await f.session.close(); }
});

test('session preset reads and writes use the catalog-owned settings port without importing photos', async () => {
	const f = await fixture();
	try {
		assert.deepEqual(await f.session.readImportPresets(), { revision: 0, presets: [] });
		const saved = await f.session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'recipe', name: 'My import', settings });
		assert.equal(saved.revision, 1); assert.deepEqual(saved.presets[0]?.settings, settings);
		await assert.rejects(f.session.applyImportPreset({ type: 'delete', expectedRevision: 0, id: 'recipe' }), { code: 'IMPORT_PRESET_REVISION_CONFLICT' });
		assert.deepEqual(await f.session.applyImportPreset({ type: 'delete', expectedRevision: 1, id: 'recipe' }), { revision: 2, presets: [] });
		assert.deepEqual(f.calls(), { initialize: 1, preparation: 0, writes: 0 });
	} finally { await f.session.close(); }
});

test('preset admission refuses another read or write until canceled native work settles and close joins that work', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<unknown>(), stop = new AbortController();
	let reads = 0, closed = false;
	f.presetRead(async () => { reads++; if (reads === 1) { entered.resolve(); return held.promise; } return undefined; });
	const reading = f.session.readImportPresets({ signal: stop.signal });
	const settled = reading.then(() => undefined, () => undefined);
	try {
		await entered.promise; stop.abort();
		await assert.rejects(f.session.readImportPresets(), /already pending/iu);
		await assert.rejects(f.session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'recipe', name: 'My import', settings }), /already pending/iu);
		assert.equal(reads, 1);
		const closing = f.session.close().then(() => { closed = true; });
		await remainsPending(closing); assert.equal(closed, false);
		held.resolve(undefined);
		await assert.rejects(reading, { name: 'AbortError' }); await closing;
		assert.equal(closed, true);
	} finally { held.resolve(undefined); await settled; await f.session.close(); }
});

test('a canceled pending preset CAS keeps its slot until durable acknowledgement and then admits the next request', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>(), stop = new AbortController();
	f.presetCreate(async operation => { const published = await operation(); entered.resolve(); await held.promise; return published; });
	const saving = f.session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'recipe', name: 'My import', settings }, { signal: stop.signal });
	const settled = saving.then(() => undefined, () => undefined);
	try {
		await entered.promise; stop.abort();
		await assert.rejects(f.session.readImportPresets(), /already pending/iu);
		await assert.rejects(f.session.applyImportPreset({ type: 'delete', expectedRevision: 1, id: 'recipe' }), /already pending/iu);
		assert.equal(await remainsPending(saving), true);
		held.resolve();
		const acknowledged = await saving; assert.equal(acknowledged.revision, 1); assert.equal(acknowledged.presets[0]?.id, 'recipe');
		assert.deepEqual(await f.session.readImportPresets(), acknowledged);
		assert.deepEqual(await f.session.applyImportPreset({ type: 'delete', expectedRevision: 1, id: 'recipe' }), { revision: 2, presets: [] });
	} finally { held.resolve(); await settled; await f.session.close(); }
});

test('a writer-busy refusal releases preset admission without overlapping or canceling the admitted import', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>();
	await f.session.readImportPresets();
	f.writerWait(async () => { entered.resolve(); await held.promise; });
	const importing = f.session.importFiles(files());
	const settled = importing.then(() => undefined, () => undefined);
	try {
		await entered.promise;
		await assert.rejects(f.session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'recipe', name: 'My import', settings }), /library change is already pending/iu);
		assert.deepEqual(await f.session.readImportPresets(), { revision: 0, presets: [] });
		held.resolve();
		assert.equal((await importing).filter(item => item.status === 'imported').length, 2);
		assert.equal((await f.session.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'recipe', name: 'My import', settings })).revision, 1);
	} finally { held.resolve(); await settled; await f.session.close(); }
});
