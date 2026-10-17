/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperAppV2, { type LightscaperAppPropsV2 } from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import PhotoRasterBatchExportDialog, { type PhotoRasterBatchExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoRasterBatchExportDialog.tsx';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { openPhotoLibraryExportJournalSession } from '../src/lightscaper/controller/photo-library-export-journal-session.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createPhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import { normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile } from '../src/common/editor/browser-file-save-service.ts';
import { photoBatchExportCopy } from '../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { formatImageExportFilenameV1 } from '../src/common/editor/image-export-filename-v1.ts';
import type { PhotoRasterExportOutput } from '../src/lightscaper/controller/photo-raster-export.ts';

const previousRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previousRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const selection = Object.freeze([{ photoId: 'two', fileName: 'Second.png' }, { photoId: 'one', fileName: 'First.png' }]);

for (const locale of ['en', 'de']) test(`${locale}: the real current application exposes both opt-in File entries and retains the same hidden queue`, async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	let loaders = 0;
	const props: LightscaperAppPropsV2 = { locale, createSession: seeded.createSession,
		loadDevelopProxyRuntime: async source => createPhotoDevelopRenderRuntimeV2({ source }), loadBackupSaveRuntime: async () => { loaders++; return {
			maximumStreamingBytes: 536870912, ...createBrowserFileSaveService({ document: null }) }; } };
	const m = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true }); return <StrictMode><LightscaperAppV2 {...props} /></StrictMode>; });
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	const click = async (selector: string) => { const element = m.dom.one(selector); await flush(() => { reactProps(element).onClick?.({ currentTarget: element }); }); };
	try {
		const entry = m.dom.one('[data-photo-batch-export-menu]'), queue = m.dom.one('[data-photo-queue-export-menu]');
		assert.equal(entry.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(reactProps(entry).disabled, true); assert.equal(reactProps(queue).disabled, false); assert.equal(loaders, 0); assert.equal(m.dom.find('[data-photo-batch-export-dialog]'), null);
		await click('[data-photo-queue-export-menu]');
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-dialog]')?.textContent.includes(photoBatchExportCopy(locale).empty) === true; }, 'empty durable queue', { delayMs: 10 });
		await click('[data-photo-batch-export-hide]');
		const show = m.dom.container.querySelectorAll('button').find(button => button.textContent === (locale === 'de' ? 'Fotobibliothek anzeigen' : 'Show photo library'))!;
		await flush(() => { reactProps(show).onClick?.({ currentTarget: show }); });
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-id]') !== null; }, 'current selected page');
		const card = m.dom.one('[data-photo-id]'); await flush(() => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		await click('[data-photo-batch-export-menu]');
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'batch current-version readiness');
		const start = m.dom.one('[data-photo-batch-export-start]'); assert.equal(loaders, 1);
		await click('[data-photo-batch-export-hide]'); assert.equal(m.dom.find('[data-photo-batch-export-dialog]'), null); assert.equal(reactProps(queue).disabled, false);
		await click('[data-photo-queue-export-menu]'); assert.equal(reactProps(m.dom.one('[data-photo-batch-export-start]')).disabled, false);
		assert.equal(loaders, 1); assert.notEqual(m.dom.one('[data-photo-batch-export-start]'), start);
	} finally { await m.dispose(); await settle(); }
});

