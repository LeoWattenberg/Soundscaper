/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import type { PhotoCatalogRootV1, PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred } from './helpers/async-test-control.ts';

const CATALOG = 'catalog-1', CATALOG_DATABASE = 'lightscaper-hdr-publication-catalog', MEDIA_DATABASE = 'lightscaper-hdr-publication-media';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII='), character => character.charCodeAt(0));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function publicationFixture() {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const native = mediaRestoreFixture(), media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: MEDIA_DATABASE, locks: null, preferOpfs: false });
	const hooks = { verified: async (_original: PhotoOriginalV1): Promise<void> => undefined };
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: CATALOG_DATABASE,
		verifyOriginal: async (original, signal) => { await media.verifyOriginal(original, signal); await hooks.verified(original); } });
	// A separate actual repository connection writes the source. The native
	// transport is modeled; validation, revisions, indexing and body custody are real.
	const writer = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: CATALOG_DATABASE, verifyOriginal: media.verifyOriginal });
	const close = async () => { try { await Promise.all([catalog.close(), writer.close(), media.close()]); }
		finally { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); } };
	try {
		await media.ready(); await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
			id: CATALOG, name: 'HDR transaction', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		const sources = [1, 2].map(index => normalizePhotoDocumentCurrentV1({ ...photoArchiveFixture(index, PNG).photo, schemaVersion: 3 }));
		for (const source of sources) {
			const asset = await media.mediaRepository.writeAsset(source.original.storageKey, new Blob([PNG], { type: source.original.mimeType }));
			await media.mediaRepository.catalogOriginals.stage(CATALOG, 'seed', [{ photoId: source.id, sourceId: source.original.id,
				assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]);
		}
		const root = await catalog.publishPhotos(CATALOG, 0, sources); await media.mediaRepository.catalogOriginals.promote(CATALOG, 'seed', sources.map(source => source.id));
		const provenance = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: 0 },
			inputs: sources.map((source, index) => ({ product: 'lightscaper', ownerId: source.catalogId, sourceId: source.id, revision: source.revision,
				original: { fileName: source.original.name, mimeType: source.original.mimeType, sha256: source.original.contentSha256,
					byteLength: source.original.byteLength, width: 1, height: 1 }, profile: 'encoded-srgb8', exposureMultiplier: index === 0 ? 1 : 4,
				offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 1 })), output: { x: 0, y: 0, width: 1, height: 1 } };
		const bytes = await encodeImageHdrOriginalV1({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
			pixels: Float32Array.of(3, .5, .25, 1) }, provenance);
		const seed = photoArchiveFixture(9, bytes).photo, candidate = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, extractedMetadata: null,
			original: { ...seed.original, name: 'Merged.lshdr', mimeType: 'image/x-lightscaper-hdr', contentSha256: digest(bytes) } });
		const asset = await media.mediaRepository.writeAsset(candidate.original.storageKey, new Blob([bytes], { type: candidate.original.mimeType }));
		await media.mediaRepository.catalogOriginals.stage(CATALOG, 'hdr-candidate', [{ photoId: candidate.id, sourceId: candidate.original.id,
			assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]);
		const selections = sources.map(source => ({ photoId: source.id, revision: source.revision, original: { ...source.original } }));
		return { native, media, catalog, writer, sources, root, candidate, bytes, hooks, selections, close };
	} catch (error) { await close(); throw error; }
}

