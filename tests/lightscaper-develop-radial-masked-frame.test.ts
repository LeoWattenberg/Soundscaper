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

function radial(center = { x: 0.5, y: 0.5 }, radius = { x: 0.5, y: 0.5 }, innerFraction = 0) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [
		{ id: 'radial', kind: 'radial-gradient', center: { ...center }, radius: { ...radius }, innerFraction },
	], outputNodeId: 'radial' };
}
const ALPHA = [0, 1, 127, 254, 255];
const SOURCE = ALPHA.flatMap(alpha => [64, 128, 192, alpha]);
// Independent sRGB decode/interpolate/encode at [51,153,255,153,51]. The full LUT pixel is [137,0,0].
const LUT_RGB = [[85, 115, 174], [115, 83, 127], [137, 0, 0], [115, 83, 127], [85, 115, 174]];
const EXPECTED = LUT_RGB.flatMap((rgb, index) => [...rgb, ALPHA[index]!]);

test('radial LUT coverage blends linear RGB with exact source alpha and preserves original and resource bytes', async () => {
	for (const render of [withPhotoDevelopProxyFrameV2, withPhotoDevelopFullResolutionFrameV2]) {
		const frame = rgbaFrame(SOURCE), source = lutSource(), body = [...LUT_BODY]; let borrowed: Uint8Array | undefined;
		const result = await render({ frame, develop: maskedDevelop([profile()], radial()) }, view => {
			borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		}, { source: source.port });
		assert.deepEqual(result.pixels, EXPECTED); assert.equal(source.calls(), 1);
		assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 4);
		assert.equal(result.histogram.bins.red[137], 1); assert.equal(result.histogram.bins.red[115], 2);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], SOURCE); assert.deepEqual([...LUT_BODY], body);
	}
});

test('radial color and neighborhood detail use their processed stage, with exact outside/full endpoints and disabled neutrality', async () => {
	const frame = rgbaFrame(SOURCE), warm = createVideoEffect('white-balance-v1', { id: 'warm', params: { temperature: 100 } });
	const color = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([warm], radial()) }, view => [...view.frame.pixels]);
	assert.deepEqual(color, [[70, 128, 183], [81, 128, 163], [90, 128, 140], [81, 128, 163], [70, 128, 183]].flatMap((rgb, i) => [...rgb, ALPHA[i]!]));
	const pixels = [40, 100, 160, 220].flatMap(value => [value, value, value, 255]);
	const detail = createVideoEffect('detail-sharpen-v1', { id: 'detail', params: { amount: 50, threshold: 0 } });
	const sharpened = await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(pixels), develop: maskedDevelop([detail], radial()) }, view => [...view.frame.pixels]);
	// Full independent row [33,100,160,228], radial coverage [64,191,191,64].
	assert.deepEqual(sharpened, [38, 100, 160, 222].flatMap(value => [value, value, value, 255]));
	const source = lutSource(), endpoints = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], radial({ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 })) }, view => [...view.frame.pixels], { source: source.port });
	assert.deepEqual(endpoints, [137, 0, 0, 0, ...SOURCE.slice(4)]);
	let reflected = 0;
	const unused = new Proxy({} as CubeLutSourcePortV1, { getOwnPropertyDescriptor() { reflected++; throw Error('Disabled radial LUT acquired a resource'); } });
	assert.deepEqual(await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile(false)], radial()) }, view => [...view.frame.pixels], { source: unused }), SOURCE);
	assert.equal(reflected, 0); assert.deepEqual([...frame.pixels], SOURCE);
});

test('actual Photo and packed Frame share the radial mixed-effect order without changing original or pack bytes', async () => {
	const invert = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	// The actual Frame pack admits canonical zero RGB beneath zero alpha.
	const pixels = [0, 0, 0, 0, ...SOURCE.slice(4)];
	for (const [effects, expectedRgb] of [
		[[profile(), invert], [[192, 255, 255], [140, 172, 128], [118, 255, 255], [140, 172, 128], [170, 140, 81]]],
		[[invert, profile()], [[237, 231, 231], [161, 82, 39], [137, 0, 0], [161, 82, 39], [182, 114, 56]]],
	] as const) {
		const develop = maskedDevelop(effects, radial(), ['profile']), f = frameImageFixture(develop, pixels), source = lutSource();
		const original = [...f.original], pack = [...f.pack.bytes], expected = expectedRgb.flatMap((rgb, i) => [...rgb, ALPHA[i]!]);
		const photo = await withPhotoDevelopFullResolutionFrameV2({ frame: rgbaFrame(pixels), develop }, view => [...view.frame.pixels], { source: source.port });
		let borrowed: Uint8Array | undefined;
		const frame = await withFramescaperImageDevelopFrameV2(f.request, view => { borrowed = view.frame.pixels; return [...view.frame.pixels]; }, { source: source.port });
		assert.deepEqual(photo, expected); assert.deepEqual(frame, expected); assert.ok(f.reads() > 0);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...f.original], original); assert.deepEqual([...f.pack.bytes], pack);
	}
});

