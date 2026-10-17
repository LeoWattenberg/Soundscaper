/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES } from '../src/motionscaper/desktop-file-contract.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';

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

test('normal native Save of legacy or foreign-suffixed Motion input chooses .mscape and preserves its original', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-file-suffix-'));
	try {
		for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS.filter(value => value !== '.mscape')) {
			const original = join(root, `original${extension.toUpperCase()}`), destination = join(root, 'saved.mscape');
			await writeFile(original, 'original archive');
			let choice: string | null = null;
			const selections: { readonly suggestedName: string; readonly defaultPath?: string }[] = [];
			const files = createMotionscaperFileAuthority({ chooseOpen: async () => original, chooseSave: async selection => { selections.push(selection); return choice; } });
			try {
				const selected = await files.selectOpen(); assert.ok(selected);
				await files.bindOpened({ token: selected.token, projectId: 'p' }); await files.release({ token: selected.token });
				const request = { projectId: 'p', suggestedName: `Imported/title${extension}`, saveAs: false };
				assert.equal(await files.beginSave(request), null);
				assert.deepEqual(selections, [{ suggestedName: 'Imported_title.mscape', defaultPath: join(root, 'original.mscape') }]);
				assert.equal(await readFile(original, 'utf8'), 'original archive');
				choice = destination;
				const pending = await files.beginSave(request); assert.ok(pending); assert.equal(selections.length, 2);
				await files.write({ token: pending.token, offset: 0, bytes: new TextEncoder().encode('saved archive') });
				assert.equal(await readFile(original, 'utf8'), 'original archive');
				assert.equal((await files.commit({ token: pending.token, byteLength: 13 })).name, 'saved.mscape');
				assert.equal(await readFile(destination, 'utf8'), 'saved archive');
				const next = await files.beginSave(request); assert.ok(next); assert.equal(selections.length, 2);
				await files.write({ token: next.token, offset: 0, bytes: new TextEncoder().encode('next archive') });
				await files.commit({ token: next.token, byteLength: 12 });
				assert.equal(await readFile(destination, 'utf8'), 'next archive');
				assert.equal(await readFile(original, 'utf8'), 'original archive');
			} finally { await files.dispose(); await rm(destination, { force: true }); }
		}
	} finally { await rm(root, { recursive: true, force: true }); }
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

test('native Save suggestions replace only terminal shared suffixes after sanitizing the bounded name', async () => {
	const suggestions: string[] = [];
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => null, chooseSave: async ({ suggestedName }) => { suggestions.push(suggestedName); return null; } });
	try {
		for (const suffix of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
			await files.beginSave({ projectId: 'p', suggestedName: `Title/name${suffix.toUpperCase()}`, saveAs: true });
			assert.equal(suggestions.at(-1), 'Title_name.mscape');
		}
		for (const [suggestedName, expected] of [
			['.mscape', 'Motionscaper project.mscape'], ['  ', 'Motionscaper project.mscape'],
			['Title.scape.zip', 'Title.scape.zip.mscape'], [`${'x'.repeat(190)}.fscape`, `${'x'.repeat(180)}.mscape`],
		]) {
			await files.beginSave({ projectId: 'p', suggestedName, saveAs: true }); assert.equal(suggestions.at(-1), expected);
		}
	} finally { await files.dispose(); }
});

test('native Save Copy commits an independent file while normal Save retains its original binding', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-file-copy-'));
	const original = join(root, 'original.mscape'); const copy = join(root, 'copy.mscape');
	await writeFile(original, 'original'); let destination = original;
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => original, chooseSave: async () => destination });
	try {
		const selected = await files.selectOpen(); assert.ok(selected);
		await files.bindOpened({ token: selected.token, projectId: 'p' }); await files.release({ token: selected.token });
		await assert.rejects(files.beginSave({ projectId: 'p', suggestedName: 'Copy', saveAs: false, saveCopy: true }), /saveAs/iu);
		await assert.rejects(files.beginSave({ projectId: 'p', suggestedName: 'Copy', saveAs: true, saveCopy: true }), /independent/iu);
		destination = copy;
		const pending = await files.beginSave({ projectId: 'p', suggestedName: 'Copy', saveAs: true, saveCopy: true }); assert.ok(pending);
		await files.write({ token: pending.token, offset: 0, bytes: new TextEncoder().encode('copy') });
		await files.commit({ token: pending.token, byteLength: 4 });
		const save = await files.beginSave({ projectId: 'p', suggestedName: 'Current', saveAs: false }); assert.ok(save);
		await files.write({ token: save.token, offset: 0, bytes: new TextEncoder().encode('saved') });
		await files.commit({ token: save.token, byteLength: 5 });
		assert.equal(await readFile(original, 'utf8'), 'saved'); assert.equal(await readFile(copy, 'utf8'), 'copy');
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