function fixture() {
	const events: string[] = [], blobs: Blob[] = [], held = deferred<void>(), deleteEntered = deferred<void>(); let hold = false, holdDelete = false, retired: (() => Promise<void>) | null = null;
	const base = photoArchiveFixture(), photos = new Map(selection.map(member => [member.photoId, normalizePhotoDocumentV2({ ...base.photo, schemaVersion: 2, id: member.photoId,
		catalogId: 'catalog', revision: 3, activeVersionId: 'master', metadata: { ...base.photo.metadata, fileName: member.fileName },
		versions: [{ ...base.photo.versions[0]!, id: 'master', develop: defaultImageDevelopStateV2() }] })]));
	const port = { memory: getMemoryDatabase(`batch-app-${crypto.randomUUID()}`), database: async () => null }, repository = new KeyValueRepository(port, 'settings');
	const lifetime = new PhotoLibrarySessionLifetime(), resources = createPhotoMediaCubeLutResourcesV1(port, action => action(), () => lifetime.assertAccepting());
	const host = { ready: async () => 'catalog', settings: { get: repository.get.bind(repository), putIfAbsent: repository.putIfAbsent.bind(repository), replaceIfCurrent: repository.replaceIfCurrent.bind(repository),
		async deleteIfCurrent(key: string, expected: unknown) { events.push('delete-queue'); if (holdDelete) { deleteEntered.resolve(); await held.promise; } return repository.deleteIfCurrent(key, expected); } },
		catalog: { loadPhoto: async (_catalog: string, id: string) => photos.get(id) ?? null }, loadOriginal: async () => base.original,
		verifyResources: resources.resources.verifyPhoto, operation: lifetime.operation.bind(lifetime) };
	const service = createBrowserFileSaveService({ document: { createElement: () => ({ href: '', download: '', hidden: false, click() { events.push(`click:${this.download}`); } }) },
		urlApi: { createObjectURL(blob) { blobs.push(blob); return 'blob:export'; }, revokeObjectURL() {} }, setTimeout: callback => { callback(); return 1; } });
	const runtime = { maximumStreamingBytes: 536870912, prepareSave(request: BrowserFileSaveRequest) { assert.equal(request.target?.browserDownload, true); assert.equal(request.useFileSystemAccess, false); events.push(`prepare:${String(request.fileName)}`); return service.prepareSave(request); },
		async saveFile(request: BrowserFileSaveRequest): Promise<BrowserSavedFile> { events.push('saving'); if (hold) await held.promise; return service.saveFile(request); } };
	const props: PhotoRasterBatchExportDialogProps = { locale: 'en', batchId: 'app-batch', selection, visible: true, preparationFailed: false,
		onHide() {}, onSettled() { events.push('settled'); },
		execute: async (action, signal) => { const current = signal ?? new AbortController().signal; await action({ signal: current, isCurrent: () => true,
			refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2, read: async request => ({ schemaVersion: 2, catalogId: 'catalog', photoId: request.photoId,
				revision: 3, activeVersionId: 'master', versionId: 'master', versions: [], develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }),
				apply: async () => assert.fail('Export must not change a photo') }) }); return 'completed'; },
		withOriginalFrame: async (request, consume) => { events.push(`original:${request.photoId}`); return consume({ photoId: request.photoId, revision: 3,
			frame: { descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([64, 128, 192, 255, 64, 128, 192, 255, 64, 128, 192, 255, 64, 128, 192, 255]) } }); },
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		captureJournal: () => options => openPhotoLibraryExportJournalSession(host, options),
		captureSidecarReader: () => async request => serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photos.get(request.photoId), request)),
		saveRuntime: runtime,
		registerDestination(join) { retired = join; return () => { void join().catch(() => undefined); }; },
	};
	return { props, runtime, events, blobs, held, deleteEntered, photos, repository, hold: () => { hold = true; }, holdDeletion: () => { holdDelete = true; }, retire: () => retired!(), close: () => lifetime.close(() => resources.close()) };
}

async function retainRecipe(f: ReturnType<typeof fixture>, output: Readonly<PhotoRasterExportOutput> | undefined, completed = false) {
	const access = await f.props.captureJournal()(), key = `photo-library:raster-export-journal:v1:${access.catalogId}`, raw = await access.settings.get(key);
	const before = normalizePhotoRasterExportJournalV1(raw), filenameTemplate = 'retained-{index:3}-{name}', format = completed ? 'png' : 'jpeg';
	// Condition the actual settings row, without claiming a physical crash or
	// a new download ACK. The already recorded delivery names follow its plan.
	const next = normalizePhotoRasterExportJournalV1({ schemaVersion: 1, kind: before.kind, catalogId: before.catalogId,
		revision: before.revision + 1, batchId: before.batchId, format, filenameTemplate, ...(output ? { output } : {}),
		members: before.members.map(member => {
			const fileName = formatImageExportFilenameV1({ template: filenameTemplate, sourceFileName: member.sourceFileName, format, index: member.index });
			return { ...member, fileName, state: completed ? 'committed' : 'pending', delivery: completed ? { ...member.delivery!, fileName } : null };
		}) });
	assert.equal(await access.settings.replaceIfCurrent(key, raw, next), true);
}

