/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { openMotionProjectDatabase } from '../src/common/editor/storage/motion-project-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
const settings = { title: 'Saved', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 48 };

test('M02 another Motion editor cannot replace a recovery draft before either editor saves', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const firstStore = createMotionscaperProjectStore({ indexedDB }), secondStore = createMotionscaperProjectStore({ indexedDB });
	const first = new MotionscaperDocumentSession(firstStore), second = new MotionscaperDocumentSession(secondStore);
	try {
		await first.create(settings); const id = first.getSnapshot().project!.id;
		await first.changeSettings({ ...settings, title: 'Only durable draft' });
		await assert.rejects(second.open(id), /another|write access|lease/iu);
		assert.equal(second.getSnapshot().project, null);
		assert.equal((await secondStore.loadRecovery(id))?.title, 'Only durable draft');
		await firstStore.close();
		await second.open(id, true); assert.equal(second.getSnapshot().project?.title, 'Only durable draft');
		await second.changeSettings({ ...settings, title: 'Recovered by new owner' });
		await second.save(); assert.equal((await secondStore.load(id))?.project.title, 'Recovered by new owner');
	} finally { await firstStore.close(); await secondStore.close(); }
});

test('M02 an expired owner cannot save, undo, or replace the next owner recovery; reopening requires fresh authority', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory; let now = 1000;
	const firstStore = createMotionscaperProjectStore({ indexedDB, now: () => now }), secondStore = createMotionscaperProjectStore({ indexedDB, now: () => now });
	const first = new MotionscaperDocumentSession(firstStore), second = new MotionscaperDocumentSession(secondStore);
	try {
		await first.create(settings); await first.changeSettings({ ...settings, title: 'First draft' });
		const before = first.getSnapshot(), id = before.project!.id; now += 16000;
		await second.open(id, true); await second.changeSettings({ ...settings, title: 'Second draft' });
		const published: string[] = []; firstStore.subscribeSaved(value => published.push(value.digest));
		await assert.rejects(first.changeSettings({ ...settings, title: 'Late overwrite' }), /write access/iu);
		await assert.rejects(first.undo(), /write access/iu); await assert.rejects(first.save(), /write access/iu);
		assert.deepEqual(first.getSnapshot(), before); assert.deepEqual(published, []);
		assert.equal((await secondStore.loadRecovery(id))?.title, 'Second draft');
		await assert.rejects(first.open(id, true), /another|write access/iu);
		await second.dispose(); await first.open(id, true);
		assert.equal(first.getSnapshot().project?.title, 'Second draft'); await first.save();
	} finally { await firstStore.close(); await secondStore.close(); }
});

test('M02 same-store sessions are independent owners and a refused switch preserves the current document', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory, store = createMotionscaperProjectStore({ indexedDB });
	const first = new MotionscaperDocumentSession(store), second = new MotionscaperDocumentSession(store);
	try {
		await first.create(settings); const firstId = first.getSnapshot().project!.id;
		await second.create({ ...settings, title: 'Second' }); const before = second.getSnapshot();
		await assert.rejects(second.open(firstId), /another/iu); assert.deepEqual(second.getSnapshot(), before);
		await second.changeSettings({ ...settings, title: 'Still owns second' });
		await first.dispose(); await second.open(firstId);
		const third = new MotionscaperDocumentSession(store); await third.open(before.project!.id, true);
		assert.equal(third.getSnapshot().project?.title, 'Still owns second'); await third.dispose();
	} finally { await store.close(); }
});

test('M02 storage fencing rejects forged and cross-project capabilities before publishing any pointer', async () => {
	const indexedDB = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	try {
		const project = createMotionscaperProject({ ...settings, id: 'own', compositionId: 'main' }); const lease = await store.acquireWriteAccess(project.id);
		await assert.rejects(store.save(project, null, { ...lease }), /write access/iu);
		await assert.rejects(store.save({ ...project, id: 'other' }, null, lease), /another session/iu);
		assert.deepEqual(await store.list(), []);
		await store.releaseWriteAccess(lease); await assert.rejects(store.save(project, null, lease), /write access/iu);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 0);
	} finally { await store.close(); }
});

