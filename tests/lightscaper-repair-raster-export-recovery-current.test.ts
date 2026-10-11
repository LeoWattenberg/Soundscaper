/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import { PhotoRasterBatchSidecarRecoveryCurrentV1 as PhotoRasterBatchSidecarRecovery } from '../src/lightscaper/controller/photo-raster-export-batch-sidecar-current-v1.ts';
import { readPhotoRasterExportBindingCurrentV1 as readPhotoRasterExportBinding } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import type { BrowserFileSaveRequest } from '../src/common/editor/browser-file-save-service.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { repairRasterFixture, decodePng } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

type Fixture = Awaited<ReturnType<typeof repairRasterFixture>>;
async function delivered(f: Fixture) {
	const photo = f.photos[0]!, binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const text = await f.readSidecar(binding, { signal: new AbortController().signal }), sidecar: unknown = JSON.parse(text);
	const facts = { originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(photo.versions[0]!.develop), lutSha256: [], sidecarSha256: canonicalJsonSha256(sidecar) };
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'pair', format: 'png', filenameTemplate: '{name}', sidecarEnabled: true,
		members: [{ photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
	const access = await f.openJournal(), journal = new PhotoRasterExportJournalOwnerV1(access.settings, photo.catalogId), input = f.request();
	try {
		await journal.create(createPhotoRasterExportJournalV1(plan, { catalogId: photo.catalogId, filenameTemplate: '{name}', bindings: [facts] }));
		await journal.started(plan.members[0]!.jobId);
		const bytes = await input.withOriginalFrame({ schemaVersion: 1, photoId: photo.id, expectedRevision: photo.revision }, view =>
			f.runtime.withFullResolution({ frame: view.frame, develop: photo.versions[0]!.develop, signal: new AbortController().signal }, output =>
				input.encode(output.frame, { signal: new AbortController().signal, limits: { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 }, maximumOutputBytes: 268_435_456 })));
		try { const saved = await input.saveFile({ purpose: 'media', mimeType: 'image/png', suggestedName: plan.members[0]!.fileName, blob: new Blob([bytes]), target: { browserDownload: true } });
			assert.ok(!('cancelled' in saved)); assert.equal(saved.method, 'download');
			await journal.committed(plan.members[0]!.jobId, { status: 'download-started', method: 'download', fileName: saved.fileName, size: saved.size });
		} finally { bytes.fill(0); }
		const member = journal.current!.members[0]!;
		const runtime = { execute: f.execute, read: f.readSidecar, async save(request: BrowserFileSaveRequest) {
			await access.verifyResources(binding, { signal: request.signal }); return input.saveFile(request);
		} };
		return { member, binding, text, runtime, close: () => journal.closeAndJoin() };
	} catch (error) { await journal.closeAndJoin(); throw error; }
}
function recover(runtime: Awaited<ReturnType<typeof delivered>>['runtime']) {
	return Reflect.construct(PhotoRasterBatchSidecarRecovery, [runtime]) as PhotoRasterBatchSidecarRecovery;
}

test('Current saved-fact binding hashes the actual full repair recipe and Sidecar2 without Original decoding', async () => {
	const f = await repairRasterFixture(), photo = f.photos[0]!, request = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	try { const text = await f.readSidecar(request, { signal: new AbortController().signal });
		const binding = await readPhotoRasterExportBinding(request, f.readSidecar, new AbortController().signal, true);
		assert.deepEqual(binding, { originalSha256: photo.original.contentSha256, recipeSha256: canonicalJsonSha256(photo.versions[0]!.develop), lutSha256: [], sidecarSha256: canonicalJsonSha256(JSON.parse(text)) });
		assert.equal(f.codecs.calls.opens, 0); assert.equal(f.events.includes('original'), false);
	} finally { await f.close(); }
});

test('Current JSON-only recovery retains real PNG/native CAS ACK and emits exact Sidecar2 without another Original, raster or picker', async () => {
	const f = await repairRasterFixture(); let paired: Awaited<ReturnType<typeof delivered>> | undefined;
	try { paired = await delivered(f); const before = [...f.events], opens = f.codecs.calls.opens;
		assert.deepEqual([...decodePng(f.outputs[0]!.bytes).pixels], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		const result = await recover(paired.runtime).start(paired.binding.catalogId, paired.member, new AbortController().signal);
		assert.equal(result.sidecar.status, 'download-started'); assert.equal(result.byteLength, paired.member.delivery!.size);
		assert.equal(f.codecs.calls.opens, opens); assert.deepEqual(f.events.filter(value => value !== 'download'), before.filter(value => value !== 'download'));
		assert.equal(new TextDecoder().decode(f.outputs[1]!.bytes), paired.text); assert.equal(f.outputs[1]!.name, paired.member.fileName + '.lightscaper.json');
		assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await paired?.close(); await f.close(); }
});

test('Current JSON recovery joins a held genuine download ACK and preserves it through late native cancellation', async () => {
	const f = await repairRasterFixture(), entered = deferred<void>(), held = deferred<void>(); let paired: Awaited<ReturnType<typeof delivered>> | undefined;
	let owner: PhotoRasterBatchSidecarRecovery | undefined, work: ReturnType<PhotoRasterBatchSidecarRecovery['start']> | undefined;
	try { paired = await delivered(f); const save = paired.runtime.save;
		owner = recover({ ...paired.runtime, async save(request) { const saved = await save(request); entered.resolve(); await held.promise; return saved; } });
		work = owner.start(paired.binding.catalogId, paired.member, new AbortController().signal); void work.catch(() => undefined);
		await Promise.race([entered.promise, work.then(() => assert.fail('Real JSON ACK never entered'))]);
		assert.equal(f.outputs.length, 2); const closing = owner.cancelAndJoin(Symbol('late cancellation')); assert.equal(await remainsPending(closing), true);
		held.resolve(); const result = await work; await closing; assert.equal(result.sidecar.status, 'download-started'); assert.equal(f.outputs.length, 2);
	} finally { held.resolve(); await work?.catch(() => undefined); await paired?.close(); await f.close(); }
});

test('Current top-level Photo3 with a restored legacy active recipe still requires Sidecar2 and real saved-fact admission', async () => {
	const f = await repairRasterFixture(); let paired: Awaited<ReturnType<typeof delivered>> | undefined;
	try { await f.changeRecipe(defaultImageDevelopStateV2()); assert.equal(f.photos[0]!.schemaVersion, 3); assert.equal(f.photos[0]!.versions[0]!.develop.processVersion, 2);
		paired = await delivered(f); const document = JSON.parse(paired.text) as { schemaVersion: number; photoSchemaVersion: number; version: { develop: { processVersion: number } } };
		assert.deepEqual([document.schemaVersion, document.photoSchemaVersion, document.version.develop.processVersion], [2, 3, 2]);
		const result = await recover(paired.runtime).start(paired.binding.catalogId, paired.member, new AbortController().signal); assert.equal(result.sidecar.status, 'download-started');
	} finally { await paired?.close(); await f.close(); }
});

test('Current recovery refuses own member/signal accessors before invoking actual selected operations', async () => {
	const f = await repairRasterFixture(); let paired: Awaited<ReturnType<typeof delivered>> | undefined;
	try { paired = await delivered(f); let getters = 0, calls = 0; const execute = paired.runtime.execute;
		const owner = recover({ ...paired.runtime, execute: async (...args) => { calls++; return execute(...args); } });
		const member = Object.defineProperty({ ...paired.member }, 'binding', { enumerable: true, get() { getters++; return paired!.member.binding; } });
		assert.throws(() => owner.start(paired!.binding.catalogId, member, new AbortController().signal));
		const signal = new AbortController().signal; Object.defineProperty(signal, 'reason', { get() { getters++; return null; } });
		assert.throws(() => recover(paired!.runtime).start(paired!.binding.catalogId, paired!.member, signal));
		assert.equal(getters, 0); assert.equal(calls, 0); assert.equal(f.outputs.length, 1);
	} finally { await paired?.close(); await f.close(); }
});

test('Current JSON recovery preserves a sole revoked opaque read failure and the genuine previous raster ACK', async () => {
	const f = await repairRasterFixture(), primary = Proxy.revocable({}, {}); primary.revoke(); let paired: Awaited<ReturnType<typeof delivered>> | undefined;
	try { paired = await delivered(f); const result = await recover({ ...paired.runtime, read: async () => { throw primary.proxy; } }).start(paired.binding.catalogId, paired.member, new AbortController().signal);
		assert.equal(result.status, 'download-started'); assert.equal(result.byteLength, paired.member.delivery!.size); assert.equal(result.sidecar.status, 'failed');
		assert.equal(result.sidecar.cause, primary.proxy);
		assert.equal(f.outputs.length, 1); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await paired?.close(); await f.close(); }
});
