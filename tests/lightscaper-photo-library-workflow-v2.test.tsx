/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { applyPhotoDevelopPresetV2 } from '../src/lightscaper/storage/photo-develop-presets-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
async function fixture() {
	const native = mediaRestoreFixture(), expected = lutArchiveFixture();
	const options = { name: 'Current', indexedDB: native.factory, locks: new MemoryLockManager() as unknown as LockManager };
	const archive = await exportPhotoCatalogArchiveV5(expected.root, [expected.record], [], null, [], expected.row,
		{ async withBytes(_reference, consume) { return consume(LUT_BODY); } }); assert.ok(archive.blob);
	const restore = createPhotoLibraryRestoreRuntimeV2(options);
	try { await restore.restoreArchive(archive.blob); } finally { await restore.close(); }
	return { options, expected, open: () => createPhotoLibrarySessionV3(options) };
}
async function mount(factory: CreatePhotoLibrarySessionV3, proxyFactory: CreatePhotoLibraryDevelopProxyRuntimeV2, strict = false) {
	const dom = installReactTestDom(), previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	const view: { current: ReturnType<typeof usePhotoLibraryWorkflowV2> | null } = { current: null };
	function Harness({ create, renderer }: { create: CreatePhotoLibrarySessionV3; renderer: CreatePhotoLibraryDevelopProxyRuntimeV2 }) {
		view.current = usePhotoLibraryWorkflowV2(create, undefined, renderer); return null;
	}
	async function render(create: CreatePhotoLibrarySessionV3, renderer = proxyFactory) {
		await act(async () => { const element = <Harness create={create} renderer={renderer} />; root.render(strict ? <StrictMode>{element}</StrictMode> : element); await settle(); });
	}
	await render(factory);
	return { get current() { assert.ok(view.current); return view.current; }, render,
		async dispose() { await act(async () => { root.unmount(); await settle(); }); dom.restore();
			if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); } };
}

test('mounted current hook stays inert in StrictMode then exposes actual mixed Develop and current preset envelopes', async () => {
	const f = await fixture(); let opens = 0, renderers = 0;
	const mounted = await mount(async () => { opens++; return f.open(); }, async source => { renderers++; return createPhotoDevelopRenderRuntimeV2({ source }); }, true);
	try {
		assert.equal(opens, 0); assert.equal(renderers, 0);
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(mounted.current.page?.rows[0]?.id, f.expected.record.photo.id); assert.equal(opens, 1);
		await act(async () => { await mounted.current.executeDevelop(async context => {
			const port = await context.acquire(); assert.equal(port.schemaVersion, 2);
			const document = await port.read({ schemaVersion: 2, photoId: f.expected.record.photo.id }, { signal: context.signal });
			assert.equal(document.develop.processVersion, 2); assert.deepEqual(document.develop.effects, f.expected.record.photo.versions[0]!.develop.effects);
		}); });
		const presets = await mounted.current.readImportDevelopPresets(); assert.equal(presets.schemaVersion, 2); assert.equal(presets.revision, 29);
		assert.equal(renderers, 0);
	} finally { await mounted.dispose(); }
});

test('mounted current hook imports through its selected resource writer and supplies the same exact bytes to the lazy renderer', async () => {
	const f = await fixture(); let bodies = 0, renderers = 0;
	const mounted = await mount(f.open, async source => {
		renderers++; await source.withBytes(LUT_REFERENCE, bytes => { bodies++; assert.deepEqual(bytes, LUT_BODY); });
		return createPhotoDevelopRenderRuntimeV2({ source });
	});
	try {
		await act(async () => { const receipt = await mounted.current.importCubeLut(new File([LUT_BODY], 'Profile.cube'));
			assert.deepEqual(receipt.reference, LUT_REFERENCE); assert.equal(receipt.created, false); });
		const renderer = await mounted.current.loadDevelopProxyRuntime();
		assert.equal(await mounted.current.loadDevelopProxyRuntime(), renderer); assert.equal(renderers, 1); assert.equal(bodies, 1);
	} finally { await mounted.dispose(); }
});

test('changing the renderer factory retires the selected Session and joins held old work before a replacement opens', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let opens = 0;
	const factory = async () => { opens++; return f.open(); };
	const mounted = await mount(factory, async source => { entered.resolve(); await release.promise; return createPhotoDevelopRenderRuntimeV2({ source }); });
	const loading = mounted.current.loadDevelopProxyRuntime(), rejected = assert.rejects(loading, { name: 'AbortError' });
	let closing: Promise<void> | undefined, replacement: Promise<void> | undefined;
	try {
		await entered.promise; closing = mounted.current.retireAndJoin();
		await remainsPending(closing);
		await mounted.render(factory, async source => createPhotoDevelopRenderRuntimeV2({ source }));
		await act(async () => { replacement = mounted.current.readPage(); await settle(); }); assert.equal(opens, 1);
		release.resolve(); await act(async () => { await closing; await rejected; await replacement; }); assert.equal(opens, 2);
		assert.equal(mounted.current.page?.totalCount, 1);
	} finally { release.resolve(); await rejected; await closing; await replacement; await mounted.dispose(); }
});

