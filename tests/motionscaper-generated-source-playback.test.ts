/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeneratedSourcePlayback } from '../src/common/editor/controller/composition/product-generated-source-playback.ts';
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function clock() {
	let now = 0; const tasks = new Map<object, () => void>();
	return { now: () => now, schedule(callback: () => void) { const token = {}; tasks.set(token, callback); return token; }, cancel(token: unknown) { tasks.delete(token as object); },
		advance(milliseconds: number) { now = milliseconds; const callbacks = [...tasks.values()]; tasks.clear(); for (const callback of callbacks) callback(); }, size: () => tasks.size };
}
test('M10 generated playback follows exact NTSC ordinals, skips late frames and ends at the last retained frame', async () => {
	const timer = clock(), rendered: number[] = [], painted: number[] = [];
	const playback = createGeneratedSourcePlayback({ frameRate: { num: 30000, den: 1001 }, frameCount: 8, clock: timer,
		render: frame => { rendered.push(frame); return Promise.resolve(frame); }, present: (_, frame) => painted.push(frame) });
	playback.play(1); await settle(); assert.deepEqual(painted, [1]);
	timer.advance(33.366); await settle(); assert.deepEqual(painted, [1]);
	timer.advance(33.367); await settle(); assert.deepEqual(painted, [1, 2]);
	timer.advance(167); await settle(); assert.deepEqual(painted, [1, 2, 6]);
	timer.advance(1000); await settle(); assert.deepEqual(painted, [1, 2, 6, 7]); assert.deepEqual(rendered, painted);
	assert.equal(playback.snapshot().playing, false); assert.equal(timer.size(), 0); await playback.dispose();
});
test('M10 latest seeks stay bounded behind one pending render and cancelled results never paint', async () => {
	const pending: { frame: number; signal: AbortSignal; resolve(value: number): void }[] = [], painted: number[] = [];
	const playback = createGeneratedSourcePlayback({ frameRate: { num: 24, den: 1 }, frameCount: 100,
		render: (frame, signal) => new Promise<number>(resolve => pending.push({ frame, signal, resolve })), present: (_, frame) => painted.push(frame) });
	playback.seek(0); await settle(); for (let frame = 1; frame < 100; frame++) playback.seek(frame);
	assert.equal(pending.length, 1); assert.equal(pending[0]!.signal.aborted, true); assert.equal(playback.snapshot().pendingFrames, 2);
	pending.shift()!.resolve(0); await settle(); assert.equal(pending.length, 1); assert.equal(pending[0]!.frame, 99); assert.deepEqual(painted, []);
	pending.shift()!.resolve(99); await settle(); assert.deepEqual(painted, [99]); assert.equal(playback.snapshot().pendingFrames, 0);
	playback.seek(99); await settle(); assert.equal(pending.length, 0); await playback.dispose();
});
test('M10 Pause holds last painted ordinal, disposal waits for cancellation and render failure remains retryable', async () => {
	const timer = clock(), painted: number[] = [], errors: unknown[] = []; let fail = true;
	const playback = createGeneratedSourcePlayback({ frameRate: { num: 30, den: 1 }, frameCount: 20, clock: timer,
		render: frame => fail ? Promise.reject(new Error('Raster unavailable')) : Promise.resolve(frame), present: (_, frame) => painted.push(frame), onError: error => errors.push(error) });
	playback.play(0); await settle(); assert.equal(errors.length, 1); assert.equal(playback.snapshot().playing, false); assert.equal(timer.size(), 0);
	fail = false; playback.play(3); await settle(); playback.pause(); timer.advance(3000); await settle(); assert.deepEqual(painted, [3]);
	assert.equal(playback.snapshot().sourceFrame, 3); await playback.dispose(); assert.throws(() => playback.play(0), /disposed/iu);
	let release!: (value: number) => void; let signal!: AbortSignal;
	const blocked = createGeneratedSourcePlayback({ frameRate: { num: 24, den: 1 }, frameCount: 1, render: (_, value) => { signal = value; return new Promise<number>(resolve => { release = resolve; }); }, present: () => assert.fail('Disposed result painted') });
	blocked.seek(0); await settle(); let disposed = false; const close = blocked.dispose().then(() => { disposed = true; });
	await settle(); assert.equal(signal.aborted, true); assert.equal(disposed, false); release(0); await close; assert.equal(disposed, true);
});
test('M10 malformed clock/rate/frame admission refuses before rendering', async () => {
	let reads = 0; const options = { frameRate: { num: 24, den: 1 }, frameCount: 2, render: () => { reads++; return Promise.resolve(0); }, present() {} };
	for (const frameRate of [{ num: 0, den: 1 }, { num: 1, den: 0 }, { num: 1.5, den: 1 }]) assert.throws(() => createGeneratedSourcePlayback({ ...options, frameRate }), /rate/iu);
	const playback = createGeneratedSourcePlayback(options); for (const frame of [-1, 2, NaN, .1]) assert.throws(() => playback.seek(frame), /frame/iu);
	assert.equal(reads, 0); await playback.dispose();
});
test('M10 a seek published as a paint microtask is not lost when the previous drain finishes', async () => {
	const painted: number[] = [];
	const playback = createGeneratedSourcePlayback({ frameRate: { num: 24, den: 1 }, frameCount: 2, render: frame => Promise.resolve(frame),
		present(_, frame) { painted.push(frame); if (frame === 0) queueMicrotask(() => playback.seek(1)); } });
	playback.seek(0); await settle(); assert.deepEqual(painted, [0, 1]); await playback.dispose();
});
