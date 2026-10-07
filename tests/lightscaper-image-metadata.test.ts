/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { IMAGE_METADATA_LIMITS_V1, readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import {
	iptcDataSet, iptcText, joinBytes, jpegExif, jpegFixture, jpegSegment, numberEntry,
	photoshopIptc, pngChunk, pngFixture, rationalEntry, textEntry, tiffFixture,
} from './helpers/image-metadata-fixtures.ts';

function cameraFixture(little = true): Uint8Array {
	return tiffFixture([
		numberEntry(0x0112, 6, little), textEntry(0x010f, 'Example camera'), textEntry(0x0110, 'Model 1'),
		textEntry(0x013b, 'Photographer'), textEntry(0x8298, 'Copyright owner'),
	], [
		textEntry(0x9003, '2024:02:29 13:14:15'), textEntry(0x9011, '+05:30'),
		textEntry(0x9291, '123'), textEntry(0xa434, 'Example lens'),
		rationalEntry(0x829a, 1, 125, little), rationalEntry(0x829d, 28, 10, little),
		numberEntry(0x8827, 200, little), rationalEntry(0x920a, 50, 1, little),
	], little);
}

test('TIFF and JPEG EXIF preserve the same camera facts in both byte orders', () => {
	for (const little of [true, false]) {
		const tiff = cameraFixture(little);
		for (const input of [tiff, jpegFixture(jpegExif(tiff))]) {
			const result = readImageMetadataV1(input);
			assert.equal(result.schemaVersion, 1);
			assert.deepEqual(result.issues, []);
			assert.equal(result.iptc, null);
			assert.deepEqual(result.exif, {
				orientation: 6, cameraMake: 'Example camera', cameraModel: 'Model 1', lensModel: 'Example lens',
				artist: 'Photographer', copyright: 'Copyright owner', description: null,
				exposureSeconds: 0.008, aperture: 2.8, iso: 200, focalLengthMm: 50,
				captureTime: { local: '2024-02-29T13:14:15', offsetMinutes: 330, subsecond: '123' },
				captureTimeRaw: { dateTimeOriginal: '2024:02:29 13:14:15', offsetTimeOriginal: '+05:30', subsecondOriginal: '123' },
			});
			assert.ok(Object.isFrozen(result));
			assert.ok(Object.isFrozen(result.exif));
			assert.ok(Object.isFrozen(result.exif?.captureTime));
		}
	}
});

test('capture time retains an unknown offset and does not invent a local timezone', () => {
	const result = readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '2026:10:07 01:02:03')]));
	assert.deepEqual(result.exif?.captureTime, { local: '2026-10-07T01:02:03', offsetMinutes: null, subsecond: null });
	assert.equal(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '2023:02:29 00:00:00')])).exif, null);
});

test('Exif permits unknown timestamp components and the two copyright owners specified by CIPA', () => {
	const result = readImageMetadataV1(tiffFixture([numberEntry(0x0112, 1), textEntry(0x8298, 'Photographer\0Editor')],
		[textEntry(0x9003, '    :  :     :  :  ')]));
	assert.deepEqual(result.issues, []);
	assert.equal(result.exif?.captureTime, null);
	assert.equal(result.exif?.copyright, 'Photographer\nEditor');
	assert.equal(result.exif?.orientation, 1);
	const unknownOffset = readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '2026:10:07 01:02:03'),
		textEntry(0x9011, '      '), textEntry(0x9291, '   ')]));
	assert.deepEqual(unknownOffset.exif?.captureTime, { local: '2026-10-07T01:02:03', offsetMinutes: null, subsecond: null });
	assert.equal(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, ' '.repeat(19))])).exif?.captureTime, null);
	assert.deepEqual(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '2026:10:07 01:02:03'), textEntry(0x9011, '   :  ')])).exif?.captureTime,
		{ local: '2026-10-07T01:02:03', offsetMinutes: null, subsecond: null });
});

