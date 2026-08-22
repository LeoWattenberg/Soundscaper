/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NativeMediaHelperPool,
	NativeMediaHelperPoolError,
	type NativeMediaHelperPoolJobRequest,
	type NativeMediaHelperWorkerPort,
} from '../desktop/native-media-helper-pool.ts';

test('the media helper pool defaults to two workers and never overlaps jobs on one worker', async () => {
	const harness = poolHarness();
	const first = harness.pool.runJob(request('media-decode'));
	const second = harness.pool.runJob(request('media-render'));
	const third = harness.pool.runJob(request('media-proxy'));

	await tick();
	assert.equal(harness.workers.length, 2);
	assert.deepEqual(harness.workers.map((worker) => worker.maximumActive), [1, 1]);
	assert.equal(harness.pool.snapshot().activeJobs, 2);
	assert.equal(harness.pool.snapshot().queuedJobs, 1);

	harness.workers[0]!.settleNext({ worker: 0 });
	assert.deepEqual(await first, { worker: 0 });
	await tick();
	assert.equal(harness.workers[0]!.calls.length, 2);
	assert.equal(harness.workers[0]!.maximumActive, 1);

	harness.workers[1]!.settleNext({ worker: 1 });
	harness.workers[0]!.settleNext({ worker: 0, third: true });
	assert.deepEqual(await second, { worker: 1 });
	assert.deepEqual(await third, { worker: 0, third: true });
	assert.equal(harness.pool.snapshot().activeJobs, 0);
});

test('pool size is closed to one through four with a default of two', () => {
	for (const size of [1, 2, 3, 4]) {
		const harness = poolHarness(size);
		assert.equal(harness.pool.snapshot().configuredWorkers, size);
		harness.pool.dispose();
	}
	for (const size of [0, 5, 1.5]) {
		assert.throws(() => poolHarness(size), /between one and four/u);
	}
});

test('only probe and the four closed media operations enter the pool', async () => {
	const harness = poolHarness(1);
	for (const kind of [
		'probe-video-source', 'media-decode', 'media-encode', 'media-render', 'media-proxy',
	] as const) {
		const result = harness.pool.runJob(request(kind));
		await tick();
		harness.workers[0]!.settleNext(kind);
		assert.equal(await result, kind);
	}
	await assert.rejects(
		harness.pool.runJob(request('ofx-host' as never)),
		(error: unknown) => poolCause(error) === 'unsupported-operation',
	);
});

test('a queued abort never reaches a worker and cancellation remains typed', async () => {
	const harness = poolHarness(1);
	const running = harness.pool.runJob(request('media-render'));
	const abort = new AbortController();
	const queued = harness.pool.runJob(request('media-encode', abort.signal));
	await tick();
	abort.abort();
	await assert.rejects(queued, (error: unknown) => poolCause(error) === 'cancelled');
	assert.equal(harness.workers[0]!.calls.length, 1);
	harness.workers[0]!.settleNext('done');
	assert.equal(await running, 'done');
});

test('every worker self-tests before its first job and a failed worker is quarantined', async () => {
	const selfTests: number[] = [];
	const harness = poolHarness(2, async (_worker, index) => {
		selfTests.push(index);
		if (index === 0) throw new Error('bad FFmpeg linkage');
	});
	const failed = harness.pool.runJob(request('media-decode'));
	const healthy = harness.pool.runJob(request('media-render'));

	await assert.rejects(failed, (error: unknown) => poolCause(error) === 'self-test-failed');
	await tick();
	harness.workers[1]!.settleNext('healthy');
	assert.equal(await healthy, 'healthy');
	assert.deepEqual(selfTests.sort(), [0, 1]);
	assert.equal(harness.pool.snapshot().quarantinedWorkers, 1);
	assert.equal(harness.workers[0]!.calls.length, 0);

	harness.pool.clearQuarantine(0);
	assert.equal(harness.workers[0]!.cleared, 1);
	assert.equal(harness.pool.snapshot().quarantinedWorkers, 0);
});

test('disposing the pool rejects queued work and disposes every supervisor', async () => {
	const harness = poolHarness(1);
	const running = harness.pool.runJob(request('media-render'));
	const queued = harness.pool.runJob(request('media-proxy'));
	await tick();
	harness.pool.dispose();
	await assert.rejects(queued, (error: unknown) => poolCause(error) === 'disposed');
	await assert.rejects(running, /worker disposed/u);
	assert.equal(harness.workers[0]!.disposed, 1);
	await assert.rejects(
		harness.pool.runJob(request('media-decode')),
		(error: unknown) => poolCause(error) === 'disposed',
	);
});

function poolHarness(
	size?: number,
	selfTest: (worker: NativeMediaHelperWorkerPort, index: number) => Promise<void> = async () => undefined,
) {
	const workers: FakeWorker[] = [];
	const pool = new NativeMediaHelperPool({
		...(size === undefined ? {} : { size }),
		createWorker(index) {
			const worker = new FakeWorker(index);
			workers.push(worker);
			return worker;
		},
		selfTest,
	});
	return { pool, workers };
}

class FakeWorker implements NativeMediaHelperWorkerPort {
	readonly calls: NativeMediaHelperPoolJobRequest[] = [];
	maximumActive = 0;
	cleared = 0;
	disposed = 0;
	#active = 0;
	#pending: Array<Readonly<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>> = [];

	constructor(readonly index: number) {}

	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> {
		if (this.disposed > 0) return Promise.reject(new Error('worker disposed'));
		this.calls.push(request);
		this.#active += 1;
		this.maximumActive = Math.max(this.maximumActive, this.#active);
		return new Promise((resolve, reject) => {
			this.#pending.push({
				resolve: (value) => { this.#active -= 1; resolve(value); },
				reject: (error) => { this.#active -= 1; reject(error); },
			});
		});
	}

	snapshot() {
		return { state: this.#active > 0 ? 'busy' as const : 'ready' as const, recentCrashes: 0, quarantined: false };
	}

	clearQuarantine(): void { this.cleared += 1; }

	dispose(): void {
		this.disposed += 1;
		for (const pending of this.#pending.splice(0)) pending.reject(new Error('worker disposed'));
	}

	settleNext(value: unknown): void {
		const pending = this.#pending.shift();
		assert.ok(pending, `worker ${this.index} has no pending job`);
		pending.resolve(value);
	}
}

function request(
	kind: NativeMediaHelperPoolJobRequest['kind'],
	signal?: AbortSignal,
): NativeMediaHelperPoolJobRequest {
	return { kind, grant: {} as never, ...(signal ? { signal } : {}) };
}

function poolCause(error: unknown): string | null {
	return error instanceof NativeMediaHelperPoolError ? error.cause_ : null;
}

function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
