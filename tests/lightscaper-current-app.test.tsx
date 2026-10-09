/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperAppV2, { type LightscaperAppPropsV2 } from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { seedCurrentAppPhoto, currentAppCanvasBoundary, readResidentPhotoLibraryCurrent, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { PHOTO_METADATA_QUERY_RUNTIME_V2 } from '../src/lightscaper/photo-metadata-query-ui-runtime.ts';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
async function mount(locale = 'en', withPhoto = false) {
	const native = mediaRestoreFixture(), locks = currentAppLocks(); let opens = 0, renders = 0, restores = 0;
	const receivers = { query: 0, saved: 0, restore: 0 };
	const seeded = withPhoto ? await seedCurrentAppPhoto(native.factory, locks) : null;
	const createSession = async () => { opens++; return seeded ? seeded.createSession() : createPhotoLibrarySessionV3({ name: 'Current', indexedDB: native.factory, locks }); };
	const loadDevelopProxyRuntime: NonNullable<LightscaperAppPropsV2['loadDevelopProxyRuntime']> = async source => {
		renders++; return createPhotoDevelopRenderRuntimeV2({ source });
	};
	let props: LightscaperAppPropsV2 = { locale, createSession, loadDevelopProxyRuntime,
		loadMetadataQueryRuntime: async function (this: LightscaperAppPropsV2) { if (this?.locale === locale) receivers.query++; return PHOTO_METADATA_QUERY_RUNTIME_V2; },
		loadSavedFilterRuntime: async function (this: LightscaperAppPropsV2) { if (this?.locale === locale) receivers.saved++; return PHOTO_SAVED_FILTER_RUNTIME_V1; },
		loadRestoreRuntime: async function (this: LightscaperAppPropsV2) { if (this?.locale === locale) receivers.restore++; restores++; return { restoreArchive: async () => ({ catalogId: 'catalog', catalogName: 'Restored',
			photoCount: 0, stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] }), close: async () => undefined }; } };
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperAppV2 {...props} /></StrictMode>;
	});
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	await flush();
	const click = async (text: string) => { const button = [...mounted.dom.container.querySelectorAll('button')].find(button => button.textContent === text);
		assert.ok(button, text); await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); }); return button; };
	return { ...mounted, flush, click, counts: () => ({ opens, renders, restores }), receivers,
		observe: () => readResidentPhotoLibraryCurrent(seeded ? [seeded.photo.id] : [], native.factory),
		async replaceRestore() { const previous = props.loadRestoreRuntime!; props = { ...props, loadRestoreRuntime: function (this: LightscaperAppPropsV2) { return Reflect.apply(previous, this, []) as ReturnType<typeof previous>; } }; await mounted.render(); await flush(); },
		async replaceQuery() { props = { ...props, loadMetadataQueryRuntime: async () => PHOTO_METADATA_QUERY_RUNTIME_V2 }; await mounted.render(); await flush(); },
		async replaceRenderer() { props = { ...props, loadDevelopProxyRuntime: async source => createPhotoDevelopRenderRuntimeV2({ source }) }; await mounted.render(); await flush(); } };
}

for (const locale of ['en', 'de']) test(`${locale}: current StrictMode App keeps all current features behind cold menus and opens actual runtime3 only on library demand`, async () => {
	const mounted = await mount(locale);
	try {
		assert.deepEqual(mounted.counts(), { opens: 0, renders: 0, restores: 0 });
		assert.equal(mounted.dom.find('[data-photo-library]'), null); assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null);
		await mounted.click(locale === 'de' ? 'Fotos importieren' : 'Import photos');
		assert.ok(mounted.dom.find('form')); assert.equal(mounted.counts().opens, 0);
		await mounted.replaceRenderer(); assert.equal(mounted.dom.find('form'), null);
		await mounted.click(locale === 'de' ? 'Fotobibliothek anzeigen' : 'Show photo library');
		assert.equal(mounted.counts().opens, 1); assert.ok(mounted.dom.find('[data-photo-library]')); assert.equal(mounted.dom.find('[role="alert"]'), null);
		assert.equal(mounted.counts().renders, 0);
	} finally { await mounted.dispose(); }
});

