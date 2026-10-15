/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('actual Current native renderer suppresses a purple edge fringe without changing the Original', async () => {
	const frame = { descriptor: { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.of(0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1) };
	const before = frame.pixels.slice(), develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'defringe', type: 'defringe-v1', enabled: true,
		params: { purple: 100, green: 0, edgeThreshold: 25 } }] };
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame, develop, signal: new AbortController().signal }, view => [...view.frame.pixels]);
	// The supported black/white neighborhood fully gates the isolated magenta
	// center. Its encoded luma is73/256; native output never quantizes to bytes.
	const neutral = Math.fround(((73 / 256 + .055) / 1.055) ** 2.4);
	assert.deepEqual(result, [0, 0, 0, 1, neutral, neutral, neutral, 1, 1, 1, 1, 1]);
	assert.deepEqual(frame.pixels, before); assert.equal(develop.processVersion, 2);
});

const effect = (purple = 100, green = 0, edgeThreshold = 25, enabled = true) => ({ id: 'defringe', type: 'defringe-v1', enabled, params: { purple, green, edgeThreshold } });
const recipe = (effects: readonly unknown[], extras: Readonly<Record<string, unknown>> = {}) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects, ...extras });
const graph = (node: unknown) => ({ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'coverage' });
const gradient = () => graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const binding = [{ maskId: 'local', effectId: 'defringe' }], selected = { maskId: 'local', effectId: 'defringe' };
const frame = (pixels: readonly number[], native: boolean): PixelFrameV1 => native
	? { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(pixels) }
	: { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from(pixels) };
const fringe = (native: boolean, green = false) => frame(native
	? [0, 0, 0, 1, green ? 0 : 1, green ? 1 : 0, green ? 0 : 1, 1, 1, 1, 1, 1]
	: [0, 0, 0, 255, green ? 0 : 255, green ? 255 : 0, green ? 0 : 255, 255, 255, 255, 255, 255], native);
const request = (frame: PixelFrameV1, develop: ReturnType<typeof recipe>) => ({ frame, develop, signal: new AbortController().signal });
const tone = () => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });

test('Current byte defringe targets purple and green edge fringes independently with literal encoded output', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	for (const green of [false, true]) {
		const source = fringe(false, green), before = source.pixels.slice(), active = green ? effect(0, 100) : effect();
		const result = await runtime.withFullResolution(request(source, recipe([active])), view => [...view.frame.pixels]);
		const neutral = green ? 182 : 73;
		assert.deepEqual(result, [0, 0, 0, 255, neutral, neutral, neutral, 255, 255, 255, 255, 255]);
		const isolated = await runtime.withFullResolution(request(source, recipe([green ? effect() : effect(0, 100)])), view => [...view.frame.pixels]);
		assert.deepEqual(isolated, [...before]); assert.deepEqual(source.pixels, before);
	}
});

for (const native of [false, true]) test(`${native ? 'native' : 'byte'} masked defringe blends on the destination grid and projects coverage only through later lens and geometry`, async () => {
	const source = fringe(native), before = source.pixels.slice(), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const result = await runtime.withFullResolution({ ...request(source, recipe([effect()], { masks: [gradient()], maskBindings: binding })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.maskOverlay.coverage], [43, 128, 213]); return [...view.frame.pixels];
	});
	if (native) {
		const gray = Math.fround(decode(73 / 256)), amount = 128 / 255;
		assert.deepEqual(result.slice(4, 8), [Math.fround(1 + amount * (gray - 1)), Math.fround(amount * gray), Math.fround(1 + amount * (gray - 1)), 1]);
	} else {
		const gray = decode(73 / 255), amount = 128 / 255;
		assert.deepEqual(result.slice(4, 8), [byte(1 + amount * (gray - 1)), byte(amount * gray), byte(1 + amount * (gray - 1)), 255]);
	}
	const effects = [effect(), createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 100 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 2 / 3, rotationDegrees: 90 } })];
	await runtime.withFullResolution({ ...request(source, recipe(effects, { masks: [gradient()], maskBindings: binding })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([view.maskOverlay.width, view.maskOverlay.height], [1, 2]);
		assert.deepEqual([...view.maskOverlay.coverage], [38, 128]);
	});
	assert.deepEqual(source.pixels, before);
});

test('native defringe range masks observe the incoming prefix before chroma suppression', async () => {
	const source = fringe(true), develop = recipe([tone(), effect()], {
		masks: [graph({ id: 'coverage', kind: 'luminance-range', lower: .5, upper: .6, falloff: 0 })], maskBindings: binding,
	});
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ ...request(source, develop), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.maskOverlay.coverage], [0, 255, 0]); return [...view.frame.pixels];
	});
	const gray = Math.fround(decode(encode(2) * 73 / 256));
	assert.deepEqual(result, [0, 0, 0, 1, gray, gray, gray, 1, 2, 2, 2, 1]);
});

test('byte defringe retains authored order relative to exposure', async () => {
	const source = fringe(false), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const first = await runtime.withFullResolution(request(source, recipe([effect(), tone()])), view => [...view.frame.pixels]);
	const last = await runtime.withFullResolution(request(source, recipe([tone(), effect()])), view => [...view.frame.pixels]);
	const exposed = byte(Math.min(1, 2 * decode(73 / 255)));
	assert.deepEqual(first.slice(4, 8), [exposed, exposed, exposed, 255]);
	assert.deepEqual(last.slice(4, 8), [73, 73, 73, 255]); assert.notDeepEqual(first, last);
});

