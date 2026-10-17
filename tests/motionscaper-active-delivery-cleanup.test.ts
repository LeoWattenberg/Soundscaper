/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperDeliveryQueue } from '../src/motionscaper/editor-delivery-queue.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { createMotionscaperDesktopProresSink } from '../src/motionscaper/desktop-delivery-adapter.ts';
import { MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import type { MotionDeliveryOptions } from '../src/motionscaper/editor-render-delivery.ts';
import { MotionDeliveryCleanupFailure, pendingMotionDeliveryCleanup } from '../src/common/editor/motion-delivery-cleanup.ts';

const project = createMotionscaperProject({ id: 'cleanup-project', title: 'Cleanup', compositionId: 'main', width: 2, height: 2, durationFrames: 1 });
const intent = { project, compositionId: 'main', firstFrame: 0, endFrame: 1, format: 'prores' as const };
function nativeFixture(startupFailure = false) {
	let cleanupFails = true; let publicationFails = true; let begins = 0; let cancellations = 0; let commits = 0;
	const identity = { projectId: project.id, revisionDigest: createMotionscaperRevision(project).digest, compositionId: 'main' };
	const delivery: MotionDesktopDelivery = {
		getProfile: () => Promise.resolve(MOTION_PRORES_DELIVERY_PROFILE), begin: () => Promise.resolve({ token: `chosen-${++begins}` }),
		write: () => startupFailure ? Promise.reject(new Error('Native header failed')) : Promise.resolve(),
		commit: ({ byteLength, sha256 }) => { commits++; return publicationFails ? Promise.reject(new Error('Native publication failed')) : Promise.resolve({ identity, name: 'Cleanup.mov', byteLength, sha256, frameCount: 1, profile: MOTION_PRORES_DELIVERY_PROFILE, audio: null }); },
		cancel: () => { cancellations++; return cleanupFails ? Promise.reject(new Error('Native cleanup unavailable')) : Promise.resolve(); },
	};
	const deliver = async (options: MotionDeliveryOptions) => {
		const sink = await createMotionscaperDesktopProresSink(delivery, { plan: { identity, width: 2, height: 2, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: 1 }, suggestedName: 'Cleanup.mov', signal: options.signal });
		assert.ok(sink); await sink.write({ index: 0, time: { num: 0, den: 1 }, duration: { num: 1, den: 30 }, surface: { ...createMotionSurface(2, 2), consumedOperationIds: [] } });
		return sink.finish();
	};
	return { deliver, recoverCleanup() { cleanupFails = false; }, recoverPublication() { publicationFails = false; }, counts: () => ({ begins, cancellations, commits }) };
}

for (const startupFailure of [false, true]) test(`active native ${startupFailure ? 'header' : 'publication'} failure retains cleanup authority before retry or removal`, async () => {
	const native = nativeFixture(startupFailure); const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: native.deliver });
	const job = queue.enqueue(intent); await assert.rejects(job.completion, /cancellation failed/u);
	assert.equal(queue.snapshot()[0]!.cleanupRequired, true);
	assert.throws(() => queue.retry(job.id)); assert.throws(() => queue.remove(job.id));
	await assert.rejects(queue.cancel(job.id), /Native cleanup unavailable/u);
	assert.equal(queue.snapshot()[0]!.cleanupRequired, true); const beforeRecovery = native.counts().cancellations;
	native.recoverCleanup(); await queue.cancel(job.id); assert.equal(native.counts().cancellations, beforeRecovery + 1);
	assert.equal(queue.snapshot()[0]!.cleanupRequired, false);
	if (!startupFailure) { native.recoverPublication(); const retry = queue.retry(job.id); await retry.completion; assert.equal(native.counts().begins, 2); assert.equal(queue.snapshot()[0]!.attempt, 2); }
	else queue.remove(job.id);
	await queue.dispose();
});

test('failed queue disposal keeps native cleanup authority and can finish after the destination recovers', async () => {
	const native = nativeFixture(); const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: native.deliver });
	const job = queue.enqueue(intent); await assert.rejects(job.completion);
	await assert.rejects(queue.dispose(), /queue cleanup failed/u); assert.equal(queue.snapshot().length, 1); assert.equal(queue.snapshot()[0]!.cleanupRequired, true);
	native.recoverCleanup(); await queue.dispose(); assert.equal(queue.snapshot().length, 0);
});

test('active cancellation waits for cleanup and refuses disposal while native authority remains live', async () => {
	let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let cleanupFails = true;
	const cleanup = new MotionDeliveryCleanupFailure([new Error('Native cleanup unavailable')], 'Cancellation cleanup failed', () => cleanupFails ? Promise.reject(new Error('Native cleanup unavailable')) : Promise.resolve());
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async options => {
		entered(); await new Promise<void>(resolve => { options.signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
		throw new AggregateError([options.signal.reason, new AggregateError([cleanup], 'Pipeline cleanup failed')], 'Delivery failed');
	} });
	const job = queue.enqueue(intent); await started; await assert.rejects(queue.dispose(), /queue cleanup failed/u); await assert.rejects(job.completion);
	assert.equal(queue.snapshot()[0]!.cleanupRequired, true); cleanupFails = false; await queue.dispose(); assert.equal(queue.snapshot().length, 0);
});

test('cleanup retries coalesce, nested aggregates retain one owner and completed cleanup cannot block a new attempt', async () => {
	let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
	const cleanup = new MotionDeliveryCleanupFailure([], 'Cleanup failed', async () => { calls++; await gate; });
	const aggregate = new AggregateError([cleanup, new AggregateError([cleanup], 'Nested')], 'Delivery failed');
	assert.deepEqual(pendingMotionDeliveryCleanup(aggregate), [cleanup]);
	const first = cleanup.retryCleanup(); const second = cleanup.retryCleanup(); assert.equal(first, second);
	await Promise.resolve(); assert.equal(calls, 1); release(); await first; assert.deepEqual(pendingMotionDeliveryCleanup(aggregate), []);
});
