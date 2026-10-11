/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withRepairSpotsVisualizePixelFrameV1 as visualize } from '../src/common/editor/imaging/pixel-frame-repair-visualize-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PROFILE = { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source };
function frame(pixels: readonly number[], width = pixels.length / 4): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width, height: pixels.length / (width * 4), sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(pixels) };
}
const gray = (values: readonly number[]) => values.flatMap(value => [value, value, value, 255]);
async function entered(work: Promise<unknown>, marker: Promise<void>) {
	await Promise.race([marker, work.then(() => { assert.fail('Visualization settled before its consumer entered.'); }, (error: unknown) => { throw error; })]);
}

test('visualize-spots emits independent original linear-edge bytes and threshold changes, rather than repaired pixels or rings', async () => {
	const input = frame(gray([0, 128, 255])), unchanged = input.pixels.slice();
	// D(128)=.2158605001: 255*4*(D(128)-.02)=199.7777 ->200.
	// Gray's larger neighbor difference is 1-D(128), so it and white saturate.
	for (const [threshold, expected] of [[undefined, [200, 255, 255]], [.25, [0, 255, 255]], [1, [0, 0, 0]]] as const) {
		let borrowed: PixelFrameV1['pixels'] | undefined;
		const actual = await visualize({ frame: input, ...(threshold === undefined ? {} : { threshold }) }, value => {
			borrowed = value.pixels; assert.deepEqual(value.descriptor, input.descriptor); return [...value.pixels];
		}, PROFILE);
		assert.deepEqual(actual, gray(expected)); assert.ok(borrowed?.every(value => value === 0));
	}
	assert.deepEqual(input.pixels, unchanged);
});

test('diagnostic eligibility ignores hidden RGB, has opaque black empty edges, and does not attenuate partial-alpha edge contrast', async () => {
	for (const alpha of [128, 255]) {
		const input = frame([255, 0, 0, alpha, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255]);
		// Rec709 red luminance .2126: 255*4*(.2126-.02)=196.452 ->196.
		assert.deepEqual(await visualize({ frame: input }, value => [...value.pixels], PROFILE), gray([196, 196, 0, 0]));
	}
	assert.deepEqual(await visualize({ frame: frame([255, 255, 255, 255]) }, value => [...value.pixels], PROFILE), [0, 0, 0, 255]);
});

test('visualization snapshots before yielding, joins the real consumer, and wipes pinned native backings without reading borrower shadows', async () => {
	const input = frame(gray([0, 128, 255])), marker = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
	const before = input.pixels.slice(), held: { bytes?: Uint8Array; work?: Promise<{ error: unknown }> } = {}; let shadows = 0;
	try {
		const work = visualize({ frame: input }, async value => {
			held.bytes = new Uint8Array(value.pixels.buffer, value.pixels.byteOffset, value.pixels.byteLength);
			assert.deepEqual([...held.bytes], gray([200, 255, 255]));
			for (const key of ['buffer', 'fill', 'byteLength']) Object.defineProperty(value.pixels, key, { get() { shadows++; throw Error('Diagnostic cleanup read a shadow'); } });
			marker.resolve(); await release.promise; throw reason.proxy;
		}, PROFILE);
		held.work = work.then(() => { assert.fail('Opaque consumer rejection disappeared.'); }, (error: unknown) => ({ error }));
		input.pixels.fill(255); await entered(held.work, marker.promise); assert.equal(await remainsPending(held.work), true);
		release.resolve(); assert.equal(Object.is((await held.work).error, reason.proxy), true);
		assert.equal(shadows, 0); assert.ok(held.bytes?.every(value => value === 0)); assert.deepEqual(input.pixels, new Uint8Array(before.length).fill(255));
	} finally { release.resolve(); await Promise.allSettled(held.work ? [held.work] : []); }
});

test('native cancellation joins diagnostic work without delivery or caller mutation', async () => {
	const input = frame(Array.from({ length: 128 * 128 }, (_, index) => [index % 2 ? 255 : 0, 0, 0, 255]).flat(), 128), before = input.pixels.slice();
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); let deliveries = 0;
	const work = visualize({ frame: input, signal: stop.signal }, () => { deliveries++; }, PROFILE);
	const outcome = work.then(() => ({ success: true }), (error: unknown) => ({ error }));
	const aborting = new Promise<void>(resolve => { setTimeout(() => { stop.abort(reason.proxy); resolve(); }, 0); });
	const result = await outcome; await aborting; assert.ok('error' in result); assert.equal(Object.is(result.error, reason.proxy), true);
	assert.equal(deliveries, 0); assert.deepEqual(input.pixels, before);
});

test('closed diagnostic metadata and source budget refuse before pixel authority or accessor execution', async () => {
	let reads = 0;
	const hostile = new Proxy({}, { get() { reads++; throw Error('Pixel read'); }, ownKeys() { reads++; throw Error('Pixel reflection'); }, getOwnPropertyDescriptor() { reads++; throw Error('Pixel descriptor'); } });
	const raw = { descriptor: { ...frame(gray([0])).descriptor, width: 8193 }, pixels: hostile };
	await assert.rejects(visualize({ frame: raw }, () => undefined, PROFILE), /limit|ceiling|budget|side/u); assert.equal(reads, 0);
	for (const bad of [{ frame: frame(gray([0])), threshold: -.1 }, { frame: frame(gray([0])), threshold: 1.1 },
		{ frame: frame(gray([0])), extra: true }, { frame: frame(gray([0])), get threshold() { reads++; return .02; } }]) {
		await assert.rejects(visualize(bad, () => undefined, PROFILE));
	}
	assert.equal(reads, 0);
	const stop = new AbortController(), reason = Object.freeze({ abort: true }); stop.abort(reason);
	await assert.rejects(visualize({ frame: hostile, signal: stop.signal }, () => undefined, PROFILE), error => Object.is(error, reason)); assert.equal(reads, 0);
});

test('transferring an exposed diagnostic backing is an explicit cleanup failure with opaque primary retained first', async () => {
	const input = frame(gray([0, 128, 255])), before = input.pixels.slice(), reason = Proxy.revocable({}, {}); reason.revoke();
	for (const primary of [false, true]) {
		const result = await visualize({ frame: input }, value => {
			structuredClone(value.pixels.buffer, { transfer: [value.pixels.buffer] }); if (primary) throw reason.proxy;
		}, PROFILE).then(() => ({ success: true }), (error: unknown) => ({ error }));
		assert.ok('error' in result);
		if (primary) { assert.ok(result.error instanceof AggregateError); assert.equal(Object.is(result.error.errors[0], reason.proxy), true); assert.equal(result.error.errors.length, 2); }
		else assert.match(String(result.error), /detach|retirement|wipe/u);
	}
	assert.deepEqual(input.pixels, before);
});
