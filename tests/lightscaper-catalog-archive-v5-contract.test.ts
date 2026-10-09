/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogArchiveV5, serializePhotoCatalogArchiveV5, assertPhotoCatalogPackManifestV5 } from '../src/lightscaper/archive/catalog-archive-contract-v5.ts';
import { normalizePhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-contract-v4.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../src/common/editor/scape-photo-cube-lut.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../src/common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 } from '../src/common/editor/scape-photo-catalog-pack-v2.ts';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';

function resource(index = 1) {
	const sha256 = index.toString(16).padStart(64, '0');
	return { id: `lut-sha256:${sha256}`, entry: `assets/luts/${sha256}.cube`,
		reference: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } };
}
const root = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog', name: 'Catalog', revision: 29,
	photoCount: 0, folders: [], keywords: [], collections: [] };
const preset = { id: 'develop-presets', entry: 'assets/develop-presets-v2.bin', rowSchemaVersion: 2, revision: 2, presetCount: 0 };
const document = () => ({ schemaFamily: 'lightscaper', schemaVersion: 5, kind: 'photo-catalog-archive', id: root.id, title: root.name,
	catalog: root, packs: [], stackCount: 0, stackPacks: [], savedCollectionState: null, savedCollectionPacks: [],
	developPresetPack: preset, lutResources: [resource(2), resource(1)] });
function manifest(): ScapeManifest {
	return { format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: 5, size: 1024, sha256: '0'.repeat(64) },
		assets: [{ sourceId: preset.id, entry: preset.entry, kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND,
			encoding: PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2, size: 1024, sha256: '3'.repeat(64) },
		...document().lutResources.map(row => ({ sourceId: row.id, entry: row.entry, kind: PHOTO_CUBE_LUT_ASSET_KIND,
			encoding: PHOTO_CUBE_LUT_ENCODING, size: row.reference.byteLength, sha256: row.reference.sha256 }))] };
}

test('V5 closed headers retain positive-empty versioned presets and sorted exact scalar resource identities', () => {
	const input = document(), value = normalizePhotoCatalogArchiveV5(input);
	assert.deepEqual(value.lutResources.map(row => row.reference.sha256), [resource(1).reference.sha256, resource(2).reference.sha256]);
	assert.equal(value.developPresetPack?.rowSchemaVersion, 2); assert.equal(value.developPresetPack?.revision, 2);
	input.lutResources[0]!.reference.domainMin[0] = -1; assert.equal(value.lutResources[1]?.reference.domainMin[0], 0);
	assert.ok(Object.isFrozen(value.lutResources)); assertPhotoCatalogPackManifestV5(value, manifest());
	assert.equal(JSON.parse(serializePhotoCatalogArchiveV5(value)).schemaVersion, 5);
	assert.equal(normalizePhotoCatalogArchiveV5({ ...document(), developPresetPack: null, lutResources: [] }).developPresetPack, null);
	assert.throws(() => normalizePhotoCatalogArchiveV4(value));
	assert.equal(normalizePhotoCatalogArchiveV5({ ...document(), developPresetPack: { ...preset, rowSchemaVersion: 1 } }).developPresetPack?.rowSchemaVersion, 1);
});

test('V5 refuses foreign/future/hidden/geometry/path identities before any body authority exists', () => {
	let reads = 0; const accessor = Object.defineProperty(document(), 'lutResources', { enumerable: true, get() { reads++; return []; } });
	for (const value of [accessor, { ...document(), schemaVersion: 6 }, { ...document(), rawBody: 'cube' },
		{ ...document(), lutResources: [resource(), resource()] }, { ...document(), lutResources: [{ ...resource(), id: 'other' }] },
		{ ...document(), lutResources: [{ ...resource(), entry: 'assets/luts/../body.cube' }] },
		{ ...document(), lutResources: [{ ...resource(), reference: { ...resource().reference, domainMax: [0, 1, 1] } }] },
		{ ...document(), developPresetPack: { ...preset, rowSchemaVersion: '2' } }]) assert.throws(() => normalizePhotoCatalogArchiveV5(value));
	assert.equal(reads, 0);
});

test('V5 resource manifest binds complete pinned SHA, size, kind, encoding and unique namespace', () => {
	const value = normalizePhotoCatalogArchiveV5(document());
	for (const patch of [{ size: 89 }, { sha256: '9'.repeat(64) }, { kind: 'audio' }, { encoding: 'video-cube-lut' }, { entry: 'assets/luts/other.cube' }]) {
		const current = manifest(); current.assets[1] = { ...current.assets[1]!, ...patch };
		assert.throws(() => assertPhotoCatalogPackManifestV5(value, current));
	}
	const duplicate = manifest(); duplicate.assets[2] = duplicate.assets[1]!; assert.throws(() => assertPhotoCatalogPackManifestV5(value, duplicate));
	const missing = manifest(); missing.assets.pop(); assert.throws(() => assertPhotoCatalogPackManifestV5(value, missing));
	assert.throws(() => assertPhotoCatalogPackManifestV5(value, { ...manifest(), project: { ...manifest().project, schemaVersion: 4 } }));
});

test('all pack and resource headers share the unchanged combined4094 budget', () => {
	const lutResources = Array.from({ length: 4094 }, (_, index) => resource(index));
	assert.equal(normalizePhotoCatalogArchiveV5({ ...document(), developPresetPack: null, lutResources }).lutResources.length, 4094);
	assert.throws(() => normalizePhotoCatalogArchiveV5({ ...document(), lutResources }), RangeError);
	assert.throws(() => normalizePhotoCatalogArchiveV5({ ...document(), developPresetPack: null, lutResources: [...lutResources, resource(4094)] }));
});
