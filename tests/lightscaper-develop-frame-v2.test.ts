/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { withPhotoDevelopFullResolutionFrameV2, withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { withPhotoDevelopProxyFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const SHA = createHash('sha256').update(BODY).digest('hex');
const REFERENCE = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: BODY.byteLength, size: 2,
	domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const profile = (enabled = true, lut: typeof REFERENCE | null = REFERENCE) => ({
	id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut },
});
const source = (pixels = [64, 128, 192, 0, 64, 128, 192, 127, 255, 0, 255, 255]) => ({
	descriptor: { schemaVersion: 1 as const, width: pixels.length / 4, height: 1,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(pixels),
});
const invert = () => createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
function resource() {
	let reads = 0;
	const port: CubeLutSourcePortV1 = { withBytes: async (reference, consume) => {
		reads++; assert.deepEqual(reference, REFERENCE); return consume(BODY);
	} };
	return { port, reads: () => reads };
}

test('Photo2 renders the resource in authored order with literal linear-sRGB bytes, straight alpha and the final histogram', async () => {
	const frame = source(), expectedSource = [...frame.pixels], body = [...BODY];
	for (const [effects, rgb] of [[[profile(), invert()], [118, 255, 255]], [[invert(), profile()], [137, 0, 0]]] as const) {
		const asset = resource(); let borrowed: Uint8Array | undefined;
		const result = await withPhotoDevelopProxyFrameV2({ frame, develop: { ...defaultImageDevelopStateV2(), effects } }, view => {
			borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		}, { source: asset.port });
		assert.deepEqual(result.pixels, [0, 127, 255].flatMap(alpha => [...rgb, alpha]));
		assert.equal(result.histogram.transparentPixels, 1); assert.equal(result.histogram.sampledPixels, 2);
		assert.equal(result.histogram.bins.red[rgb[0]], 2); assert.equal(asset.reads(), 1);
		assert.ok(borrowed?.every(byte => byte === 0));
	}
	assert.deepEqual([...frame.pixels], expectedSource); assert.deepEqual([...BODY], body);
});

test('Photo2 retains natural geometry and the full profile while leaving the old proxy cap and process owner strict', async () => {
	const frame = source(Array.from({ length: 2052 }, () => [64, 128, 192, 255]).flat());
	const develop = { ...defaultImageDevelopStateV2(), effects: [profile()] }, asset = resource();
	const full = await withPhotoDevelopFullResolutionFrameV2({ frame, develop }, view => ({ width: view.frame.descriptor.width,
		pixels: [...view.frame.pixels], sampled: view.histogram.sampledPixels }), { source: asset.port });
	assert.equal(full.width, 2052); assert.equal(full.sampled, 2052);
	assert.deepEqual(full.pixels, Array.from({ length: 2052 }, () => [137, 0, 0, 255]).flat());
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop }, () => assert.fail('Proxy cap widened'), { source: asset.port }));
	await assert.rejects(withPhotoDevelopProxyFrameV1({ frame: source(), develop }, () => assert.fail('V1 admitted process2')));
	assert.equal(asset.reads(), 1);
	const small = source([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
	const crop = { crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false };
	const geometry = await withPhotoDevelopProxyFrameV2({ frame: small, develop: { ...develop, geometry: crop } },
		view => ({ descriptor: view.frame.descriptor, pixels: [...view.frame.pixels] }), { source: asset.port });
	assert.equal(geometry.descriptor.width, 1); assert.equal(geometry.descriptor.height, 2);
	assert.deepEqual(geometry.pixels, [137, 0, 0, 255, 137, 0, 0, 255]);
});

test('an active missing or invalid source refuses before source-pixel reflection; disabled/null references never inspect or load it', async () => {
	let reflected = 0, consumed = 0;
	const badFrame = new Proxy({}, { ownKeys() { reflected++; throw Error('Pixels inspected before resource admission'); } });
	const request = { frame: badFrame, develop: { ...defaultImageDevelopStateV2(), effects: [profile()] } };
	await assert.rejects(withPhotoDevelopProxyFrameV2(request, () => { consumed++; }), /source|resource/iu);
	const accessor = Object.defineProperty({}, 'withBytes', { get() { reflected++; throw Error('Source getter invoked'); } });
	await assert.rejects(withPhotoDevelopProxyFrameV2(request, () => { consumed++; }, { source: accessor as CubeLutSourcePortV1 }), /source|method/iu);
	assert.equal(reflected, 0); assert.equal(consumed, 0);
	const port = new Proxy({} as CubeLutSourcePortV1, { getOwnPropertyDescriptor() { reflected++; throw Error('Inactive source inspected'); } });
	for (const effect of [profile(false), profile(true, null)]) {
		const frame = source();
		const pixels = await withPhotoDevelopProxyFrameV2({ frame, develop: { ...defaultImageDevelopStateV2(), effects: [effect] } },
			view => [...view.frame.pixels], { source: port });
		assert.deepEqual(pixels, [...frame.pixels]);
	}
	assert.equal(reflected, 0);
});

test('the whole pipeline pins the bound resource method and snapshots pixels/settings before an earlier asynchronous stage', async () => {
	const frame = source(), effect = profile(), develop = { ...defaultImageDevelopStateV2(), effects: [invert(), effect] };
	let calls = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); calls++; assert.deepEqual(reference, REFERENCE); return consume(BODY);
	} };
	const options = { source: port };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop }, view => [...view.frame.pixels], options);
	port.withBytes = () => { throw Error('Mutable replacement was used'); };
	options.source = { withBytes: () => { throw Error('Mutable options were used'); } };
	frame.pixels.fill(0); effect.params.lut = null;
	assert.deepEqual(await work, [137, 0, 0, 0, 137, 0, 0, 127, 137, 0, 0, 255]); assert.equal(calls, 1);
});

