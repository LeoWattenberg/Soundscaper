/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { normalizePhotoCatalogArchiveV4, serializePhotoCatalogArchiveV4, assertPhotoCatalogPackManifestV4 } from '../src/lightscaper/archive/catalog-archive-contract-v4.ts';

function archive(developPresetPack: unknown = null) {
	return { schemaFamily: 'lightscaper', schemaVersion: 4, kind: 'photo-catalog-archive', id: 'catalog', title: 'Library',
		catalog: { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog', name: 'Library', revision: 7,
			photoCount: 0, folders: [], keywords: [], collections: [] }, packs: [], stackCount: 0, stackPacks: [],
		savedCollectionState: null, savedCollectionPacks: [], developPresetPack };
}
function pack(presetCount = 2, revision = 19) { return { id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision, presetCount }; }
function manifest(present = true): ScapeManifest {
	return { format: 'scape-project', formatVersion: 1, project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: 4,
		size: 1024, sha256: '0'.repeat(64) }, assets: present ? [{ sourceId: 'develop-presets', entry: 'assets/develop-presets-v1.bin',
		kind: 'photo-develop-preset-pack', encoding: 'lightscaper-develop-presets-json-v1', size: 1024, sha256: '1'.repeat(64) }] : [] };
}

test('Archive4 preserves old photo/stack/saved contracts and a detached scalar preset pack authority', () => {
	const source = pack(), document = normalizePhotoCatalogArchiveV4(archive(source));
	assert.deepEqual(document, archive(source)); assert.ok(Object.isFrozen(document.developPresetPack));
	source.revision++; assert.equal(document.developPresetPack?.revision, 19);
	assert.deepEqual(JSON.parse(serializePhotoCatalogArchiveV4(document)), document);
	assert.ok(new TextEncoder().encode(serializePhotoCatalogArchiveV4(document)).byteLength < 4096);
});

test('Absent stores and retained empty positive revisions stay distinct and the field is required', () => {
	for (const value of [null, pack(0, 91)]) assert.deepEqual(normalizePhotoCatalogArchiveV4(archive(value)).developPresetPack, value);
	const missing = archive(); Reflect.deleteProperty(missing, 'developPresetPack');
	assert.throws(() => normalizePhotoCatalogArchiveV4(missing));
});

test('Future versions, hidden fields, recipe bodies and malformed scalar authorities refuse without caller getters', () => {
	let inspected = 0;
	for (const value of [{ ...archive(), schemaVersion: 5 }, { ...archive(), extra: true }, archive({ ...pack(), presets: [] }),
		archive(pack(17)), archive(pack(1, 0)), archive({ ...pack(), entry: 'assets/../presets.bin' }),
		archive(Object.defineProperty(pack(), 'revision', { enumerable: true, get() { inspected++; throw new Error('Caller getter ran'); } }))]) {
		assert.throws(() => normalizePhotoCatalogArchiveV4(value));
	}
	assert.equal(inspected, 0);
});

test('Preset asset identity cannot collide with any existing archive group', () => {
	const value = archive(pack());
	Object.assign(value, { catalog: { ...value.catalog, photoCount: 1 }, packs: [{ id: 'develop-presets', entry: 'assets/photo-pack-000001.bin', photoCount: 1 }] });
	assert.throws(() => normalizePhotoCatalogArchiveV4(value), /duplicate/iu);
});

test('A preset pack consumes one of the4094 asset slots rather than growing the ZIP entry ceiling', () => {
	for (const count of [4093, 4094]) {
		const value = archive(pack());
		Object.assign(value, { catalog: { ...value.catalog, photoCount: count },
			packs: Array.from({ length: count }, (_, index) => ({ id: `photo-${String(index)}`,
				entry: `assets/photo-pack-${String(index + 1).padStart(6, '0')}.bin`, photoCount: 1 })) });
		if (count === 4093) assert.equal(normalizePhotoCatalogArchiveV4(value).packs.length, count);
		else assert.throws(() => normalizePhotoCatalogArchiveV4(value), /entry count/iu);
	}
});

test('The manifest authenticates exact kind, encoding, entry, version, count and the existing10MiB row ceiling', () => {
	const document = normalizePhotoCatalogArchiveV4(archive(pack()));
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV4(document, manifest()));
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV4(normalizePhotoCatalogArchiveV4(archive()), manifest(false)));
	const boundary = manifest(); boundary.assets[0]!.size = 10_485_760;
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV4(document, boundary));
	for (const change of [{ sourceId: 'other' }, { entry: 'assets/develop-presets-v2.bin' }, { kind: 'photo-catalog-pack' },
		{ encoding: 'future' }, { size: 10_485_761 }, { size: 0 }]) {
		const candidate = manifest(); Object.assign(candidate.assets[0]!, change);
		assert.throws(() => assertPhotoCatalogPackManifestV4(document, candidate));
	}
	const wrongVersion = manifest(); wrongVersion.project.schemaVersion = 3;
	assert.throws(() => assertPhotoCatalogPackManifestV4(document, wrongVersion));
	assert.throws(() => assertPhotoCatalogPackManifestV4(document, manifest(false)));
	assert.throws(() => assertPhotoCatalogPackManifestV4(normalizePhotoCatalogArchiveV4(archive()), manifest()));
});
