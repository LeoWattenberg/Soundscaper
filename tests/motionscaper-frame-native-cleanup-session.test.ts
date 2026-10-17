/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperNativeDeliverySession } from '../src/framescaper/editor-successor-native-delivery-session.ts';
import { createFramescaperSuccessorNativeSink } from '../src/framescaper/editor-successor-native-delivery-adapter.ts';
import { FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE, type FramescaperSuccessorNativeDelivery, type FramescaperSuccessorNativeReceipt } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
import { pendingMotionDeliveryCleanup } from '../src/common/editor/motion-delivery-cleanup.ts';
const plan = { identity: { projectId: 'frame', revisionDigest: 'a'.repeat(64), sequenceId: 'sequence' }, width: 2, height: 2, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: 1 };
const receipt: FramescaperSuccessorNativeReceipt = { identity: plan.identity, frameCount: 1, byteLength: 12, sha256: 'b'.repeat(64), name: 'Published.mov', profile: FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE, audio: null };
function fixture() {
	let failCommit = true, failCancel = true, begins = 0, cancellations = 0;
	const delivery: FramescaperSuccessorNativeDelivery = { getProfile: async () => FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE, begin: async () => { begins++; return { token: 'owned' }; }, write: async () => {}, commit: async () => { if (failCommit) throw new Error('Native commit fault'); return receipt; }, cancel: async () => { cancellations++; if (failCancel) throw new Error('Native cancel fault'); } };
	return { recover() { failCommit = false; failCancel = false; }, counts: () => ({ begins, cancellations }), async run(signal: AbortSignal) {
		const sink = await createFramescaperSuccessorNativeSink(delivery, { plan, inputEncoding: 'srgb', suggestedName: 'Output.mov', signal }); assert.ok(sink);
		try { await sink.writeRgba(0, new Uint8Array(16), signal); return await sink.finish(signal); }
		catch (error) { try { await sink.abort(error); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Frame native delivery and cleanup failed.', { cause: cleanup }); } throw error; }
	} };
}
test('Motion-linked Frame native session keeps failed commit and concrete cancellation capability until explicit retry succeeds', async () => {
	const native = fixture(), session = createFramescaperNativeDeliverySession(); await session.run(native.run);
	assert.equal(session.snapshot().cleanupRequired, true); assert.equal(session.canClose(), false); assert.equal(session.snapshot().receipt, null);
	const primary = session.snapshot().failure; assert.ok(primary instanceof AggregateError); assert.equal(pendingMotionDeliveryCleanup(primary).length, 1);
	await assert.rejects(session.run(native.run), /cleanup/iu); await assert.rejects(session.dispose(), /cleanup/iu); assert.equal(native.counts().begins, 1);
	await session.retryCleanup(); assert.equal(session.snapshot().cleanupRequired, true); assert.ok(session.snapshot().failure instanceof AggregateError); const before = native.counts().cancellations;
	native.recover(); await session.retryCleanup(); assert.equal(native.counts().cancellations, before + 1); assert.equal(session.snapshot().cleanupRequired, false); assert.equal(session.canClose(), true);
	await session.run(native.run); assert.equal(session.snapshot().receipt, receipt); assert.equal(native.counts().begins, 2); await session.dispose();
});
test('Motion-linked Frame session treats successful publication as authoritative after late cancellation', async () => {
	const session = createFramescaperNativeDeliverySession(); let publish!: () => void;
	const pending = session.run(async signal => { await new Promise<void>(resolve => { publish = resolve; }); assert.equal(signal.aborted, true); return receipt; });
	assert.equal(session.canClose(), false); await Promise.resolve(); session.cancel(); publish(); await pending;
	assert.equal(session.snapshot().receipt, receipt); assert.equal(session.snapshot().cancelled, false); assert.equal(session.canClose(), true);
});
test('Motion-linked Frame session disposal waits for active cancellation and does not publish a failed output', async () => {
	const session = createFramescaperNativeDeliverySession(); const snapshots: boolean[] = []; const unsubscribe = session.subscribe(() => { snapshots.push(session.snapshot().working); });
	const operation = session.run(signal => new Promise((_resolve, reject) => { signal.throwIfAborted(); signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true }); }));
	await session.dispose(); await operation; assert.equal(session.snapshot().receipt, null); assert.equal(session.snapshot().cancelled, true); assert.equal(session.canClose(), true); assert.deepEqual(snapshots, [true, false]); unsubscribe();
});

test('Motion-linked Frame session releases its pending slot after a synchronous preparation failure', async () => {
	const session = createFramescaperNativeDeliverySession(); await session.run(() => { throw new Error('Preparation failed'); }); assert.equal(session.canClose(), true); assert.equal(session.snapshot().working, false);
});
test('Motion-linked Frame disposal prevents a subscriber from restarting native work while the owner is closing', async () => {
	const session = createFramescaperNativeDeliverySession(); let attempted = false, restarted = 0, rejection: Promise<void> | null = null;
	session.subscribe(() => { if (!session.snapshot().working && !attempted) { attempted = true; rejection = assert.rejects(session.run(async () => { restarted++; return receipt; }), /closed/iu); } });
	const active = session.run(signal => new Promise((_resolve, reject) => { signal.throwIfAborted(); signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true }); }));
	await session.dispose(); await active; await rejection; assert.equal(restarted, 0);
});
