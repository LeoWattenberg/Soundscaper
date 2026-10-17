/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const SOURCE = [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 255, 224, 16, 255];
function frame(bytes = SOURCE) {
	return { descriptor: { schemaVersion: 1, width: bytes.length / 4, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(bytes) };
}
function effect(type: string, params: Record<string, number> = {}, id = type) {
	return { id, type, enabled: true, params };
}
async function render(effects: readonly unknown[], source = frame(), signal?: AbortSignal) {
	return withGlobalDevelopPixelFrameV1({ frame: source, effects, ...(signal ? { signal } : {}) },
		rendered => Array.from(rendered.pixels), { limits: LIMITS });
}
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

// Independently calculated sRGB transfer/mask goldens, including zero and partial alpha.
test('relative white balance uses fixed linear channel gains and preserves every alpha byte', async () => {
	assert.deepEqual(await render([effect('white-balance-v1', { temperature: 100 })]),
		[0, 32, 44, 0, 90, 128, 140, 1, 176, 128, 92, 127, 255, 224, 9, 255]);
	assert.deepEqual(await render([effect('white-balance-v1', { tint: 100 })]),
		[0, 20, 76, 0, 76, 92, 224, 1, 150, 92, 150, 127, 255, 164, 21, 255]);
});

test('all six tone controls have independent encoded pixel goldens', async () => {
	for (const [params, expected] of [
		[{ exposure: 1 }, [0, 47, 90, 0, 90, 176, 255, 1, 176, 176, 176, 127, 255, 255, 26, 255]],
		[{ contrast: 50 }, [0, 0, 0, 0, 0, 137, 240, 1, 137, 137, 137, 127, 255, 255, 0, 255]],
		[{ highlights: -100 }, [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 225, 207, 16, 255]],
		[{ shadows: 100 }, [137, 140, 147, 0, 147, 163, 192, 1, 163, 163, 163, 127, 255, 224, 138, 255]],
		[{ whites: -100 }, [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 225, 224, 16, 255]],
		[{ blacks: 100 }, [137, 140, 143, 0, 143, 131, 192, 1, 131, 131, 131, 127, 255, 224, 138, 255]],
	] as const) assert.deepEqual(await render([effect('tone-ladder-v1', params)]), expected);
});

test('neutral and disabled operations preserve all256 values and never mutate the source', async () => {
	const values = Array.from({ length: 256 }, (_, value) => [value, 255 - value, value, value]).flat(), source = frame(values);
	assert.deepEqual(await render([effect('white-balance-v1'), effect('tone-ladder-v1')], source), values);
	assert.deepEqual(await render([{ ...effect('tone-ladder-v1', { exposure: 5 }), enabled: false }], source), values);
	assert.deepEqual(Array.from(source.pixels), values);
});

test('ordered operations quantize after each pass instead of merging recipe controls', async () => {
	const warm = effect('white-balance-v1', { temperature: 100 }), dark = effect('tone-ladder-v1', { exposure: -1 });
	const once = await render([warm]);
	assert.deepEqual(await render([warm, dark]), await render([dark], frame(once)));
	assert.notDeepEqual(await render([warm, dark]), await render([dark, warm]));
});

test('only inert supported settings and bounded sRGB byte frames reach the consumer', async () => {
	let getterReads = 0, consumed = 0;
	const params = Object.defineProperty({}, 'temperature', { enumerable: true, get() { getterReads++; return 0; } });
	for (const effects of [[effect('white-balance-v1', params)], [effect('unknown')],
		[effect('tone-ladder-v1', { exposure: Number.NaN })], [effect('tone-ladder-v1', { curve: 1 })],
		[{ ...effect('tone-ladder-v1'), params: undefined }],
		Array.from({ length: 65 }, (_, index) => effect('tone-ladder-v1', {}, String(index))),
		[effect('tone-ladder-v1', {}, 'same'), effect('tone-ladder-v1', {}, 'same')]]) {
		await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: frame(), effects }, () => { consumed++; }, { limits: LIMITS }));
	}
	for (const descriptor of [{ ...frame().descriptor, transfer: 'pq' }, { ...frame().descriptor, primaries: 'display-p3' },
		{ ...frame().descriptor, sampleFormat: 'float32' }, { ...frame().descriptor, width: LIMITS.maximumSidePixels + 1 }]) {
		await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: { descriptor, pixels: frame().pixels }, effects: [] },
			() => { consumed++; }, { limits: LIMITS }));
	}
	assert.equal(getterReads, 0); assert.equal(consumed, 0);
});

