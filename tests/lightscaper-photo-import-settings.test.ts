/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoImportSettingsV1, planPhotoImportSettingsV1, applyPhotoImportSettingsV1 } from '../src/lightscaper/import/photo-import-settings-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const settings = { rename: { template: '{stem}-{sequence}.{extension}', sequenceStart: 10, sequencePadding: 2 }, metadata: { title: '', creator: 'Authored' }, keywordIds: ['keyword'] };

test('settings apply after extraction: omission preserves display facts while blanks clear only authored fields', () => {
	const base = queryPhotoV1();
	const photo = normalizePhotoDocumentV1({ ...base, metadata: { ...base.metadata, title: 'Source title', caption: 'Source caption', copyright: 'Source rights', location: 'Source location' },
		extractedMetadata: { schemaVersion: 1, container: 'jpeg', exif: null, issues: [], iptc: { encoding: 'utf8', objectName: 'Source title', headline: null,
			caption: 'Source caption', copyright: 'Source rights', creators: ['A', 'A', 'B'], keywords: ['Travel', 'Travel'], city: null, sublocation: null,
			state: null, country: null, captureDate: '20261008', captureTime: null } } });
	const before = structuredClone(photo);
	const files = [new File(['original'], photo.original.name), new File(['bad'], 'Failed.jpg'), new File(['original'], photo.original.name)];
	const plan = planPhotoImportSettingsV1(files, queryCatalogRootV1(), settings);
	const updated = applyPhotoImportSettingsV1(photo, plan, 2);
	assert.equal(updated.metadata.fileName, 'Image-100000-12.jpg');
	assert.equal(updated.metadata.title, ''); assert.equal(updated.metadata.creator, 'Authored');
	assert.equal(updated.metadata.caption, 'Source caption'); assert.equal(updated.metadata.copyright, 'Source rights'); assert.equal(updated.metadata.location, 'Source location');
	assert.deepEqual(updated.original, before.original); assert.deepEqual(updated.extractedMetadata, before.extractedMetadata);
	assert.deepEqual(updated.versions, before.versions); assert.deepEqual(updated.metadata.captureTime, before.metadata.captureTime);
	assert.deepEqual(photo, before); assert.equal(files[2]!.name, before.original.name); assert.ok(Object.isFrozen(plan));
});

test('a plain recipe preserves source names, five authored fields and preexisting memberships', () => {
	const photo = queryPhotoV1();
	assert.deepEqual(normalizePhotoImportSettingsV1(), { rename: null, metadata: {}, keywordIds: [] });
	const plan = planPhotoImportSettingsV1([new File(['source'], photo.original.name)], queryCatalogRootV1());
	assert.deepEqual(applyPhotoImportSettingsV1(photo, plan, 0), photo);
});

test('fresh-root references and every gesture expansion refuse before any original body read', () => {
	let reads = 0, getters = 0;
	class HostileFile extends File {
		override async arrayBuffer(): Promise<ArrayBuffer> { reads++; throw new Error('body read'); }
		override get name(): string { getters++; throw new Error('name getter'); }
	}
	const file = new HostileFile(['source'], 'Image-100000.jpg');
	assert.throws(() => planPhotoImportSettingsV1([file], { ...queryCatalogRootV1(), keywords: [], collections: [] }, settings), /keyword/iu);
	assert.throws(() => planPhotoImportSettingsV1([file, new File(['bad'], 'a'.repeat(256))], queryCatalogRootV1(), settings));
	assert.throws(() => planPhotoImportSettingsV1([file, file], queryCatalogRootV1(), { ...settings, rename: { ...settings.rename, sequenceStart: Number.MAX_SAFE_INTEGER } }));
	assert.equal(reads, 0); assert.equal(getters, 0);
	assert.equal(planPhotoImportSettingsV1([file], queryCatalogRootV1(), settings).names[0]?.sourceName, 'Image-100000.jpg');
});

test('closed admission refuses getters, unknown fields, duplicate IDs and forged/cross-file plans', () => {
	let invoked = 0;
	const hostile = Object.defineProperty({}, 'title', { enumerable: true, get: () => { invoked++; return 'X'; } });
	for (const value of [{ ...settings, metadata: hostile }, { ...settings, metadata: { captureTime: null } }, { ...settings, keywordIds: ['keyword', 'keyword'] },
		{ ...settings, metadata: { title: 'x'.repeat(16_385) } }, { ...settings, future: true }]) assert.throws(() => normalizePhotoImportSettingsV1(value));
	assert.equal(invoked, 0);
	const photo = queryPhotoV1(), plan = planPhotoImportSettingsV1([new File(['source'], photo.original.name)], queryCatalogRootV1(), settings);
	assert.throws(() => applyPhotoImportSettingsV1(photo, { ...plan }, 0), /plan/iu);
	assert.throws(() => applyPhotoImportSettingsV1({ ...photo, original: { ...photo.original, name: 'Other.jpg' } }, plan, 0), /name|selection/iu);
	assert.throws(() => applyPhotoImportSettingsV1(photo, plan, 1));
});

test('every authored field independently distinguishes omission from explicit blank and snapshots caller choices', () => {
	const base = queryPhotoV1();
	const photo = normalizePhotoDocumentV1({ ...base, metadata: { ...base.metadata,
		title: 'Title', caption: 'Caption', creator: 'Creator', copyright: 'Rights', location: 'Place' } });
	for (const key of ['title', 'caption', 'creator', 'copyright', 'location'] as const) {
		const chosen = { rename: null, metadata: { [key]: '' }, keywordIds: ['keyword'] };
		const plan = planPhotoImportSettingsV1([new File(['source'], photo.original.name)], queryCatalogRootV1(), chosen);
		chosen.metadata[key] = 'Late edit'; chosen.keywordIds.splice(0);
		const updated = applyPhotoImportSettingsV1(photo, plan, 0);
		assert.deepEqual(updated.metadata, { ...photo.metadata, [key]: '' });
		assert.deepEqual(updated.keywordIds, ['keyword']);
	}
});

test('maximum keyword memberships remain intact and expanded admission stays bounded at 64 selected names', () => {
	const keys = Array.from({ length: 1024 }, (_, index) => `keyword-${index}`);
	const root = { ...queryCatalogRootV1(), keywords: [...queryCatalogRootV1().keywords,
		...keys.map(key => ({ id: key, name: key, parentId: null }))] };
	const photo = normalizePhotoDocumentV1({ ...queryPhotoV1(), keywordIds: [] });
	const files = Array.from({ length: 64 }, () => new File(['source'], photo.original.name));
	const plan = planPhotoImportSettingsV1(files, root, { rename: null, metadata: {}, keywordIds: keys });
	assert.equal(plan.names.length, 64); assert.equal(applyPhotoImportSettingsV1(photo, plan, 63).keywordIds.length, 1024);
	assert.throws(() => planPhotoImportSettingsV1([...files, files[0]], root));
	assert.throws(() => normalizePhotoImportSettingsV1({ rename: null, metadata: {}, keywordIds: [...keys, 'keyword'] }));
});

test('descriptor-admitted Proxy metadata never invokes a hostile property get trap', () => {
	let invoked = 0;
	const metadata = new Proxy({ title: '', creator: 'Authored' }, {
		get() { invoked++; throw new Error('Metadata property trap ran.'); },
	});
	assert.deepEqual(normalizePhotoImportSettingsV1({ ...settings, metadata }).metadata, { title: '', creator: 'Authored' });
	assert.equal(invoked, 0);
});
