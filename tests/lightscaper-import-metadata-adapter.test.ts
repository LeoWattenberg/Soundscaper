/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { normalizeImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-normalizer-v1.ts';
import { adaptPhotoImportMetadataV1, adaptPhotoImportMetadataBatchV1 } from '../src/lightscaper/import/metadata-adapter-v1.ts';
import { cloneLightscaperDocumentV1, parseLightscaperDocumentV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { encodePhotoCatalogPackV1, readPhotoCatalogPackV1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { IMAGE_IMPORT_LIMITS } from '../src/common/editor/image-import-admission.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { iptcDataSet, iptcText, joinBytes, jpegExif, jpegFixture, numberEntry, photoshopIptc, rationalEntry, textEntry, tiffFixture } from './helpers/image-metadata-fixtures.ts';

function facts(date = '2024:02:29 13:14:15', offset: string | null = null, subsecond: string | null = null) {
	return readImageMetadataV1(jpegFixture(jpegExif(tiffFixture([numberEntry(0x0112, 6), textEntry(0x010f, 'Camera')],
		[textEntry(0x9003, date), ...(offset === null ? [] : [textEntry(0x9011, offset)]),
			...(subsecond === null ? [] : [textEntry(0x9291, subsecond)]), rationalEntry(0x829a, 1, 125)])),
	photoshopIptc(joinBytes(iptcDataSet(1, 90, new Uint8Array([27, 37, 71])), iptcText(5, 'Title'),
		iptcText(105, 'Headline'), iptcText(120, 'Caption'), iptcText(80, 'Alice'), iptcText(80, 'Bob'),
		iptcText(25, 'München'), iptcText(25, 'Portrait'), iptcText(25, 'München')))));
}

function request(extractedMetadata = facts()) {
	return { fileName: 'Photo.jpg', modifiedTime: null, byteLength: 123, extractedMetadata };
}

test('shared read-model normalization is inert, detached, bounded and accepts legacy raw-time omission', () => {
	const source = facts();
	const normalized = normalizeImageMetadataV1(JSON.parse(JSON.stringify(source)) as unknown);
	assert.deepEqual(normalized, source);
	assert.notEqual(normalized, source);
	assert.notEqual(normalized.iptc?.creators, source.iptc?.creators);
	assert.ok(Object.isFrozen(normalized.exif?.captureTimeRaw));
	const legacy = structuredClone(source);
	if (legacy.exif) delete (legacy.exif as { captureTimeRaw?: unknown }).captureTimeRaw;
	assert.equal(normalizeImageMetadataV1(legacy).exif?.captureTimeRaw, null);
	let calls = 0;
	const accessor = { ...source };
	Object.defineProperty(accessor, 'exif', { enumerable: true, get() { calls++; return source.exif; } });
	assert.throws(() => normalizeImageMetadataV1(accessor), TypeError);
	const repeated = [...(source.iptc?.creators ?? [])];
	Object.defineProperty(repeated, '0', { enumerable: true, get() { calls++; return 'Alice'; } });
	assert.throws(() => normalizeImageMetadataV1({ ...source, iptc: { ...source.iptc, creators: repeated } }), TypeError);
	assert.equal(calls, 0);
	assert.throws(() => normalizeImageMetadataV1({ ...source, schemaVersion: 2 }), /schema/u);
	assert.throws(() => normalizeImageMetadataV1({ ...source, extra: 1 }), /unsupported/u);
	assert.throws(() => normalizeImageMetadataV1({ ...source, iptc: { ...source.iptc, creators: Array.from({ length: 257 }, () => 'A') } }), RangeError);
	assert.throws(() => normalizeImageMetadataV1({ ...source, exif: { ...source.exif, captureTimeRaw: { dateTimeOriginal: 'invalid', offsetTimeOriginal: null, subsecondOriginal: null } } }), /capture/u);
	assert.throws(() => normalizeImageMetadataV1({ ...source, exif: { ...source.exif, captureTime: { local: '2024-03-01T13:14:15', offsetMinutes: null, subsecond: null } } }), /raw/u);
	assert.throws(() => normalizeImageMetadataV1({ ...source, exif: { ...source.exif, iso: 1.5 } }), RangeError);
	assert.throws(() => normalizeImageMetadataV1({ ...source, iptc: { ...source.iptc, encoding: 'ascii' } }), /encoding/u);
	assert.throws(() => normalizeImageMetadataV1({ ...source, issues: ['future-issue'] }), /Unsupported/u);
});

test('adapter preserves repeated creators and keywords separately from catalog display fields', () => {
	const result = adaptPhotoImportMetadataV1(request());
	assert.equal(result.metadata.cameraMake, 'Camera');
	assert.equal(result.metadata.orientation, 6);
	assert.equal(result.metadata.exposureSeconds, 0.008);
	assert.equal(result.metadata.creator, 'Alice; Bob');
	assert.equal(result.metadata.title, 'Title');
	assert.equal(result.metadata.caption, 'Caption');
	assert.equal(result.metadata.modifiedTime, null);
	assert.deepEqual(result.metadata.captureTime, { local: '2024-02-29T13:14:15.000', offsetMinutes: null });
	assert.deepEqual(result.keywordNames, ['München', 'Portrait', 'München']);
	assert.deepEqual(result.extractedMetadata.iptc?.creators, ['Alice', 'Bob']);
	assert.equal(result.extractedMetadata.iptc?.headline, 'Headline');
	assert.ok(result.notices.some(notice => notice.field === 'headline'));
	assert.ok(Object.isFrozen(result));
	assert.ok(Object.isFrozen(result.keywordNames));
});

test('unknown and partial capture values remain extracted facts without invented instants', () => {
	for (const date of ['    :02:29 13:14:15', ' '.repeat(19)]) {
		const result = adaptPhotoImportMetadataV1(request(facts(date, '   :  ', '123456')));
		assert.equal(result.metadata.captureTime, null);
		assert.deepEqual(result.extractedMetadata.exif?.captureTimeRaw, {
			dateTimeOriginal: date, offsetTimeOriginal: '   :  ', subsecondOriginal: '123456',
		});
		assert.ok(result.notices.some(notice => notice.field === 'captureTime'));
	}
	for (const [offset, subsecond] of [['+15:00', null], [null, '123456']] as const) {
		const result = adaptPhotoImportMetadataV1(request(facts('2024:02:29 13:14:15', offset, subsecond)));
		assert.equal(result.metadata.captureTime, null);
		assert.ok(result.notices.some(notice => notice.field === 'captureTime'));
		assert.equal(result.extractedMetadata.exif?.captureTime?.subsecond, subsecond);
	}
	assert.deepEqual(adaptPhotoImportMetadataV1(request(facts('2024:02:29 13:14:15', '-04:30', '12'))).metadata.captureTime,
		{ local: '2024-02-29T13:14:15.120', offsetMinutes: -270 });
});

test('IPTC capture fields combine only when both date and time are complete and valid', () => {
	for (const [date, time, expected] of [
		['20241007', '010203+0530', { local: '2024-10-07T01:02:03.000', offsetMinutes: 330 }],
		['20240000', '010203+0530', null], ['20241007', null, null],
	] as const) {
		const extracted = readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(iptcText(55, date), ...(time === null ? [] : [iptcText(60, time)])))));
		const result = adaptPhotoImportMetadataV1(request(extracted));
		assert.deepEqual(result.metadata.captureTime, expected);
		assert.equal(result.extractedMetadata.iptc?.captureDate, date);
		assert.equal(result.extractedMetadata.iptc?.captureTime, time);
	}
});