test('the effect-count profile is an inert bounded owner choice while the default remains64', async () => {
	let reads = 0, consumed = 0;
	for (const maximumEffects of [0, 100_001, Number.NaN, 1.5]) {
		await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: frame(), effects: [] }, () => { consumed++; }, { limits: LIMITS, maximumEffects }));
	}
	const accessor = Object.defineProperty({ limits: LIMITS }, 'maximumEffects', { enumerable: true, get() { reads++; return 65; } });
	await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: frame(), effects: [] }, () => { consumed++; }, accessor));
	const effects = Array.from({ length: 65 }, (_, index) => effect('tone-ladder-v1', { exposure: index === 64 ? 1 : 0 }, String(index)));
	await assert.rejects(render(effects));
	const output = await withGlobalDevelopPixelFrameV1({ frame: frame(), effects }, value => Array.from(value.pixels), { limits: LIMITS, maximumEffects: 65 });
	assert.deepEqual(output, [0, 47, 90, 0, 90, 176, 255, 1, 176, 176, 176, 127, 255, 255, 26, 255]);
	assert.equal(reads, 0); assert.equal(consumed, 0);
});

test('consumer settlement is joined and owned output is wiped on both outcomes', async () => {
	for (const fails of [false, true]) {
		const gate = held(), failure = new Error('consumer refused'); let output: Uint8Array | undefined, settled = false;
		const work = withGlobalDevelopPixelFrameV1({ frame: frame(), effects: [effect('tone-ladder-v1', { exposure: 1 })] }, async value => {
			output = value.pixels; await gate.promise; if (fails) throw failure; return 'consumed';
		}, { limits: LIMITS });
		void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve();
		assert.equal(output?.[2], 90); assert.equal(settled, false); gate.release();
		if (fails) await assert.rejects(work, error => error === failure); else assert.equal(await work, 'consumed');
		assert.equal(output?.every(byte => byte === 0), true);
	}
});

test('native cancellation remains opaque, avoids signal shadows and joins the held consumer', async () => {
	const controller = new AbortController(), gate = held(); let reads = 0, output: Uint8Array | undefined;
	const reason = new Proxy({}, { get() { reads++; throw new Error('opaque get'); }, getOwnPropertyDescriptor() { reads++; throw new Error('opaque descriptor'); } });
	Object.defineProperty(controller.signal, 'throwIfAborted', { get() { reads++; throw new Error('signal shadow'); } });
	const work = withGlobalDevelopPixelFrameV1({ frame: frame(), effects: [], signal: controller.signal }, async value => {
		output = value.pixels; await gate.promise;
	}, { limits: LIMITS });
	await Promise.resolve(); controller.abort(reason); let settled = false;
	void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve();
	assert.equal(settled, false); gate.release();
	const rejected = await work.then(() => ({ rejected: false, reason: undefined as unknown }), error => ({ rejected: true, reason: error as unknown }));
	assert.equal(rejected.rejected, true); assert.equal(rejected.reason === reason, true);
	assert.equal(reads, 0); assert.equal(output?.every(byte => byte === 0), true);
	const stopped = await render([], frame(), controller.signal).then(() => ({ reason: undefined as unknown }), error => ({ reason: error as unknown }));
	assert.equal(stopped.reason === reason, true); assert.equal(reads, 0);
});

test('large frames yield a real task and cancellation stops before publishing output', async () => {
	const controller = new AbortController(), reason = Object.freeze({ cancelled: 'between chunks' });
	const source = frame(Array.from({ length: 524_288 }, (_, index) => index % 4 === 3 ? 127 : 128));
	source.descriptor.width = 512; source.descriptor.height = 256; let consumed = false, timerRan = false;
	const timer = setTimeout(() => { timerRan = true; controller.abort(reason); }, 0);
	try { await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: source, effects: [effect('tone-ladder-v1', { exposure: 1 })], signal: controller.signal },
		() => { consumed = true; }, { limits: LIMITS }), error => error === reason); }
	finally { clearTimeout(timer); }
	assert.equal(timerRan, true); assert.equal(consumed, false); assert.equal(source.pixels[0], 128);
});

test('one owned snapshot fences source and recipe mutations after the first yield', async () => {
	const source = frame(Array.from({ length: 524_288 }, (_, index) => index % 4 === 3 ? 127 : 128));
	source.descriptor.width = 512; source.descriptor.height = 256;
	const operation = effect('tone-ladder-v1', { exposure: 1 });
	const timer = setTimeout(() => { source.pixels.fill(0); operation.params.exposure = -5; }, 0);
	try { const result = await render([operation], source); assert.equal(result.every((byte, index) => byte === (index % 4 === 3 ? 127 : 176)), true); }
	finally { clearTimeout(timer); }
});

test('native transfer of the borrowed source during a yielded pass cannot truncate owned output', async () => {
	const source = frame(Array.from({ length: 524_288 }, (_, index) => index % 4 === 3 ? 127 : 128));
	source.descriptor.width = 512; source.descriptor.height = 256;
	const timer = setTimeout(() => { structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); }, 0);
	try {
		const result = await render([effect('tone-ladder-v1', { exposure: 1 })], source);
		assert.equal(source.pixels.byteLength, 0); assert.equal(result.length, 524_288);
		assert.equal(result.every((byte, index) => byte === (index % 4 === 3 ? 127 : 176)), true);
	} finally { clearTimeout(timer); }
});
