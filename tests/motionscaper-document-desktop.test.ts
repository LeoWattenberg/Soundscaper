/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { openMotionscaperDesktopProject, writeMotionscaperDesktopProject } from '../src/motionscaper/editor-document-desktop.ts';

function fixture() {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	return { store, session: new MotionscaperDocumentSession(store) };
}
const settings = { title: 'Native project', width: 128, height: 72, frameRate: { num: 30, den: 1 }, durationFrames: 30 };

test('native document workflow streams a verified archive, binds opened files and preserves cancelled draft publication', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-native-document-')); const path = join(root, 'native.mscape');
	let savePath = path; let cancelled = true; let bound = 0; let released = 0;
	const authority = createMotionscaperFileAuthority({ chooseSave: async () => cancelled ? null : savePath, chooseOpen: async () => path });
	const files = { ...authority, bindOpened: async (request: Parameters<typeof authority.bindOpened>[0]) => { bound += 1; await authority.bindOpened(request); },
		release: async (request: Parameters<typeof authority.release>[0]) => { released += 1; await authority.release(request); } };
	const first = fixture(); const second = fixture();
	try {
		await first.session.create(settings); const original = first.session.getSnapshot();
		await first.session.changeSettings({ ...settings, title: 'Committed native project' });
		await first.session.save((project) => writeMotionscaperDesktopProject(project, first.store, files));
		assert.equal(first.session.getSnapshot().dirty, true);
		assert.equal((await first.store.load(original.project!.id))?.digest, original.savedDigest);
		cancelled = false;
		await first.session.save((project) => writeMotionscaperDesktopProject(project, first.store, files));
		assert.equal(first.session.getSnapshot().dirty, false); assert.ok((await readFile(path)).byteLength > 100);
		assert.equal(await openMotionscaperDesktopProject(second.session, files), 'opened');
		assert.equal(second.session.getSnapshot().project?.title, 'Committed native project');
		assert.equal(bound, 1); assert.equal(released, 1);
		const saved = first.session.getSnapshot(); const originalBytes = await readFile(path);
		await first.session.changeSettings({ ...settings, title: 'Unpublished copy' });
		savePath = join(root, 'copy.mscape');
		await first.session.exportSnapshot(async (project) => { await writeMotionscaperDesktopProject(project, first.store, files, true); });
		assert.equal(first.session.getSnapshot().dirty, true);
		assert.equal((await first.store.load(saved.project!.id))?.digest, saved.savedDigest);
		assert.deepEqual(await readFile(path), originalBytes); assert.ok((await readFile(savePath)).byteLength > 100);
		await writeFile(path, 'invalid archive');
		await assert.rejects(openMotionscaperDesktopProject(second.session, files));
		assert.equal(bound, 1); assert.equal(released, 2);
		assert.equal(second.session.getSnapshot().project?.title, 'Committed native project');
		assert.equal(await openMotionscaperDesktopProject(second.session, null), 'browser');
	} finally { await authority.dispose(); await first.store.close(); await second.store.close(); await rm(root, { recursive: true, force: true }); }
});

test('native Save checks the document fence before file commit and keeps the prior file after ownership loss', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-fenced-native-')), path = join(root, 'native.mscape');
	const authority = createMotionscaperFileAuthority({ chooseSave: async () => path, chooseOpen: async () => path });
	const { store, session } = fixture(); let releaseDuringWrite = false;
	const files = { ...authority, write: async (input: Parameters<typeof authority.write>[0]) => {
		await authority.write(input); if (releaseDuringWrite) { releaseDuringWrite = false; await session.dispose(); }
	} };
	try {
		await session.create(settings);
		await session.save((project, assertCurrent) => writeMotionscaperDesktopProject(project, store, files, false, assertCurrent));
		const before = await readFile(path), saved = session.getSnapshot().savedDigest;
		await session.changeSettings({ ...settings, title: 'Must stay a draft' }); releaseDuringWrite = true;
		await assert.rejects(session.save((project, assertCurrent) => writeMotionscaperDesktopProject(project, store, files, false, assertCurrent)), /write access/iu);
		assert.deepEqual(await readFile(path), before); assert.equal(session.getSnapshot().savedDigest, saved);
		assert.equal(session.getSnapshot().dirty, true);
	} finally { await authority.dispose(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('native reviewed Open preserves archive failure and cleanup failure together', async () => {
	const { store, session } = fixture(); const cleanup = new Error('Native capability release failed.');
	try {
		await assert.rejects(openMotionscaperDesktopProject(session, {
			selectOpen: async () => ({ token: 'invalid', name: 'invalid.mscape', byteLength: 3 }), read: async () => new Uint8Array([1, 2, 3]),
			release: async () => { throw cleanup; }, bindOpened: async () => undefined, beginSave: async () => null, write: async () => undefined,
			commit: async () => { throw new Error('No save.'); }, cancel: async () => undefined,
		}, async () => undefined), error => error instanceof AggregateError && error.errors.length === 2 && error.errors[1] === cleanup);
	} finally { await session.dispose(); await store.close(); }
});
