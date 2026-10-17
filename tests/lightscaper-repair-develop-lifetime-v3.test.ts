/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopFrameV3, type ImageDevelopFrameOptionsV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { LUT_BODY, LUT_REFERENCE, profile as lutEffect, rectangleGraph, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const PROFILE = { source: LIMITS, render: LIMITS };
function repair() {
	return { id: 'repair', mode: 'clone', enabled: true, target: { x: 5 / 6, y: 0.5 },
		source: { x: 1 / 6, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 };
}
function develop(spots: readonly unknown[] = [repair()]) {
	return { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } };
}
function original() { return rgbaFrame([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 128]); }
function selected() {
	return { ...develop(), effects: [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })],
		masks: [rectangleGraph(0, 1)], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
}
function request() { return { frame: original(), develop: selected(), maskOverlay: { maskId: 'mask', effectId: 'invert' } }; }
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
function observe(work: Promise<unknown>) {
	return work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
}
async function brush() {
	return withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: new Uint8Array([255]) },
		prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
}
function brushGraph(sourceRef: string) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'paint', sourceRef, kind: 'alpha' }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
}

test('V3 native pre-abort preserves the opaque first reason before repair, frame or resource authority', async () => {
	const stop = new AbortController(), reason = opaque(); stop.abort(reason); let traps = 0, delivered = 0;
	const unread = new Proxy({}, { ownKeys() { traps++; throw Error('Pre-aborted V3 reflected nested authority'); } });
	const outcome = await observe(withImageDevelopFrameV3({ frame: unread, develop: unread, signal: stop.signal },
		() => { delivered++; }, PROFILE, unread));
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true);
	assert.equal(traps, 0); assert.equal(delivered, 0);
});

test('V3 independent repair source-byte admission precedes even the source pixel property descriptor', async () => {
	let pixels = 0, bodies = 0, delivered = 0;
	const frame = new Proxy({ descriptor: { ...original().descriptor, width: 4097, height: 4096 }, pixels: {} }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { pixels++; throw Error('Source+1 reflected pixel property'); }
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const source: CubeLutSourcePortV1 = { async withBytes() { bodies++; throw Error('Source+1 acquired LUT'); } };
	const wider = { maximumSidePixels: 16_384, maximumPixels: 33_554_432, maximumBytes: 134_217_728 };
	await assert.rejects(withImageDevelopFrameV3({ frame, develop: { ...develop([]), effects: [lutEffect()] } },
		() => { delivered++; }, { source: wider, render: wider }, { source }), /source|byte|limit|budget/iu);
	assert.equal(pixels, 0); assert.equal(bodies, 0); assert.equal(delivered, 0);
});

test('V3 captures original, repair recipe, resource options and actual method receivers before a yielding repair', async () => {
	const body = await brush(), frame = { descriptor: { ...original().descriptor, width: 512, height: 128 }, pixels: new Uint8Array(512 * 128 * 4) };
	for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
		const gray = x < 256 ? 255 : 0; frame.pixels.set([gray, gray, gray, 255], (y * 512 + x) * 4);
	}
	const definition = { ...repair(), target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 1 };
	const graph = brushGraph(body.reference.storageKey), recipe = { ...develop([definition]), effects: [lutEffect()], masks: [graph],
		maskBindings: [{ effectId: 'profile', maskId: 'mask' }] };
	const entered = deferred<void>(), release = deferred<void>(); let brushes = 0, luts = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, maskSource); assert.deepEqual(reference, body.reference); brushes++;
		entered.resolve(); await release.promise; return consume(body.bytes);
	} };
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.deepEqual(reference, LUT_REFERENCE); luts++; return consume(LUT_BODY);
	} };
	const options: ImageDevelopFrameOptionsV3 = { source, maskSource };
	const work = withImageDevelopFrameV3({ frame, develop: recipe }, view => [...view.frame.pixels.slice((64 * 512 + 384) * 4, (64 * 512 + 384) * 4 + 4)], PROFILE, options);
	const outcome = observe(work);
	// The Clone rectangle exceeds16384 visits. All caller inputs must already be captured at this first yield.
	assert.equal(brushes, 0); definition.source.x = 0.75; definition.opacity = 0; frame.pixels.fill(0);
	graph.inputs[0]!.sourceRef = 'brush-mask-v2:1:1:future';
	maskSource.withBytes = async () => { throw Error('Replaced brush method used'); };
	source.withBytes = async () => { throw Error('Replaced LUT method used'); };
	Object.defineProperty(options, 'maskSource', { value: {} }); Object.defineProperty(options, 'source', { value: {} });
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); }
	finally { release.resolve(); await outcome; }
	assert.deepEqual(await work, [137, 0, 0, 255]); assert.equal(brushes, 1); assert.equal(luts, 1);
	assert.equal(frame.pixels.every(value => value === 0), true); assert.equal(body.bytes[16], 255);
});

