/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperCompositionLinkSession } from '../src/framescaper/editor-composition-link-session.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
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

test('successor session receives one saved update, atomically undoes its revision, and resumes the retained latest state', async () => {
	const factory = createInstrumentedIndexedDB(); const env = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(env, { locale: 'en', copy: COPY });
	const service = createFramescaperCompositionLinkSession({ controller, ...framescaperSuccessorControllerContext(controller) });
	try {
		await controller.ready; const project = createMotionscaperProject({ id: 'sender', title: 'Sender', compositionId: 'main', width: 2, height: 2, durationFrames: 2 });
		const first = createMotionCompositionOffer('main', createMotionscaperRevision(project));
		const received = await service.receive(first, { readAsset: async () => null });
		assert.equal(received.project.compositionLinks.length, 1); assert.equal(received.history.undoStack.length, 1);
		const next = createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, revision: 1, title: 'Saved revision' }));
		factory.failNextPutForStore('owners', new Error('owner publication failed'));
		await assert.rejects(service.receive(next, { readAsset: async () => null }), /publication|transaction/iu);
		assert.equal((await env.owners.loadOwner(received.project.id))?.project.compositionLinks[0]?.acceptedDigest, first.revision.digest);
		assert.equal(framescaperSuccessorControllerContext(controller).session.getProjectHistory(received.project.id).undoStack.length, 1);
		const updated = await service.receive(next, { readAsset: async () => null }); assert.equal(updated.project.compositionLinks[0]?.acceptedDigest, next.revision.digest);
		factory.failNextPutForStore('owners', new Error('history publication failed'));
		await assert.rejects(Promise.resolve(controller.actions.edit.undo()), /publication|transaction/iu);
		assert.equal((await env.owners.loadOwner(received.project.id))?.project.compositionLinks[0]?.acceptedDigest, next.revision.digest);
		assert.equal(framescaperSuccessorControllerContext(controller).session.getProjectHistory(received.project.id).present.compositionLinks[0]?.acceptedDigest, next.revision.digest);
		await controller.actions.edit.undo(); const undone = (await env.owners.loadOwner(received.project.id))!; assert.equal(undone.project.compositionLinks[0]?.acceptedDigest, first.revision.digest); assert.equal(undone.linkStates[0]?.state.paused, true);
		const resumed = await service.transition(undone.project.compositionLinks[0]!.sourceId, 'resume'); assert.equal(resumed.project.compositionLinks[0]?.acceptedDigest, next.revision.digest); assert.equal(resumed.linkStates[0]?.state.paused, false);
		assert.equal(controller.project?.schemaVersion, 2);
	} finally { await controller.dispose(); await env.close(); }
});
