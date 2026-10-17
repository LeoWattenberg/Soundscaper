/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterBatchSidecarRecovery } from '../src/lightscaper/controller/photo-raster-export-batch-sidecar.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { readPhotoRasterExportBinding } from '../src/lightscaper/controller/photo-raster-export-persisted-batch.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { BrowserFileSaveRequest } from '../src/common/editor/browser-file-save-service.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	let photo = normalizePhotoDocumentV2({ ...photoArchiveFixture().photo, schemaVersion: 2 }), current = true;
	const stop = new AbortController(), events: string[] = [], downloads: string[] = [];
	const read = async (request: Parameters<typeof createPhotoExportSidecarV1>[1]) => serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, request));
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'pair', format: 'jpeg', filenameTemplate: '{name}', sidecarEnabled: true,
		members: [{ photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
	const value = createPhotoRasterExportJournalV1(plan, { catalogId: photo.catalogId, filenameTemplate: '{name}', bindings: [await readPhotoRasterExportBinding(binding, read, stop.signal, true)] });
	const member = { ...value.members[0]!, state: 'committed' as const, delivery: { status: 'download-started' as const, method: 'download' as const, fileName: plan.members[0]!.fileName, size: 37 } };
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => {
		assert.ok(signal); await run({ signal, isCurrent: () => current, refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2,
			read: async () => { events.push('saved-read'); return { schemaVersion: 2, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision,
				activeVersionId: photo.activeVersionId, versionId: photo.activeVersionId, versions: [], develop: photo.versions[0]!.develop, history: { cursor: 0, entries: [] }, snapshots: [] }; },
			apply: async () => assert.fail('Recovery must not edit') }) }); return 'completed';
	};
	const runtime = { execute, read, async save(request: BrowserFileSaveRequest) {
		assert.ok(request.blob); assert.equal(request.mimeType, 'application/json'); assert.equal(request.useFileSystemAccess, false);
		assert.equal(typeof request.suggestedName, 'string'); downloads.push(await request.blob.text()); events.push('json');
		return { method: 'download' as const, fileName: request.suggestedName as string, size: request.blob.size };
	} };
	return { runtime, stop, member, binding, events, downloads, text: await read(binding), change: () => { photo = normalizePhotoDocumentV2({ ...photo, metadata: { ...photo.metadata, title: 'Changed metadata' } }); }, retire: () => { current = false; } };
}

test('JSON-only recovery keeps actual raster ACK and reads the selected saved recipe without any pixel owner', async () => {
	const f = await fixture(), owner = new PhotoRasterBatchSidecarRecovery(f.runtime), result = await owner.start(f.binding.catalogId, f.member, f.stop.signal);
	assert.equal(result.status, 'download-started'); assert.equal(result.fileName, f.member.delivery.fileName); assert.equal(result.byteLength, 37);
	if (result.sidecar.status !== 'download-started') assert.ifError(result.sidecar.cause);
	assert.equal(result.sidecar.status, 'download-started'); assert.equal(result.sidecar.fileName, f.member.fileName + '.lightscaper.json');
	assert.deepEqual(f.downloads, [f.text]); assert.ok(f.events.includes('saved-read'));
});

test('same-revision authored metadata drift refuses JSON but preserves the delivered image', async () => {
	const f = await fixture(); f.change(); const result = await new PhotoRasterBatchSidecarRecovery(f.runtime).start(f.binding.catalogId, f.member, f.stop.signal);
	assert.equal(result.status, 'download-started'); assert.equal(result.sidecar.status, 'failed'); assert.deepEqual(f.downloads, []);
});

test('held JSON native ACK is joined through cancellation and survives the late abort', async () => {
	const f = await fixture(), held = deferred<void>(), entered = deferred<void>(), save = f.runtime.save;
	f.runtime.save = async request => { entered.resolve(); await held.promise; return save(request); };
	const owner = new PhotoRasterBatchSidecarRecovery(f.runtime), work = owner.start(f.binding.catalogId, f.member, f.stop.signal); await entered.promise;
	const close = owner.cancelAndJoin(Symbol('cancel')); assert.equal(await remainsPending(close), true); held.resolve();
	const result = await work; await close; assert.equal(result.sidecar.status, 'download-started'); assert.equal(f.downloads.length, 1);
});

test('generation retirement before native publication and opaque read failures retain the image receipt', async () => {
	const f = await fixture(); f.retire(); let result = await new PhotoRasterBatchSidecarRecovery(f.runtime).start(f.binding.catalogId, f.member, f.stop.signal);
	assert.equal(result.sidecar.status, 'failed'); assert.deepEqual(f.downloads, []);
	const g = await fixture(), primary = Symbol('opaque read'); g.runtime.read = async () => { throw primary; };
	result = await new PhotoRasterBatchSidecarRecovery(g.runtime).start(g.binding.catalogId, g.member, g.stop.signal);
	assert.equal(result.sidecar.status, 'failed'); assert.equal(result.sidecar.cause, primary);
});

test('held selected read joins cancellation before refusal without any JSON publication or workflow error', async () => {
	const f = await fixture(), held = deferred<void>(), entered = deferred<void>(), read = f.runtime.read;
	f.runtime.read = async request => { entered.resolve(); await held.promise; return read(request); };
	const owner = new PhotoRasterBatchSidecarRecovery(f.runtime), work = owner.start(f.binding.catalogId, f.member, f.stop.signal);
	await entered.promise; const close = owner.cancelAndJoin(Symbol('selected read cancellation'));
	assert.equal(await remainsPending(close), true); assert.equal(await remainsPending(work), true); held.resolve();
	const result = await work; await close; assert.equal(result.sidecar.status, 'cancelled'); assert.equal(result.byteLength, 37); assert.deepEqual(f.downloads, []);
});

test('own signal/saved-member accessors refuse before selected work without invoking getters', async () => {
	const f = await fixture(); let getters = 0, executions = 0; const execute = f.runtime.execute;
	f.runtime.execute = async (...args) => { executions++; return execute(...args); };
	const signal = new AbortController().signal;
	Object.defineProperty(signal, 'aborted', { get() { getters++; return false; } });
	assert.throws(() => new PhotoRasterBatchSidecarRecovery(f.runtime).start(f.binding.catalogId, f.member, signal));
	const member = Object.defineProperty({ ...f.member }, 'binding', { enumerable: true, get() { getters++; return f.member.binding; } });
	assert.throws(() => new PhotoRasterBatchSidecarRecovery(f.runtime).start(f.binding.catalogId, member, f.stop.signal));
	assert.equal(getters, 0); assert.equal(executions, 0); assert.deepEqual(f.downloads, []);
});
