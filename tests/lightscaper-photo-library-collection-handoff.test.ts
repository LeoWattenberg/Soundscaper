/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { parsePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function fixture(count = 3, selectAll = false) {
	const native = mediaRestoreFixture(), seed = lutArchiveFixture(), name = `lightscaper-collection-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	const root = normalizePhotoCatalogRootV1({ ...seed.root, revision: 0, photoCount: 0, collections: [
		{ id: 'manual', name: 'Selected manual', kind: 'manual' },
		{ id: 'smart', name: 'Selected smart', kind: 'smart', query: { kind: 'rating', minimum: 4, maximum: 5 } },
	] });
	await catalog.createCatalog(root); await media.mediaRepository.writeAsset(seed.record.photo.original.storageKey, seed.record.original);
	await resources.put(LUT_REFERENCE, LUT_BODY);
	const photos = Array.from({ length: count }, (_, index) => {
		const base = seed.record.photo, version = base.versions[0]!;
		return normalizePhotoDocumentV2({ ...base, id: `photo-${String(index).padStart(4, '0')}`, collectionIds: selectAll || index >= count - 2 ? ['manual'] : [],
			metadata: { ...base.metadata, fileName: `Photo ${String(count - index).padStart(4, '0')}.png`, title: index >= count - 2 ? 'Selected' : 'Other' },
			rating: index >= count - 2 ? 4 : 0, versions: [{ ...version, name: `Recipe ${String(index)}`,
				develop: { ...version.develop, effects: version.develop.effects.map(effect => ({ ...effect, enabled: index % 2 === 0 })) } }] });
	});
	for (let offset = 0; offset < photos.length; offset += 16) {
		const selected = photos.slice(offset, offset + 16), current = (await catalog.loadCatalog(root.id))!;
		await catalog.publishPhotos(root.id, current.revision, selected);
		await media.mediaRepository.catalogOriginals.retain(root.id, selected.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
			sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
	}
	while (!(await catalog.rebuildQueryIndexPageV2(root.id)).ready) { /* Actual bounded index owner. */ }
	const snapshot = await catalog.readSmartCollectionSnapshotV1(root.id, null);
	const definition = { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'saved', revision: 0,
		name: 'Saved title descending', query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
			predicate: { kind: 'text', column: 'title', operator: 'equals', value: 'Selected' }, sort: { field: 'photo-id', direction: 'descending' } }) };
	await catalog.saveSmartCollection(definition, null, { expectedCatalogRevision: snapshot.context.catalogRevision,
		expectedIndexRevision: snapshot.context.indexRevision, expectedStateRevision: snapshot.context.collectionStateRevision });
	const calls = { initialize: 0, originals: 0, luts: 0, closed: 0, empty: 0 };
	const backup = { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
		async loadOriginal(original: typeof seed.record.photo.original, signal?: AbortSignal) {
			calls.originals++; return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
		} };
	const bodySource: CubeLutSourcePortV1 = { withBytes(reference, consume, options) { calls.luts++; return resources.source.withBytes(reference, consume, options); } };
	const read = catalog.readQueryPageV2;
	catalog.readQueryPageV2 = async function (...args) { const page = await Reflect.apply(read, this, args); if (!page.items.length && page.continuation) calls.empty++; return page; };
	const ports: PhotoLibrarySessionPortsV2 = { catalog, smartCollections: catalog, backup,
		media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository,
		cubeLutResources: async () => ({ ...resources, source: bodySource }),
		initialize: async () => { calls.initialize++; return (await catalog.loadCatalog(root.id))!; }, exclusive: async (_id, run, signal) => run(signal),
		async closeResources() { calls.closed++; await Promise.all([catalog.close(), media.close()]); } };
	const current = (await catalog.loadCatalog(root.id))!, session = new PhotoLibrarySessionV2(ports);
	const request = { catalogId: root.id, collectionId: 'manual', scope: 'catalog' as const, expectedCatalogRevision: current.revision };
	return { native, name, catalog, media, photos, definition, ports, session, backup, bodySource, calls, request,
		change(photo: unknown, photoId = photos[photos.length - 1]!.id) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|${photoId}`, document: photo }); } };
}
function capture(session: PhotoLibrarySessionV2) {
	assert.ok(session.collectionHandoff, 'Selected Session must expose the whole collection handoff borrower.'); return session.collectionHandoff;
}

