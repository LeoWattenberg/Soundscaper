/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const WIDTH = 4096, PROXY_WIDTH = 2048;
function recipe(sharpen = false) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
		effects: sharpen ? [createVideoEffect('detail-sharpen-v1', { id: 'proxy-sharpen', params: { amount: 50, threshold: 0 } })] : [] });
}
function nativeFloat(): PixelFrameV1 {
	const pixels = new Float32Array(WIDTH * 4);
	for (let x = 0; x < WIDTH; x++) { const value = x % 4 === 1 || x % 4 === 2 ? 1 : 0; pixels.set([value, value, value, 1], x * 4); }
	return { descriptor: { schemaVersion: 1, width: WIDTH, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels };
}
function nativeWords(): PixelFrameV1 {
	const pixels = new Uint16Array(WIDTH * 4);
	for (let x = 0; x < WIDTH; x++) pixels.set([x + 1, x + 2, x + 3, 65535], x * 4);
	return { descriptor: { schemaVersion: 1, width: WIDTH, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels };
}
function bytes(): PixelFrameV1 {
	const pixels = new Uint8Array(WIDTH * 4);
	for (let x = 0; x < WIDTH; x++) { const value = x % 4 === 1 || x % 4 === 2 ? 200 : 32; pixels.set([value, value, value, 255], x * 4); }
	return { descriptor: { schemaVersion: 1, width: WIDTH, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
}
function raw(frame: Readonly<PixelFrameV1>): Uint8Array<ArrayBuffer> { return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength); }
function request(frame: PixelFrameV1, sharpen = false, signal = new AbortController().signal) { return { frame, develop: recipe(sharpen), signal }; }
function decoded(value: number): number {
	const magnitude = Math.abs(value);
	return Math.sign(value) * (magnitude <= .04045 ? magnitude / 12.92 : ((magnitude + .055) / 1.055) ** 2.4);
}
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

test('Actual Current withProxy admits full native words and evaluates only the fitted native proxy rather than refusing the Original extent', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), frame = nativeWords(), before = raw(frame).slice();
	let backing: Uint8Array | undefined;
	const result = await runtime.withProxy(request(frame), view => {
		assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height, view.frame.descriptor.sampleFormat, view.frame.descriptor.transfer], [PROXY_WIDTH, 1, 'float32', 'linear']);
		assert.ok(view.frame.pixels instanceof Float32Array); backing = raw(view.frame);
		for (let x = 0; x < PROXY_WIDTH; x++) {
			assert.equal(view.frame.pixels[x * 4], Math.fround((x * 2 + 1) / 65535));
			assert.equal(view.frame.pixels[x * 4 + 1], Math.fround((x * 2 + 2) / 65535));
			assert.equal(view.frame.pixels[x * 4 + 2], Math.fround((x * 2 + 3) / 65535)); assert.equal(view.frame.pixels[x * 4 + 3], 1);
		}
		assert.notEqual(view.frame.pixels[0], 0, 'A native sub-byte word must not pass through an encoded-byte proxy.');
		assert.equal(view.histogram.sampledPixels, PROXY_WIDTH); return 'native-proxy';
	});
	assert.equal(result, 'native-proxy'); assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(frame), before);
});

test('Native Current proxy sharpening uses proxy neighborhoods before processing, with an independent signed/HDR oracle distinct from full-then-fit', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), frame = nativeFloat(), before = raw(frame).slice();
	let backing: Uint8Array | undefined;
	const proxy = await runtime.withProxy(request(frame, true), view => {
		assert.equal(view.frame.descriptor.width, PROXY_WIDTH); assert.ok(view.frame.pixels instanceof Float32Array); backing = raw(view.frame);
		return [...view.frame.pixels];
	});
	// Nearest takes source0,2,4,..., giving alternating encoded0/1. The
	// alpha-weighted [1,2,1] blur is1/2 inside,1/4 at the left edge and3/4
	// at the right edge. Half gain therefore gives encoded−1/4,5/4 inside,
	// −1/8 at the left edge and9/8 at the right edge. Only final F32 rounds.
	for (let x = 0; x < PROXY_WIDTH; x++) {
		const encoded = x === 0 ? -.125 : x === PROXY_WIDTH - 1 ? 1.125 : x % 2 === 0 ? -.25 : 1.25;
		for (let channel = 0; channel < 3; channel++) assert.equal(proxy[x * 4 + channel], Math.fround(decoded(encoded)));
		assert.equal(proxy[x * 4 + 3], 1);
	}
	assert.ok(proxy[8]! < 0); assert.ok(proxy[4]! > 1); assert.ok(backing?.every(value => value === 0));
	const full = await runtime.withFullResolution(request(frame, true), view => { assert.equal(view.frame.descriptor.width, WIDTH); return [...view.frame.pixels]; });
	// Full source is0,1,1,0. Every dark source pixel has blur1/4 and every
	// light pixel blur3/4, including replicated borders: sharpened encoded
	// values are−1/8 and9/8. Its even-pixel fit is therefore a different image.
	for (let x = 0; x < WIDTH; x++) {
		const expected = Math.fround(decoded(x % 4 === 1 || x % 4 === 2 ? 1.125 : -.125));
		for (let channel = 0; channel < 3; channel++) assert.equal(full[x * 4 + channel], expected);
		assert.equal(full[x * 4 + 3], 1);
	}
	assert.notEqual(proxy[8], full[16]); assert.notEqual(proxy[4], full[8]); assert.deepEqual(raw(frame), before);
});

