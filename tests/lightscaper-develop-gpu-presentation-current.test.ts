/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1, preparePhotoDevelopPresentationViewCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { preparePhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoLibraryDevelopFrameRequestCurrentV1 } from '../src/common/editor/photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopProxyViewV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { paintPixelFrameCanvasV1 } from '../src/common/editor/imaging/pixel-frame-canvas-presenter-v1.ts';
import { deferred } from './helpers/async-test-control.ts';

test('Current presenter captures the temporary GPU preference before waiting and leaves canonical Before unchanged', async () => {
	const actual = createPhotoDevelopRenderRuntimeCurrentV1(), release = deferred<void>(), entered = deferred<void>();
	const calls: string[] = [], painted = new Map<HTMLCanvasElement, number[]>(), before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const input = { photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), resolution: 'full' as const, before, after, previewRenderer: 'gpu-preferred' };
	const prepared = preparePhotoDevelopPresentationViewCurrentV1(input);
	assert.equal(Reflect.get(prepared, 'previewRenderer'), 'gpu-preferred'); assert.ok(Object.isFrozen(prepared));
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume, options) => {
		assert.ok(options?.signal); calls.push('original');
		const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' } as const,
			pixels: Uint16Array.of(16384, 32768, 65535, 65535) };
		try { return await consume({ photoId: request.photoId, revision: request.expectedRevision, frame }); } finally { frame.pixels.fill(0); calls.push('retired'); }
	};
	const runtime = { withProxy: actual.withProxy, withFullResolution: actual.withFullResolution,
		withGpuPreview: async <Result>(resolution: 'proxy' | 'full', request: Readonly<PhotoLibraryDevelopFrameRequestCurrentV1>, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => {
			calls.push(`gpu:${resolution}`); return actual.withFullResolution(request, consume);
		} };
	const paint: typeof paintPixelFrameCanvasV1 = (canvas, frame) => { painted.set(canvas, [...frame.pixels]);
		return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; };
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame, paint, clear: canvas => { painted.delete(canvas); },
		loadProxy: async () => { entered.resolve(); await release.promise; return runtime; } });
	try {
		owner.setView(prepared); await entered.promise; input.previewRenderer = 'cpu'; release.resolve(); await owner.drain();
		assert.equal(owner.snapshot().status, 'ready'); assert.deepEqual(calls, ['original', 'gpu:full', 'retired']);
		assert.deepEqual(painted.get(before), [137, 188, 255, 255]); assert.deepEqual(painted.get(after), painted.get(before));
	} finally { release.resolve(); await owner.close(); }
});

test('permanent presentation refuses the temporary Current renderer policy and Current rejects unknown renderer choices', () => {
	const value = { photoId: 'photo', revision: 7, develop: defaultImageDevelopStateV2(), before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement };
	assert.throws(() => preparePhotoDevelopPresentationViewV2({ ...value, previewRenderer: 'gpu-preferred' }), TypeError);
	assert.throws(() => preparePhotoDevelopPresentationViewCurrentV1({ ...value, previewRenderer: 'software-v2' }));
});