for (const menuKey of ['photoEditMetadata', 'photoMembershipTitle', 'photoQueryTitle', 'photoOrganizerTitle'] as const) test(`${menuKey}: renderer replacement fences retained scalar menu and Close handlers before local mutation`, async () => {
	const mounted = await mount('en', true), copy = bundledLightscaperEditorCopyForLocale('en');
	const select = async () => {
		await mounted.click(copy.photoShowLibrary);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-id]'); turn++) await mounted.flush();
		const card = mounted.dom.one('[data-photo-id]');
		await mounted.flush(() => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
	};
	try {
		await select(); const menu = await mounted.click(copy[menuKey]);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[role="dialog"]'); turn++) await mounted.flush();
		const staleMenu = reactProps(menu).onClick;
		const close = [...mounted.dom.container.querySelectorAll('button')].find(button => button.textContent === copy.photoCloseMetadata);
		assert.ok(close, mounted.dom.container.textContent); const staleClose = reactProps(close).onClick;
		await mounted.replaceRenderer(); assert.equal(mounted.dom.find('[role="dialog"]'), null);
		await select(); await mounted.click(copy[menuKey]);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[role="dialog"]'); turn++) await mounted.flush();
		const currentDialog = mounted.dom.one('[role="dialog"]');
		await mounted.flush(() => { staleClose?.({}); staleMenu?.({ currentTarget: menu }); });
		assert.equal(mounted.dom.find('[role="dialog"]'), currentDialog); assert.equal(mounted.dom.find('[role="alert"]'), null);
		assert.equal(mounted.counts().opens, 2); assert.equal((await mounted.observe()).photos[0]!.photo.revision, 0);
	} finally { await mounted.dispose(); }
});

test('renderer replacement retires retained selection and culling authority without writing the current photo', async () => {
	const mounted = await mount('en', true), copy = bundledLightscaperEditorCopyForLocale('en');
	try {
		await mounted.click(copy.photoShowLibrary);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-id]'); turn++) await mounted.flush();
		const card = mounted.dom.one('[data-photo-id]'), select = reactProps(card).onClick;
		await mounted.flush(() => { select?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		const rating = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === copy.photoRateStars.replace('{count}', '5')); assert.ok(rating);
		const cull = reactProps(rating).onClick;
		await mounted.replaceRenderer(); await mounted.click(copy.photoShowLibrary);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-id]'); turn++) await mounted.flush();
		const selected = mounted.dom.one('[data-photo-id]').getAttribute('aria-pressed');
		await mounted.flush(() => { select?.({ ctrlKey: false, metaKey: false, shiftKey: false }); cull?.({ currentTarget: rating }); });
		const observed = (await mounted.observe()).photos[0]!;
		assert.equal(observed.photo.rating, 0); assert.equal(observed.photo.revision, 0); assert.deepEqual(observed.bytes, [1, 2, 3]);
		assert.equal(mounted.dom.find('[data-photo-id]')?.getAttribute('aria-pressed'), selected);
	} finally { await mounted.dispose(); }
});

for (const replacement of ['Renderer', 'Restore'] as const) for (const action of ['start', 'close'] as const) test(`${replacement}-only replacement fences retained Restore ${action} while the current dialog remains usable`, async () => {
	const mounted = await mount();
	try {
		await mounted.event('[data-photo-restore-menu]', 'onClick', { currentTarget: mounted.dom.one('[data-photo-restore-menu]') });
		await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
		const stale = reactProps(mounted.dom.one(`[data-photo-restore-${action}]`)).onClick;
		await mounted[`replace${replacement}`]();
		await mounted.flush(() => { stale?.({}); });
		assert.equal(mounted.counts().restores, 0); assert.ok(mounted.dom.find('[data-photo-restore-dialog]'));
		await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
		await mounted.event('[data-photo-restore-start]', 'onClick');
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-restore-receipt]'); turn++) await mounted.flush();
		assert.equal(mounted.counts().restores, 1); assert.ok(mounted.dom.find('[data-photo-restore-receipt]'));
	} finally { await mounted.dispose(); }
});

test('query-loader-only replacement fences retained Close without retiring the actual library Session', async () => {
	const mounted = await mount(), copy = bundledLightscaperEditorCopyForLocale('en');
	try {
		await mounted.click(copy.photoShowLibrary); await mounted.click(copy.photoQueryTitle);
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-query-close]'); turn++) await mounted.flush();
		const close = reactProps(mounted.dom.one('[data-query-close]')).onClick;
		await mounted.replaceQuery();
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-query-close]'); turn++) await mounted.flush();
		const dialog = mounted.dom.one('[role="dialog"]');
		await mounted.flush(() => { close?.({}); });
		assert.equal(mounted.dom.find('[role="dialog"]'), dialog); assert.equal(mounted.counts().opens, 1);
		await mounted.event('[data-query-close]', 'onClick'); assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { await mounted.dispose(); }
});