test('explicit radial overlay stages normalize at the selected input then project the actual crop and flip', async () => {
	const first = createVideoEffect('white-balance-v1', { id: 'first' });
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.6 } });
	const second = createVideoEffect('detail-sharpen-v1', { id: 'second', params: { amount: 50 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = maskedDevelop([first, crop, second, flip], radial(), ['first', 'second']), wire = JSON.stringify(develop);
	for (const [effectId, expected] of [['first', [255, 153, 51]], ['second', [85, 255, 85]]] as const) {
		let borrowed: Uint8Array | undefined;
		const result = await withImageDevelopMaskOverlayV1({ develop, source: { width: 5, height: 1 }, maskId: 'mask', effectId }, view => {
			assert.equal(view.width, 3); assert.equal(view.height, 1); assert.equal(view.effectId, effectId); borrowed = view.coverage; return [...view.coverage];
		}, PHOTO_DEVELOP_PROXY_LIMITS_V1);
		assert.deepEqual(result, expected); assert.ok(borrowed?.every(byte => byte === 0));
	}
	assert.equal(JSON.stringify(develop), wire);
	await assert.rejects(withImageDevelopMaskOverlayV1({ develop, source: { width: 5, height: 1 }, maskId: 'mask', effectId: 'crop' }, () => {}, PHOTO_DEVELOP_PROXY_LIMITS_V1), /binding/iu);
});

test('a held radial output joins opaque cancellation before wiping output and resource backings', async () => {
	const frame = rgbaFrame(SOURCE), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let output: Uint8Array | undefined, body: Uint8Array | undefined;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const owned = new Uint8Array(LUT_BODY); body = owned;
		try { return await consume(owned); } finally { owned.fill(0); }
	} };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], radial()), signal: stop.signal }, async view => {
		output = view.frame.pixels; assert.deepEqual([...output], EXPECTED); entered.resolve(); await release.promise;
	}, { source: port });
	const observed = work.then(() => ({ failed: false, error: undefined as unknown }), error => ({ failed: true, error: error as unknown }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual([...(output ?? [])], EXPECTED); }
	finally { release.resolve(); await observed; }
	const result = await observed; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(output?.every(byte => byte === 0)); assert.ok(body?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], SOURCE);
});

test('radial request and source bytes are captured before a resource await, and projected coverage clears after cancellation', async () => {
	const frame = rgbaFrame(SOURCE), mask = radial(), entered = deferred<void>(), release = deferred<void>();
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(LUT_BODY); } };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], mask) }, view => [...view.frame.pixels], { source: port });
	const settled = work.then(() => {}, () => {});
	try { await Promise.race([entered.promise, work]); mask.nodes[0]!.radius.x = 0.1; mask.nodes[0]!.innerFraction = 0.9; frame.pixels.fill(0); }
	finally { release.resolve(); await settled; }
	assert.deepEqual(await work, EXPECTED);
	const warm = createVideoEffect('white-balance-v1', { id: 'warm' }), flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const hold = deferred<void>(), ready = deferred<void>(), stop = new AbortController(); let borrowed: Uint8Array | undefined;
	const reason = Object.freeze({ retired: true });
	const overlay = withImageDevelopMaskOverlayV1({ develop: maskedDevelop([warm, flip], radial(), ['warm']), source: { width: 5, height: 1 }, maskId: 'mask', effectId: 'warm', signal: stop.signal }, async view => {
		borrowed = view.coverage; ready.resolve(); await hold.promise;
	}, PHOTO_DEVELOP_PROXY_LIMITS_V1);
	const outcome = overlay.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	try { await Promise.race([ready.promise, overlay]); stop.abort(reason); assert.equal(await remainsPending(overlay), true); assert.deepEqual([...(borrowed ?? [])], [51, 153, 255, 153, 51]); }
	finally { hold.resolve(); await outcome; }
	assert.equal(Object.is((await outcome).error, reason), true); assert.ok(borrowed?.every(byte => byte === 0));
});
