/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import {
	cloneLightscaperDocumentV1,
	parseLightscaperDocumentV1,
	serializeLightscaperDocumentV1,
	validateLightscaperDocumentV1,
	migrateLightscaperDocumentV1,
} from '../src/lightscaper/catalog/documents.ts';
import {
	createPhotoVersionV1,
	createPhotoHistoryV1,
	commitPhotoHistoryV1,
	undoPhotoHistoryV1,
	redoPhotoHistoryV1,
} from '../src/lightscaper/catalog/photo-history.ts';
import { clonePhotoDevelopV1, defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { matchesPhotoQueryV1 } from '../src/lightscaper/catalog/smart-query.ts';
import { validatePhotoCatalogReferencesV1 } from '../src/lightscaper/catalog/photo-document.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';

function develop() {
	return {
		processVersion: 1,
		effects: [{ id: 'color-1', type: 'color-adjust', enabled: true, params: { brightness: 0.1 } }],
		geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
		masks: [],
		maskBindings: [],
	};
}

function root() {
	return {
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Travel', revision: 0, photoCount: 100_000,
		folders: [{ id: 'folder-1', name: 'Trips', parentId: null }],
		keywords: [{ id: 'keyword-1', name: 'Nature', parentId: null }],
		collections: [
			{ id: 'collection-1', name: 'Picks', kind: 'manual' },
			{ id: 'collection-2', name: 'Rated', kind: 'smart', query: { kind: 'rating', minimum: 3, maximum: 5 } },
		],
	};
}

function photo() {
	return {
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
		id: 'photo-1', catalogId: 'catalog-1', revision: 0,
		original: {
			schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Forest.jpg',
			mimeType: 'image/jpeg', storageKey: 'original-1', contentSha256: 'a'.repeat(64),
			width: 6_000, height: 4_000, hasAlpha: false, byteLength: 2_000_000, retention: 'managed',
		},
		folderId: 'folder-1', collectionIds: ['collection-1'], keywordIds: ['keyword-1'],
		rating: 4, flag: 'pick', colorLabel: 'green', activeVersionId: 'version-1',
		metadata: {
			fileName: 'Forest.jpg', modifiedTime: null,
			captureTime: { local: '2026-05-06T12:34:56', offsetMinutes: null },
			orientation: 1, cameraMake: 'Camera', cameraModel: null, lens: null,
			exposureSeconds: 0.01, aperture: 8, iso: 100, focalLengthMm: 35,
			title: 'Forest', caption: '', creator: '', copyright: '', location: '',
		},
		versions: [{ id: 'version-1', kind: 'master', name: 'Original', createdAt: '2026-05-06T12:34:56.000Z', develop: develop() }],
	};
}

function normalizedPhoto(): PhotoDocumentV1 {
	const value = validateLightscaperDocumentV1(photo());
	assert.equal(value.kind, 'photo');
	return value as PhotoDocumentV1;
}

function normalizedRoot(): PhotoCatalogRootV1 {
	const value = validateLightscaperDocumentV1(root());
	assert.equal(value.kind, 'photo-catalog');
	return value as PhotoCatalogRootV1;
}

test('Lightscaper root indexes and per-photo aggregates round-trip independently without timeline fields', () => {
	for (const fixture of [root(), photo()]) {
		const document = validateLightscaperDocumentV1(fixture);
		const encoded = serializeLightscaperDocumentV1(document);
		assert.deepEqual(parseLightscaperDocumentV1(encoded), document);
		assert.deepEqual(cloneLightscaperDocumentV1(document), document);
		assert.notEqual(cloneLightscaperDocumentV1(document), document);
		assert.equal(Object.isFrozen(document), true);
		assert.equal(Object.hasOwn(document, 'tracks'), false);
	}
	assert.ok(serializeLightscaperDocumentV1(root()).length < 2_000);
	assert.equal(normalizedRoot().photoCount, 100_000);
	validatePhotoCatalogReferencesV1(normalizedPhoto(), normalizedRoot());
});

test('deterministic persistence sorts unordered identifiers while retaining effect order and explicit process version', () => {
	const first = photo();
	first.keywordIds = ['z', 'a'];
	const second = structuredClone(first);
	second.keywordIds.reverse();
	assert.equal(serializeLightscaperDocumentV1(first), serializeLightscaperDocumentV1(second));
	const state = normalizePhotoDevelopV1(develop());
	assert.equal(state.processVersion, 1);
	assert.equal(state.effects[0]?.params.contrast, 1);
	assert.equal(state.effects[0]?.params.brightness, 0.1);
	const ordered = { ...develop(), effects: [
		{ id: 'z', type: 'color-adjust', enabled: true, params: {} },
		{ id: 'a', type: 'color-adjust', enabled: true, params: {} },
	] };
	assert.deepEqual(normalizePhotoDevelopV1(ordered).effects.map((effect) => effect.id), ['z', 'a']);
});

test('schema admission rejects future versions before interpreting product payloads', () => {
	for (const fixture of [root(), photo()]) {
		assert.throws(() => validateLightscaperDocumentV1({ ...fixture, schemaVersion: 2 }), /future|unsupported/iu);
		assert.throws(() => validateLightscaperDocumentV1({ ...fixture, schemaFamily: 'framescaper' }), /family/iu);
		assert.throws(() => validateLightscaperDocumentV1({ ...fixture, schemaVersion: 0 }), /schema/iu);
		assert.throws(() => validateLightscaperDocumentV1({ ...fixture, tracks: [] }), /unsupported/iu);
	}
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), processVersion: 2 }), /process/iu);
	assert.throws(() => parseLightscaperDocumentV1('{'), SyntaxError);
	assert.throws(() => parseLightscaperDocumentV1(' '.repeat(2_097_153)), /budget/iu);
	assert.deepEqual(migrateLightscaperDocumentV1(photo()), normalizedPhoto());
	assert.throws(() => migrateLightscaperDocumentV1({ ...photo(), schemaVersion: 2 }), /future/iu);
});

