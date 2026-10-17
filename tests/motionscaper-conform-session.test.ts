/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';

async function fixture() {
	const factory = createInstrumentedIndexedDB(), environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY }); await controller.ready;
	const links = framescaperSuccessorControllerContext(controller).links;
	const project = createMotionscaperProject({ id: 'source', title: 'Saved source', compositionId: 'main', width: 64, height: 64, durationFrames: 30 });
	const offer = (revision: number, duration: number) => createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, revision, compositions: project.compositions.map(composition => ({ ...composition, durationFrames: duration })) }));
	const first = await links.receive(offer(0, 30), { readAsset: async () => null }); const sourceId = first.project.compositionLinks[0]!.sourceId;
	return { factory, environment, controller, links, sourceId, offer, first, async close() { await controller.dispose(); await environment.close(); } };
}
test('Conform review leaves accepted intent unchanged and publishes one reviewed atomic undo step', async () => {
	const f = await fixture();
	try {
		await f.links.receive(f.offer(1, 15), { readAsset: async () => null }); const review = await f.links.reviewConform(f.sourceId);
		assert.equal(review.changes.length, 2); assert.ok(review.changes.every(change => change.clamped));
		assert.equal((await f.environment.owners.loadOwner(f.first.project.id))?.project.compositionLinks[0]?.acceptedDigest, f.first.project.compositionLinks[0]?.acceptedDigest);
		f.factory.failNextPutForStore('owners', new Error('Reviewed owner publication failed'));
		await assert.rejects(f.links.applyConform(review), /publication|transaction/iu);
		assert.equal((await f.environment.owners.loadOwner(f.first.project.id))?.project.compositionLinks[0]?.acceptedDigest, review.acceptedDigest);
		const applied = await f.links.applyConform(review); assert.equal(applied.project.compositionLinks[0]?.acceptedDigest, review.pendingDigest);
		assert.equal(applied.history.undoStack.length, f.first.history.undoStack.length + 1);
		await f.controller.actions.edit.undo(); const restored = (await f.environment.owners.loadOwner(f.first.project.id))!;
		assert.equal(restored.project.compositionLinks[0]?.acceptedDigest, review.acceptedDigest); assert.equal(restored.linkStates[0]?.state.paused, true);
	} finally { await f.close(); }
});
test('Conform refuses a stale review after pending revision or authored project changes', async () => {
	const f = await fixture();
	try {
		await f.links.receive(f.offer(1, 15), { readAsset: async () => null }); const first = await f.links.reviewConform(f.sourceId);
		await f.links.receive(f.offer(2, 12), { readAsset: async () => null }); await assert.rejects(f.links.applyConform(first), /stale/iu);
		const second = await f.links.reviewConform(f.sourceId); f.controller.actions.edit.commit({ type: 'project/rename', title: 'Edited while reviewing' });
		await assert.rejects(f.links.applyConform(second), /stale/iu);
		assert.equal((await f.environment.owners.loadOwner(f.first.project.id))?.project.compositionLinks[0]?.acceptedDigest, first.acceptedDigest);
	} finally { await f.close(); }
});
