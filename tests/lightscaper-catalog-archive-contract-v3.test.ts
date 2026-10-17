/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogArchiveV3, serializePhotoCatalogArchiveV3, assertPhotoCatalogPackManifestV3,
	type PhotoCatalogArchiveDocumentV3 } from '../src/lightscaper/archive/catalog-archive-contract-v3.ts';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';

function root(photoCount = 4, collectionCount = 0) {
	return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog', name: 'Photo library',
		revision: 7, photoCount, folders: [], keywords: [], collections: Array.from({ length: collectionCount }, (_, index) =>
			({ id: `root-${String(index)}`, name: 'Root collection', kind: 'manual' })) };
}
function state(collectionCount = 2, revision = 19) {
	return { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
}
function savedPack(collectionCount = 2, ordinal = 1) {
	const suffix = String(ordinal).padStart(6, '0');
	return { id: `saved-pack-${suffix}`, entry: `assets/saved-collection-pack-${suffix}.bin`, collectionCount };
}
function archive(overrides: Record<string, unknown> = {}) {
	return { schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-catalog-archive', id: 'catalog', title: 'Photo library',
		catalog: root(), packs: [{ id: 'photos', entry: 'assets/photo-pack-000001.bin', photoCount: 4 }],
		stackCount: 1, stackPacks: [{ id: 'stacks', entry: 'assets/stack-pack-000001.bin', stackCount: 1 }],
		savedCollectionState: state(), savedCollectionPacks: [savedPack()], ...overrides };
}
function manifest(document: PhotoCatalogArchiveDocumentV3): ScapeManifest {
	const asset = (pack: { id: string; entry: string }, kind: string, encoding: string) => ({ sourceId: pack.id,
		entry: pack.entry, kind, encoding, size: 1_024, sha256: '0'.repeat(64) });
	return { format: 'scape-project', formatVersion: 1, project: { entry: 'project.json', schemaFamily: 'lightscaper',
		schemaVersion: 3, size: 1_024, sha256: '0'.repeat(64) }, assets: [
		...document.packs.map(pack => asset(pack, 'photo-catalog-pack', 'lightscaper-photo-pack-v1')),
		...document.stackPacks.map(pack => asset(pack, 'photo-stack-pack', 'lightscaper-stack-pack-v1')),
		...document.savedCollectionPacks.map(pack => asset(pack, 'photo-smart-collection-pack', 'lightscaper-smart-collection-pack-v1')),
	] };
}

test('archive3 retains V2 root/photo/stack identities and one detached frozen saved-state authority', () => {
	const retained = state(), pack = savedPack(), input = archive({ savedCollectionState: retained, savedCollectionPacks: [pack] });
	const document = normalizePhotoCatalogArchiveV3(input);
	assert.deepEqual(document, input); assert.equal(document.catalog.schemaVersion, 1);
	for (const value of [document, document.catalog, document.packs, document.packs[0], document.stackPacks,
		document.stackPacks[0], document.savedCollectionState, document.savedCollectionPacks, document.savedCollectionPacks[0]]) assert.ok(Object.isFrozen(value));
	retained.revision = 20; pack.collectionCount = 1;
	assert.equal(document.savedCollectionState?.revision, 19); assert.equal(document.savedCollectionPacks[0]?.collectionCount, 2);
	assert.deepEqual(JSON.parse(serializePhotoCatalogArchiveV3(document)), document);
});

test('physical absence and a retained empty state remain distinct through serialization', () => {
	for (const retained of [null, state(0, 57)]) {
		const document = normalizePhotoCatalogArchiveV3(archive({ savedCollectionState: retained, savedCollectionPacks: [] }));
		assert.deepEqual(document.savedCollectionState, retained); assert.deepEqual(document.savedCollectionPacks, []);
		const restored = normalizePhotoCatalogArchiveV3(JSON.parse(serializePhotoCatalogArchiveV3(document)) as unknown);
		assert.deepEqual(restored.savedCollectionState, retained);
	}
});

test('both saved fields are physically required, including explicit absence', () => {
	for (const key of ['savedCollectionState', 'savedCollectionPacks']) {
		const input: Record<string, unknown> = archive(); delete input[key];
		assert.throws(() => normalizePhotoCatalogArchiveV3(input), /required/u);
	}
	assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionState: undefined })), /plain object/u);
	assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionPacks: undefined })), /array/u);
});

test('archive3 keeps version, family, catalog identity and title admission closed', () => {
	for (const candidate of [archive({ schemaVersion: 1 }), archive({ schemaVersion: 2 }), archive({ schemaVersion: 4 }),
		archive({ schemaFamily: 'framescaper' }), archive({ kind: 'photo-catalog' }), archive({ id: 'foreign' }),
		archive({ title: 'Different title' }), archive({ savedCollectionCount: 2 })]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(candidate), /version|family|kind|identity|unsupported/iu);
	}
});

