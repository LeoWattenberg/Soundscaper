/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { PhotoLibraryDevelopPresentationV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1, PhotoLibraryDevelopOriginalReadV1, PhotoLibraryDevelopOriginalFrameV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { paintPixelFrameCanvasV1 } from '../src/common/editor/imaging/pixel-frame-canvas-presenter-v1.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const PIXELS = [1, 127, 254, 63];
function currentRecipe() { return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }); }

/** Controlled Original/canvas edges isolate the actual presentation admission
 * and byte renderer. Native deep Original/pack decoding is not claimed here. */
function presentationEdges() {
	const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const painted = new Map<HTMLCanvasElement, number[]>(), borrowed: Uint8Array[] = [], calls = { originals: 0, clears: 0, cached: 0 };
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async <Result>(bound: Readonly<PhotoLibraryDevelopOriginalReadV1>,
		consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => {
		options?.signal?.throwIfAborted(); calls.originals++; const frame = rgbaFrame(PIXELS); borrowed.push(frame.pixels);
		try { return await consume({ photoId: bound.photoId, revision: bound.expectedRevision, frame }); } finally { frame.pixels.fill(0); }
	};
	const paint: typeof paintPixelFrameCanvasV1 = (canvas, frame) => {
		assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.primaries, 'srgb'); assert.equal(frame.descriptor.transfer, 'srgb');
		painted.set(canvas, [...frame.pixels]); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
	};
	return { before, after, painted, borrowed, calls,
		ports: { withOriginalFrame, paint, clear() { calls.clears++; },
			readPreview: async () => { calls.cached++; return { outcome: 'missing' as const }; } },
		view: (develop: ImageDevelopStateCurrentV1 = currentRecipe(), resolution: 'proxy' | 'full' = 'proxy') => ({ photoId: 'photo', revision: 7, develop, resolution, before, after }),
	};
}

test('Actual Current factory linear child leaves both byte presentation resolutions and exact pixels intact', async () => {
	for (const resolution of ['proxy', 'full'] as const) {
		const h = presentationEdges(), runtime = createPhotoDevelopRenderRuntimeV3();
		const owner = new PhotoLibraryDevelopPresentationCurrentV1({ ...h.ports, loadProxy: async () => runtime });
		try {
			owner.setView(h.view(currentRecipe(), resolution)); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
			assert.deepEqual(h.painted.get(h.before), PIXELS); assert.deepEqual(h.painted.get(h.after), PIXELS);
			assert.deepEqual(owner.snapshot().extent, { before: { width: 1, height: 1 }, after: { width: 1, height: 1 } });
			assert.equal(h.calls.originals, 1); assert.equal(h.calls.cached, 0); assert.ok(h.borrowed.every(bytes => bytes.every(value => value === 0)));
		} finally { await owner.close(); }
	}
});

test('Current byte presentation admits its known own-data linear function without invoking or inspecting callable metadata', async () => {
	const h = presentationEdges(), actual = createPhotoDevelopRenderRuntimeV3(); let linearCalls = 0, metadata = 0;
	const runtime = { ...actual, withLinearWorkingFrame: new Proxy(actual.withLinearWorkingFrame, {
		get() { metadata++; throw new Error('Unused linear function metadata is not byte authority.'); },
		apply() { linearCalls++; throw new Error('Byte presentation cannot invoke the linear renderer.'); },
	}) };
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ ...h.ports, loadProxy: async () => runtime });
	try {
		owner.setView(h.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual(h.painted.get(h.after), PIXELS); assert.equal(linearCalls, 0); assert.equal(metadata, 0);
	} finally { await owner.close(); }
});

test('Current presentation still accepts the existing two-method runtime without a linear child', async () => {
	const h = presentationEdges(), actual = createPhotoDevelopRenderRuntimeV3();
	const runtime = { withProxy: actual.withProxy, withFullResolution: actual.withFullResolution };
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ ...h.ports, loadProxy: async () => runtime });
	try { owner.setView(h.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'ready'); assert.deepEqual(h.painted.get(h.after), PIXELS); }
	finally { await owner.close(); }
});

test('Current presentation refuses linear accessors, non-functions and unrelated runtime children before Original or paint', async () => {
	for (const mode of ['accessor', 'non-function', 'unrelated'] as const) {
		const h = presentationEdges(), runtime = { ...createPhotoDevelopRenderRuntimeV3() }; let getters = 0;
		if (mode === 'accessor') Object.defineProperty(runtime, 'withLinearWorkingFrame', { enumerable: true, configurable: true,
			get() { getters++; throw new Error('Linear accessor invoked.'); } });
		if (mode === 'non-function') Object.defineProperty(runtime, 'withLinearWorkingFrame', { enumerable: true, configurable: true, value: 1 });
		if (mode === 'unrelated') Object.defineProperty(runtime, 'withUnrelatedFrame', { enumerable: true, value() { assert.fail('Unrelated runtime child invoked.'); } });
		const owner = new PhotoLibraryDevelopPresentationCurrentV1({ ...h.ports, loadProxy: async () => runtime });
		try {
			owner.setView(h.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'failed');
			assert.equal(getters, 0); assert.equal(h.calls.originals, 0); assert.equal(h.painted.size, 0);
		} finally { await owner.close(); }
	}
});

test('Permanent legacy2 presentation rejects the Current runtime third child and retains its own two-method byte path', async () => {
	for (const current of [true, false]) {
		const h = presentationEdges(), runtime = current ? createPhotoDevelopRenderRuntimeV3() : createPhotoDevelopRenderRuntimeV2();
		const owner = new PhotoLibraryDevelopPresentationV2({ ...h.ports, loadProxy: async () => runtime });
		try {
			owner.setView({ ...h.view(defaultImageDevelopStateV2(), 'full'), develop: defaultImageDevelopStateV2() }); await owner.drain();
			assert.equal(owner.snapshot().status, current ? 'failed' : 'ready'); assert.equal(h.calls.originals, current ? 0 : 1);
			assert.equal(h.calls.cached, 0); if (!current) assert.deepEqual(h.painted.get(h.after), PIXELS); else assert.equal(h.painted.size, 0);
		} finally { await owner.close(); }
	}
});
