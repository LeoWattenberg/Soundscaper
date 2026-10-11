/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController } from '../src/framescaper/editor-successor-controller.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';
test('successor controller creates and reopens an actual canonical owner in the shared timeline editor', async () => {
	const factory = createInstrumentedIndexedDB();
	const env = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(env, { locale: 'en', copy: COPY });
	try {
		await controller.ready; assert.equal(controller.project?.schemaVersion, 2); assert.equal((await env.owners.listOwners()).length, 1);
		const id = controller.project!.id;
		controller.actions.edit.commit({ type: 'project/rename', title: 'Saved successor' }); await controller.actions.project.flush();
		assert.equal((await env.owners.loadOwner(id))?.project.title, 'Saved successor');
		assert.equal((await env.owners.loadOwner(id))?.history.undoStack.length, 1);
		await controller.actions.project.openById(id, { adoptSessionRevision: true });
		assert.equal(controller.project?.title, 'Saved successor'); assert.equal(controller.project?.schemaVersion, 2);
	} 
	finally { await controller.dispose(); await env.close(); }
});
