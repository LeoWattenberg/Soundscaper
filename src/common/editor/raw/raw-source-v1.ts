/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMetadataInput } from '../imaging/image-metadata-binary.ts';
import { IMAGE_METADATA_LIMITS_V1 } from '../imaging/image-metadata-model-v1.ts';

export type RawSourceAdmissionV1 = Readonly<{
	format: 'dng'; mimeType: 'image/x-adobe-dng';
}> | Readonly<{ format: 'crw'; mimeType: 'image/x-canon-crw' }>;
export const RAW_SOURCE_FILE_ACCEPT_V1 = '.dng,.crw,image/x-adobe-dng,image/x-canon-crw';

/** Inverse of LibRaw 0.22.2 metadata/tiff.cpp's EXIF orientation mapping. */
export function rawFlipExifOrientationV1(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 7) throw new RangeError('RAW orientation requires a native flip scalar from zero through seven.');
	return [1, 2, 4, 3, 5, 8, 6, 7][value]!;
}

/** Probe only owned container declarations, never filenames, MIME hints or
 * embedded previews. The native decoder still owns actual RAW admission. */
export function probeRawSourceV1(value: unknown): RawSourceAdmissionV1 | null {
	const bytes = readMetadataInput(value);
	if (bytes.length < 8) return null;
	const little = bytes[0] === 0x49 && bytes[1] === 0x49;
	if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length >= 14 && [72, 69, 65, 80, 67, 67, 68, 82].every((byte, at) => bytes[6 + at] === byte)) {
		const header = view.getUint32(2, little);
		if (header < 14 || header >= bytes.length) throw new RangeError('RAW CIFF header exceeds its container.');
		return Object.freeze({ format: 'crw', mimeType: 'image/x-canon-crw' });
	}
	if (view.getUint16(2, little) !== 42) return null;
	const directory = view.getUint32(4, little);
	if (directory < 8 || directory > bytes.length - 2) throw new RangeError('RAW TIFF directory exceeds its container.');
	const count = view.getUint16(directory, little);
	if (count > IMAGE_METADATA_LIMITS_V1.maximumIfdEntries || count * 12 + 6 > bytes.length - directory) {
		throw new RangeError('RAW TIFF directory exceeds its bounded metadata profile.');
	}
	let dng = false;
	for (let index = 0; index < count; index++) {
		const entry = directory + 2 + index * 12;
		if (view.getUint16(entry, little) !== 50706) continue;
		if (dng || view.getUint16(entry + 2, little) !== 1 || view.getUint32(entry + 4, little) !== 4 || bytes[entry + 8] !== 1) {
			throw new RangeError('RAW DNG requires one supported DNGVersion declaration.');
		}
		dng = true;
	}
	return dng ? Object.freeze({ format: 'dng', mimeType: 'image/x-adobe-dng' }) : null;
}