test('Light manual and smart collection capture retains deterministic selected recipes and authentic unique bodies', async () => {
	for (const collectionId of ['manual', 'smart']) {
		const f = await fixture(), before = JSON.stringify(await f.catalog.readSnapshot(f.request.catalogId));
		try {
			const answer = await capture(f.session).withCapture({ ...f.request, collectionId }, async view => {
				assert.ok(Object.isFrozen(view) && Object.isFrozen(view.photos));
				assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ['photo-0001', 'photo-0002']);
				assert.deepEqual(view.lutReferences, [LUT_REFERENCE]);
				for (const photo of view.photos) {
					const facts = parsePhotoExportSidecarV1(photo.factsJson);
					assert.equal(facts.version.id, photo.binding.versionId); assert.equal(facts.binding.revision, photo.binding.expectedRevision);
					assert.equal(facts.version.develop.processVersion, 2); assert.equal(facts.version.name, `Recipe ${photo.binding.photoId.slice(-1)}`);
					await view.withOriginal(photo.binding.photoId, async blob => assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]));
				}
				await view.withLutBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY)); return 'complete';
			});
			assert.equal(answer, 'complete'); assert.equal(f.calls.originals, 1); assert.equal(f.calls.luts, 2);
			assert.equal(JSON.stringify(await f.catalog.readSnapshot(f.request.catalogId)), before);
		} finally { await f.session.close(); }
	}
});

test('Light collection scans empty intermediate candidate pages and saved Query2 keeps its native descending order', async () => {
	const f = await fixture(70);
	try {
		await capture(f.session).withCapture(f.request, view => assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ['photo-0068', 'photo-0069']));
		assert.ok(f.calls.empty > 0);
		await capture(f.session).withCapture({ ...f.request, scope: 'saved-query', collectionId: 'saved', expectedDefinitionRevision: 0 }, view => {
			assert.equal(view.collection.name, f.definition.name);
			assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ['photo-0069', 'photo-0068']);
		});
	} finally { await f.session.close(); }
});

test('Light collection refuses foreign getter bindings and retired signals before selected startup', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const port = capture(f.session), bad = Object.defineProperty({ ...f.request }, 'collectionId', { get() { getters++; return 'manual'; }, enumerable: true });
		for (const request of [bad, Object.create(f.request) as typeof f.request, { ...f.request, photos: [] },
			{ ...f.request, scope: 'saved-query' as const }, { ...f.request, expectedDefinitionRevision: 0 }]) await assert.rejects(port.withCapture(request, () => undefined));
		const reason = Object.freeze({ cancel: 'selected' }); await assert.rejects(port.withCapture(f.request, () => undefined, { signal: AbortSignal.abort(reason) }), value => value === reason);
		assert.equal(getters, 0); assert.equal(f.calls.initialize, 0); assert.equal(f.calls.originals, 0);
	} finally { await f.session.close(); }
});

test('Light collection fences complete same-revision Photo changes before delivery and after held consumption', async () => {
	for (const phase of ['body', 'consume'] as const) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal; let consumed = 0;
		if (phase === 'body') f.backup.loadOriginal = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
		// Session pins ports at construction; create a new selected owner for the held source.
		const session = phase === 'body' ? new PhotoLibrarySessionV2(f.ports) : f.session;
		try {
			const work = capture(session).withCapture(f.request, async () => { consumed++; entered.resolve(); if (phase === 'consume') await release.promise; });
			const refused = assert.rejects(work, /changed/iu); await entered.promise;
			const photo = f.photos[f.photos.length - 1]!; f.change(normalizePhotoDocumentV2({ ...photo, metadata: { ...photo.metadata, caption: 'same revision changed' } }));
			release.resolve(); await refused; assert.equal(consumed, phase === 'body' ? 0 : 1);
		} finally { release.resolve(); await session.close(); if (session !== f.session) await f.session.close(); }
	}
});

