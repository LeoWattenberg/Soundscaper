/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { assertPhotoDevelopHandoffMasksV1 } from '../src/lightscaper/controller/photo-develop-handoff-masks-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV2, type PhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { parsePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

const BRUSH = `brush-mask-v1:2:1:${'a'.repeat(64)}`;
const CREATED = '2026-10-11T00:00:00.000Z';
const STEP = Object.freeze({ label: 'Retained edit', createdAt: CREATED });
type Location = 'active' | 'disabled' | 'unbound' | 'unused' | 'inactive' | 'history' | 'redo' | 'snapshot';
type Owner = 'single' | 'collection';

function brushDevelop(base: PhotoDocumentV2['versions'][number]['develop'], sourceRef: string, location: Location) {
	return normalizeImageDevelopStateV1OrV2({ ...base, processVersion: 2,
		effects: [...base.effects, { id: 'local-color', type: 'color-adjust', enabled: location !== 'disabled', params: { brightness: 0.25 } }],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'Brush', kind: 'raster', sourceRef }],
			nodes: location === 'unused' ? [{ id: 'output', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]
				: [{ id: 'output', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'output' }],
		maskBindings: location === 'unbound' || location === 'unused' ? [] : [{ effectId: 'local-color', maskId: 'brush' }] });
}

function retainedBrush(photo: PhotoDocumentV2, location: Location, sourceRef = BRUSH): PhotoDocumentV2 {
	const master = photo.versions[0]!, develop = brushDevelop(master.develop, sourceRef, location);
	if (location === 'inactive') return normalizePhotoDocumentV2({ ...photo, versions: [master,
		{ ...master, id: 'inactive-copy', kind: 'virtual-copy', name: 'Retained copy', develop }] });
	if (location === 'history' || location === 'redo' || location === 'snapshot') {
		let workspace = createPhotoDevelopWorkspaceV2(master.develop, STEP);
		if (location === 'history') {
			workspace = createPhotoDevelopWorkspaceV2(develop, STEP);
			workspace = commitPhotoDevelopWorkspaceV2(workspace, master.develop, { ...STEP, label: 'Current clean edit' });
		} else if (location === 'redo') {
			workspace = selectPhotoDevelopHistoryV2(commitPhotoDevelopWorkspaceV2(workspace, develop, STEP), 0);
		} else workspace = { ...workspace, snapshots: [{ id: 'snapshot', name: 'Retained brush', createdAt: CREATED, develop }] };
		return normalizePhotoDocumentV2({ ...photo, versions: [{ ...master, workspace }] });
	}
	return normalizePhotoDocumentV2({ ...photo, versions: [{ ...master, develop }] });
}

/** Actual catalog/media/Session owners over controlled IndexedDB event ports.
 * Raw selected Photo rows model retained persisted metadata, including future
 * resource IDs; this fixture does not claim native brush decoding or custody. */
async function fixture() {
	const native = mediaRestoreFixture(), seed = lutArchiveFixture(), name = `lightscaper-brush-handoff-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	const root = normalizePhotoCatalogRootV1({ ...seed.root, revision: 0, photoCount: 0,
		collections: [{ id: 'manual', name: 'Native selected order', kind: 'manual' }] });
	try {
		await catalog.createCatalog(root); await media.mediaRepository.writeAsset(seed.record.photo.original.storageKey, seed.record.original);
		await resources.put(LUT_REFERENCE, LUT_BODY);
		const photos = ['A.png', 'Z.png'].map((fileName, index) => normalizePhotoDocumentV2({ ...seed.record.photo,
			id: `photo-${index}`, collectionIds: ['manual'], metadata: { ...seed.record.photo.metadata, fileName } }));
		await catalog.publishPhotos(root.id, 0, photos);
		await media.mediaRepository.catalogOriginals.retain(root.id, photos.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
			sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
		while (!(await catalog.rebuildQueryIndexPageV2(root.id)).ready) { /* Actual bounded index owner. */ }
		const calls = { originals: 0, luts: 0, resourceScopes: 0, closed: 0 };
		const backup = { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			async loadOriginal(original: typeof seed.record.photo.original, signal?: AbortSignal) {
				calls.originals++; return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
			} };
		const bodySource: CubeLutSourcePortV1 = { withBytes(reference, consume, options) {
			calls.luts++; return resources.source.withBytes(reference, consume, options);
		} };
		const ports: PhotoLibrarySessionPortsV2 = { catalog, backup,
			media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository,
			cubeLutResources: async () => { calls.resourceScopes++; return { ...resources, source: bodySource }; },
			initialize: async () => (await catalog.loadCatalog(root.id))!, exclusive: async (_id, run, signal) => run(signal),
			async closeResources() { calls.closed++; await Promise.all([catalog.close(), media.close()]); } };
		const currentRoot = (await catalog.loadCatalog(root.id))!;
		return { photos, catalog, calls, backup, ports, open: () => new PhotoLibrarySessionV2(ports),
			imageRequest: { catalogId: root.id, photoId: photos[1]!.id, versionId: photos[1]!.activeVersionId, expectedRevision: 0 },
			collectionRequest: { catalogId: root.id, collectionId: 'manual', scope: 'catalog' as const, expectedCatalogRevision: currentRoot.revision },
			change(photo: PhotoDocumentV2) {
				native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|${photo.id}`, document: photo });
				native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photoQueryRowsV2', projectPhotoQueryRowV2(photo));
			} };
	} catch (error) { await Promise.all([catalog.close(), media.close()]); throw error; }
}

