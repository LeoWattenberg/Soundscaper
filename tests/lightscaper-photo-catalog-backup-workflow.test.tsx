/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import type { PhotoLibraryBackupResultV1 } from '../src/common/editor/photo-library-backup-port-v1.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { usePhotoLibraryWorkflow, type PhotoLibraryBackupSaveRuntimeV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';
import type { CreatePhotoLibrarySessionV1 } from '../src/common/editor/photo-library-session-port-v1.ts';

const request = Object.freeze({ catalogName: 'Library', fileTypeDescription: 'Photo catalog backup' });
const archive: PhotoLibraryBackupResultV1 = Object.freeze({ catalogId: 'catalog-1', catalogName: 'Library',
	photoCount: 3, byteLength: 3, blob: null, notices: Object.freeze([]) });

async function mount(factory: CreatePhotoLibrarySessionV1, loader: () => Promise<PhotoLibraryBackupSaveRuntimeV1>) {
	let currentFactory = factory, currentLoader = loader, state: ReturnType<typeof usePhotoLibraryWorkflow> | undefined;
	function Harness() { state = usePhotoLibraryWorkflow(currentFactory, currentLoader); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return { ...mounted, get current() { assert.ok(state); return state; },
		async replace(next: CreatePhotoLibrarySessionV1, nextLoader = loader) { currentFactory = next; currentLoader = nextLoader; await mounted.render(); } };
}
function ports(prepareSave: PhotoLibraryBackupSaveRuntimeV1['prepareSave']): PhotoLibraryBackupSaveRuntimeV1 {
	return Object.freeze({ prepareSave, maximumStreamingBytes: 1024,
		saveFile: () => { throw new Error('Unexpected fallback delivery.'); } });
}
function direct(commit: () => Promise<void>, abort: () => Promise<void> = async () => undefined) {
	return createFileSystemPreparedSave({ fileName: 'Library.liscape', target: {
		createWritable: () => Promise.resolve({ write: () => undefined, close: commit, abort }),
	} });
}
function owner(events: string[] = []) {
	const value = createImportTestPort();
	value.backupCatalog = async options => {
		events.push('archive'); assert.ok(options?.writable);
		const writer = options.writable.getWriter();
		try { await writer.write(new Uint8Array([1, 2, 3])); await writer.close(); } finally { writer.releaseLock(); }
		return archive;
	};
	value.close = async () => { events.push('closed'); };
	return value;
}

test('runtime preload is opt-in and Save invokes its picker synchronously before lazy session acquisition', async () => {
	const events: string[] = [], value = owner(events); let loads = 0;
	const mounted = await mount(async () => { events.push('session'); return value; }, async () => {
		loads++; return ports(() => { events.push('picker'); return direct(async () => { events.push('commit'); }); });
	});
	try {
		assert.equal(loads, 0); assert.deepEqual(events, []); assert.equal(mounted.current.backupReady, false);
		await act(async () => { await mounted.current.prepareBackupSave(); });
		assert.equal(loads, 1); assert.deepEqual(events, []); assert.equal(mounted.current.backupReady, true);
		await act(async () => {
			const pending = mounted.current.saveBackup(request);
			assert.deepEqual(events, ['picker']);
			assert.equal((await pending)?.status, 'saved');
		});
		assert.deepEqual(events, ['picker', 'session', 'archive', 'commit']);
		assert.equal(mounted.current.backupReceipt?.status, 'saved'); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('a held picker owns exclusion without opening a session or queuing another foreground action', async () => {
	const picked = deferred<PreparedBrowserSave>(); let opens = 0, picks = 0;
	const mounted = await mount(async () => { opens++; return owner(); }, async () => ports(() => { picks++; return picked.promise; }));
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		let saving: ReturnType<typeof mounted.current.saveBackup> | undefined;
		await act(async () => { saving = mounted.current.saveBackup(request); await settle(); });
		assert.equal(mounted.current.busy, true); assert.equal(opens, 0);
		await act(async () => { await mounted.current.readPage(); assert.equal(await mounted.current.saveBackup(request), null); });
		assert.equal(opens, 0); assert.equal(picks, 1);
		await act(async () => { picked.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Library.liscape' }); await saving; });
		assert.equal(mounted.current.backupReceipt?.status, 'cancelled'); assert.equal(mounted.current.busy, false);
	} finally { picked.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Library.liscape' }); await mounted.dispose(); }
});

test('staged archive does not release workflow exclusion while native commit is held; late cancel retains saved ACK', async () => {
	const committed = deferred<void>(), events: string[] = [], value = owner(events);
	const mounted = await mount(async () => value, async () => ports(() => direct(() => { events.push('commit'); return committed.promise; })));
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		let saving: ReturnType<typeof mounted.current.saveBackup> | undefined;
		await act(async () => { saving = mounted.current.saveBackup(request); await settle(); });
		assert.deepEqual(events, ['archive', 'commit']); assert.equal(mounted.current.busy, true);
		await act(async () => { mounted.current.cancel(); await mounted.current.readPage(); });
		assert.equal(mounted.current.page, null); assert.equal(mounted.current.busy, true);
		await act(async () => { committed.resolve(); assert.equal((await saving)?.status, 'saved'); });
		assert.equal(mounted.current.backupReceipt?.status, 'saved'); assert.equal(mounted.current.busy, false);
	} finally { committed.resolve(); await mounted.dispose(); }
});

test('factory retirement waits for native commit, preserves caller ACK and suppresses replacement publication', async () => {
	const committed = deferred<void>(), events: string[] = [], old = owner(events); let opens = 0;
	const loader = async () => ports(() => direct(() => { events.push('commit'); return committed.promise; }));
	const mounted = await mount(async () => old, loader);
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		let saving: ReturnType<typeof mounted.current.saveBackup> | undefined;
		await act(async () => { saving = mounted.current.saveBackup(request); await settle(); });
		await mounted.replace(async () => { opens++; return owner(); });
		assert.equal(mounted.current.busy, true); assert.equal(events.includes('closed'), false);
		await act(async () => { await mounted.current.readPage(); }); assert.equal(opens, 0);
		await act(async () => { committed.resolve(); assert.equal((await saving)?.status, 'saved'); await settle(); });
		assert.equal(events.includes('closed'), true); assert.equal(mounted.current.backupReceipt, null); assert.equal(mounted.current.busy, false);
		await act(async () => { await mounted.current.readPage(); }); assert.equal(opens, 1);
	} finally { committed.resolve(); await mounted.dispose(); }
});

test('cancelled precommit archive joins held destination abort and admits no second picker while cleanup remains pending', async () => {
	const staged = deferred<PhotoLibraryBackupResultV1>(), cleaned = deferred<void>(); let aborts = 0, picks = 0;
	const value = owner(); value.backupCatalog = () => staged.promise;
	const mounted = await mount(async () => value, async () => ports(() => { picks++; return direct(async () => undefined, () => { aborts++; return cleaned.promise; }); }));
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		let saving: ReturnType<typeof mounted.current.saveBackup> | undefined;
		await act(async () => { saving = mounted.current.saveBackup(request); await settle(); mounted.current.cancel(); staged.resolve(archive); await settle(); });
		assert.equal(aborts, 1); assert.equal(mounted.current.busy, true);
		await act(async () => { assert.equal(await mounted.current.saveBackup(request), null); }); assert.equal(picks, 1);
		await act(async () => { cleaned.resolve(); assert.equal((await saving)?.status, 'cancelled'); });
		assert.equal(mounted.current.backupReceipt?.status, 'cancelled'); assert.equal(mounted.current.error, null);
	} finally { cleaned.resolve(); staged.resolve(archive); await mounted.dispose(); }
});

test('fallback reports download-started rather than saved and archive refusal reports no ACK', async () => {
	const value = owner(); value.backupCatalog = async () => ({ ...archive, blob: new Blob(['abc']) });
	const runtime: PhotoLibraryBackupSaveRuntimeV1 = { maximumStreamingBytes: 1024,
		prepareSave: () => ({ mode: 'blob', fileName: 'Library.liscape', target: { browserDownload: true } }),
		saveFile: () => ({ method: 'download', size: 3, fileName: 'Library.liscape' }) };
	const mounted = await mount(async () => value, async () => runtime);
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); assert.equal((await mounted.current.saveBackup(request))?.status, 'download-started'); });
		assert.equal(mounted.current.backupReceipt?.status, 'download-started');
		value.backupCatalog = async () => { throw new Error('Archive refused'); };
		await act(async () => { assert.equal(await mounted.current.saveBackup(request), null); });
		assert.equal(mounted.current.backupReceipt, null); assert.equal(mounted.current.error, 'Archive refused');
	} finally { await mounted.dispose(); }
});

