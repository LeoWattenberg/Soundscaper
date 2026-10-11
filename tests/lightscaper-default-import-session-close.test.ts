/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { MediaCatalogOriginalRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-repository.ts';
import { catalogOriginalReferences, normalizeCatalogOriginalRoot } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { readStoredPhotoV1OrV2 } from '../src/lightscaper/catalog/photo-catalog-records-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';
import { photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as DEFAULT_CATALOG } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as NAMES } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { installDirectoryModel } from './helpers/lightscaper-opfs-original-staging-fixture.ts';
import { qualifyPhotoDefaultImportSessionCloseNativeV1, type PhotoDefaultImportSessionCloseCutV1 } from './helpers/lightscaper-default-import-session-close-native-v1.ts';

type Mode = 'original' | 'stage' | 'publish' | 'retire';
const ownerCuts = { original: 'original-completed-ack', stage: 'stage-completed-ack', publish: 'publish-completed-ack', retire: 'retire-completed-ack' } satisfies
	Record<Mode, PhotoDefaultImportSessionCloseCutV1>;
const DONOR = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64'));
const SELECTED = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const SETTINGS = { rename: { template: 'received-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 3 },
	metadata: { title: 'Default import', caption: 'Joined current ownership', creator: 'Node storage fixture' }, keywordIds: [] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function locks(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name); try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}
function outcome<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

// Scoped Node platform/storage ports exercise the actual async file-storage
// fallback and current Session owners, not a browser decoder or OPFS worker.
function fileSystemFixture() {
	const files = new Map<string, Blob>(), events: string[] = [];
	const directory = {
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('Missing fixture file', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return { async getFile() { const file = files.get(path); assert.ok(file); return file; },
				async createWritable() { const parts: BlobPart[] = []; events.push('open'); return {
					write(part: BlobPart) { parts.push(part); events.push('write'); return Promise.resolve(); },
					close() { files.set(path, new Blob(parts)); events.push('close'); return Promise.resolve(); },
					abort() { events.push('abort'); return Promise.resolve(); },
				}; },
			};
		},
		async removeEntry(path: string) { if (!files.delete(path)) throw new DOMException('Missing fixture file', 'NotFoundError'); events.push('remove'); },
	};
	const root = { async getDirectoryHandle(name: string) { assert.equal(name, NAMES.opfsDirectoryName); return directory; } };
	return { files, events, root, directory };
}
function platformFixture(fs: ReturnType<typeof fileSystemFixture>, lockPort: LockManager) {
	const values = { IDBKeyRange: InstrumentedKeyRange, Worker: undefined, ImageDecoder: undefined,
		navigator: { locks: lockPort, storage: { getDirectory: () => Promise.resolve(fs.root) } },
		createImageBitmap: () => Promise.resolve({ width: 1, height: 1, close() {} }),
		OffscreenCanvas: class {
			constructor(readonly width: number, readonly height: number) {}
			getContext() { return { clearRect() {}, drawImage() {}, getImageData() { return { data: Uint8ClampedArray.of(23, 71, 149, 255) }; } }; }
		},
	};
	const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
	const model = installDirectoryModel(fs);
	return () => { model.reset(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}

async function fixture(native: ReturnType<typeof mediaRestoreFixture>, lockPort: LockManager, fs: ReturnType<typeof fileSystemFixture>) {
	assert.notEqual(sha(DONOR), sha(SELECTED));
	const options = { name: 'Default import Close', indexedDB: native.factory, locks: lockPort }, setup = await createPhotoLibrarySessionV3(options);
	let donorId: string, catalogId: string;
	try {
		assert.equal((await setup.readPage()).totalCount, 0);
		const receipt = await setup.importFiles([new File([DONOR], 'prior.png', { type: 'image/png', lastModified: 0 })]);
		assert.equal(receipt.length, 1); assert.equal(receipt[0]?.status, 'imported'); assert.equal(typeof receipt[0]?.photoId, 'string'); donorId = receipt[0]!.photoId!;
		const stored = native.raw(DEFAULT_CATALOG).records(DEFAULT_CATALOG, 'photos') as unknown[]; assert.equal(stored.length, 1);
		catalogId = readStoredPhotoV1OrV2(stored[0]).catalogId;
		const lut = (await setup.cubeLuts.importFile(new Blob([LUT_BODY], { type: 'text/plain' }))).reference; assert.deepEqual(lut, LUT_REFERENCE);
		const develop = setup.develop, presets = develop.presets, settings = develop.settings; assert.ok(presets); assert.ok(settings);
		const recipe = { ...defaultImageDevelopStateV2(), effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1' as const, enabled: false, params: { lut } }] };
		const preset = presets.create({ schemaVersion: 2, id: 'preset', name: 'Current disabled LUT', settings: settings.copy({
			schemaVersion: 2, develop: recipe, selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
		await presets.write({ schemaVersion: 2, catalogId, command: { type: 'save', expectedRevision: 0, preset } });
		await setup.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'metadata', name: 'Metadata', settings: SETTINGS });
	} finally { await setup.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
	const selected = await (async () => { try { return await withPhotoLibraryInitializationLockV1(lockPort,
		authority => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: () => Promise.reject(new Error('The actual default initializer already committed its pointer.')) }, authority.signal));
	} finally { await anchor.close(); } })();
	assert.equal(selected.pointer.schemaVersion, 1); assert.equal(selected.allocation, null);
	assert.equal(selected.location.catalogDatabaseName, DEFAULT_CATALOG); assert.equal(selected.location.mediaDatabaseName, NAMES.databaseName);
	assert.equal(selected.location.catalogId, catalogId);
	const intentKey = photoImportIntentKeyV1(catalogId), presetKey = photoDevelopPresetsKeyV1(catalogId);
	async function snapshot() {
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: DEFAULT_CATALOG, verifyOriginal: media.verifyOriginal,
			verifyResources: async (photo, signal) => { await (await media.getCubeLutResources()).verifyPhoto(photo, signal); } });
		const result = await outcome(read());
		const ended = await Promise.allSettled([media.close(), catalog.close()]);
		const errors = ended.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
		if (errors.length) throw new AggregateError([...(!result.ok ? [result.error] : []), ...errors], 'Default Node snapshot cleanup failed.', !result.ok ? { cause: result.error } : undefined);
		if (!result.ok) throw result.error; return result.value;
		async function read() {
			const root = await catalog.loadCatalog(catalogId); assert.ok(root);
			const photos = (native.raw(DEFAULT_CATALOG).records(DEFAULT_CATALOG, 'photos') as unknown[]).map(value => readStoredPhotoV1OrV2(value));
			assert.equal(photos.length, root.photoCount);
			const donor = photos.find(photo => photo.id === donorId); assert.ok(donor); assert.equal(donor.schemaVersion, 1);
			const current = photos.find(photo => photo.id !== donorId) ?? null;
			const originalRecords = native.raw(NAMES.databaseName).records(NAMES.databaseName, 'mediaAssets') as Array<Record<string, unknown>>;
			const roots = (native.raw(NAMES.databaseName).records(NAMES.databaseName, 'catalogOriginalRoots') as unknown[]).map(normalizeCatalogOriginalRoot);
			const rootCounts = originalRecords.map(record => { const count = record.catalogRootCount ?? 0; assert.equal(typeof count, 'number');
				assert.equal(count, roots.filter(value => value.assetId === record.sourceId).length); return { sha256: record.sha256, count }; });
			const immutableRecords = originalRecords.map(record => { const value = { ...record }; delete value.catalogRootCount; return value; });
			const bodies = await Promise.all(originalRecords.map(async record => {
				assert.equal(record.storage, 'opfs'); assert.equal(typeof record.path, 'string'); assert.equal(record.blob, undefined);
				assert.equal(typeof record.mediaContentToken, 'string'); const file = fs.files.get(record.path as string); assert.ok(file);
				const loaded = await media.mediaRepository.loadAsset(record.sourceId as string); assert.ok(loaded);
				const bytes = new Uint8Array(await loaded.arrayBuffer()), persisted = new Uint8Array(await file.arrayBuffer());
				try { assert.equal(sha(bytes), record.sha256); assert.deepEqual(bytes, persisted); assert.equal(bytes.length, record.size);
					assert.deepEqual(bytes, record.sha256 === sha(DONOR) ? DONOR : SELECTED);
				} finally { bytes.fill(0); persisted.fill(0); }
				return { key: record.sourceId, sha256: record.sha256, token: record.mediaContentToken, path: record.path, size: record.size };
			}));
			assert.equal(fs.files.size, originalRecords.length);
			for (const retained of roots) assert.equal(retained.mediaContentToken, bodies.find(body => body.key === retained.assetId)?.token);
			await media.verifyOriginal(donor.original); if (current) { await media.verifyOriginal(current.original); await (await media.getCubeLutResources()).verifyPhoto(current); }
			await (await media.getCubeLutResources()).source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); return Promise.resolve(); });
			return { root, donor, current, roots, rootCounts, immutableRecords, bodies,
				donorRecord: originalRecords.find(record => record.sourceId === donor.original.storageKey),
				preset: normalizePhotoDevelopPresetRowV1OrV2(await media.settingsRepository.get(presetKey), catalogId),
				importSettings: await media.settingsRepository.get(photoImportPresetsKeyV1(catalogId)),
				journal: await media.settingsRepository.get(intentKey) };
		}
	}
	return { options, catalogId, intentKey, snapshot, before: await snapshot() };
}

