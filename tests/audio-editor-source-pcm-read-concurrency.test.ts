/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourcePcmReadSession, SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME } from '../src/common/editor/storage/source-pcm-read-session.ts';

function fixture(maximumConcurrentReads = 2) {
	const pending = new Map<number, Readonly<{ resolve(): void; reject(error: unknown): void }>>();
	const started: number[] = [];
	let active = 0;
	let peakActive = 0;
	let releases = 0;
	const session = createSourcePcmReadSession({
		maximumConcurrentReads,
		async readChunk(index, signal) {
			started.push(index);
			active += 1;
			peakActive = Math.max(peakActive, active);
			try {
				await new Promise<void>((resolve, reject) => {
					const onAbort = () => { reject(Object.assign(new Error('backend abort'), { name: 'AbortError' })); };
					signal?.addEventListener('abort', onAbort, { once: true });
					pending.set(index, {
						resolve() { signal?.removeEventListener('abort', onAbort); resolve(); },
						reject(error) { signal?.removeEventListener('abort', onAbort); reject(error); },
					});
				});
				return { index, frames: 1, channels: [Float32Array.of(index)] };
			} finally { active -= 1; pending.delete(index); }
		},
		async release() { assert.equal(active, 0, 'backend cleanup waits for every admitted read'); releases += 1; },
		onRelease() {},
	});
	return { session, started, finish: (index: number) => pending.get(index)!.resolve(),
		fail: (index: number, error: unknown) => pending.get(index)!.reject(error),
		counts: () => ({ active, peakActive, releases }) };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('an admitted positional source session overlaps at most two requested packets', async () => {
	const f = fixture();
	const reads = Array.from({ length: 6 }, (_, index) => f.session.chunk(index));
	const finished = Promise.all(reads);
	await turn();
	assert.deepEqual(f.started, [0, 1]);
	for (let index = 0; index < 6; index += 1) { f.finish(index); await turn(); }
	assert.deepEqual((await finished).map((chunk) => chunk.index), [0, 1, 2, 3, 4, 5]);
	await f.session.release();
	assert.deepEqual(f.counts(), { active: 0, peakActive: 2, releases: 1 });
});

test('serial backends keep one read active and reject unsupported concurrency', async () => {
	const f = fixture(1);
	const first = f.session.chunk(0);
	const second = f.session.chunk(1);
	await turn();
	assert.deepEqual(f.started, [0]);
	f.finish(0);
	await first;
	await turn();
	assert.deepEqual(f.started, [0, 1]);
	f.finish(1);
	await second;
	await f.session.release();
	assert.equal(f.counts().peakActive, 1);
	assert.throws(() => fixture(3), RangeError);
});

test('one concurrent packet cancellation leaves its peer and later requests usable', async () => {
	const f = fixture();
	const abort = new AbortController();
	const reason = new Error('withdraw just packet0');
	const cancelled = assert.rejects(f.session.chunk(0, { signal: abort.signal }), (error) => error === reason);
	const second = f.session.chunk(1);
	await turn();
	abort.abort(reason);
	await cancelled;
	const third = f.session.chunk(2);
	await turn();
	assert.deepEqual(f.started, [0, 1, 2]);
	f.finish(1);
	f.finish(2);
	await Promise.all([second, third]);
	await f.session.release();
	assert.deepEqual(f.counts(), { active: 0, peakActive: 2, releases: 1 });
});

test('concurrent session release aborts both reads, drains queued work and cleans up once', async () => {
	const f = fixture();
	const results = Promise.allSettled([f.session.chunk(0), f.session.chunk(1), f.session.chunk(2)]);
	await turn();
	const release = f.session.release();
	assert.equal(f.session.release(), release);
	await release;
	for (const result of await results) {
		assert.equal(result.status, 'rejected');
		if (result.status === 'rejected') assert.equal((result.reason as Error).name, SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME);
	}
	assert.deepEqual(f.started, [0, 1]);
	assert.deepEqual(f.counts(), { active: 0, peakActive: 2, releases: 1 });
});

test('a positional read failure fences its concurrent peer with the primary failure', async () => {
	const f = fixture();
	const failure = new Error('the immutable packet failed CRC');
	const results = Promise.allSettled([f.session.chunk(0), f.session.chunk(1)]);
	await turn();
	f.fail(0, failure);
	for (const result of await results) {
		assert.equal(result.status, 'rejected');
		if (result.status === 'rejected') assert.equal(result.reason, failure);
	}
	await f.session.release();
	assert.deepEqual(f.counts(), { active: 0, peakActive: 2, releases: 1 });
});