test('Light saved collection complete definition is fenced even when its revision and matching members are unchanged', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		const work = capture(f.session).withCapture({ ...f.request, scope: 'saved-query', collectionId: 'saved', expectedDefinitionRevision: 0 }, async () => { entered.resolve(); await release.promise; });
		const refused = assert.rejects(work, /changed/iu); await entered.promise;
		const definition = { ...f.definition, name: 'Changed at same revision' };
		f.native.raw(`${f.name}-catalog`).seedRecord(`${f.name}-catalog`, 'photoSmartCollections', photoSmartCollectionRecordV1(definition));
		f.native.raw(`${f.name}-catalog`).seedRecord(`${f.name}-catalog`, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(definition));
		release.resolve(); await refused;
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection joins forgotten LUT work on opaque failure and refuses overlapping or retained body reads', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), primary = new Proxy({}, { getPrototypeOf() { throw new Error('opaque'); } });
	let retained: CubeLutSourcePortV1['withBytes'] | undefined;
	try {
		const work = capture(f.session).withCapture(f.request, async view => {
			retained = view.withLutBytes;
			void view.withLutBytes(LUT_REFERENCE, async () => { entered.resolve(); await release.promise; });
			await assert.rejects(view.withLutBytes(LUT_REFERENCE, () => undefined), /pending/iu); throw primary;
		});
		const refused = assert.rejects(work, value => value instanceof AggregateError && value.cause === primary && value.errors[0] === primary); await entered.promise; assert.equal(await remainsPending(work), true);
		const closing = f.session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.closed, 0); release.resolve(); await refused; await closing;
		await assert.rejects(retained!(LUT_REFERENCE, () => undefined), /closed/iu);
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection authenticates every original source and disabled LUT before delivering any prefix', async () => {
	for (const kind of ['original', 'lut', 'no-lut-delivery'] as const) {
		const f = await fixture(); let consumers = 0;
		if (kind === 'original') f.backup.loadOriginal = async () => new Blob([new Uint8Array([9, 2, 3])]);
		else f.bodySource.withBytes = kind === 'lut' ? async (_reference, borrower) => borrower(new Uint8Array(LUT_BODY.length)) : async () => undefined as never;
		const session = new PhotoLibrarySessionV2(f.ports);
		try { await assert.rejects(capture(session).withCapture(f.request, () => { consumers++; })); assert.equal(consumers, 0); }
		finally { await session.close(); await f.session.close(); }
	}
});

test('Light collection caps all retained full facts and declared unique bodies before native body reads', async () => {
	const f = await fixture(1_000, true); let consumers = 0;
	try { await assert.rejects(capture(f.session).withCapture(f.request, () => { consumers++; }), /capacity/iu);
		assert.equal(consumers, 0); assert.equal(f.calls.originals, 0); assert.equal(f.calls.luts, 0);
	} finally { await f.session.close(); }
	const small = await fixture();
	try { const photo = small.photos[small.photos.length - 1]!;
		small.change(normalizePhotoDocumentV2({ ...photo, original: { ...photo.original, byteLength: 67_108_865 } }));
		await assert.rejects(capture(small.session).withCapture(small.request, () => { consumers++; }), /capacity/iu);
		assert.equal(consumers, 0); assert.equal(small.calls.originals, 0);
	} finally { await small.session.close(); }
});

test('Light collection captures active versions independently even when original body identity is shared', async () => {
	const f = await fixture(), photo = f.photos[1]!, master = photo.versions[0]!;
	f.change(normalizePhotoDocumentV2({ ...photo, activeVersionId: 'selected-copy', versions: [master,
		{ ...master, id: 'selected-copy', kind: 'virtual-copy', name: 'Saved copy', develop: { ...master.develop, effects: [] } }] }), photo.id);
	f.native.raw(`${f.name}-catalog`).seedRecord(`${f.name}-catalog`, 'photoQueryRowsV2', projectPhotoQueryRowV2((await f.catalog.loadPhoto(f.request.catalogId, photo.id))!));
	try { await capture(f.session).withCapture(f.request, view => {
		assert.equal(view.photos.length, 2); assert.equal(view.photos[0]!.binding.versionId, 'selected-copy');
		assert.equal(parsePhotoExportSidecarV1(view.photos[0]!.factsJson).version.name, 'Saved copy');
		assert.notEqual(view.photos[0]!.factsJson, view.photos[1]!.factsJson);
	}); assert.equal(f.calls.originals, 1); }
	finally { await f.session.close(); }
});

