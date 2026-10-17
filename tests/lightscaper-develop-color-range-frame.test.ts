/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { withFramescaperImageDevelopFrameV2 } from '../src/framescaper/timeline-image-develop-frame-v2.ts';
import { withImageDevelopMaskOverlayV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { LUT_BODY, maskedDevelop, rgbaFrame, profile, lutSource, frameImageFixture } from './helpers/lightscaper-masked-frame-fixture.ts';

const PIXELS = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
	255, 255, 255, 255, 128, 128, 128, 255, 188, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0];
const COVERAGE = [108, 255, 47, 47, 47, 131, 182, 255, 0];
// Independent scalar IEC sRGB decoding, literal coverage, linear interpolation
// toward the encoded inversion, and one final sRGB byte rounding.
const EXPECTED = [174, 174, 174, 255, 0, 255, 255, 255, 119, 233, 119, 255, 119, 119, 233, 255,
	233, 233, 233, 255, 127, 127, 127, 255, 119, 220, 220, 255, 0, 255, 255, 128, 0, 0, 0, 0];
function range(radius = 0, falloff = 1, color = { r: 1, g: 0, b: 0 }) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'color', kind: 'color-range', color, radius, falloff }], outputNodeId: 'color' };
}
function invert(id = 'invert', enabled = true) {
	return createVideoEffect('point-curves-v1', { id, enabled, params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
}
function recipe(effects: Parameters<typeof maskedDevelop>[0], graph: unknown = range(), bindings?: readonly string[]) {
	return normalizeImageDevelopStateV1OrV2(maskedDevelop(effects, graph, bindings === undefined ? undefined : [...bindings]));
}

test('actual runtime proxy/full and authenticated packed Frame agree on color coverage, linear blend and unchanged originals', async () => {
	const develop = recipe([invert()]), fixture = frameImageFixture(develop, PIXELS), actual = createPhotoDevelopRenderRuntimeV2();
	const original = [...fixture.original], pack = [...fixture.pack.bytes];
	for (const render of [actual.withProxy, actual.withFullResolution]) {
		const frame = rgbaFrame(PIXELS), stop = new AbortController(); let borrowed: PixelFrameV1['pixels'] | undefined;
		const result = await render({ frame, develop, signal: stop.signal }, output => {
			borrowed = output.frame.pixels; return { pixels: [...output.frame.pixels], histogram: output.histogram };
		});
		assert.deepEqual(result.pixels, EXPECTED); assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 8);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], PIXELS);
	}
	let borrowed: Uint8Array | undefined;
	assert.deepEqual(await withFramescaperImageDevelopFrameV2(fixture.request, output => { borrowed = output.frame.pixels; return [...output.frame.pixels]; }), EXPECTED);
	assert.ok(fixture.reads() > 0); assert.ok(borrowed?.every(byte => byte === 0));
	assert.deepEqual([...fixture.original], original); assert.deepEqual([...fixture.pack.bytes], pack);
});

test('color membership follows earlier tone and LUT while the bound adjustment cannot select its own output', async () => {
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }), frame = rgbaFrame([255, 0, 0, 255]);
	const actual = createPhotoDevelopRenderRuntimeV2(), signal = new AbortController().signal;
	assert.deepEqual(await actual.withProxy({ frame, develop: recipe([tone, invert()], range(), ['invert']), signal }, output => [...output.frame.pixels]), [119, 220, 220, 255]);
	assert.deepEqual(await actual.withProxy({ frame, develop: recipe([invert(), tone], range(), ['invert']), signal }, output => [...output.frame.pixels]), [0, 188, 188, 255]);
	const source = lutSource(), resource = [...LUT_BODY], runtime = createPhotoDevelopRenderRuntimeV2({ source: source.port });
	assert.deepEqual(await runtime.withProxy({ frame, develop: recipe([profile(), invert()], range(), ['invert']), signal }, output => [...output.frame.pixels]), [127, 199, 199, 255]);
	assert.deepEqual(await runtime.withProxy({ frame, develop: recipe([invert(), profile()], range(), ['invert']), signal }, output => [...output.frame.pixels]), [137, 0, 0, 255]);
	assert.equal(source.calls(), 2); assert.deepEqual([...frame.pixels], [255, 0, 0, 255]); assert.deepEqual([...LUT_BODY], resource);
});