test('resource delivery and the final Photo consumer are joined before cancellation releases either backing', async () => {
	const frame = source(), before = [...frame.pixels], entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = new Proxy({}, { getPrototypeOf() { throw Error('Opaque cancellation inspected'); } });
	let bodyBacking: Uint8Array | undefined, output: Uint8Array | undefined;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const owned = new Uint8Array(BODY); bodyBacking = owned;
		try { return await consume(owned); } finally { owned.fill(0); }
	} };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: { ...defaultImageDevelopStateV2(), effects: [profile()] }, signal: stop.signal },
		async view => { output = view.frame.pixels; entered.resolve(); await release.promise; }, { source: port });
	const observed = work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	await Promise.race([entered.promise, work]); assert.ok(output); assert.equal(bodyBacking?.every(byte => byte === 0), true);
	stop.abort(reason); assert.equal(await remainsPending(work), true); assert.ok(output?.some(byte => byte !== 0));
	release.resolve(); const outcome = await observed;
	assert.equal(outcome.failed, true); assert.equal(outcome.reason, reason); assert.ok(output?.every(byte => byte === 0));
	assert.deepEqual([...frame.pixels], before);
});

test('body integrity failure never reaches the Photo consumer and legacy requests retain the same bytes through the explicit mixed renderer', async () => {
	let consumed = 0;
	const wrong: CubeLutSourcePortV1 = { withBytes: async (_reference, consume) => consume(new Uint8Array(BODY.byteLength)) };
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame: source(), develop: { ...defaultImageDevelopStateV2(), effects: [profile()] } },
		() => { consumed++; }, { source: wrong }));
	assert.equal(consumed, 0);
	const request = { frame: source(), develop: { ...defaultPhotoDevelopV1(), effects: [invert()] } };
	const old = await withPhotoDevelopProxyFrameV1(request, view => ({ pixels: [...view.frame.pixels], histogram: view.histogram }));
	const current = await withPhotoDevelopProxyFrameV2(request, view => ({ pixels: [...view.frame.pixels], histogram: view.histogram }));
	assert.deepEqual(current, old); assert.equal(request.develop.processVersion, 1);
});

