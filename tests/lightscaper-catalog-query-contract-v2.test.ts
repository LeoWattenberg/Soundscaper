/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { readPhotoSummary, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_QUERY_LIMITS_V1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { projectPhotoQueryRowV1, readPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2, PHOTO_QUERY_ROW_LIMITS_V2, photoQueryRowKeyV2, photoQuerySummaryV2,
	projectPhotoQueryRowV2, readPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoDocumentV1, PhotoMetadataV1 } from '../src/lightscaper/catalog/types.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const metadataKeys = ['fileName', 'modifiedTime', 'captureTime', 'orientation', 'cameraMake', 'cameraModel', 'lens',
	'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'title', 'caption', 'creator', 'copyright', 'location'] as const;
const textKeys = ['title', 'caption', 'creator', 'copyright', 'location'] as const;

function maximalPhoto(character: string) {
	const repeated = (length: number) => character.repeat(Math.ceil(length / character.length)).slice(0, length);
	const base = queryPhotoV1(), words = repeated(16_384), camera = repeated(1_024);
	const memberships = (prefix: string) => Array.from({ length: 1_024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
	return normalizePhotoDocumentV1({ ...base, catalogId: 'c'.repeat(128), id: 'p'.repeat(128), revision: Number.MAX_SAFE_INTEGER,
		folderId: 'f'.repeat(128), activeVersionId: 'v'.repeat(128),
		versions: [{ ...base.versions[0]!, id: 'v'.repeat(128) }],
		original: { ...base.original, id: 's'.repeat(128), storageKey: 'o'.repeat(128), width: 65_536, height: 65_536 },
		keywordIds: memberships('k'), collectionIds: memberships('c'), rating: 5, flag: 'unflagged', colorLabel: 'purple',
		metadata: { ...base.metadata, fileName: repeated(256),
			modifiedTime: '9999-12-31T23:59:59.999Z', captureTime: { local: '9999-12-31T23:59:59.999', offsetMinutes: -840 },
			orientation: 8, cameraMake: camera, cameraModel: camera, lens: camera, exposureSeconds: 86_399.99999999999,
			aperture: 1_023.9999999999999, iso: 100_000_000, focalLengthMm: 999_999.9999999999,
			title: words, caption: words, creator: words, copyright: words, location: words } });
}

function effectiveMetadata(row: ReturnType<typeof projectPhotoQueryRowV2>): PhotoMetadataV1 {
	return { fileName: row.fileName, modifiedTime: row.modifiedTime, captureTime: row.captureTime, orientation: row.orientation,
		cameraMake: row.cameraMake, cameraModel: row.cameraModel, lens: row.lens, exposureSeconds: row.exposureSeconds,
		aperture: row.aperture, iso: row.iso, focalLengthMm: row.focalLengthMm, title: row.title, caption: row.caption,
		creator: row.creator, copyright: row.copyright, location: row.location };
}

test('complete maximal effective metadata and memberships exceed V1 bytes but fit the explicit V2 limit without loss', () => {
	assert.equal(PHOTO_QUERY_LIMITS_V1.maximumRowBytes, 524_288);
	assert.equal(PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes, 1_048_576);
	for (const character of ['ࠀ', '\ud800', '\udc00', '"', '\\', '😀', '\ud800"\\']) {
		const photo = maximalPhoto(character), row = projectPhotoQueryRowV2(photo);
		for (const key of textKeys) assert.equal(row[key].length, 16_384);
		for (const key of ['cameraMake', 'cameraModel', 'lens'] as const) assert.equal(row[key]?.length, 1_024);
		assert.equal(row.keywordIds.length, 1_024); assert.equal(row.collectionIds.length, 1_024);
		assert.ok([...row.keywordIds, ...row.collectionIds].every(id => id.length === 128));
		assert.deepEqual(effectiveMetadata(row), photo.metadata); assert.deepEqual(row.keywordIds, photo.keywordIds);
		assert.deepEqual(row.collectionIds, photo.collectionIds); assert.deepEqual(photoQuerySummaryV2(row), photoSummary(photo));
		assert.equal(Object.keys(row).length, 35); assert.ok(bytes(row) <= PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes);
		if (character === 'ࠀ' || character === '\ud800' || character === '\udc00') assert.ok(bytes(row) > PHOTO_QUERY_LIMITS_V1.maximumRowBytes);
		assert.deepEqual(readPhotoQueryRowV2(JSON.parse(JSON.stringify(row)) as unknown), row);
		for (const excluded of ['summary', 'metadata', 'original', 'versions', 'develop', 'extractedMetadata', 'body', 'storageKey']) {
			assert.equal(Object.hasOwn(row, excluded), false, excluded);
		}
	}
});

test('all effective metadata fields project once, including zero offsets and authored blanks', () => {
	const base = queryPhotoV1(), photo = normalizePhotoDocumentV1({ ...base, metadata: { ...base.metadata,
		modifiedTime: '2026-10-08T11:22:33.456Z', captureTime: { local: '2026-10-08T11:22:33.456', offsetMinutes: 0 },
		orientation: 6, cameraMake: 'Canon', cameraModel: 'EOS R5', lens: 'RF 24–70', exposureSeconds: 1 / 125,
		aperture: 2.8, iso: 200, focalLengthMm: 50, copyright: '© Author', title: 'Authored', caption: 'One\nTwo', creator: '', location: '東京' } });
	const row = projectPhotoQueryRowV2(photo);
	assert.deepEqual(effectiveMetadata(row), photo.metadata); assert.equal(row.schemaVersion, 2);
	assert.deepEqual(photoQuerySummaryV2(row), photoSummary(photo));
	assert.ok(metadataKeys.every(key => Object.hasOwn(row, key))); assert.equal(Object.hasOwn(row, 'summary'), false);
	assert.equal(row.captureTime?.offsetMinutes, 0);
	const absent = projectPhotoQueryRowV2(normalizePhotoDocumentV1({ ...photo, metadata: { ...photo.metadata,
		modifiedTime: null, captureTime: null, cameraMake: null, cameraModel: null, lens: null,
		exposureSeconds: null, aperture: null, iso: null, focalLengthMm: null } }));
	assert.equal(absent.captureBucket, 1); assert.equal(absent.captureSort, ''); assert.equal(absent.cameraMake, null);
	assert.equal(photoQuerySummaryV2(absent).captureLocal, null);
});

test('conflicting extracted alternatives stay with the unchanged photo rather than becoming searchable columns', () => {
	const base = queryPhotoV1(), photo = normalizePhotoDocumentV1({ ...base,
		extractedMetadata: { schemaVersion: 1, container: 'jpeg', issues: [], iptc: null, exif: {
			orientation: 1, cameraMake: 'Source camera', cameraModel: 'Source model', lensModel: 'Source lens',
			artist: 'Source artist', copyright: 'Source copyright', description: 'Source caption', exposureSeconds: null,
			aperture: null, iso: 800, focalLengthMm: null, captureTime: null, captureTimeRaw: null } },
		metadata: { ...base.metadata, cameraMake: 'Authored camera', cameraModel: 'Authored model', lens: 'Authored lens',
			creator: '', copyright: 'Authored copyright', caption: 'Authored caption', iso: 200 } });
	const previous = JSON.stringify(photo), row = projectPhotoQueryRowV2(photo);
	assert.equal(row.iso, 200); assert.equal(row.creator, ''); assert.equal(row.cameraMake, 'Authored camera');
	assert.deepEqual(effectiveMetadata(row), photo.metadata); assert.equal(JSON.stringify(photo), previous);
	assert.equal(JSON.stringify(row).includes('Source camera'), false); assert.equal(JSON.stringify(row).includes('Source artist'), false);
	assert.equal(Object.hasOwn(row, 'exif'), false); assert.equal(Object.hasOwn(row, 'iptc'), false);
});

test('row admission detaches and freezes capture and memberships without retaining caller objects', () => {
	const raw = JSON.parse(JSON.stringify(projectPhotoQueryRowV2(queryPhotoV1(1)))) as ReturnType<typeof projectPhotoQueryRowV2>;
	const row = readPhotoQueryRowV2(raw);
	assert.notEqual(row, raw); assert.notEqual(row.captureTime, raw.captureTime); assert.notEqual(row.collectionIds, raw.collectionIds);
	assert.ok(Object.isFrozen(row)); assert.ok(Object.isFrozen(row.captureTime)); assert.ok(Object.isFrozen(row.collectionIds));
	assert.ok(Object.isFrozen(row.keywordIds));
	Reflect.set(raw.captureTime!, 'local', '2020-01-01T00:00:00.000'); Reflect.set(raw.collectionIds, 0, 'replaced');
	assert.notEqual(row.captureTime?.local, raw.captureTime?.local); assert.deepEqual(row.collectionIds, ['manual']);
});

test('identity, summaries and derived sort projections are authenticated rather than silently repaired', () => {
	const row = projectPhotoQueryRowV2(queryPhotoV1(1));
	for (const patch of [{ key: 'other|photo' }, { fileNameSort: 'forged' }, { captureBucket: 1 },
		{ captureSort: '' }, { ratingSort: 5 }]) assert.throws(() => readPhotoQueryRowV2({ ...row, ...patch }), /projection|identity|summary/iu);
	for (const patch of [{ photoRevision: -1 }, { width: 65_537 }, { height: 0 }, { originalSha256: 'A'.repeat(64) },
		{ activeVersionId: '' }, { folderId: 'bad|folder' }, { rating: 6 }, { flag: 'invalid' }, { colorLabel: 'invalid' }]) {
		assert.throws(() => readPhotoQueryRowV2({ ...row, ...patch }));
	}
	assert.deepEqual(readPhotoSummary(photoQuerySummaryV2(row)), photoSummary(queryPhotoV1(1)));
});

test('closed rows and nested metadata reject future versions, getters, symbols, sparse arrays and unknown data', () => {
	const row = projectPhotoQueryRowV2(queryPhotoV1(1)); let calls = 0;
	for (const schemaVersion of [1, 3]) assert.throws(() => readPhotoQueryRowV2({ ...row, schemaVersion }), /future|version/iu);
	for (const key of ['summary', 'metadata', 'original', 'extractedMetadata', 'future', '__proto__']) {
		assert.throws(() => readPhotoQueryRowV2({ ...row, [key]: null }), /unsupported/iu);
	}
	assert.throws(() => readPhotoQueryRowV2({ ...row, [Symbol('hidden')]: true }));
	assert.throws(() => readPhotoQueryRowV2(Object.create(row) as unknown));
	assert.throws(() => readPhotoQueryRowV2({ ...row, get cameraMake() { calls++; return 'Canon'; } }), /data property/iu);
	assert.throws(() => readPhotoQueryRowV2({ ...row, captureTime: { local: row.captureTime!.local,
		get offsetMinutes() { calls++; return 0; } } }), /data property/iu);
	const sparse: string[] = []; sparse.length = 1;
	assert.throws(() => readPhotoQueryRowV2({ ...row, keywordIds: sparse }));
	const cyclic: unknown[] = []; cyclic.push(cyclic);
	assert.throws(() => readPhotoQueryRowV2({ ...row, collectionIds: cyclic }));
	assert.throws(() => readPhotoQueryRowV2({ ...row, keywordIds: ['keyword', 'keyword'] }), /duplicate/iu);
	assert.throws(() => readPhotoQueryRowV2({ ...row, lens: 'a'.repeat(1_025) }));
	assert.throws(() => readPhotoQueryRowV2({ ...row, copyright: 'a'.repeat(16_385) }));
	assert.throws(() => readPhotoQueryRowV2(Object.defineProperty({ ...row }, 'title', { value: row.title, enumerable: false })));
	const accessorIds = ['keyword']; Object.defineProperty(accessorIds, 0, { get() { calls++; return 'keyword'; } });
	assert.throws(() => readPhotoQueryRowV2({ ...row, keywordIds: accessorIds }));
	for (const patch of [{ orientation: 9 }, { iso: 0 }, { iso: Number.NaN }, { exposureSeconds: Number.POSITIVE_INFINITY },
		{ aperture: 0 }, { focalLengthMm: -1 }, { cameraModel: undefined }, { modifiedTime: '2026-10-08' },
		{ captureTime: { local: '2026-02-30T00:00:00.000', offsetMinutes: null } }]) {
		assert.throws(() => readPhotoQueryRowV2({ ...row, ...patch }));
	}
	assert.equal(calls, 0);
});

test('four global sort keys preserve folded filename expansion and known versus unknown capture buckets', () => {
	assert.deepEqual(PHOTO_QUERY_INDEXES_V2, { 'photo-id': ['catalogId', 'photoId'],
		'file-name': ['catalogId', 'fileNameSort', 'photoId'], 'capture-time': ['catalogId', 'captureBucket', 'captureSort', 'photoId'],
		rating: ['catalogId', 'ratingSort', 'photoId'] });
	const base = queryPhotoV1(1), photo = normalizePhotoDocumentV1({ ...base, metadata: { ...base.metadata, fileName: 'İ'.repeat(256) } });
	const row = projectPhotoQueryRowV2(photo); assert.equal(row.fileNameSort.length, 512);
	assert.deepEqual(photoQueryRowKeyV2(row, 'photo-id'), [row.catalogId, row.photoId]);
	assert.deepEqual(photoQueryRowKeyV2(row, 'file-name'), [row.catalogId, 'i\u0307'.repeat(256), row.photoId]);
	assert.deepEqual(photoQueryRowKeyV2(row, 'capture-time'), [row.catalogId, 0, row.captureTime!.local, row.photoId]);
	assert.deepEqual(photoQueryRowKeyV2(row, 'rating'), [row.catalogId, row.rating, row.photoId]);
	const unknown = projectPhotoQueryRowV2(queryPhotoV1());
	assert.deepEqual(photoQueryRowKeyV2(unknown, 'capture-time'), [unknown.catalogId, 1, '', unknown.photoId]);
	assert.throws(() => Reflect.apply(photoQueryRowKeyV2, undefined, [row, 'random']), /sort|unsupported/iu);
	assert.ok(Object.isFrozen(PHOTO_QUERY_INDEXES_V2)); assert.ok(Object.isFrozen(PHOTO_QUERY_INDEXES_V2['capture-time']));
});

test('V2 projection leaves the canonical photo and V1 projection bytes unchanged', () => {
	for (const index of [0, 1, 997, 99_999]) {
		const photo: PhotoDocumentV1 = queryPhotoV1(index), before = JSON.stringify(photo), old = JSON.stringify(projectPhotoQueryRowV1(photo));
		const row = projectPhotoQueryRowV2(photo);
		assert.equal(JSON.stringify(photo), before); assert.equal(JSON.stringify(projectPhotoQueryRowV1(photo)), old);
		assert.deepEqual(photoQuerySummaryV2(row), photoSummary(photo)); assert.equal(PHOTO_QUERY_LIMITS_V1.maximumRowBytes, 524_288);
		assert.throws(() => readPhotoQueryRowV1(row), /unsupported|future/iu);
	}
});
