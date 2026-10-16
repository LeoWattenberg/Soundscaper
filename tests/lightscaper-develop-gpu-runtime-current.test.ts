/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoLibraryDevelopFrameRequestCurrentV1 } from '../src/common/editor/photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopProxyViewV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

interface GpuView extends PhotoLibraryDevelopProxyViewV3 {
	readonly execution: Readonly<{ backend: 'webgl2' | 'cpu'; reason?: string }>;
}
function gpu() {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), method: unknown = Reflect.get(runtime, 'withGpuPreview');
	assert.equal(typeof method, 'function', 'The actual Current factory must own its additive preview method.');
	assert.ok(typeof method === 'function');
	return <Result>(resolution: 'proxy' | 'full', request: Readonly<PhotoLibraryDevelopFrameRequestCurrentV1>,
		consume: (view: Readonly<GpuView>) => Result | Promise<Result>): Promise<Result> => Reflect.apply(method, runtime, [resolution, request, consume]) as Promise<Result>;
}
function frame(values: readonly number[]): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: values.length / 4, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(values) };
}
function bytes(value: Readonly<PixelFrameV1>) { return new Uint8Array(value.pixels.buffer, value.pixels.byteOffset, value.pixels.byteLength); }

test('actual Current GPU preview retains signed HDR and tiny Float32 samples through whole CPU fallback', async () => {
	const run = gpu(), source = frame([2, -.25, 1e-30, .5]), original = bytes(source).slice(); let output: Uint8Array | undefined;
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [
		{ id: 'up', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } },
		{ id: 'down', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } },
	] });
	const observed = await run('full', { frame: source, develop, signal: new AbortController().signal }, view => {
		assert.equal(view.frame.descriptor.sampleFormat, 'float32'); output = bytes(view.frame);
		return { pixels: [...view.frame.pixels], execution: view.execution };
	});
	assert.deepEqual(observed.pixels, [...source.pixels]); assert.equal(observed.execution.backend, 'cpu');
	assert.ok(typeof observed.execution.reason === 'string' && observed.execution.reason.length > 0);
	assert.ok(output?.every(value => value === 0)); assert.deepEqual(bytes(source), original);
});

test('GPU preview uses the exact existing byte renderer for encoded byte Originals', async () => {
	const run = gpu(), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		pixels: Uint8Array.of(17, 128, 249, 83, 1, 2, 3, 255) };
	const original = bytes(source).slice(), request = { frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal };
	const expected = await runtime.withFullResolution(request, view => ({ descriptor: view.frame.descriptor, pixels: [...view.frame.pixels], histogram: view.histogram }));
	const actual = await run('full', request, view => {
		assert.equal(view.execution.backend, 'cpu');
		return { descriptor: view.frame.descriptor, pixels: [...view.frame.pixels], histogram: view.histogram };
	});
	assert.deepEqual(actual, expected); assert.deepEqual(bytes(source), original);
});

test('native Full GPU preview snapshots every source sample before its first asynchronous boundary', async () => {
	const run = gpu(), source = frame([-.25, 2, 1e-30, 1]), expected = [...source.pixels];
	const work = run('full', { frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal }, view => [...view.frame.pixels]);
	source.pixels.fill(0); assert.deepEqual(await work, expected);
});

test('ordinary Current CPU and permanent V3 factories retain their existing exact entry points', async () => {
	const permanent = createPhotoDevelopRenderRuntimeV3(); assert.equal(Object.hasOwn(permanent, 'withGpuPreview'), false);
	const current = createPhotoDevelopRenderRuntimeCurrentV1(), source = frame([-.125, .25, 2, 1]);
	const value = await current.withFullResolution({ frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal }, view => {
		assert.equal(Object.hasOwn(view, 'execution'), false); return [...view.frame.pixels];
	});
	assert.deepEqual(value, [...source.pixels]);
});

test('GPU preview cancellation joins one held consumer and wipes its native result before rejecting exact opaque cancellation', async () => {
	const run = gpu(), source = frame([-.25, 2, 1e-30, 1]), original = bytes(source).slice();
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	let output: Uint8Array | undefined, consumers = 0;
	const work = run('full', { frame: source, develop: defaultImageDevelopStateV2(), signal: stop.signal }, async view => {
		consumers++; output = bytes(view.frame); entered.resolve(); await release.promise;
		assert.ok(output.some(value => value !== 0), 'Held native pixels remain owned until the consumer joins.'); return 'held';
	});
	const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('Preview settled before its consumer.'), (error: unknown) => { throw error; })]);
		stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		const result = await observed; assert.equal(result.ok, false);
		if (!result.ok) assert.ok(Object.is(result.error, reason.proxy));
		assert.equal(consumers, 1, 'Cancellation after consumer admission cannot retry through CPU.');
		assert.ok(output?.every(value => value === 0)); assert.deepEqual(bytes(source), original);
	} finally { release.resolve(); await observed; }
});

