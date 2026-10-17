/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import type { PhotoLibraryDevelopFrameRequestV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PixelFrameDescriptorV1, PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { gradientGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Exercise the actual declared factory child, with its original receiver. */
function linearRuntime() {
	const runtime = createPhotoDevelopRenderRuntimeV3();
	assert.equal(typeof runtime.withLinearWorkingFrame, 'function');
	assert.equal(Object.isFrozen(runtime), true);
	return <Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>) =>
		runtime.withLinearWorkingFrame(request, consume);
}

function recipe(effects: readonly unknown[] = [], patch: Readonly<Record<string, unknown>> = {}) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects, ...patch });
}
function tone(params: Record<string, number>, id = 'tone') { return createVideoEffect('tone-ladder-v1', { id, params }); }
function whiteBalance(params: Record<string, number>) { return createVideoEffect('white-balance-v1', { id: 'wb', params }); }
function floatFrame(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb'): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: values.length / 4, height: 1, sampleFormat: 'float32', primaries, transfer: 'linear' }, pixels: Float32Array.from(values) };
}
function uint16Frame(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb'): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: values.length / 4, height: 1, sampleFormat: 'unorm16', primaries, transfer: 'linear' }, pixels: Uint16Array.from(values) };
}
function request(frame: PixelFrameV1, develop = recipe(), signal = new AbortController().signal): PhotoLibraryDevelopFrameRequestV3 { return { frame, develop, signal }; }
function floatValues(values: readonly number[]): number[] { return [...Float32Array.from(values)]; }
function rawBytes(frame: Readonly<PixelFrameV1>): Uint8Array { return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength); }
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => { assert.fail('The real factory operation settled before entering the consumer.'); }, (error: unknown) => { throw error; })]);
}

for (const primaries of ['srgb', 'bt709'] as const) {
	test(`Current linear runtime preserves adjacent UNORM16 ${primaries} samples as native Float32 without byte quantization`, async () => {
		const run = linearRuntime(), frame = uint16Frame([1, 2, 32768, 32769, 65534, 65535, 0, 65535], primaries), before = rawBytes(frame).slice();
		let backing: Uint8Array | undefined;
		const value = await run(request(frame), output => {
			assert.ok(output.pixels instanceof Float32Array); assert.equal(Object.getPrototypeOf(output.pixels), Float32Array.prototype);
			assert.deepEqual(output.descriptor, { ...frame.descriptor, sampleFormat: 'float32' });
			assert.notEqual(output.pixels.buffer, frame.pixels.buffer); backing = rawBytes(output);
			return [...output.pixels];
		});
		assert.deepEqual(value, floatValues([1 / 65535, 2 / 65535, 32768 / 65535, 32769 / 65535, 65534 / 65535, 1, 0, 1]));
		assert.notEqual(value[0], value[1]); assert.notEqual(value[4], value[5]);
		assert.deepEqual(rawBytes(frame), before); assert.ok(backing?.every(byte => byte === 0));
	});
	test(`Current linear runtime preserves signed HDR and adjacent native Float32 ${primaries} values`, async () => {
		const run = linearRuntime(), frame = floatFrame([-.25, 2, 4, .25, .10000000149011612, .10000000894069672, .12345679104328156, 0], primaries);
		const before = rawBytes(frame).slice(); let backing: Uint8Array | undefined;
		const value = await run(request(frame), output => { backing = rawBytes(output); return { descriptor: output.descriptor, pixels: [...output.pixels] }; });
		assert.deepEqual(value.descriptor, frame.descriptor); assert.deepEqual(value.pixels, [...frame.pixels]);
		assert.notEqual(value.pixels[4], value.pixels[5]); assert.deepEqual(rawBytes(frame), before); assert.ok(backing?.every(byte => byte === 0));
	});
}

test('Current linear factory accepts unchanged complete process1/2/3 identity recipes', async () => {
	const run = linearRuntime(), frame = floatFrame([.125, .25, .5, .75]);
	for (const develop of [defaultImageDevelopStateV1(), defaultImageDevelopStateV2(), recipe()]) {
		assert.deepEqual(await run(request(frame, develop), output => [...output.pixels]), [.125, .25, .5, .75]);
	}
	assert.deepEqual([...frame.pixels], [.125, .25, .5, .75]);
});

test('Current linear exposure followed by its inverse preserves HDR, signed RGB and alpha without a clipped intermediate', async () => {
	const run = linearRuntime(), frame = floatFrame([2, -.25, .125, .375]), before = rawBytes(frame).slice();
	assert.deepEqual(await run(request(frame, recipe([tone({ exposure: 1 })])), output => [...output.pixels]), [4, -.5, .25, .375]);
	assert.deepEqual(await run(request(frame, recipe([tone({ exposure: 1 }, 'up'), tone({ exposure: -1 }, 'down')])), output => [...output.pixels]), [2, -.25, .125, .375]);
	assert.deepEqual(rawBytes(frame), before);
});

