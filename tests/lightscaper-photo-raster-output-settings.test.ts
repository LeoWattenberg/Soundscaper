/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture(develop = defaultImageDevelopStateV2()) {
	const owner = new PhotoRasterExport('png'), events: string[] = [], source = Uint8Array.of(0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255);
	const input: PhotoRasterExportRequest = { photoId: 'photo', versionId: 'master', expectedRevision: 3,
		fileName: 'Summer.png', fileTypeDescription: 'PNG image', prepareSave(request) {
			events.push('picker'); assert.ok(typeof request.suggestedName === 'string'); return { mode: 'blob', target: { browserDownload: true }, fileName: request.suggestedName };
		}, saveFile: async request => {
			events.push('download'); assert.ok(typeof request.suggestedName === 'string'); return { method: 'download', fileName: request.suggestedName, size: request.blob!.size };
		}, execute: async (action, signal) => {
			assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
				acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3,
					activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
					develop, history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Output settings cannot edit Develop') }) });
		}, withOriginalFrame: async (_request, consume) => {
			const result = await consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1, width: 2, height: 2,
				sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source } }); events.push('original-settled'); return result;
		}, loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async () => Uint8Array.of(137, 80, 78, 71) };
	return { owner, input, events, source };
}

test('nearest and bilinear output sizing follows the real Develop renderer and preserves independent literal pixels', async () => {
	for (const [quality, expected] of [['nearest', [0, 0, 0, 255]], ['bilinear', [100, 100, 0, 255]]] as const) {
		const f = fixture(), original = f.source.slice(); let borrowed: PixelFrameV1['pixels'] | undefined;
		const result = await f.owner.start({ ...f.input, output: { sizing: { kind: 'fit' as const, width: 1, height: 1, allowUpscale: false }, quality },
			encode: async frame => { assert.equal(frame.descriptor.width, 1); assert.equal(frame.descriptor.height, 1);
				assert.deepEqual([...frame.pixels], expected); borrowed = frame.pixels; assert.notEqual(frame.pixels.buffer, f.source.buffer); return Uint8Array.of(1, 2, 3); } });
		assert.equal(result.status, 'download-started'); assert.deepEqual([result.width, result.height], [1, 1]);
		assert.ok(borrowed?.every(value => value === 0)); assert.deepEqual(f.source, original);
		assert.equal(f.events.indexOf('download') > f.events.indexOf('original-settled'), true);
	}
});

test('output dimensions and pixels are calculated after the current saved Develop crop, without changing its recipe', async () => {
	const base = defaultImageDevelopStateV2(), develop = normalizeImageDevelopStateV2({ ...base,
		geometry: { ...base.geometry, crop: { x: 0, y: 0, width: 0.5, height: 1 } } });
	const before = JSON.stringify(develop), f = fixture(develop);
	await f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'bilinear' }, encode: async frame => {
		assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [1, 1]); assert.deepEqual([...frame.pixels], [0, 100, 0, 255]); return Uint8Array.of(1);
	} });
	assert.equal(JSON.stringify(develop), before); assert.deepEqual([...f.source], [0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255]);
});

test('output sizing is captured before the held picker settles, rather than reading a later caller mutation', async () => {
	const f = fixture(), picker = deferred<Awaited<ReturnType<PhotoRasterExportRequest['prepareSave']>>>();
	const sizing = { kind: 'fit' as const, width: 1, height: 1, allowUpscale: false };
	const work = f.owner.start({ ...f.input, output: { sizing, quality: 'nearest' as const }, prepareSave: () => picker.promise,
		encode: async frame => { assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [1, 1]); return Uint8Array.of(1); } });
	sizing.width = 2; sizing.height = 2; picker.resolve({ mode: 'blob', target: { browserDownload: true }, fileName: 'Summer.png' });
	assert.equal((await work).status, 'download-started');
});

test('retirement joins a held encoder before wiping resized pixels and never publishes its cancelled output', async () => {
	const f = fixture(), entered = deferred<void>(), encode = deferred<void>(), reason = Symbol('retired output');
	let borrowed: PixelFrameV1['pixels'] | undefined;
	const outcome = f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage' as const, percentage: 50 }, quality: 'bilinear' as const },
		encode: async frame => { borrowed = frame.pixels; entered.resolve(); await encode.promise; return Uint8Array.of(1, 2); } }).catch((error: unknown) => error);
	await Promise.race([entered.promise, outcome.then(() => assert.fail('The resize must enter its held encoder'))]); const joined = f.owner.cancelAndJoin(reason);
	assert.equal(await remainsPending(joined), true); assert.deepEqual([...borrowed!], [100, 100, 0, 255]);
	encode.resolve(); await joined; assert.equal(await outcome, reason); assert.ok(borrowed!.every(value => value === 0));
	assert.equal(f.events.includes('download'), false); assert.deepEqual([...f.source], [0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255]);
});

test('an encoder cannot return the developed buffer when an independent resized frame was supplied', async () => {
	const f = fixture(); let developed: Uint8Array | undefined;
	const runtime = createPhotoDevelopRenderRuntimeV2();
	await assert.rejects(f.owner.start({ ...f.input, output: { sizing: { kind: 'percentage' as const, percentage: 50 }, quality: 'nearest' as const },
		loadRenderer: async () => ({ withFullResolution: (request, consume) => runtime.withFullResolution(request, output => {
			developed = new Uint8Array(output.frame.pixels.buffer); return consume(output);
		}) }), encode: async () => { assert.ok(developed); return developed as Uint8Array<ArrayBuffer>; } }), /independent buffer/u);
	assert.equal(f.events.includes('download'), false);
});