test('partial Exif times retain unknown fields but still reject impossible known components', () => {
	assert.equal(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '    :02:29 00:00:00')])).exif?.captureTime, null);
	for (const date of ['    :02:30 00:00:00', '2026:00:     :  :  ', '2026:01:00   :  :  ',
		'1900:02:29 00:00:00', '2026:01:01 24:00:00']) {
		assert.equal(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, date)])).exif, null);
	}
	for (const entry of [textEntry(0x9011, '+24:00'), textEntry(0x9011, '+00:60'), textEntry(0x9291, 'abc')]) {
		assert.equal(readImageMetadataV1(tiffFixture([], [textEntry(0x9003, '2026:10:07 00:00:00'), entry])).exif, null);
	}
});

test('PNG eXIf carries TIFF directly, verifies CRC and can occur after image data', () => {
	const data = cameraFixture();
	const result = readImageMetadataV1(pngFixture(pngChunk('IDAT', new Uint8Array()), pngChunk('eXIf', data)));
	assert.equal(result.container, 'png');
	assert.deepEqual(result.exif, readImageMetadataV1(data).exif);
	const bad = pngChunk('eXIf', data);
	bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
	const rejected = readImageMetadataV1(pngFixture(bad));
	assert.equal(rejected.exif, null);
	assert.deepEqual(rejected.issues, ['malformed-container']);
});

test('APP13 Pascal padding, UTF-8 and repeated IPTC fields retain their declared meaning', () => {
	const data = joinBytes(iptcDataSet(1, 90, new Uint8Array([27, 37, 71])), iptcText(5, 'Title'),
		iptcText(25, 'München'), iptcText(25, 'Portrait'), iptcText(80, 'Alice'), iptcText(80, 'Bob'),
		iptcText(105, 'Headline'), iptcText(120, 'A caption.\nSecond line.'), iptcText(116, 'Copyright owner'));
	for (const name of ['', 'a', 'ab']) {
		const result = readImageMetadataV1(jpegFixture(photoshopIptc(data, name)));
		assert.deepEqual(result.issues, []);
		assert.equal(result.iptc?.encoding, 'utf8');
		assert.equal(result.iptc?.objectName, 'Title');
		assert.equal(result.iptc?.headline, 'Headline');
		assert.equal(result.iptc?.caption, 'A caption.\nSecond line.');
		assert.equal(result.iptc?.copyright, 'Copyright owner');
		assert.deepEqual(result.iptc?.keywords, ['München', 'Portrait']);
		assert.deepEqual(result.iptc?.creators, ['Alice', 'Bob']);
		assert.ok(Object.isFrozen(result.iptc?.keywords));
	}
});

test('IPTC accepts bounded extended lengths and refuses ambiguous single-value fields', () => {
	const extended = iptcDataSet(2, 200, new Uint8Array(32_768), true);
	assert.equal(readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(extended, iptcText(5, 'Title'))))).iptc?.objectName, 'Title');
	const duplicate = readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(iptcText(5, 'One'), iptcText(5, 'Two')))));
	assert.equal(duplicate.iptc, null);
	assert.deepEqual(duplicate.issues, ['malformed-iptc']);
});

test('IPTC capture fields validate Gregorian dates while retaining declared unknown components', () => {
	for (const valid of ['20240229', '20000229', '20240000', '20240200']) {
		assert.equal(readImageMetadataV1(jpegFixture(photoshopIptc(iptcText(55, valid)))).iptc?.captureDate, valid);
	}
	for (const invalid of ['20230229', '19000229', '20260431', '20260001', '20261301']) {
		assert.equal(readImageMetadataV1(jpegFixture(photoshopIptc(iptcText(55, invalid)))).iptc, null);
	}
	assert.equal(readImageMetadataV1(jpegFixture(photoshopIptc(iptcText(60, '235959-0430')))).iptc?.captureTime, '235959-0430');
	for (const invalid of ['240000+0000', '120000+2460']) {
		assert.equal(readImageMetadataV1(jpegFixture(photoshopIptc(iptcText(60, invalid)))).iptc, null);
	}
});