test('catalog serialization matches the v1 golden and rejects UTF-8 document over-budget inputs', () => {
	const empty = { ...root(), folders: [], keywords: [], collections: [], photoCount: 0 };
	assert.equal(serializeLightscaperDocumentV1(empty), '{"collections":[],"folders":[],"id":"catalog-1","keywords":[],"kind":"photo-catalog","name":"Travel","photoCount":0,"revision":0,"schemaFamily":"lightscaper","schemaVersion":1}');
	assert.throws(() => parseLightscaperDocumentV1('é'.repeat(1_048_577)), /budget/iu);
});

test('catalog trees reject duplicate, dangling, cyclic and adversarial own fields', () => {
	const base = root();
	assert.throws(() => validateLightscaperDocumentV1({ ...base, folders: [...base.folders, ...base.folders] }), /duplicate/iu);
	assert.throws(() => validateLightscaperDocumentV1({ ...base, folders: [{ id: 'f', name: 'F', parentId: 'missing' }] }), /missing/iu);
	assert.throws(() => validateLightscaperDocumentV1({ ...base, keywords: [
		{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' },
	] }), /cycle/iu);
	let invoked = false;
	const getter = { ...base };
	Object.defineProperty(getter, 'name', { enumerable: true, get() { invoked = true; return 'Unsafe'; } });
	assert.throws(() => validateLightscaperDocumentV1(getter), /own data/iu);
	assert.equal(invoked, false);
	assert.throws(() => validateLightscaperDocumentV1(Object.assign(Object.create({ name: 'Inherited' }) as object, base)), /plain object/iu);
	assert.throws(() => validateLightscaperDocumentV1({ ...base, folders: new Array(1) }), /own data/iu);
});

test('photo versions retain immutable original digests and shared masks are bound to existing effect identities', () => {
	const original = normalizedPhoto();
	const copied = createPhotoVersionV1(original, { id: 'version-2', name: 'Warm', createdAt: '2026-05-06T13:00:00.000Z' });
	assert.equal(copied.versions.length, 2);
	assert.equal(copied.activeVersionId, 'version-2');
	assert.equal(copied.original.contentSha256, original.original.contentSha256);
	assert.notEqual(copied.versions[1]?.develop, original.versions[0]?.develop);
	assert.throws(() => createPhotoVersionV1(original, { id: 'version-1', name: 'Duplicate', createdAt: '2026-05-06T13:00:00.000Z' }), /duplicate/iu);
	const mask = {
		schemaVersion: 1, id: 'mask-1', kind: 'mask', inputs: [], outputNodeId: 'shape-1',
		nodes: [{ id: 'shape-1', kind: 'vector-shape', shape: 'ellipse', x: 0, y: 0, width: 1, height: 1 }],
	};
	const masked = { ...develop(), masks: [mask], maskBindings: [{ effectId: 'color-1', maskId: 'mask-1' }] };
	assert.equal(normalizePhotoDevelopV1(masked).masks[0]?.id, 'mask-1');
	assert.throws(() => normalizePhotoDevelopV1({ ...masked, maskBindings: [{ effectId: 'missing', maskId: 'mask-1' }] }), /missing/iu);
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), geometry: { ...develop().geometry, crop: { x: 0.9, y: 0, width: 0.2, height: 1 } } }), /crop/iu);
	const detached = clonePhotoDevelopV1(masked);
	mask.nodes[0]!.width = 0.5;
	masked.effects[0]!.params.brightness = 0.9;
	assert.equal(detached.masks[0]?.nodes[0]?.kind === 'vector-shape' && detached.masks[0].nodes[0].width, 1);
	assert.equal(detached.effects[0]?.params.brightness, 0.1);
	assert.equal(Object.isFrozen(detached.effects[0]?.params), true);
	assert.equal(Object.isFrozen(detached.masks[0]?.nodes[0]), true);
	assert.equal(Object.isFrozen(detached.geometry), true);
	assert.deepEqual(defaultPhotoDevelopV1().effects, []);
});

