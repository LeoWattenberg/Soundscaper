/* SPDX-License-Identifier: AGPL-3.0-only */

import { iptcDataSet, iptcText, joinBytes, jpegExif, numberEntry, photoshopIptc, rationalEntry,
	textEntry, tiffFixture, type TiffEntryFixture } from './image-metadata-fixtures.ts';

// Node-only APP1/APP13 preparation: seven cases, <=8KiB added metadata/case,
// <=256KiB UTF8 wire payload. The browser imports this contract type-only.
export interface PhotoMetadataQueryByteCaseV1 {
	readonly id: string;
	readonly fileName: string;
	readonly appSegments: readonly (readonly number[])[];
	readonly duplicateOf: string | null;
}
export interface PhotoMetadataQueryByteFixtureV1 {
	readonly schemaVersion: 1;
	readonly cases: readonly PhotoMetadataQueryByteCaseV1[];
}

/** Metadata segments only; the native browser encoder supplies genuine JPEG pixels. */
export function createPhotoMetadataQueryByteFixtureV1(): PhotoMetadataQueryByteFixtureV1 {
	const cases = [
		entry('complete-canon', 'Canon source.jpg', [complete('Canon', 'EOS R5', 'RF 24-70mm F2.8', 200, 125, 28, 50, '+02:00')]),
		entry('complete-nikon', 'Nikon source.jpg', [complete('Nikon', 'Z8', 'NIKKOR Z 85mm F1.8', 800, 60, 56, 85, '-04:30')]),
		entry('source-conflict', 'Conflicting sources.jpg', [exif([
			textEntry(0x010f, 'Canon'), textEntry(0x0110, 'Source conflict'), textEntry(0x013b, 'Exif creator'),
			textEntry(0x010e, 'Exif caption'), textEntry(0x8298, 'Exif copyright'),
		], [textEntry(0xa434, 'Source conflict lens'), textEntry(0x9003, '2026:10:07 12:34:56'),
			textEntry(0x9011, '+02:00')]), photoshopIptc(joinBytes(
			iptcDataSet(1, 90, Uint8Array.of(27, 37, 71)), iptcText(5, 'IPTC title'), iptcText(105, 'IPTC headline'),
			iptcText(120, 'IPTC caption'), iptcText(116, 'IPTC copyright'), iptcText(80, 'IPTC Alice'), iptcText(80, 'IPTC Bob'),
			iptcText(25, 'Landscape'), iptcText(25, 'Portrait'), iptcText(25, 'Landscape'),
			iptcText(90, 'München'), iptcText(92, 'Englischer Garten'), iptcText(101, 'Germany'),
			iptcText(55, '20241007'), iptcText(60, '010203-0430'),
		))]),
		entry('partial-capture', 'Partial capture.jpg', [exif([textEntry(0x010f, 'Partial camera')], [
			textEntry(0x9003, '    :02:29 13:14:15'), textEntry(0x9011, '   :  '), textEntry(0x9291, '123456'),
		])]),
		entry('oversized-camera', 'Oversized camera.jpg', [exif([
			textEntry(0x010f, 'A'.repeat(1_025)), textEntry(0x0110, 'Valid model'),
		], [textEntry(0xa434, 'Valid lens')])]),
		entry('no-metadata', 'No metadata.jpg', []),
		entry('exact-duplicate', 'Canon duplicate.jpg', [], 'complete-canon'),
	];
	const result = Object.freeze({ schemaVersion: 1 as const, cases: Object.freeze(cases) });
	if (new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1_024) throw new RangeError('Metadata fixture payload exceeds 256KiB.');
	return result;
}

function complete(make: string, model: string, lens: string, iso: number, shutter: number,
	apertureTenths: number, focal: number, offset: string): Uint8Array {
	return exif([textEntry(0x010f, make), textEntry(0x0110, model)], [
		textEntry(0xa434, lens), textEntry(0x9003, '2026:10:07 12:34:56'), textEntry(0x9011, offset), textEntry(0x9291, '125'),
		rationalEntry(0x829a, 1, shutter), rationalEntry(0x829d, apertureTenths, 10), numberEntry(0x8827, iso), rationalEntry(0x920a, focal, 1),
	]);
}

function exif(root: readonly TiffEntryFixture[], fields: readonly TiffEntryFixture[]): Uint8Array {
	return jpegExif(tiffFixture([numberEntry(0x0112, 1), ...root], [numberEntry(0xa001, 1), ...fields]));
}

function entry(id: string, fileName: string, segments: readonly Uint8Array[], duplicateOf: string | null = null): PhotoMetadataQueryByteCaseV1 {
	if (segments.reduce((size, segment) => size + segment.length, 0) > 8 * 1_024) throw new RangeError('Metadata fixture segments exceed 8KiB.');
	return Object.freeze({ id, fileName, appSegments: Object.freeze(segments.map(segment => Object.freeze(Array.from(segment)))), duplicateOf });
}
