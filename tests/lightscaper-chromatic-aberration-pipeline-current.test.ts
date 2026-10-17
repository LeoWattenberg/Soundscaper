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

test('actual Current native renderer applies manual CA while preserving exact green alpha and the zero-control blue channel', async () => {
	const frame = { descriptor: { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.of(0, -.25, 2, 1, 1, .25, 0, 1, 0, .5, 2, 1) };
	const before = frame.pixels.slice(), develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'ca', type: 'chromatic-aberration-v1', enabled: true, params: { red: -100, blue: 0 } }] };
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame, develop, signal: new AbortController().signal }, view => [...view.frame.pixels]);
	// In a3x1 aperture the outside centers have r²0.4. Red's−0.01
	// coefficient pulls each sample0.004pixel toward the center. Blue0,
	// green and reference-grid alpha are copied exactly, including HDR blue.
	assert.deepEqual(result, [Math.fround(.004), -.25, 2, 1, 1, .25, 0, 1, Math.fround(.004), .5, 2, 1]);
	assert.deepEqual(frame.pixels, before); assert.equal(develop.processVersion, 2);
});

const ca = (red = -100, blue = 0, enabled = true) => ({ id: 'ca', type: 'chromatic-aberration-v1', enabled, params: { red, blue } });
const tone = (exposure = 1) => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure } });
const recipe = (effects: readonly unknown[], extras: Readonly<Record<string, unknown>> = {}) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects, ...extras });
const graph = (node: unknown) => ({ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'coverage' });
const request = (frame: PixelFrameV1, develop: ReturnType<typeof recipe>) => ({ frame, develop, signal: new AbortController().signal });
const frame = (pixels: readonly number[], native: boolean): PixelFrameV1 => native
	? { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(pixels) }
	: { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from(pixels) };

test('Current byte CA reconstructs corrected channels across alpha without canonicalizing hidden green or changing reference alpha', async () => {
	const source = frame([0, 7, 0, 255, 255, 11, 0, 128, 0, 13, 255, 0], false), before = source.pixels.slice();
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([ca(-100, 100)])), view => [...view.frame.pixels]);
	// Red's inward0.004pixel tap sees half-alpha center. The transparent
	// destination therefore reconstructs red255, while outward blue has no
	// supported alpha there. Hidden green13 and reference alpha0 stay exact.
	assert.deepEqual(result, [1, 7, 0, 255, 255, 11, 0, 128, 255, 13, 0, 0]); assert.deepEqual(source.pixels, before);
});

test('Current native CA keeps HDR and hidden reference components while alpha weights only the corrected channel', async () => {
	const source = frame([0, -.25, 2, 1, 1, .25, 0, .5, 0, 4, 1, 0], true), before = source.pixels.slice();
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([ca()])), view => [...view.frame.pixels]);
	assert.deepEqual(result, [Math.fround(.002 / .998), -.25, 2, 1, 1, .25, 0, .5, 1, 4, 1, 0]); assert.deepEqual(source.pixels, before);
});

test('bound CA preserves exact negative-zero green and its zero-control channel under fractional mask blending', async () => {
	for (const entry of [{ pixels: [1, -0, -0, .5], effect: ca(100, 0) }, { pixels: [-0, -0, 1, .5], effect: ca(0, 100) }]) {
		const source = frame(entry.pixels, true), before = new Uint8Array(source.pixels.buffer).slice();
		const develop = recipe([entry.effect], { masks: [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })],
			maskBindings: [{ maskId: 'local', effectId: 'ca' }] });
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, develop), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, before, 'CA must preserve copied reference-channel bits even under128/255 coverage.');
		assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
	}
});

test('CA masks observe the incoming native prefix stage and do not treat CA as a geometric suffix', async () => {
	const source = frame([0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1], true);
	const develop = recipe([tone(), ca()], { masks: [graph({ id: 'coverage', kind: 'luminance-range', lower: 0, upper: .00001, falloff: 0 })],
		maskBindings: [{ maskId: 'local', effectId: 'ca' }] });
	let retained: Uint8Array<ArrayBuffer> | undefined;
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ ...request(source, develop), maskOverlay: { maskId: 'local', effectId: 'ca' } }, view => {
		assert.ok(view.maskOverlay); retained = view.maskOverlay.coverage; assert.deepEqual([...retained], [255, 0, 255]); return [...view.frame.pixels];
	});
	// Exposure first leaves outer luminance0 and center2. Incoming outer
	// coverage selects the CA reconstruction0.008; evaluating the range after
	// CA would exclude that sample. Coverage itself is not radially shifted.
	assert.deepEqual(result, [Math.fround(.008), 0, 0, 1, 2, 2, 2, 1, Math.fround(.008), 0, 0, 1]);
	assert.ok(retained?.every(value => value === 0));
});