test('native masked gate-zero defringe preserves flat negative-zero subbyte and hidden RGB bits with nonuniform alpha', async () => {
	const small = Math.fround(1e-40), source = frame([.5, -0, .5, .25, .5, -0, .5, .5, .5, -0, .5, 1, -2, small, -0, -0], true);
	const before = new Uint8Array(source.pixels.buffer).slice(), develop = recipe([effect(100, 100)], { masks: [gradient()], maskBindings: binding });
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, develop), view => new Uint8Array(view.frame.pixels.buffer).slice());
	assert.deepEqual(result, before); assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('native defringe uses continuous encoded HDR classification without clipping the white context', async () => {
	const source = frame([0, 0, 0, 1, 4, 0, 4, .5, 4, 4, 4, 1], true), before = source.pixels.slice();
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([effect()])), view => [...view.frame.pixels]);
	const gray = Math.fround(decode(encode(4) * 73 / 256));
	assert.deepEqual(result, [0, 0, 0, 1, gray, gray, gray, .5, 4, 4, 4, 1]); assert.deepEqual(source.pixels, before);
});

for (const processVersion of [1, 2, 3]) test(`Current defringe rendering preserves authored process${processVersion} for byte and native Originals`, async () => {
	for (const native of [false, true]) {
		const source = fringe(native), develop = recipe([effect()], { processVersion, ...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}) });
		const serialized = JSON.stringify(develop); await createPhotoDevelopRenderRuntimeCurrentV1().withProxy(request(source, develop), () => undefined);
		assert.equal(JSON.stringify(develop), serialized); assert.equal(develop.processVersion, processVersion);
	}
});

test('disabled neutral threshold-gated and flat defringe remain exact under Current execution', async () => {
	const source = frame([-0, -0, Math.fround(1e-40), 0, -.25, 2, -.5, .5], true), before = new Uint8Array(source.pixels.buffer).slice();
	for (const value of [effect(0, 0), effect(100, 100, 25, false)]) {
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([value])), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, before);
	}
	for (const native of [false, true]) {
		const original = fringe(native), bits = new Uint8Array(original.pixels.buffer).slice();
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(original, recipe([effect(100, 100, 100)])), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, bits);
	}
});

test('defringe metadata and aggregate masked stage work refuse before Original pixels', async () => {
	let reads = 0; const runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const source = { descriptor: fringe(true).descriptor, get pixels(): never { reads++; throw new Error('Native Original pixels'); } } as PixelFrameV1;
	for (const value of [effect(Infinity), effect(0, NaN, 25, false), effect(0, 0, 101)]) {
		await assert.rejects(runtime.withFullResolution({ frame: source, develop: { ...defaultImageDevelopStateV2(), effects: [value] }, signal: new AbortController().signal }, () => assert.fail('Invalid defringe delivered.')), RangeError);
	}
	const large = { descriptor: { ...source.descriptor, width: 8192, height: 2048 }, get pixels(): never { reads++; throw new Error('Large Original pixels'); } } as PixelFrameV1;
	const develop = recipe([effect()], { masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })], maskBindings: binding });
	await assert.rejects(runtime.withFullResolution(request(large, develop), () => assert.fail('Unbounded masked defringe delivered.')), /768 MiB/u);
	assert.equal(reads, 0);
});

test('permanent byte V3 remains strict for the new defringe family', async () => {
	await assert.rejects(withImageDevelopFrameV3({ frame: fringe(false), develop: recipe([effect()]) }, () => assert.fail('Permanent V3 gained defringe.'), PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), /Unsupported photo proxy effect/u);
});

for (const native of [false, true]) test(`Current ${native ? 'native' : 'byte'} defringe joins a held consumer and retires pixels and coverage after opaque cancellation`, async () => {
	const source = fringe(native), before = source.pixels.slice(), develop = recipe([effect()], { masks: [gradient()], maskBindings: binding });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let pixels: PixelFrameV1['pixels'] | undefined, coverage: Uint8Array<ArrayBuffer> | undefined;
	const work = createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame: source, develop, signal: stop.signal, maskOverlay: selected }, async view => {
		assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage; entered.resolve(); await release.promise;
	});
	const observed = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work]); stop.abort(opaque.proxy); assert.equal(await remainsPending(observed), true);
		assert.ok(pixels?.some(value => value !== 0) && coverage?.some(value => value !== 0)); release.resolve(); const result = await observed;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(pixels?.every(value => value === 0) && coverage?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await observed; }
});

function encode(value: number): number {
	const magnitude = Math.abs(value); return Math.sign(value) * (magnitude <= .0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - .055);
}
function decode(value: number): number {
	const magnitude = Math.abs(value); return Math.sign(value) * (magnitude <= .04045 ? magnitude / 12.92 : ((magnitude + .055) / 1.055) ** 2.4);
}
function byte(linear: number): number { return Math.round(255 * Math.min(1, Math.max(0, encode(linear)))); }