async function heldImport(mode: Mode) {
	const native = mediaRestoreFixture(), lockPort = locks(), fs = fileSystemFixture(), reset = platformFixture(fs, lockPort);
	try {
		const f = await fixture(native, lockPort, fs), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const revoked = Proxy.revocable({}, {}); revoked.revoke(); const opaque: unknown = revoked.proxy;
		const saved: Array<readonly [object, string, PropertyDescriptor]> = [], acknowledged: PhotoLibraryImportItemV1[] = [];
		let held = false, currentKey = '', candidateId = '', mediaCloses = 0, catalogCloses = 0;
		let session: Awaited<ReturnType<typeof createPhotoLibrarySessionV3>> | undefined;
		let importing: ReturnType<typeof outcome<readonly PhotoLibraryImportItemV1[]>> | undefined, closing: ReturnType<typeof outcome<void>> | undefined;
		function replace(owner: object, key: string, value: unknown) { const descriptor = Object.getOwnPropertyDescriptor(owner, key); assert.ok(descriptor);
			saved.push([owner, key, descriptor]); Object.defineProperty(owner, key, { ...descriptor, value }); }
		async function hold(at: Mode) { if (at === mode && !held) { held = true; entered.resolve(); await release.promise; } }
		try {
			const original = MediaRepository.prototype.writeAsset;
			replace(MediaRepository.prototype, 'writeAsset', async function(this: MediaRepository, ...args: Parameters<typeof original>) {
				const value = await Reflect.apply(original, this, args) as Awaited<ReturnType<typeof original>>;
				if (args[2]?.name === 'new-selected.png') { currentKey = args[0]; assert.equal(value.storage, 'opfs'); assert.equal(typeof value.path, 'string'); await hold('original'); } return value;
			});
			const stage = MediaCatalogOriginalRepositoryV1.prototype.stage;
			replace(MediaCatalogOriginalRepositoryV1.prototype, 'stage', async function(this: MediaCatalogOriginalRepositoryV1, ...args: Parameters<typeof stage>) {
				const value = await Reflect.apply(stage, this, args) as Awaited<ReturnType<typeof stage>>;
				if (args[0] === f.catalogId) { const references = catalogOriginalReferences(args[2]); assert.equal(references.length, 1);
					assert.equal(references[0]?.assetId, currentKey); candidateId = references[0]!.photoId; await hold('stage'); } return value;
			});
			const publish = PhotoCatalogRepositoryV2.prototype.publishPhotos;
			replace(PhotoCatalogRepositoryV2.prototype, 'publishPhotos', async function(this: PhotoCatalogRepositoryV2, ...args: Parameters<typeof publish>) {
				const value = await Reflect.apply(publish, this, args) as Awaited<ReturnType<typeof publish>>;
				if (args[0] === f.catalogId) { assert.equal(args[2].length, 1); const photo = normalizePhotoDocumentV1OrV2(args[2][0]);
					assert.equal(photo.id, candidateId); await hold('publish'); } return value;
			});
			const retire = KeyValueRepository.prototype.deleteIfCurrent;
			replace(KeyValueRepository.prototype, 'deleteIfCurrent', async function(this: KeyValueRepository, ...args: Parameters<typeof retire>) {
				const value = await Reflect.apply(retire, this, args) as Awaited<ReturnType<typeof retire>>;
				if (args[0] === f.intentKey) { assert.equal(value, true); await hold('retire'); } return value;
			});
			const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryV2.prototype.close;
			replace(PhotoMediaStoreV1.prototype, 'close', function(this: PhotoMediaStoreV1) { mediaCloses++; return Reflect.apply(closeMedia, this, []) as Promise<void>; });
			replace(PhotoCatalogRepositoryV2.prototype, 'close', function(this: PhotoCatalogRepositoryV2) { catalogCloses++; return Reflect.apply(closeCatalog, this, []) as Promise<void>; });
			session = await createPhotoLibrarySessionV3(f.options);
			const choices = await session.developImport.listPresets(), settings = await session.readImportPresets(); assert.equal(choices.presets[0]?.id, 'preset');
			assert.deepEqual(settings.presets[0]?.settings, SETTINGS); mediaCloses = 0; catalogCloses = 0;
			importing = outcome(session.developImport.importFiles([new File([SELECTED], 'new-selected.png', { type: 'image/png', lastModified: 0 })], {
				schemaVersion: 2, developPreset: { schemaVersion: 2, catalogId: f.catalogId, presetId: 'preset', expectedRevision: choices.revision },
				settings: settings.presets[0]!.settings, signal: stop.signal, onAcknowledged: item => { acknowledged.push(item); },
			}));
			await Promise.race([entered.promise, importing.then(value => { if (!value.ok) throw value.error; throw new Error('Actual import settled without entering the requested owner hold.'); })]);
			assert.notEqual(currentKey, ''); assert.equal(acknowledged.length, Number(mode === 'retire'));
			stop.abort(opaque); const close = session.close(); closing = outcome(close); assert.equal(session.close(), close);
			await settle(3); assert.equal(await remainsPending(importing), true); assert.equal(await remainsPending(close), true);
			assert.equal(mediaCloses, 0); assert.equal(catalogCloses, 0); await assert.rejects(session.readPage(), /closed/u);
			release.resolve(); const result = await importing; assert.equal((await closing).ok, true);
			if (mode === 'retire') { assert.equal(result.ok, true); if (result.ok) assert.equal(result.value[0]?.status, 'imported'); }
			else { assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, opaque), true); }
			assert.equal(acknowledged.length, Number(mode === 'publish' || mode === 'retire')); assert.equal(mediaCloses, 1); assert.equal(catalogCloses, 1);
		} finally {
			release.resolve(); if (importing) await importing; if (session) await (closing ?? outcome(session.close()));
			for (const [owner, key, descriptor] of saved.reverse()) Object.defineProperty(owner, key, descriptor);
		}
		const interrupted = await f.snapshot(), published = mode === 'publish' || mode === 'retire', staged = mode === 'stage' || mode === 'publish';
		assert.equal(interrupted.root.photoCount, 1 + Number(published)); assert.equal(interrupted.bodies.length, 2);
		assert.equal(interrupted.roots.filter(value => value.importId !== null).length, Number(staged));
		assert.equal(interrupted.roots.filter(value => value.importId === null).length, 1 + Number(mode === 'retire'));
		assert.equal(interrupted.rootCounts.find(value => value.sha256 === sha(SELECTED))?.count, Number(mode !== 'original'));
		if (mode === 'retire') assert.equal(interrupted.journal, undefined); else assert.equal(normalizePhotoImportIntentV1(interrupted.journal, f.catalogId).catalogId, f.catalogId);
		assert.deepEqual(interrupted.donor, f.before.donor); assert.deepEqual(interrupted.donorRecord, f.before.donorRecord);
		if (published) { const photo = interrupted.current; assert.ok(photo); assert.equal(photo.id, candidateId); assert.equal(photo.schemaVersion, 2);
			assert.equal(photo.original.storageKey, currentKey); assert.equal(photo.original.name, 'new-selected.png'); assert.equal(photo.metadata.fileName, 'received-007.png');
			assert.equal(photo.versions[0]?.develop.processVersion, 2); assert.equal(photo.versions[0]?.develop.effects[0]?.enabled, false);
			assert.deepEqual(photo.versions[0]?.develop, f.before.preset.presets[0]?.settings.develop);
			assert.deepEqual(photo.versions[0]?.develop.effects[0]?.params, { lut: LUT_REFERENCE });
			for (const [key, value] of Object.entries(SETTINGS.metadata)) assert.equal(Reflect.get(photo.metadata, key), value);
		} else assert.equal(interrupted.current, null);
		for (let reopen = 0; reopen < 2; reopen++) {
			const current = await createPhotoLibrarySessionV3(f.options);
			try { assert.equal((await current.readPage()).totalCount, 1 + Number(published)); } finally { await current.close(); }
			const after = await f.snapshot(); assert.equal(after.journal, undefined); assert.equal(after.roots.filter(value => value.importId !== null).length, 0);
			assert.equal(after.roots.length, 1 + Number(published)); assert.equal(after.rootCounts.find(value => value.sha256 === sha(SELECTED))?.count, Number(published));
			assert.deepEqual(after.current, interrupted.current); assert.deepEqual(after.bodies, interrupted.bodies); assert.deepEqual(after.immutableRecords, interrupted.immutableRecords);
			assert.deepEqual(after.donor, f.before.donor); assert.deepEqual(after.donorRecord, f.before.donorRecord);
			assert.deepEqual(after.roots.find(value => value.photoId === f.before.donor.id), f.before.roots[0]);
			assert.deepEqual(after.preset, f.before.preset); assert.deepEqual(after.importSettings, f.before.importSettings);
		}
		assert.equal(fs.events.filter(value => value === 'open').length, 2); assert.equal(fs.events.filter(value => value === 'write').length, 2);
		assert.equal(fs.events.filter(value => value === 'close').length, 2); assert.equal(fs.events.includes('abort'), false); assert.equal(fs.events.includes('remove'), false);
	} finally { reset(); }
}

