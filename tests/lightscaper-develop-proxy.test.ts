/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const source = (pixels: number[], width = pixels.length / 4) => ({
	descriptor: { schemaVersion: 1 as const, width, height: pixels.length / (4 * width),
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(pixels),
});
const effect = (type: string, params: Record<string, number> = {}) => createVideoEffect(type, { id: type, params });

test('photo proxy evaluates ordered shared effects at natural geometry extent, then measures the rendered histogram', async () => {
	const frame = source([0, 0, 0, 255, 255, 255, 255, 255]);
	const crop = effect('develop-geometry-v1', { cropX: 0.25, cropWidth: 0.5 }), tone = effect('tone-ladder-v1', { exposure: 1 });
	for (const [effects, expected] of [[[crop, tone], 176], [[tone, crop], 128]] as const) {
		const output = await withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(), effects } }, view => ({
			descriptor: view.frame.descriptor, pixels: [...view.frame.pixels], histogram: view.histogram,
		}));
		assert.equal(output.descriptor.width, 1); assert.equal(output.descriptor.height, 1);
		assert.deepEqual(output.pixels, [expected, expected, expected, 255]);
		assert.equal(output.histogram.sampledPixels, 1); assert.equal(output.histogram.bins.red[expected], 1);
		assert.equal(output.histogram.lowClippedPixels, 0); assert.equal(output.histogram.highClippedPixels, 0);
	}
	assert.deepEqual([...frame.pixels], [0, 0, 0, 255, 255, 255, 255, 255]);
});

test('existing photo geometry composes before ordered effects without a second orientation transform or Frame letterboxing', async () => {
	const frame = source([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
	const develop = { ...defaultPhotoDevelopV1(), geometry: { crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
		rotationDegrees: 0, flipHorizontal: true, flipVertical: false }, effects: [effect('develop-geometry-v1', { rotationDegrees: 90 })] };
	const output = await withPhotoDevelopProxyV1({ frame, develop }, view => ({ descriptor: view.frame.descriptor, pixels: [...view.frame.pixels] }));
	assert.equal(output.descriptor.width, 1); assert.equal(output.descriptor.height, 2);
	assert.deepEqual(output.pixels, [70, 80, 90, 255, 40, 50, 60, 255]);
});

test('photo proxy preserves straight-alpha global math, clips visible channels and leaves neutral geometry hidden RGB untouched', async () => {
	const frame = source([64, 128, 192, 0, 64, 128, 192, 1, 255, 0, 255, 127]);
	let retained: Uint8Array | null = null;
	const result = await withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(),
		effects: [effect('white-balance-v1', { temperature: 100 })] } }, view => {
		retained = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
	});
	assert.deepEqual(result.pixels, [90, 128, 140, 0, 90, 128, 140, 1, 255, 0, 188, 127]);
	assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 2);
	assert.equal(result.histogram.bins.red[90], 1); assert.equal(result.histogram.bins.red[255], 1);
	assert.equal(result.histogram.lowClippedPixels, 1); assert.equal(result.histogram.highClippedPixels, 1);
	assert.ok((retained as Uint8Array | null)?.every(value => value === 0)); assert.equal(frame.pixels[0], 64);
});

test('photo proxy owns source/settings before its first await and joins a cancelled consumer before wiping output', async () => {
	const frame = source([128, 128, 128, 255]), develop = { ...defaultPhotoDevelopV1(), effects: [effect('tone-ladder-v1', { exposure: 1 })] };
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = new Proxy({}, { getPrototypeOf() { throw Error('Reason reflected'); } });
	let retained: Uint8Array | null = null;
	const work = withPhotoDevelopProxyV1({ frame, develop, signal: stop.signal }, async view => {
		retained = view.frame.pixels; assert.deepEqual([...view.frame.pixels], [176, 176, 176, 255]);
		entered.resolve(); await release.promise;
	});
	frame.pixels.fill(0); assert.equal(Reflect.set(develop.effects[0]!.params, 'exposure', -5), true);
	await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true);
	const refused = assert.rejects(work, failure => failure === reason); stop.abort(reason);
	assert.equal(await remainsPending(work), true); release.resolve(); await refused;
	assert.ok((retained as Uint8Array | null)?.every(value => value === 0));
});

test('proxy rejects enabled unsupported effects and mask-bound geometry before exposing pixels, while disabled known effects remain retained', async () => {
	const frame = source([1, 2, 3, 255]); let consumed = 0;
	const unsupported = effect('gaussian-blur');
	await assert.rejects(withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(), effects: [unsupported] } }, () => { consumed++; }), /unsupported/iu);
	const mask = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'rectangle',
		nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }] };
	await assert.rejects(withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(), effects: [effect('develop-geometry-v1')],
		masks: [mask], maskBindings: [{ effectId: 'develop-geometry-v1', maskId: 'mask' }] } }, () => { consumed++; }), /mask/iu);
	assert.equal(consumed, 0);
	const output = await withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(), effects: [{ ...unsupported, enabled: false }] } }, view => [...view.frame.pixels]);
	assert.deepEqual(output, [1, 2, 3, 255]);
});

test('proxy cleanup uses captured backing even when a consumer shadows its view and throws an opaque failure', async () => {
	const failure = new Proxy({}, { getPrototypeOf() { throw Error('Failure reflected'); } });
	let backing: ArrayBuffer | null = null, getters = 0;
	await assert.rejects(withPhotoDevelopProxyV1({ frame: source([90, 100, 110, 255]), develop: defaultPhotoDevelopV1() }, view => {
		backing = view.frame.pixels.buffer;
		Object.defineProperty(view.frame.pixels, 'buffer', { get() { getters++; throw Error('Borrowed backing getter read'); } });
		throw failure;
	}), error => error === failure);
	assert.equal(getters, 0); assert.ok(backing); assert.ok(new Uint8Array(backing!).every(value => value === 0));
});