test('Current linear exposure retains signed tiny, minimum-normal and subnormal Float32 samples through its inverse', async () => {
	const run = linearRuntime(), frame = floatFrame([1e-30, -1e-30, 2 ** -126, 1, -(2 ** -126), 2 ** -149, -(2 ** -149), .5]);
	const before = rawBytes(frame).slice(), normalized = [...frame.pixels];
	const doubled = floatValues(normalized.map((sample, index) => index % 4 === 3 ? sample : sample * 2));
	assert.deepEqual(await run(request(frame, recipe([tone({ exposure: 1 })])), output => [...output.pixels]), doubled);
	assert.deepEqual(await run(request(frame, recipe([tone({ exposure: 1 }, 'up'), tone({ exposure: -1 }, 'down')])), output => [...output.pixels]), normalized);
	assert.notEqual(doubled[0], 0); assert.notEqual(doubled[1], 0); assert.notEqual(doubled[5], 0); assert.notEqual(doubled[6], 0);
	assert.deepEqual(rawBytes(frame), before);
});

test('Current linear white balance multiplies native channels and preserves hidden RGB and straight alpha', async () => {
	const run = linearRuntime(), frame = floatFrame([.25, .5, 1, .375, -.5, 2, 4, 0]), before = rawBytes(frame).slice();
	const pixels = await run(request(frame, recipe([whiteBalance({ temperature: 100, tint: 0 })])), output => [...output.pixels]);
	assert.deepEqual(pixels, [.5, .5, .5, .375, -1, 2, 2, 0]); assert.deepEqual(rawBytes(frame), before);
});

test('Current linear full tone ladder has independent exposure, pivot, highlights, shadows, whites and blacks literals', async () => {
	const run = linearRuntime(), frame = floatFrame([0, .125, .25, .375]), before = rawBytes(frame).slice();
	const pixels = await run(request(frame, recipe([tone({ exposure: 1, contrast: 50, highlights: 40, shadows: 20, whites: -20, blacks: 60 })])), output => [...output.pixels]);
	// Unclipped pivot bases [-.18,.32,.82]; smooth weights .704512 and
	// .191296 produce these three literals, with one final Float32 assignment.
	assert.deepEqual(pixels, floatValues([.02, .3347744, .8808864, .375])); assert.deepEqual(rawBytes(frame), before);
});

test('Current linear factory retains authored WB/tone order without quantizing each stage to bytes', async () => {
	const run = linearRuntime(), frame = floatFrame([.125, .25, .5, .75]), wb = whiteBalance({ temperature: 100 }), contrast = tone({ contrast: 50 });
	assert.deepEqual(await run(request(frame, recipe([wb, contrast])), output => [...output.pixels]), floatValues([.32, .32, .32, .75]));
	assert.deepEqual(await run(request(frame, recipe([contrast, wb])), output => [...output.pixels]), floatValues([.14, .32, .41, .75]));
});

test('Current linear cancellation joins an admitted held consumer before physically wiping its complete native backing', async () => {
	const run = linearRuntime(), frame = floatFrame([-.25, 2, .125, .5]), before = rawBytes(frame).slice();
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	let backing: Uint8Array | undefined;
	const work = run(request(frame, recipe([tone({ exposure: 1 })]), stop.signal), async output => {
		backing = rawBytes(output); entered.resolve(); await release.promise; assert.ok(backing.some(byte => byte !== 0)); return 'held result';
	});
	const result = outcome(work);
	try {
		await enteredBeforeSettlement(work, entered.promise); stop.abort(reason.proxy);
		assert.equal(await remainsPending(work), true); assert.ok(backing?.some(byte => byte !== 0)); release.resolve();
		const settled = await result; if (settled.ok) assert.fail('Cancelled linear work cannot deliver.');
		assert.equal(settled.error, reason.proxy); assert.ok(backing?.every(byte => byte === 0)); assert.deepEqual(rawBytes(frame), before);
	} finally { release.resolve(); await result; }
});

test('Current linear consumer failure preserves exact opaque identity and wipes captured physical backing despite borrower shadows', async () => {
	const run = linearRuntime(), frame = floatFrame([.25, -.5, 4, .75]), before = rawBytes(frame).slice(), reason = Proxy.revocable({}, {}); reason.revoke();
	let backing: Uint8Array | undefined, getters = 0;
	const result = await outcome(run(request(frame), output => {
		backing = rawBytes(output);
		for (const field of ['buffer', 'byteLength', 'fill']) Object.defineProperty(output.pixels, field, { configurable: true,
			get() { getters++; throw new Error('Borrower shadow must not acquire physical retirement.'); } });
		throw reason.proxy;
	}));
	if (result.ok) assert.fail('Failed consumer cannot deliver.');
	assert.equal(result.error, reason.proxy); assert.equal(getters, 0); assert.ok(backing?.every(byte => byte === 0)); assert.deepEqual(rawBytes(frame), before);
});

