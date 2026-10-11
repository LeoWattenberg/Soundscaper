/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { withPhotoDevelopProxyFrameV2, withPhotoDevelopFullResolutionFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { withFramescaperImageDevelopFrameV2 } from '../src/framescaper/timeline-image-develop-frame-v2.ts';
import { withImageDevelopMaskOverlayV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { LUT_BODY, maskedDevelop, rgbaFrame, profile, lutSource, frameImageFixture } from './helpers/lightscaper-masked-frame-fixture.ts';

const PIXELS = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
	255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 0, 128, 0, 0, 0, 0];
const EXPECTED = [0, 0, 0, 255, 99, 240, 240, 255, 0, 255, 0, 255, 221, 221, 144, 255,
	255, 255, 255, 255, 127, 127, 127, 255, 99, 240, 240, 128, 0, 0, 0, 0];
// Literal coverage [0,223,0,184,0,215,223,0], then independent decoded-linear-RGB interpolation to 255-RGB.
function range(lower = 0.1, upper = 0.2, falloff = 0.1) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'range', kind: 'luminance-range', lower, upper, falloff }], outputNodeId: 'range' };
}
function invert(id = 'invert', enabled = true) {
	return createVideoEffect('point-curves-v1', { id, enabled, params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
}

test('luminance range reads the selected adjustment input, blends linear RGB and agrees across proxy/full/actual packed Frame', async () => {
	const develop = maskedDevelop([invert()], range()), fixture = frameImageFixture(develop, PIXELS);
	const original = [...fixture.original], packed = [...fixture.pack.bytes];
	for (const render of [withPhotoDevelopProxyFrameV2, withPhotoDevelopFullResolutionFrameV2]) {
		const frame = rgbaFrame(PIXELS); let borrowed: Uint8Array | undefined;
		const result = await render({ frame, develop }, view => {
			borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		});
		assert.deepEqual(result.pixels, EXPECTED); assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 7);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], PIXELS);
	}
	let borrowed: Uint8Array | undefined;
	const frame = await withFramescaperImageDevelopFrameV2(fixture.request, view => { borrowed = view.frame.pixels; return [...view.frame.pixels]; });
	assert.deepEqual(frame, EXPECTED); assert.ok(fixture.reads() > 0); assert.ok(borrowed?.every(byte => byte === 0));
	assert.deepEqual([...fixture.original], original); assert.deepEqual([...fixture.pack.bytes], packed);
});

test('prior tone and LUT output changes range membership while the selected effect cannot choose its own coverage', async () => {
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }), gray = rgbaFrame([128, 128, 128, 255]);
	assert.deepEqual(await withPhotoDevelopProxyFrameV2({ frame: gray, develop: maskedDevelop([tone, invert()], range(0.4, 0.5, 0), ['invert']) }, view => [...view.frame.pixels]), [79, 79, 79, 255]);
	assert.deepEqual(await withPhotoDevelopProxyFrameV2({ frame: gray, develop: maskedDevelop([invert(), tone], range(0.4, 0.5, 0), ['invert']) }, view => [...view.frame.pixels]), [176, 176, 176, 255]);
	const source = lutSource(), frame = rgbaFrame(PIXELS), resource = [...LUT_BODY];
	const afterLut = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile(), invert()], range(0.05, 0.06, 0), ['invert']) }, view => [...view.frame.pixels], { source: source.port });
	assert.deepEqual(afterLut, [255, 255, 255, 255, 255, 255, 128, 0].flatMap(alpha => [...(alpha === 0 ? [137, 0, 0] : [118, 255, 255]), alpha]));
	const beforeLut = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([invert(), profile()], range(0.05, 0.06, 0), ['invert']) }, view => [...view.frame.pixels], { source: source.port });
	assert.deepEqual(beforeLut, [255, 255, 255, 255, 255, 255, 128, 0].flatMap(alpha => [137, 0, 0, alpha]));
	assert.equal(source.calls(), 2); assert.deepEqual([...frame.pixels], PIXELS); assert.deepEqual([...LUT_BODY], resource);
});

test('one graph reused at equal-size effect stages reevaluates actual membership and observes an explicit chosen stage', async () => {
	const develop = maskedDevelop([invert('first'), invert('second')], range()), expected = [...EXPECTED]; expected.splice(20, 3, 128, 128, 128);
	for (const [effectId, coverage] of [['first', [0, 223, 0, 184, 0, 215, 223, 0]], ['second', [0, 0, 0, 0, 0, 224, 0, 0]]] as const) {
		let borrowed: Uint8Array | undefined;
		const result = await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(PIXELS), develop, maskOverlay: { maskId: 'mask', effectId } }, view => {
			assert.ok(view.maskOverlay); assert.equal(view.maskOverlay.maskId, 'mask'); assert.equal(view.maskOverlay.effectId, effectId);
			assert.equal(view.maskOverlay.width, 8); assert.equal(view.maskOverlay.height, 1); borrowed = view.maskOverlay.coverage;
			return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		});
		assert.deepEqual(result.pixels, expected); assert.deepEqual(result.coverage, coverage); assert.ok(borrowed?.every(value => value === 0));
	}
});