test('V3 caller cancellation joins a held native brush body retirement before any developed delivery', async () => {
	const body = await brush(), frame = original(), before = frame.pixels.slice(), stop = new AbortController(), reason = opaque();
	const entered = deferred<void>(), release = deferred<void>(), retained: { body?: Uint8Array<ArrayBuffer>; signal?: AbortSignal } = {};
	let delivered = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume, options) {
		retained.signal = options?.signal; const bytes = body.bytes.slice(); retained.body = bytes;
		try { const result = await consume(bytes); entered.resolve(); await release.promise; return result; }
		finally { bytes.fill(0); }
	} };
	const recipe = { ...selected(), masks: [brushGraph(body.reference.storageKey)] };
	const work = withImageDevelopFrameV3({ frame, develop: recipe, signal: stop.signal }, () => { delivered++; }, PROFILE, { maskSource });
	const outcome = observe(work);
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(retained.signal, stop.signal);
		assert.equal(await remainsPending(work), true); assert.equal(delivered, 0); assert.equal(retained.body?.[16], 255);
	} finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(retained.body?.every(value => value === 0)); assert.deepEqual(frame.pixels, before); assert.equal(body.bytes[16], 255);
});

test('V3 native cancellation joins real Heal solver work before acquiring later resources', async () => {
	const frame = { descriptor: { ...original().descriptor, width: 128, height: 128 }, pixels: new Uint8Array(128 * 128 * 4) };
	for (let i = 0; i < frame.pixels.length; i += 4) frame.pixels.set([64, 128, 192, 255], i);
	for (let y = 48; y < 80; y++) for (let x = 16; x < 48; x++) frame.pixels.set([192, 192, 192, 255], (y * 128 + x) * 4);
	frame.pixels.set([0, 0, 0, 255], (64 * 128 + 96) * 4); const before = frame.pixels.slice();
	const definition = { ...repair(), mode: 'heal', target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 } };
	const stop = new AbortController(), reason = opaque(); let delivered = 0, resources = 0;
	const source: CubeLutSourcePortV1 = { async withBytes() { resources++; throw Error('Cancelled Heal acquired LUT'); } };
	const work = withImageDevelopFrameV3({ frame, develop: { ...develop([definition]), effects: [lutEffect()] }, signal: stop.signal },
		() => { delivered++; }, PROFILE, { source }), outcome = observe(work);
	// Halo population/context/RHS are below16384 visits; the first native timer is in64 Jacobi sweeps.
	const cancellation = setTimeout(() => { stop.abort(reason); }, 0);
	try {
		const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
		assert.equal(delivered, 0); assert.equal(resources, 0); assert.deepEqual(frame.pixels, before);
	} finally { clearTimeout(cancellation); }
});

test('V3 holds repaired final pixels and observed overlay until an admitted consumer settles after native cancellation', async () => {
	const input = request(), before = input.frame.pixels.slice(), stop = new AbortController(), reason = opaque();
	const entered = deferred<void>(), release = deferred<void>(), retained: { pixels?: ArrayBuffer; coverage?: ArrayBuffer } = {};
	const work = withImageDevelopFrameV3({ ...input, signal: stop.signal }, async view => {
		assert.ok(view.maskOverlay); retained.pixels = view.frame.pixels.buffer; retained.coverage = view.maskOverlay.coverage.buffer;
		assert.deepEqual([...view.frame.pixels], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 128]);
		assert.deepEqual([...view.maskOverlay.coverage], [255, 255, 255]); entered.resolve(); await release.promise; return 73;
	}, PROFILE), outcome = observe(work);
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true);
		assert.ok(retained.pixels); assert.ok(retained.coverage);
		assert.equal(new Uint8Array(retained.pixels)[7], 255); assert.deepEqual([...new Uint8Array(retained.coverage)], [255, 255, 255]);
	} finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(retained.pixels); assert.ok(retained.coverage);
	assert.ok(new Uint8Array(retained.pixels).every(value => value === 0)); assert.ok(new Uint8Array(retained.coverage).every(value => value === 0));
	assert.deepEqual(input.frame.pixels, before);
});