test('shared effects reject unsupported types/parameters and never invoke nested accessors', () => {
	for (const effect of [
		{ id: 'a', type: 'invented', enabled: true, params: {} },
		{ id: 'a', type: 'color-adjust', enabled: true, params: { nonsense: 0 } },
		{ id: 'a', type: 'color-adjust', enabled: true, params: { brightness: NaN } },
		{ id: 'a', type: 'color-adjust', enabled: true, params: { brightness: 2 } },
	]) assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: [effect] }));
	let invoked = false;
	const params = Object.defineProperty({}, 'brightness', { enumerable: true, get() { invoked = true; return 0; } });
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: [{ id: 'a', type: 'color-adjust', enabled: true, params }] }), /own data/iu);
	assert.equal(invoked, false);
	const cyclic: unknown[] = [];
	cyclic.push(cyclic);
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: cyclic }));
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: new Array(1) }));
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: [develop().effects[0], develop().effects[0]] }), /duplicate/iu);
	const polluted = JSON.parse('{"__proto__":{"brightness":0}}') as unknown;
	assert.throws(() => normalizePhotoDevelopV1({ ...develop(), effects: [{ id: 'a', type: 'color-adjust', enabled: true, params: polluted }] }));
});

test('photo history commits one aggregate, rejects original mutation and keeps monotonic revisions across undo and redo', () => {
	const original = normalizedPhoto();
	const history = createPhotoHistoryV1(original, 2);
	const edited = validateLightscaperDocumentV1({ ...original, rating: 5 }) as PhotoDocumentV1;
	const committed = commitPhotoHistoryV1(history, edited);
	assert.equal(committed.present.rating, 5);
	assert.equal(committed.present.revision, 1);
	assert.equal(committed.past.length, 1);
	assert.equal(history.present.rating, 4);
	const undone = undoPhotoHistoryV1(committed);
	assert.equal(undone.present.rating, 4);
	assert.equal(undone.present.revision, 2);
	const redone = redoPhotoHistoryV1(undone);
	assert.equal(redone.present.rating, 5);
	assert.equal(redone.present.revision, 3);
	const changedOriginal = { ...original, original: { ...original.original, contentSha256: 'b'.repeat(64) } };
	assert.throws(() => commitPhotoHistoryV1(history, changedOriginal), /original/iu);
	assert.throws(() => commitPhotoHistoryV1(history, { ...edited, revision: 9 }), /revision/iu);
	assert.equal(undoPhotoHistoryV1(history), history);
	assert.equal(redoPhotoHistoryV1(history), history);
	const branched = commitPhotoHistoryV1(undone, { ...undone.present, flag: 'reject' });
	assert.equal(branched.future.length, 0);
	const second = commitPhotoHistoryV1(committed, { ...committed.present, rating: 3 });
	const third = commitPhotoHistoryV1(second, { ...second.present, rating: 2 });
	assert.equal(third.past.length, 2);
	assert.equal(third.past[0]?.rating, 5);
});

test('metadata and collection references are validated without conflating virtual folders with file paths', () => {
	const item = normalizedPhoto();
	const catalog = normalizedRoot();
	assert.throws(() => validatePhotoCatalogReferencesV1({ ...item, folderId: 'missing' }, catalog), /missing/iu);
	assert.throws(() => validatePhotoCatalogReferencesV1({ ...item, collectionIds: ['collection-2'] }, catalog), /manual/iu);
	assert.throws(() => validatePhotoCatalogReferencesV1({ ...item, catalogId: 'other' }, catalog), /catalog/iu);
	for (const overrides of [{ rating: 6 }, { flag: 'yes' }, { colorLabel: 'orange' }, { keywordIds: ['a', 'a'] }]) {
		assert.throws(() => validateLightscaperDocumentV1({ ...photo(), ...overrides }));
	}
	assert.throws(() => validateLightscaperDocumentV1({ ...photo(), metadata: { ...photo().metadata, captureTime: { local: '2026-02-30T10:00:00', offsetMinutes: null } } }), /capture/iu);
	assert.throws(() => validateLightscaperDocumentV1({ ...photo(), metadata: { ...photo().metadata, iso: Infinity } }));
	const caption = 'A forest.\nSecond line.\tCredit';
	const multiline = validateLightscaperDocumentV1({ ...item, metadata: { ...item.metadata, caption } }) as PhotoDocumentV1;
	assert.equal(multiline.metadata.caption, caption);
});

