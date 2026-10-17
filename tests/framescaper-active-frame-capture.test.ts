/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withFramescaperActiveFrameCapturesV1 } from '../src/framescaper/selected-finishing-active-frame-capture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const frame = (byte: number) => ({ width: 1, height: 1, pixels: new Uint8Array([byte, 91, 32, 127]) });
const outcome = <Value>(work: Promise<Value>) => work.then(value => ({ failed: false as const, value }),
	(error: unknown) => ({ failed: true as const, error }));

test('every admitted live surface is captured synchronously before the resource consumer, with independent snapshots', async () => {
	const first = frame(64), second = frame(128), entered = deferred<void>(), held = deferred<void>();
	const entries = [{ id: 'first' }, { id: 'second' }], calls: string[] = []; let owned: readonly Uint8Array[] = [];
	const work = withFramescaperActiveFrameCapturesV1(entries, entry => {
		calls.push(entry.id); return entry.id === 'first' ? first : second;
	}, new AbortController().signal, async captures => {
		assert.deepEqual(calls, ['first', 'second']); owned = captures.map(value => value.pixels);
		entered.resolve(); await held.promise; return captures.map(value => Array.from(value.pixels));
	});
	assert.deepEqual(calls, ['first', 'second']); first.pixels.fill(255); second.pixels.fill(255);
	await entered.promise; assert.equal(await remainsPending(work), true); held.resolve();
	assert.deepEqual(await work, [[64, 91, 32, 127], [128, 91, 32, 127]]);
	assert.ok(owned.every(bytes => bytes.every(value => value === 0)));
	assert.ok(first.pixels.every(value => value === 255)); assert.ok(second.pixels.every(value => value === 255));
});

test('failed or cancelled capture joins every started callback and wipes accepted snapshots without opaque inspection', async () => {
	const started = deferred<void>(), held = deferred<void>(), stop = new AbortController(); let traps = 0, delivered = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const input = frame(64), before = input.pixels.slice(); let joined = false;
	const work = outcome(withFramescaperActiveFrameCapturesV1([{ id: 0 }, { id: 1 }], async entry => {
		if (entry.id === 0) return input;
		started.resolve(); await held.promise; joined = true; throw reason;
	}, stop.signal, () => { delivered++; }));
	await started.promise; stop.abort(reason); assert.equal(await remainsPending(work), true);
	held.resolve(); const result = await work; assert.equal(result.failed, true); if (result.failed) assert.equal(result.error, reason);
	assert.equal(joined, true); assert.equal(delivered, 0); assert.equal(traps, 0); assert.deepEqual(input.pixels, before);
});

test('cold cancellation precedes callback admission and byte shadows cannot replace the native snapshot', async () => {
	const stop = new AbortController(), reason = Object.freeze({ cold: true }); stop.abort(reason); let calls = 0;
	const failed = await outcome(withFramescaperActiveFrameCapturesV1([{}], () => { calls++; return frame(1); }, stop.signal, () => undefined));
	assert.equal(failed.failed, true); if (failed.failed) assert.equal(failed.error, reason); assert.equal(calls, 0);
	const input = frame(64); Object.defineProperty(input.pixels, 'slice', { get() { assert.fail('borrowed slice'); } });
	await withFramescaperActiveFrameCapturesV1([{}], () => input, new AbortController().signal,
		captures => assert.deepEqual(Array.from(captures[0]!.pixels), [64, 91, 32, 127]));
});
