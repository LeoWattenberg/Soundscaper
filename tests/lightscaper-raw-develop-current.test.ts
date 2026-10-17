/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../src/common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

function recipe(effects: readonly unknown[] = []) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects });
}
function words(): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
		pixels: Uint16Array.of(0, 32768, 65535, 16384) };
}

test('Current presentation accepts an authenticated native word Original and paints only final encoded display frames', async () => {
	const source = words(), before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const painted = new Map<HTMLCanvasElement, number[]>(), sourceBefore = [...source.pixels]; let renders = 0;
	const expected = [0, 188, 255, 64];
	const histogram = await createPixelFrameHistogramV1({ descriptor: { ...source.descriptor, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels: Uint8Array.from(expected) });
	// Explicit transport edges isolate presentation. Actual Current native
	// rendering is tested separately; this edge never substitutes decoder proof.
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume) =>
		consume({ photoId: request.photoId, revision: request.expectedRevision, frame: source });
	const render: PhotoLibraryDevelopProxyRuntimeV3['withFullResolution'] = async (request, consume) => {
		renders++; assert.equal(request.frame.descriptor.sampleFormat, 'unorm16');
		const pixels = Float32Array.from(request.frame.pixels, word => word / 65535);
		try { return await consume({ frame: { descriptor: { ...request.frame.descriptor, sampleFormat: 'float32', transfer: 'linear' }, pixels }, histogram }); }
		finally { pixels.fill(0); }
	};
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame,
		loadProxy: async () => ({ withProxy: render, withFullResolution: render }),
		paint(canvas, frame) {
			assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.transfer, 'srgb');
			painted.set(canvas, [...frame.pixels]); return { width: 1, height: 1, byteLength: 4 };
		}, clear() {},
	});
	try {
		owner.setView({ photoId: 'raw', revision: 1, develop: recipe(), before, after, resolution: 'proxy' }); await owner.drain();
		assert.equal(owner.snapshot().status, 'ready'); assert.equal(renders, 1);
		assert.deepEqual(painted.get(before), expected); assert.deepEqual(painted.get(after), expected);
		assert.deepEqual([...source.pixels], sourceBefore);
	} finally { await owner.close(); }
});

test('Current native renderer preserves adjacent word values and recovers unclipped exposure before final display', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), source = words(), before = [...source.pixels];
	const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'up', params: { exposure: 5 } }),
		createVideoEffect('tone-ladder-v1', { id: 'down', params: { exposure: -5 } })]);
	let backing: ArrayBuffer | undefined;
	const result = await runtime.withFullResolution({ frame: source, develop, signal: new AbortController().signal }, async view => {
		assert.equal(view.frame.descriptor.sampleFormat, 'float32'); assert.equal(view.frame.descriptor.transfer, 'linear');
		backing = view.frame.pixels.buffer;
		assert.deepEqual([...view.frame.pixels], [...Float32Array.from(before, word => word / 65535)]);
		assert.equal(view.histogram.sampledPixels, 1); assert.equal(view.histogram.bins.green[188], 1);
		return withLinearPixelFrameDisplayV1({ frame: view.frame }, encoded => [...encoded.pixels], 'full');
	});
	assert.deepEqual(result, [0, 188, 255, 64]); assert.deepEqual([...source.pixels], before);
	assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	const adjacent: PixelFrameV1 = { ...source, descriptor: { ...source.descriptor, width: 2, sampleFormat: 'unorm16' },
		pixels: Uint16Array.of(1024, 2048, 32768, 65535, 1025, 2049, 32769, 65535) };
	await runtime.withFullResolution({ frame: adjacent, develop: recipe(), signal: new AbortController().signal }, view => {
		assert.notEqual(view.frame.pixels[0], view.frame.pixels[4]); assert.notEqual(view.frame.pixels[2], view.frame.pixels[6]);
	});
});

test('Final linear display uses sRGB transfer once, clips only presentation and preserves straight alpha', async () => {
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'bt709', transfer: 'linear' },
		pixels: Float32Array.of(-.5, .0031308, 4, .25, .18, .5, 1, 0) };
	const before = [...frame.pixels]; let output: Uint8Array | undefined;
	assert.deepEqual(await withLinearPixelFrameDisplayV1({ frame }, display => {
		assert.equal(display.descriptor.primaries, 'srgb'); assert.equal(display.descriptor.transfer, 'srgb');
		assert.ok(display.pixels instanceof Uint8Array); output = display.pixels; return [...display.pixels];
	}, 'full'), [0, 10, 255, 64, 118, 188, 255, 0]);
	assert.deepEqual([...frame.pixels], before); assert.ok(output?.every(byte => byte === 0));
});

test('Final linear display fits directly from native samples and never resizes a full encoded derivative', async () => {
	const pixels = new Uint16Array(2050 * 4);
	for (let x = 0; x < 2050; x++) { pixels[x * 4] = x * 31; pixels[x * 4 + 3] = 65535; }
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2050, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels };
	await withLinearPixelFrameDisplayV1({ frame }, display => {
		assert.equal(display.descriptor.width, 2048); assert.equal(display.descriptor.height, 1); assert.equal(display.pixels.byteLength, 8192);
		const last = 2048 * 31 / 65535, encoded = 1.055 * last ** (1 / 2.4) - .055;
		assert.equal(display.pixels[2047 * 4], Math.round(encoded * 255)); assert.equal(display.pixels[2047 * 4 + 3], 255);
	});
});

test('Current native render joins held consumption through opaque cancellation and wipes its pinned Float32 backing', async () => {
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), controller = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let enter!: () => void, release!: () => void, backing: ArrayBuffer | undefined;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const work = runtime.withFullResolution({ frame: words(), develop: recipe(), signal: controller.signal }, async view => {
		backing = view.frame.pixels.buffer; enter(); await held; return 'held';
	}).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered; controller.abort(opaque.proxy); assert.ok(backing); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
		release(); const outcome = await work; assert.equal(outcome.ok, false);
		if (!outcome.ok) assert.ok(Object.is(outcome.error, opaque.proxy)); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	} finally { release(); await work; }
});
