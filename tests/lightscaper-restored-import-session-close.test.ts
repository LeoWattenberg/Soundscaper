/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { MediaCatalogOriginalRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-repository.ts';
import { catalogOriginalReferences, normalizeCatalogOriginalRoot } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import type { PhotoCubeLutArchiveSourceV1 } from '../src/lightscaper/archive/cube-lut-archive-source-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoCatalogRepositoryKernelV2 } from '../src/lightscaper/catalog/photo-catalog-repository-kernel-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as DEFAULT_CATALOG } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { normalizePhotoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { qualifyPhotoRestoredImportSessionCloseNativeV1, type PhotoRestoredImportSessionCloseCutV1 } from './helpers/lightscaper-restored-import-session-close-native-v1.ts';

type Mode = 'stage' | 'publish' | 'retire';
const ownerCuts = { stage: 'stage-completed-ack', publish: 'publish-completed-ack', retire: 'retire-completed-ack' } satisfies
	Record<Mode, PhotoRestoredImportSessionCloseCutV1>;
const DONOR = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64'));
const SELECTED = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
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

// A scoped Node bitmap/canvas platform fixture lets the current runtime's real
// preparation reach storage ownership. It does not qualify native PNG decoding.
function platformFixture() {
	const values = { IDBKeyRange: InstrumentedKeyRange, ImageDecoder: undefined,
		createImageBitmap: () => Promise.resolve({ width: 1, height: 1, close() {} }),
		OffscreenCanvas: class {
			constructor(readonly width: number, readonly height: number) {}
			getContext() { return { clearRect() {}, drawImage() {}, getImageData() { return { data: Uint8ClampedArray.of(23, 71, 149, 255) }; } }; }
		},
	};
	const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
	return () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}

async function fixture() {
	assert.notEqual(sha(DONOR), sha(SELECTED), 'The selected original must not deduplicate away its native write.');
	const native = mediaRestoreFixture(), lockPort = locks(), options = { name: 'Restored import Close', indexedDB: native.factory, locks: lockPort };
	const bootstrap = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await bootstrap.readPage()).totalCount, 0); } finally { await bootstrap.close(); }
	const defaultRows = () => PHOTO_CATALOG_STORES.map(store => native.raw(DEFAULT_CATALOG).records(DEFAULT_CATALOG, store));
	const defaultBefore = defaultRows(), input = photoArchiveFixture(1, DONOR), row = lutArchiveFixture().row;
	const resources: PhotoCubeLutArchiveSourceV1 = { async withBytes(reference, consume) {
		assert.deepEqual(reference, LUT_REFERENCE); const bytes = new Uint8Array(LUT_BODY);
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	const archive = await exportPhotoCatalogArchiveV5(mediaRestoreRoot(1), [input], [], null, [], row, resources);
	assert.ok(archive.blob); assert.equal(archive.document.schemaVersion, 5);
	const restore = createPhotoLibraryRestoreRuntimeV2(options);
	try { const receipt = await restore.restoreArchive(archive.blob); assert.equal(receipt.photoCount, 1); } finally { await restore.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
	const selected = await (async () => { try {
		return await withPhotoLibraryInitializationLockV1(lockPort, authority => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: () => Promise.reject(new Error('V5 restore must already have committed its selected pointer.')) }, authority.signal));
	} finally { await anchor.close(); } })();
	assert.equal(selected.pointer.schemaVersion, 2); assert.ok(selected.allocation);
	assert.notEqual(selected.location.catalogDatabaseName, DEFAULT_CATALOG);
	const catalogId = input.photo.catalogId, intentKey = photoImportIntentKeyV1(catalogId), presetKey = photoDevelopPresetsKeyV1(catalogId);
	function owners() {
		const fixed = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal,
			verifyResources: async (photo, signal) => { await (await media.getCubeLutResources()).verifyPhoto(photo, signal); } });
		return { fixed, media, catalog, async close() {
			const ended = await Promise.allSettled([fixed.close(), media.close(), catalog.close()]);
			const errors = ended.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Restored import fixture cleanup failed.');
		} };
	}
	async function snapshot(candidateId?: string) {
		const owner = owners();
		try {
			const root = await owner.catalog.loadCatalog(catalogId); assert.ok(root);
			const donor = await owner.catalog.loadPhoto(catalogId, input.photo.id); assert.deepEqual(donor, input.photo);
			const raw = native.raw(selected.location.mediaDatabaseName), database = selected.location.mediaDatabaseName;
			const originalRecords: unknown[] = raw.records(database, 'mediaAssets');
			const rootRecords: unknown[] = raw.records(database, 'catalogOriginalRoots');
			const roots = rootRecords.map(normalizeCatalogOriginalRoot);
			const immutableRecords = originalRecords.map(record => {
				const immutable = { ...record as Record<string, unknown> }; delete immutable.catalogRootCount; return immutable;
			});
			const rootCounts = originalRecords.map(record => {
				const value = record as { sourceId: string; sha256: string; catalogRootCount: number };
				assert.equal(value.catalogRootCount, roots.filter(root => root.assetId === value.sourceId).length);
				return { key: value.sourceId, sha256: value.sha256, count: value.catalogRootCount };
			});
			const donorRecord = originalRecords.find(record => (record as { sourceId: string }).sourceId === input.photo.original.storageKey);
			const bodies = await Promise.all(originalRecords.map(async record => {
				const value = record as { sourceId: string; sha256: string; size: number; mediaContentToken: string; storage: string };
				assert.equal(value.storage, value.sha256 === sha(DONOR) ? MEDIA_ASSET_CHUNK_STORAGE_TYPE : 'indexeddb-blob');
				assert.equal(typeof value.mediaContentToken, 'string');
				const body = await owner.media.mediaRepository.loadAsset(value.sourceId); assert.ok(body);
				const bytes = new Uint8Array(await body.arrayBuffer());
				try { assert.equal(sha(bytes), value.sha256); assert.equal(bytes.length, value.size);
					assert.deepEqual(bytes, value.sha256 === sha(DONOR) ? DONOR : SELECTED);
				} finally { bytes.fill(0); }
				return { key: value.sourceId, sha256: value.sha256, size: value.size, token: value.mediaContentToken };
			}));
			for (const storedRoot of roots) assert.equal(storedRoot.mediaContentToken, bodies.find(body => body.key === storedRoot.assetId)?.token);
			const preset = await owner.media.settingsRepository.get(presetKey); assert.deepEqual(preset, row);
			const cube = await owner.media.getCubeLutResources(); await cube.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); return Promise.resolve(); });
			const commit = normalizePhotoLibraryRestoreCommitV1(await owner.fixed.settingsRepository.get(photoLibraryRestoreCommitKeyV1(selected.allocation!.namespaceToken)));
			assert.deepEqual(commit.allocation, selected.allocation); assert.deepEqual(commit.replacementPointer, selected.pointer);
			assert.deepEqual(defaultRows(), defaultBefore);
			return { root, donor, roots, bodies, immutableRecords, rootCounts, donorRecord, preset, commit, journal: await owner.media.settingsRepository.get(intentKey),
				candidate: candidateId === undefined ? null : await owner.catalog.loadPhoto(catalogId, candidateId) };
		} finally { await owner.close(); }
	}
	return { native, options, selected, catalogId, row, input, intentKey, owners, snapshot, before: await snapshot() };
}

