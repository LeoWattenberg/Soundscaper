/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { saveFramescaperRetainedOriginal } from '../src/framescaper/editor-project-successor-original-save.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';

test('M10 retained original download verifies exact bytes and refuses a changed digest before publication', async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]); let saved: Blob | undefined;
	const source = createScapeArchiveByteSource({ size: bytes.length, maximumReadBytes: 2, read: ({ offset, length }) => bytes.slice(offset, offset + length) });
	const service: Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'> = {
		async prepareSave(request) { assert.equal(request.useFileSystemAccess, false); return { mode: 'blob', target: {}, fileName: 'original.fscape' }; },
		async saveFile(request) { saved = request.blob; return { fileName: 'original.fscape', size: bytes.length }; },
	};
	await saveFramescaperRetainedOriginal(source, digestScapeBytes(bytes), 'original.fscape', service, new AbortController().signal);
	assert.ok(saved); assert.deepEqual(new Uint8Array(await saved.arrayBuffer()), bytes); saved = undefined;
	await assert.rejects(saveFramescaperRetainedOriginal(source, '0'.repeat(64), 'original.fscape', service, new AbortController().signal), /digest/u); assert.equal(saved, undefined);
});

test('M10 large original save requires a streaming destination and cancellation does not read custody', async () => {
	let reads = 0; const source = createScapeArchiveByteSource({ size: 17 * 1024 * 1024, read: ({ length }) => { reads++; return new Uint8Array(length); } });
	const service: Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'> = {
		async prepareSave(request) { assert.equal(request.useFileSystemAccess, true); return { mode: 'blob', target: {}, fileName: 'large.fscape' }; },
		async saveFile() { throw new Error('No whole archive allocation or save allowed.'); },
	};
	await assert.rejects(saveFramescaperRetainedOriginal(source, '0'.repeat(64), 'large.fscape', service, new AbortController().signal), /streaming/u); assert.equal(reads, 0);
	await saveFramescaperRetainedOriginal(source, '0'.repeat(64), 'large.fscape', { ...service, async prepareSave() { return { mode: 'cancelled', cancelled: true, fileName: 'large.fscape' }; } }, new AbortController().signal);
	assert.equal(reads, 0);
});

test('M10 original streaming save retains its digest failure and concrete destination cleanup failure', async () => {
	const bytes = new Uint8Array([1, 2, 3]); let commits = 0; let aborts = 0; let written = 0;
	const service: Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'> = {
		async prepareSave() { return { mode: 'stream', async createWritable() { return new WritableStream<Uint8Array>({ write(chunk) { written += chunk.length; } }); }, bytesWritten: () => written, async commit() { commits++; return { fileName: 'original.fscape', size: written }; }, async abort() { aborts++; throw new Error('destination cleanup failed'); } }; },
		async saveFile() { throw new Error('No Blob allowed.'); },
	};
	await assert.rejects(saveFramescaperRetainedOriginal(new Blob([bytes]), '0'.repeat(64), 'original.fscape', service, new AbortController().signal), (error: unknown) => error instanceof AggregateError && error.errors.some((cause: unknown) => cause instanceof Error && /digest/u.test(cause.message)) && error.errors.some((cause: unknown) => cause instanceof Error && /cleanup/u.test(cause.message)));
	assert.equal(written, 3); assert.equal(commits, 0); assert.equal(aborts, 1);
});

test('M10 large original downloads use awaited persistent staging and retain the file until the download lifetime ends', async () => {
	const bytes = new Uint8Array(17 * 1024 * 1024); const digest = digestScapeBytes(bytes); let maximumWrite = 0; let count = 0; let removed = 0; let aborted = 0; let release: () => void = () => undefined;
	const held = new Promise<void>(resolve => { release = resolve; }); let downloading: () => void = () => undefined; const started = new Promise<void>(resolve => { downloading = resolve; });
	const signal = new AbortController();
	const service: Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'> = {
		async prepareSave() { return { mode: 'blob', target: {}, fileName: 'large.fscape' }; },
		async saveFile(request) { assert.equal(request.blob.size, bytes.length); return { method: 'download' }; },
	};
	const retained = await saveFramescaperRetainedOriginal(new Blob([bytes]), digest, 'large.fscape', service, signal.signal, {
		async createSink() { return { persistent: true, async write(chunk) { const size = chunk.byteLength; maximumWrite = Math.max(maximumWrite, size); count += size; }, async close() { return new Blob([bytes]); }, async remove() { removed++; }, async abort() { aborted++; } }; },
		async awaitDownload(milliseconds) { assert.equal(milliseconds, 30_000); downloading(); await held; },
	});
	assert.ok(retained); const cleaning = retained.cleanup(); await started; assert.equal(removed, 0); assert.equal(count, bytes.length); assert.equal(maximumWrite, 1024 * 1024);
	signal.abort(); release(); await cleaning; await retained.cleanup(); assert.equal(removed, 1); assert.equal(aborted, 0);
});

test('M10 cancellation during an original streaming copy aborts its destination and never commits', async () => {
	const controller = new AbortController(); let reads = 0; let written = 0; let aborted = 0; let commits = 0;
	const input = createScapeArchiveByteSource({ size: 2 * 1024 * 1024, read({ length }) { if (++reads === 2) controller.abort(); return new Uint8Array(length); } });
	const files: Pick<NativeProjectFileService, 'prepareSave' | 'saveFile'> = {
		async prepareSave() { return { mode: 'stream', async createWritable() { return new WritableStream<Uint8Array>({ write(bytes) { written += bytes.length; } }); }, bytesWritten: () => written, async commit() { commits++; return {}; }, async abort() { aborted++; } }; },
		async saveFile() { throw new Error('No buffered publication allowed.'); },
	};
	await assert.rejects(saveFramescaperRetainedOriginal(input, '0'.repeat(64), 'original.fscape', files, controller.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(written, 1024 * 1024); assert.equal(aborted, 1); assert.equal(commits, 0);
});
