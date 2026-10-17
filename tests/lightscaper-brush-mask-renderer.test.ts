/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import type { PhotoDevelopFrameViewV1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import { withImageDevelopMaskOverlayV1, type ImageDevelopMaskOverlayViewV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { maskedDevelop, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function brush(alpha: readonly number[], width = alpha.length, height = 1) {
	return withPreparedBrushMaskResourceV1({ width, height, alpha: new Uint8Array(alpha) }, prepared =>
		({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
}
function graph(sourceRef: string, raster = false) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'paint', sourceRef, kind: raster ? 'raster' : 'alpha' }],
		nodes: [raster ? { id: 'painted', kind: 'raster', inputName: 'paint', channel: 'alpha' } :
			{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
}
function invert() { return createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }); }
function render<Result>(request: unknown, consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, maskSource?: MaskRasterSourcePortV1): Promise<Result> {
	return Reflect.apply(withPhotoDevelopProxyFrameV2, undefined, [request, consume, maskSource ? { maskSource } : {}]) as Promise<Result>;
}
function overlay<Result>(request: unknown, consume: (view: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>, maskSource: MaskRasterSourcePortV1): Promise<Result> {
	return Reflect.apply(withImageDevelopMaskOverlayV1, undefined, [request, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, { maskSource }]) as Promise<Result>;
}
function mixedGraph(sourceRef: string) {
	return { ...graph(sourceRef), nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' },
		{ id: 'luma', kind: 'luminance-range', lower: 0.2, upper: 0.22, falloff: 0 },
		{ id: 'color', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 0 },
		{ id: 'combined', kind: 'boolean', operation: 'intersect', inputNodeIds: ['painted', 'luma', 'color'] }], outputNodeId: 'combined' };
}

test('explicit Photo brush rendering uses nearest resource coverage, exact endpoints and unchanged source alpha', async () => {
	const body = await brush([0, 255]), frame = rgbaFrame([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255]);
	const original = [...frame.pixels], encoded = [...body.bytes]; let reads = 0, borrowed: Uint8Array | undefined, overlay: Uint8Array | undefined;
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.deepEqual(reference, body.reference); reads++; return consume(body.bytes);
	} };
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([invert()], graph(body.reference.storageKey)));
	const result = await render({ frame, develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); borrowed = view.frame.pixels; overlay = view.maskOverlay.coverage;
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	}, port);
	assert.deepEqual(result, { pixels: [0, 0, 0, 0, 0, 0, 0, 128, 255, 255, 255, 255], coverage: [0, 0, 255] });
	assert.equal(reads, 1); assert.ok(borrowed?.every(value => value === 0)); assert.ok(overlay?.every(value => value === 0));
	assert.deepEqual([...frame.pixels], original); assert.deepEqual([...body.bytes], encoded);
});

test('raster alpha coverage blends in decoded linear RGB without a second alpha attenuation', async () => {
	const body = await brush([0, 64, 128, 255]), frame = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255]);
	const port: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([invert()], graph(body.reference.storageKey, true)));
	// Independent IEC sRGB encoding of linear coverage 0,64/255,128/255,1.
	assert.deepEqual(await render({ frame, develop }, view => [...view.frame.pixels], port),
		[0, 0, 0, 255, 137, 137, 137, 128, 188, 188, 188, 1, 255, 255, 255, 255]);
});

test('the default Photo authority refuses brush before inspecting source pixels or acquiring bodies', async () => {
	const body = await brush([255]); let reflected = 0, consumed = 0;
	const frame = new Proxy({}, { ownKeys() { reflected++; throw Error('Unsupported brush inspected pixels'); } });
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([invert()], graph(body.reference.storageKey)));
	await assert.rejects(render({ frame, develop }, () => { consumed++; }));
	assert.equal(reflected, 0); assert.equal(consumed, 0);
});