test('Light collection refuses root definitions, index or actual membership changes after held delivery', async () => {
	for (const kind of ['definition', 'membership'] as const) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
		try { const work = capture(f.session).withCapture(f.request, async () => { entered.resolve(); await release.promise; });
			const refused = assert.rejects(work, /changed/iu); await entered.promise;
			if (kind === 'definition') { const root = (await f.catalog.loadCatalog(f.request.catalogId))!;
				await f.catalog.saveCatalog({ ...root, collections: root.collections.map(item => ({ ...item, name: 'Changed definition' })) }, root.revision);
			} else { const photo = f.photos[f.photos.length - 1]!; await f.catalog.savePhoto({ ...photo, collectionIds: [] }, photo.revision); }
			release.resolve(); await refused;
		} finally { release.resolve(); await f.session.close(); }
	}
});

test('Light collection request and resource receivers are pinned before held original reads', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal;
	f.backup.loadOriginal = async function (...args) { assert.equal(this, f.backup); entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
	const session = new PhotoLibrarySessionV2(f.ports), request = { ...f.request };
	try { const work = capture(session).withCapture(request, async view => {
		assert.equal(view.collection.id, 'manual'); await view.withLutBytes(LUT_REFERENCE, body => assert.deepEqual(body, LUT_BODY));
	}); request.collectionId = 'missing'; await entered.promise;
		f.bodySource.withBytes = async () => { throw new Error('Mutable replacement must not run.'); };
		f.backup.loadOriginal = async () => { throw new Error('Mutable replacement must not run.'); };
		release.resolve(); await work;
	} finally { release.resolve(); await session.close(); await f.session.close(); }
});

test('Light collection joins held originals on retirement and preserves exact opaque late repository failures', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.backup.loadOriginal;
	f.backup.loadOriginal = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
	const session = new PhotoLibrarySessionV2(f.ports); let consumers = 0;
	try { const work = capture(session).withCapture(f.request, () => { consumers++; }); const refused = assert.rejects(work);
		await entered.promise; const closing = session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.closed, 0);
		release.resolve(); await refused; await closing; assert.equal(consumers, 0);
	} finally { release.resolve(); await session.close(); await f.session.close(); }
	const last = await fixture(), primary = new Proxy({}, { getPrototypeOf() { throw new Error('Do not inspect the primary.'); } });
	const read = last.catalog.loadPhoto; let refusing = false;
	last.catalog.loadPhoto = async function (...args) { if (refusing) throw primary; return Reflect.apply(read, this, args); };
	const selected = new PhotoLibrarySessionV2(last.ports);
	try { await assert.rejects(capture(selected).withCapture(last.request, () => { refusing = true; }), error => error === primary); }
	finally { await selected.close(); await last.session.close(); }
});

test('Light collection seals both capabilities when the consumer settles while forgotten original work remains joined', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	let retained: CubeLutSourcePortV1['withBytes'] | undefined;
	try { const work = capture(f.session).withCapture(f.request, view => {
		retained = view.withLutBytes; void view.withOriginal(view.photos[0]!.binding.photoId, async () => { entered.resolve(); await release.promise; });
	}); await entered.promise; await Promise.resolve(); await Promise.resolve(); assert.equal(await remainsPending(work), true);
		await assert.rejects(retained!(LUT_REFERENCE, () => undefined), /closed/iu);
		release.resolve(); await work;
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection refuses a whole unique body closure over 128 MiB before any selected body read', async () => {
	const f = await fixture(3, true); let consumers = 0;
	try {
		for (const [ordinal, photo] of f.photos.entries()) {
			const changed = normalizePhotoDocumentV2({ ...photo, original: { ...photo.original, storageKey: `original-${ordinal}`,
				contentSha256: String(ordinal + 1).repeat(64), byteLength: 64 * 1024 * 1024 } });
			f.change(changed, photo.id);
			f.native.raw(`${f.name}-catalog`).seedRecord(`${f.name}-catalog`, 'photoQueryRowsV2', projectPhotoQueryRowV2(changed));
		}
		await assert.rejects(capture(f.session).withCapture(f.request, () => { consumers++; }), /capacity/iu);
		assert.equal(consumers, 0); assert.equal(f.calls.originals, 0); assert.equal(f.calls.luts, 0);
	} finally { await f.session.close(); }
});

test('Light collection authenticates a second retained original locator even when its digest matches an owned body', async () => {
	const f = await fixture(), photo = f.photos[2]!; let consumers = 0;
	f.change(normalizePhotoDocumentV2({ ...photo, original: { ...photo.original, storageKey: 'missing-original-locator' } }), photo.id);
	try {
		await assert.rejects(capture(f.session).withCapture(f.request, () => { consumers++; }));
		assert.equal(f.calls.originals, 2); assert.equal(consumers, 0);
	} finally { await f.session.close(); }
});

