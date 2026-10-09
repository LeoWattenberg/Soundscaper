/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { borrowPhotoImportDevelopPresetV2 } from '../src/lightscaper/import/photo-import-develop-preset-v2.ts';
import { admitPhotoLibraryDevelopImportRequestV2 } from '../src/lightscaper/controller/photo-library-develop-import-request-v2.ts';
import { lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

test('current preset import captures its row receiver once and promotes genuine unpublished legacy photos', async () => {
	const f = lutArchiveFixture(), original = photoArchiveFixture().photo; let calls = 0;
	const settings = { readEntry: async () => { calls++; return { present: true as const, value: f.row }; } };
	const capture = borrowPhotoImportDevelopPresetV2(settings, { schemaVersion: 2, catalogId: original.catalogId,
		presetId: 'preset', expectedRevision: f.row.revision });
	settings.readEntry = async () => { throw new Error('Replaced reader'); };
	const apply = await capture(original.catalogId, new AbortController().signal), photo = apply(original);
	assert.equal(calls, 1); assert.equal(photo.schemaVersion, 2); assert.equal(photo.revision, 0);
	assert.deepEqual(photo.original, original.original); assert.deepEqual(photo.extractedMetadata, original.extractedMetadata);
	assert.equal(photo.versions[0]?.workspace?.schemaVersion, 2);
	assert.deepEqual(photo.versions[0]?.develop, f.record.photo.versions[0]?.develop);
	assert.equal(photo.versions[0]?.workspace?.entries.length, 2);
});

test('current import requests detach a fixed scalar preset2 identity and refuse old or embedded recipes', () => {
	const preset = { schemaVersion: 2, catalogId: 'catalog-1', presetId: 'preset', expectedRevision: 29 };
	const request = admitPhotoLibraryDevelopImportRequestV2({ schemaVersion: 2, developPreset: preset });
	preset.presetId = 'replaced'; assert.equal(request.developPreset.presetId, 'preset');
	assert.throws(() => admitPhotoLibraryDevelopImportRequestV2({ schemaVersion: 1, developPreset: preset }));
	assert.throws(() => admitPhotoLibraryDevelopImportRequestV2({ schemaVersion: 2, developPreset: { ...preset, schemaVersion: 1 } }));
	assert.throws(() => admitPhotoLibraryDevelopImportRequestV2({ schemaVersion: 2, developPreset: { ...preset, settings: {} } }));
});

test('selected current preset reader detaches its identity before later request mutation', async () => {
	const f = lutArchiveFixture(), choice = { schemaVersion: 2 as const, catalogId: f.root.id, presetId: 'preset', expectedRevision: f.row.revision };
	const capture = borrowPhotoImportDevelopPresetV2({ readEntry: async () => ({ present: true, value: f.row }) }, choice);
	choice.presetId = 'replaced'; choice.expectedRevision++;
	const apply = await capture(f.root.id, new AbortController().signal);
	assert.equal(apply(photoArchiveFixture().photo).schemaVersion, 2);
});
