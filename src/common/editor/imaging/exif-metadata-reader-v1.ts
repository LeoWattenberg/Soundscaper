/* SPDX-License-Identifier: AGPL-3.0-only */

import { failMetadata } from './image-metadata-binary.ts';
import { visitExifEntriesV1 } from './exif-entry-traversal-v1.ts';
import { readExifCaptureTimeV1 } from './exif-capture-time-v1.ts';
import { IMAGE_METADATA_LIMITS_V1, type ImageExifMetadataV1 } from './image-metadata-model-v1.ts';

// Classic TIFF IFD layout and Exif tag types: CIPA DC-008, not a RAW admission rule.
// https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf
const ROOT_TEXT = new Map<number, 'cameraMake' | 'cameraModel' | 'artist' | 'copyright' | 'description'>([[0x010f, 'cameraMake'], [0x0110, 'cameraModel'], [0x013b, 'artist'],
	[0x8298, 'copyright'], [0x010e, 'description']] as const);
const EXIF_TEXT = new Map<number, 'lensModel'>([[0xa434, 'lensModel']]);
const EXIF_RATIONAL = new Map<number, 'exposureSeconds' | 'aperture' | 'focalLengthMm'>([[0x829a, 'exposureSeconds'], [0x829d, 'aperture'], [0x920a, 'focalLengthMm']]);

export function readExifMetadataV1(bytes: Uint8Array): Readonly<ImageExifMetadataV1> {
	const result = { orientation: null, cameraMake: null, cameraModel: null, lensModel: null,
		artist: null, copyright: null, description: null, exposureSeconds: null, aperture: null,
		iso: null, focalLengthMm: null, captureTime: null, captureTimeRaw: null } as {
		-readonly [K in keyof ImageExifMetadataV1]: ImageExifMetadataV1[K];
	};
	let date: string | null = null;
	let offsetTime: string | null = null;
	let subsecond: string | null = null;
	visitExifEntriesV1(bytes, (entry, view, little) => {
		const { tag, type, count: samples, dataOffset, byteLength: length, scope } = entry;
		const requireType = (expected: number, expectedCount = 1) => {
			if (type !== expected || samples !== expectedCount) failMetadata('malformed-exif');
		};
		if (scope !== 'root' && scope !== 'exif') return;
		const textField = scope === 'root' ? ROOT_TEXT.get(tag) : EXIF_TEXT.get(tag);
		if (textField) {
			if (type !== 2) failMetadata('malformed-exif');
			result[textField] = readAscii(bytes.subarray(dataOffset, dataOffset + length), textField === 'copyright');
		} else if (scope === 'root' && tag === 0x0112) {
			requireType(3);
			const orientation = view.getUint16(dataOffset, little);
			if (orientation < 1 || orientation > 8) failMetadata('malformed-exif');
			result.orientation = orientation;
		} else if (scope === 'exif') {
			const rational = EXIF_RATIONAL.get(tag);
			if (rational) {
				requireType(5);
				const denominator = view.getUint32(dataOffset + 4, little);
				if (denominator === 0) failMetadata('malformed-exif');
				result[rational] = view.getUint32(dataOffset, little) / denominator;
			} else if (tag === 0x8827 || tag === 0x8833) {
				requireType(tag === 0x8827 ? 3 : 4);
				const iso = type === 3 ? view.getUint16(dataOffset, little) : view.getUint32(dataOffset, little);
				if (iso === 0) failMetadata('malformed-exif');
				if (tag === 0x8833 || result.iso === null) result.iso = iso;
			} else if (tag === 0x9003 || tag === 0x9011 || tag === 0x9291) {
				if (type !== 2) failMetadata('malformed-exif');
				const text = readAscii(bytes.subarray(dataOffset, dataOffset + length));
				if (tag === 0x9003) date = text;
				if (tag === 0x9011) offsetTime = text;
				if (tag === 0x9291) subsecond = text;
			}
		}
	});
	if (date !== null) {
		result.captureTime = readExifCaptureTimeV1(date, offsetTime, subsecond);
		result.captureTimeRaw = Object.freeze({ dateTimeOriginal: date, offsetTimeOriginal: offsetTime, subsecondOriginal: subsecond });
	}
	else if (offsetTime !== null || subsecond !== null) failMetadata('malformed-exif');
	return Object.freeze(result);
}

function readAscii(bytes: Uint8Array, copyright = false): string {
	if (bytes.length > IMAGE_METADATA_LIMITS_V1.maximumStringBytes) failMetadata('metadata-limit');
	if (bytes[bytes.length - 1] !== 0) failMetadata('malformed-exif');
	let text = '';
	let separators = 0;
	for (let index = 0; index < bytes.length - 1; index++) {
		const byte = bytes[index] ?? 0;
		if (byte === 0 && copyright && ++separators === 1) { text += '\n'; continue; }
		if (byte === 0 || byte >= 127 || byte < 32 && byte !== 10 && byte !== 13) failMetadata('unsupported-text-encoding');
		text += String.fromCharCode(byte);
	}
	return text;
}