test('range is evaluated after prefix crop and its observed coverage follows the actual suffix flip', async () => {
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0.125, cropWidth: 0.5 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = maskedDevelop([crop, invert(), flip], range(), ['invert']); let borrowed: Uint8Array | undefined;
	const result = await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(PIXELS), develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.equal(view.frame.descriptor.width, 4); assert.equal(view.frame.descriptor.height, 1); assert.ok(view.maskOverlay);
		assert.equal(view.maskOverlay.width, 4); assert.equal(view.maskOverlay.height, 1); borrowed = view.maskOverlay.coverage;
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	});
	assert.deepEqual(result.pixels, [255, 255, 255, 255, 221, 221, 144, 255, 0, 255, 0, 255, 99, 240, 240, 255]);
	assert.deepEqual(result.coverage, [0, 184, 0, 223]); assert.ok(borrowed?.every(value => value === 0));
	await assert.rejects(withImageDevelopMaskOverlayV1({ develop, source: { width: 8, height: 1 }, maskId: 'mask', effectId: 'invert' }, () => {}, PHOTO_DEVELOP_PROXY_LIMITS_V1), /current|pixel|luminance|range/iu);
});

test('held range output and observed coverage join opaque cancellation before either backing is cleared', async () => {
	const frame = rgbaFrame(PIXELS), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let pixels: Uint8Array | undefined, coverage: Uint8Array | undefined;
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([invert()], range()), maskOverlay: { maskId: 'mask', effectId: 'invert' }, signal: stop.signal }, async view => {
		assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage;
		assert.deepEqual([...pixels], EXPECTED); assert.deepEqual([...coverage], [0, 223, 0, 184, 0, 215, 223, 0]); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), error => ({ failed: true, error: error as unknown }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual([...(pixels ?? [])], EXPECTED); assert.equal(coverage?.[1], 223); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(pixels?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0)); assert.deepEqual([...frame.pixels], PIXELS);
});

test('range scalars and source bytes are detached before a held earlier resource stage', async () => {
	const frame = rgbaFrame(PIXELS), graph = range(0.05, 0.06, 0), entered = deferred<void>(), release = deferred<void>();
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(LUT_BODY); } };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile(), invert()], graph, ['invert']) }, view => [...view.frame.pixels], { source });
	const settled = work.then(() => {}, () => {});
	try { await Promise.race([entered.promise, work]); graph.nodes[0]!.lower = 0.9; graph.nodes[0]!.upper = 1; frame.pixels.fill(0); }
	finally { release.resolve(); await settled; }
	assert.deepEqual(await work, [255, 255, 255, 255, 255, 255, 128, 0].flatMap(alpha => [...(alpha === 0 ? [137, 0, 0] : [118, 255, 255]), alpha]));
});

test('disabled range bindings remain neutral and an absent or accessor overlay stage cannot be silently substituted', async () => {
	assert.deepEqual(await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(PIXELS), develop: maskedDevelop([invert('invert', false)], range()) }, view => [...view.frame.pixels]), PIXELS);
	let acquisitions = 0, borrowed: Uint8Array | undefined;
	const source: CubeLutSourcePortV1 = { async withBytes() { acquisitions++; throw Error('Disabled LUT must not be acquired for its range overlay.'); } };
	const result = await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(PIXELS), develop: maskedDevelop([profile(false)], range()),
		maskOverlay: { maskId: 'mask', effectId: 'profile' } }, view => {
			assert.ok(view.maskOverlay); borrowed = view.maskOverlay.coverage;
			return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		}, { source });
	assert.deepEqual(result.pixels, PIXELS); assert.deepEqual(result.coverage, [0, 223, 0, 184, 0, 215, 223, 0]);
	assert.equal(acquisitions, 0); assert.ok(borrowed?.every(byte => byte === 0));
	let getters = 0, delivered = 0;
	const develop = maskedDevelop([invert()], range()), accessor = Object.defineProperty({ maskId: 'mask' }, 'effectId', { enumerable: true, get() { getters++; return 'invert'; } });
	for (const maskOverlay of [accessor, { maskId: 'mask', effectId: 'absent' }]) {
		await assert.rejects(withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(PIXELS), develop, maskOverlay }, () => { delivered++; }));
	}
	assert.equal(getters, 0); assert.equal(delivered, 0);
});
