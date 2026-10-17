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
import { SOURCE_RGBA, LUT_BODY, gradientGraph, rectangleGraph, maskedDevelop, rgbaFrame, profile, lutSource, frameImageFixture } from './helpers/lightscaper-masked-frame-fixture.ts';

// Independent sRGB decode/interpolate/encode calculations at coverage [32,96,159,223].
// The constant resource's processed pixel is [137,0,0]; interpolation of encoded bytes would differ.
const LUT_RGB = [[78, 120, 181], [100, 103, 155], [116, 81, 123], [131, 46, 73]];
const ALPHA = [0, 1, 127, 255];
const lutExpected = LUT_RGB.flatMap((rgb, index) => [...rgb, ALPHA[index]!]);

test('masked LUT interpolation is linear RGB with exact input alpha and leaves the source and resource untouched', async () => {
	for (const render of [withPhotoDevelopProxyFrameV2, withPhotoDevelopFullResolutionFrameV2]) {
		const frame = rgbaFrame(), source = lutSource(), body = [...LUT_BODY]; let borrowed: Uint8Array | undefined;
		const result = await render({ frame, develop: maskedDevelop([profile()]) }, view => {
			borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		}, { source: source.port });
		assert.deepEqual(result.pixels, lutExpected); assert.equal(source.calls(), 1);
		assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 3);
		assert.equal(result.histogram.bins.red[100], 1); assert.equal(result.histogram.bins.red[131], 1);
		assert.ok(borrowed?.every(byte => byte === 0));
		assert.deepEqual([...frame.pixels], SOURCE_RGBA); assert.deepEqual([...LUT_BODY], body);
	}
});

test('same-extent color and neighborhood detail effects use their actual processed stage under the mask', async () => {
	const warm = createVideoEffect('white-balance-v1', { id: 'warm', params: { temperature: 100 } });
	const color = await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(), develop: maskedDevelop([warm]) }, view => [...view.frame.pixels]);
	assert.deepEqual(color, [[68, 128, 186], [75, 128, 175], [81, 128, 162], [87, 128, 148]].flatMap((rgb, index) => [...rgb, ALPHA[index]!]));
	const pixels = [40, 100, 160, 220].flatMap(value => [value, value, value, 255]), frame = rgbaFrame(pixels);
	const sharpen = createVideoEffect('detail-sharpen-v1', { id: 'detail', params: { amount: 50, threshold: 0 } });
	const detail = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([sharpen]) }, view => [...view.frame.pixels]);
	// The independently rounded full sharpen row is [33,100,160,228].
	assert.deepEqual(detail, [39, 100, 160, 227].flatMap(value => [value, value, value, 255]));
	assert.deepEqual([...frame.pixels], pixels);
});

test('old rectangle coverage preserves zero/full endpoints byte-for-byte and disabled bindings remain neutral', async () => {
	const frame = rgbaFrame(), source = lutSource();
	const pixels = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], rectangleGraph()) }, view => [...view.frame.pixels], { source: source.port });
	assert.deepEqual(pixels, [64, 128, 192, 0, 64, 128, 192, 1, 137, 0, 0, 127, 137, 0, 0, 255]);
	let reflected = 0;
	const unused = new Proxy({} as CubeLutSourcePortV1, { getOwnPropertyDescriptor() { reflected++; throw Error('Disabled LUT source was inspected'); } });
	const neutral = await withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile(false)]) }, view => [...view.frame.pixels], { source: unused });
	assert.deepEqual(neutral, SOURCE_RGBA); assert.equal(reflected, 0); assert.deepEqual([...frame.pixels], SOURCE_RGBA);
});

