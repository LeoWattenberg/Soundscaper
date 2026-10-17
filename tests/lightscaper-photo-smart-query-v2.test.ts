/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../src/lightscaper/catalog/photo-metadata.ts';
import { PHOTO_METADATA_QUERY_COLUMN_IDS_V2, PHOTO_METADATA_QUERY_COLUMNS_V2, readPhotoMetadataQueryColumnV2 } from '../src/lightscaper/catalog/photo-metadata-query-columns-v2.ts';
import { PHOTO_SMART_QUERY_LIMITS_V2, type PhotoPredicateV2, type PhotoQuerySubjectV2 } from '../src/lightscaper/catalog/photo-smart-query-types-v2.ts';
import { compilePhotoSmartQueryV2, migratePhotoSmartQueryV1ToV2, normalizePhotoSmartQueryV2, serializePhotoSmartQueryV2,
	validatePhotoQueryReferencesV2 } from '../src/lightscaper/catalog/photo-smart-query-v2.ts';
import { matchesNormalizedPhotoQuerySubjectV1, normalizePhotoSmartQueryV1 } from '../src/lightscaper/catalog/smart-query.ts';
import type { PhotoMetadataV1 } from '../src/lightscaper/catalog/types.ts';

const references = { folders: new Set(['folder']), keywords: new Set(['keyword']) };
const wrapper = <Predicate>(predicate: Predicate) => ({ schemaVersion: 2, kind: 'photo-smart-query', predicate });
function subject(metadata: Partial<PhotoMetadataV1> = {}): PhotoQuerySubjectV2 {
	return Object.freeze({ metadata: normalizePhotoMetadataV1({ ...emptyPhotoMetadataV1('Image ÉTÉ.jpg'),
		title: 'Authored title', cameraMake: 'Camera', cameraModel: 'Model 2', lens: 'Lens 50', exposureSeconds: 1 / 125,
		aperture: 2.8, iso: 200, focalLengthMm: 50, modifiedTime: '2026-10-08T11:12:13.000Z',
		captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: null }, ...metadata }),
		width: 32, height: 24, rating: 4, flag: 'pick', colorLabel: 'green', folderId: 'folder', keywordIds: Object.freeze(['keyword']) });
}
const matches = (predicate: unknown, photo = subject()) => compilePhotoSmartQueryV2(wrapper(predicate), references)(photo);

test('v2 admits and detaches an explicitly versioned closed predicate wrapper', () => {
	const input = wrapper({ kind: 'all', terms: [{ kind: 'text', column: 'camera-model', operator: 'contains', value: 'MODEL' }] });
	assert.doesNotThrow(() => normalizePhotoSmartQueryV2(input));
	const query = normalizePhotoSmartQueryV2(input);
	assert.deepEqual(query, input); assert.notEqual(query, input);
	assert.ok(Object.isFrozen(query) && Object.isFrozen(query.predicate));
	if (query.predicate.kind !== 'all') throw new Error('Missing admitted group.');
	assert.ok(Object.isFrozen(query.predicate.terms) && Object.isFrozen(query.predicate.terms[0]));
	assert.equal(serializePhotoSmartQueryV2(query), JSON.stringify(query));
	assert.deepEqual(normalizePhotoSmartQueryV2(JSON.parse(serializePhotoSmartQueryV2(query)) as unknown), query);
});

test('closed admission refuses future identities, source columns, operators, scripts and accessors without invocation', () => {
	const valid = wrapper({ kind: 'text', column: 'title', operator: 'equals', value: '' }); let calls = 0;
	for (const value of [{ ...valid, schemaVersion: 3 }, { ...valid, kind: 'photo' }, { ...valid, original: {} }, valid.predicate,
		wrapper({ kind: 'text', column: 'extractedMetadata.exif.cameraModel', operator: 'contains', value: 'Model' }),
		wrapper({ kind: 'text', column: 'title', operator: 'regex', value: '.*' }),
		wrapper({ kind: 'script', value: 'return true' }), wrapper({ kind: 'number', column: 'title', minimum: 0, maximum: 1 }),
		wrapper({ kind: 'text', column: 'title', operator: 'equals', value: '', regex: true }),
		Object.defineProperty({ ...valid }, 'predicate', { enumerable: true, get() { calls++; return valid.predicate; } }),
		wrapper(Object.defineProperty({ ...valid.predicate }, 'value', { enumerable: true, get() { calls++; return ''; } })),
		wrapper({ kind: 'all', terms: Object.defineProperty([valid.predicate], '0', { enumerable: true, get() { calls++; return valid.predicate; } }) })]) {
		assert.throws(() => normalizePhotoSmartQueryV2(value));
	}
	assert.equal(calls, 0);
});

