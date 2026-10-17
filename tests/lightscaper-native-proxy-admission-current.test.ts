/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { PixelFrameDescriptorV1, PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { developPropertiesFixtureCurrentV1 } from './helpers/lightscaper-develop-properties-current-fixture.ts';
import { brushSettingsRecipe } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function recipe(patch: Readonly<Record<string, unknown>> = {}) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, ...patch });
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function trappedFrame(sampleFormat: 'unorm8' | 'unorm16' | 'float32' = 'float32', width = 4096, height = 1) {
	let reads = 0; const marker = Symbol('source-pixels-authority');
	const descriptor: PixelFrameDescriptorV1 = { schemaVersion: 1, width, height, sampleFormat, primaries: 'srgb', transfer: sampleFormat === 'unorm8' ? 'srgb' : 'linear' };
	const frame = new Proxy({ descriptor, pixels: undefined }, {
		getOwnPropertyDescriptor(target, key) { if (key === 'pixels') { reads++; throw marker; } return Reflect.getOwnPropertyDescriptor(target, key); },
	}) as unknown as PixelFrameV1;
	return { frame, marker, reads: () => reads };
}
async function refusesBeforePixels(frame: ReturnType<typeof trappedFrame>, develop: ImageDevelopStateCurrentV1, expected: RegExp) {
	let deliveries = 0;
	const result = await observed(createPhotoDevelopRenderRuntimeCurrentV1().withProxy({ frame: frame.frame, develop, signal: new AbortController().signal }, () => { deliveries++; }));
	assert.equal(result.ok, false);
	if (result.ok) assert.fail('Invalid proxy request was admitted.');
	assert.notEqual(result.error, frame.marker, 'Source pixel ownership was consulted before whole-recipe admission.');
	assert.equal(frame.reads(), 0); assert.equal(deliveries, 0);
	assert.ok(result.error instanceof Error); assert.match(result.error.message, expected);
}

test('Actual Current proxy admits the complete malformed recipe before consulting the full Original pixels descriptor', async () => {
	const base = recipe();
	// Dynamic callers reach the real runtime boundary; this cast deliberately
	// avoids normalizing invalid wire metadata in the test before the owner runs.
	const invalid = { ...base, effects: [{ id: 'invalid-tone', type: 'tone-ladder-v1', enabled: false, params: { exposure: Number.NaN } }] } as unknown as ImageDevelopStateCurrentV1;
	for (const format of ['unorm8', 'unorm16', 'float32'] as const) await refusesBeforePixels(trappedFrame(format), invalid, /parameter|finite|exposure/u);
});

test('Actual native proxy refuses even a disabled unsupported family before source pixel authority', async () => {
	const unsupported = recipe({ effects: [{ ...createVideoEffect('rgb-split', { id: 'known-but-unsupported' }), enabled: false }] });
	await refusesBeforePixels(trappedFrame(), unsupported, /unsupported|family/u);
});

test('Current byte proxy retains disabled known byte-family compatibility and exact nearest Original samples while Full stays unchanged', async () => {
	const pixels = new Uint8Array(4096 * 4);
	const pattern = [[17, 33, 65, 255], [211, 9, 123, 255], [91, 129, 200, 255], [3, 254, 77, 255]] as const;
	for (let x = 0; x < 4096; x++) pixels.set(pattern[x % 4]!, x * 4);
	const before = pixels.slice(), frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 4096, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	const develop = recipe({ effects: [{ ...createVideoEffect('rgb-split', { id: 'disabled-byte-family' }), enabled: false }] });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), request = { frame, develop, signal: new AbortController().signal };
	let fullBacking: Uint8Array | undefined, proxyBacking: Uint8Array | undefined;
	await runtime.withFullResolution(request, view => {
		assert.deepEqual(view.frame.descriptor, frame.descriptor);
		fullBacking = new Uint8Array(view.frame.pixels.buffer, view.frame.pixels.byteOffset, view.frame.pixels.byteLength);
		assert.deepEqual(fullBacking, before); assert.equal(view.histogram.sampledPixels, 4096);
	});
	assert.ok(fullBacking?.every(value => value === 0)); assert.deepEqual(pixels, before);
	await runtime.withProxy(request, view => {
		assert.deepEqual(view.frame.descriptor, { ...frame.descriptor, width: 2048 });
		proxyBacking = new Uint8Array(view.frame.pixels.buffer, view.frame.pixels.byteOffset, view.frame.pixels.byteLength);
		// The exact2:1 nearest fit selects source0,2,4,... . Disabled RGB split
		// changes no channel, so these two literal colors alternate unmodified.
		for (let x = 0; x < 2048; x++) assert.deepEqual([...view.frame.pixels.subarray(x * 4, x * 4 + 4)],
			x % 2 === 0 ? [17, 33, 65, 255] : [91, 129, 200, 255]);
		assert.equal(view.histogram.sampledPixels, 2048);
	});
	assert.ok(proxyBacking?.every(value => value === 0)); assert.deepEqual(pixels, before);
});

