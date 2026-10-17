/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, capturePhotoRasterExportOutput, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { normalizePhotoRasterExportPresetV1 } from '../src/lightscaper/controller/photo-raster-export-preset-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1, normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
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
	const text = Uint8Array.of(255, 255, 255, 255);
	return { owner, request, source, graphic, text, encoded, calls };
}

const TEXT = { schemaVersion: 1, text: 'Readable ©', font: 'inter-600-latin', color: '#ffffff', anchor: 'bottom-right', widthFraction: .5, marginFraction: 0, opacity: .5 } as const;
const OUTPUT = { sizing: { kind: 'percentage', percentage: 50 } as const, quality: 'nearest' as const, sharpen: { amount: 100, threshold: 0 }, textWatermark: TEXT };

test('real Photo Develop→resize→sharpen→graphic→text pays literal pixels at delivery geometry and joins before publication', async () => {
	const f = fixture(), original = f.request.withOriginalFrame, entered = deferred<void>(), release = deferred<void>();
	const work = f.owner.start({ ...f.request, output: OUTPUT,
	 withTextFrame: async (value, consume) => { assert.ok(value !== null && typeof value === 'object' && 'width' in value && 'height' in value && 'text' in value); assert.equal(value.width, 2); assert.equal(value.height, 1); assert.deepEqual(value.text, TEXT); f.calls.push('text-open');
	  try { return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: f.text }); }
	  finally { f.text.fill(0); f.calls.push('text-settled'); } },
	 encode: async frame => { assert.deepEqual([...frame.pixels], [10,10,10,255,255,188,188,255]); return f.encoded; },
	 withOriginalFrame: async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; } });
	void work.catch(() => undefined); assert.deepEqual(f.calls, ['picker']); await Promise.race([entered.promise, work.then(() => assert.fail('Original hold missing'))]);
	assert.equal(await remainsPending(work), true); assert.equal(f.calls.includes('save'), false); release.resolve(); assert.equal((await work).status, 'download-started');
	assert.ok(f.calls.indexOf('save') > f.calls.indexOf('text-settled')); assert.ok(f.calls.indexOf('save') > f.calls.indexOf('graphic-settled'));
	assert.deepEqual([...f.source], [40,40,40,255,100,100,100,255,160,160,160,255,220,220,220,255]); assert.ok(f.text.every(value => value === 0));
});

test('output text is detached before picker and remains reusable scalar preset data with no file/font capability', () => {
	const input: { text: string } & Omit<typeof TEXT, 'text'> = { ...TEXT }, output = capturePhotoRasterExportOutput({ ...OUTPUT, textWatermark: input }); input.text = 'Changed';
	assert.equal(output.textWatermark?.text, 'Readable ©'); assert.ok(Object.isFrozen(output.textWatermark));
	const preset = normalizePhotoRasterExportPresetV1({ schemaVersion: 1, id: 'export', name: 'Readable', format: 'png', filenameTemplate: '{name}', sidecarEnabled: false, output });
	assert.deepEqual(preset.output.textWatermark, TEXT);
	assert.throws(() => capturePhotoRasterExportOutput({ ...OUTPUT, textWatermark: { ...TEXT, body: new Blob() } }), /unknown|unsupported/i);
});

test('actual durable batch journal roundtrip preserves captured text scalar intent without font/File authorities', () => {
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'batch', format: 'png', filenameTemplate: '{name}', output: OUTPUT,
		members: [{ photoId: 'photo', versionId: 'master', expectedRevision: 3, sourceFileName: 'Photo.png' }] });
	const journal = createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate: '{name}',
		bindings: [{ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: [] }] });
	assert.deepEqual(normalizePhotoRasterExportJournalV1(JSON.parse(JSON.stringify(journal))).output?.textWatermark, TEXT);
	assert.ok(Object.isFrozen(journal.output?.textWatermark));
	assert.throws(() => normalizePhotoRasterExportJournalV1({ ...journal, output: { ...OUTPUT, textWatermark: { ...TEXT, canvas: {} } } }), /field/u);
});

test('text off or zero opacity never opens native font/canvas and preserves exact legacy output', async () => {
	for (const zero of [false, true]) { const f = fixture(), { graphicWatermark: _graphic, ...request } = f.request;
	 await f.owner.start({ ...request, ...(zero ? { output: { sizing: { kind: 'original' }, quality: 'nearest', textWatermark: { ...TEXT, opacity: 0 } } } : {}),
	  withTextFrame: async () => assert.fail('Disabled text cannot acquire native resources'), encode: async frame => { assert.deepEqual([...frame.pixels], [...f.source]); return f.encoded; } });
	 assert.deepEqual(f.calls, ['picker','original-settled','save']); }
});

test('retirement joins held codec while glyph and marked planes remain live, then wipes and refuses publication', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), reason = Object.freeze({ retired: true }); let marked: Uint8Array | undefined;
	const work = f.owner.start({ ...f.request, output: OUTPUT, withTextFrame: async (_value, consume) => { try { return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: f.text }); } finally { f.text.fill(0); } },
	 encode: async frame => { marked = frame.pixels as Uint8Array; entered.resolve(); await release.promise; assert.equal(f.text[0], 255); assert.equal(marked[4], 255); return f.encoded; } });
	const outcome = work.catch((error: unknown) => error); await Promise.race([entered.promise, outcome.then(() => assert.fail('Codec hold missing'))]); const retiring = f.owner.cancelAndJoin(reason);
	assert.equal(await remainsPending(retiring), true); assert.equal(f.text[0], 255); release.resolve(); await retiring; assert.equal(await outcome, reason);
	assert.ok(marked?.every(value => value === 0)); assert.ok(f.text.every(value => value === 0)); assert.equal(f.calls.includes('save'), false);
});

for (const alias of ['text', 'marked'] as const) test(`encoder cannot return the borrowed ${alias} backing`, async () => {
	const f = fixture(); await assert.rejects(f.owner.start({ ...f.request, output: OUTPUT,
	 withTextFrame: async (_value, consume) => { try { return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: f.text }); } finally { f.text.fill(0); } },
	 encode: async frame => alias === 'text' ? f.text : frame.pixels as Uint8Array<ArrayBuffer> }), /independent buffer/u); assert.equal(f.calls.includes('save'), false);
});