test('saved state belongs to this root even when retained empty and reuses the owning validator', () => {
	for (const retained of [{ ...state(), catalogId: 'foreign' }, { ...state(0), catalogId: 'foreign' },
		{ ...state(), schemaVersion: 2 }, { ...state(), kind: 'other' }, { ...state(), revision: -1 },
		{ ...state(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...state(), collectionCount: -1 },
		{ ...state(), collectionCount: 10_001 }, { ...state(), collectionCount: 0.5 }, { ...state(), unexpected: true }]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionState: retained })),
			/catalog|version|kind|revision|count|unsupported/iu);
	}
});

test('orphan packs and absent, empty, undercounted or overcounted authority refuse', () => {
	for (const candidate of [archive({ savedCollectionState: null }), archive({ savedCollectionState: state(0) }),
		archive({ savedCollectionPacks: [] }), archive({ savedCollectionState: state(1) }), archive({ savedCollectionState: state(3) })]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(candidate), /state|count|pack/iu);
	}
});

test('the shared root-plus-saved 10000 collection limit is inclusive', () => {
	assert.equal(normalizePhotoCatalogArchiveV3(archive({ catalog: root(4, 9_998) })).savedCollectionState?.collectionCount, 2);
	assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ catalog: root(4, 9_999) })), /collection.*10000|combined|budget/iu);
	assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ catalog: root(4, 10_001) })), /collections.*entries/iu);
});

test('saved pack record counts are nonempty safe integers and bounded at 64', () => {
	assert.equal(normalizePhotoCatalogArchiveV3(archive({ savedCollectionState: state(64), savedCollectionPacks: [savedPack(64)] }))
		.savedCollectionPacks[0]?.collectionCount, 64);
	for (const count of [0, -1, 0.5, 65, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionPacks: [savedPack(count)] })), /count/iu);
	}
});

test('saved pack paths and descriptors admit only the closed versioned ordinal shape', () => {
	for (const entry of ['assets/photo-pack-000001.bin', 'assets/stack-pack-000001.bin', 'assets/saved-collection-pack-1.bin',
		'../saved-collection-pack-000001.bin', 'assets/saved-collection-pack-000001.json', 'assets/saved-collection-pack-0000001.bin']) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionPacks: [{ ...savedPack(), entry }] })), /entry/iu);
	}
	for (const pack of [{ ...savedPack(), id: '' }, { ...savedPack(), unexpected: true }, { id: 'saved', entry: savedPack().entry }]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionPacks: [pack] })), /identifier|unsupported|required/iu);
	}
});

test('asset identities are unique across photo, stack and saved packs, and saved paths cannot repeat', () => {
	for (const packs of [[{ ...savedPack(), id: 'photos' }], [{ ...savedPack(), id: 'stacks' }],
		[savedPack(1), { ...savedPack(1, 2), id: savedPack().id }], [savedPack(1), { ...savedPack(1, 2), entry: savedPack().entry }]]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(archive({ savedCollectionPacks: packs })), /duplicate/iu);
	}
});

test('the aggregate 4094 pack ceiling includes all three kinds', () => {
	function nearLimit(photoPacks: number) {
		return archive({ catalog: root(photoPacks), savedCollectionState: state(1), savedCollectionPacks: [savedPack(1)],
			packs: Array.from({ length: photoPacks }, (_, index) => ({ id: `photo-${String(index)}`,
				entry: `assets/photo-pack-${String(index).padStart(6, '0')}.bin`, photoCount: 1 })) });
	}
	const document = normalizePhotoCatalogArchiveV3(nearLimit(4_092));
	assert.equal(document.packs.length + document.stackPacks.length + document.savedCollectionPacks.length, 4_094);
	assert.throws(() => normalizePhotoCatalogArchiveV3(nearLimit(4_093)), /packs|entries/iu);
});

test('V2 photo and stack count, descriptor and identity errors still refuse under archive3', () => {
	for (const candidate of [archive({ catalog: root(5) }), archive({ stackCount: 2 }), archive({ stackCount: 3 }),
		archive({ stackPacks: [{ id: 'photos', entry: 'assets/stack-pack-000001.bin', stackCount: 1 }] }),
		archive({ packs: [{ id: 'photos', entry: 'assets/photo-pack-1.bin', photoCount: 4 }] })]) {
		assert.throws(() => normalizePhotoCatalogArchiveV3(candidate), /count|duplicate|entry|between/iu);
	}
});