test('unchanged legacy root-CAS publication demonstrates the selected-source race across actual native repository owners', async () => {
	const f = await publicationFixture(), entered = deferred<void>(), release = deferred<void>(); let work: Promise<unknown> | undefined;
	f.hooks.verified = async original => { if (original.id === f.candidate.original.id) { entered.resolve(); await release.promise; } };
	try {
		// Permanent publication compares the root only. Keep this witness intact
		// when the separate named Current guarded method is implemented.
		work = f.catalog.publishPhotos(CATALOG, f.root.revision, [f.candidate]);
		const outcome = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		await Promise.race([entered.promise, work.then(() => assert.fail('Publication skipped retained Original verification.'), (error: unknown) => { throw error; })]);
		const before = await f.writer.loadCatalog(CATALOG), source = await f.writer.loadPhoto(CATALOG, f.sources[0]!.id); assert.ok(source);
		const saved = await f.writer.savePhoto({ ...source, rating: 5 }, source.revision);
		assert.equal(saved.revision, source.revision + 1); assert.deepEqual(await f.writer.loadCatalog(CATALOG), before, 'Ordinary save leaves root revision unchanged.');
		release.resolve(); const result = await outcome;
		assert.ok(result.ok, 'The unchanged permanent path admits publication despite an unrelated source Photo revision change.');
		assert.ok(await f.catalog.loadPhoto(CATALOG, f.candidate.id));
		assert.equal((await f.catalog.loadCatalog(CATALOG))?.photoCount, f.root.photoCount + 1);
	} finally { release.resolve(); if (work) await Promise.allSettled([work]); await f.close(); }
});