test('Byte Current proxy reduces source work before sharpening while its full-resolution result stays independently exact', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), frame = bytes(), before = raw(frame).slice(); let backing: Uint8Array | undefined;
	const proxy = await runtime.withProxy(request(frame, true), view => {
		assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height, view.frame.descriptor.sampleFormat], [PROXY_WIDTH, 1, 'unorm8']);
		assert.equal(view.histogram.sampledPixels, PROXY_WIDTH); backing = raw(view.frame); return [...view.frame.pixels];
	});
	// Proxy32/200 neighbors blur to116 inside,74 left,158 right. Half-Q8
	// gain gives0/242 inside,11 left,221 right, with byte clipping only here.
	for (let x = 0; x < PROXY_WIDTH; x++) {
		const expected = x === 0 ? 11 : x === PROXY_WIDTH - 1 ? 221 : x % 2 === 0 ? 0 : 242;
		assert.deepEqual(proxy.slice(x * 4, x * 4 + 4), [expected, expected, expected, 255]);
	}
	assert.ok(backing?.every(value => value === 0));
	const full = await runtime.withFullResolution(request(frame, true), view => { assert.equal(view.frame.descriptor.width, WIDTH); return [...view.frame.pixels]; });
	for (let x = 0; x < WIDTH; x++) {
		const expected = x % 4 === 1 || x % 4 === 2 ? 221 : 11;
		assert.deepEqual(full.slice(x * 4, x * 4 + 4), [expected, expected, expected, 255]);
	}
	assert.notEqual(proxy[8], full[16]); assert.deepEqual(raw(frame), before);
});

test('Current proxy cancellation joins its held native processed output and physically retires it without changing Original samples', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), frame = nativeWords(), before = raw(frame).slice();
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(), reason = Symbol('native-proxy-cancel');
	let backing: Uint8Array | undefined;
	const work = runtime.withProxy(request(frame, false, stop.signal), async view => {
		assert.equal(view.frame.descriptor.width, PROXY_WIDTH); backing = raw(view.frame); entered.resolve(); await release.promise; return 'held';
	});
	const settled = outcome(work);
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('Proxy settled before its scoped consumer.'), (error: unknown) => { throw error; })]);
		stop.abort(reason); assert.equal(await remainsPending(work), true); assert.ok(backing?.some(value => value !== 0));
		release.resolve(); const result = await settled; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason);
		assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(frame), before);
	} finally { release.resolve(); await settled; }
});

test('Permanent V3 proxy remains a bounded byte-derivative API while Current full-native identity stays full resolution', async () => {
	const permanent = createPhotoDevelopRenderRuntimeV3(), current = createPhotoDevelopRenderRuntimeCurrentV1();
	await assert.rejects(permanent.withProxy(request(bytes()), () => assert.fail('Permanent byte proxy must not acquire a full Original.')), RangeError);
	await assert.rejects(permanent.withProxy(request(nativeWords()), () => assert.fail('Permanent byte proxy must not acquire native depth.')), RangeError);
	const frame = nativeWords(), before = raw(frame).slice();
	await current.withFullResolution(request(frame), view => {
		assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height, view.frame.descriptor.sampleFormat], [WIDTH, 1, 'float32']);
		for (let x = 0; x < WIDTH; x++) assert.equal(view.frame.pixels[x * 4], Math.fround((x + 1) / 65535));
	});
	assert.deepEqual(raw(frame), before);
});
