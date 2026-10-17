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

test('paired targets pin JSON delivery in the same initial gesture and join its held native call', async () => {
	const value = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'pair', format: 'jpeg', filenameTemplate: '{name}', sidecarEnabled: true,
		members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'First.png' }] });
	const held = deferred<void>(), entered = deferred<void>(), names: string[] = [];
	const runtime = { prepareSave: () => assert.fail('JSON-only retry must not prepare raster'),
		async saveFile(request: { fileName?: unknown; useFileSystemAccess?: unknown; target?: unknown }) {
			assert.equal(this, runtime); assert.equal(request.useFileSystemAccess, false); names.push(String(request.fileName)); entered.resolve(); await held.promise;
			return { method: 'download' as const, fileName: String(request.fileName), size: 2 };
		} };
	const owner = createPhotoRasterBatchDownloadDestinations(value, runtime); runtime.saveFile = async () => assert.fail('Late JSON method substitution');
	const work = Promise.resolve(owner.saveSidecar!(value.members[0]!, { fileName: 'wrong', mimeType: 'application/json', blob: new Blob(['{}'], { type: 'application/json' }) }));
	await entered.promise; const joined = owner.retireAndJoin(); assert.equal(await remainsPending(joined), true); held.resolve();
	await work; await joined; assert.deepEqual(names, ['First.jpg.lightscaper.json']);
});

test('both image and JSON target names are detached in the gesture before caller plan mutation', async () => {
	const base = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'pair', format: 'png', filenameTemplate: '{name}', sidecarEnabled: true,
		members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'First.png' }] });
	const member = { ...base.members[0]! }, value = { ...base, members: [member] }, names: string[] = [];
	const runtime = { prepareSave: () => assert.fail('JSON recovery has no picker'), saveFile: async (request: { fileName?: unknown }) => {
		assert.equal(typeof request.fileName, 'string'); names.push(request.fileName as string); return { method: 'download' as const, fileName: request.fileName as string, size: 2 };
	} };
	const owner = createPhotoRasterBatchDownloadDestinations(value, runtime); member.fileName = 'Late override.png';
	await owner.saveFile(member, {}); await owner.saveSidecar!(member, { blob: new Blob(['{}'], { type: 'application/json' }), mimeType: 'application/json' });
	await owner.retireAndJoin(); assert.deepEqual(names, ['First.png', 'First.png.lightscaper.json']);
});
