/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';

test('the neutral save facade invokes the picker in the activating turn and sanitizes its name', async () => {
	const calls: unknown[] = [];
	const target = { name: 'Chosen.liscape' };
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker(request) {
		calls.push(request); return Promise.resolve(target);
	} } });
	const types = [{ description: 'Photo catalog', accept: { 'application/zip': ['.liscape'] } }];
	const pending = service.prepareSave({ purpose: 'project', suggestedName: '  My:/catalog.liscape. ',
		useFileSystemAccess: true, types });
	assert.deepEqual(calls, [{ suggestedName: 'My-catalog.liscape', types, excludeAcceptAllOption: false }]);
	assert.deepEqual(await pending, { mode: 'blob', target, fileName: 'My-catalog.liscape' });
});

test('a prepared file-system stream stages bytes and only commits at the explicit acknowledgement', async () => {
	const calls: unknown[] = [];
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker: () => Promise.resolve({
		name: 'Chosen.liscape', createWritable: () => Promise.resolve({
			write(value) { calls.push(['write', value]); }, close() { calls.push(['close']); }, abort() { calls.push(['abort']); },
		}),
	}) } });
	const prepared = await service.prepareSave({ purpose: 'project', suggestedName: 'Backup.liscape', useFileSystemAccess: true });
	assert.equal(prepared.mode, 'stream');
	if (prepared.mode !== 'stream') throw new Error('Stream required.');
	const output = await prepared.createWritable(10);
	const writer = output.getWriter();
	await writer.write(new Uint8Array([1, 2, 3])); await writer.close(); writer.releaseLock();
	assert.equal(prepared.bytesWritten(), 3); assert.equal(calls.length, 1);
	assert.deepEqual(await prepared.commit(), { method: 'file-system-access', fileName: 'Chosen.liscape', size: 3 });
	assert.deepEqual(calls, [['write', new Uint8Array([1, 2, 3])], ['close']]);
});

test('download fallback reuses the prepared target without opening another picker and delays URL release', async () => {
	const calls: unknown[] = [];
	let timer: (() => void) | undefined;
	const anchor = { href: '', download: '', hidden: false, click() { calls.push(['click', this.download]); }, remove() { calls.push(['remove']); } };
	const service = createBrowserFileSaveService({ scope: {}, document: {
		createElement: () => anchor, body: { append(value) { assert.equal(value, anchor); calls.push(['append']); } },
	}, urlApi: { createObjectURL(blob) { assert.equal(blob.size, 3); return 'blob:backup'; }, revokeObjectURL(url) { calls.push(['revoke', url]); } },
	setTimeout(callback, delay) { assert.equal(delay, 30_000); timer = callback; } });
	const prepared = await service.prepareSave({ purpose: 'project', suggestedName: 'My/backup.liscape' });
	assert.equal(prepared.mode, 'blob');
	if (prepared.mode !== 'blob') throw new Error('Blob fallback required.');
	const result = await service.saveFile({ purpose: 'project', target: prepared.target, suggestedName: prepared.fileName, blob: new Blob(['abc']) });
	assert.deepEqual(result, { method: 'download', fileName: 'My-backup.liscape', size: 3 });
	assert.equal(anchor.href, 'blob:backup'); assert.equal(anchor.hidden, true);
	assert.deepEqual(calls, [['append'], ['click', 'My-backup.liscape'], ['remove']]);
	assert.ok(timer); timer();
	assert.deepEqual(calls.at(-1), ['revoke', 'blob:backup']);
});

test('picker dismissal is a cancelled target while explicit cancellation joins the held picker', async () => {
	const dismissed = createBrowserFileSaveService({ scope: { showSaveFilePicker() {
		return Promise.reject(new DOMException('Dismissed', 'AbortError'));
	} } });
	assert.deepEqual(await dismissed.prepareSave({ purpose: 'project', suggestedName: 'x.liscape', useFileSystemAccess: true }),
		{ mode: 'cancelled', cancelled: true, fileName: 'x.liscape' });
	const abort = new AbortController();
	let release!: (target: { name: string }) => void;
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker: () => new Promise(resolve => { release = resolve; }) } });
	let settled = false;
	const pending = service.prepareSave({ purpose: 'project', suggestedName: 'x.liscape', useFileSystemAccess: true, signal: abort.signal });
	const observed = pending.finally(() => { settled = true; });
	abort.abort(); await Promise.resolve(); assert.equal(settled, false);
	release({ name: 'x.liscape' });
	await assert.rejects(observed, { name: 'AbortError' });
});

test('invalid purpose and already cancelled saves never invoke a picker or initiate download', async () => {
	let picks = 0;
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker() { picks += 1; return Promise.resolve({}); } } });
	await assert.rejects(service.prepareSave({ purpose: 'unknown', useFileSystemAccess: true }), /Unsupported file purpose/);
	const signal = AbortSignal.abort();
	await assert.rejects(service.saveFile({ purpose: 'project', useFileSystemAccess: true, blob: new Blob(), signal }), { name: 'AbortError' });
	assert.equal(picks, 0);
});