test('GPU preview consumer failure preserves opaque identity and ignores hostile cleanup shadows', async () => {
	const run = gpu(), source = frame([.25, -.5, 4, 1]), reason = Proxy.revocable({}, {}); reason.revoke();
	let output: Uint8Array | undefined, calls = 0, shadows = 0;
	const result = await run('full', { frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal }, view => {
		calls++; output = bytes(view.frame);
		for (const key of ['buffer', 'byteLength', 'fill']) Object.defineProperty(view.frame.pixels, key, { configurable: true,
			get() { shadows++; throw new Error('Borrower shadows cannot acquire physical retirement.'); } });
		throw reason.proxy;
	}).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, reason.proxy));
	assert.equal(calls, 1); assert.equal(shadows, 0); assert.ok(output?.every(value => value === 0));
});

test('GPU proxy chooses the complete exact CPU renderer when only preferred overlap exceeds physical working capacity', async () => {
	const run = gpu(), backing = new ArrayBuffer(500 * 1024 * 1024);
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		pixels: new Float32Array(backing, 0, 2048 * 2048 * 4) };
	source.pixels.set([.25, .5, 2, 1]); source.pixels.set([-1, 1e-30, .125, 1], source.pixels.length - 4);
	const request = { frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal };
	const observe = (view: PhotoLibraryDevelopProxyViewV3) => ({ descriptor: view.frame.descriptor,
		sha256: createHash('sha256').update(bytes(view.frame)).digest('hex'), histogram: view.histogram });
	const expected = await createPhotoDevelopRenderRuntimeCurrentV1().withProxy(request, observe);
	let deliveries = 0;
	const actual = await run('proxy', request, view => {
		deliveries++; assert.equal(view.execution.backend, 'cpu'); assert.equal(view.execution.reason, 'working-set'); return observe(view);
	});
	assert.equal(deliveries, 1); assert.deepEqual(actual, expected); assert.equal(backing.byteLength, 500 * 1024 * 1024);
	assert.deepEqual([...source.pixels.subarray(0, 4)], [.25, .5, 2, 1]);
	assert.deepEqual([...source.pixels.subarray(source.pixels.length - 4)], [...Float32Array.from([-1, 1e-30, .125, 1])]);
});

for (const [resolution, physicalMiB] of [['proxy', 480], ['full', 496]] as const) test(`GPU ${resolution} reserves joined display planes before choosing preferred execution beside a padded word Original`, async () => {
	const run = gpu(), backing = new ArrayBuffer(physicalMiB * 1024 * 1024);
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
		pixels: new Uint16Array(backing, 0, 2048 * 2048 * 4) };
	source.pixels.set([16384, 32768, 65535, 65535]); source.pixels.set([7, 33, 12345, 65535], source.pixels.length - 4);
	const padding = new Uint8Array(backing, backing.byteLength - 1, 1); padding[0] = 219;
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [
		{ id: 'warm', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } },
	] });
	const request = { frame: source, develop, signal: new AbortController().signal };
	const observe = (view: PhotoLibraryDevelopProxyViewV3) => ({ descriptor: view.frame.descriptor,
		sha256: createHash('sha256').update(bytes(view.frame)).digest('hex'), histogram: view.histogram });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const expected = await (resolution === 'proxy' ? runtime.withProxy(request, observe) : runtime.withFullResolution(request, observe));
	let deliveries = 0, output: Uint8Array | undefined;
	const actual = await run(resolution, request, view => {
		deliveries++; output = bytes(view.frame); assert.equal(view.execution.backend, 'cpu');
		// Native source/capture/targets/readback fit alone; the full and fitted
		// RGBA8 presentation allowance must select CPU before any GL probe.
		assert.equal(view.execution.reason, 'working-set'); return observe(view);
	});
	assert.equal(deliveries, 1); assert.deepEqual(actual, expected); assert.ok(output?.every(value => value === 0));
	assert.deepEqual([...source.pixels.subarray(0, 4)], [16384, 32768, 65535, 65535]);
	assert.deepEqual([...source.pixels.subarray(source.pixels.length - 4)], [7, 33, 12345, 65535]);
	assert.equal(backing.byteLength, physicalMiB * 1024 * 1024); assert.equal(padding[0], 219);
});

test('GPU proxy refuses before delivery when neither complete CPU nor GPU phase fits the physical source backing', async () => {
	const run = gpu(), backing = new ArrayBuffer(700 * 1024 * 1024);
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		pixels: new Float32Array(backing, 0, 2048 * 2048 * 4) };
	const request = { frame: source, develop: defaultImageDevelopStateV2(), signal: new AbortController().signal }; let deliveries = 0;
	await assert.rejects(createPhotoDevelopRenderRuntimeCurrentV1().withProxy(request, () => { deliveries++; }), /aggregate|working|bound/u);
	await assert.rejects(run('proxy', request, () => { deliveries++; }), /aggregate|working|bound/u);
	assert.equal(deliveries, 0); assert.equal(backing.byteLength, 700 * 1024 * 1024);
});
