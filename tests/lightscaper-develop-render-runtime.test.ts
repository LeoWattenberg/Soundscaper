/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_DEVELOP_RENDER_RUNTIME_V1 } from '../src/lightscaper/photo-develop-render-runtime-v1.ts';
import { PhotoLibraryDevelopPresentationV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

test('the lazy product runtime composes the actual full frame owner with presentation and preserves exact pixels and histograms', async () => {
	const source = { descriptor: { schemaVersion: 1 as const, width: 2052, height: 1, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(2052 * 4).fill(255) };
	source.pixels.set([40,40,40,255,100,100,100,255,160,160,160,255]);
	const painted: number[][] = []; let previewReads = 0;
	const owner = new PhotoLibraryDevelopPresentationV1({
		withOriginalFrame: async (request, consume) => {
			assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 2 });
			try { return await consume({ photoId: 'photo', revision: 2, frame: source }); } finally { source.pixels.fill(0); }
		},
		readPreview: async () => { previewReads++; throw Error('The actual full runtime must use the original'); },
		loadProxy: async () => PHOTO_DEVELOP_RENDER_RUNTIME_V1,
		paint: (_canvas, frame) => { painted.push([...frame.pixels]); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
		clear() {},
	});
	const develop = normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), geometry: { crop: { x: 0, y: 0, width: 3 / 2052, height: 1 },
		rotationDegrees: 0, flipHorizontal: false, flipVertical: false }, effects: [createVideoEffect('detail-sharpen-v1', { params: { amount: 50 } })] });
	owner.setView({ photoId: 'photo', revision: 2, resolution: 'full', develop, before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement });
	try {
		await owner.drain(); assert.equal(owner.snapshot().status, 'ready'); assert.equal(previewReads, 0);
		assert.equal(painted[0]?.length, 8208); assert.deepEqual(painted[1], [33,33,33,255,100,100,100,255,168,168,168,255]);
		assert.equal(owner.snapshot().before?.sampledPixels, 2052); assert.equal(owner.snapshot().after?.sampledPixels, 3);
		assert.equal(owner.snapshot().after?.bins.red[33], 1); assert.equal(owner.snapshot().after?.bins.red[168], 1);
		assert.deepEqual(owner.snapshot().extent, { before: { width: 2052, height: 1 }, after: { width: 3, height: 1 } });
		assert.ok(source.pixels.every(byte => byte === 0));
	} finally { await owner.close(); }
});

test('the same product runtime retains the fixed compatibility proxy and cannot fall back for a refused original', async () => {
	const frame = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array([40,50,60,127]) };
	assert.deepEqual(await PHOTO_DEVELOP_RENDER_RUNTIME_V1.withProxy({ frame, develop: defaultPhotoDevelopV1(), signal: new AbortController().signal },
		view => [...view.frame.pixels]), [40,50,60,127]);
	const full = PHOTO_DEVELOP_RENDER_RUNTIME_V1.withFullResolution; assert.ok(full);
	await assert.rejects(full({ frame: { ...frame, descriptor: { ...frame.descriptor, width: 8193 } }, develop: defaultPhotoDevelopV1(), signal: new AbortController().signal },
		() => assert.fail('Refused full source cannot enter the consumer')));
});
