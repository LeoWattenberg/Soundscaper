/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { photoBatchExportMenuCopy } from '../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { seedCurrentAppPhoto, currentAppLocks, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

import { repairRasterFixture, repairRecipe, decodePng } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../src/common/editor/controller/shared/photo-library-workflow-slot.ts';
import type { PhotoLibraryDevelopProxyRuntimeV3, PhotoLibraryDevelopFrameRequestV3, PhotoLibraryDevelopProxyViewV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-12T00:00:00.000Z';

async function fixture(locale: string, retainedLegacy = false) {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const session = await createPhotoLibrarySessionCurrentV1(seeded.options), first = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
	const repaired = replaceImageDevelopRepairSpotsV1(first.develop, { schemaVersion: 1, spots: [{ id: 'retained-repair', mode: 'heal', enabled: false,
		target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: .2, opacity: 1 }] });
	await session.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: first.revision,
		command: { type: 'record-develop', versionId: first.versionId, develop: repaired, label: 'Repair', createdAt: TIME } });
	if (retainedLegacy) {
		const selected = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
		await session.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: selected.revision,
			command: { type: 'select-develop-history', versionId: selected.versionId, cursor: 0 } });
	}
	const selected = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id }), port = session.develop, read = port.read;
	let reads = 0, opens = 0, picks = 0;
	Object.defineProperty(session, 'develop', { configurable: true, value: Object.freeze({ ...port,
		read: function (this: unknown, ...args: Parameters<typeof read>) {
			assert.equal(this, session.develop); reads++; return Reflect.apply(read, port, args) as ReturnType<typeof read>;
		} }) });
	let props: LightscaperAppPropsCurrentV1 = { locale, createSession: async () => { opens++; return session; },
		loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }),
		loadBackupSaveRuntime: async () => ({ maximumStreamingBytes: 536870912,
			prepareSave() { picks++; assert.fail('Selection and Hide must not acquire a native destination.'); },
			saveFile: async () => assert.fail('Preparation must not deliver a file.') }) };
	const target = new EventTarget(), methods = { dispatchEvent: target.dispatchEvent.bind(target),
		addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) };
	let host: Window | undefined; const saved = new Map<string, PropertyDescriptor | undefined>();
	const mounted = await mountPhotoImportUi(() => {
		if (!host) { host = window; for (const [key, value] of Object.entries(methods)) {
			saved.set(key, Object.getOwnPropertyDescriptor(host, key)); Object.defineProperty(host, key, { configurable: true, value });
		} }
		return <StrictMode><LightscaperAppCurrentV1 {...props} /></StrictMode>;
	});
	const copy = bundledLightscaperEditorCopyForLocale(locale), batch = photoBatchExportMenuCopy(locale);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (node: ReturnType<typeof button>) => { await act(async () => { reactProps(node).onClick?.({ currentTarget: node }); await settle(); }); };
	return { ...mounted, session, selected, copy, batch, button, click, reads: () => reads, opens: () => opens, picks: () => picks,
		async select() { await click(button(copy.photoShowLibrary)); await waitFor(async () => {
			await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-id]') !== null;
		}, 'actual Current catalog row'); const card = mounted.dom.one('[data-photo-id]');
			await act(async () => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); }); },
		async replace() { props = { ...props, loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }) }; await mounted.render(); },
		async dispose() { try { await mounted.dispose(); } finally { try { await session.close(); } finally {
			if (host) for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key); }
		} } } };
}