test('cancellation plus failed destination discard remains a visible failure without a false cancelled receipt', async () => {
	const staged = deferred<PhotoLibraryBackupResultV1>(), value = owner(); value.backupCatalog = () => staged.promise;
	const mounted = await mount(async () => value, async () => ports(() => direct(async () => undefined,
		async () => { throw new Error('Native discard failed'); })));
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		let saving: ReturnType<typeof mounted.current.saveBackup> | undefined;
		await act(async () => { saving = mounted.current.saveBackup(request); await settle(); mounted.current.cancel(); staged.resolve(archive); });
		await act(async () => { assert.equal(await saving, null); });
		assert.match(mounted.current.error ?? '', /cleanup failed/u); assert.equal(mounted.current.backupReceipt, null);
		assert.equal(mounted.current.busy, false);
	} finally { staged.resolve(archive); await mounted.dispose(); }
});

test('stale runtime load cannot enable Save in a replacement generation', async () => {
	const loaded = deferred<PhotoLibraryBackupSaveRuntimeV1>(), mounted = await mount(async () => owner(), () => loaded.promise);
	try {
		let pending: Promise<void> | undefined;
		await act(async () => { pending = mounted.current.prepareBackupSave(); await settle(); });
		await mounted.replace(async () => owner(), async () => ports(() => direct(async () => undefined)));
		await act(async () => { loaded.resolve(ports(() => { throw new Error('Stale picker'); })); await pending; });
		assert.equal(mounted.current.backupReady, false);
		await act(async () => { assert.equal(await mounted.current.saveBackup(request), null); await mounted.current.prepareBackupSave(); });
		assert.equal(mounted.current.backupReady, true);
	} finally { loaded.resolve(ports(() => direct(async () => undefined))); await mounted.dispose(); }
});

