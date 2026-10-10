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
import type { BrowserFileSaveRequest, BrowserSavedFile } from '../src/common/editor/browser-file-save-service.ts';

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
		assert.equal(reactProps(entry).disabled, true); assert.equal(reactProps(queue).disabled, true); assert.equal(loaders, 0); assert.equal(m.dom.find('[data-photo-batch-export-dialog]'), null);
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
	const events: string[] = [], blobs: Blob[] = [], held = deferred<void>(); let hold = false, retired: (() => Promise<void>) | null = null;
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
		saveRuntime: runtime,
		registerDestination(join) { retired = join; return () => { void join().catch(() => undefined); }; },
	};
	return { props, runtime, events, blobs, held, hold: () => { hold = true; }, retire: () => retired!() };
}
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
	} finally { await m.dispose(); await settle(); }
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
	} finally { f.held.resolve(); await m.dispose(); await settle(); }
});