for (const native of [false, true]) test(`${native ? 'native' : 'byte'} bound CA uses destination-grid coverage and transports it only through later lens and geometry`, async () => {
	const source = frame(native ? [0, .25, 0, 1, 1, .5, 1, 1, 0, .75, 0, 1] : [0, 64, 0, 255, 255, 128, 255, 255, 0, 192, 0, 255], native);
	const before = source.pixels.slice(), masks = [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })], maskBindings = [{ maskId: 'local', effectId: 'ca' }];
	const selected = { maskId: 'local', effectId: 'ca' }, runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const result = await runtime.withFullResolution({ ...request(source, recipe([ca()], { masks, maskBindings })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.maskOverlay.coverage], [43, 128, 213]); return [...view.frame.pixels];
	});
	if (native) assert.deepEqual(result.filter((_value, index) => index % 4 === 0), [Math.fround(Math.fround(.004) * 43 / 255), 1, Math.fround(Math.fround(.004) * 213 / 255)]);
	else assert.deepEqual(result.filter((_value, index) => index % 4 === 0), [0, 255, 1]);
	assert.deepEqual(result.filter((_value, index) => index % 4 === 1), [...source.pixels].filter((_value, index) => index % 4 === 1));
	const effects = [ca(), createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 100 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 2 / 3, rotationDegrees: 90 } })];
	await runtime.withFullResolution({ ...request(source, recipe(effects, { masks, maskBindings })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([view.maskOverlay.width, view.maskOverlay.height], [1, 2]);
		assert.deepEqual([...view.maskOverlay.coverage], [38, 128]);
	});
	assert.deepEqual(source.pixels, before);
});

test('byte CA and tone preserve authored order rather than moving the correction outside the color stack', async () => {
	const source = frame([128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 0, 255], false), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const caFirst = await runtime.withFullResolution(request(source, recipe([ca(), tone()])), view => [...view.frame.pixels]);
	const toneFirst = await runtime.withFullResolution(request(source, recipe([tone(), ca()])), view => [...view.frame.pixels]);
	assert.deepEqual(caFirst, [exposeByte(129), exposeByte(128), exposeByte(128), 255, 255, 255, 255, 255, exposeByte(1), 0, 0, 255]);
	assert.deepEqual(toneFirst, [176, 176, 176, 255, 255, 255, 255, 255, 1, 0, 0, 255]); assert.notDeepEqual(caFirst, toneFirst);
});

for (const processVersion of [1, 2, 3]) test(`Current CA rendering preserves authored process${processVersion} for byte and native Originals`, async () => {
	for (const native of [false, true]) {
		const source = frame(native ? [0, .25, 2, 1, 1, .5, 0, 1, 0, .75, 1, 1] : [0, 64, 255, 255, 255, 128, 0, 255, 0, 192, 128, 255], native);
		const develop = recipe([ca()], { processVersion, ...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}) });
		const serialized = JSON.stringify(develop); await createPhotoDevelopRenderRuntimeCurrentV1().withProxy(request(source, develop), () => undefined);
		assert.equal(JSON.stringify(develop), serialized); assert.equal(develop.processVersion, processVersion);
	}
});

test('neutral and disabled CA preserve native bits including hidden RGB signed zero and subnormals', async () => {
	const source = frame([-0, -0, Math.fround(1e-40), 0, -.25, 2, -.5, .5], true), before = new Uint8Array(source.pixels.buffer).slice();
	for (const effect of [ca(0, 0), ca(100, -100, false)]) {
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([effect])), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, before);
	}
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('CA metadata and aggregate mask work refuse before source pixels are consulted', async () => {
	let reads = 0; const runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const source = { descriptor: frame([0, 0, 0, 1], true).descriptor, get pixels(): never { reads++; throw new Error('Native Original pixels'); } } as PixelFrameV1;
	for (const effect of [ca(Infinity, 0), ca(0, NaN, false)]) {
		const raw = { ...defaultImageDevelopStateV2(), effects: [effect] };
		await assert.rejects(runtime.withFullResolution({ frame: source, develop: raw, signal: new AbortController().signal }, () => assert.fail('Invalid CA delivered.')), RangeError);
	}
	const large = { descriptor: { ...source.descriptor, width: 8192, height: 2048 }, get pixels(): never { reads++; throw new Error('Large Original pixels'); } } as PixelFrameV1;
	const develop = recipe([ca()], { masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })], maskBindings: [{ maskId: 'local', effectId: 'ca' }] });
	await assert.rejects(runtime.withFullResolution(request(large, develop), () => assert.fail('Unbounded CA mask work delivered.')), /768 MiB/u); assert.equal(reads, 0);
});

test('the permanent byte V3 facade stays strict while Current supports manual CA', async () => {
	const source = frame([0, 64, 0, 255, 255, 128, 255, 255, 0, 192, 0, 255], false), develop = recipe([ca()]);
	await assert.rejects(withImageDevelopFrameV3({ frame: source, develop }, () => assert.fail('Permanent V3 gained CA.'), PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), /Unsupported photo proxy effect/u);
});

test('Current CA joins a held masked consumer and physically retires both output and observed coverage on opaque cancellation', async () => {
	const source = frame([0, .25, 0, 1, 1, .5, 1, 1, 0, .75, 0, 1], true), before = source.pixels.slice();
	const develop = recipe([ca()], { masks: [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })], maskBindings: [{ maskId: 'local', effectId: 'ca' }] });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let pixels: Float32Array<ArrayBuffer> | undefined, coverage: Uint8Array<ArrayBuffer> | undefined;
	const work = createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame: source, develop, signal: stop.signal, maskOverlay: { maskId: 'local', effectId: 'ca' } }, async view => {
		assert.ok(view.frame.pixels instanceof Float32Array && view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage; entered.resolve(); await release.promise;
	});
	const observed = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work]); stop.abort(opaque.proxy); assert.equal(await remainsPending(observed), true);
		assert.ok(pixels?.some(value => value !== 0) && coverage?.some(value => value !== 0)); release.resolve(); const result = await observed;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(pixels?.every(value => value === 0) && coverage?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await observed; }
});

function exposeByte(value: number): number {
	const encoded = value / 255, linear = encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4;
	const doubled = Math.min(1, linear * 2); return Math.round(255 * (doubled <= .0031308 ? doubled * 12.92 : 1.055 * doubled ** (1 / 2.4) - .055));
}