const retainedSizing = [
	{ sizing: { kind: 'original' }, fields: [] },
	{ sizing: { kind: 'fit', width: 123, height: 456, allowUpscale: true }, fields: [['width', '123'], ['height', '456']] },
	{ sizing: { kind: 'long-edge', pixels: 789, allowUpscale: true }, fields: [['long-edge', '789']] },
	{ sizing: { kind: 'megapixels', megapixels: 2.5, allowUpscale: true }, fields: [['megapixels', '2.5']] },
	{ sizing: { kind: 'percentage', percentage: 50 }, fields: [['percentage', '50']] },
] as const;
for (const recipe of [...retainedSizing, undefined]) test(`${recipe?.sizing.kind ?? 'absent output'}: reopened journal displays its retained recipe before recovery is ready`, async () => {
	const f = fixture(); let m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'committed'); await m.dispose(); await settle();
		await retainRecipe(f, recipe ? { sizing: recipe.sizing, quality: 'nearest', metadataScope: 'capture', sharpen: { amount: 37, threshold: 9 } } : undefined);
		m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} selection={[]} batchId="reopened-settings" />);
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'recovery ready');
		const value = (key: string) => reactProps(m.dom.one(`[data-photo-raster-export-${key}]`)).value;
		assert.equal(value('sizing'), recipe?.sizing.kind ?? 'original');
		for (const [key, expected] of recipe?.fields ?? []) assert.equal(value(key), expected);
		if (recipe && 'allowUpscale' in recipe.sizing) assert.equal(reactProps(m.dom.one('[data-photo-raster-export-upscale]')).checked, true);
		assert.equal(value('filename-template'), 'retained-{index:3}-{name}');
		assert.equal(value('metadata'), recipe ? 'capture' : 'strip');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sharpen]')).checked, !!recipe);
		if (recipe) { assert.equal(value('sharpen-amount'), '37'); assert.equal(value('sharpen-threshold'), '9'); }
		if (recipe && recipe.sizing.kind !== 'original') assert.equal(value('resample'), 'nearest');
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-format]')).value, 'jpeg');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sizing]')).disabled, true);
		assert.equal(f.blobs.length, 2);
	} finally { await m.dispose(); await settle(); await f.close(); }
});

test('completed replacement begins with the retained settings and stays editable', async () => {
	const f = fixture(); let m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'committed'); await m.dispose(); await settle();
		await retainRecipe(f, { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', metadataScope: 'capture', sharpen: { amount: 37, threshold: 9 } }, true);
		m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} batchId="replace-retained" />);
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-replace]')?.disabled === false; }, 'replace ready');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-percentage]')).value, '50');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-percentage]')).disabled, false);
		await flush(() => {
			reactProps(m.dom.one('[data-photo-raster-export-percentage]')).onChange?.({ target: { value: '75' } });
		});
		await flush(() => { reactProps(m.dom.one('[data-photo-raster-export-metadata]')).onChange?.({ target: { value: 'strip' } }); });
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-replace]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.blobs.length === 4; }, 'replacement downloads');
		const access = await f.props.captureJournal()(), current = normalizePhotoRasterExportJournalV1(await access.settings.get(`photo-library:raster-export-journal:v1:${access.catalogId}`));
		assert.deepEqual(current.output, { sizing: { kind: 'percentage', percentage: 75 }, quality: 'nearest', metadataScope: 'strip', sharpen: { amount: 37, threshold: 9 } });
		assert.equal(current.filenameTemplate, 'retained-{index:3}-{name}');
	} finally { await m.dispose(); await settle(); await f.close(); }
});
for (const format of ['png', 'jpeg'] as const) test(`${format}: real renderer/encoder owner downloads frozen page-order indices and presents Download started`, async t => {
	const f = fixture(); let props = f.props;
	if (format === 'jpeg') {
		// Node observes the native codec boundary; this structural header is not a JPEG pixel golden.
		const prior = ['OffscreenCanvas', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
		class Data { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
		class Canvas {
			constructor(public width: number, public height: number) {}
			getContext() { return { putImageData: (data: Data) => { assert.deepEqual([...data.data], [64, 128, 192, 255, 64, 128, 192, 255, 64, 128, 192, 255, 64, 128, 192, 255]); } }; }
			async convertToBlob(options: ImageEncodeOptions) {
				assert.deepEqual(options, { type: 'image/jpeg', quality: 0.9 });
				return new Blob([Uint8Array.of(255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 7, 255, 217)], { type: 'image/jpeg' });
			}
		}
		Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
		Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: Data });
		t.after(() => { for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
	}
	const m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-format]')).onChange?.({ target: { value: format } }); });
		await flush(() => {
			reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({});
			// Captured in this gesture, before the authority await starts any member.
			f.runtime.prepareSave = () => assert.fail('Late save capability');
			f.runtime.saveFile = async () => assert.fail('Late download capability');
		});
		await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'real encoded downloads');
		assert.deepEqual(f.events.filter(event => event.startsWith('click:')), [`click:01-Second.${format === 'jpeg' ? 'jpg' : 'png'}`, `click:02-First.${format === 'jpeg' ? 'jpg' : 'png'}`]);
		assert.equal(m.dom.one('[data-photo-batch-export-receipt]').getAttribute('data-phase'), 'settled');
		assert.match(m.dom.one('[data-photo-batch-export-receipt]').textContent, /Download started/u); assert.doesNotMatch(m.dom.one('[data-photo-batch-export-receipt]').textContent, /saved/iu);
		const bytes = [...new Uint8Array(await f.blobs[0]!.arrayBuffer())]; assert.deepEqual(bytes.slice(0, format === 'png' ? 8 : 2), format === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216]);
		props = { ...props, visible: false }; await m.render(); assert.equal(m.dom.find('[data-photo-batch-export-dialog]'), null);
		props = { ...props, visible: true }; await m.render(); assert.equal(m.dom.one('[data-photo-batch-export-receipt]').getAttribute('data-phase'), 'settled'); assert.equal(f.blobs.length, 2);
	} finally { await m.dispose(); await settle(); await f.close(); }
});