type Selection = Readonly<{ photoId: string; revision: number; original: PhotoOriginalV1 }>;
type DerivedPublish = (catalogId: string, expectedCatalogRevision: number, selections: readonly Selection[], photo: unknown,
	options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoCatalogRootV1>;
function publisher(catalog: PhotoCatalogRepositoryCurrentV1): DerivedPublish {
	// Additive interface-absence RED is intentional; no fallback substitutes
	// permanent publication for the guarded Current authority.
	const method: unknown = Reflect.get(catalog, 'publishDerivedPhotoCurrentV1');
	assert.equal(typeof method, 'function', 'Current native repository must expose publishDerivedPhotoCurrentV1.');
	if (typeof method !== 'function') throw new TypeError('The named native publication method is absent.');
	return (...args) => Reflect.apply(method, catalog, args) as ReturnType<DerivedPublish>;
}

function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function replaceNativePhoto(f: Awaited<ReturnType<typeof publicationFixture>>, photo: ReturnType<typeof normalizePhotoDocumentCurrentV1>): Promise<void> {
	const opening = f.native.factory.open(CATALOG_DATABASE), database = await new Promise<IDBDatabase>((resolve, reject) => {
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	try { await transact(database, ['photos'], 'readwrite', stores => request(stores.photos!.put({ key: `${CATALOG}|${photo.id}`, document: photo }))); }
	finally { database.close(); }
}

test('Current derived publication rejects source revision drift inside the same native transaction as result insertion', async () => {
	const f = await publicationFixture(), entered = deferred<void>(), release = deferred<void>(); let work: Promise<unknown> | undefined;
	f.hooks.verified = async original => { if (original.id === f.candidate.original.id) { entered.resolve(); await release.promise; } };
	try {
		const publish = publisher(f.catalog); work = publish(CATALOG, f.root.revision, f.selections, f.candidate);
		const outcome = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		await Promise.race([entered.promise, work.then(() => assert.fail('Guarded publication skipped retained Original verification.'), (error: unknown) => { throw error; })]);
		const source = await f.writer.loadPhoto(CATALOG, f.sources[0]!.id); assert.ok(source);
		const saved = await f.writer.savePhoto({ ...source, rating: 5 }, source.revision); assert.equal(saved.revision, source.revision + 1);
		assert.deepEqual(await f.writer.loadCatalog(CATALOG), f.root); release.resolve();
		const result = await outcome; assert.ok(!result.ok); assert.ok(result.error instanceof PhotoCatalogRevisionConflictError);
		assert.equal(result.error.code, 'PHOTO_REVISION_CONFLICT'); assert.equal(await f.catalog.loadPhoto(CATALOG, f.candidate.id), null);
		assert.deepEqual(await f.catalog.loadCatalog(CATALOG), f.root);
		for (const store of ['summaries', 'photoQueryRows', 'photoQueryRowsV2', 'memberships']) {
			const rows = f.native.raw(CATALOG_DATABASE).records(CATALOG_DATABASE, store) as Record<string, unknown>[];
			assert.equal(rows.some(row => row.photoId === f.candidate.id || row.photoKey === `${CATALOG}|${f.candidate.id}`), false);
		}
	} finally { release.resolve(); if (work) await Promise.allSettled([work]); await f.close(); }
});

test('Current derived publication atomically inserts one default Photo3 and all native query/index rows without editing its sources', async () => {
	const f = await publicationFixture();
	try {
		const before = await Promise.all(f.sources.map(source => f.writer.loadPhoto(CATALOG, source.id)));
		const result = await publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate);
		assert.equal(result.revision, f.root.revision + 1); assert.equal(result.photoCount, f.root.photoCount + 1);
		const stored = await f.catalog.loadPhoto(CATALOG, f.candidate.id); assert.deepEqual(stored, f.candidate); assert.ok(stored);
		assert.equal(stored.schemaVersion, 3); assert.equal(stored.revision, 0); assert.equal(stored.extractedMetadata, null);
		assert.equal(stored.versions.length, 1); assert.equal(stored.versions[0]!.develop.processVersion, 1);
		assert.deepEqual(await Promise.all(f.sources.map(source => f.writer.loadPhoto(CATALOG, source.id))), before);
		for (const name of ['summaries', 'photoQueryRows', 'photoQueryRowsV2']) {
			const rows = f.native.raw(CATALOG_DATABASE).records(CATALOG_DATABASE, name) as Record<string, unknown>[];
			assert.equal(rows.filter(row => row.photoId === f.candidate.id).length, 1);
		}
		const states = f.native.raw(CATALOG_DATABASE).records(CATALOG_DATABASE, 'catalogStates') as Record<string, unknown>[];
		assert.equal(states.length, 1); assert.equal(states[0]!.rootRevision, result.revision); assert.equal(states[0]!.photoCount, result.photoCount);
		await f.media.verifyOriginal(stored.original); const body = await f.media.mediaRepository.loadAsset(stored.original.storageKey); assert.ok(body instanceof Blob);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.bytes);
	} finally { await f.close(); }
});

test('native source identity drift at the same Photo revision is refused by complete Original comparison', async () => {
	const f = await publicationFixture(), entered = deferred<void>(), release = deferred<void>(); let work: Promise<unknown> | undefined;
	f.hooks.verified = async original => { if (original.id === f.candidate.original.id) { entered.resolve(); await release.promise; } };
	try {
		work = publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate); const outcome = observed(work);
		await Promise.race([entered.promise, work.then(() => assert.fail('No suspended Original verification.'), (error: unknown) => { throw error; })]);
		const source = f.sources[0]!;
		// Deliberate native-row fault injection: ordinary savePhoto correctly
		// forbids Original changes, so revision alone cannot model this damage.
		await replaceNativePhoto(f, normalizePhotoDocumentCurrentV1({ ...source, original: { ...source.original, name: 'Replaced at the same revision.png' } }));
		assert.equal((await f.writer.loadPhoto(CATALOG, source.id))?.revision, source.revision); release.resolve();
		const result = await outcome; assert.ok(!result.ok); assert.ok(result.error instanceof PhotoCatalogRevisionConflictError);
		assert.equal(await f.catalog.loadPhoto(CATALOG, f.candidate.id), null); assert.deepEqual(await f.catalog.loadCatalog(CATALOG), f.root);
	} finally { release.resolve(); if (work) await Promise.allSettled([work]); await f.close(); }
});

test('every captured Original field participates in the native derived source guard', async () => {
	const f = await publicationFixture(), original = f.selections[0]!.original;
	const patches = [{ id: 'different-source' }, { name: 'Different.png' }, { mimeType: 'image/jpeg' }, { storageKey: 'different-body' },
		{ contentSha256: 'f'.repeat(64) }, { byteLength: original.byteLength + 1 }, { width: 2 }, { height: 2 }, { hasAlpha: true }, { retention: 'linked' as const }];
	try {
		for (const patch of patches) {
			const selections = f.selections.map((selection, index) => index === 0 ? { ...selection, original: { ...selection.original, ...patch } } : selection);
			await assert.rejects(publisher(f.catalog)(CATALOG, f.root.revision, selections, f.candidate), PhotoCatalogRevisionConflictError);
		}
		assert.equal(await f.catalog.loadPhoto(CATALOG, f.candidate.id), null); assert.deepEqual(await f.catalog.loadCatalog(CATALOG), f.root);
	} finally { await f.close(); }
});