test('Proxy2048-square rotated natural output refuses its eight-megapixel render limit before source pixels', async () => {
	const base = recipe(), rotated = recipe({ geometry: { ...base.geometry, rotationDegrees: 45 } });
	// ceil(2048*sqrt(2))=2897;2897²=8,392,609 exceeds8,388,608,
	// while remaining within the full native route's16,777,216-pixel bound.
	for (const format of ['unorm8', 'unorm16', 'float32'] as const) await refusesBeforePixels(trappedFrame(format, 2048, 2048), rotated, /pixel|limit|budget/u);
});

test('Actual Current proxy requires authentic LUT and brush ports before Original sample reflection', { concurrency: false }, async () => {
	const f = await developPropertiesFixtureCurrentV1(1);
	try {
		const lut = recipe({ effects: [{ id: 'managed-lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: f.resourcesForRecipe.lut } }] });
		const base = recipe({ effects: [createVideoEffect('tone-ladder-v1', { id: 'bound-tone', params: { exposure: 1 } })] });
		const brush = brushSettingsRecipe(f.resourcesForRecipe.brush, base);
		const bound = normalizeImageDevelopStateCurrentV1({ ...brush, maskBindings: [{ effectId: 'bound-tone', maskId: 'painted' }] });
		for (const format of ['unorm8', 'unorm16', 'float32'] as const) {
			await refusesBeforePixels(trappedFrame(format), lut, /source|port|LUT|cube/u);
			await refusesBeforePixels(trappedFrame(format), bound, /source|authority|brush|mask/u);
		}
	} finally { await f.close(); }
});

test('Actual Current proxy snapshots selected native samples before its first yield when the caller immediately changes the Original', async () => {
	const pixels = new Float32Array(4096 * 4);
	for (let x = 0; x < 4096; x++) pixels.set([-.25, 2, .125, .5], x * 4);
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 4096, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels };
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), entered = deferred<void>(), release = deferred<void>(); let backing: Uint8Array | undefined;
	const work = runtime.withProxy({ frame, develop: recipe(), signal: new AbortController().signal }, async value => {
		assert.equal(value.frame.descriptor.width, 2048); assert.ok(value.frame.pixels instanceof Float32Array);
		backing = new Uint8Array(value.frame.pixels.buffer); entered.resolve(); await release.promise;
		for (let x = 0; x < 2048; x++) assert.deepEqual([...value.frame.pixels.subarray(x * 4, x * 4 + 4)], [-.25, 2, .125, .5]);
	});
	const settled = observed(work); pixels.fill(0);
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('Proxy settled before its held consumer.'), (error: unknown) => { throw error; })]);
		assert.equal(await remainsPending(work), true); assert.ok(backing?.some(value => value !== 0)); release.resolve();
		const result = await settled; if (!result.ok) throw result.error;
		assert.ok(backing?.every(value => value === 0)); assert.ok(pixels.every(value => value === 0));
	} finally { release.resolve(); await settled; }
});

function leaves(value: unknown, depth = 0): readonly unknown[] {
	if (depth > 16) assert.fail('Unexpectedly deep proxy failure aggregate.');
	// Opaque reasons may be revoked proxies. Classification must not replace
	// them merely because instanceof itself cannot inspect the foreign value.
	let aggregate: boolean; try { aggregate = value instanceof AggregateError; } catch { return [value]; }
	const errors: readonly unknown[] = aggregate ? (value as AggregateError).errors : [value];
	return aggregate ? errors.flatMap(reason => leaves(reason, depth + 1)) : errors;
}

test('Actual proxy preserves opaque consumer failure plus distinct physical detach cleanup failure when cancellation races retirement', async () => {
	const pixels = new Uint16Array(4096 * 4);
	for (let x = 0; x < 4096; x++) pixels.set([1, 2, 3, 65535], x * 4);
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 4096, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels };
	const before = pixels.slice(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const primary: unknown = revoked.proxy;
	const stop = new AbortController(), aborted = Symbol('proxy-retirement-abort'); let transferred: ArrayBuffer | undefined;
	try {
		const result = await observed(createPhotoDevelopRenderRuntimeCurrentV1().withProxy({ frame, develop: recipe(), signal: stop.signal }, value => {
			assert.ok(value.frame.pixels.buffer instanceof ArrayBuffer);
			transferred = structuredClone(value.frame.pixels.buffer, { transfer: [value.frame.pixels.buffer] });
			stop.abort(aborted); throw primary;
		}));
		assert.equal(result.ok, false); if (result.ok) assert.fail('Detached proxy output cannot certify retirement.');
		const failures = leaves(result.error);
		assert.ok(failures.some(value => Object.is(value, primary)), 'Cancellation must not replace the exact consumer failure.');
		assert.ok(failures.some(value => { try { return value instanceof TypeError; } catch { return false; } }), 'Physical wipe failure must remain separately observable.');
		assert.ok(transferred); assert.ok(new Uint8Array(transferred).some(value => value !== 0)); assert.deepEqual(pixels, before);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); }
});