test('Photo delivery waits for resource cleanup and cancellation joins that cleanup without exposing a staged result', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), frame = source(), before = [...frame.pixels];
	const reason = new Proxy({}, { getPrototypeOf() { throw Error('Cancellation reflected'); } });
	let body: Uint8Array | undefined, consumed = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const owned = new Uint8Array(BODY); body = owned;
		try { const result = await consume(owned); entered.resolve(); await release.promise; return result; }
		finally { owned.fill(0); }
	} };
	const work = withPhotoDevelopProxyFrameV2({ frame, develop: { ...defaultImageDevelopStateV2(), effects: [profile()] }, signal: stop.signal },
		() => { consumed++; }, { source: port });
	const observed = work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	await Promise.race([entered.promise, work]); assert.equal(consumed, 0);
	stop.abort(reason); assert.equal(await remainsPending(work), true); assert.ok(body?.some(byte => byte !== 0));
	release.resolve(); const outcome = await observed;
	assert.equal(outcome.failed, true); assert.equal(outcome.reason, reason); assert.equal(consumed, 0);
	assert.ok(body?.every(byte => byte === 0)); assert.deepEqual([...frame.pixels], before);
});

test('Photo accepts the UNORM8 clamped input view while owning a byte-exact Uint8 stage backing', async () => {
	const frame = source(), clamped = { descriptor: frame.descriptor, pixels: new Uint8ClampedArray(frame.pixels) }, asset = resource();
	let borrowed: Uint8Array | undefined;
	const pixels = await withPhotoDevelopProxyFrameV2({ frame: clamped, develop: { ...defaultImageDevelopStateV2(), effects: [profile()] } },
		view => { borrowed = view.frame.pixels; return [...view.frame.pixels]; }, { source: asset.port });
	assert.deepEqual(pixels, [137, 0, 0, 0, 137, 0, 0, 127, 137, 0, 0, 255]);
	assert.ok(borrowed instanceof Uint8Array); assert.ok(borrowed.every(byte => byte === 0));
	assert.deepEqual([...clamped.pixels], [...frame.pixels]);
});

test('an already-aborted Photo request preserves its native reason before options or pixels are reflected', async () => {
	let optionsTraps = 0, pixelTraps = 0, reasonTraps = 0;
	const reason = new Proxy({}, { getPrototypeOf() { reasonTraps++; throw Error('Reason reflected'); } });
	const failure = new Proxy({}, { getPrototypeOf() { throw Error('Options failure reflected'); } });
	const stop = new AbortController(); stop.abort(reason);
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { reasonTraps++; throw Error('Mutable cancellation property read'); } });
	const frame = new Proxy({}, { ownKeys() { pixelTraps++; throw Error('Pixels reflected'); } });
	const options = new Proxy({}, { ownKeys() { optionsTraps++; throw failure; } });
	for (const render of [withPhotoDevelopProxyFrameV2, withPhotoDevelopFullResolutionFrameV2]) {
		const work = render({ frame, develop: defaultImageDevelopStateV2(), signal: stop.signal }, () => assert.fail('Canceled output exposed'), options);
		const outcome = await work.then(() => ({ failed: false, value: undefined as unknown }), error => ({ failed: true, value: error as unknown }));
		assert.equal(outcome.failed, true); assert.equal(outcome.value === reason, true);
	}
	assert.equal(optionsTraps, 0); assert.equal(pixelTraps, 0); assert.equal(reasonTraps, 0);
});

test('cancellation during resource-options admission wins before further Develop or pixel reflection', async () => {
	for (const throwFromOptions of [false, true]) {
		let reflected = 0, reasonTraps = 0;
		const reason = new Proxy({}, { getPrototypeOf() { reasonTraps++; throw Error('Reason reflected'); } }), stop = new AbortController();
		const failure = new Proxy({}, { getPrototypeOf() { throw Error('Options failure reflected'); } });
		const unread = new Proxy({}, { ownKeys() { reflected++; throw Error('Canceled source or Develop reflected'); } });
		const options = new Proxy({}, { ownKeys() { stop.abort(reason); if (throwFromOptions) throw failure; return []; } });
		const work = withPhotoDevelopProxyFrameV2({ frame: unread, develop: unread, signal: stop.signal }, () => assert.fail('Canceled output exposed'), options);
		const outcome = await work.then(() => ({ failed: false, value: undefined as unknown }), error => ({ failed: true, value: error as unknown }));
		assert.equal(outcome.failed, true); assert.equal(outcome.value === reason, true);
		assert.equal(reflected, 0); assert.equal(reasonTraps, 0);
	}
});