test('V3 final pixel and overlay cleanup ignores native geometry and fill shadows while preserving an opaque primary', async () => {
	const input = request(), before = input.frame.pixels.slice(), reason = opaque(); let getters = 0;
	const retained: { pixels?: ArrayBuffer; coverage?: ArrayBuffer } = {};
	const outcome = await observe(withImageDevelopFrameV3(input, view => {
		assert.ok(view.maskOverlay); retained.pixels = view.frame.pixels.buffer; retained.coverage = view.maskOverlay.coverage.buffer;
		for (const bytes of [view.frame.pixels, view.maskOverlay.coverage]) for (const key of ['buffer', 'fill', 'length', 'byteLength', 'byteOffset']) {
			Object.defineProperty(bytes, key, { get() { getters++; throw Error('Borrower shadow replaced V3 retirement'); } });
		}
		throw reason;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true); assert.equal(getters, 0);
	assert.ok(retained.pixels); assert.ok(retained.coverage);
	assert.ok(new Uint8Array(retained.pixels).every(value => value === 0)); assert.ok(new Uint8Array(retained.coverage).every(value => value === 0));
	assert.deepEqual(input.frame.pixels, before);
});

for (const target of ['pixels', 'coverage'] as const) test(`V3 transferred final ${target} refuses successful retirement and still wipes the other native backing`, async () => {
	const input = request(), before = input.frame.pixels.slice(), retained: { other?: ArrayBuffer; transferred?: Uint8Array<ArrayBuffer> } = {};
	const outcome = await observe(withImageDevelopFrameV3(input, view => {
		assert.ok(view.maskOverlay);
		const bytes = target === 'pixels' ? view.frame.pixels : view.maskOverlay.coverage;
		retained.other = target === 'pixels' ? view.maskOverlay.coverage.buffer : view.frame.pixels.buffer;
		retained.transferred = structuredClone(bytes, { transfer: [bytes.buffer] }); return 73;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.ok(outcome.error instanceof Error);
	assert.match(outcome.error.message, /detach|backing|retire|wipe|cleanup/iu);
	assert.ok(retained.transferred); assert.ok(retained.transferred.some(value => value !== 0)); assert.ok(retained.other);
	assert.ok(new Uint8Array(retained.other).every(value => value === 0)); assert.deepEqual(input.frame.pixels, before);
});

test('V3 detached current and overlay produce ordered distinct retirement failures after the exact opaque primary', async () => {
	const input = request(), before = input.frame.pixels.slice(), reason = opaque(), transferred: Uint8Array<ArrayBuffer>[] = [];
	const outcome = await observe(withImageDevelopFrameV3(input, view => {
		assert.ok(view.maskOverlay);
		for (const bytes of [view.frame.pixels, view.maskOverlay.coverage]) transferred.push(structuredClone(bytes, { transfer: [bytes.buffer] }));
		throw reason;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.ok(outcome.error instanceof AggregateError);
	const failures: readonly unknown[] = outcome.error.errors;
	assert.equal(failures.length, 3); assert.equal(Object.is(failures[0], reason), true);
	assert.ok(failures[1] instanceof Error); assert.ok(failures[2] instanceof Error); assert.notEqual(failures[1], failures[2]);
	assert.match(failures[1].message, /current|frame|pixel/iu); assert.match(failures[2].message, /overlay|coverage/iu);
	assert.ok(transferred.every(bytes => bytes.some(value => value !== 0))); assert.deepEqual(input.frame.pixels, before);
});