test('hidden queue remains active; catalog retirement joins a held irreversible download without starting its neighbor', async () => {
	const f = fixture(); f.hold(); let props = f.props;
	const m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.events.includes('saving'); }, 'held download');
		props = { ...props, visible: false }; await m.render(); assert.equal(f.events.includes('settled'), false);
		let joined!: Promise<void>; await flush(() => { joined = f.retire(); }); await remainsPending(joined); assert.equal(f.events.includes('original:one'), false);
		await flush(() => { f.held.resolve(); }); await joined; await flush();
		props = { ...props, visible: true }; await m.render();
		assert.match(m.dom.one('[data-photo-batch-export-receipt]').textContent, /Download started/u);
		assert.equal(m.dom.one('[data-photo-batch-export-receipt]').querySelectorAll('[data-state="cancelled"]').length, 1);
	} finally { f.held.resolve(); await m.dispose(); await settle(); await f.close(); }
});

for (const state of ['pending', 'started'] as const) test(`${state}: reopened native journal rows stay readonly or require review, then keep the original second filename`, async () => {
	const f = fixture(); let props = f.props, m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	let flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'initial committed queue'); await m.dispose(); await settle();
		// Actual settings CAS conditions an interrupted scalar record. It does
		// not claim to recreate a physical browser crash or download completion.
		const access = await f.props.captureJournal()(), key = `photo-library:raster-export-journal:v1:${access.catalogId}`, raw = await access.settings.get(key);
		const before = normalizePhotoRasterExportJournalV1(raw), next = normalizePhotoRasterExportJournalV1({ ...before, revision: before.revision + 1,
			members: before.members.map((member, index) => index ? { ...member, state, delivery: null } : member) });
		assert.equal(await access.settings.replaceIfCurrent(key, raw, next), true);
		props = { ...props, selection: [], batchId: 'reopened' }; m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
		flush = async (action = () => undefined) => { await act(async () => { action(); await settle(); }); };
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-journal]') !== null; }, 'reopened journal');
		assert.equal(f.blobs.length, 2); assert.equal(m.dom.container.querySelectorAll('[data-journal-state="already-committed"]').length, 1);
		assert.equal(m.dom.container.querySelectorAll('[data-photo-journal-job]').length, 2); assert.equal(m.dom.find('[data-photo-batch-export-replace]'), null);
		if (state === 'started') {
			assert.equal(reactProps(m.dom.one('[data-photo-batch-export-start]')).disabled, true);
			const review = m.dom.one('[data-journal-state="needs-review"]').querySelector('input'); assert.ok(review);
			await flush(() => { reactProps(review).onChange?.({ target: { checked: true } }); });
		}
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'explicit continuation');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-receipt]')?.getAttribute('data-phase') === 'settled'; }, 'one resumed member');
		assert.deepEqual(f.events.filter(event => event.startsWith('click:')), ['click:01-Second.png', 'click:02-First.png', 'click:02-First.png']);
		assert.equal(m.dom.container.querySelectorAll('[data-photo-batch-job]').length, 1);
	} finally { await m.dispose(); await settle(); await f.close(); }
});