test('default import native cut admission refuses unknown/restored/opaque values before browser acquisition', { concurrency: false }, async () => {
	const names = ['navigator', 'indexedDB', 'Worker'] as const, saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	let acquired = 0, reflected = 0; const opaque = Symbol('No native acquisition');
	for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { acquired++; throw opaque; } });
	const proxy = new Proxy({}, { get() { reflected++; throw opaque; }, getPrototypeOf() { reflected++; throw opaque; }, ownKeys() { reflected++; throw opaque; } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	try {
		for (const value of [undefined, null, false, 1, NaN, '', 'payload-put', 'inventory-put', 'completed-ack', 'after-write', 'writer-open', 'writer-write',
			'writer-close', 'stage-after', 'retire-before', 'publish-completed-ack ', Symbol('cut'), { get cut() { reflected++; throw opaque; } }, proxy, revoked.proxy]) {
			await assert.rejects(qualifyPhotoDefaultImportSessionCloseNativeV1(value), (error: unknown) => error instanceof RangeError && /cut/iu.test(error.message));
		}
		assert.equal(acquired, 0); assert.equal(reflected, 0);
	} finally { for (const [index, name] of names.entries()) { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
});

for (const mode of ['original', 'stage', 'publish', 'retire'] as const) test(`actual default runtime3 import Close joins ${ownerCuts[mode]} and retains real file custody`,
	{ concurrency: false }, async () => { await heldImport(mode); });
