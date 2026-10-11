/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { prepareMotionscaperDocumentOpen, MotionArchiveAdoptionError } from '../src/motionscaper/editor-document-open.ts';
const project = createMotionscaperProject({ id: 'review-open', compositionId: 'comp', title: 'Selected original', width: 16, height: 16, durationFrames: 2 });
async function fixture() {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store); const file = await exportMotionscaperArchive(project, () => null); assert.ok(file);
	return { store, session, file };
}
test('M02 native reviewed Open retries binding/release after accepted publication without importing twice', async () => {
	const f = await fixture(); let bindings = 0, releases = 0; let failBind = true, failRelease = true;
	try {
		const pending = await prepareMotionscaperDocumentOpen(f.session, f.file, 'selected.mscape', {
			bindOriginal: async id => { assert.equal(id, project.id); bindings++; if (failBind) throw new Error('Bind failed'); },
			release: async () => { releases++; if (failRelease) throw new Error('Release failed'); },
		});
		await assert.rejects(pending.open('import'), error => error instanceof MotionArchiveAdoptionError && error.receipt.projectId === project.id);
		assert.equal((await f.store.load(project.id))?.project.title, project.title); assert.equal(releases, 0);
		failBind = false; await assert.rejects(pending.open('copy'), /already accepted/iu);
		await assert.rejects(pending.open('import'), MotionArchiveAdoptionError); assert.equal(bindings, 2);
		failRelease = false; await pending.open('import'); assert.equal(bindings, 2); assert.equal(releases, 2);
		await pending.close(); assert.equal(releases, 2); assert.equal((await f.store.list()).length, 1);
	} finally { await f.session.dispose(); await f.store.close(); }
});
test('M02 reviewed Copy and Cancel leave the selected native original unbound and release its capability', async () => {
	const f = await fixture(); let binds = 0, releases = 0;
	try {
		await f.session.importArchive(f.file); const original = f.session.getSnapshot();
		const prepare = () => prepareMotionscaperDocumentOpen(f.session, f.file, 'selected.mscape', { bindOriginal: async () => { binds++; }, release: async () => { releases++; } });
		const cancelled = await prepare(); await cancelled.close(); assert.equal(f.session.getSnapshot().project, original.project);
		const copied = await prepare(); await copied.open('copy'); assert.notEqual(f.session.getSnapshot().project?.id, original.project?.id);
		assert.equal(binds, 0); assert.equal(releases, 2);
	} finally { await f.session.dispose(); await f.store.close(); }
});
