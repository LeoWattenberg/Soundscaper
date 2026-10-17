/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoLibraryBackupSourceV1 } from '../src/lightscaper/controller/photo-library-backup-source-v1.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';

test('backup source retains the exact owning admitted canonical root and opens no original during capture', async () => {
	const canonical = readValidatedPhotoCatalogRootV1(savedArchiveRootV3(0)); let snapshots = 0, originals = 0;
	const source = await capturePhotoLibraryBackupSourceV1(canonical.id, { catalog: {
		async readSnapshot() { snapshots++; return { catalog: canonical, indexRevision: 7 }; },
		async readSummaryPage() { return { items: [], continuation: null }; },
		async loadPhoto() { assert.fail('Empty source has no photo aggregate.'); },
	}, async loadOriginal() { originals++; assert.fail('No original may open during capture.'); } });
	assert.equal(source.initial.catalog, canonical); assert.ok(Object.isFrozen(source));
	assert.equal(snapshots, 1); assert.equal(originals, 0); await source.verifyCatalog(); assert.equal(snapshots, 2);
	for await (const record of source.originals) assert.fail(`Empty catalog has no original ${record.photo.id}.`);
	assert.equal(snapshots, 3); assert.equal(originals, 0);
});