test('unknown IPTC character sets and undeclared non-ASCII do not get silently guessed', () => {
	for (const data of [
		joinBytes(iptcDataSet(1, 90, new Uint8Array([27, 36, 66])), iptcText(5, 'Title')),
		iptcDataSet(2, 5, new Uint8Array([0xe9])),
		joinBytes(iptcDataSet(1, 90, new Uint8Array([27, 37, 71])), iptcDataSet(2, 5, new Uint8Array([0xc0, 0xaf]))),
	]) {
		const result = readImageMetadataV1(jpegFixture(photoshopIptc(data)));
		assert.equal(result.iptc, null);
		assert.ok(result.issues.includes('unsupported-text-encoding'));
	}
});

test('EXIF pointers, counts, duplicate tags, rational denominators and cycles fail closed', () => {
	const pointer = tiffFixture([textEntry(0x010f, 'Example')]);
	new DataView(pointer.buffer).setUint32(18, 0xfffffff0, true);
	const cycle = tiffFixture([numberEntry(0x8769, 8, true, 4)]);
	const count = tiffFixture([textEntry(0x010f, 'Example')]);
	new DataView(count.buffer).setUint32(14, 0xffffffff, true);
	for (const input of [pointer, cycle, count,
		tiffFixture([numberEntry(0x0112, 1), numberEntry(0x0112, 6)]),
		tiffFixture([], [rationalEntry(0x829a, 1, 0)]),
	]) {
		const result = readImageMetadataV1(input);
		assert.equal(result.exif, null);
		assert.deepEqual(result.issues, ['malformed-exif']);
	}
});

test('metadata cannot point into another JPEG segment or replace the first ambiguous profile', () => {
	const truncated = cameraFixture().subarray(0, 24);
	const result = readImageMetadataV1(jpegFixture(jpegExif(truncated), jpegSegment(0xe0, cameraFixture())));
	assert.equal(result.exif, null);
	assert.ok(result.issues.includes('malformed-exif'));
	for (const input of [jpegFixture(jpegExif(cameraFixture()), jpegExif(cameraFixture())),
		pngFixture(pngChunk('eXIf', cameraFixture()), pngChunk('eXIf', cameraFixture()))]) {
		assert.equal(readImageMetadataV1(input).exif, null);
		assert.ok(readImageMetadataV1(input).issues.includes('duplicate-metadata'));
	}
});

