/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperDeliveryQueue } from '../src/motionscaper/editor-delivery-queue.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import type { MotionDeliveryOptions } from '../src/motionscaper/editor-render-delivery.ts';

const project = createMotionscaperProject({ id: 'queued-project', title: 'Queued project', compositionId: 'composition', width: 2, height: 2, durationFrames: 2 });
const intent = { project, compositionId: 'composition', firstFrame: 0, endFrame: 2, format: 'png' as const };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

test('delivery queue pins revisions and serializes preparation through one shared render queue', async () => {
	const gate = deferred(); const calls: MotionDeliveryOptions[] = [];
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async options => { calls.push(options); if (calls.length === 1) await gate.promise; options.onProgress(2, 2); return new Blob(['result']); } });
	const a = queue.enqueue(intent); const b = queue.enqueue({ ...intent, project: { ...project, title: 'Later revision', revision: 1 } });
	await Promise.resolve(); assert.equal(calls.length, 1); assert.deepEqual(queue.snapshot().map(job => job.status), ['rendering', 'queued']);
	gate.resolve(); await Promise.all([a.completion, b.completion]);
	assert.equal(calls[0]!.project.title, 'Queued project'); assert.equal(calls[1]!.project.title, 'Later revision');
	assert.equal(calls[0]!.queue, calls[1]!.queue); assert.ok(calls[0]!.queue); assert.notEqual(queue.snapshot()[0]!.revisionDigest, queue.snapshot()[1]!.revisionDigest);
	assert.deepEqual(queue.snapshot().map(job => job.completed), [2, 2]); await queue.dispose();
});

test('queued cancellation aborts its destination immediately, then retry retains original intent', async () => {
	const gate = deferred(); let aborted = 0; const titles: string[] = [];
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async options => { titles.push(options.project.title); if (titles.length === 1) await gate.promise; return new Blob(['ok']); } });
	const first = queue.enqueue(intent); const second = queue.enqueue({ ...intent, writable: new WritableStream({ abort() { aborted += 1; } }) });
	await queue.cancel(second.id); assert.equal(aborted, 1); assert.equal(queue.snapshot()[1]!.status, 'cancelled'); await assert.rejects(second.completion, /cancelled/);
	const retry = queue.retry(second.id); gate.resolve(); await Promise.all([first.completion, retry.completion]);
	assert.deepEqual(titles, ['Queued project', 'Queued project']); assert.equal(queue.snapshot()[1]!.attempt, 2); await queue.dispose();
});

test('queue admissions bound job count and retained Blob bytes without evicting completed output', async () => {
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, maximumJobs: 2, maximumOutputBytes: 4, maximumJobOutputBytes: 4,
		deliver: async options => { assert.ok(options.maximumBlobBytes! <= 4); return new Blob(['1234']); } });
	const first = queue.enqueue(intent); await first.completion;
	const second = queue.enqueue(intent); await assert.rejects(second.completion, /output.*limit/i);
	assert.equal(queue.output(first.id)?.size, 4); assert.equal(queue.snapshot()[1]!.status, 'failed'); assert.throws(() => queue.enqueue(intent), /full/);
	queue.remove(first.id); assert.equal(queue.output(first.id), null); const retry = queue.retry(second.id); await retry.completion;
	assert.equal(queue.output(second.id)?.size, 4); await queue.dispose();
});

test('queue disposal cancels active work and waits for cleanup before completing', async () => {
	const entered = deferred(); const cleanup = deferred(); let released = false;
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async options => {
		entered.resolve(); await new Promise<void>(resolve => { options.signal.addEventListener('abort', () => resolve(), { once: true }); });
		await cleanup.promise; released = true; options.signal.throwIfAborted(); return null;
	} });
	const job = queue.enqueue(intent); await entered.promise; const closing = queue.dispose();
	await Promise.resolve(); assert.equal(released, false); assert.throws(() => queue.enqueue(intent), /closed/); cleanup.resolve();
	await closing; await assert.rejects(job.completion); assert.equal(released, true); assert.equal(queue.snapshot().length, 0);
});

test('queued destination cleanup failure remains reviewable and cannot be removed or retried as a new job', async () => {
	const gate = deferred(); const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async () => { await gate.promise; return null; } });
	const active = queue.enqueue(intent); const job = queue.enqueue({ ...intent, writable: new WritableStream({ abort() { throw new Error('Destination cleanup failed'); } }) });
	await assert.rejects(queue.cancel(job.id), /Destination cleanup failed/); await assert.rejects(job.completion, /Destination cleanup failed/);
	assert.equal(queue.snapshot()[1]!.cleanupRequired, true); assert.throws(() => queue.remove(job.id)); assert.throws(() => queue.retry(job.id));
	await queue.cancel(job.id); assert.equal(queue.snapshot()[1]!.cleanupRequired, false); queue.remove(job.id);
	gate.resolve(); await active.completion; await queue.dispose(); assert.equal(queue.snapshot().length, 0);
});

test('successful output publication wins over a late cancellation and metadata admission is bounded', async () => {
	const entered = deferred(); const queue = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, deliver: async options => {
		entered.resolve(); await new Promise<void>(resolve => { options.signal.addEventListener('abort', () => resolve(), { once: true }); }); return new Blob(['committed']);
	} });
	const job = queue.enqueue(intent); await entered.promise; await queue.cancel(job.id); assert.equal(queue.snapshot()[0]!.status, 'completed'); assert.equal((await job.completion as Blob).size, 9); await queue.dispose();
	const bounded = createMotionscaperDeliveryQueue({ store: { readAsset: async () => null }, maximumIntentBytes: 10 });
	assert.throws(() => bounded.enqueue(intent), /intent memory limit/); assert.equal(bounded.snapshot().length, 0); await bounded.dispose();
});