test('standalone overlay explicitly authenticates brush and projects selected coverage through geometry', async () => {
	const body = await brush([0, 255]), flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([invert(), flip], graph(body.reference.storageKey), ['invert']));
	let reads = 0, borrowed: Uint8Array | undefined;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { reads++; return consume(body.bytes); } };
	const request = { develop, source: { width: 3, height: 1 }, maskId: 'mask', effectId: 'invert' };
	const consume = (view: Readonly<ImageDevelopMaskOverlayViewV1>) => { borrowed = view.coverage; return [...view.coverage]; };
	const work = Reflect.apply(withImageDevelopMaskOverlayV1, undefined, [request, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, { maskSource }]) as Promise<number[]>;
	assert.deepEqual(await work, [255, 0, 0]); assert.equal(reads, 1); assert.ok(borrowed?.every(value => value === 0));
});

test('two-dimensional nearest sampling retains all four independent brush levels without RGBA expansion', async () => {
	const body = await brush([0, 64, 128, 255], 2, 2), frame = rgbaFrame(Array.from({ length: 8 }, () => [0, 0, 0, 255]).flat());
	frame.descriptor.width = 4; frame.descriptor.height = 2;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([invert()], graph(body.reference.storageKey)));
	const result = await render({ frame, develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage], width: view.frame.descriptor.width, height: view.frame.descriptor.height };
	}, maskSource);
	assert.deepEqual(result, { pixels: [0, 0, 137, 137, 188, 188, 255, 255].flatMap(value => [value, value, value, 255]),
		coverage: [0, 0, 64, 64, 128, 128, 255, 255], width: 4, height: 2 });
});

test('one brush plus luminance and color samples each bound effect input rather than its output or earlier cached signal', async () => {
	const body = await brush([255]), frame = rgbaFrame([255, 0, 0, 128]);
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } });
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([tone, invert()], mixedGraph(body.reference.storageKey)));
	let reads = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { reads++; return consume(body.bytes); } };
	// Red has linear luminance .2126 and is the exact encoded color target.
	// Exposure -1 produces encoded188, outside both hard membership tests.
	for (const [effectId, expected] of [['tone', [255]], ['invert', [0]]] as const) {
		const result = await render({ frame, develop, maskOverlay: { maskId: 'mask', effectId } }, view => {
			assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		}, maskSource);
		assert.deepEqual(result, { pixels: [188, 0, 0, 128], coverage: expected });
	}
	assert.equal(reads, 2); assert.deepEqual([...frame.pixels], [255, 0, 0, 128]);
});

test('resource coordinates use the cropped effect input and exact observed coverage follows suffix geometry', async () => {
	const body = await brush([0, 255]), crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([crop, invert(), flip], graph(body.reference.storageKey), ['invert']));
	const frame = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255]);
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const result = await render({ frame, develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage], width: view.maskOverlay.width };
	}, maskSource);
	assert.deepEqual(result, { pixels: [255, 255, 255, 128, 0, 0, 0, 255], coverage: [255, 0], width: 2 });
	assert.deepEqual([...frame.pixels], [0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255]);
});

test('standalone mixed overlay snapshots exact currentFrame before a held source authentication await', async () => {
	const body = await brush([255]), currentFrame = rgbaFrame([255, 0, 0, 128]), entered = deferred<void>(), release = deferred<void>();
	const rawGraph = mixedGraph(body.reference.storageKey), develop = maskedDevelop([invert()], rawGraph);
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(body.bytes); } };
	const work = overlay({ develop, source: { width: 1, height: 1 }, currentFrame, maskId: 'mask', effectId: 'invert' }, view => [...view.coverage], maskSource);
	const settled = work.then(() => {}, () => {});
	try { await Promise.race([entered.promise, work]); currentFrame.pixels.fill(0); rawGraph.inputs[0]!.sourceRef = 'brush-mask-v2:1:1:future'; }
	finally { release.resolve(); await settled; }
	assert.deepEqual(await work, [255]); assert.deepEqual([...currentFrame.pixels], [0, 0, 0, 0]);
});

