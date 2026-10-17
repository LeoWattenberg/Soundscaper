/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { usePhotoLibraryWorkflowCollectionHandoff } from '../src/common/editor/ui/lightscaper/photo-library-workflow-collection-handoff.ts';
import { retirePhotoLibraryWorkflowSlotV2, type PhotoLibraryWorkflowSlotV2 } from '../src/common/editor/controller/shared/photo-library-workflow-slot-v2.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryCollectionHandoffPortV1 } from '../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const signal = () => new AbortController().signal;
async function fixture(pageGate?: Readonly<{ enter: () => void; wait: Promise<void> }>) {
	const native = mediaRestoreFixture(), seed = lutArchiveFixture(), name = `lightscaper-collection-workflow-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, caller) => resources.verifyPhoto(photo, caller) });
	const root = normalizePhotoCatalogRootV1({ ...seed.root, revision: 0, photoCount: 0, collections: [
		{ id: 'manual', name: 'Manual choice', kind: 'manual' }, { id: 'smart', name: 'Smart choice', kind: 'smart', query: { kind: 'rating', minimum: 4, maximum: 5 } },
	] });
	await catalog.createCatalog(root); await media.mediaRepository.writeAsset(seed.record.photo.original.storageKey, seed.record.original);
	await resources.put(LUT_REFERENCE, LUT_BODY);
	const photos = [0, 1, 2].map(index => normalizePhotoDocumentV2({ ...seed.record.photo, id: `photo-${index}`, collectionIds: index < 2 ? ['manual'] : [], rating: index > 0 ? 4 : 0,
		metadata: { ...seed.record.photo.metadata, title: index > 0 ? 'Selected' : 'Other', fileName: `Photo ${index}.png` } }));
	await catalog.publishPhotos(root.id, 0, photos);
	await media.mediaRepository.catalogOriginals.retain(root.id, photos.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
		sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
	while (!(await catalog.rebuildQueryIndexPageV2(root.id)).ready) { /* Actual bounded query index. */ }
	const context = (await catalog.readSmartCollectionSnapshotV1(root.id, null)).context;
	await catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'saved', revision: 0, name: 'Saved choice',
		query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', predicate: { kind: 'text', column: 'title', operator: 'equals', value: 'Selected' },
			sort: { field: 'photo-id', direction: 'descending' } }) }, null,
	{ expectedCatalogRevision: context.catalogRevision, expectedIndexRevision: context.indexRevision, expectedStateRevision: context.collectionStateRevision });
	if (pageGate) {
		const method = catalog.readSmartCollectionPage;
		Object.defineProperty(catalog, 'readSmartCollectionPage', { configurable: true,
			value: async (...args: Parameters<typeof method>) => { pageGate.enter(); await pageGate.wait; return Reflect.apply(method, catalog, args); } });
	}
	let originalFault = false, lutFault = false, calls = 0, closed = 0;
	const owner = new PhotoLibrarySessionV2({ catalog, smartCollections: catalog,
		backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			async loadOriginal(original, caller) { return originalFault ? new Blob([new Uint8Array([3, 2, 1])]) : media.mediaRepository.loadAsset(original.storageKey, { signal: caller, expectedSize: original.byteLength }); } },
		media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository,
		cubeLutResources: async () => ({ ...resources, source: { withBytes: (reference, consume, options) => resources.source.withBytes(reference, bytes => {
			const delivered = lutFault ? bytes.slice() : bytes; if (lutFault) delivered[0] ^= 1; return consume(delivered);
		}, options) } }), initialize: async () => (await catalog.loadCatalog(root.id))!, exclusive: async (_id, run, caller) => run(caller),
		async closeResources() { closed++; await Promise.all([catalog.close(), media.close()]); } });
	const factory: CreatePhotoLibrarySessionV3 = () => { calls++; return Promise.resolve(owner); };
	const slot: PhotoLibraryWorkflowSlotV2 = { live: true, factory, backupLoader: undefined, proxyFactory: undefined, lifetime: new AbortController(), beforeDrain: null,
		pending: null, active: null, proxyPending: null, closeOwner: null, query: null, savedCollectionId: null, stackCollapsed: false, page: null,
		batchRenamePlanner: null, backupRuntime: null, backupLoading: null, retirement: null };
	const slotRef = { current: slot as PhotoLibraryWorkflowSlotV2 | null }, factoryRef = { current: factory as CreatePhotoLibrarySessionV3 | undefined };
	let current: ReturnType<typeof usePhotoLibraryWorkflowCollectionHandoff> | undefined;
	function Harness() { current = usePhotoLibraryWorkflowCollectionHandoff({ slot: slotRef, factory: factoryRef, loader: { current: undefined }, renderer: { current: undefined },
		createSession: factory, loadBackupSaveRuntime: undefined, createDevelopProxyRuntime: undefined }); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	const read = () => { assert.ok(current); return current; };
	return { ...mounted, read, owner, catalog, resources, native, photos, slot, slotRef, root, calls: () => calls, closed: () => closed,
		corruptOriginal() { originalFault = true; },
		corruptLut() { lutFault = true; },
		change(photo: unknown, photoId: string) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|${photoId}`, document: photo }); },
		async close() { await mounted.dispose(); await retirePhotoLibraryWorkflowSlotV2(slot, () => Promise.resolve()); await owner.close(); } };
}

