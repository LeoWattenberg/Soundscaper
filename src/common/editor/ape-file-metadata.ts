/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioMetadataComments, little32, metadataBytes } from './audio-metadata-values.ts';
import { decodeArtworkData, parseId3Artwork } from './id3-artwork.ts';

/** APEv2 size includes items and footer, while its optional header is excluded. */
export function createApeFileMetadata(metadata: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const entries = audioMetadataComments(metadata).map(comment => {
		const separator = comment.indexOf('=');
		return item(comment.slice(0, separator), encoder.encode(comment.slice(separator + 1)), false);
	});
	const pictureNames = new Map<string, number>();
	for (const picture of parseId3Artwork(metadata.id3Artwork)) {
		const kind = picture.pictureType === 3 ? 'Front' : picture.pictureType === 4 ? 'Back' : `Type ${picture.pictureType}`;
		const count = (pictureNames.get(kind) ?? 0) + 1;
		pictureNames.set(kind, count);
		const name = `Cover Art (${kind})${count > 1 ? ` ${count}` : ''}`;
		entries.push(item(name, metadataBytes(encoder.encode(picture.description || `cover.${picture.mimeType === 'image/png' ? 'png' : 'jpg'}`), Uint8Array.of(0), decodeArtworkData(picture.data)), true));
	}
	if (!entries.length) return new Uint8Array();
	const body = metadataBytes(...entries);
	const record = (header: boolean): Uint8Array<ArrayBuffer> => metadataBytes(encoder.encode('APETAGEX'), little32(2000),
		little32(body.length + 32), little32(entries.length), little32(header ? 0xa000_0000 : 0x8000_0000), new Uint8Array(8));
	return metadataBytes(record(true), body, record(false));

	function item(key: string, value: Uint8Array, binary: boolean): Uint8Array<ArrayBuffer> {
		if (key.length < 2 || key.length > 255 || ['ID3', 'TAG', 'OGGS', 'MP+'].includes(key.toUpperCase())) throw new RangeError(`Invalid APEv2 field name: ${key}.`);
		return metadataBytes(little32(value.length), little32(binary ? 2 : 0), encoder.encode(key), Uint8Array.of(0), value);
	}
}
