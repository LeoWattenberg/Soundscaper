/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore, MotionProjectConflictError } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';

const settings = { title: 'Opening', width: 1280, height: 720, frameRate: { num: 30000, den: 1001 }, durationFrames: 240 };
function fixture() {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const store = createMotionscaperProjectStore({ indexedDB });
	let nextId = 0;
	const session = new MotionscaperDocumentSession(store, () => `motion-${++nextId}`);
	return { indexedDB, store, session };
}

test('Motionscaper document commands separate explicit saves from recoverable edits and undo', async () => {
	const { store, session } = fixture();
	try {
		await session.create(settings);
		const id = session.getSnapshot().project!.id;
		const savedDigest = session.getSnapshot().savedDigest;
		assert.equal((await store.load(id))?.project.title, 'Opening');
		await session.changeSettings({ ...settings, title: 'First edit', width: 1920 });
		assert.equal(session.getSnapshot().dirty, true);
		assert.equal((await store.load(id))?.digest, savedDigest);
		assert.equal((await store.loadRecovery(id))?.title, 'First edit');
		await session.undo();
		assert.equal(session.getSnapshot().project?.title, 'Opening');
		await session.redo();
		assert.equal(session.getSnapshot().project?.title, 'First edit');
		await session.save();
		assert.equal(session.getSnapshot().dirty, false);
		assert.notEqual(session.getSnapshot().savedDigest, savedDigest);
		assert.equal(await store.loadRecovery(id), null);
		await session.changeSettings({ ...settings, title: 'Recovered edit' });
		await session.dispose();
		const reopened = new MotionscaperDocumentSession(store);
		await reopened.open(id, false);
		assert.equal(reopened.getSnapshot().project?.title, 'First edit');
		await reopened.open(id, true);
		assert.equal(reopened.getSnapshot().project?.title, 'Recovered edit');
		assert.equal(reopened.getSnapshot().dirty, true);
	} finally { await store.close(); }
});

test('Motionscaper Save Copy exports the immutable draft without publishing a linked revision', async () => {
	const { store, session } = fixture();
	const other = fixture();
	try {
		await session.create(settings);
		const initial = session.getSnapshot();
		await session.changeSettings({ ...settings, title: 'Portable / copy' });
		const copy = await session.saveCopy();
		assert.equal(copy.fileName, 'Portable _ copy.mscape');
		assert.equal((await store.load(initial.project!.id))?.digest, initial.savedDigest);
		assert.equal(session.getSnapshot().dirty, true);
		await other.session.importArchive(copy.blob);
		assert.equal(other.session.getSnapshot().project?.title, 'Portable / copy');
		assert.equal(other.session.getSnapshot().dirty, false);
		assert.deepEqual(other.session.getSnapshot().project?.compositions[0]?.frameRate, { num: 30000, den: 1001 });
		await assert.rejects(session.importArchive(copy.blob), MotionProjectConflictError);
		assert.equal(session.getSnapshot().project?.title, 'Portable / copy');
	} finally { await store.close(); await other.store.close(); }
});

test('Motionscaper refuses stale saves while retaining the visible unsaved document', async () => {
	let now = 1000;
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const store = createMotionscaperProjectStore({ indexedDB, now: () => now });
	const other = createMotionscaperProjectStore({ indexedDB, now: () => now });
	const session = new MotionscaperDocumentSession(store);
	try {
		await session.create(settings);
		const initial = session.getSnapshot();
		await session.changeSettings({ ...settings, title: 'This window' });
		now += 16000;
		await other.save({ ...initial.project, revision: 1, title: 'Other window' }, initial.savedDigest);
		await assert.rejects(session.save(), MotionProjectConflictError);
		assert.equal(session.getSnapshot().project?.title, 'This window');
		assert.equal(session.getSnapshot().dirty, true);
		assert.equal(session.getSnapshot().busy, false);
		assert.equal((await store.load(initial.project!.id))?.project.title, 'Other window');
	} finally { await store.close(); await other.close(); }
});

test('Motionscaper layers are one recoverable undo step and their assets survive archive transfer', async () => {
	const { store, session } = fixture(); const other = fixture();
	try {
		await session.create(settings);
		const initial = session.getSnapshot();
		await session.addLayer({ kind: 'rectangle', name: 'Card', x: 50, y: 20, width: 200, height: 100, color: '#ff0000', opacity: 80, text: '', fontSize: 48 });
		assert.equal(session.getSnapshot().project?.compositions[0]?.layers[0]?.name, 'Card');
		assert.equal((await store.load(initial.project!.id))?.digest, initial.savedDigest);
		assert.equal((await store.loadRecovery(initial.project!.id))?.compositions[0]?.layers.length, 1);
		await session.undo(); assert.equal(session.getSnapshot().project?.compositions[0]?.layers.length, 0);
		await session.redo(); assert.equal(session.getSnapshot().project?.compositions[0]?.layers.length, 1);
		const copy = await session.saveCopy(); await other.session.importArchive(copy.blob);
		assert.equal(other.session.getSnapshot().project?.compositions[0]?.layers[0]?.kind, 'shapes');
		const revision = session.getSnapshot().project?.revision;
		await assert.rejects(session.addLayer({ kind: 'solid', name: 'Invalid', x: 0, y: 0, width: 0, height: 1, color: '#000000', opacity: 100, text: '', fontSize: 48 }));
		assert.equal(session.getSnapshot().project?.revision, revision);
	} finally { await store.close(); await other.store.close(); }
});

test('Motionscaper publishes a native save only after completed file commit and keeps cancelled drafts recoverable', async () => {
	const { store, session } = fixture();
	try {
		await session.create(settings); const initial = session.getSnapshot();
		await session.changeSettings({ ...settings, title: 'Native draft' });
		await session.save(() => Promise.resolve(false));
		assert.equal(session.getSnapshot().dirty, true);
		assert.equal((await store.load(initial.project!.id))?.digest, initial.savedDigest);
		await assert.rejects(session.save(() => Promise.reject(new Error('File changed'))), /File changed/u);
		assert.equal((await store.loadRecovery(initial.project!.id))?.title, 'Native draft');
		await session.save(async (project) => {
			assert.equal(project.title, 'Native draft'); assert.ok(Object.isFrozen(project));
			assert.equal((await store.load(project.id))?.digest, initial.savedDigest);
			return true;
		});
		assert.equal(session.getSnapshot().dirty, false);
		assert.equal((await store.load(initial.project!.id))?.project.title, 'Native draft');
	} finally { await store.close(); }
});