test('complete declared bodies authenticate serially even when a corrupt extra graph is unbound', async () => {
	const used = await brush([255]), unused = await brush([64]), corrupt = unused.bytes.slice(); corrupt[16] = 63;
	const extra = { ...graph(unused.reference.storageKey), id: 'unbound' };
	const develop = normalizeImageDevelopStateV1OrV2({ ...maskedDevelop([invert()], graph(used.reference.storageKey)), masks: [graph(used.reference.storageKey), extra] });
	let active = 0, maximum = 0, consumed = 0; const requested: string[] = [];
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		active++; maximum = Math.max(maximum, active); requested.push(reference.storageKey);
		try { return await consume(reference.storageKey === used.reference.storageKey ? used.bytes : corrupt); }
		finally { active--; }
	} };
	await assert.rejects(render({ frame: rgbaFrame([0, 0, 0, 255]), develop }, () => { consumed++; }, maskSource), /SHA256/iu);
	await assert.rejects(overlay({ develop, source: { width: 1, height: 1 }, maskId: 'mask', effectId: 'invert' }, () => { consumed++; }, maskSource), /SHA256/iu);
	assert.equal(consumed, 0); assert.equal(maximum, 1); assert.equal(active, 0); assert.ok(requested.includes(unused.reference.storageKey));
	assert.deepEqual([...used.bytes], [...(await brush([255])).bytes]);
});

test('two successful brush sources retire serially before the renderer delivers independently combined coverage', async () => {
	const first = await brush([255]), second = await brush([64]); let active = 0, maximum = 0; const retired: string[] = [];
	const candidate = { ...graph(first.reference.storageKey), inputs: [{ name: 'first', sourceRef: first.reference.storageKey, kind: 'alpha' },
		{ name: 'second', sourceRef: second.reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'one', kind: 'alpha', inputName: 'first' },
		{ id: 'two', kind: 'alpha', inputName: 'second' }, { id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['one', 'two'] }], outputNodeId: 'both' };
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		active++; maximum = Math.max(maximum, active);
		try { return await consume(reference.storageKey === first.reference.storageKey ? first.bytes : second.bytes); }
		finally { active--; retired.push(reference.storageKey); }
	} };
	const result = await render({ frame: rgbaFrame([0, 0, 0, 127]), develop: maskedDevelop([invert()], candidate),
		maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.equal(active, 0); assert.equal(retired.length, 2); assert.ok(view.maskOverlay);
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	}, maskSource);
	assert.deepEqual(result, { pixels: [137, 137, 137, 127], coverage: [64] }); assert.equal(maximum, 1);
	assert.deepEqual(new Set(retired), new Set([first.reference.storageKey, second.reference.storageKey]));
});

test('actual Photo source pixels and complete recipe detach before the first held brush read', async () => {
	const body = await brush([255]), frame = rgbaFrame([255, 0, 0, 128]), rawGraph = mixedGraph(body.reference.storageKey);
	const entered = deferred<void>(), release = deferred<void>();
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return consume(body.bytes); } };
	const work = render({ frame, develop: maskedDevelop([invert()], rawGraph) }, view => [...view.frame.pixels], maskSource);
	const settled = work.then(() => {}, () => {});
	try { await Promise.race([entered.promise, work]); frame.pixels.fill(0); rawGraph.inputs[0]!.sourceRef = 'brush-mask-v2:1:1:future'; }
	finally { release.resolve(); await settled; }
	assert.deepEqual(await work, [0, 255, 255, 128]); assert.deepEqual([...frame.pixels], [0, 0, 0, 0]);
});

