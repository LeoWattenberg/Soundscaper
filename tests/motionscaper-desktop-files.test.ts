/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES } from '../src/motionscaper/desktop-file-contract.ts';

test('Motionscaper file capabilities retain paths in main and replace a bound archive only at commit', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-files-'));
	const path = join(root, 'project.mscape'); await writeFile(path, 'old archive');
	let dialogs = 0;
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => { dialogs += 1; return path; } });
	try {
		const opened = await files.selectOpen(); assert.ok(opened);
		assert.deepEqual(Object.keys(opened).sort(), ['byteLength', 'name', 'token']);
		assert.equal(new TextDecoder().decode(await files.read({ token: opened.token, offset: 0, length: opened.byteLength })), 'old archive');
		await files.bindOpened({ token: opened.token, projectId: 'project-1' }); await files.release({ token: opened.token });
		const pending = await files.beginSave({ projectId: 'project-1', suggestedName: 'ignored', saveAs: false }); assert.ok(pending);
		const body = new TextEncoder().encode('complete archive');
		await files.write({ token: pending.token, offset: 0, bytes: body });
		assert.equal(await readFile(path, 'utf8'), 'old archive');
		const receipt = await files.commit({ token: pending.token, byteLength: body.length });
		assert.equal(await readFile(path, 'utf8'), 'complete archive');
		assert.equal(receipt.sha256, createHash('sha256').update(body).digest('hex'));
		assert.equal(dialogs, 0);
		await assert.rejects(files.commit({ token: pending.token, byteLength: body.length }), /capability/iu);
		assert.deepEqual(await readdir(root), ['project.mscape']);
	} finally { await files.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('cancelled or conflicting saves preserve the destination and refuse invalid chunk capabilities', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-file-conflict-'));
	const path = join(root, 'archive.mscape'); await writeFile(path, 'original');
	let cancelDialog = true;
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => cancelDialog ? null : path });
	try {
		assert.equal(await files.beginSave({ projectId: 'p', suggestedName: 'x', saveAs: true }), null);
		cancelDialog = false;
		const pending = await files.beginSave({ projectId: 'p', suggestedName: 'x', saveAs: true }); assert.ok(pending);
		await assert.rejects(files.write({ token: pending.token, offset: 3, bytes: new Uint8Array([1]) }), /offset/iu);
		await assert.rejects(files.write({ token: pending.token, offset: 0, bytes: new Uint8Array(MOTIONSCAPER_FILE_CHUNK_BYTES + 1) }), /chunk/iu);
		await assert.rejects(files.read({ token: '../archive.mscape', offset: 0, length: 1 }), /capability/iu);
		await files.write({ token: pending.token, offset: 0, bytes: new TextEncoder().encode('replacement') });
		await writeFile(path, 'external update');
		await assert.rejects(files.commit({ token: pending.token, byteLength: 11 }), /changed/iu);
		await files.cancel({ token: pending.token });
		assert.equal(await readFile(path, 'utf8'), 'external update');
		assert.deepEqual(await readdir(root), ['archive.mscape']);
	} finally { await files.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('desktop archive adapter splits bounded chunks and exposes commit only after a complete stream', async () => {
	const { beginMotionscaperDesktopSave, selectMotionscaperDesktopArchive } = await import('../src/motionscaper/desktop-file-adapter.ts');
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-file-adapter-'));
	const path = join(root, 'saved.mscape');
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	try {
		const output = await beginMotionscaperDesktopSave(files, { projectId: 'p', suggestedName: 'saved' }); assert.ok(output);
		await assert.rejects(output.commit(), /finish streaming/u);
		const sink = output.writable.getWriter();
		const bytes = new Uint8Array(MOTIONSCAPER_FILE_CHUNK_BYTES + 7); bytes[bytes.length - 1] = 19;
		await sink.write(bytes); await sink.close();
		const receipt = await output.commit(); assert.equal(receipt.byteLength, bytes.length);
		const selected = await selectMotionscaperDesktopArchive(files); assert.ok(selected);
		assert.equal(selected.input.size, bytes.length);
		assert.deepEqual(await selected.input.read({ offset: bytes.length - 1, length: 1 }), Uint8Array.of(19));
		await selected.bind('p'); await selected.release(); await selected.release();
		await assert.rejects(selected.input.read({ offset: 0, length: 1 }), /released/u);
		const cancelled = await beginMotionscaperDesktopSave(files, { projectId: 'p', suggestedName: 'saved' }); assert.ok(cancelled);
		await cancelled.abort(); await cancelled.abort();
		assert.equal((await readFile(path)).byteLength, bytes.length);
	} finally { await files.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Motionscaper IPC accepts only its closed capability methods and payloads', async () => {
	const { dispatchMotionscaperFileCall } = await import('../desktop/motionscaper-file-ipc.ts');
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => null, chooseSave: async () => null });
	try {
		assert.equal(await dispatchMotionscaperFileCall(files, 'selectOpen', {}), null);
		await assert.rejects(dispatchMotionscaperFileCall(files, 'openPath', { path: '/private' }), /method/u);
		await assert.rejects(dispatchMotionscaperFileCall(files, 'selectOpen', { path: '/private' }), /fields/u);
		await assert.rejects(dispatchMotionscaperFileCall(files, 'read', { token: 'missing', offset: -1, length: 1 }), /count/u);
		await assert.rejects(dispatchMotionscaperFileCall(files, 'write', { token: 'missing', offset: 0, bytes: [1] }), /byte arrays/u);
		await assert.rejects(dispatchMotionscaperFileCall(files, 'beginSave', { projectId: 'p', suggestedName: 'x', saveAs: 'yes' }), /flag/u);
	} finally { await files.dispose(); }
});