test('all nineteen columns read only complete effective metadata and declared dimensions', () => {
	const photo = subject({ caption: 'Caption', creator: 'Creator', copyright: 'Rights', location: 'Berlin', orientation: 6 });
	const expected = { 'file-name': 'Image ÉTÉ.jpg', title: 'Authored title', caption: 'Caption', creator: 'Creator', copyright: 'Rights',
		location: 'Berlin', 'camera-make': 'Camera', 'camera-model': 'Model 2', lens: 'Lens 50', orientation: 6,
		'capture-offset-minutes': null, 'exposure-seconds': 1 / 125, aperture: 2.8, iso: 200, 'focal-length-mm': 50,
		width: 32, height: 24, 'capture-time': '2026-10-08T11:12:13.000', 'modified-time': '2026-10-08T11:12:13.000Z' };
	assert.equal(PHOTO_METADATA_QUERY_COLUMN_IDS_V2.length, 19);
	assert.deepEqual(new Set(PHOTO_METADATA_QUERY_COLUMN_IDS_V2), new Set(Object.keys(expected)));
	assert.ok(Object.isFrozen(PHOTO_METADATA_QUERY_COLUMNS_V2));
	for (const column of PHOTO_METADATA_QUERY_COLUMN_IDS_V2) {
		assert.equal(readPhotoMetadataQueryColumnV2(photo, column), expected[column]);
		assert.ok(Object.isFrozen(PHOTO_METADATA_QUERY_COLUMNS_V2[column]));
	}
});

test('closed group admission snapshots native array length without invoking caller property getters', () => {
	let calls = 0;
	const leaf = { kind: 'presence', column: 'title', value: 'known' };
	const terms = new Proxy([leaf], { get() { calls++; throw new Error('Caller-owned array property getter.'); } });
	let query: PhotoPredicateV2 | null = null;
	assert.doesNotThrow(() => { query = normalizePhotoSmartQueryV2(wrapper({ kind: 'all', terms })).predicate; });
	assert.equal(calls, 0); assert.deepEqual(query, { kind: 'all', terms: [leaf] });
});

test('case folding and explicit text operators include copyright and multiline authored values', () => {
	assert.equal(matches({ kind: 'text', column: 'file-name', operator: 'equals', value: 'image été.JPG' }), true);
	assert.equal(matches({ kind: 'text', column: 'camera-model', operator: 'starts-with', value: 'MODEL' }), true);
	assert.equal(matches({ kind: 'text', column: 'lens', operator: 'contains', value: '50' }), true);
	assert.equal(matches({ kind: 'text', column: 'copyright', operator: 'contains', value: 'owner\neditor' }, subject({ copyright: 'Owner\nEditor' })), true);
	assert.equal(matches({ kind: 'text', column: 'caption', operator: 'equals', value: 'one\ttwo' }, subject({ caption: 'One\tTwo' })), true);
	assert.equal(matches({ kind: 'text', column: 'title', operator: 'equals', value: 'Authored' }), false);
	for (const operator of ['contains', 'starts-with']) assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'text', column: 'title', operator, value: '' })));
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'text', column: 'title', operator: 'contains', value: 'a\nb' })));
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'text', column: 'caption', operator: 'contains', value: '\0' })));
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'text', column: 'title', operator: 'equals', value: 'x'.repeat(257) })));
});

test('empty authored text is known while absent nullable facts do not equal empty strings or zero', () => {
	const photo = subject({ title: '', cameraMake: null, iso: null, captureTime: null });
	assert.equal(matches({ kind: 'text', column: 'title', operator: 'equals', value: '' }, photo), true);
	assert.equal(matches({ kind: 'presence', column: 'title', value: 'known' }, photo), true);
	assert.equal(matches({ kind: 'presence', column: 'camera-make', value: 'unknown' }, photo), true);
	assert.equal(matches({ kind: 'text', column: 'camera-make', operator: 'equals', value: '' }, photo), false);
	assert.equal(matches({ kind: 'number', column: 'iso', minimum: 1, maximum: null }, photo), false);
	assert.equal(matches({ kind: 'presence', column: 'capture-time', value: 'unknown' }, photo), true);
	assert.equal(matches({ kind: 'presence', column: 'capture-offset-minutes', value: 'unknown' }), true);
	assert.equal(matches({ kind: 'presence', column: 'capture-time', value: 'known' }), true);
	assert.equal(matches({ kind: 'not', term: { kind: 'number', column: 'iso', minimum: 1, maximum: null } }, photo), true);
	assert.equal(matches({ kind: 'presence', column: 'camera-make', value: 'known' }, subject({ cameraMake: '' })), true);
});