async function heldImport(mode: Mode) {
	const retirePlatform = platformFixture();
	try {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const revoked = Proxy.revocable({}, {}); revoked.revoke(); const opaque: unknown = revoked.proxy;
		const saved: Array<readonly [object, string, PropertyDescriptor]> = [], acknowledged: PhotoLibraryImportItemV1[] = [];
		let held = false, candidateId = '', mediaCloses = 0, catalogCloses = 0;
		let session: Awaited<ReturnType<typeof createPhotoLibrarySessionV3>> | undefined;
		let importing: ReturnType<typeof outcome<readonly PhotoLibraryImportItemV1[]>> | undefined;
		let closing: ReturnType<typeof outcome<void>> | undefined;
		function replace(owner: object, key: string, value: unknown) {
			const descriptor = Object.getOwnPropertyDescriptor(owner, key); assert.ok(descriptor);
			saved.push([owner, key, descriptor]); Object.defineProperty(owner, key, { ...descriptor, value });
		}
		async function hold(at: Mode) { if (mode === at && !held) { held = true; entered.resolve(); await release.promise; } }
		try {
			const stage = MediaCatalogOriginalRepositoryV1.prototype.stage;
			replace(MediaCatalogOriginalRepositoryV1.prototype, 'stage', async function(this: MediaCatalogOriginalRepositoryV1, ...args: Parameters<typeof stage>) {
				const value = await Reflect.apply(stage, this, args) as Awaited<ReturnType<typeof stage>>;
				if (args[0] === f.catalogId) { candidateId = catalogOriginalReferences(args[2])[0]!.photoId; await hold('stage'); } return value;
			});
			const publish = PhotoCatalogRepositoryKernelV2.prototype.publishPhotos;
			replace(PhotoCatalogRepositoryKernelV2.prototype, 'publishPhotos', async function(this: PhotoCatalogRepositoryKernelV2, ...args: Parameters<typeof publish>) {
				const value = await Reflect.apply(publish, this, args) as Awaited<ReturnType<typeof publish>>;
				if (args[0] === f.catalogId) {
					assert.equal(args[2].length, 1); const candidate = normalizePhotoDocumentV1OrV2(args[2][0]);
					assert.equal(candidate.id, candidateId); await hold('publish');
				} return value;
			});
			const retire = KeyValueRepository.prototype.deleteIfCurrent;
			replace(KeyValueRepository.prototype, 'deleteIfCurrent', async function(this: KeyValueRepository, ...args: Parameters<typeof retire>) {
				const value = await Reflect.apply(retire, this, args) as Awaited<ReturnType<typeof retire>>;
				if (args[0] === f.intentKey) { assert.equal(value, true); await hold('retire'); } return value;
			});
			const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryKernelV2.prototype.close;
			replace(PhotoMediaStoreV1.prototype, 'close', function(this: PhotoMediaStoreV1) { mediaCloses++; return Reflect.apply(closeMedia, this, []) as Promise<void>; });
			replace(PhotoCatalogRepositoryKernelV2.prototype, 'close', function(this: PhotoCatalogRepositoryKernelV2) { catalogCloses++; return Reflect.apply(closeCatalog, this, []) as Promise<void>; });
			session = await createPhotoLibrarySessionV3(f.options);
			const choices = await session.developImport.listPresets(); assert.equal(choices.revision, f.row.revision); assert.equal(choices.presets[0]?.id, 'preset');
			mediaCloses = 0; catalogCloses = 0;
			importing = outcome(session.developImport.importFiles([new File([SELECTED], 'new-selected.png', { type: 'image/png', lastModified: 1_700_000_000_000 })], {
				schemaVersion: 2, developPreset: { schemaVersion: 2, catalogId: f.catalogId, presetId: 'preset', expectedRevision: choices.revision }, signal: stop.signal,
				onAcknowledged: receipt => { acknowledged.push(receipt); },
			}));
			await Promise.race([entered.promise, importing.then(result => {
				if (!result.ok) throw result.error;
				throw new Error('The real import settled without entering its requested owner hold.');
			})]); assert.notEqual(candidateId, '');
			assert.equal(acknowledged.length, mode === 'retire' ? 1 : 0, 'Publish ACK delivery itself may still be held after native publication.');
			stop.abort(opaque); const close = session.close(); closing = outcome(close); assert.equal(session.close(), close);
			await settle(3); assert.equal(await remainsPending(importing), true); assert.equal(await remainsPending(close), true);
			assert.equal(mediaCloses, 0); assert.equal(catalogCloses, 0); await assert.rejects(session.readPage(), /closed/u);
			release.resolve(); const result = await importing; assert.equal((await closing).ok, true);
			if (mode === 'retire') { assert.equal(result.ok, true); if (result.ok) assert.equal(result.value[0]?.status, 'imported'); }
			else { assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, opaque), true); }
			assert.equal(acknowledged.length, mode === 'stage' ? 0 : 1);
			assert.equal(mediaCloses, 2); assert.equal(catalogCloses, 1);
		} finally {
			release.resolve(); if (importing) await importing;
			if (session) await (closing ?? outcome(session.close()));
			for (const [owner, key, descriptor] of saved.reverse()) Object.defineProperty(owner, key, descriptor);
		}
		// Readonly owners observe the interrupted journal before a reopened Session
		// readPage invokes its actual import recovery. No unrooted body is deleted.
		const interrupted = await f.snapshot(candidateId), published = mode !== 'stage';
		assert.equal(interrupted.root.photoCount, published ? 2 : 1); assert.equal(interrupted.bodies.length, 2);
		assert.equal(interrupted.rootCounts.find(value => value.sha256 === sha(SELECTED))?.count, 1);
		assert.deepEqual(interrupted.donorRecord, f.before.donorRecord);
		assert.equal(interrupted.roots.filter(root => root.importId !== null).length, mode === 'retire' ? 0 : 1);
		assert.equal(interrupted.roots.filter(root => root.importId === null).length, mode === 'retire' ? 2 : 1);
		if (mode === 'retire') assert.equal(interrupted.journal, undefined);
		else assert.equal(normalizePhotoImportIntentV1(interrupted.journal, f.catalogId).catalogId, f.catalogId);
		const reader = f.owners();
		try {
			const imported = await reader.catalog.loadPhoto(f.catalogId, candidateId);
			if (!published) assert.equal(imported, null);
			else { assert.ok(imported); const photo = normalizePhotoDocumentV1OrV2(imported);
				assert.equal(photo.schemaVersion, 2); assert.equal(photo.original.contentSha256, sha(SELECTED)); assert.equal(photo.original.name, 'new-selected.png');
				assert.deepEqual(photo.versions[0]!.develop, f.row.presets[0]!.settings.develop);
				assert.equal(photo.versions[0]!.develop.effects[0]?.enabled, false); await reader.media.verifyOriginal(photo.original);
			}
		} finally { await reader.close(); }
		for (let reopen = 0; reopen < 2; reopen++) {
			const current = await createPhotoLibrarySessionV3(f.options);
			try { assert.equal((await current.readPage()).totalCount, published ? 2 : 1); } finally { await current.close(); }
			const after = await f.snapshot(candidateId); assert.equal(after.journal, undefined);
			assert.deepEqual(after.candidate, interrupted.candidate, 'Recovery must retain the entire acknowledged Photo and its saved process2 recipe.');
			assert.equal(after.roots.filter(root => root.importId !== null).length, 0); assert.equal(after.roots.length, published ? 2 : 1);
			assert.equal(after.rootCounts.find(value => value.sha256 === sha(SELECTED))?.count, published ? 1 : 0);
			assert.deepEqual(after.bodies, interrupted.bodies); assert.deepEqual(after.immutableRecords, interrupted.immutableRecords);
			assert.deepEqual(after.donorRecord, f.before.donorRecord);
			assert.deepEqual(after.bodies.find(body => body.key === f.input.photo.original.storageKey), f.before.bodies[0]);
			assert.deepEqual(after.roots.find(root => root.photoId === f.input.photo.id), f.before.roots[0]);
			assert.deepEqual(after.preset, f.before.preset); assert.deepEqual(after.commit, f.before.commit);
		}
	} finally { retirePlatform(); }
}