test('Current linear factory refuses a physically transferred borrowed output instead of reporting successful retirement', async () => {
	const run = linearRuntime(), frame = floatFrame([.125, .25, 2, .5]), before = rawBytes(frame).slice(); let transferred: ArrayBuffer | undefined;
	await assert.rejects(run(request(frame), output => {
		transferred = structuredClone(output.pixels.buffer, { transfer: [output.pixels.buffer] }); return 'unretired bytes';
	}), TypeError);
	assert.ok(transferred); assert.equal(transferred.byteLength, 16); assert.ok(new Uint8Array(transferred).some(byte => byte !== 0));
	new Uint8Array(transferred).fill(0); assert.deepEqual(rawBytes(frame), before);
});

function inaccessibleFrame(descriptor: PixelFrameDescriptorV1) {
	let reads = 0;
	return { value: { descriptor, get pixels(): never { reads++; throw new Error('Pixel getter was consulted before metadata refusal.'); } } as PixelFrameV1, reads: () => reads };
}
const LINEAR_DESCRIPTOR: PixelFrameDescriptorV1 = { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' };

test('Current linear unsupported families, geometry, masks and repairs refuse before any sample getter or callback', async () => {
	const run = linearRuntime(); let deliveries = 0;
	const disabled = { ...createVideoEffect('chroma-v1', { id: 'disabled' }), enabled: false };
	const cases = [recipe([createVideoEffect('chroma-v1', { id: 'chroma' })]), recipe([disabled]),
		recipe([createVideoEffect('point-curves-v1', { id: 'curve' })]), recipe([createVideoEffect('develop-geometry-v1', { id: 'geometry' })]),
		recipe([], { geometry: { ...defaultImageDevelopStateV2().geometry, flipHorizontal: true } }),
		recipe([], { masks: [gradientGraph()] }),
		recipe([], { repairs: { schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: false,
			target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] } })];
	for (const develop of cases) {
		const frame = inaccessibleFrame(LINEAR_DESCRIPTOR);
		await assert.rejects(run(request(frame.value, develop), () => { deliveries++; }), RangeError); assert.equal(frame.reads(), 0);
	}
	assert.equal(deliveries, 0);
});

test('Current linear profile, side, pixel-count and Float32 output capacity preflight precedes the sample getter', async () => {
	const run = linearRuntime(); let deliveries = 0;
	for (const descriptor of [
		{ ...LINEAR_DESCRIPTOR, transfer: 'srgb' as const }, { ...LINEAR_DESCRIPTOR, primaries: 'display-p3' as const },
		{ ...LINEAR_DESCRIPTOR, transfer: 'pq' as const }, { ...LINEAR_DESCRIPTOR, sampleFormat: 'unorm8' as const },
		{ ...LINEAR_DESCRIPTOR, width: 8193 }, { ...LINEAR_DESCRIPTOR, width: 4097, height: 4096 },
		{ ...LINEAR_DESCRIPTOR, sampleFormat: 'unorm16' as const, width: 4097, height: 4096 },
	]) {
		const frame = inaccessibleFrame(descriptor);
		await assert.rejects(run(request(frame.value), () => { deliveries++; }), RangeError); assert.equal(frame.reads(), 0);
	}
	assert.equal(deliveries, 0);
});

test('Current linear pre-aborted native signal preserves its exact opaque reason without sample or consumer access', async () => {
	const run = linearRuntime(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	const frame = inaccessibleFrame(LINEAR_DESCRIPTOR); let deliveries = 0;
	const result = await outcome(run(request(frame.value, recipe(), stop.signal), () => { deliveries++; }));
	if (result.ok) assert.fail('Aborted render cannot deliver.');
	assert.equal(result.error, reason.proxy); assert.equal(frame.reads(), 0); assert.equal(deliveries, 0);
});

test('Existing Current proxy and full-resolution paths retain exact UNORM8 sRGB bytes and refuse native deep profiles', async () => {
	const runtime = createPhotoDevelopRenderRuntimeV3(), pixels = Uint8Array.of(1, 127, 254, 63);
	const frame: PixelFrameV1 = { descriptor: { ...LINEAR_DESCRIPTOR, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels };
	for (const method of ['withProxy', 'withFullResolution'] as const) {
		assert.deepEqual(await runtime[method](request(frame), view => ({ descriptor: view.frame.descriptor, pixels: [...view.frame.pixels] })),
			{ descriptor: frame.descriptor, pixels: [1, 127, 254, 63] });
		for (const deep of [uint16Frame([1, 2, 3, 65535]), floatFrame([.125, .25, 2, 1])]) {
			let deliveries = 0; await assert.rejects(runtime[method](request(deep), () => { deliveries++; }), RangeError); assert.equal(deliveries, 0);
		}
	}
	assert.deepEqual([...pixels], [1, 127, 254, 63]);
});