test('numeric bounds use effective units and inclusive ranges without coercion', () => {
	for (const [column, value] of [['orientation', 1], ['exposure-seconds', 1 / 125], ['aperture', 2.8], ['iso', 200],
		['focal-length-mm', 50], ['width', 32], ['height', 24]] as const) {
		assert.equal(matches({ kind: 'number', column, minimum: value, maximum: value }), true);
	}
	assert.equal(matches({ kind: 'number', column: 'capture-offset-minutes', minimum: -270, maximum: -270 },
		subject({ captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: -270 } })), true);
	assert.equal(matches({ kind: 'number', column: 'width', minimum: 65_536, maximum: null }, { ...subject(), width: 65_536 }), true);
	for (const [column, minimum, maximum] of [['iso', 1.5, 2], ['iso', 0, 200], ['iso', 1, 100_000_001],
		['orientation', 0, 1], ['exposure-seconds', 0, 1], ['aperture', 0, 2.8], ['focal-length-mm', 0.1, Infinity],
		['width', 1, 65_537], ['height', 1.5, 2], ['capture-offset-minutes', -841, null], ['iso', 201, 200], ['iso', null, null]]) {
		assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'number', column, minimum, maximum })));
	}
	assert.equal(matches({ kind: 'number', column: 'iso', minimum: null, maximum: 199 }), false);
});

test('local capture and UTC modified intervals stay distinct and half-open with separate offsets', () => {
	assert.equal(matches({ kind: 'time', column: 'capture-time', from: '2026-10-08T11:12:13', to: '2026-10-08T11:12:14' }), true);
	assert.equal(matches({ kind: 'time', column: 'capture-time', from: null, to: '2026-10-08T11:12:13' }), false);
	assert.equal(matches({ kind: 'time', column: 'modified-time', from: '2026-10-08T11:12:13.000Z', to: null }), true);
	assert.equal(matches({ kind: 'time', column: 'modified-time', from: null, to: '2026-10-08T11:12:13.000Z' }), false);
	const otherOffset = subject({ captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: 840 } });
	assert.equal(matches({ kind: 'time', column: 'capture-time', from: '2026-10-08T11:12:13', to: null }, otherOffset), true);
	assert.equal(matches({ kind: 'time', column: 'capture-time', from: '2026-10-08T00:00:00', to: null }, subject({ captureTime: null })), false);
	for (const [column, from, to] of [['capture-time', '2026-10-08T11:12:13.000Z', null],
		['modified-time', '2026-10-08T11:12:13', null], ['capture-time', '2026-02-30T00:00:00', null],
		['modified-time', '2026-02-30T00:00:00.000Z', null], ['capture-time', null, null],
		['capture-time', '2026-10-08T11:12:13', '2026-10-08T11:12:13'], ['title', '2026-10-08T11:12:13', null]]) {
		assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'time', column, from, to })));
	}
});

test('compilation validates every reference before short-circuit evaluation or subject reads', () => {
	let reads = 0;
	const photo = Object.defineProperty({ ...subject() }, 'rating', { get() { reads++; return 5; } });
	for (const predicate of [{ kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'keyword', id: 'missing' }] },
		{ kind: 'all', terms: [{ kind: 'rating', minimum: 0, maximum: 0 }, { kind: 'folder', id: 'missing' }] },
		{ kind: 'not', term: { kind: 'keyword', id: 'missing' } }]) {
		assert.throws(() => compilePhotoSmartQueryV2(wrapper(predicate), references)(photo), ReferenceError);
		assert.throws(() => validatePhotoQueryReferencesV2(wrapper(predicate), references.folders, references.keywords), ReferenceError);
	}
	assert.equal(reads, 0);
	const keywords = new Set(['keyword']);
	const compiled = compilePhotoSmartQueryV2(wrapper({ kind: 'keyword', id: 'keyword' }), { folders: references.folders, keywords });
	keywords.clear(); assert.equal(compiled(subject()), true);
});

