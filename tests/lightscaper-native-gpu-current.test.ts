/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OWNER = new URL('../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts', import.meta.url);
interface View { readonly backend: 'webgl2' | 'cpu'; readonly reason?: string; readonly frame?: Readonly<LinearWorkingPixelFrameV1>; readonly source?: Readonly<LinearWorkingPixelFrameV1> }
interface Module {
	planPixelFrameWebGl2CurrentV1(value: unknown): Readonly<{ gpuWorkingBytes: number; eligible: boolean }>;
	withPixelFrameWebGl2CurrentV1<Result>(value: unknown, consume: (view: Readonly<View>) => Result | Promise<Result>): Promise<Result>;
}
async function owner(): Promise<Module> {
	assert.ok(existsSync(OWNER), 'The shared native Float32 GPU owner is missing.');
	return await import(OWNER.href) as Module;
}
const descriptor = { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } as const;
function request() { return { frame: { descriptor, pixels: Float32Array.of(-2, 3.5, 1e-30, 0, -0, 2 ** -149, .5, 1) }, passes: [] }; }

test('native GPU metadata and five-plane budget are admitted before any source pixel getter', async () => {
	const module = await owner(); let reads = 0;
	const frame = { descriptor, get pixels() { reads++; throw new Error('No pixel authority in metadata admission.'); } };
	const plan = module.planPixelFrameWebGl2CurrentV1({ frame, passes: [] });
	assert.equal(plan.gpuWorkingBytes, 2 * 16 * 5); assert.equal(plan.eligible, true); assert.equal(reads, 0);
	assert.throws(() => module.planPixelFrameWebGl2CurrentV1({ frame: { descriptor: { ...descriptor, width: 8193 }, get pixels() { reads++; throw new Error('Invalid extent.'); } }, passes: [] }));
	assert.equal(reads, 0);
	const large = module.planPixelFrameWebGl2CurrentV1({ frame: { descriptor: { ...descriptor, width: 4096, height: 4096 } }, passes: [] });
	assert.equal(large.gpuWorkingBytes, 4096 * 4096 * 16 * 5); assert.equal(large.eligible, false);
});

test('native GPU pre-abort preserves an opaque reason without reading source pixels or entering the consumer', async () => {
	const module = await owner(), stop = new AbortController(), reason = Symbol('native-gpu-pre-abort'); stop.abort(reason);
	let reads = 0, calls = 0;
	await assert.rejects(module.withPixelFrameWebGl2CurrentV1({ frame: { descriptor, get pixels() { reads++; throw new Error('Pre-aborted.'); } }, passes: [], signal: stop.signal }, () => { calls++; }), error => Object.is(error, reason));
	assert.equal(reads, 0); assert.equal(calls, 0);
});

test('unsupported native GPU lends one exact owned snapshot and retires it after the held fallback consumer joins', async () => {
	const module = await owner(), value = request(), before = new Uint32Array(value.frame.pixels.buffer).slice(), entered = deferred<void>(), release = deferred<void>();
	let held: Float32Array | undefined, calls = 0;
	const work = module.withPixelFrameWebGl2CurrentV1(value, async view => {
		calls++; assert.equal(view.backend, 'cpu'); assert.equal(view.reason, 'canvas-unavailable'); assert.ok(view.source);
		held = view.source.pixels; assert.notEqual(held.buffer, value.frame.pixels.buffer);
		assert.deepEqual(new Uint32Array(held.buffer), before); entered.resolve(); await release.promise;
		assert.deepEqual(new Uint32Array(held.buffer), before); return 'joined';
	});
	try { await entered.promise; value.frame.pixels.fill(99); assert.equal(await remainsPending(work), true); release.resolve(); assert.equal(await work, 'joined');
		assert.equal(calls, 1); assert.ok(held?.every(value => value === 0));
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('native GPU cancellation joins the exact accepted consumer and never replays it through fallback', async () => {
	const module = await owner(), value = request(), stop = new AbortController(), reason = Object.freeze({ tag: 'gpu-stop' }), entered = deferred<void>(), release = deferred<void>();
	let calls = 0, held: Float32Array | undefined;
	const work = module.withPixelFrameWebGl2CurrentV1({ ...value, signal: stop.signal }, async view => {
		calls++; assert.ok(view.source); held = view.source.pixels; entered.resolve(); await release.promise; assert.equal(held[0], -2);
	}).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, reason)); assert.equal(calls, 1); assert.ok(held?.every(value => value === 0));
	} finally { release.resolve(); await work; }
});

test('native GPU preserves opaque consumer failure and reports distinct physical retirement failure', async () => {
	const module = await owner(), value = request(), primary = Symbol('consumer'); let calls = 0;
	await assert.rejects(module.withPixelFrameWebGl2CurrentV1(value, view => {
		calls++; assert.ok(view.source); structuredClone(view.source.pixels.buffer, { transfer: [view.source.pixels.buffer] }); throw primary;
	}), error => error instanceof AggregateError && Object.is(error.cause, primary) && Object.is(error.errors[0], primary) && error.errors.length === 2);
	assert.equal(calls, 1); assert.equal(value.frame.pixels[0], -2);
});

test('native GPU fallback keeps source precision and alpha during unorm16 capture', async () => {
	const module = await owner(), pixels = Uint16Array.of(1, 2, 3, 0, 65535, 32768, 7, 65535), original = pixels.slice(); let held: Float32Array | undefined;
	await module.withPixelFrameWebGl2CurrentV1({ frame: { descriptor: { ...descriptor, sampleFormat: 'unorm16' }, pixels }, passes: [] }, view => {
		assert.ok(view.source); held = view.source.pixels;
		assert.deepEqual([...held], [...pixels].map(value => Math.fround(value / 65535))); assert.equal(view.source.descriptor.sampleFormat, 'float32');
	});
	assert.deepEqual(pixels, original); assert.ok(held?.every(value => value === 0));
});

test('native GPU refuses unknown authority and forged shader passes before pixels', async () => {
	const module = await owner(); let reads = 0;
	const frame = { descriptor, get pixels() { reads++; throw new Error('No pixels for an invalid request.'); } };
	assert.throws(() => module.planPixelFrameWebGl2CurrentV1({ frame, passes: [], decoder: () => null }));
	assert.throws(() => module.planPixelFrameWebGl2CurrentV1({ frame, passes: [{ type: 'white-balance-v1', params0: [1, 1, 1, 0], params1: [0, 0, 0, 0] }] }));
	assert.equal(reads, 0);
});

test('native GPU source admission stays bound to the captured descriptor rather than a later reflected shape', async () => {
	const module = await owner(); let descriptors = 0, calls = 0;
	const raw = new Proxy({ descriptor, pixels: Float32Array.of(.125, .25, .5, 1) }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'descriptor') return { configurable: true, enumerable: true, writable: true,
				value: ++descriptors === 1 ? descriptor : { ...descriptor, width: 1 } };
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	await assert.rejects(module.withPixelFrameWebGl2CurrentV1({ frame: raw, passes: [] }, () => { calls++; }));
	assert.equal(calls, 0, 'A changed descriptor cannot manufacture a zero-padded second pixel.');
});