for (const owner of ['single', 'collection'] as const) {
	test(`Light ${owner} handoff refuses brush references throughout the complete retained Photo before bodies or consumer`, async () => {
		for (const location of ['active', 'disabled', 'unbound', 'unused', 'inactive', 'history', 'redo', 'snapshot'] as const) {
			const f = await fixture(), changed = retainedBrush(f.photos[1]!, location); f.change(changed);
			const session = f.open(); let consumers = 0;
			try {
				const before = await f.catalog.readSnapshot(f.imageRequest.catalogId);
				await assert.rejects(owner === 'single' ? session.imageHandoff.withCapture(f.imageRequest, () => { consumers++; })
					: session.collectionHandoff.withCapture(f.collectionRequest, () => { consumers++; }), /brush|portable|portability/iu);
				assert.deepEqual(f.calls, { originals: 0, luts: 0, resourceScopes: 0, closed: 0 }, location);
				assert.equal(consumers, 0, location); assert.deepEqual(await f.catalog.readSnapshot(f.imageRequest.catalogId), before);
			} finally { await session.close(); }
		}
	});

	test(`Light ${owner} handoff refuses malformed and future reserved brush references retained only in redo`, async () => {
		for (const sourceRef of ['brush-mask-v1:02:1:' + 'a'.repeat(64), 'brush-mask-v9:2:1:' + 'a'.repeat(64), 'brush-mask-v1:2:1:not-a-digest']) {
			const f = await fixture(); f.change(retainedBrush(f.photos[1]!, 'redo', sourceRef)); const session = f.open(); let consumers = 0;
			try {
				await assert.rejects(owner === 'single' ? session.imageHandoff.withCapture(f.imageRequest, () => { consumers++; })
					: session.collectionHandoff.withCapture(f.collectionRequest, () => { consumers++; }));
				assert.deepEqual(f.calls, { originals: 0, luts: 0, resourceScopes: 0, closed: 0 }); assert.equal(consumers, 0);
			} finally { await session.close(); }
		}
	});
}

test('Light scalar range masks and disabled LUTs remain portable in actual single and collection captures', async () => {
	for (const owner of ['single', 'collection'] as const) {
		const f = await fixture(), photo = f.photos[1]!, version = photo.versions[0]!;
		const develop = normalizeImageDevelopStateV1OrV2({ ...version.develop, masks: [{ schemaVersion: 1, id: 'range', kind: 'mask', inputs: [],
			nodes: [{ id: 'luma', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
				{ id: 'color', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0.1, falloff: 0.1 },
				{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['luma', 'color'] }], outputNodeId: 'both' }],
			maskBindings: [{ effectId: 'lut', maskId: 'range' }] });
		assertPhotoDevelopHandoffMasksV1(develop, 1, 1);
		f.change(normalizePhotoDocumentV2({ ...photo, versions: [{ ...version, develop }] })); const session = f.open();
		try {
			if (owner === 'single') await session.imageHandoff.withCapture(f.imageRequest, async view => {
				assert.deepEqual(parsePhotoExportSidecarV1(view.factsJson).version.develop, develop);
				assert.deepEqual(view.lutReferences, [LUT_REFERENCE]); await view.withLutBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY));
				assert.deepEqual([...new Uint8Array(await view.originalBlob.arrayBuffer())], [1, 2, 3]);
			});
			else await session.collectionHandoff.withCapture(f.collectionRequest, async view => {
				assert.deepEqual(view.photos.map(item => item.binding.photoId), ['photo-0', 'photo-1']);
				assert.deepEqual(parsePhotoExportSidecarV1(view.photos[1]!.factsJson).version.develop, develop);
				assert.deepEqual(view.lutReferences, [LUT_REFERENCE]); await view.withOriginal(photo.id, async blob => {
					assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
				});
			});
			assert.equal(f.calls.originals, 1); assert.ok(f.calls.luts >= 1);
		} finally { await session.close(); }
	}
});

test('Light portable mask admission continues to refuse unrelated external inputs in Source2 before rendering', () => {
	const seed = lutArchiveFixture().record.photo;
	for (const sourceRef of [BRUSH, 'unowned-external-alpha']) {
		assert.throws(() => assertPhotoDevelopHandoffMasksV1(brushDevelop(seed.versions[0]!.develop, sourceRef, 'active'), 1, 1), /source|input|portable|brush/iu);
	}
});

test('Light allowed handoff still joins held actual original reads through opaque caller cancellation and Close', async () => {
	for (const owner of ['single', 'collection'] as readonly Owner[]) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
		const load = f.backup.loadOriginal;
		f.backup.loadOriginal = async function (...args) { entered.resolve(); await release.promise; return Reflect.apply(load, f.backup, args); };
		const session = f.open(); let consumers = 0, closing: Promise<void> | undefined, work: Promise<unknown> | undefined;
		try {
			work = owner === 'single' ? session.imageHandoff.withCapture(f.imageRequest, () => { consumers++; }, { signal: stop.signal })
				: session.collectionHandoff.withCapture(f.collectionRequest, () => { consumers++; }, { signal: stop.signal });
			const outcome = work.then(() => ({ ok: true, reason: undefined as unknown }), (failure: unknown) => ({ ok: false, reason: failure }));
			await Promise.race([entered.promise, work.then(() => assert.fail('Original hold was not entered'))]);
			stop.abort(reason); closing = session.close(); assert.equal(session.close(), closing);
			await settle(3); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.closed, 0);
			release.resolve(); const result = await outcome; assert.equal(result.ok, false); assert.equal(Object.is(result.reason, reason), true);
			await closing; assert.equal(f.calls.closed, 1); assert.equal(consumers, 0);
		} finally { release.resolve(); await work?.catch(() => undefined); await (closing ?? session.close()); }
	}
});