test('Photo and actual packed Frame evaluate the same authored mixed stack rather than grouping masked effects', async () => {
	const invert = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	// The actual Frame pack requires canonical zero RGB beneath zero alpha.
	const pixels = [0, 0, 0, 0, ...SOURCE_RGBA.slice(4)];
	for (const [effects, expectedRgb] of [
		[[profile(), invert], [[205, 255, 255], [155, 152, 100], [139, 174, 132], [124, 209, 182]]],
		[[invert, profile()], [[244, 240, 240], [173, 102, 49], [160, 80, 37], [145, 45, 18]]],
	] as const) {
		const develop = maskedDevelop(effects, gradientGraph(), ['profile']), f = frameImageFixture(develop, pixels), source = lutSource();
		const original = [...f.original], packed = [...f.pack.bytes], expected = expectedRgb.flatMap((rgb, index) => [...rgb, ALPHA[index]!]);
		const photo = await withPhotoDevelopFullResolutionFrameV2({ frame: rgbaFrame(pixels), develop }, view => [...view.frame.pixels], { source: source.port });
		let borrowed: Uint8Array | undefined;
		const frame = await withFramescaperImageDevelopFrameV2(f.request, view => { borrowed = view.frame.pixels; return [...view.frame.pixels]; }, { source: source.port });
		assert.deepEqual(photo, expected); assert.deepEqual(frame, expected); assert.ok(f.reads() > 0);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...f.original], original); assert.deepEqual([...f.pack.bytes], packed);
	}
});

test('geometry and externally sourced mask bindings refuse before source pixels are inspected', async () => {
	let reflected = 0, deliveries = 0;
	const pixels = new Proxy({}, { ownKeys() { reflected++; throw Error('Invalid mask reached pixel admission'); } });
	const unread = new Proxy({}, { ownKeys() { reflected++; throw Error('Invalid mask reached source admission'); } });
	const metadata = { descriptor: rgbaFrame().descriptor, pixels };
	const geometry = createVideoEffect('develop-geometry-v1', { id: 'geometry', params: { cropWidth: 0.5 } });
	const external = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'Body', sourceRef: 'body', kind: 'raster' }],
		nodes: [{ id: 'raster', kind: 'raster', inputName: 'Body', channel: 'luma' }], outputNodeId: 'raster' };
	for (const frame of [unread, metadata]) {
		await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([geometry], rectangleGraph()) }, () => { deliveries++; }), /geometry/iu);
		await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], external) }, () => { deliveries++; }), /external|self-contained|input/iu);
	}
	assert.equal(reflected, 0); assert.equal(deliveries, 0);
});

test('held masked delivery joins opaque cancellation before wiping its output and resource backings', async () => {
	const frame = rgbaFrame(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let output: Uint8Array | undefined, body: Uint8Array | undefined;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const owned = new Uint8Array(LUT_BODY); body = owned;
		try { return await consume(owned); } finally { owned.fill(0); }
	} };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()]), signal: stop.signal }, async view => {
		output = view.frame.pixels; assert.deepEqual([...output], lutExpected); entered.resolve(); await release.promise;
	}, { source: port });
	const observed = work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); }
	finally { release.resolve(); await observed; }
	const result = await observed; assert.equal(result.failed, true); assert.equal(Object.is(result.reason, reason), true);
	assert.ok(output?.every(byte => byte === 0)); assert.ok(body?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], SOURCE_RGBA);
});

test('the admitted gradient and source are detached before an asynchronous resource read', async () => {
	const frame = rgbaFrame(), mask = gradientGraph(), entered = deferred<void>(), release = deferred<void>();
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(LUT_BODY); } };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: maskedDevelop([profile()], mask) }, view => [...view.frame.pixels], { source: port });
	const observed = work.then(value => ({ value }), error => ({ error: error as unknown }));
	try { await Promise.race([entered.promise, work]); mask.nodes[0]!.end.x = 0.5; frame.pixels.fill(0); }
	finally { release.resolve(); await observed; }
	assert.deepEqual(await work, lutExpected);
});

