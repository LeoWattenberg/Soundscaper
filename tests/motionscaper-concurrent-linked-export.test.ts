/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { motionscaperSuccessorNativeFixture } from './helpers/motionscaper-successor-native-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperSuccessorNativeInput } from '../src/framescaper/editor-successor-native-input.ts';
import { normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';

test('M10 a compatible durable saved update preserves the active native export revision', async () => {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY });
	try {
		await controller.ready; const context = framescaperSuccessorControllerContext(controller);
		const first = motionscaperSuccessorNativeFixture(0), second = motionscaperSuccessorNativeFixture(1);
		const readAsset = async () => new Blob([first.bytes]);
		const received = await context.links.receive(createMotionCompositionOffer('main', first.revision), { readAsset });
		const active = context.nativeInput.begin();
		try {
			const updated = await context.links.receive(createMotionCompositionOffer('main', second.revision), { readAsset });
			assert.equal(updated.project.compositionLinks[0]!.acceptedDigest, second.revision.digest);
			assert.equal((await environment.owners.loadOwner(received.project.id))!.project.compositionLinks[0]!.acceptedDigest, second.revision.digest);
			assert.equal(active.signal.aborted, false, 'compatible acceptance must not abort the captured native export');
			active.assertCurrent();
			assert.equal((active.project.compositionLinks as { acceptedDigest: string }[])[0]!.acceptedDigest, first.revision.digest);
		} finally { await active.finish(); }
	} finally { await controller.dispose(); await environment.close(); }
});

async function fixture() {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY }); await controller.ready;
	const context = framescaperSuccessorControllerContext(controller), first = motionscaperSuccessorNativeFixture(0), second = motionscaperSuccessorNativeFixture(1);
	const readAsset = async () => new Blob([first.bytes]);
	const received = await context.links.receive(createMotionCompositionOffer('main', first.revision), { readAsset });
	return { environment, controller, context, first, second, readAsset, received, async close() { await controller.dispose(); await environment.close(); } };
}
for (const reason of ['same-owner-reopen', 'owner-switch', 'authored-replacement', 'disposal'] as const) test(`M10 captured native input still refuses ${reason} outside compatible adoption`, async () => {
	const f = await fixture(), active = f.context.nativeInput.begin();
	try {
		await active.prepare();
		if (reason === 'same-owner-reopen') await f.controller.actions.project.openById(f.received.project.id, { adoptSessionRevision: true });
		if (reason === 'owner-switch') await f.controller.actions.project.create();
		if (reason === 'authored-replacement') f.controller.actions.edit.commit({ type: 'project/rename', title: 'Unrelated authoring replacement' });
		if (reason === 'disposal') f.controller.beginDisposal();
		assert.throws(active.assertCurrent);
	} finally { await active.finish(); await f.close(); }
});
test('M10 native input bounds live leases and retires finished authority', async () => {
	const f = await fixture();
	try {
		const first = f.context.nativeInput.begin(); await first.prepare();
		assert.throws(() => f.context.nativeInput.begin(), /cleanup/iu); assert.equal(first.signal.aborted, true); assert.throws(first.assertCurrent);
		await first.finish(); await first.finish(); assert.throws(first.assertCurrent);
		const next = f.context.nativeInput.begin(); try { next.assertCurrent(); } finally { await next.finish(); }
	} finally { await f.close(); }
});
test('M10 native input refuses forged and reused saved-receipt adoption permits', async () => {
	const f = await fixture(); let adopted = 0;
	try {
		const authority = createFramescaperSuccessorNativeInput(f.controller, f.environment);
		const before = f.received.project;
		await assert.rejects(authority.adoptSavedRevision(before, { ...f.received, ownerDigest: 'f'.repeat(64) }, async () => { adopted++; }), /exact durable/iu);
		await assert.rejects(authority.adoptSavedRevision(before, f.received, async () => { adopted++; }), /exact durable/iu);
		const updated = await f.context.links.receive(createMotionCompositionOffer('main', f.second.revision), { readAsset: f.readAsset });
		await assert.rejects(authority.adoptSavedRevision(before, updated, async () => { adopted++; }), /exact durable/iu);
		assert.equal(adopted, 0);
	} finally { await f.close(); }
});
test('M10 captured PCM refuses an earlier revision request before preparing or writing', async () => {
	const f = await fixture(); let written = 0;
	try {
		const stale = f.environment.playback.projectForPlayback(f.received.project).project;
		await f.context.links.receive(createMotionCompositionOffer('main', f.second.revision), { readAsset: f.readAsset });
		const operation = f.context.nativeInput.begin();
		try { await assert.rejects(operation.renderAudioToSink!(stale, {}, () => { written++; }), /captured project/iu); assert.equal(written, 0); }
		finally { await operation.finish(); }
	} finally { await f.close(); }
});
test('M10 a failed committed revision adoption revokes its exact native export permit', async () => {
	const f = await fixture(), active = f.context.nativeInput.begin(), actions = f.controller.actions;
	try {
		const failure = new Error('Refused document adoption after durable receive');
		f.controller.actions = { ...actions, project: { ...actions.project, openById: async () => { throw failure; } } };
		await assert.rejects(f.context.links.receive(createMotionCompositionOffer('main', f.second.revision), { readAsset: f.readAsset }), error => error === failure);
		assert.equal((await f.environment.owners.loadOwner(f.received.project.id))!.project.compositionLinks[0]!.acceptedDigest, f.second.revision.digest);
		assert.equal(normalizeFramescaperSuccessorProject(f.controller.project).compositionLinks[0]!.acceptedDigest, f.first.revision.digest);
		assert.equal(active.signal.aborted, true); assert.throws(active.assertCurrent);
	} finally { f.controller.actions = actions; await active.finish(); await f.close(); }
});

test('M10 explicit native delivery cancellation aborts the independent captured inputs', async () => {
	const f = await fixture(), abort = new AbortController();
	try {
		const operation = f.context.nativeInput.begin({ signal: abort.signal });
		try {
			await operation.prepare(); const reason = new Error('Cancel captured delivery'); abort.abort(reason);
			assert.equal(operation.signal.aborted, true); assert.throws(operation.assertCurrent, error => error === reason);
		} finally { await operation.finish(); }
	} finally { await f.close(); }
});

test('M10 an idempotent same-session saved receive retains the exact active document and export', async () => {
	const f = await fixture(), active = f.context.nativeInput.begin(), identity = f.controller.project;
	try {
		assert.ok(Object.isFrozen(identity)); assert.equal(f.controller.project, identity);
		const repeated = await f.context.links.receive(createMotionCompositionOffer('main', f.first.revision), { readAsset: f.readAsset });
		assert.equal(repeated.history.undoStack.length, f.received.history.undoStack.length);
		assert.equal(active.signal.aborted, false); active.assertCurrent(); assert.equal(f.controller.project, identity);
	} finally { await active.finish(); await f.close(); }
});