test('retained preload handlers cannot load the old runtime into a replacement factory or loader generation', async () => {
	let oldLoads = 0, newLoads = 0;
	const factory = async () => owner(), previous = async () => { oldLoads++; return ports(() => direct(async () => undefined)); };
	const next = async () => { newLoads++; return ports(() => direct(async () => undefined)); };
	const mounted = await mount(factory, previous);
	try {
		const staleFactoryLoad = mounted.current.prepareBackupSave;
		await mounted.replace(async () => owner(), next);
		await act(async () => { await staleFactoryLoad(); });
		assert.equal(oldLoads, 0); assert.equal(newLoads, 0); assert.equal(mounted.current.backupReady, false);
		await mounted.replace(factory, previous); const staleLoaderLoad = mounted.current.prepareBackupSave;
		await mounted.replace(factory, next);
		await act(async () => { await staleLoaderLoad(); });
		assert.equal(oldLoads, 0); assert.equal(newLoads, 0); assert.equal(mounted.current.backupReady, false);
		const staleSave = mounted.current.saveBackup;
		await mounted.replace(factory, previous);
		await act(async () => { await mounted.current.prepareBackupSave(); assert.equal(await staleSave(request), null); });
		assert.equal(mounted.current.backupReceipt, null);
		await mounted.replace(factory, next);
		await act(async () => { await mounted.current.prepareBackupSave(); }); assert.equal(newLoads, 1);
	} finally { await mounted.dispose(); }
});

test('retrying a failed runtime preload clears its old error and enables Save only after the successful retry', async () => {
	let loads = 0;
	const mounted = await mount(async () => owner(), async () => {
		if (++loads === 1) throw new Error('Runtime unavailable');
		return ports(() => direct(async () => undefined));
	});
	try {
		await act(async () => { await mounted.current.prepareBackupSave(); });
		assert.equal(mounted.current.error, 'Runtime unavailable'); assert.equal(mounted.current.backupReady, false);
		await act(async () => { await mounted.current.prepareBackupSave(); });
		assert.equal(mounted.current.error, null); assert.equal(mounted.current.backupReady, true);
	} finally { await mounted.dispose(); }
});