test('the same graph overlays at its explicit effect input before projecting each geometry suffix', async () => {
	const first = createVideoEffect('white-balance-v1', { id: 'first' });
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } });
	const second = createVideoEffect('detail-sharpen-v1', { id: 'second', params: { amount: 50 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = maskedDevelop([first, crop, second, flip], gradientGraph(), ['first', 'second']);
	const before = JSON.stringify(develop);
	for (const [effectId, expected] of [['first', [96, 32]], ['second', [191, 64]]] as const) {
		let borrowed: Uint8Array | undefined;
		const result = await withImageDevelopMaskOverlayV1({ develop, source: { width: 4, height: 1 }, maskId: 'mask', effectId }, view => {
			assert.equal(Object.isFrozen(view), true); assert.equal(view.maskId, 'mask'); assert.equal(view.effectId, effectId);
			assert.equal(view.width, 2); assert.equal(view.height, 1); borrowed = view.coverage; return [...view.coverage];
		}, PHOTO_DEVELOP_PROXY_LIMITS_V1);
		// First binds before crop: [32,96,159,223] -> [32,96] -> [96,32].
		// Second binds after crop: normalized 2x1 coverage [64,191] -> [191,64].
		assert.deepEqual(result, expected); assert.ok(borrowed?.every(byte => byte === 0));
	}
	assert.equal(JSON.stringify(develop), before);
	await assert.rejects(withImageDevelopMaskOverlayV1({ develop, source: { width: 4, height: 1 }, maskId: 'mask', effectId: 'crop' }, () => {}, PHOTO_DEVELOP_PROXY_LIMITS_V1), /binding/iu);
});

test('direct overlay coverage is borrowed until settlement and then cleared', async () => {
	const effect = createVideoEffect('white-balance-v1', { id: 'warm' }); let borrowed: Uint8Array | undefined;
	const result = await withImageDevelopMaskOverlayV1({ develop: maskedDevelop([effect]), source: { width: 4, height: 1 }, maskId: 'mask', effectId: 'warm' }, view => {
		assert.equal(view.width, 4); assert.equal(view.height, 1); borrowed = view.coverage; return [...view.coverage];
	}, PHOTO_DEVELOP_PROXY_LIMITS_V1);
	assert.deepEqual(result, [32, 96, 159, 223]); assert.ok(borrowed?.every(byte => byte === 0));
});

test('projected overlay cancellation joins a held borrower and preserves its opaque reason before clearing coverage', async () => {
	const effect = createVideoEffect('white-balance-v1', { id: 'warm' });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = maskedDevelop([effect, flip], gradientGraph(), ['warm']);
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let borrowed: Uint8Array | undefined;
	const work = withImageDevelopMaskOverlayV1({ develop, source: { width: 4, height: 1 }, maskId: 'mask', effectId: 'warm', signal: stop.signal }, async view => {
		borrowed = view.coverage; assert.deepEqual([...borrowed], [223, 159, 96, 32]); entered.resolve(); await release.promise;
	}, PHOTO_DEVELOP_PROXY_LIMITS_V1);
	const observed = work.then(() => ({ failed: false, error: undefined as unknown }), error => ({ failed: true, error: error as unknown }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual([...(borrowed ?? [])], [223, 159, 96, 32]); }
	finally { release.resolve(); await observed; }
	const result = await observed; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(borrowed?.every(byte => byte === 0));
});

test('complete reachable mask working bytes refuse before source pixels or overlay delivery', async () => {
	// 256 leaves + four 64-input unions + root = 261 reachable 512x512 byte planes.
	// Depth is only three, but 68,419,584 bytes exceeds the fixed 64 MiB mask budget.
	const groups = Array.from({ length: 4 }, (_, group) => Array.from({ length: 64 }, (_, index) => ({
		id: `gradient-${group}-${index}`, kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
	})));
	const mask = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [
		...groups.flat(), ...groups.map((nodes, group) => ({ id: `union-${group}`, kind: 'boolean', operation: 'union', inputNodeIds: nodes.map(node => node.id) })),
		{ id: 'root', kind: 'boolean', operation: 'union', inputNodeIds: groups.map((_, group) => `union-${group}`) },
	], outputNodeId: 'root' };
	const effect = createVideoEffect('white-balance-v1', { id: 'warm' }), develop = maskedDevelop([effect], mask);
	let reflected = 0, delivered = 0;
	const pixels = new Proxy({}, { ownKeys() { reflected++; throw Error('Oversized mask inspected pixels'); } });
	const descriptor = { ...rgbaFrame().descriptor, width: 512, height: 512 };
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame: { descriptor, pixels }, develop }, () => { delivered++; }), /64 MiB|working.*budget/iu);
	await assert.rejects(withImageDevelopMaskOverlayV1({ develop, source: { width: 512, height: 512 }, maskId: 'mask', effectId: 'warm' }, () => { delivered++; }, PHOTO_DEVELOP_PROXY_LIMITS_V1), /64 MiB|working.*budget/iu);
	assert.equal(reflected, 0); assert.equal(delivered, 0);
});
