/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture() {
	const owner = new PhotoRasterExport('jpeg'), events: string[] = [], encoded = new Uint8Array([255, 216, 1, 255, 217]);
	const input: PhotoRasterExportRequest = { photoId: 'photo', versionId: 'master', expectedRevision: 3,
		fileName: 'Summer', fileTypeDescription: 'JPEG image', prepareSave(request) {
			events.push('picker'); assert.equal(request.mimeType, 'image/jpeg'); assert.equal(request.suggestedName, 'Summer.jpg');
			assert.deepEqual(request.types, [{ description: 'JPEG image', accept: { 'image/jpeg': ['.jpg'] } }]);
			return { mode: 'blob', target: { browserDownload: true }, fileName: request.suggestedName! };
		}, saveFile: async request => {
			events.push('download'); assert.equal(request.mimeType, 'image/jpeg'); assert.equal(request.blob?.type, 'image/jpeg'); assert.ok(typeof request.suggestedName === 'string');
			assert.deepEqual(new Uint8Array(await request.blob!.arrayBuffer()), new Uint8Array([255, 216, 1, 255, 217]));
			return { method: 'download', fileName: request.suggestedName!, size: request.blob!.size };
		}, execute: async (action, signal) => {
			assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
				acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3,
					activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
					develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }) });
		}, withOriginalFrame: async (_request, consume) => {
			const result = await consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1, width: 2, height: 1,
				sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([137, 0, 0, 255, 0, 37, 0, 255]) } });
			events.push('original-settled'); return result;
		}, loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), encode: async frame => {
			events.push('encode'); assert.deepEqual(Array.from(frame.pixels), [137, 0, 0, 255, 0, 37, 0, 255]); return encoded;
		} };
	return { owner, input, events, encoded };
}

test('JPEG prepares the exact native MIME/extension in the Save gesture and downloads only after late original settlement', async () => {
	const f = fixture(), closed = deferred<void>(), entered = deferred<void>(), original = f.input.withOriginalFrame;
	const work = f.owner.start({ ...f.input, withOriginalFrame: async (...args) => { const result = await original(...args); entered.resolve(); await closed.promise; return result; } });
	assert.deepEqual(f.events, ['picker']); await entered.promise;
	assert.equal(await remainsPending(work), true); assert.equal(f.events.includes('download'), false); assert.equal(f.encoded[0], 255);
	closed.resolve(); const receipt = await work; assert.equal(receipt.status, 'download-started');
	assert.deepEqual(receipt, { status: 'download-started', photoId: 'photo', versionId: 'master', revision: 3,
		width: 2, height: 1, byteLength: 5, fileName: 'Summer.jpg', method: 'download' });
	assert.equal(f.encoded.every(value => value === 0), true);
});

test('JPEG cancellation holds encoded bytes through the real native write and abort drain', async () => {
	const f = fixture(), entered = deferred<void>(), write = deferred<void>(), abortEntered = deferred<void>(), abort = deferred<void>(), reason = new Error('retired');
	const work = f.owner.start({ ...f.input, prepareSave: request => createFileSystemPreparedSave({ fileName: 'Summer.jpg', signal: request.signal,
		target: { createWritable: async () => ({ write: async value => { entered.resolve(); await write.promise; assert.deepEqual(Array.from(value as Uint8Array), [255, 216, 1, 255, 217]); },
			close: () => assert.fail('Cancelled JPEG cannot commit'), abort: async () => { abortEntered.resolve(); await abort.promise; } }) } }) });
	const outcome = work.catch((error: unknown) => error); await entered.promise;
	const retiring = f.owner.cancelAndJoin(reason); await abortEntered.promise; assert.equal(await remainsPending(retiring), true);
	abort.resolve(); assert.equal(await remainsPending(retiring), true); assert.equal(f.encoded[0], 255);
	write.resolve(); await retiring; assert.equal(await outcome, reason); assert.equal(f.encoded.every(value => value === 0), true);
});