test('effective authored facts never fall back to original metadata or acquire original bodies', () => {
	let reads = 0;
	const photo = Object.defineProperties({ ...subject({ creator: '', cameraMake: null }) }, {
		extractedMetadata: { get() { reads++; throw new Error('Do not inspect immutable source facts.'); } },
		original: { get() { reads++; throw new Error('Do not acquire original bytes.'); } },
	});
	assert.equal(matches({ kind: 'text', column: 'creator', operator: 'equals', value: '' }, photo), true);
	assert.equal(matches({ kind: 'text', column: 'creator', operator: 'contains', value: 'Source creator' }, photo), false);
	assert.equal(matches({ kind: 'presence', column: 'camera-make', value: 'unknown' }, photo), true);
	assert.equal(reads, 0);
});

test('explicit v1 migration preserves every old operator without changing v1 admission or bytes', () => {
	const predicates = [{ kind: 'rating', minimum: 2, maximum: 5 }, { kind: 'flag', value: 'pick' }, { kind: 'label', value: 'green' },
		{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }, { kind: 'file-name', contains: 'ÉTÉ' },
		{ kind: 'capture-time', from: '2026-10-08T00:00:00', to: '2026-10-09T00:00:00' },
		{ kind: 'not', term: { kind: 'flag', value: 'reject' } },
		{ kind: 'all', terms: [{ kind: 'keyword', id: 'keyword' }, { kind: 'rating', minimum: 3, maximum: 5 }] },
		{ kind: 'any', terms: [{ kind: 'flag', value: 'reject' }, { kind: 'label', value: 'green' }] }];
	for (const predicate of predicates) {
		const old = normalizePhotoSmartQueryV1(predicate), before = JSON.stringify(old), upgraded = migratePhotoSmartQueryV1ToV2(predicate);
		assert.deepEqual(upgraded.predicate, old); assert.equal(JSON.stringify(old), before);
		assert.throws(() => normalizePhotoSmartQueryV1(upgraded));
		for (const rating of [0, 3, 5]) for (const captureTime of [null, subject().metadata.captureTime]) {
			const photo = { ...subject({ captureTime }), rating };
			const legacy = { ...photo, fileName: photo.metadata.fileName, captureLocal: photo.metadata.captureTime?.local ?? null };
			assert.equal(compilePhotoSmartQueryV2(upgraded, references)(photo), matchesNormalizedPhotoQuerySubjectV1(legacy, old));
		}
	}
	assert.throws(() => migratePhotoSmartQueryV1ToV2(wrapper(predicates[0])));
	assert.equal(JSON.stringify(normalizePhotoSmartQueryV1({ kind: 'file-name', contains: 'ÉTÉ' })), '{"kind":"file-name","contains":"ÉTÉ"}');
});

test('depth sixteen and total256 nodes stay independent bounded admission budgets', () => {
	const leaf = { kind: 'presence', column: 'title', value: 'known' };
	let nested: unknown = leaf; for (let count = 1; count < 16; count++) nested = { kind: 'not', term: nested };
	assert.doesNotThrow(() => normalizePhotoSmartQueryV2(wrapper(nested)));
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'not', term: nested })), RangeError);
	assert.doesNotThrow(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'all', terms: Array.from({ length: 255 }, () => leaf) })));
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'all', terms: Array.from({ length: 256 }, () => leaf) })), RangeError);
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper({ kind: 'all', terms: [] })), RangeError);
	const cycle: { kind: 'not'; term?: unknown } = { kind: 'not' }; cycle.term = cycle;
	assert.throws(() => normalizePhotoSmartQueryV2(wrapper(cycle)), RangeError);
});

test('maximal escaped query round-trips within the explicit512KiB serialized v2 bound', () => {
	const predicate: PhotoPredicateV2 = { kind: 'all', terms: Array.from({ length: 255 }, () => ({
		kind: 'text', column: 'caption', operator: 'equals', value: '\ud800'.repeat(256),
	})) };
	const serialized = serializePhotoSmartQueryV2(wrapper(predicate)), bytes = new TextEncoder().encode(serialized).byteLength;
	assert.ok(bytes > 256 * 1024); assert.ok(bytes <= PHOTO_SMART_QUERY_LIMITS_V2.maximumBytes);
	assert.equal(PHOTO_SMART_QUERY_LIMITS_V2.maximumBytes, 512 * 1024);
	assert.equal(serializePhotoSmartQueryV2(JSON.parse(serialized) as unknown), serialized);
});