test('Light collection workflow exposes paged scalar catalog and saved choices without selected photos', async () => {
	const f = await fixture();
	try {
		const captured = f.read().captureCollectionHandoff(); assert.ok(Object.isFrozen(captured)); assert.equal(f.calls(), 0);
		const page = await captured.readCatalogPage({ selectedId: 'manual' });
		assert.deepEqual(page.rows.map(row => [row.id, row.kind === 'collection' ? row.collectionKind : null]), [['manual', 'manual'], ['smart', 'smart']]);
		assert.equal(page.selected?.id, 'manual'); assert.equal(page.cursor, null);
		const saved = await captured.readSavedPage(); assert.deepEqual(saved.items.map(row => [row.id, row.name]), [['saved', 'Saved choice']]); assert.equal(f.calls(), 1);
	} finally { await f.close(); }
});
test('Light explicit collection scope refuses the wrong namespace and preserves actual native query order', async () => {
	const f = await fixture();
	try {
		const captured = f.read().captureCollectionHandoff();
		for (const [scope, collectionId, fileName, ids] of [
			['catalog', 'manual', 'Manual choice.fscape', ['photo-0', 'photo-1']], ['catalog', 'smart', 'Smart choice.fscape', ['photo-1', 'photo-2']],
			['saved-query', 'saved', 'Saved choice.fscape', ['photo-2', 'photo-1']],
		] as const) {
			const prepared = await captured.prepare({ scope, collectionId }, signal());
			assert.equal(prepared.fileName, fileName); assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.target.binding));
			assert.equal(Object.hasOwn(prepared.target.binding, 'expectedDefinitionRevision'), scope === 'saved-query');
			assert.deepEqual(await prepared.target.capture.withCapture(prepared.target.binding, async view => {
				for (const photo of view.photos) await view.withOriginal(photo.binding.photoId, async blob => assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]));
				await view.withLutBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY)); return view.photos.map(photo => photo.binding.photoId);
			}), ids);
			await prepared.target.checkCurrent(signal());
		}
		await assert.rejects(captured.prepare({ scope: 'saved-query', collectionId: 'manual' }, signal()));
		await assert.rejects(captured.prepare({ scope: 'catalog', collectionId: 'saved' }, signal()));
	} finally { await f.close(); }
});
test('Light closed selection and paging admission never invokes getters or acquires a catalog', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const captured = f.read().captureCollectionHandoff();
		for (const selection of [{ scope: 'catalog', get collectionId() { getters++; return 'manual'; } }, { scope: 'catalog', collectionId: 'manual', extra: true },
			Object.create({ scope: 'catalog', collectionId: 'manual' }) as unknown, { scope: 'bad', collectionId: 'manual' }]) {
			await assert.rejects(captured.prepare(selection as Parameters<typeof captured.prepare>[0], signal()));
		}
		await assert.rejects(captured.readCatalogPage({ get cursor() { getters++; return null; } }));
		await assert.rejects(captured.readSavedPage({ signal: {} as AbortSignal }));
		const cause = Symbol('preabort'); await assert.rejects(captured.prepare({ scope: 'catalog', collectionId: 'manual' }, AbortSignal.abort(cause)), value => value === cause);
		assert.equal(getters, 0); assert.equal(f.calls(), 0);
	} finally { await f.close(); }
});
test('Light captured menu cannot borrow a replacement same-factory slot', async () => {
	const f = await fixture();
	try {
		const captured = f.read().captureCollectionHandoff(); f.slotRef.current = { ...f.slot, pending: null, lifetime: new AbortController() };
		await assert.rejects(captured.readCatalogPage(), { name: 'AbortError' });
		await assert.rejects(captured.prepare({ scope: 'catalog', collectionId: 'manual' }, signal()), { name: 'AbortError' }); assert.equal(f.calls(), 0);
	} finally { await f.close(); }
});
test('Light final currentness detects same-revision saved recipe changes after archive capture', async () => {
	const f = await fixture();
	try {
		const prepared = await f.read().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		await prepared.target.capture.withCapture(prepared.target.binding, () => 'archive');
		const photo = f.photos[0]!, version = photo.versions[0]!;
		f.change(normalizePhotoDocumentV2({ ...photo, versions: [{ ...version, develop: { ...version.develop,
			effects: version.develop.effects.map(effect => ({ ...effect, enabled: !effect.enabled })) } }] }), photo.id);
		await assert.rejects(prepared.target.checkCurrent(signal()), /changed/iu);
	} finally { await f.close(); }
});
test('Light final currentness reauthenticates original bodies even when saved scalar facts are unchanged', async () => {
	const f = await fixture();
	try {
		const prepared = await f.read().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		await prepared.target.capture.withCapture(prepared.target.binding, () => 'archive'); f.corruptOriginal();
		await assert.rejects(prepared.target.checkCurrent(signal()));
	} finally { await f.close(); }
});
test('Light final currentness reauthenticates disabled LUT bodies after archive capture', async () => {
	const f = await fixture();
	try {
		const prepared = await f.read().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		await prepared.target.capture.withCapture(prepared.target.binding, () => 'archive'); f.corruptLut();
		await assert.rejects(prepared.target.checkCurrent(signal()));
	} finally { await f.close(); }
});
test('Light final witness includes the real index revision while the catalog root stays unchanged', async () => {
	const f = await fixture();
	try {
		const captured = f.read().captureCollectionHandoff(), prepared = await captured.prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		const before = await prepared.target.capture.withCapture(prepared.target.binding, view => view.collection);
		const photo = f.photos[0]!; await f.catalog.savePhoto(normalizePhotoDocumentV2({ ...photo, rating: 3 }), photo.revision);
		assert.equal((await f.catalog.loadCatalog(f.root.id))!.revision, before.catalogRevision);
		const next = await captured.prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		const after = await next.target.capture.withCapture(next.target.binding, view => view.collection);
		assert.equal(after.catalogRevision, before.catalogRevision); assert.equal(after.indexRevision, before.indexRevision + 1);
		await assert.rejects(prepared.target.checkCurrent(signal()), /changed/iu);
	} finally { await f.close(); }
});
test('Light captured native methods keep their receivers and refuse acquired accessor ports without invoking them', async () => {
	for (const key of ['savedCollections', 'collectionHandoff']) {
		const f = await fixture(); let getters = 0;
		try {
			Object.defineProperty(f.owner, key, { configurable: true, get() { getters++; throw new Error('Getter must not run'); } });
			await assert.rejects(f.read().captureCollectionHandoff().readCatalogPage()); assert.equal(getters, 0);
		} finally { await f.close(); }
	}
});
test('Light collection capture and selected-generation retirement join a held genuine consumer', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		const target = (await f.read().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: 'manual' }, signal())).target;
		const work = target.capture.withCapture(target.binding, async () => { entered.resolve(); await release.promise; });
		const refused = assert.rejects(work); await entered.promise;
		const closing = retirePhotoLibraryWorkflowSlotV2(f.slot, () => work.catch(() => undefined));
		assert.equal(await remainsPending(closing), true); assert.equal(f.closed(), 0);
		release.resolve(); await refused; await closing; assert.equal(f.closed(), 1);
	} finally { release.resolve(); await f.close(); }
});
test('Light selected-generation retirement joins a held real saved-collection page read', async () => {
	const entered = deferred<void>(), release = deferred<void>(), f = await fixture({ enter: () => entered.resolve(), wait: release.promise });
	try {
		const work = f.read().captureCollectionHandoff().readSavedPage(), refused = assert.rejects(work);
		await entered.promise; const closing = retirePhotoLibraryWorkflowSlotV2(f.slot, () => work.then(() => undefined, () => undefined));
		assert.equal(await remainsPending(closing), true); assert.equal(f.closed(), 0);
		release.resolve(); await refused; await closing; assert.equal(f.closed(), 1);
	} finally { release.resolve(); await f.close(); }
});
test('Light pinned acquired methods survive later capability replacement with their actual receivers', async () => {
	const f = await fixture(); let replacements = 0;
	try {
		const captured = f.read().captureCollectionHandoff(); await captured.readCatalogPage();
		for (const key of ['savedCollections', 'collectionHandoff', 'readDefinitionPage', 'readDefinition']) {
			Object.defineProperty(f.owner, key, { configurable: true, value: () => { replacements++; throw new Error('Replaced capability must not run'); } });
		}
		assert.deepEqual((await captured.readSavedPage()).items.map(row => row.id), ['saved']);
		const prepared = await captured.prepare({ scope: 'catalog', collectionId: 'manual' }, signal());
		assert.equal(await prepared.target.capture.withCapture(prepared.target.binding, () => 'native receiver'), 'native receiver');
		await prepared.target.checkCurrent(signal()); assert.equal(replacements, 0);
	} finally { await f.close(); }
});
test('Light capture wrapper joins ignored consumer work and preserves distinct opaque transport failures', async () => {
	for (const fail of [false, true]) {
		const f = await fixture(), release = deferred<void>(), transported = deferred<void>(), primary = Symbol('transport');
		try {
			const port = f.owner.collectionHandoff, method = port.withCapture;
			const borrowed: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(request, consume, options) {
				await Reflect.apply(method, port, [request, (view: Parameters<Parameters<typeof method>[1]>[0]) => {
					void Promise.resolve(consume(view)).catch(() => undefined); return undefined;
				}, options]); transported.resolve(); if (fail) throw primary; return undefined as never;
			} };
			Object.defineProperty(f.owner, 'collectionHandoff', { configurable: true, value: borrowed });
			const target = (await f.read().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: 'manual' }, signal())).target;
			const work = target.capture.withCapture(target.binding, async () => { await release.promise; if (fail) throw undefined; return 'joined result'; });
			const outcome = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason: reason as unknown }));
			await transported.promise; assert.equal(await remainsPending(outcome), true); release.resolve();
			if (fail) {
				const result = await outcome; assert.equal(result.ok, false);
				assert.ok('reason' in result && result.reason instanceof AggregateError);
				assert.equal(result.reason.cause, primary); assert.deepEqual(result.reason.errors, [primary, undefined]);
			} else assert.deepEqual(await outcome, { ok: true, value: 'joined result' });
		} finally { release.resolve(); await f.close(); }
	}
});
