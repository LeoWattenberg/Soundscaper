/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoRasterBatchDownloadDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-download-destinations.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
const plan = () => capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'download', format: 'png', filenameTemplate: '{index:2}-{name}',
	members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'First.png' }, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Second.png' }] });
test('initial authority freezes explicit browser targets and the real save service downloads without a picker', async () => {
	const value = plan(), names: string[] = [], blobs: Blob[] = [], revoked: string[] = [];
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker: async () => assert.fail('Batch must never open a picker') },
		document: { createElement: () => ({ href: '', hidden: false, download: '', click() { names.push(this.download); } }) },
		urlApi: { createObjectURL(blob) { blobs.push(blob); return 'blob:batch'; }, revokeObjectURL: url => { revoked.push(url); } },
		setTimeout: callback => { callback(); return 1; } });
	const owner = createPhotoRasterBatchDownloadDestinations(value, service);
	for (const member of value.members) {
		const request = { purpose: 'media', fileName: 'override.png', suggestedName: 'override.png', useFileSystemAccess: true, target: null, bytes: new Uint8Array([member.index]) };
		const prepared = await owner.prepareSave(member, request); assert.equal(prepared.mode, 'blob'); assert.equal(prepared.fileName, member.fileName);
		assert.equal((await owner.saveFile(member, request)).fileName, member.fileName);
	}
	await owner.retireAndJoin(); assert.deepEqual(names, ['01-First.png', '02-Second.png']);
	assert.deepEqual(await Promise.all(blobs.map(async body => [...new Uint8Array(await body.arrayBuffer())])), [[1], [2]]); assert.equal(revoked.length, 2);
});
test('borrowed receiver/capabilities are pinned; retirement joins the held native save and blocks new work', async () => {
	const value = plan(), held = deferred<void>(), calls: string[] = [];
	const runtime = { prepareSave: async () => ({ mode: 'blob' as const, target: {}, fileName: value.members[0]!.fileName }),
		async saveFile(request: { fileName?: unknown }) { assert.equal(this, runtime); calls.push(String(request.fileName)); await held.promise;
			return { method: 'download' as const, fileName: String(request.fileName), size: 1 }; } };
	const owner = createPhotoRasterBatchDownloadDestinations(value, runtime);
	runtime.saveFile = async () => assert.fail('Late capability substitution');
	const work = owner.saveFile(value.members[0]!, { bytes: new Uint8Array([1]) }), joined = owner.retireAndJoin();
	await remainsPending(joined); assert.throws(() => owner.saveFile(value.members[1]!, {}));
	held.resolve(); await work; await joined; await owner.retireAndJoin(); assert.deepEqual(calls, ['01-First.png']);
});
test('foreign member copies and accessor save capabilities refuse without invoking foreign getters', () => {
	const value = plan(), service = createBrowserFileSaveService({ document: null }), owner = createPhotoRasterBatchDownloadDestinations(value, service);
	assert.throws(() => owner.prepareSave({ ...value.members[0]! }, {})); let reads = 0;
	assert.throws(() => createPhotoRasterBatchDownloadDestinations(value, Object.defineProperty({ saveFile: service.saveFile }, 'prepareSave', { enumerable: true, get() { reads++; return service.prepareSave; } })));
	assert.equal(reads, 0);
});
