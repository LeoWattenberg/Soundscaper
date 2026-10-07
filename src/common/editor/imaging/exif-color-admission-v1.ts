/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMetadataInput } from './image-metadata-binary.ts';
import { visitExifEntriesV1 } from './exif-entry-traversal-v1.ts';

/** Inspect Exif/DCF color declarations (CIPA DC-008) without changing descriptive extraction. */
export function admitExifSrgbDeclarationsV1(value: unknown): void {
	const bytes = readMetadataInput(value);
	visitExifEntriesV1(bytes, (entry, view, little) => {
		const { scope, tag, type, count, dataOffset, byteLength } = entry;
		if (scope === 'exif' && tag === 0xa001
			&& (type !== 3 || count !== 1 || view.getUint16(dataOffset, little) !== 1)) refuse();
		if (scope === 'exif' && tag === 0xa500 || tag === 0x8773) refuse();
		if (scope === 'interop' && tag === 1
			&& (type !== 2 || byteLength !== 4 || bytes[dataOffset] !== 82 || bytes[dataOffset + 1] !== 57 || bytes[dataOffset + 2] !== 56 || bytes[dataOffset + 3] !== 0)) refuse();
	});
}

function refuse(): never { throw new RangeError('Exif colour declaration is not admitted by the sRGB route.'); }