test('mounted current import preserves detached native publication after refresh failure and a retired import callback', async () => {
	const native = mediaRestoreFixture(), media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources(), input = photoArchiveFixture(), preset = lutArchiveFixture().row.presets[0]!;
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: input.photo.catalogId,
		name: 'Current import', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const root = await catalog.loadCatalog(input.photo.catalogId); assert.ok(root);
	const locks = new MemoryLockManager() as unknown as LockManager;
	await resources.put(LUT_REFERENCE, LUT_BODY);
	const saved = await applyPhotoDevelopPresetV2(media.settingsRepository, root, { type: 'save', expectedRevision: 0, preset },
		{ verifyResources: (value, signal) => resources.verifyPreset(value, signal) });
	let preparations = 0;
	const owner = new PhotoLibrarySessionV2({ catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, settings: media.settingsRepository, developPresetSettings: media.settingsRepository,
		cubeLutResources: async () => resources, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal),
		exclusive: (id, run, signal) => locks.request(`lightscaper-photo-catalog:${id}`, { mode: 'exclusive' }, async () => { signal?.throwIfAborted(); return run(signal); }),
		initialize: async () => { const next = await catalog.loadCatalog(root.id); assert.ok(next); return next; },
		prepare: async function* () { preparations++; yield { ...input, outcome: 'prepared' as const, index: 0, fileName: input.photo.original.name, keywordNames: [], notices: [] }; },
		closeResources: async () => { await catalog.close(); await media.close(); } });
	owner.readPage = async () => { throw new Error('Refresh failed after durable import'); };
	const entered = deferred<void>(), release = deferred<void>();
	const oldNative = mediaRestoreFixture(), renderer: CreatePhotoLibraryDevelopProxyRuntimeV2 = async source => createPhotoDevelopRenderRuntimeV2({ source });
	const mounted = await mount(() => createPhotoLibrarySessionV3({ name: 'Old', indexedDB: oldNative.factory, locks }), renderer);
	const retiredImport = mounted.current.importFiles;
	const retiredRenameSelection = mounted.current.readBatchRenameSelection;
	await mounted.render(async () => { entered.resolve(); await release.promise; return owner; }, renderer);
	const options = { developPreset: { schemaVersion: 2 as const, catalogId: root.id, presetId: preset.identity.id, expectedRevision: saved.revision },
		settings: { rename: null, metadata: { title: 'First title' }, keywordIds: [] as string[] } };
	let importing: Promise<Awaited<ReturnType<typeof mounted.current.importFiles>>> | undefined;
	try {
		await act(async () => { importing = mounted.current.importFiles([new File([new Uint8Array([1, 2, 3])], input.photo.original.name)], options); await entered.promise; });
		options.developPreset.expectedRevision = 99; options.settings.metadata.title = 'Late title';
		const observed: { receipt?: Awaited<ReturnType<typeof mounted.current.importFiles>> } = {};
		await act(async () => { release.resolve(); observed.receipt = await importing; }); const receipt = observed.receipt; assert.ok(receipt);
		assert.equal(receipt.outcome, 'acknowledged', mounted.current.error ?? 'No diagnostic'); if (receipt.outcome !== 'acknowledged') assert.fail('Expected native publication');
		assert.equal(receipt.completion, 'finished'); assert.equal(receipt.notice, 'refresh-failed'); assert.equal(receipt.items[0]?.photoId, input.photo.id);
		const photo = await catalog.loadPhoto(root.id, input.photo.id); assert.ok(photo);
		assert.equal(photo.schemaVersion, 2); assert.equal(photo.metadata.title, 'First title');
		assert.deepEqual(photo.versions[0]?.develop.effects, preset.settings.develop.effects);
		await media.verifyOriginal(photo.original); assert.equal(mounted.current.importReceipt?.outcome, 'acknowledged');
		const rememberedReceipt = mounted.current.importReceipt, rememberedItems = mounted.current.receipts;
		await act(async () => { assert.equal((await retiredImport([new File(['late'], input.photo.original.name)])).outcome, 'cancelled'); });
		assert.equal(mounted.current.importReceipt, rememberedReceipt, 'Retired callbacks cannot clear the replacement receipt');
		assert.equal(mounted.current.receipts, rememberedItems); assert.equal(preparations, 1);
		await act(async () => { await mounted.current.readBatchRenameSelection([input.photo.id]); });
		const selection = mounted.current.batchRenameSnapshot; assert.ok(selection);
		await act(async () => { await retiredRenameSelection([input.photo.id]); });
		assert.equal(mounted.current.batchRenameSnapshot, selection, 'Retired callbacks cannot clear replacement rename selection');
	} finally { release.resolve(); await importing; await mounted.dispose(); }
});
