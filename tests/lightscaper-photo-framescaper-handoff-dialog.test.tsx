/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoFramescaperHandoffDialog, { type PhotoFramescaperHandoffDialogProps } from '../src/common/editor/ui/lightscaper/PhotoFramescaperHandoffDialog.tsx';
import type { PhotoFramescaperHandoffTarget } from '../src/lightscaper/controller/photo-framescaper-handoff-download.ts';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const target = (): PhotoFramescaperHandoffTarget => ({ binding: { catalogId: 'catalog', photoId: 'photo', versionId: 'master', expectedRevision: 0 },
	capture: { withCapture: async () => assert.fail('These dialog lifecycle controls never invoke archive capture.') }, checkCurrent: async () => undefined });
async function mount(prepare: PhotoFramescaperHandoffDialogProps['prepare']) {
	const destinations = new PhotoExportDestinations(), events: string[] = [];
	let selected = true;
	let props: PhotoFramescaperHandoffDialogProps = { locale: 'en', photoId: 'photo', fileName: 'Original.png', prepare, isSelected: () => selected,
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave: () => ({ mode: 'cancelled', cancelled: true, fileName: 'Original.fscape' }),
			saveFile: async () => assert.fail('No delivery expected') }, registerDestination: cancel => destinations.register(cancel), onClose: () => { events.push('closed'); } };
	const mounted = await mountPhotoImportUi(() => <PhotoFramescaperHandoffDialog {...props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	const click = async (label: string) => { const node = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label); assert.ok(node); await flush(() => { reactProps(node).onClick?.({}); }); };
	return { ...mounted, destinations, events, flush, click, selectOther() { selected = false; },
		async runtime(runtime: PhotoFramescaperHandoffDialogProps['saveRuntime']) { props = { ...props, saveRuntime: runtime }; await mounted.render(); } };
}
test('Close joins held selected-photo preparation before dismissing the opt-in dialog', async () => {
	const entered = deferred<void>(), release = deferred<PhotoFramescaperHandoffTarget>();
	const f = await mount(async () => { entered.resolve(); return release.promise; });
	try {
		await entered.promise; assert.equal(reactProps(f.dom.one('[data-photo-framescaper-handoff-download]')).disabled, true);
		await f.click('Close'); assert.deepEqual(f.events, []); assert.equal(await remainsPending(f.destinations.retireAndJoin()), true);
		release.resolve(target()); await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined dialog close');
	} finally { release.resolve(target()); await f.dispose(); await f.destinations.retireAndJoin(); }
});
test('unmount and catalog retirement join rejected held preparation without late publication', async () => {
	const entered = deferred<void>(), release = deferred<PhotoFramescaperHandoffTarget>(), primary = Symbol('retired preparation');
	const f = await mount(async () => { entered.resolve(); return release.promise; });
	await entered.promise; await f.dispose(); const retiring = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retiring), true);
	release.reject(primary); await retiring; assert.deepEqual(f.events, []);
});
test('Download prepares the native picker synchronously and Close joins its actual dismissal', async () => {
	const picker = deferred<PreparedBrowserSave>(), f = await mount(async () => target()); let signal: AbortSignal | undefined, pickers = 0;
	try {
		await f.runtime({ maximumStreamingBytes: 536870912, prepareSave(value) { pickers++; signal = value.signal; return picker.promise; }, saveFile: async () => assert.fail('Dismissed picker cannot deliver') });
		await waitFor(async () => { await f.flush(); return Object.is(reactProps(f.dom.one('[data-photo-framescaper-handoff-download]')).disabled, false); }, 'Download readiness');
		await f.flush(() => { reactProps(f.dom.one('[data-photo-framescaper-handoff-download]')).onClick?.({}); assert.equal(pickers, 1); });
		await f.click('Close'); assert.ok(signal); assert.equal(signal.aborted, true); assert.deepEqual(f.events, []);
		picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Original.fscape' });
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined native picker');
	} finally { picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Original.fscape' }); await f.dispose(); await f.destinations.retireAndJoin(); }
});
test('same-generation selected-photo change refuses the download click before authority', async () => {
	const f = await mount(async () => target()); let pickers = 0;
	try {
		await f.runtime({ maximumStreamingBytes: 536870912, prepareSave: () => { pickers++; throw new Error('Changed selection must not prepare'); }, saveFile: async () => assert.fail('No delivery') });
		await waitFor(async () => { await f.flush(); return Object.is(reactProps(f.dom.one('[data-photo-framescaper-handoff-download]')).disabled, false); }, 'selected readiness');
		f.selectOther(); await f.click('Download copy'); assert.equal(pickers, 0);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});