test('archive, state, descriptors and dense arrays never invoke caller getters', () => {
	let inspected = 0;
	const accessor = (value: object, key: string) => Object.defineProperty(value, key,
		{ enumerable: true, get() { inspected++; throw new Error('Caller getter ran.'); } });
	const candidates = [accessor(archive(), 'savedCollectionState'), archive({ savedCollectionState: accessor(state(), 'revision') }),
		archive({ savedCollectionPacks: [accessor(savedPack(), 'collectionCount')] }),
		archive({ savedCollectionPacks: accessor([savedPack()], '0') }), archive({ savedCollectionPacks: new Array<unknown>(1) })];
	for (const value of candidates) assert.throws(() => normalizePhotoCatalogArchiveV3(value), /own data property/iu);
	assert.equal(inspected, 0);
});

test('descriptor-only copies also avoid Proxy get traps on admitted plain inputs', () => {
	let inspections = 0;
	const opaque = <Value extends object>(value: Value) => new Proxy(value, { get() { inspections++; throw new Error('Proxy get ran.'); } });
	const document = normalizePhotoCatalogArchiveV3(opaque(archive({ savedCollectionState: opaque(state()),
		savedCollectionPacks: opaque([opaque(savedPack())]) })));
	assert.equal(document.savedCollectionState?.revision, 19); assert.equal(inspections, 0);
});

test('the bounded complete project fits 4MiB while retaining the stricter UTF8 root budget', () => {
	const folders = (character: string) => Array.from({ length: 6_000 }, (_, index) =>
		({ id: `folder-${String(index)}`, name: character.repeat(256), parentId: null }));
	const ascii = archive({ catalog: { ...root(4_092), folders: folders('a') }, savedCollectionState: state(1),
		savedCollectionPacks: [savedPack(1)], packs: Array.from({ length: 4_092 }, (_, index) =>
			({ id: `pack-${String(index)}`.padEnd(128, 'x'), entry: `assets/photo-pack-${String(index).padStart(6, '0')}.bin`, photoCount: 1 })) });
	const document = normalizePhotoCatalogArchiveV3(ascii), bytes = new TextEncoder().encode(serializePhotoCatalogArchiveV3(document)).byteLength;
	assert.equal(document.packs.length + document.stackPacks.length + document.savedCollectionPacks.length, 4_094);
	assert.ok(bytes > 2 * 1024 * 1024); assert.ok(bytes < 4 * 1024 * 1024);
	// A root over2MiB is already invalid; do not invent an inadmissible root to reach the outer4MiB guard.
	const unicode = archive({ catalog: { ...root(), folders: folders('€') } });
	assert.throws(() => serializePhotoCatalogArchiveV3(unicode), /document.*byte budget/iu);
});

test('archive3 manifest admission binds all three pack kinds without changing photo/stack encodings', () => {
	const document = normalizePhotoCatalogArchiveV3(archive());
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV3(document, manifest(document)));
	const empty = normalizePhotoCatalogArchiveV3(archive({ savedCollectionState: state(0, 57), savedCollectionPacks: [] }));
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV3(empty, manifest(empty)));
});

test('manifest family/version, omissions, extra assets and source identity mismatches refuse', () => {
	const document = normalizePhotoCatalogArchiveV3(archive());
	for (const change of [(value: ScapeManifest) => { value.project.schemaFamily = 'soundscaper'; },
		(value: ScapeManifest) => { value.project.schemaVersion = 2; }, (value: ScapeManifest) => { value.assets.pop(); },
		(value: ScapeManifest) => { value.assets.push({ ...value.assets[0]!, sourceId: 'extra' }); },
		(value: ScapeManifest) => { value.assets[2]!.sourceId = 'different'; }]) {
		const value = manifest(document); change(value);
		assert.throws(() => assertPhotoCatalogPackManifestV3(document, value), /schema|count|descriptor/iu);
	}
});

test('saved manifest entry, kind, encoding and 8MiB byte ceiling are authenticated', () => {
	const document = normalizePhotoCatalogArchiveV3(archive());
	const boundary = manifest(document); boundary.assets[2]!.size = 8 * 1024 * 1024;
	assert.doesNotThrow(() => assertPhotoCatalogPackManifestV3(document, boundary));
	for (const change of [{ entry: 'assets/saved-collection-pack-000002.bin' }, { kind: 'photo-catalog-pack' },
		{ encoding: 'lightscaper-smart-collection-pack-v2' }, { size: 8 * 1024 * 1024 + 1 }]) {
		const value = manifest(document); Object.assign(value.assets[2]!, change);
		assert.throws(() => assertPhotoCatalogPackManifestV3(document, value), /descriptor/iu);
	}
});

test('existing photo and stack manifest checks remain authoritative', () => {
	const document = normalizePhotoCatalogArchiveV3(archive());
	for (const index of [0, 1]) {
		const value = manifest(document); value.assets[index]!.encoding = 'unsupported';
		assert.throws(() => assertPhotoCatalogPackManifestV3(document, value), /descriptor/iu);
	}
});