test('original still references retain raw MIME and large dimensions independently of render admission', () => {
	const raw = { ...photo(), original: { ...photo().original, mimeType: 'image/x-canon-cr2', width: 65_536, height: 65_536 } };
	const validated = validateLightscaperDocumentV1(raw) as PhotoDocumentV1;
	assert.equal(validated.original.mimeType, 'image/x-canon-cr2');
	assert.equal(validated.original.width, 65_536);
	assert.equal(Object.hasOwn(validated.original, 'sampleFormat'), false);
	assert.throws(() => validateLightscaperDocumentV1({ ...raw, original: { ...raw.original, contentSha256: 'bad' } }), /digest/iu);
	const removedDevelop = { ...validated, versions: [{ ...validated.versions[0]!, develop: defaultPhotoDevelopV1() }] };
	const restored = commitPhotoHistoryV1(createPhotoHistoryV1(validated), removedDevelop);
	assert.deepEqual(restored.present.original, validated.original);
});

test('smart collections evaluate closed queries with bounded recursion and explicit timezone semantics', () => {
	const item = normalizedPhoto();
	assert.equal(matchesPhotoQueryV1(item, { kind: 'all', terms: [
		{ kind: 'rating', minimum: 3, maximum: 5 }, { kind: 'flag', value: 'pick' },
		{ kind: 'keyword', id: 'keyword-1' }, { kind: 'file-name', contains: 'FOREST' },
	] }), true);
	assert.equal(matchesPhotoQueryV1(item, { kind: 'not', term: { kind: 'label', value: 'green' } }), false);
	assert.equal(matchesPhotoQueryV1(item, { kind: 'capture-time', from: '2026-05-06T00:00:00', to: '2026-05-07T00:00:00' }), true);
	let deep: unknown = { kind: 'flag', value: 'pick' };
	for (let depth = 0; depth < 20; depth += 1) deep = { kind: 'not', term: deep };
	assert.throws(() => matchesPhotoQueryV1(item, deep), /depth/iu);
	assert.throws(() => matchesPhotoQueryV1(item, { kind: 'all', terms: [{ kind: 'unknown' }] }));
});

test('property: metadata, ratings, geometry and effect parameters survive deterministic clone/serialize/parse', () => {
	fc.assert(fc.property(
		fc.integer({ min: 0, max: 5 }),
		fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
		fc.string({ maxLength: 120 }).filter((value) => !/[\p{Cc}\p{Cf}]/u.test(value)),
		(rating, brightness, title) => {
			const fixture = photo();
			fixture.rating = rating;
			fixture.metadata.title = title;
			fixture.versions[0]!.develop.effects[0]!.params.brightness = brightness;
			const document = validateLightscaperDocumentV1(fixture);
			const encoded = serializeLightscaperDocumentV1(document);
			assert.equal(serializeLightscaperDocumentV1(parseLightscaperDocumentV1(encoded)), encoded);
			assert.deepEqual(cloneLightscaperDocumentV1(document), document);
		},
	), { numRuns: 150, seed: 42 });
});

test('property: hierarchical roots round-trip and detect back edges regardless of insertion order', () => {
	fc.assert(fc.property(fc.integer({ min: 2, max: 100 }), fc.boolean(), (count, reverse) => {
		const nodes = Array.from({ length: count }, (_, index) => ({
			id: `node-${String(index)}`, name: `Node ${String(index)}`, parentId: index === 0 ? null : `node-${String(index - 1)}`,
		}));
		const fixture = { ...root(), folders: reverse ? [...nodes].reverse() : nodes, collections: [] };
		const encoded = serializeLightscaperDocumentV1(fixture);
		assert.equal(serializeLightscaperDocumentV1(parseLightscaperDocumentV1(encoded)), encoded);
		assert.equal(serializeLightscaperDocumentV1({ ...fixture, folders: [...nodes].reverse() }), encoded);
		nodes[0]!.parentId = `node-${String(count - 1)}`;
		assert.throws(() => validateLightscaperDocumentV1(fixture), /cycle/iu);
	}), { numRuns: 100, seed: 52 });
});