test('reopened fully committed history allows only an explicit different replacement queue', async () => {
	const f = fixture(); let props = f.props, m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'ready');
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'committed'); await m.dispose(); await settle();
		props = { ...props, batchId: 'explicit-replacement' }; m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-replace]')?.disabled === false; }, 'replace completed');
		assert.equal(f.blobs.length, 2); assert.equal(reactProps(m.dom.one('[data-photo-batch-export-start]')).disabled, true);
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-replace]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return f.blobs.length === 4 && m.dom.find('[data-photo-batch-export-receipt]')?.getAttribute('data-phase') === 'settled'; }, 'explicit replacement committed');
		const access = await f.props.captureJournal()(), current = normalizePhotoRasterExportJournalV1(await access.settings.get(`photo-library:raster-export-journal:v1:${access.catalogId}`));
		assert.equal(current.batchId, 'explicit-replacement'); assert.equal(current.revision, 10); assert.equal(current.members.every(member => member.state === 'committed'), true);
	} finally { await m.dispose(); await settle(); await f.close(); }
});

async function openUnfinishedQueue(f: ReturnType<typeof fixture>, locale = 'en') {
	let m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} locale={locale} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'initial ready');
	await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick?.({}); });
	await waitFor(async () => { await flush(); return f.events.includes('settled'); }, 'initial downloads'); await m.dispose(); await settle();
	await retainRecipe(f, undefined);
	m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} locale={locale} selection={[]} batchId="forget-review" />);
	await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-journal]') !== null; }, 'unfinished history');
	return m;
}

for (const locale of ['en', 'de']) test(`${locale}: menu dialog forgets only explicitly reviewed unfinished history and leaves its downloads and photos intact`, async () => {
	const f = fixture(), m = await openUnfinishedQueue(f, locale), copy = photoBatchExportCopy(locale), before = JSON.stringify([...f.photos]);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		const button = m.dom.one('[data-photo-batch-export-discard]'); assert.equal(button.textContent, copy.discard); assert.equal(reactProps(button).disabled, true);
		const retained = reactProps(button).onClick!; await flush(() => { retained({}); }); assert.equal(f.events.includes('delete-queue'), false);
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-discard-review]')).onChange?.({ target: { checked: true } }); });
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-discard]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return m.dom.container.textContent.includes(copy.empty); }, 'forgotten empty queue');
		assert.equal(await f.repository.get('photo-library:raster-export-journal:v1:catalog'), undefined);
		assert.equal(f.events.filter(event => event === 'delete-queue').length, 1); assert.equal(f.blobs.length, 2); assert.equal(JSON.stringify([...f.photos]), before);
		assert.equal(m.dom.find('[data-photo-batch-export-discard]'), null);
	} finally { await m.dispose(); await settle(); await f.close(); }
});

test('a competing queue survives reviewed deletion refusal and the dialog reports recovery without starting downloads', async () => {
	const f = fixture(), m = await openUnfinishedQueue(f);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		const key = 'photo-library:raster-export-journal:v1:catalog', raw = await f.repository.get(key), before = normalizePhotoRasterExportJournalV1(raw);
		const next = normalizePhotoRasterExportJournalV1({ ...before, revision: before.revision + 1 }); assert.equal(await f.repository.replaceIfCurrent(key, raw, next), true);
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-discard-review]')).onChange?.({ target: { checked: true } }); });
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-discard]')).onClick?.({}); });
		await waitFor(async () => { await flush(); return m.dom.container.textContent.includes(photoBatchExportCopy('en').discardFailed); }, 'deletion refusal');
		assert.deepEqual(await f.repository.get(key), next); assert.equal(f.blobs.length, 2); assert.ok(m.dom.find('[data-photo-export-journal]'));
	} finally { await m.dispose(); await settle(); await f.close(); }
});

test('held deletion disables retained Start and Forget handlers and joins retirement through native publication', async () => {
	const f = fixture(), m = await openUnfinishedQueue(f);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	try {
		await flush(() => { reactProps(m.dom.one('[data-photo-batch-export-discard-review]')).onChange?.({ target: { checked: true } }); });
		const forget = reactProps(m.dom.one('[data-photo-batch-export-discard]')).onClick!, start = reactProps(m.dom.one('[data-photo-batch-export-start]')).onClick!;
		f.holdDeletion(); await flush(() => { forget({}); }); await f.deleteEntered.promise;
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-start]')).disabled, true);
		await flush(() => { forget({}); start({}); }); assert.equal(f.events.filter(event => event === 'delete-queue').length, 1); assert.equal(f.blobs.length, 2);
		const joined = f.retire(); assert.equal(await remainsPending(joined), true); f.held.resolve(); await joined; await flush();
		assert.equal(await f.repository.get('photo-library:raster-export-journal:v1:catalog'), undefined); assert.equal(f.blobs.length, 2);
	} finally { f.held.resolve(); await m.dispose(); await settle(); await f.close(); }
});