test('JPEG entropy and non-Exif APP1 payloads cannot masquerade as metadata', () => {
	const data = joinBytes(jpegFixture(jpegSegment(0xe1, new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0xmp'))).subarray(0, -2),
		new Uint8Array([0xff, 0xda, 0, 2]), jpegExif(cameraFixture()));
	const result = readImageMetadataV1(data);
	assert.equal(result.exif, null);
	assert.equal(result.iptc, null);
	assert.deepEqual(result.issues, []);
});

test('view offsets are respected and input bytes remain unchanged', () => {
	const original = jpegFixture(jpegExif(cameraFixture()));
	const backing = joinBytes(new Uint8Array(17), original, new Uint8Array(13));
	const snapshot = backing.slice();
	assert.deepEqual(readImageMetadataV1(new Uint8Array(backing.buffer, 17, original.length)), readImageMetadataV1(original));
	assert.deepEqual(backing, snapshot);
});

test('foreign, shared, detached, resizable and accessor-shadowed byte views are refused without getters', () => {
	let calls = 0;
	const bytes = cameraFixture();
	Object.defineProperty(bytes, 'byteLength', { get() { calls++; throw new Error('getter invoked'); } });
	const fake = { get buffer() { calls++; throw new Error('getter invoked'); } };
	const detached = new Uint8Array(8); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	const ResizableArrayBuffer = ArrayBuffer as new (size: number, options: { maxByteLength: number }) => ArrayBuffer;
	for (const input of [fake, bytes, detached, new Uint8Array(new SharedArrayBuffer(8)),
		new Uint8Array(new ResizableArrayBuffer(8, { maxByteLength: 16 })), new Uint16Array(8)]) {
		assert.throws(() => readImageMetadataV1(input), TypeError);
	}
	assert.equal(calls, 0);
	assert.throws(() => readImageMetadataV1(new Uint8Array(IMAGE_METADATA_LIMITS_V1.maximumInputBytes + 1)), RangeError);
});

test('container and IFD work budgets stop otherwise bounded hostile inputs', () => {
	const segments = Array.from({ length: IMAGE_METADATA_LIMITS_V1.maximumContainerRecords + 1 }, () => jpegSegment(0xe0, new Uint8Array()));
	assert.ok(readImageMetadataV1(jpegFixture(...segments)).issues.includes('metadata-limit'));
	const tiff = tiffFixture([]);
	new DataView(tiff.buffer).setUint16(8, IMAGE_METADATA_LIMITS_V1.maximumIfdEntries + 1, true);
	assert.ok(readImageMetadataV1(tiff).issues.includes('metadata-limit'));
});

test('metadata bytes, IFD chains, strings and IPTC repetitions have independent work ceilings', () => {
	const largeExif = pngFixture(pngChunk('eXIf', new Uint8Array(IMAGE_METADATA_LIMITS_V1.maximumMetadataBytes + 1)));
	assert.deepEqual(readImageMetadataV1(largeExif).issues, ['metadata-limit']);
	const directories = IMAGE_METADATA_LIMITS_V1.maximumIfdDirectories + 1;
	const chain = new Uint8Array(8 + directories * 6);
	chain.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
	const view = new DataView(chain.buffer);
	for (let index = 0; index < directories - 1; index++) view.setUint32(10 + index * 6, 8 + (index + 1) * 6, true);
	assert.deepEqual(readImageMetadataV1(chain).issues, ['metadata-limit']);
	assert.deepEqual(readImageMetadataV1(tiffFixture([textEntry(0x010f, 'x'.repeat(IMAGE_METADATA_LIMITS_V1.maximumStringBytes))])).issues,
		['metadata-limit']);
	const repeats = Array.from({ length: IMAGE_METADATA_LIMITS_V1.maximumRepeatedValues + 1 }, () => iptcText(25, 'x'));
	assert.deepEqual(readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(...repeats)))).issues, ['metadata-limit']);
	const datasets = Array.from({ length: IMAGE_METADATA_LIMITS_V1.maximumIptcDataSets + 1 }, () => iptcDataSet(2, 200, new Uint8Array()));
	assert.deepEqual(readImageMetadataV1(jpegFixture(photoshopIptc(joinBytes(...datasets)))).issues, ['metadata-limit']);
});

test('deterministic random, truncation and mutation corpus cannot throw, over-read or hang', { timeout: 10_000 }, () => {
	const seeds = [cameraFixture(), cameraFixture(false), jpegFixture(jpegExif(cameraFixture())),
		jpegFixture(photoshopIptc(iptcText(5, 'Title'))), pngFixture(pngChunk('eXIf', cameraFixture()))];
	let state = 0x5eed;
	const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
	for (const seed of seeds) {
		for (let size = 0; size < seed.length; size++) assert.doesNotThrow(() => readImageMetadataV1(seed.slice(0, size)));
		for (let mutation = 0; mutation < 400; mutation++) {
			const bytes = seed.slice();
			for (let edit = 0; edit < 4; edit++) bytes[random() % bytes.length] = random() & 255;
			assert.doesNotThrow(() => readImageMetadataV1(bytes));
		}
	}
	for (let run = 0; run < 2_000; run++) {
		const bytes = Uint8Array.from({ length: random() % 1_024 }, () => random() & 255);
		assert.doesNotThrow(() => readImageMetadataV1(bytes));
	}
});
