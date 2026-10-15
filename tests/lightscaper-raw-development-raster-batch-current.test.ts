/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import { PhotoRasterExportBatchQueueCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import { PhotoRasterPersistedBatchCurrentV1, readPhotoRasterExportBindingCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { recoveryRasterFixture, recoveryPng16Samples, rasterEncodedCode, RECOVERY_OUTPUT16 } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';

test('Current persisted batch binds the entire saved recovery recipe4, reopens it and sends the captured derived capability to native PNG16', { timeout: 30_000 }, async () => {
	const f = await recoveryRasterFixture(), stop = new AbortController();
	let prepared: PhotoRasterPersistedBatchCurrentV1 | undefined, reopened: PhotoRasterPersistedBatchCurrentV1 | undefined, queue: PhotoRasterExportBatchQueueCurrentV1 | undefined;
	try {
		const bound = { catalogId: f.saved.catalogId, photoId: f.saved.photoId, versionId: f.saved.versionId, expectedRevision: f.saved.revision };
		const binding = await readPhotoRasterExportBindingCurrentV1(bound, f.readSidecar, stop.signal, true);
		assert.equal(binding.recipeSha256, canonicalJsonSha256(f.saved.develop));
		const prepare = (recovery = false) => PhotoRasterPersistedBatchCurrentV1.prepare({
			selection: recovery ? [] : [{ photoId: f.saved.photoId, fileName: 'Recovery.dng' }], execute: f.execute,
			readSidecar: f.readSidecar, openJournal: f.openJournal, signal: stop.signal });
		prepared = await prepare(); const first = prepared;
		const runtime = { fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: f.request.withOriginalFrame,
			withDerivedFrame: f.request.withDerivedFrame, loadRenderer: f.request.loadRenderer, readSidecar: f.readSidecar,
			prepareDestinations: (plan: Parameters<typeof first.prepareFreshDestinations>[0]) => first.prepareFreshDestinations(plan,
				{ prepareSave: f.request.prepareSave, saveFile: f.request.saveFile }, '{name}'),
			encode: (_format: 'png' | 'jpeg', ...args: Parameters<typeof f.request.encode>) => f.request.encode(...args),
		};
		queue = new PhotoRasterExportBatchQueueCurrentV1(runtime);
		const receipt = await queue.start({ schemaVersion: 1, batchId: 'recovery-export', format: 'png', filenameTemplate: '{name}',
			members: [{ photoId: f.saved.photoId, versionId: f.saved.versionId, expectedRevision: f.saved.revision, sourceFileName: 'Recovery.dng' }], output: RECOVERY_OUTPUT16 });
		assert.equal(receipt.members[0]?.state, 'completed'); assert.equal(first.journal?.members[0]?.state, 'committed');
		assert.equal(first.journal?.members[0]?.binding.recipeSha256, canonicalJsonSha256(f.saved.develop));
		assert.deepEqual(recoveryPng16Samples(f.deliveries[0]!.bytes).samples, f.floats.map((value, index) => index % 4 === 3 ? 65535 : rasterEncodedCode(Math.fround(value * .5), 65535)));
		const savedOutput = structuredClone(first.journal?.output); await first.closeAndJoin(); reopened = await prepare(true);
		assert.equal(reopened.recovery[0]?.disposition, 'already-committed'); assert.deepEqual(reopened.journal?.output, savedOutput);
		assert.equal(reopened.journal?.output && 'bitDepth' in reopened.journal.output ? reopened.journal.output.bitDepth : null, 16);
		assert.equal(reopened.journal?.members[0]?.binding.recipeSha256, binding.recipeSha256); assert.equal(f.deliveries.length, 1);
		await f.assertCustody();
	} finally { await queue?.cancelAndJoin(); await prepared?.closeAndJoin(); await reopened?.closeAndJoin(); await f.close(); }
});