test('a missing selected native Photo refuses derived insertion without writing result indexes', async () => {
	const f = await publicationFixture();
	try {
		await f.native.remove(CATALOG_DATABASE, 'photos', `${CATALOG}|${f.sources[1]!.id}`);
		await assert.rejects(publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate), ReferenceError);
		assert.equal(await f.catalog.loadPhoto(CATALOG, f.candidate.id), null); assert.deepEqual(await f.catalog.loadCatalog(CATALOG), f.root);
	} finally { await f.close(); }
});

test('source guards, result and signal options are captured before retained Original verification yields', async () => {
	const f = await publicationFixture(), entered = deferred<void>(), release = deferred<void>(); let work: Promise<PhotoCatalogRootV1> | undefined;
	const selections = f.selections.map(selection => ({ ...selection, original: { ...selection.original } }));
	const candidate = { ...f.candidate, original: { ...f.candidate.original } }, options: { signal?: AbortSignal } = {};
	f.hooks.verified = async original => { if (original.id === f.candidate.original.id) { entered.resolve(); await release.promise; } };
	try {
		work = publisher(f.catalog)(CATALOG, f.root.revision, selections, candidate, options);
		await Promise.race([entered.promise, work.then(() => assert.fail('No verification yield.'), (error: unknown) => { throw error; })]);
		selections[0]!.revision++; selections[0]!.original.storageKey = 'late-body'; selections.splice(1);
		candidate.original.name = 'Late replacement'; const stop = new AbortController(); stop.abort(); options.signal = stop.signal;
		release.resolve(); const result = await work; assert.equal(result.photoCount, f.root.photoCount + 1);
		assert.deepEqual(await f.catalog.loadPhoto(CATALOG, f.candidate.id), f.candidate);
	} finally { release.resolve(); if (work) await Promise.allSettled([work]); await f.close(); }
});

test('derived native publication validates closed source guards before body verification and keeps pre-abort identity', async () => {
	const f = await publicationFixture(); let verified = 0, getters = 0;
	f.hooks.verified = async () => { verified++; };
	try {
		const publish = publisher(f.catalog), invalid: unknown[] = [[], [f.selections[0]], Array.from({ length: 10 }, () => f.selections[0]),
			[f.selections[0], f.selections[0]], [{ ...f.selections[0], photoId: f.candidate.id }, f.selections[1]],
			[{ ...f.selections[0], revision: -1 }, f.selections[1]], [{ ...f.selections[0], extra: true }, f.selections[1]],
			[Object.defineProperty({ ...f.selections[0] }, 'original', { enumerable: true, get() { getters++; throw new Error('Original getter executed.'); } }), f.selections[1]]];
		for (const selections of invalid) await assert.rejects(Reflect.apply(publish, undefined, [CATALOG, f.root.revision, selections, f.candidate]) as Promise<unknown>);
		await assert.rejects(publish(CATALOG, f.root.revision, f.selections, { ...f.candidate, revision: 1 }), RangeError);
		const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
		const hostile = new Proxy(f.selections, { ownKeys() { getters++; throw new Error('Pre-aborted source metadata was inspected.'); } });
		const result = await observed(publish(CATALOG, f.root.revision, hostile, f.candidate, { signal: stop.signal }));
		assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.equal(verified, 0); assert.equal(getters, 0);
		const legacy = new PhotoCatalogRepositoryV2({ indexedDB: f.native.factory, databaseName: CATALOG_DATABASE, verifyOriginal: f.media.verifyOriginal });
		try { assert.equal(Reflect.get(legacy, 'publishDerivedPhotoCurrentV1'), undefined); } finally { await legacy.close(); }
	} finally { await f.close(); }
});

