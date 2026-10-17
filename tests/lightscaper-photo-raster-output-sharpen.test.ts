/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture(pixels = Uint8Array.of(40, 40, 40, 255, 100, 100, 100, 255, 160, 160, 160, 255, 220, 220, 220, 255)) {
	const owner = new PhotoRasterExport('png'), events: string[] = [], develop = defaultImageDevelopStateV2();
	const input: PhotoRasterExportRequest = { photoId: 'photo', versionId: 'master', expectedRevision: 3,
		fileName: 'Summer.png', fileTypeDescription: 'PNG image', prepareSave(request) {
			events.push('picker'); assert.ok(typeof request.suggestedName === 'string'); return { mode: 'blob', target: { browserDownload: true }, fileName: request.suggestedName };
		}, saveFile: async request => { events.push('download'); assert.ok(typeof request.suggestedName === 'string');
			return { method: 'download', fileName: request.suggestedName, size: request.blob!.size }; },
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop, history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Output sharpening cannot edit Develop') }) }); },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1,
			width: pixels.length / 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels } }),
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async () => Uint8Array.of(1, 2, 3) };
	return { owner, input, pixels, events, develop };
}

test('output sharpening follows resize and pins literal pixels that differ from sharpening the original first', async () => {
	const f = fixture(), before = f.pixels.slice(), recipe = JSON.stringify(f.develop);
	const result = await f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', sharpen: { amount: 100, threshold: 0 } },
		encode: async frame => { assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [2, 1]);
			assert.deepEqual([...frame.pixels], [10, 10, 10, 255, 190, 190, 190, 255]); return Uint8Array.of(1); } });
	assert.equal(result.status, 'download-started'); assert.deepEqual(f.pixels, before); assert.equal(JSON.stringify(f.develop), recipe);
});

test('default off keeps the developed backing and exact hidden RGB, while enabled sharpening preserves alpha', async () => {
	const f = fixture(Uint8Array.of(9, 31, 57, 0, 40, 40, 40, 64, 160, 160, 160, 255)), original = f.pixels.slice();
	let developed: PixelFrameV1['pixels'] | undefined; const renderer = createPhotoDevelopRenderRuntimeV2();
	await f.owner.start({ ...f.input, output: { sizing: { kind: 'original' }, quality: 'bilinear' },
		loadRenderer: async () => ({ withFullResolution: (request, consume) => renderer.withFullResolution(request, output => {
			developed = output.frame.pixels; return consume(output);
		}) }), encode: async frame => { assert.equal(frame.pixels.buffer, developed!.buffer); assert.deepEqual([...frame.pixels], [...original]); return Uint8Array.of(1); } });
	await f.owner.start({ ...f.input, output: { sizing: { kind: 'original' }, quality: 'bilinear', sharpen: { amount: 100, threshold: 0 } },
		encode: async frame => { assert.deepEqual([frame.pixels[3], frame.pixels[7], frame.pixels[11]], [0, 64, 255]);
			assert.deepEqual([...frame.pixels.subarray(0, 4)], [9, 31, 57, 0]); return Uint8Array.of(1); } });
	assert.deepEqual(f.pixels, original);
});

test('amount and threshold are detached before a held native picker settles', async () => {
	const f = fixture(), picker = deferred<Awaited<ReturnType<PhotoRasterExportRequest['prepareSave']>>>(), sharpen = { amount: 100, threshold: 0 };
	const work = f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', sharpen }, prepareSave: () => picker.promise,
		encode: async frame => { assert.deepEqual([...frame.pixels], [10, 10, 10, 255, 190, 190, 190, 255]); return Uint8Array.of(1); } });
	sharpen.amount = 0; sharpen.threshold = 255; picker.resolve({ mode: 'blob', target: { browserDownload: true }, fileName: 'Summer.png' });
	assert.equal((await work).status, 'download-started');
});

test('cancellation joins the held sharpened encoder before wiping output and refuses publication', async () => {
	const f = fixture(), entered = deferred<void>(), encode = deferred<void>(), reason = Symbol('retired sharpening');
	let pixels: PixelFrameV1['pixels'] | undefined;
	const outcome = f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', sharpen: { amount: 100, threshold: 0 } },
		encode: async frame => { pixels = frame.pixels; entered.resolve(); await encode.promise; return Uint8Array.of(1); } }).catch((error: unknown) => error);
	await Promise.race([entered.promise, outcome.then(() => assert.fail('Sharpening must reach the held encoder'))]);
	const joined = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(joined), true);
	assert.deepEqual([...pixels!], [10, 10, 10, 255, 190, 190, 190, 255]); encode.resolve(); await joined;
	assert.equal(await outcome, reason); assert.ok(pixels!.every(value => value === 0)); assert.equal(f.events.includes('download'), false);
});

test('a sharpened backing cannot masquerade as independently encoded bytes', async () => {
	const f = fixture();
	await assert.rejects(f.owner.start({ ...f.input, output: { sizing: { kind: 'original' }, quality: 'nearest', sharpen: { amount: 100, threshold: 0 } },
		encode: async frame => { assert.ok(frame.pixels instanceof Uint8Array); return frame.pixels; } }), /independent buffer/u);
	assert.equal(f.events.includes('download'), false);
});