test('display-model refusal retains exact facts and reports the field instead of dropping it', () => {
	const extracted = readImageMetadataV1(tiffFixture([textEntry(0x010f, 'x'.repeat(2_000))], [rationalEntry(0x829d, 0, 1)]));
	const result = adaptPhotoImportMetadataV1(request(extracted));
	assert.equal(result.metadata.cameraMake, null);
	assert.equal(result.metadata.aperture, null);
	assert.equal(result.extractedMetadata.exif?.cameraMake?.length, 2_000);
	assert.equal(result.extractedMetadata.exif?.aperture, 0);
	assert.deepEqual(result.notices.map(notice => notice.field).sort(), ['aperture', 'cameraMake']);
	const unicode = readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(iptcDataSet(1, 90, new Uint8Array([27, 37, 71])),
		iptcText(5, 'Title\u200b'), iptcText(25, 'Keyword\u200b')))));
	const display = adaptPhotoImportMetadataV1(request(unicode));
	assert.equal(display.metadata.title, '');
	assert.equal(display.extractedMetadata.iptc?.objectName, 'Title\u200b');
	assert.deepEqual(display.keywordNames, ['Keyword\u200b']);
	assert.deepEqual(display.notices.map(notice => notice.field), ['title', 'keywords']);
});

test('source precedence keeps alternate source facts and reports conflicting display candidates', () => {
	const extracted = readImageMetadataV1(jpegFixture(jpegExif(tiffFixture([
		textEntry(0x013b, 'Exif creator'), textEntry(0x010e, 'Exif description'), textEntry(0x8298, 'Exif owner'),
	])), photoshopIptc(joinBytes(iptcText(80, 'IPTC creator'), iptcText(120, 'IPTC caption'), iptcText(116, 'IPTC owner')))));
	const result = adaptPhotoImportMetadataV1(request(extracted));
	assert.equal(result.metadata.creator, 'IPTC creator');
	assert.equal(result.metadata.caption, 'IPTC caption');
	assert.equal(result.metadata.copyright, 'IPTC owner');
	assert.equal(result.extractedMetadata.exif?.artist, 'Exif creator');
	assert.deepEqual(result.notices.map(notice => notice.field).sort(), ['caption', 'copyright', 'creator']);
});

