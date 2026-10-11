/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { createMotionscaperAeExportPackage } from '../src/motionscaper/editor-ae-export-package.ts';
import { importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
const body = new Uint8Array([1, 2, 3, 4]), digest = digestScapeBytes(body);
const base = { byteLength: 4, sha256: digest, storageKey: `motion-sha256:${digest}` };
const image: MotionAsset = { ...base, kind: 'image', id: 'image', name: 'Original picture.png', width: 2, height: 2, hasAlpha: true, mimeType: 'image/png' };
const font: MotionAsset = { ...base, kind: 'font', id: 'unused-font', name: 'Unused original font.otf', family: 'Original face', style: 'Regular', mimeType: 'font/otf' };
const project = () => ({ ...createMotionscaperProject({ id: 'original', title: 'Source custody', compositionId: 'comp' }), assets: [image, font] });
test('Motion AE package retains exact source project and all original media alongside its editable manifest', async () => {
	const prepared = prepareMotionscaperAeExport(project()), packageBlob = await createMotionscaperAeExportPackage(prepared, () => new Blob([body]), { acknowledgeUnsupported: true });
	const zip = new ZipReader(new BlobReader(packageBlob));
	try {
		const entries = await zip.getEntries(); assert.deepEqual(entries.map(entry => entry.filename).sort(), ['README.txt', 'conversion-report.json', 'media/media-0.png', 'motionae.json', 'original.mscape']);
		const read = async (name: string) => { const entry = entries.find(item => item.filename === name)!; if (entry.directory) throw new Error('Expected file'); return entry.getData(new BlobWriter()); };
		const manifest = entries.find(entry => entry.filename === 'motionae.json')!; if (manifest.directory) throw new Error('Expected manifest file'); assert.deepEqual(JSON.parse(await manifest.getData!(new TextWriter())) as unknown, prepared.exchange);
		const retained: string[] = [];
		const opened = await importMotionscaperArchive(await read('original.mscape'), () => ({
			async writeAssetChunk(asset, chunk) { assert.deepEqual(chunk, body); retained.push(asset.name); }, async finishAsset() {}, async commit() {}, async rollback() {},
		}));
		assert.equal(opened.kind, 'current'); if (opened.kind !== 'current') throw new Error('Expected Motion project'); assert.deepEqual(opened.project, prepared.revision.project);
		assert.deepEqual(retained, ['Original picture.png', 'Unused original font.otf']);
		assert.deepEqual(new Uint8Array(await (await read('media/media-0.png')).arrayBuffer()), body);
	} finally { await zip.close(); }
});
test('Motion AE package requires an authentic reviewed snapshot and explicit unsupported acknowledgement before reading', async () => {
	const prepared = prepareMotionscaperAeExport(project()); let reads = 0; const read = () => { reads++; return new Blob([body]); };
	await assert.rejects(createMotionscaperAeExportPackage(prepared, read, { acknowledgeUnsupported: false }), /acknowledge/iu);
	await assert.rejects(createMotionscaperAeExportPackage({ ...prepared }, read, { acknowledgeUnsupported: true }), /review/iu);
	assert.equal(reads, 0);
});
test('Motion AE package refuses altered media, cancellation and oversized source custody before returning a download', async () => {
	const prepared = prepareMotionscaperAeExport(project());
	await assert.rejects(createMotionscaperAeExportPackage(prepared, () => new Blob([new Uint8Array([9, 2, 3, 4])]), { acknowledgeUnsupported: true }), /digest/iu);
	const abort = new AbortController(); abort.abort(); let reads = 0;
	await assert.rejects(createMotionscaperAeExportPackage(prepared, () => { reads++; return new Blob([body]); }, { acknowledgeUnsupported: true, signal: abort.signal }), { name: 'AbortError' }); assert.equal(reads, 0);
	const oversized = prepareMotionscaperAeExport({ ...project(), assets: [{ ...image, byteLength: 134_217_728 }] });
	await assert.rejects(createMotionscaperAeExportPackage(oversized, () => { reads++; return null; }, { acknowledgeUnsupported: true }), /memory|128 MiB/iu); assert.equal(reads, 0);
});
test('Motion AE export rejects media changed between retained source and exchange emission', async () => {
	const prepared = prepareMotionscaperAeExport(project()); let pictures = 0;
	await assert.rejects(createMotionscaperAeExportPackage(prepared, asset => {
		if (asset.id === 'image' && ++pictures === 2) return new Blob([new Uint8Array([8, 2, 3, 4])]);
		return new Blob([body]);
	}, { acknowledgeUnsupported: true }), error => {
		const primary: unknown = error instanceof AggregateError ? error.errors[0] : error; assert.ok(primary instanceof Error); assert.match(primary.message, /digest.*changed/iu); return true;
	}); assert.equal(pictures, 2);
});
test('Motion AE export abort cancels a blocked media reader without producing a partial download', async () => {
	const prepared = prepareMotionscaperAeExport(project()), abort = new AbortController(); let pictures = 0, cancelled = false;
	await assert.rejects(createMotionscaperAeExportPackage(prepared, asset => {
		if (asset.id === 'image' && ++pictures === 2) return { size: 4, stream: () => new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(body.slice(0, 1)); globalThis.setTimeout(() => abort.abort(), 5); },
			cancel() { cancelled = true; },
		}) };
		return new Blob([body]);
	}, { acknowledgeUnsupported: true, signal: abort.signal }), /abort/iu);
	assert.equal(cancelled, true);
});
