/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { encodeImageExifTiffForColorSpaceV1, type ImageExifWriteOptionsV1 } from './exif-metadata-writer-kernel-v1.ts';

export interface ImageExifWriteProfileOptionsCurrentV1 extends ImageExifWriteOptionsV1 {
	readonly profile: 'srgb' | 'display-p3';
}

/** Exif 2.32 assigns ColorSpace=FFFF.H to a non-sRGB image. It does not
 * identify Display P3: the encoded PNG's authoritative cICP does that.
 * No DCF/ICC interoperability declaration or original opaque tag is copied.
 * https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf
 * https://www.w3.org/TR/png-3/#cICP-chunk */
export function encodeImageExifTiffProfileCurrentV1(value: unknown, options: unknown): Uint8Array<ArrayBuffer> | null {
	const input = record(options, 'Profiled Exif write options', ['scope', 'width', 'height', 'maximumOutputBytes', 'profile']);
	const profile = field(input, 'profile', 'Profiled Exif write options');
	if (profile !== 'srgb' && profile !== 'display-p3') throw new RangeError('Unsupported Exif output color profile.');
	return encodeImageExifTiffForColorSpaceV1(profile === 'srgb' ? 1 : 65535, value, {
		scope: field(input, 'scope', 'Profiled Exif write options'), width: field(input, 'width', 'Profiled Exif write options'),
		height: field(input, 'height', 'Profiled Exif write options'), maximumOutputBytes: field(input, 'maximumOutputBytes', 'Profiled Exif write options'),
	});
}