test('restored import native cut admission refuses preview/future/opaque values before browser acquisition', { concurrency: false }, async () => {
	const names = ['navigator', 'indexedDB'] as const, saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	let acquired = 0, reflected = 0; const opaque = Symbol('No native acquisition');
	for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { acquired++; throw opaque; } });
	const proxy = new Proxy({}, { get() { reflected++; throw opaque; }, getPrototypeOf() { reflected++; throw opaque; }, ownKeys() { reflected++; throw opaque; } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	try {
		for (const value of [undefined, null, false, 1, NaN, '', 'payload-put', 'inventory-put', 'completed-ack', 'stage-after', 'retire-before',
			'publish-completed-ack ', Symbol('cut'), { get cut() { reflected++; throw opaque; } }, proxy, revoked.proxy]) {
			await assert.rejects(qualifyPhotoRestoredImportSessionCloseNativeV1(value), (error: unknown) => error instanceof RangeError && /cut/iu.test(error.message));
		}
		assert.equal(acquired, 0); assert.equal(reflected, 0);
	} finally { for (const [index, name] of names.entries()) { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
});

for (const mode of ['stage', 'publish', 'retire'] as const) test(`actual restored runtime3 import Close joins ${ownerCuts[mode]} and reopens exact mixed resources`,
	{ concurrency: false }, async () => { await heldImport(mode); });
