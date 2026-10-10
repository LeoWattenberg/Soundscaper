/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture() {
	const owner = new PhotoRasterExport('png'), source = Uint8Array.of(40, 40, 40, 255, 100, 100, 100, 255, 160, 160, 160, 255, 220, 220, 220, 255);
	const graphic = Uint8Array.of(255, 0, 0, 255), encoded = Uint8Array.of(1, 2, 3), calls: string[] = [];
	const descriptor = { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
	const request: PhotoRasterExportRequest = { photoId: 'photo', versionId: 'master', expectedRevision: 3, fileName: 'Photo.png', fileTypeDescription: 'PNG',
		prepareSave: () => { calls.push('picker'); return { mode: 'blob', fileName: 'Photo.png', target: { browserDownload: true } }; },
		saveFile: async value => { calls.push('save'); return { method: 'download', fileName: 'Photo.png', size: value.blob!.size }; },
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [], develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Output cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => { const result = await consume({ photoId: 'photo', revision: 3, frame: { descriptor: { ...descriptor, width: 4 }, pixels: source } }); calls.push('original-settled'); return result; },
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async () => encoded,
		graphicWatermark: { body: new Blob([Uint8Array.of(1)]), anchor: 'bottom-right', widthFraction: 0.5, marginFraction: 0, opacity: 1 },
		withGraphicFrame: async (_value, consume) => { calls.push('graphic-open'); try { return await consume({ descriptor, pixels: graphic }, { orientation: 1, runtimeVersion: 'owning-fixture' }); }
			finally { calls.push('graphic-settled'); graphic.fill(0); } } };
	return { owner, request, source, graphic, encoded, calls };
}

test('real Photo export resizes and sharpens before a delivery-relative graphic, then joins both borrowed owners before save', async () => {
	const f = fixture(), original = f.request.withOriginalFrame, release = deferred<void>(), entered = deferred<void>();
	const work = f.owner.start({ ...f.request, output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', sharpen: { amount: 100, threshold: 0 } },
		encode: async frame => { assert.deepEqual([...frame.pixels], [10, 10, 10, 255, 255, 0, 0, 255]); return f.encoded; },
		withOriginalFrame: async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; } });
	void work.catch(() => undefined); assert.deepEqual(f.calls, ['picker']); await Promise.race([entered.promise, work.then(() => assert.fail('Original hold was not entered'))]);
	assert.equal(await remainsPending(work), true); assert.equal(f.graphic[0], 255); assert.equal(f.calls.includes('save'), false);
	release.resolve(); assert.equal((await work).status, 'download-started');
	assert.deepEqual(f.calls, ['picker', 'graphic-open', 'original-settled', 'graphic-settled', 'save']);
	assert.deepEqual([...f.source], [40, 40, 40, 255, 100, 100, 100, 255, 160, 160, 160, 255, 220, 220, 220, 255]);
	assert.ok(f.graphic.every(value => value === 0)); assert.ok(f.encoded.every(value => value === 0));
});

test('default off and explicit zero opacity bypass the graphic reader and preserve ordinary output bytes', async () => {
	for (const zero of [false, true]) {
		const f = fixture(), { graphicWatermark, ...request } = f.request;
		await f.owner.start({ ...request, ...(zero ? { graphicWatermark: { ...graphicWatermark!, opacity: 0 } } : {}),
			withGraphicFrame: async () => assert.fail('Disabled watermark cannot read a file'), encode: async frame => { assert.deepEqual([...frame.pixels], [...f.source]); return f.encoded; } });
		assert.deepEqual(f.calls, ['picker', 'original-settled', 'save']);
	}
});

test('retirement joins held encoder before marked and graphic planes are wiped and suppresses publication', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), reason = Object.freeze({ retired: true });
	let marked: Uint8Array | null = null;
	const work = f.owner.start({ ...f.request, encode: async frame => { marked = frame.pixels as Uint8Array; entered.resolve(); await release.promise;
		assert.equal(marked.at(-4), 255); assert.equal(f.graphic[0], 255); return f.encoded; } });
	const outcome = work.catch((error: unknown) => error); await Promise.race([entered.promise, work.then(() => assert.fail('Encoder hold was not entered'))]); const retiring = f.owner.cancelAndJoin(reason);
	assert.equal(await remainsPending(retiring), true); assert.equal(f.graphic[0], 255); release.resolve(); await retiring;
	assert.equal(await outcome, reason); assert.ok(marked); assert.ok((marked as Uint8Array).every(value => value === 0));
	assert.ok(f.graphic.every(value => value === 0)); assert.equal(f.calls.includes('save'), false);
});

test('encoded output cannot alias either the graphic or marked backing', async () => {
	for (const alias of ['graphic', 'marked'] as const) {
		const f = fixture();
		await assert.rejects(f.owner.start({ ...f.request, encode: async frame => alias === 'graphic' ? f.graphic : frame.pixels as Uint8Array<ArrayBuffer> }), /independent buffer/u);
		assert.equal(f.calls.includes('save'), false); assert.ok(f.graphic.every(value => value === 0));
	}
});

test('a late original refusal settles the graphic scope and never publishes already encoded bytes', async () => {
	const f = fixture(), reason = Object.freeze({ lateOriginal: true }), original = f.request.withOriginalFrame;
	await assert.rejects(f.owner.start({ ...f.request, withOriginalFrame: async (...args) => { await original(...args); throw reason; } }), error => error === reason);
	assert.equal(f.calls.includes('save'), false); assert.ok(f.graphic.every(value => value === 0)); assert.ok(f.encoded.every(value => value === 0));
});
