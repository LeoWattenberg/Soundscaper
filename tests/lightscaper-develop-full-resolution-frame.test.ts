/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopFullResolutionFrameV1, withPhotoDevelopProxyFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const source = (width = 2052) => ({ descriptor: { schemaVersion: 1 as const, width, height: 1,
	sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const },
	pixels: Uint8Array.from({ length: width * 4 }, (_, n) => n % 4 === 3 ? 255 : Math.floor(n / 4) % 256) });
const settings = () => defaultPhotoDevelopV1();

test('the named full renderer preserves every admitted original pixel beyond the unchanged proxy cap', async () => {
	const frame = source(), expected = [...frame.pixels]; let borrowed: Uint8Array | undefined;
	const result = await withPhotoDevelopFullResolutionFrameV1({ frame, develop: settings() }, view => {
		borrowed = view.frame.pixels;
		return { pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram };
	});
	assert.deepEqual(result.pixels, expected); assert.equal(result.descriptor.width, 2052); assert.equal(result.descriptor.height, 1);
	assert.equal(result.histogram.sampledPixels, 2052);
	for (let n = 0; n < 256; n++) assert.equal(result.histogram.bins.red[n], n < 4 ? 9 : 8);
	assert.deepEqual([...frame.pixels], expected); assert.ok(borrowed?.every(byte => byte === 0));
	await assert.rejects(withPhotoDevelopProxyFrameV1({ frame, develop: settings() }, () => assert.fail('The proxy cap must stay fixed')));
});

test('full-resolution crop keeps natural extent and applies wheels, sharpening and curves in authored order', async () => {
	const frame = source(); frame.pixels.set([40,40,40,255,100,100,100,255,160,160,160,255]);
	const wheel = createVideoEffect('color-wheels-v1', { id: 'gain-two', params: { highlightsLuminance: 100 } });
	const sharpen = createVideoEffect('detail-sharpen-v1', { id: 'detail', params: { amount: 50 } });
	const curve = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const geometry = { crop: { x: 0, y: 0, width: 3 / 2052, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false };
	// Independent gain-two bytes58/138/218; rounded 3:1 edge blur78/198;
	// amount50 yields48/138/228, then the invert curve207/117/27.
	for (const [effects, values] of [
		[[wheel, sharpen, curve], [207,117,27]],
		[[sharpen, wheel, curve], [206,117,26]],
	] as const) {
		const result = await withPhotoDevelopFullResolutionFrameV1({ frame, develop: { ...settings(), geometry, effects } }, view => ({
			descriptor: view.frame.descriptor, pixels: [...view.frame.pixels], histogram: view.histogram,
		}));
		assert.equal(result.descriptor.width, 3); assert.equal(result.descriptor.height, 1);
		assert.deepEqual(result.pixels, values.flatMap(value => [value,value,value,255]));
		assert.equal(result.histogram.sampledPixels, 3);
		for (const value of values) assert.equal(result.histogram.bins.red[value], 1);
	}
	assert.deepEqual([...frame.pixels.slice(0,12)], [40,40,40,255,100,100,100,255,160,160,160,255]);
});

test('the fixed full profile refuses caller limits and out-of-profile admission before any consumer or accessor', async () => {
	let consumed = 0, inspected = 0; const frame = source();
	for (const value of [
		{ frame, develop: settings(), limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 },
		{ frame, develop: settings(), profile: 'unbounded' },
		{ frame: { ...frame, descriptor: { ...frame.descriptor, width: 8193 } }, develop: settings() },
		{ frame: { ...frame, descriptor: { ...frame.descriptor, width: 8192, height: 2049 } }, develop: settings() },
		{ frame: { ...frame, descriptor: { ...frame.descriptor, transfer: 'pq' } }, develop: settings() },
		{ frame: { descriptor: frame.descriptor, get pixels() { inspected++; throw Error('Must refuse inert admission'); } }, develop: settings() },
	]) await assert.rejects(withPhotoDevelopFullResolutionFrameV1(value, () => { consumed++; }));
	assert.equal(consumed, 0); assert.equal(inspected, 0);
});

test('full-resolution delivery joins cancellation and wipes borrowed backing while leaving original bytes intact', async () => {
	const frame = source(), expected = [...frame.pixels], entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let inspected = 0, backing: ArrayBuffer | undefined;
	const reason = new Proxy({}, { get() { inspected++; throw Error(); }, getPrototypeOf() { inspected++; throw Error(); } });
	const work = withPhotoDevelopFullResolutionFrameV1({ frame, develop: settings(), signal: stop.signal }, async view => {
		Object.defineProperty(stop.signal, 'throwIfAborted', { get() { inspected++; throw Error('No mutable signal property'); } });
		backing = view.frame.pixels.buffer; entered.resolve(); await release.promise;
	});
	const observed = work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true);
	release.resolve(); const outcome = await observed; assert.equal(outcome.failed, true); assert.equal(outcome.reason === reason, true);
	assert.equal(inspected, 0); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual([...frame.pixels], expected);
});

test('full-resolution source and settings detach before awaited stages and consumer failure preserves opaque identity', async () => {
	const frame = source(), develop = { ...settings(), effects: [createVideoEffect('point-curves-v1', { params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })] };
	let backing: ArrayBuffer | undefined, inspected = 0;
	const failure = new Proxy({}, { get() { inspected++; throw Error(); }, getPrototypeOf() { inspected++; throw Error(); } });
	const work = withPhotoDevelopFullResolutionFrameV1({ frame, develop }, view => {
		backing = view.frame.pixels.buffer; assert.deepEqual([...view.frame.pixels.slice(0,8)], [255,255,255,255,254,254,254,255]); throw failure;
	});
	frame.pixels.fill(0); assert.ok(Reflect.set(develop.effects[0]!.params, 'master', [{ x: 0, y: 0 }, { x: 1, y: 1 }]));
	const result = await work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	assert.equal(result.failed, true); assert.equal(result.reason === failure, true); assert.equal(inspected, 0);
	assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
});