test('photo persistence retains full extraction, canonicalizes legacy omission and rejects future facts', () => {
	const source = photoArchiveFixture().photo;
	const imported = adaptPhotoImportMetadataV1(request(facts('    :02:29 13:14:15')));
	const photo = normalizePhotoDocumentV1({ ...source, metadata: imported.metadata, extractedMetadata: imported.extractedMetadata });
	const encoded = serializeLightscaperDocumentV1(photo);
	assert.deepEqual(parseLightscaperDocumentV1(encoded), photo);
	assert.deepEqual(cloneLightscaperDocumentV1(photo), photo);
	const { extractedMetadata: _extracted, ...legacy } = photo;
	assert.equal(normalizePhotoDocumentV1(legacy).extractedMetadata, null);
	assert.throws(() => normalizePhotoDocumentV1({ ...photo, extractedMetadata: { ...photo.extractedMetadata, schemaVersion: 2 } }), /schema/u);
});

test('streamed catalog packs round-trip extracted facts and preserve the exact source bytes', async () => {
	const bytes = jpegFixture(jpegExif(tiffFixture([], [textEntry(0x9003, '    :02:29 13:14:15'),
		textEntry(0x9011, '   :  '), textEntry(0x9291, '123456')])),
	photoshopIptc(joinBytes(iptcText(80, 'Alice'), iptcText(80, 'Bob'), iptcText(25, 'Nature'), iptcText(25, 'Nature'))));
	const snapshot = bytes.slice();
	const fixture = photoArchiveFixture(1, bytes.slice());
	const imported = adaptPhotoImportMetadataV1({ ...request(readImageMetadataV1(bytes)), byteLength: bytes.length });
	const photo = normalizePhotoDocumentV1({ ...fixture.photo,
		original: { ...fixture.photo.original, mimeType: 'image/jpeg', name: 'Photo.jpg' },
		metadata: imported.metadata, extractedMetadata: imported.extractedMetadata });
	const packets: Uint8Array[] = [];
	for await (const packet of encodePhotoCatalogPackV1([{ photo, original: new Blob([bytes.slice()], { type: 'image/jpeg' }) }])) packets.push(packet);
	async function* source() {
		for (const packet of packets) for (let offset = 0; offset < packet.length; offset += 7) yield packet.subarray(offset, offset + 7);
	}
	assert.equal(await readPhotoCatalogPackV1(source(), async (recovered, original) => {
		assert.deepEqual(recovered, photo);
		const parts: Uint8Array[] = [];
		for await (const part of original) parts.push(part);
		assert.deepEqual(joinBytes(...parts), snapshot);
	}), 1);
	assert.deepEqual(bytes, snapshot);
});