test('failure of a result index write rolls back native derived Photo, root, state and earlier indexes', async () => {
	const f = await publicationFixture(), failure = new Error('Injected native query index failure.');
	try {
		const before = ['photos', 'summaries', 'photoQueryRows', 'photoQueryRowsV2', 'catalogs', 'catalogStates'].map(name => ({ name,
			rows: f.native.raw(CATALOG_DATABASE).records(CATALOG_DATABASE, name) }));
		f.native.raw(CATALOG_DATABASE).failNextPutForStore('photoQueryRowsV2', failure);
		await assert.rejects(publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate));
		for (const { name, rows } of before) assert.deepEqual(f.native.raw(CATALOG_DATABASE).records(CATALOG_DATABASE, name), rows);
	} finally { await f.close(); }
});

test('source row reads and derived Photo insertion belong to the same native readwrite transaction', async () => {
	const f = await publicationFixture(), accesses: { transaction: IDBTransaction; action: 'get' | 'put'; key: unknown }[] = [];
	f.native.observeTransactions((transaction, names, mode) => {
		if (mode !== 'readwrite' || ![...names].includes('photos')) return;
		const open = transaction.objectStore;
		transaction.objectStore = name => {
			const store = Reflect.apply(open, transaction, [name]) as IDBObjectStore;
			if (name === 'photos') {
				const get = store.get, put = store.put;
				store.get = key => { accesses.push({ transaction, action: 'get', key }); return Reflect.apply(get, store, [key]) as IDBRequest<unknown>; };
				store.put = (value: unknown, key?: IDBValidKey) => {
					const storedKey: unknown = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'key')?.value : key;
					accesses.push({ transaction, action: 'put', key: storedKey }); return Reflect.apply(put, store, [value, key]) as IDBRequest<IDBValidKey>;
				};
			}
			return store;
		};
	});
	try {
		await publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate);
		const insertion = accesses.find(value => value.action === 'put' && value.key === `${CATALOG}|${f.candidate.id}`); assert.ok(insertion);
		for (const source of f.sources) {
			const read = accesses.find(value => value.action === 'get' && value.key === `${CATALOG}|${source.id}`); assert.ok(read);
			assert.equal(read.transaction, insertion.transaction); assert.ok(accesses.indexOf(read) < accesses.indexOf(insertion));
		}
	} finally { f.native.observeTransactions(null); await f.close(); }
});

test('a genuine derived native commit survives source drift and opaque cancellation before its delayed ACK is delivered', async () => {
	const f = await publicationFixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let armed = true, afterCommit: Promise<void> | undefined, lateFailure: unknown, sourceRevision: number | undefined;
	f.native.observeTransactions((transaction, names, mode) => {
		if (!armed || mode !== 'readwrite' || ![...names].includes('photos')) return;
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, get: () => handler, set(value: IDBTransaction['oncomplete']) {
			if (typeof value !== 'function') { handler = null; return; }
			const complete = value;
			handler = function (this: IDBTransaction, event: Event) {
				// The native transaction has committed. Delay only notification to
				// observe a real subsequent source save, never a fabricated ACK.
				armed = false;
				afterCommit = (async () => {
					const source = f.sources[0]!, saved = await f.writer.savePhoto({ ...source, rating: 4 }, source.revision);
					sourceRevision = saved.revision; stop.abort(opaque.proxy);
				})();
				void afterCommit.then(() => { Reflect.apply(complete, this, [event]); }, (error: unknown) => { lateFailure = error; Reflect.apply(complete, this, [event]); });
			};
		} });
	});
	try {
		const result = await publisher(f.catalog)(CATALOG, f.root.revision, f.selections, f.candidate, { signal: stop.signal });
		assert.equal(lateFailure, undefined); assert.equal(sourceRevision, f.sources[0]!.revision + 1); assert.ok(Object.is(stop.signal.reason, opaque.proxy));
		assert.equal(result.revision, f.root.revision + 1); assert.equal(result.photoCount, f.root.photoCount + 1);
		assert.deepEqual(await f.catalog.loadPhoto(CATALOG, f.candidate.id), f.candidate); await f.media.verifyOriginal(f.candidate.original);
	} finally { f.native.observeTransactions(null); if (afterCommit) await Promise.allSettled([afterCommit]); await f.close(); }
});