test('Photo source signal and recipe are pinned before held body cleanup; opaque cancellation joins that cleanup', async () => {
	const body = await brush([255]), frame = rgbaFrame([0, 0, 0, 255]), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let nativeSignal: AbortSignal | undefined, consumed = 0, sourceBytes: Uint8Array | undefined;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume, options) {
		nativeSignal = options?.signal; const bytes = body.bytes.slice(); sourceBytes = bytes;
		try { const result = await consume(bytes); entered.resolve(); await release.promise; return result; }
		finally { bytes.fill(0); }
	} };
	const work = render({ frame, develop: maskedDevelop([invert()], graph(body.reference.storageKey)), signal: stop.signal }, () => { consumed++; }, maskSource);
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(nativeSignal, stop.signal); assert.equal(await remainsPending(work), true); assert.equal(consumed, 0); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(sourceBytes?.every(value => value === 0)); assert.deepEqual([...frame.pixels], [0, 0, 0, 255]);
});

test('borrowed actual pixels and projected coverage stay alive through held consumer cancellation then wipe', async () => {
	const body = await brush([0, 255]), frame = rgbaFrame([0, 0, 0, 128, 0, 0, 0, 255]), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let pixels: Uint8Array | undefined, coverage: Uint8Array | undefined;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const work = render({ frame, develop: maskedDevelop([invert()], graph(body.reference.storageKey)), signal: stop.signal,
		maskOverlay: { maskId: 'mask', effectId: 'invert' } }, async view => {
		assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage; entered.resolve(); await release.promise;
	}, maskSource);
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true);
		assert.deepEqual([...(pixels ?? [])], [0, 0, 0, 128, 255, 255, 255, 255]); assert.deepEqual([...(coverage ?? [])], [0, 255]); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(pixels?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0)); assert.deepEqual([...frame.pixels], [0, 0, 0, 128, 0, 0, 0, 255]);
});