test('Light collection refuses missing saved digests and substituted native continuations before any body read', async () => {
	for (const kind of ['missing-digest', 'cursor'] as const) {
		const f = await fixture(70), read = f.catalog.readSmartCollectionQueryPageV1; let consumers = 0;
		f.catalog.readSmartCollectionQueryPageV1 = async function (...args) {
			const page = await Reflect.apply(read, this, args), changed = { ...page };
			if (kind === 'missing-digest') Reflect.deleteProperty(changed, 'definitionSha256');
			else { assert.ok(changed.continuation); changed.continuation = { ...changed.continuation, querySha256: '0'.repeat(64) }; }
			return changed;
		};
		const session = new PhotoLibrarySessionV2(f.ports);
		try {
			await assert.rejects(capture(session).withCapture({ ...f.request, collectionId: 'saved', scope: 'saved-query', expectedDefinitionRevision: 0 }, () => { consumers++; }));
			assert.equal(consumers, 0); assert.equal(f.calls.originals, 0); assert.equal(f.calls.luts, 0);
		} finally { await session.close(); await f.session.close(); }
	}
});

test('Light saved capture-time collection exhausts the empty known-clock bucket and preserves unknown tie order', async () => {
	const f = await fixture(3, true), context = (await f.catalog.readSmartCollectionSnapshotV1(f.request.catalogId, 'saved')).context;
	const definition = { ...f.definition, query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
		sort: { field: 'capture-time', direction: 'descending' } }) };
	await f.catalog.saveSmartCollection(definition, 0, { expectedCatalogRevision: context.catalogRevision,
		expectedIndexRevision: context.indexRevision, expectedStateRevision: context.collectionStateRevision });
	const expectedCatalogRevision = (await f.catalog.loadCatalog(f.request.catalogId))!.revision;
	try {
		await capture(f.session).withCapture({ ...f.request, expectedCatalogRevision, scope: 'saved-query', collectionId: 'saved', expectedDefinitionRevision: 1 }, view => {
			assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ['photo-0002', 'photo-0001', 'photo-0000']);
		});
	} finally { await f.session.close(); }
});

test('Light collection refuses same-revision derived summary fields that disagree with the admitted complete Photo', async () => {
	const f = await fixture(), photo = f.photos[2]!; let consumers = 0;
	f.native.raw(`${f.name}-catalog`).seedRecord(`${f.name}-catalog`, 'photoQueryRowsV2', projectPhotoQueryRowV2({ ...photo,
		metadata: { ...photo.metadata, fileName: 'Different sort projection.png' } }));
	try {
		await assert.rejects(capture(f.session).withCapture(f.request, () => { consumers++; }), /changed/iu);
		assert.equal(consumers, 0); assert.equal(f.calls.originals, 0);
	} finally { await f.session.close(); }
});

test('Light collection refuses stale derived membership and saved predicates against complete admitted Photo facts', async () => {
	for (const scope of ['catalog', 'saved-query'] as const) {
		const f = await fixture(), photo = f.photos[2]!; let consumers = 0;
		f.change(normalizePhotoDocumentV2(scope === 'catalog' ? { ...photo, collectionIds: [] }
			: { ...photo, metadata: { ...photo.metadata, title: 'No longer selected' } }), photo.id);
		try {
			await assert.rejects(capture(f.session).withCapture(scope === 'catalog' ? f.request
				: { ...f.request, scope, collectionId: 'saved', expectedDefinitionRevision: 0 }, () => { consumers++; }), /changed/iu);
			assert.equal(consumers, 0); assert.equal(f.calls.originals, 0);
		} finally { await f.session.close(); }
	}
});

test('Light collection refuses stale selected revisions and definitions before acquiring body authority', async () => {
	const f = await fixture();
	try {
		for (const request of [{ ...f.request, expectedCatalogRevision: f.request.expectedCatalogRevision + 1 },
			{ ...f.request, collectionId: 'absent' }, { ...f.request, scope: 'saved-query' as const, collectionId: 'saved', expectedDefinitionRevision: 1 }]) {
			await assert.rejects(capture(f.session).withCapture(request, () => { throw new Error('Stale selection cannot deliver.'); }));
		}
		assert.equal(f.calls.originals, 0); assert.equal(f.calls.luts, 0);
	} finally { await f.session.close(); }
});
