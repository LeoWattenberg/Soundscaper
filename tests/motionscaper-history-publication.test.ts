/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
const settings = { title: 'Original', width: 64, height: 64, frameRate: { num: 30, den: 1 }, durationFrames: 60 };
test('prepared history transitions leave history untouched and reject stale or repeated acceptance', () => {
	const history = createMotionscaperHistory(createMotionscaperProject({ ...settings, id: 'p', compositionId: 'c' }));
	assert.equal(history.prepareUndo(), null); assert.equal(history.prepareRedo(), null);
	history.commit([{ type: 'project/rename', title: 'Edited' }]); const edited = history.snapshot(); const prepared = history.prepareUndo()!;
	assert.equal(prepared.project.title, 'Original'); assert.equal(prepared.project.revision, 2); assert.deepEqual(history.snapshot(), edited);
	prepared.accept(); assert.equal(history.snapshot().project, prepared.project); assert.equal(history.snapshot().canRedo, true);
	assert.throws(() => prepared.accept(), /stale|changed|accepted/iu);
	const redo = history.prepareRedo()!; history.commit([{ type: 'project/rename', title: 'Intervening' }]); assert.throws(() => redo.accept(), /stale|changed/iu);
	assert.equal(history.snapshot().project.title, 'Intervening'); assert.equal(history.snapshot().canRedo, false);
});
test('failed undo redo and settings retention preserve exact visible revision and complete history', async () => {
	const indexedDB = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory }); const session = new MotionscaperDocumentSession(store);
	try {
		await session.create(settings); await session.changeSettings({ ...settings, title: 'Edited' });
		const fail = async (operation: () => Promise<void>) => {
			const before = session.getSnapshot(); const observed: unknown[] = []; const unsubscribe = session.subscribe(() => observed.push(session.getSnapshot().project));
			const recovery = await store.loadRecovery(before.project!.id); indexedDB.failNextPutForStore('projects', new DOMException('Quota exhausted', 'QuotaExceededError'));
			await assert.rejects(operation(), /quota/iu); assert.deepEqual(session.getSnapshot(), before); assert.ok(observed.every((value) => value === before.project));
			assert.deepEqual(await store.loadRecovery(before.project!.id), recovery); unsubscribe();
		};
		await fail(() => session.undo()); await session.undo(); assert.equal(session.getSnapshot().project!.title, 'Original');
		await fail(() => session.redo()); await session.redo(); assert.equal(session.getSnapshot().project!.title, 'Edited');
		await fail(() => session.changeSettings({ ...settings, title: 'Rejected' })); await session.undo(); assert.equal(session.getSnapshot().project!.title, 'Original');
		await session.redo(); assert.equal(session.getSnapshot().project!.title, 'Edited');
	} finally { await store.close(); }
});