for (const kind of ['query', 'saved', 'restore'] as const) test(`lazy ${kind} loader preserves the captured App props receiver`, async () => {
	const mounted = await mount(), copy = bundledLightscaperEditorCopyForLocale('en');
	try {
		if (kind === 'restore') {
			await mounted.event('[data-photo-restore-menu]', 'onClick', { currentTarget: mounted.dom.one('[data-photo-restore-menu]') });
			await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
			await mounted.event('[data-photo-restore-start]', 'onClick');
		} else await mounted.click(kind === 'query' ? copy.photoQueryTitle : copy.photoSavedFiltersTitle);
		for (let turn = 0; turn < 64 && mounted.receivers[kind] === 0; turn++) await mounted.flush();
		assert.equal(mounted.receivers[kind], 1, mounted.dom.container.textContent);
	} finally { await mounted.dispose(); }
});

test('renderer-only replacement retires actual Session and makes retained menu and Import Close handlers inert', async () => {
	const mounted = await mount();
	try {
		const show = await mounted.click('Show photo library');
		await mounted.click('Import photos');
		const staleMenu = reactProps(show).onClick, staleClose = [...mounted.dom.container.querySelectorAll('button')].find(button => button.textContent === 'Cancel');
		assert.ok(staleClose); const close = reactProps(staleClose).onClick;
		await mounted.replaceRenderer(); assert.equal(mounted.dom.find('form'), null);
		await mounted.click('Import photos'); const opened = mounted.dom.find('form'); assert.ok(opened);
		await mounted.flush(() => { close?.({}); staleMenu?.({ currentTarget: show }); });
		assert.equal(mounted.dom.find('form'), opened); assert.equal(mounted.counts().opens, 1);
	} finally { await mounted.dispose(); }
});

for (const failure of [false, true]) test(`actual Restore waits the registered whole Workspace importer after native body ACK; cleanup failure=${String(failure)}`, async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory), canvas = currentAppCanvasBoundary();
	const entered = deferred<void>(), release = deferred<void>(), cleanup = Object.freeze({ opaque: 'body cleanup' });
	let backendLoads = 0, published = 0;
	const createSession = async () => {
		const session = await seeded.createSession(), cube = session.cubeLuts;
		Object.defineProperty(session, 'cubeLuts', { value: Object.freeze({ ...cube, async importFile(...args: Parameters<typeof cube.importFile>) {
			const receipt = await Reflect.apply(cube.importFile, cube, args); published++; entered.resolve(); await release.promise;
			if (failure) throw cleanup; return receipt;
		} }) });
		return session;
	};
	const messages = photoDevelopCopy('en'), loadDevelopProxyRuntime: NonNullable<LightscaperAppPropsV2['loadDevelopProxyRuntime']> = async source => createPhotoDevelopRenderRuntimeV2({ source });
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperAppV2 locale="en" createSession={createSession} loadDevelopProxyRuntime={loadDevelopProxyRuntime}
			loadRestoreRuntime={async () => { backendLoads++; return { restoreArchive: async () => ({ catalogId: seeded.photo.catalogId,
				catalogName: 'Current', photoCount: 1, stackCount: 0, savedCollectionCount: 0, originalCount: 1, originalByteLength: 3, notices: [] }), close: async () => undefined }; }} />;
	});
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	const button = (text: string) => { const value = mounted.dom.container.querySelectorAll('button').find(element => element.textContent === text); assert.ok(value, text); return value; };
	const click = async (text: string) => { const target = button(text); await flush(() => { reactProps(target).onClick?.({ currentTarget: target }); }); };
	try {
		await flush(); await click('Show photo library');
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-id]'); turn++) await flush();
		assert.ok(mounted.dom.find('[data-photo-id]'), mounted.dom.container.textContent); const card = mounted.dom.one('[data-photo-id]'); await flush(() => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		const menu = mounted.dom.one('[data-photo-develop-menu]'); await flush(() => { reactProps(menu).onClick?.({ currentTarget: menu }); });
		for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-develop-effects]'); turn++) await flush();
		const choose = mounted.dom.container.querySelectorAll('select').find(value => value.parentNode?.textContent.startsWith(messages.choose)); assert.ok(choose);
		await flush(() => { reactProps(choose).onChange?.({ currentTarget: { value: 'cube-lut-profile-v1' } }); }); await click(messages.add);
		const file = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === messages.shared.videoEffectCubeLutImport); assert.ok(file);
		const body = `LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`;
		await act(async () => { reactProps(file).onChange?.({ currentTarget: { files: [new File([body], 'profile.cube')], value: '' } }); await entered.promise; });
		assert.equal(published, 1);
		const restore = mounted.dom.one('[data-photo-restore-menu]'); await flush(() => { reactProps(restore).onClick?.({ currentTarget: restore }); });
		await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
		await mounted.event('[data-photo-restore-start]', 'onClick'); await flush();
		assert.equal(backendLoads, 0); assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null);
		await flush(() => { release.resolve(); });
		for (let turn = 0; turn < 64 && !mounted.dom.find(failure ? '[role="alert"]' : '[data-photo-restore-receipt]'); turn++) await flush();
		assert.equal(backendLoads, failure ? 0 : 1);
		assert.ok(mounted.dom.find(failure ? '[role="alert"]' : '[data-photo-restore-receipt]'));
		const observed = await readResidentPhotoLibraryCurrent([seeded.photo.id], native.factory);
		assert.deepEqual(observed.photos[0]!.photo, seeded.photo); assert.deepEqual(observed.photos[0]!.bytes, [1, 2, 3]);
		assert.deepEqual(canvas.painted[0], [64, 128, 192, 255]);
	} finally { release.resolve(); await flush(); await mounted.dispose(); canvas.restore(); }
});