test('the same graph at unchanged extent samples each exact effect input and the requested overlay stage', async () => {
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }), develop = recipe([tone, invert()]);
	const actual = createPhotoDevelopRenderRuntimeV2();
	for (const [effectId, coverage] of [['tone', [255]], ['invert', [182]]] as const) {
		let borrowed: Uint8Array | undefined;
		const result = await actual.withProxy({ frame: rgbaFrame([255, 0, 0, 255]), develop, signal: new AbortController().signal,
			maskOverlay: { maskId: 'mask', effectId } }, output => {
			assert.ok(output.maskOverlay); assert.equal(output.maskOverlay.effectId, effectId); borrowed = output.maskOverlay.coverage;
			return { pixels: [...output.frame.pixels], coverage: [...output.maskOverlay.coverage] };
		});
		assert.deepEqual(result, { pixels: [119, 220, 220, 255], coverage }); assert.ok(borrowed?.every(byte => byte === 0));
	}
});

test('color sees prefix geometry and its borrowed selected-stage coverage follows suffix geometry', async () => {
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 1 / 9, cropWidth: 4 / 9 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = recipe([crop, invert(), flip], range(), ['invert']), actual = createPhotoDevelopRenderRuntimeV2(); let borrowed: Uint8Array | undefined;
	const result = await actual.withProxy({ frame: rgbaFrame(PIXELS), develop, signal: new AbortController().signal,
		maskOverlay: { maskId: 'mask', effectId: 'invert' } }, output => {
		assert.ok(output.maskOverlay); assert.equal(output.frame.descriptor.width, 4); assert.equal(output.maskOverlay.width, 4);
		assert.equal(output.maskOverlay.height, 1); borrowed = output.maskOverlay.coverage;
		return { pixels: [...output.frame.pixels], coverage: [...output.maskOverlay.coverage] };
	});
	assert.deepEqual(result.pixels, [233, 233, 233, 255, 119, 119, 233, 255, 119, 233, 119, 255, 0, 255, 255, 255]);
	assert.deepEqual(result.coverage, [47, 47, 47, 255]); assert.ok(borrowed?.every(byte => byte === 0));
	await assert.rejects(withImageDevelopMaskOverlayV1({ develop, source: { width: 9, height: 1 }, maskId: 'mask', effectId: 'invert' }, () => {}, PHOTO_DEVELOP_PROXY_LIMITS_V1), /current|pixel|range/iu);
});

test('held actual runtime pixels and coverage join opaque cancellation before their backing retirement', async () => {
	const frame = rgbaFrame(PIXELS), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), actual = createPhotoDevelopRenderRuntimeV2();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let pixels: PixelFrameV1['pixels'] | undefined, coverage: Uint8Array | undefined;
	const work = actual.withProxy({ frame, develop: recipe([invert()]), signal: stop.signal, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, async output => {
		assert.ok(output.maskOverlay); pixels = output.frame.pixels; coverage = output.maskOverlay.coverage;
		assert.deepEqual([...pixels], EXPECTED); assert.deepEqual([...coverage], COVERAGE); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual([...(pixels ?? [])], EXPECTED); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(pixels?.every(byte => byte === 0)); assert.ok(coverage?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], PIXELS);
});

test('source bytes and encoded target detach before an earlier resource await, while disabled resource overlays acquire nothing', async () => {
	const frame = rgbaFrame([255, 0, 0, 255]), graph = range(), entered = deferred<void>(), release = deferred<void>();
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(LUT_BODY); } };
	const actual = createPhotoDevelopRenderRuntimeV2({ source });
	const work = actual.withProxy({ frame, develop: recipe([profile(), invert()], graph, ['invert']), signal: new AbortController().signal }, output => [...output.frame.pixels]);
	const settled = work.then(() => {}, () => {});
	try { await Promise.race([entered.promise, work]); graph.nodes[0]!.color.r = 0; graph.nodes[0]!.radius = 1; frame.pixels.fill(0); }
	finally { release.resolve(); await settled; }
	assert.deepEqual(await work, [127, 199, 199, 255]);
	let acquisitions = 0, borrowed: Uint8Array | undefined;
	const disabled = createPhotoDevelopRenderRuntimeV2({ source: { async withBytes() { acquisitions++; throw Error('Disabled LUT acquired color resources'); } } });
	const result = await disabled.withProxy({ frame: rgbaFrame(PIXELS), develop: recipe([profile(false)]), signal: new AbortController().signal,
		maskOverlay: { maskId: 'mask', effectId: 'profile' } }, output => {
		assert.ok(output.maskOverlay); borrowed = output.maskOverlay.coverage; return { pixels: [...output.frame.pixels], coverage: [...borrowed] };
	});
	assert.deepEqual(result, { pixels: PIXELS, coverage: COVERAGE }); assert.equal(acquisitions, 0); assert.ok(borrowed?.every(byte => byte === 0));
});