for (const locale of ['en', 'de']) for (const format of ['png', 'jpeg'] as const) test(`${locale}: existing File ${format} prepares real Current selection and Hide/reopen keeps its repaired owner`, async () => {
	const f = await fixture(locale, format === 'jpeg');
	try {
		const menu = f.dom.one(`[data-photo-${format}-export-menu]`);
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(f.opens(), 0); assert.equal(reactProps(menu).disabled, true); assert.equal(f.dom.find(`[data-photo-${format}-export-dialog]`), null);
		await f.select(); await f.click(menu);
		await waitFor(async () => { await act(async () => { await settle(); }); const save = f.dom.find(`[data-photo-${format}-export-save]`);
			return save !== null && (!reactProps(save).disabled || f.dom.find('[role="alert"]') !== null);
		}, 'Current export readiness or owning refusal');
		assert.equal(reactProps(f.dom.one(`[data-photo-${format}-export-save]`)).disabled, false, 'Photo3 must reach its genuine Current export preparation.');
		const reads = f.reads(), staleSave = reactProps(f.dom.one(`[data-photo-${format}-export-save]`)).onClick;
		await f.click(f.dom.one(`[data-photo-${format}-export-hide]`)); assert.equal(f.dom.find(`[data-photo-${format}-export-dialog]`), null);
		await act(async () => { staleSave?.({}); await settle(); }); assert.equal(f.picks(), 0);
		await f.click(f.button(f.batch.queue)); await act(async () => { await settle(); });
		assert.ok(f.dom.find(`[data-photo-${format}-export-dialog]`)); assert.equal(f.reads(), reads); assert.equal(f.opens(), 1); assert.equal(f.picks(), 0);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.selected.photoId }), f.selected);
	} finally { await f.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: existing File selected batch prepares a complete retained-repair Photo3 with selected legacy recipe`, async () => {
	const f = await fixture(locale, true);
	try {
		assert.equal(f.selected.develop.processVersion, 1); await assert.rejects(f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: f.selected.photoId }));
		await f.select(); await f.click(f.button(f.batch.downloadSelected));
		await waitFor(async () => { await act(async () => { await settle(); }); const start = f.dom.find('[data-photo-batch-export-start]');
			return start !== null && (!reactProps(start).disabled || f.dom.find('[role="alert"]') !== null);
		}, 'Current batch preparation or owning refusal');
		assert.equal(reactProps(f.dom.one('[data-photo-batch-export-start]')).disabled, false);
		assert.equal(f.opens(), 1); assert.equal(f.picks(), 0);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.selected.photoId }), f.selected);
	} finally { await f.dispose(); }
});

test('a retained Current File export handler cannot acquire a replacement renderer generation', async () => {
	const f = await fixture('en');
	try { await f.select(); const menu = f.dom.one('[data-photo-png-export-menu]'), stale = reactProps(menu).onClick;
		await f.replace(); await act(async () => { stale?.({ currentTarget: menu }); await settle(); });
		assert.equal(f.dom.find('[data-photo-png-export-dialog]'), null); assert.equal(f.opens(), 1); assert.equal(f.picks(), 0);
	} finally { await f.dispose(); }
});


/** Real selected catalog/Original/resource/runtime ownership. Only native canvas
 * publication and browser download acknowledgements use their existing ports. */
async function exportHost(f: Awaited<ReturnType<typeof repairRasterFixture>>, saveRuntime: PhotoLibraryBackupSaveRuntimeV1,
	runtime: Readonly<PhotoLibraryDevelopProxyRuntimeV3> = f.runtime) {
	const canvas = currentAppCanvasBoundary(), target = new EventTarget(), saved = new Map<string, PropertyDescriptor | undefined>();
	let host: Window | undefined, factories = 0;
	const props: LightscaperAppPropsCurrentV1 = { locale: 'en', createSession: async () => f.session,
		loadDevelopProxyRuntime: async () => { factories++; return runtime; }, loadBackupSaveRuntime: async () => saveRuntime };
	const mounted = await mountPhotoImportUi(() => {
		if (!host) { host = window; for (const [key, value] of Object.entries({ dispatchEvent: target.dispatchEvent.bind(target),
			addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) })) {
			saved.set(key, Object.getOwnPropertyDescriptor(host, key)); Object.defineProperty(host, key, { configurable: true, value });
		} }
		return <LightscaperAppCurrentV1 {...props} />;
	});
	const copy = bundledLightscaperEditorCopyForLocale('en');
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === name); assert.ok(node, name); return node; };
	const click = async (node: ReturnType<typeof button>) => { await act(async () => { reactProps(node).onClick?.({ currentTarget: node }); await settle(); }); };
	return { ...mounted, button, click, painted: canvas.painted, factories: () => factories,
		async selectAll() { await click(button(copy.photoShowLibrary)); await waitFor(async () => { await act(async () => { await settle(); });
			return mounted.dom.container.querySelectorAll('[data-photo-id]').length === f.photos.length;
		}, 'actual Current export rows'); const rows = mounted.dom.container.querySelectorAll('[data-photo-id]');
			for (const [index, row] of rows.entries()) await act(async () => { reactProps(row).onClick?.({ ctrlKey: index > 0, metaKey: false, shiftKey: false }); }); },
		async dispose() { try { await mounted.dispose(); } finally { canvas.restore();
			if (host) for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key); }
		} } };
}

test('Current File export waits for the held actual cached Develop preview Close before reusing its renderer', async () => {
	const f = await repairRasterFixture(), entered = deferred<void>(), release = deferred<void>();
	const installed = await f.installBrush(), base = repairRecipe();
	await f.changeRecipe({ ...base, effects: [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: installed.reference.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [{ maskId: 'brush', effectId: 'invert' }] });
	const before = await f.inspect(), frames: number[][] = [], scopes: PhotoLibraryDevelopProxyViewV3['frame']['pixels'][] = [], signals: AbortSignal[] = [];
	const actual = f.runtime, proxy = actual.withProxy, full = actual.withFullResolution, phases: ('proxy' | 'full')[] = []; let calls = 0;
	const render = <Result,>(phase: 'proxy' | 'full', request: Readonly<PhotoLibraryDevelopFrameRequestV3>,
		consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>): Promise<Result> => {
		if (phase === 'full') {
			assert.deepEqual(phases, ['proxy']); assert.equal(signals[0]!.aborted, true);
			assert.ok(scopes[0]!.every(value => value === 0), 'Export cannot borrow the cached renderer before proxy retirement physically joins.');
		}
		return Reflect.apply(phase === 'proxy' ? proxy : full, actual, [request, async (view: PhotoLibraryDevelopProxyViewV3) => {
			calls++; phases.push(phase); frames.push([...view.frame.pixels]); scopes.push(view.frame.pixels); signals.push(request.signal);
			if (phase === 'proxy') { assert.equal(calls, 1); entered.resolve(); await release.promise; }
			request.signal.throwIfAborted(); return consume(view);
		}]) as Promise<Result>;
	};
	const runtime: PhotoLibraryDevelopProxyRuntimeV3 = { withProxy: (request, consume) => render('proxy', request, consume),
		withFullResolution: (request, consume) => render('full', request, consume) };
	const request = f.request(), saveRuntime: PhotoLibraryBackupSaveRuntimeV1 = { maximumStreamingBytes: 536870912, prepareSave: request.prepareSave, saveFile: request.saveFile };
	const ui = await exportHost(f, saveRuntime, runtime);
	try {
		await ui.selectAll(); await ui.click(ui.button('Develop…'));
		await waitFor(async () => { await act(async () => { await settle(); }); return calls === 1 || ui.dom.find('[role="alert"]') !== null; }, 'actual cached Develop renderer borrow');
		assert.equal(calls, 1); assert.deepEqual(phases, ['proxy']); await entered.promise; assert.deepEqual(frames[0], [0, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		const workspace = ui.dom.one('[data-photo-develop-workspace]'), close = workspace.querySelectorAll('button').filter(node => node.textContent === 'Close').at(-1); assert.ok(close);
		await ui.click(close); assert.equal(signals[0]!.aborted, true); assert.ok(scopes[0]!.some(value => value !== 0));
		await ui.click(ui.dom.one('[data-photo-png-export-menu]')); assert.equal(ui.dom.find('[data-photo-png-export-dialog]'), null);
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return !reactProps(ui.dom.one('[data-photo-png-export-menu]')).disabled; }, 'joined Develop Close export admission');
		assert.ok(scopes[0]!.every(value => value === 0)); assert.equal(ui.factories(), 1);
		await ui.click(ui.dom.one('[data-photo-png-export-menu]'));
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.find('[data-photo-png-export-save]') !== null && !reactProps(ui.dom.one('[data-photo-png-export-save]')).disabled; }, 'Current PNG readiness after joined preview');
		await ui.click(ui.dom.one('[data-photo-png-export-save]')); await waitFor(async () => { await act(async () => { await settle(); }); return f.outputs.length === 1; }, 'actual Current PNG delivery');
		assert.equal(calls, 2); assert.deepEqual(phases, ['proxy', 'full']); assert.equal(ui.factories(), 1);
		assert.deepEqual([...decodePng(f.outputs[0]!.bytes).pixels], frames[0]); assert.ok(scopes.every(scope => scope.every(value => value === 0)));
		assert.deepEqual(await f.inspect(), before);
	} finally { release.resolve(); await ui.dispose(); await f.close(); }
});

test('a hidden Current batch excludes new Develop admission between genuine serial member jobs', async () => {
	const f = await repairRasterFixture(undefined, undefined, 2), before = await f.inspect(), entered = deferred<void>(), release = deferred<void>();
	const request = f.request(); let preparations = 0;
	const saveRuntime: PhotoLibraryBackupSaveRuntimeV1 = { maximumStreamingBytes: 536870912,
		prepareSave(value) { const outcome = request.prepareSave(value); preparations++;
			if (preparations !== 2) return outcome; entered.resolve(); return Promise.resolve(outcome).then(async admitted => { await release.promise; return admitted; }); }, saveFile: request.saveFile };
	const ui = await exportHost(f, saveRuntime);
	try {
		await ui.selectAll(); await ui.click(ui.button(photoBatchExportMenuCopy('en').downloadSelected));
		await waitFor(async () => { await act(async () => { await settle(); }); const start = ui.dom.find('[data-photo-batch-export-start]');
			return start !== null && (!reactProps(start).disabled || ui.dom.find('[role="alert"]') !== null); }, 'genuine Current batch preparation');
		assert.equal(reactProps(ui.dom.one('[data-photo-batch-export-start]')).disabled, false);
		await ui.click(ui.dom.one('[data-photo-batch-export-start]'));
		await waitFor(async () => { await act(async () => { await settle(); }); return preparations === 2 || ui.dom.find('[role="alert"]') !== null; }, 'second member destination before its selected render');
		assert.equal(preparations, 2); await entered.promise; assert.equal(f.outputs.length, 1); assert.equal(f.codecs.calls.opens, 1);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.equal(await remainsPending(release.promise), true);
		await ui.click(ui.dom.one('[data-photo-batch-export-hide]')); assert.equal(ui.dom.find('[data-photo-batch-export-dialog]'), null);
		await ui.click(ui.button('Develop…')); assert.equal(ui.dom.find('[data-photo-develop-workspace]'), null, 'A hidden unfinished queue must retain selected renderer admission.');
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return f.outputs.length === 2; }, 'both serial member deliveries');
		await waitFor(async () => { await act(async () => { await settle(); }); return !reactProps(ui.dom.one('[data-photo-png-export-menu]')).disabled; }, 'settled hidden queue releases admission');
		await ui.click(ui.button('Develop…')); await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.find('[data-photo-develop-workspace]') !== null; }, 'Develop after actual batch settlement');
		assert.deepEqual(await f.inspect(), before); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
	} finally { release.resolve(); await ui.dispose(); await f.close(); }
});


test('Current completed-journal replacement retains Develop exclusion while its hidden fresh queue is pending', async () => {
	const f = await repairRasterFixture(undefined, undefined, 2), before = await f.inspect(), entered = deferred<void>(), release = deferred<void>();
	const request = f.request(); let preparations = 0;
	const saveRuntime: PhotoLibraryBackupSaveRuntimeV1 = { maximumStreamingBytes: 536870912,
		prepareSave(value) { const outcome = request.prepareSave(value); preparations++;
			if (preparations !== 4) return outcome; entered.resolve(); return Promise.resolve(outcome).then(async admitted => { await release.promise; return admitted; }); }, saveFile: request.saveFile };
	const ui = await exportHost(f, saveRuntime), menuCopy = photoBatchExportMenuCopy('en');
	try {
		await ui.selectAll(); await ui.click(ui.button(menuCopy.downloadSelected));
		await waitFor(async () => { await act(async () => { await settle(); }); const start = ui.dom.find('[data-photo-batch-export-start]');
			return start !== null && (!reactProps(start).disabled || ui.dom.find('[role="alert"]') !== null); }, 'first actual Current batch preparation');
		assert.equal(reactProps(ui.dom.one('[data-photo-batch-export-start]')).disabled, false);
		await ui.click(ui.dom.one('[data-photo-batch-export-start]'));
		await waitFor(async () => { await act(async () => { await settle(); }); return f.outputs.length === 2 && !reactProps(ui.dom.one('[data-photo-png-export-menu]')).disabled; }, 'first complete native queue and joined settlement');
		assert.deepEqual(f.outputs.map(output => [...decodePng(output.bytes).pixels]), [[255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]]);
		await ui.click(ui.dom.one('[data-photo-batch-export-hide]')); await ui.click(ui.button(menuCopy.queue));
		await waitFor(async () => { await act(async () => { await settle(); }); const replace = ui.dom.find('[data-photo-batch-export-replace]');
			return replace !== null && (!reactProps(replace).disabled || ui.dom.find('[role="alert"]') !== null); }, 'actual completed journal replacement authority');
		assert.equal(ui.dom.one('[data-photo-export-journal]').querySelectorAll('li').length, 2);
		assert.equal(reactProps(ui.dom.one('[data-photo-batch-export-replace]')).disabled, false);
		await ui.click(ui.dom.one('[data-photo-batch-export-replace]'));
		await waitFor(async () => { await act(async () => { await settle(); }); return preparations === 4 || ui.dom.find('[role="alert"]') !== null; }, 'replacement second member before its selected render');
		assert.equal(preparations, 4); await entered.promise; assert.equal(f.outputs.length, 3); assert.equal(f.codecs.calls.opens, 3);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
		await ui.click(ui.dom.one('[data-photo-batch-export-hide]')); assert.equal(ui.dom.find('[data-photo-batch-export-dialog]'), null);
		const develop = ui.button('Develop…'), disabled = reactProps(develop).disabled;
		await ui.click(develop); assert.equal(ui.dom.find('[data-photo-develop-workspace]'), null, 'Replacement work must retain actual selected renderer admission.');
		assert.equal(disabled, true, 'Hidden replacement queue keeps the existing Develop menu disabled.');
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return f.outputs.length === 4 && !reactProps(ui.button('Develop…')).disabled; }, 'replacement native queue joined and released admission');
		await ui.click(ui.button('Develop…')); await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.find('[data-photo-develop-workspace]') !== null; }, 'Develop after completed replacement');
		assert.deepEqual(await f.inspect(), before);
	} finally { release.resolve(); await ui.dispose(); await f.close(); }
});