for (const locale of ['en', 'de']) test(`${locale}: actual current Import survives parent busy and same-generation rerenders until native publication closes the dialog`, async () => {
	const native = mediaRestoreFixture(), locks = currentAppLocks(), release = deferred<void>(), entered = deferred<void>();
	const source = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64')], 'Current import.png', { type: 'image/png' });
	const boundary = ['createImageBitmap', 'OffscreenCanvas'] as const, prior = boundary.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	let closes = 0, imports = 0, signal: AbortSignal | undefined;
	Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (body: Blob) => {
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), new Uint8Array(await source.arrayBuffer())); entered.resolve(); await release.promise;
		return { width: 2, height: 2, close() { closes++; } };
	} });
	class Canvas { constructor(readonly width: number, readonly height: number) {} getContext() { return {
		clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(Array.from({ length: 4 }, () => [255, 32, 0, 255]).flat()) }),
	}; } }
	Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
	const createSession = async () => {
		const session = await createPhotoLibrarySessionV3({ name: 'Import scope', indexedDB: native.factory, locks }), importFiles = session.importFiles;
		session.importFiles = (...args: Parameters<typeof importFiles>) => { imports++; signal = args[1]?.signal; return Reflect.apply(importFiles, session, args) as ReturnType<typeof importFiles>; };
		return session;
	};
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperAppV2 locale={locale} createSession={createSession} /></StrictMode>; });
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	try {
		await flush(); const menu = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === (locale === 'de' ? 'Fotos importieren' : 'Import photos')); assert.ok(menu);
		await flush(() => { reactProps(menu).onClick?.({ currentTarget: menu }); });
		const form = mounted.dom.one('[data-photo-import-form]'), input = mounted.dom.one('input'); Reflect.set(input, 'files', [source]);
		await mounted.event('input', 'onChange'); await mounted.event('[data-photo-import-form]', 'onSubmit', { preventDefault() {} });
		for (let turn = 0; turn < 64 && imports === 0; turn++) await flush();
		assert.equal(imports, 1, 'Parent busy must not retire the admitted import before selected Session admission');
		await entered.promise; assert.equal(signal?.aborted, false); assert.equal(mounted.dom.find('[data-photo-import-form]'), form);
		await mounted.render(); await flush(); assert.equal(signal?.aborted, false, 'A harmless same-generation App render must retain the active native request');
		const action = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === (locale === 'de' ? 'Importieren' : 'Import')); assert.ok(action?.hasAttribute('disabled'));
		await flush(() => { release.resolve(); });
		for (let turn = 0; turn < 64 && mounted.dom.find('[data-photo-import-form]'); turn++) await flush();
		assert.equal(mounted.dom.find('[data-photo-import-form]'), null, mounted.dom.container.textContent);
		const card = mounted.dom.one('[data-photo-id]'), id = card.getAttribute('data-photo-id'); assert.ok(id);
		const observed = await readResidentPhotoLibraryCurrent([id], native.factory), photo = observed.photos[0]!.photo;
		assert.deepEqual(observed.photos[0]!.bytes, [...new Uint8Array(await source.arrayBuffer())]);
		assert.equal(photo.original.name, source.name); assert.equal(photo.original.width, 2); assert.equal(photo.original.height, 2);
		assert.equal(photo.schemaVersion, 1); assert.equal(photo.revision, 0); assert.equal(imports, 1); assert.equal(closes, 1);
		assert.equal(mounted.dom.find('[role="alert"]'), null);
	} finally {
		release.resolve(); await flush(); await mounted.dispose();
		for (const [index, key] of boundary.entries()) { const value = prior[index]; if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
	}
});