test('property round trips keep creator/keyword order and exact raw subsecond precision', () => {
	fc.assert(fc.property(fc.array(fc.stringMatching(/^[A-Za-z]{1,16}$/u), { maxLength: 20 }),
		fc.stringMatching(/^[0-9]{1,16}$/u), (names, precision) => {
			const source = facts('2024:02:29 13:14:15', null, precision);
			const extracted = normalizeImageMetadataV1({ ...source, iptc: { ...source.iptc, creators: names, keywords: names } });
			const imported = adaptPhotoImportMetadataV1(request(extracted));
			const photo = normalizePhotoDocumentV1({ ...photoArchiveFixture().photo, metadata: imported.metadata, extractedMetadata: imported.extractedMetadata });
			const roundTrip = parseLightscaperDocumentV1(serializeLightscaperDocumentV1(photo));
			assert.equal(roundTrip.kind, 'photo');
			if (roundTrip.kind !== 'photo') throw new Error('Wrong schema kind.');
			assert.deepEqual(roundTrip.extractedMetadata?.iptc?.creators, names);
			assert.deepEqual(roundTrip.extractedMetadata?.iptc?.keywords, names);
			assert.equal(roundTrip.extractedMetadata?.exif?.captureTimeRaw?.subsecondOriginal, precision);
		}), { numRuns: 100, seed: 0x5eed });
});

test('batch admission bounds all inputs before producing facts and never reads accessors', () => {
	const inputs = Array.from({ length: IMAGE_IMPORT_LIMITS.maximumFilesPerGesture }, () => request());
	assert.equal(adaptPhotoImportMetadataBatchV1(inputs).length, 64);
	assert.throws(() => adaptPhotoImportMetadataBatchV1([...inputs, request()]), /files/u);
	assert.throws(() => adaptPhotoImportMetadataBatchV1(Array.from({ length: 9 }, () => ({ ...request(), byteLength: IMAGE_IMPORT_LIMITS.maximumFileInputBytes }))), /gesture/u);
	assert.throws(() => adaptPhotoImportMetadataV1({ ...request(), byteLength: IMAGE_IMPORT_LIMITS.maximumFileInputBytes + 1 }), /input/u);
	let calls = 0;
	const hostile = { ...request(), get extractedMetadata() { calls++; return facts(); } };
	assert.throws(() => adaptPhotoImportMetadataV1(hostile), TypeError);
	assert.equal(calls, 0);
});

test('durable authored edits cannot replace extracted facts associated with an immutable original', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'extracted-facts-test', verifyOriginal: async () => undefined });
	try {
		await repository.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
			kind: 'photo-catalog', id: 'catalog-1', name: 'Test', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
		const imported = adaptPhotoImportMetadataV1(request());
		const photo = normalizePhotoDocumentV1({ ...photoArchiveFixture().photo, metadata: imported.metadata, extractedMetadata: imported.extractedMetadata });
		await repository.publishPhotos('catalog-1', 0, [photo]);
		const authored = await repository.savePhoto({ ...photo, metadata: { ...photo.metadata, creator: 'Authored owner' } }, 0);
		assert.deepEqual(authored.extractedMetadata, photo.extractedMetadata);
		await assert.rejects(repository.savePhoto({ ...authored, extractedMetadata: null }, 1), /extracted/iu);
		assert.deepEqual(await repository.loadPhoto('catalog-1', photo.id), authored);
	} finally { await repository.close(); }
});
