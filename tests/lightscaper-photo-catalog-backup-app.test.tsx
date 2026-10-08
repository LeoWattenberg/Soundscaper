/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import type { CreatePhotoLibrarySessionV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';
import { reactProps } from './helpers/react-test-dom.ts';

function owner() {
	const value = createImportTestPort(); let opens = 0, archives = 0, closes = 0;
	value.backupCatalog = async options => {
		archives++; assert.ok(options?.writable);
		const writer = options.writable.getWriter();
		try { await writer.write(new Uint8Array([1, 2, 3])); await writer.close(); } finally { writer.releaseLock(); }
		return { catalogId: 'catalog', catalogName: 'Library', photoCount: 0, byteLength: 3, blob: null, notices: [] };
	};
	value.close = async () => { closes++; };
	return { factory: async () => { opens++; return value; }, opens: () => opens, archives: () => archives, closes: () => closes };
}
function runtime(prepareSave: PhotoLibraryBackupSaveRuntimeV1['prepareSave']): PhotoLibraryBackupSaveRuntimeV1 {
	return { prepareSave, saveFile: () => { throw new Error('Unexpected fallback'); }, maximumStreamingBytes: 1024 };
}
function direct(close: () => Promise<void> = async () => undefined) {
	return createFileSystemPreparedSave({ fileName: 'Library.liscape', target: { createWritable: async () => ({ write: () => undefined, close }) } });
}
async function mount(initial: CreatePhotoLibrarySessionV1, loader: () => Promise<PhotoLibraryBackupSaveRuntimeV1>, locale = 'en') {
	let factory = initial;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale={locale} createSession={factory} loadBackupSaveRuntime={loader} />;
	});
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const menu = async () => {
		const button = mounted.dom.one('[data-photo-backup-menu]');
		await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); });
	};
	await flush();
	return { ...mounted, menu, flush,
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); await flush(); } };
}

test('File menu alone admits lazy backup runtime; the empty default view opens no catalog or backup surface', async () => {
	const session = owner(), loaded = deferred<PhotoLibraryBackupSaveRuntimeV1>(); let loads = 0, picks = 0;
	const mounted = await mount(session.factory, () => { loads++; return loaded.promise; });
	try {
		assert.equal(session.opens(), 0); assert.equal(loads, 0); assert.equal(mounted.dom.find('[data-photo-backup-dialog]'), null);
		assert.equal(mounted.dom.one('[data-photo-backup-menu]').closest('details')?.querySelector('summary')?.textContent, 'File');
		await mounted.menu(); assert.equal(loads, 1); assert.equal(session.opens(), 0);
		assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		await mounted.flush(() => { loaded.resolve(runtime(() => { picks++; return direct(); })); });
		assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, false);
		await mounted.flush(() => {
			reactProps(mounted.dom.one('[data-photo-backup-save]')).onClick?.({});
			assert.equal(picks, 1); assert.equal(session.opens(), 0, 'native picker runs before lazy catalog acquisition');
		});
		assert.equal(session.archives(), 1); assert.ok(mounted.dom.find('[data-photo-backup-status="saved"]'));
		assert.equal(mounted.dom.find('[data-photo-library]'), null, 'backup does not opt into the library view');
	} finally { loaded.resolve(runtime(() => direct())); await mounted.dispose(); }
});

test('held picker Close and reopen keep one destination owner, block Save, and publish truthful cancellation after settlement', async () => {
	const session = owner(), picked = deferred<PreparedBrowserSave>(); let picks = 0, signal: AbortSignal | undefined;
	const mounted = await mount(session.factory, async () => runtime(request => { picks++; signal = request.signal; return picked.promise; }));
	try {
		await mounted.menu(); await mounted.event('[data-photo-backup-save]', 'onClick'); await mounted.flush();
		await mounted.event('[data-photo-backup-close]', 'onClick'); await mounted.flush();
		assert.equal(signal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-backup-dialog]'), null);
		await mounted.menu(); assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		await mounted.event('[data-photo-backup-save]', 'onClick'); assert.equal(picks, 1); assert.equal(session.opens(), 0);
		await mounted.flush(() => { picked.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Library.liscape' }); });
		assert.ok(mounted.dom.find('[data-photo-backup-status="cancelled"]')); assert.equal(session.archives(), 0);
		assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, false);
	} finally { picked.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Library.liscape' }); await mounted.flush(); await mounted.dispose(); }
});

test('held native commit survives modal Close and factory retirement without publishing its ACK into the replacement', async () => {
	const first = owner(), second = owner(), committed = deferred<void>();
	const mounted = await mount(first.factory, async () => runtime(() => direct(() => committed.promise)));
	try {
		await mounted.menu(); await mounted.event('[data-photo-backup-save]', 'onClick'); await mounted.flush();
		assert.equal(first.archives(), 1); await mounted.event('[data-photo-backup-close]', 'onClick'); await mounted.menu();
		assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		await mounted.replace(second.factory); assert.equal(mounted.dom.find('[data-photo-backup-dialog]'), null);
		assert.equal(first.closes(), 0); assert.equal(second.opens(), 0);
		await mounted.flush(() => { committed.resolve(); }); assert.equal(first.closes(), 1);
		await mounted.menu(); assert.equal(mounted.dom.find('[data-photo-backup-receipt]'), null);
		assert.equal(second.opens(), 0);
	} finally { committed.resolve(); await mounted.flush(); await mounted.dispose(); }
});

test('German menu and dialog use their product copy while runtime load failure leaves the opted-in Close action available', async () => {
	const session = owner(), copy = bundledLightscaperEditorCopyForLocale('de');
	const mounted = await mount(session.factory, async () => { throw new Error('Save runtime unavailable'); }, 'de');
	try {
		assert.equal(mounted.dom.one('[data-photo-backup-menu]').textContent, copy.photoBackupTitle);
		await mounted.menu(); assert.ok(mounted.dom.find('[data-photo-backup-dialog]'));
		assert.match(mounted.dom.one('[role="alert"]').textContent, /Save runtime unavailable/u);
		assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		assert.equal(mounted.dom.one('[data-photo-backup-close]').textContent, copy.photoBackupClose);
		assert.equal(session.opens(), 0);
		await mounted.event('[data-photo-backup-close]', 'onClick'); assert.equal(mounted.dom.find('[data-photo-backup-dialog]'), null);
	} finally { await mounted.dispose(); }
});

test('reopening the backup presentation during another foreground read cannot cancel that unrelated operation', async () => {
	const held = deferred<void>(), port = createImportTestPort(); let signal: AbortSignal | undefined;
	port.readPage = async options => { signal = options?.signal; await held.promise;
		return { catalogName: 'Library', totalCount: 0, rows: [], cursor: null }; };
	const mounted = await mount(async () => port, async () => runtime(() => direct()));
	try {
		const show = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === 'Show photo library'); assert.ok(show);
		await mounted.flush(() => { reactProps(show).onClick?.({ currentTarget: show }); });
		assert.equal(signal?.aborted, false);
		await mounted.menu(); assert.equal(reactProps(mounted.dom.one('[data-photo-backup-save]')).disabled, true);
		await mounted.event('[data-photo-backup-close]', 'onClick'); assert.equal(signal?.aborted, false);
		await mounted.flush(() => { held.resolve(); });
	} finally { held.resolve(); await mounted.flush(); await mounted.dispose(); }
});