test('M02 upgrading the original Motion database adds private fences without changing saved or recovery bytes', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const original = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open('kw-media-motionscaper-editor-v1', 1);
		opening.onupgradeneeded = () => {
			for (const name of ['projects', 'revisions', 'assets', 'chunks', 'staging']) opening.result.createObjectStore(name, { keyPath: name === 'projects' ? 'id' : 'key' });
		}; opening.onerror = () => reject(opening.error); opening.onsuccess = () => resolve(opening.result);
	});
	const project = createMotionscaperProject({ ...settings, id: 'legacy', compositionId: 'main' }), snapshot = createMotionscaperRevision(project);
	const marker = { id: 'legacy', savedDigest: snapshot.digest, savedTitle: project.title, savedRevision: 0, recovery: { ...project, revision: 1, title: 'Legacy draft' } };
	const revision = { key: `legacy:${snapshot.digest}`, projectId: 'legacy', snapshot };
	await transact(original, ['projects', 'revisions'], 'readwrite', async stores => { await request(stores.projects.put(marker)); await request(stores.revisions.put(revision)); }); original.close();
	const upgraded = await openMotionProjectDatabase(indexedDB, 'kw-media-motionscaper-editor-v1');
	try {
		assert.equal(upgraded.version, 2); assert.equal(upgraded.objectStoreNames.contains('writeLeases'), true);
		assert.deepEqual(await transact(upgraded, ['projects'], 'readonly', stores => request(stores.projects.get('legacy'))), marker);
		assert.deepEqual(await transact(upgraded, ['revisions'], 'readonly', stores => request(stores.revisions.get(revision.key))), revision);
	} finally { upgraded.close(); }
});

test('M02 refused and interrupted claims leave no project or orphan writer visible', async () => {
	const indexedDB = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	try {
		indexedDB.failNextPutForStore('writeLeases', new DOMException('Quota exhausted', 'QuotaExceededError'));
		await assert.rejects(store.acquireWriteAccess('project'), /Quota/iu);
		const lease = await store.acquireWriteAccess('project'); await store.releaseWriteAccess(lease);
		const interrupted = store.acquireWriteAccess('pending'); const closing = store.close();
		await assert.rejects(interrupted, /write access/iu); await closing;
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 0);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'projects'), 0);
	} finally { await store.close(); }
});

test('Motion failed durable lease deletion retains cleanup ownership and retries without enabling stale writes', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const first = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	const second = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	try {
		const lease = await first.acquireWriteAccess('release-retry');
		indexedDB.failNextDeleteForStore('writeLeases', new DOMException('Release transaction aborted', 'AbortError'));
		await assert.rejects(first.releaseWriteAccess(lease), /aborted/iu);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 1);
		await assert.rejects(first.assertWriteAccess(lease), /write access/iu);
		await assert.rejects(second.acquireWriteAccess('release-retry'), /another|write access/iu);
		await Promise.all([first.releaseWriteAccess(lease), first.releaseWriteAccess(lease)]);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 0);
		const next = await second.acquireWriteAccess('release-retry'); await second.releaseWriteAccess(next);
	} finally { await first.close(); await second.close(); }
});

test('Motion failed store closure preserves the database for a later durable lease cleanup retry', async () => {
	const indexedDB = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	await store.acquireWriteAccess('close-retry');
	indexedDB.failNextDeleteForStore('writeLeases', new DOMException('Release transaction aborted', 'AbortError'));
	await assert.rejects(store.close(), /cleanup/iu);
	assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 1);
	await assert.rejects(store.list(), /closed/iu);
	await Promise.all([store.close(), store.close()]);
	assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'writeLeases'), 0);
});
