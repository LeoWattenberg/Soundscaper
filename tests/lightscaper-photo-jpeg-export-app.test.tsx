/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperAppV2, { type LightscaperAppPropsV2 } from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const previousRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previousRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

for (const locale of ['en', 'de']) test(`${locale}: File JPEG stays cold without selection and retirement joins the real held picker before originals close`, async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const picker = deferred<PreparedBrowserSave>(), events: string[] = []; let pickerSignal: AbortSignal | undefined;
	const open: NonNullable<LightscaperAppPropsV2['createSession']> = async () => {
		events.push('open'); const owner = await seeded.createSession(), close = owner.close.bind(owner);
		owner.close = async () => { events.push('original-close'); await close(); }; return owner;
	};
	let props: LightscaperAppPropsV2 = { locale, createSession: open, loadDevelopProxyRuntime: async source => createPhotoDevelopRenderRuntimeV2({ source }),
		loadBackupSaveRuntime: async function (this: LightscaperAppPropsV2) {
			assert.equal(this.locale, locale); events.push('load-save'); return { maximumStreamingBytes: 536870912,
				prepareSave(request) { events.push('picker'); assert.equal(request.mimeType, 'image/jpeg'); assert.ok(typeof request.suggestedName === 'string' && request.suggestedName.endsWith('.jpg')); pickerSignal = request.signal; return picker.promise; },
				saveFile: async () => assert.fail('Cancelled picker cannot download') };
		} };
	const m = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperAppV2 {...props} /></StrictMode>;
	});
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	const click = async (selector: string) => { const button = m.dom.one(selector); await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); }); };
	const showLibrary = async () => {
		const button = m.dom.container.querySelectorAll('button').find(value => value.textContent === (locale === 'de' ? 'Fotobibliothek anzeigen' : 'Show photo library'));
		assert.ok(button); await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); });
	};
	try {
		const menu = m.dom.one('[data-photo-jpeg-export-menu]');
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(reactProps(menu).disabled, true); assert.equal(m.dom.find('[data-photo-jpeg-export-dialog]'), null); assert.equal(events.length, 0);
		await click('[data-photo-jpeg-export-menu]'); assert.equal(events.length, 0);
		await showLibrary(); await waitFor(async () => { await flush(); return m.dom.find('[data-photo-id]') !== null; }, 'selected library photo'); const card = m.dom.one('[data-photo-id]');
		await flush(() => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		assert.equal(reactProps(menu).disabled, false);
		await click('[data-photo-jpeg-export-menu]');
		await waitFor(async () => { await flush(); const save = m.dom.find('[data-photo-jpeg-export-save]'); return save !== null && save.disabled === false; }, 'JPEG Save readiness');
		assert.ok(m.dom.one('[data-photo-jpeg-export-dialog]')); assert.equal(events.includes('picker'), false);
		assert.equal(m.dom.container.ownerDocument.activeElement, m.dom.one('[data-photo-jpeg-export-save]'));
		await flush(() => { reactProps(m.dom.one('[data-photo-jpeg-export-save]')).onClick?.({}); assert.equal(events.at(-1), 'picker'); });
		assert.ok(pickerSignal); assert.equal(pickerSignal.aborted, false);
		props = { ...props, createSession: () => open() }; await m.render(); await flush();
		assert.equal(pickerSignal.aborted, true); assert.equal(m.dom.find('[data-photo-jpeg-export-dialog]'), null);
		await showLibrary(); assert.equal(events.filter(value => value === 'open').length, 1); assert.equal(events.includes('original-close'), false);
		await flush(() => { picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Current.jpg' }); });
		await waitFor(async () => { await flush(); return events.filter(value => value === 'open').length === 2; }, 'replacement original owner');
		assert.ok(events.indexOf('original-close') > events.indexOf('picker'));
	} finally { picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Current.jpg' }); await m.dispose(); await settle(); }
});
