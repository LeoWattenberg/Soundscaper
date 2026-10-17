/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { maximumPhotoCatalogStreamingOutputBytesV1, maximumPhotoCatalogStreamingOutputBytesV3, maximumPhotoCatalogStreamingOutputBytesV5 } from '../src/lightscaper/archive/catalog-archive-capacity.ts';
import { PhotoCatalogArchiveIdentityGuard } from '../src/lightscaper/archive/catalog-archive-contract.ts';
import { writePhotoCatalogArchive } from '../src/lightscaper/archive/catalog-archive-writer.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-limits.ts';
import { maximumScapeStoreArchiveBytes } from '../src/common/editor/scape-export-estimate.ts';

test('version3 admits the longest registered pack names without changing the version1 bound', () => {
	const maximum = maximumPhotoCatalogStreamingOutputBytesV3();
	assert.equal(maximum - maximumPhotoCatalogStreamingOutputBytesV1(), 90_112);
	const entries = Array.from({ length: SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2 }, (_, index) => ({
		filename: `assets/saved-collection-pack-${String(index + 1).padStart(6, '0')}.bin`, payloadBytes: 0,
	}));
	const required = maximumScapeStoreArchiveBytes([...entries,
		{ filename: 'project.json', payloadBytes: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes },
		{ filename: 'manifest.json', payloadBytes: 0 }]);
	assert.ok(required <= maximum); assert.ok(required > maximumPhotoCatalogStreamingOutputBytesV1());
});

test('invalid or enlarged streaming bounds refuse before acquiring the destination or enumerating sources', async () => {
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog', name: 'Empty', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	for (const bound of [0, 1.5, Number.NaN, maximumPhotoCatalogStreamingOutputBytesV3() + 1]) {
		let enumerations = 0, writes = 0, closes = 0, aborts = 0;
		const writable = new WritableStream<Uint8Array>({ write() { writes += 1; }, close() { closes += 1; }, abort() { aborts += 1; } });
		const photos = { [Symbol.iterator]() { enumerations += 1; return [][Symbol.iterator](); } };
		await assert.rejects(writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root),
			async () => { throw new Error('Preparation must not run'); }, { writable }, bound), RangeError);
		assert.equal(writable.locked, false); assert.equal(enumerations + writes + closes + aborts, 0);
	}
});

test('V5 derives longer pinned LUT-name framing from the unchanged entry and expanded payload ceilings', () => {
	const required = maximumScapeStoreArchiveBytes(Array.from({ length: SCAPE_ARCHIVE_LIMITS.maximumEntryCount }, (_, index) => ({
		filename: `assets/luts/${index.toString(16).padStart(64, '0')}.cube`, payloadBytes: index === 0 ? SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes : 0,
	})));
	assert.equal(maximumPhotoCatalogStreamingOutputBytesV5(), required);
	assert.ok(required > maximumPhotoCatalogStreamingOutputBytesV3());
	assert.equal(SCAPE_ARCHIVE_LIMITS.maximumEntryCount, 4096); assert.equal(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes, 68_719_476_736);
	assert.equal(maximumPhotoCatalogStreamingOutputBytesV3() - maximumPhotoCatalogStreamingOutputBytesV1(), 90_112);
});
