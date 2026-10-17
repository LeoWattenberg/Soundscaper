/* SPDX-License-Identifier: AGPL-3.0-only */
// Node exercises real whole-CPU fallback; native acceptance is qualified separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { PixelFrameWebGl2UnavailableCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import type { ImageDevelopFrameOptionsV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';

const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const heal = { id: 'heal', mode: 'heal', enabled: true, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15, feather: 0, opacity: 1 };
const recipe = (spots: readonly unknown[] = [heal]) => ({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } });
const outcome = <Value>(work: Promise<Value>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
function coupled() {
	const pixels = new Float32Array(10 * 5 * 4); for (let at = 3; at < pixels.length; at += 4) pixels[at] = 1;
	for (let y = 1; y < 4; y++) for (let x = 0; x < 4; x++) pixels.set([-2, -2, -2, 1], (y * 10 + x) * 4);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]] as const) pixels.set([4, 4, 4, 1], (y * 10 + x) * 4);
	return { descriptor: descriptor(10, 5), pixels };
}
const mask = (sourceRef?: string) => ({ schemaVersion: 1, id: 'local', kind: 'mask',
	inputs: sourceRef ? [{ name: 'paint', kind: 'alpha', sourceRef }] : [], nodes: sourceRef ? [{ id: 'paint', kind: 'alpha', inputName: 'paint' }]
		: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: sourceRef ? 'paint' : 'gradient' });
async function body() { return withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(128) }, resource => ({ reference: resource.reference, bytes: resource.bytes.slice() })); }
async function reference(frame: Readonly<LinearWorkingPixelFrameV1>, develop: unknown, options: ImageDevelopFrameOptionsV3 = {}) {
	return withImageDevelopLinearCurrentV1({ frame, develop }, output => Array.from(output.pixels), PROFILE, options);
}

test('repair-only native source selects one real wholeCPU fallback and preserves the coupled Poisson literals', async () => {
	const source = coupled(), before = source.pixels.slice(); let calls = 0; let borrowed: Float32Array | undefined;
	try {
		const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop: recipe() }, (output, execution) => {
			calls++; assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); borrowed = output.pixels;
			return Array.from(output.pixels);
		}, PROFILE);
		// Independent lambda1 equations: 5uL-uR=2, 5uR-uL=14.
		assert.deepEqual(actual.slice(104, 108), [1, 1, 1, 1]); assert.deepEqual(actual.slice(108, 112), [3, 3, 3, 1]);
		assert.equal(calls, 1); assert.deepEqual(source.pixels, before); assert.ok(borrowed?.every(n => n === 0));
	} finally { source.pixels.fill(0); before.fill(0); }
});

test('capture finishes before held brush I/O; the same stable Original drives Heal then masked tone after resource retirement', async () => {
	const resource = await body(), source = coupled(), initial = source.pixels.slice(), enter = deferred<void>(), release = deferred<void>();
	let active = 0, reads = 0, calls = 0; let borrowed: Float32Array | undefined;
	const authored = { ...recipe(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })],
		masks: [mask(resource.reference.storageKey)], maskBindings: [{ effectId: 'tone', maskId: 'local' }] };
	const port: MaskRasterSourcePortV1 = { async withBytes(ref, consume) {
		assert.equal(this, port); assert.deepEqual(ref, resource.reference); assert.equal(active++, 0); reads++;
		try { if (reads === 1) { enter.resolve(); await release.promise; } return await consume(resource.bytes); }
		finally { active--; }
	} };
	const expected = await reference(source, authored, { maskSource: { withBytes(_ref, consume) { return Promise.resolve(consume(resource.bytes)); } } });
	assert.equal(expected[104], Math.fround(1 + 128 / 255)); assert.equal(expected[108], Math.fround(3 + 128 / 255 * 3));
	const work = withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, (output, execution) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); assert.equal(active, 0); calls++; borrowed = output.pixels;
		return Array.from(output.pixels);
	}, PROFILE, { maskSource: port }); const settled = outcome(work);
	try {
		await Promise.race([enter.promise, settled]); assert.equal(reads, 1); assert.equal(await remainsPending(settled), true);
		source.pixels.fill(.75); port.withBytes = () => { throw new Error('Captured source receiver/method must remain pinned.'); }; release.resolve();
		assert.deepEqual(await work, expected); assert.equal(reads, 2); assert.equal(calls, 1);
		assert.ok(borrowed?.every(n => n === 0)); assert.ok(source.pixels.every(n => n === .75)); assert.notDeepEqual(source.pixels, initial);
	} finally { release.resolve(); await Promise.allSettled([work]); source.pixels.fill(0); initial.fill(0); resource.bytes.fill(0); }
});

