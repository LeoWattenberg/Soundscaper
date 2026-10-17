/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePhotoLibraryImageHandoffCurrentV1 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-image-handoff-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { parsePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

test('Current UI handoff captures the selected native process4 child and exact saved recipe without changing Original custody', async () => {
	const f = await repairSettingsFixture(1), signal = new AbortController().signal;
	try {
		const before = await f.read(), develop = normalizeImageDevelopStateV4({ ...before.develop, processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
		const saved = await f.record(develop), custody = await f.inspect();
		const target = await preparePhotoLibraryImageHandoffCurrentV1(f.session, before.photoId, signal, () => signal.throwIfAborted());
		assert.deepEqual(target.binding, { catalogId: before.catalogId, photoId: before.photoId,
			versionId: before.versionId, expectedRevision: saved.snapshot.revision });
		await target.checkCurrent(signal);
		await target.capture.withCapture(target.binding, async view => {
			const facts = parsePhotoExportSidecarCurrentV1(view.factsJson);
			assert.deepEqual(facts.version.develop, develop);
			assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), f.bytes);
		});
		assert.deepEqual(await f.inspect(), custody);
	} finally { await f.close(); }
});

test('Current UI handoff fences a saved process4 revision change and the selected parent Close', async () => {
	const f = await repairSettingsFixture(1), signal = new AbortController().signal;
	try {
		const before = await f.read(), develop = normalizeImageDevelopStateV4({ ...before.develop, processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
		await f.record(develop);
		const target = await preparePhotoLibraryImageHandoffCurrentV1(f.session, before.photoId, signal, () => signal.throwIfAborted());
		await f.record({ ...develop, rawDevelopment: { schemaVersion: 1, mode: 'headroom' } });
		await assert.rejects(target.checkCurrent(signal), /changed/u);
		await f.close();
		await assert.rejects(target.checkCurrent(signal));
	} finally { await f.close(); }
});