test('non-alpha, malformed/future namespaces and geometry bindings refuse before pixels or body acquisition, including unused nodes', async () => {
	const body = await brush([255]); let reflected = 0, acquisitions = 0;
	const frame = new Proxy({}, { ownKeys() { reflected++; throw Error('Invalid brush inspected frame'); } });
	const maskSource: MaskRasterSourcePortV1 = { async withBytes() { acquisitions++; throw Error('Invalid brush acquired body'); } };
	for (const channel of ['red', 'green', 'blue', 'luma']) {
		const candidate = { ...graph(body.reference.storageKey, true), nodes: [{ id: 'bad', kind: 'raster', inputName: 'paint', channel },
			{ id: 'neutral', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'neutral' };
		await assert.rejects(render({ frame, develop: maskedDevelop([invert()], candidate) }, () => {}, maskSource));
	}
	for (const reference of [body.reference.storageKey.replace('v1', 'v2'), body.reference.storageKey.replace(':1:', ':01:'), 'source-id']) {
		await assert.rejects(render({ frame, develop: maskedDevelop([invert()], graph(reference)) }, () => {}, maskSource));
	}
	const geometry = createVideoEffect('develop-geometry-v1', { id: 'geometry', params: { flipHorizontal: 1 } });
	await assert.rejects(render({ frame, develop: maskedDevelop([geometry], graph(body.reference.storageKey)) }, () => {}, maskSource));
	assert.equal(reflected, 0); assert.equal(acquisitions, 0);
});

test('a graph that already fills64MiB refuses the extra one-byte retained brush and body spans before pixels or source', async () => {
	const body = await brush([255]), shapes = Array.from({ length: 250 }, (_, index) => ({ id: `shape${index}`, kind: 'vector-shape',
		shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }));
	const leaves = [...shapes.map(node => node.id), 'painted'];
	const groups = Array.from({ length: 4 }, (_, index) => ({ id: `group${index}`, kind: 'boolean', operation: 'union', inputNodeIds: leaves.slice(index * 64, (index + 1) * 64) }));
	const candidate = { ...graph(body.reference.storageKey), nodes: [...shapes, { id: 'painted', kind: 'alpha', inputName: 'paint' }, ...groups,
		{ id: 'result', kind: 'boolean', operation: 'union', inputNodeIds: groups.map(node => node.id) }], outputNodeId: 'result' };
	// 250 shapes+one alpha+four groups+one result=256 reachable byte planes.
	// 256*512*512=67,108,864 before even one resource alpha byte is retained.
	let pixels = 0, bodies = 0;
	const hostilePixels = new Proxy({}, { ownKeys() { pixels++; throw Error('Over-budget pixel keys inspected'); },
		get() { pixels++; throw Error('Over-budget pixels read'); }, getOwnPropertyDescriptor() { pixels++; throw Error('Over-budget pixel backing inspected'); } });
	const frame = { descriptor: { ...rgbaFrame().descriptor, width: 512, height: 512 }, pixels: hostilePixels };
	const maskSource: MaskRasterSourcePortV1 = { async withBytes() { bodies++; throw Error('Over-budget brush acquired'); } };
	await assert.rejects(render({ frame, develop: maskedDevelop([invert()], candidate) }, () => {}, maskSource), /budget|working|64/iu);
	assert.equal(pixels, 0); assert.equal(bodies, 0);
});

test('owned final Photo frame and overlay backing retirement ignores borrower buffer shadows and preserves opaque primary', async () => {
	const body = await brush([255]), frame = rgbaFrame([0, 0, 0, 128]), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let pixelBacking: ArrayBuffer | undefined, overlayBacking: ArrayBuffer | undefined, pixelGetters = 0, overlayGetters = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const work = render({ frame, develop: maskedDevelop([invert()], graph(body.reference.storageKey)),
		maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.frame.pixels], [255, 255, 255, 128]); assert.deepEqual([...view.maskOverlay.coverage], [255]);
		pixelBacking = view.frame.pixels.buffer; overlayBacking = view.maskOverlay.coverage.buffer;
		Object.defineProperty(view.frame.pixels, 'buffer', { get() { pixelGetters++; throw Error('Borrower pixel buffer getter'); } });
		Object.defineProperty(view.maskOverlay.coverage, 'buffer', { get() { overlayGetters++; throw Error('Borrower overlay buffer getter'); } });
		throw opaque.proxy;
	}, maskSource);
	const outcome = await work.then(() => assert.fail('Opaque consumer unexpectedly fulfilled'), (error: unknown) => ({ error }));
	assert.equal(Object.is(outcome.error, opaque.proxy), true); assert.equal(pixelGetters, 0); assert.equal(overlayGetters, 0);
	assert.ok(pixelBacking); assert.ok(overlayBacking); assert.ok(new Uint8Array(pixelBacking).every(value => value === 0));
	assert.ok(new Uint8Array(overlayBacking).every(value => value === 0)); assert.deepEqual([...frame.pixels], [0, 0, 0, 128]);
});

test('owned standalone suffix coverage backing retirement ignores borrower buffer shadow and preserves opaque primary', async () => {
	const body = await brush([0, 255]), flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let backing: ArrayBuffer | undefined, getters = 0;
	const develop = maskedDevelop([invert(), flip], graph(body.reference.storageKey), ['invert']);
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { return consume(body.bytes); } };
	const work = overlay({ develop, source: { width: 3, height: 1 }, maskId: 'mask', effectId: 'invert' }, view => {
		assert.deepEqual([...view.coverage], [255, 0, 0]); backing = view.coverage.buffer;
		Object.defineProperty(view.coverage, 'buffer', { get() { getters++; throw Error('Borrower projected buffer getter'); } });
		throw opaque.proxy;
	}, maskSource);
	const outcome = await work.then(() => assert.fail('Opaque projection consumer unexpectedly fulfilled'), (error: unknown) => ({ error }));
	assert.equal(Object.is(outcome.error, opaque.proxy), true); assert.equal(getters, 0); assert.ok(backing);
	assert.ok(new Uint8Array(backing).every(value => value === 0));
});