for (const failurePhase of ['entry', 'retirement'] as const) test(`public unavailable from a declared brush at ${failurePhase} stays fatal for repair recipes`, async () => {
	const resource = await body(), source = coupled(), reason = new PixelFrameWebGl2UnavailableCurrentV1('numeric-range'); let reads = 0, calls = 0;
	const authored = { ...recipe(), masks: [mask(resource.reference.storageKey)] };
	try {
		const result = await outcome(withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, () => { calls++; }, PROFILE,
			{ maskSource: { async withBytes(_ref, consume) { reads++; if (failurePhase === 'retirement') await consume(resource.bytes); throw reason; } } }));
		assert.equal(result.ok, false); if (result.ok) assert.fail('Resource errors cannot request fallback.');
		assert.ok(Object.is(result.error, reason)); assert.equal(reads, 1); assert.equal(calls, 0);
	} finally { source.pixels.fill(0); resource.bytes.fill(0); }
});

test('held fallback consumer joins one opaque abort and physically wipes its output without replay', async () => {
	const source = coupled(), before = source.pixels.slice(), stop = new AbortController(), reason = opaque(), enter = deferred<void>(), release = deferred<void>();
	let calls = 0; let borrowed: Float32Array | undefined;
	const work = withImageDevelopGpuCurrentV1({ frame: source, develop: recipe(), signal: stop.signal }, async (output, execution) => {
		calls++; assert.equal(execution.backend, 'cpu'); borrowed = output.pixels; enter.resolve(); await release.promise;
	}, PROFILE); const settled = outcome(work);
	try {
		await Promise.race([enter.promise, settled]); assert.equal(calls, 1); stop.abort(reason);
		assert.equal(await remainsPending(settled), true); assert.ok(borrowed?.some(n => n !== 0)); release.resolve();
		const result = await settled; assert.equal(result.ok, false); if (result.ok) assert.fail('Opaque abort must reject.');
		assert.ok(Object.is(result.error, reason)); assert.equal(calls, 1); assert.ok(borrowed?.every(n => n === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await Promise.allSettled([work]); source.pixels.fill(0); before.fill(0); }
});

test('actual nonempty Heal without paired boundary remains a CPU semantic RangeError before consumer delivery', async () => {
	const pixels = Float32Array.from(Array.from({ length: 9 }, () => [.125, .25, .5, 1]).flat()), source = { descriptor: descriptor(3, 3), pixels }, before = pixels.slice();
	const authored = recipe([{ ...heal, target: { x: .5, y: .5 }, source: { x: .5, y: .5 }, radius: 1 }]); let calls = 0;
	try {
		const result = await outcome(withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, () => { calls++; }, PROFILE));
		assert.equal(result.ok, false); if (result.ok) assert.fail('No-boundary Heal cannot produce a successful image.');
		assert.ok(result.error instanceof RangeError); assert.match(result.error.message, /paired original boundary context/iu);
		assert.equal(calls, 0); assert.deepEqual(source.pixels, before);
	} finally { pixels.fill(0); before.fill(0); }
});

test('zero-member Heal stays a valid exact copy, including hidden signed RGB and alpha', async () => {
	const pixels = Float32Array.from([-0, -2, 4, 0, .25, 1e-30, -.5, 0, 8, -0, .125, 0]);
	const source = { descriptor: descriptor(3, 1), pixels }, before = new Uint32Array(pixels.buffer.slice(0)); let calls = 0;
	try {
		const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop: recipe([{ ...heal, target: { x: .5, y: .5 }, source: { x: .5, y: .5 }, radius: 1 }]) }, (output, execution) => {
			calls++; assert.equal(execution.backend, 'cpu'); return new Uint32Array(output.pixels.buffer.slice(0));
		}, PROFILE);
		assert.deepEqual(actual, before); assert.deepEqual(new Uint32Array(pixels.buffer), before); assert.equal(calls, 1);
	} finally { pixels.fill(0); before.fill(0); }
});

test('corrupt unused declaration cannot reach either native prefix or its CPU semantic validation', async () => {
	const resource = await body(), source = coupled(); let reads = 0, calls = 0;
	try {
		await assert.rejects(withImageDevelopGpuCurrentV1({ frame: source, develop: { ...recipe(), masks: [mask(resource.reference.storageKey)] } }, () => { calls++; }, PROFILE,
			{ maskSource: { async withBytes(_ref, consume) { reads++; const corrupt = resource.bytes.slice(); corrupt[16] = corrupt[16]! ^ 1;
				try { return await consume(corrupt); } finally { corrupt.fill(0); } } } }));
		assert.equal(reads, 1); assert.equal(calls, 0);
	} finally { source.pixels.fill(0); resource.bytes.fill(0); }
});

test('pre-aborted opaque reasons precede source properties and all repair/resource work', async () => {
	const stop = new AbortController(), reason = opaque(); stop.abort(reason); let reads = 0, calls = 0;
	const frame = { get descriptor(): never { reads++; return assert.fail('Preabort precedes descriptor.'); }, get pixels(): never { reads++; return assert.fail('Preabort precedes samples.'); } };
	const result = await outcome(withImageDevelopGpuCurrentV1({ frame, develop: recipe(), signal: stop.signal }, () => { calls++; }, PROFILE));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Preabort rejects.'); assert.ok(Object.is(result.error, reason)); assert.equal(reads, 0); assert.equal(calls, 0);
});
