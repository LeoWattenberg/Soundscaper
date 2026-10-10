/* SPDX-License-Identifier: AGPL-3.0-only */

import { decodeArtworkData, parseId3Artwork, type Id3Artwork } from './id3-artwork.ts';

const encoder = new TextEncoder();
const COMMENT_NAMES: Readonly<Record<string, string>> = Object.freeze({
	title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', albumartist: 'ALBUMARTIST', track: 'TRACKNUMBER',
	tracknumber: 'TRACKNUMBER', disc: 'DISCNUMBER', discnumber: 'DISCNUMBER', year: 'DATE', date: 'DATE',
	comments: 'COMMENT', comment: 'COMMENT', genre: 'GENRE', copyright: 'COPYRIGHT', publisher: 'ORGANIZATION',
	composer: 'COMPOSER', lyricist: 'LYRICIST', lyrics: 'LYRICS', isrc: 'ISRC', bpm: 'BPM',
	initialkey: 'INITIALKEY', grouping: 'GROUPING', mood: 'MOOD', language: 'LANGUAGE',
	trackstotal: 'TRACKTOTAL', discstotal: 'DISCTOTAL',
});

/** Vorbis-style field names are ASCII; values retain their exact UTF-8 text. */
export function audioMetadataComments(metadata: Readonly<Record<string, string>>): readonly string[] {
	const values = new Map<string, string>();
	for (const [key, value] of Object.entries(metadata)) {
		if (key === 'id3Artwork') continue;
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
		const name = COMMENT_NAMES[normalized] ?? key.toUpperCase();
		if (normalized === 'year' && metadata.date) continue;
		if (name === 'TRACKNUMBER' || name === 'DISCNUMBER') {
			const pair = /^(\d+)\/(\d+)$/u.exec(value);
			if (pair) { values.set(name, pair[1]!); values.set(name === 'TRACKNUMBER' ? 'TRACKTOTAL' : 'DISCTOTAL', pair[2]!); continue; }
		}
		values.set(name, value);
	}
	return [...values].map(([name, value]) => `${name}=${value}`);
}

export function vorbisCommentBytes(comments: readonly string[], vendor = 'Soundscaper'): Uint8Array<ArrayBuffer> {
	const entries = comments.map(value => encoder.encode(value));
	const vendorBytes = encoder.encode(vendor);
	return metadataBytes(little32(vendorBytes.length), vendorBytes, little32(entries.length),
		...entries.flatMap(bytes => [little32(bytes.length), bytes]));
}

/** FLAC PICTURE blocks also carry artwork in Ogg's METADATA_BLOCK_PICTURE field. */
export function flacPictureBytes(picture: Id3Artwork): Uint8Array<ArrayBuffer> {
	const bytes = decodeArtworkData(picture.data);
	const mime = encoder.encode(picture.mimeType);
	const description = encoder.encode(picture.description);
	const size = pictureDimensions(bytes, picture.mimeType);
	return metadataBytes(big32(picture.pictureType), big32(mime.length), mime,
		big32(description.length), description, big32(size.width), big32(size.height), big32(size.depth), big32(0), big32(bytes.length), bytes);
}

export function artworkComments(metadata: Readonly<Record<string, string>>): readonly string[] {
	return parseId3Artwork(metadata.id3Artwork).map(picture => {
		const bytes = flacPictureBytes(picture);
		let binary = '';
		for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
		return `METADATA_BLOCK_PICTURE=${btoa(binary)}`;
	});
}

export function metadataBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0));
	let offset = 0;
	for (const bytes of parts) { result.set(bytes, offset); offset += bytes.length; }
	return result;
}
export function little32(value: number): Uint8Array<ArrayBuffer> { return uint32(value, true); }
export function big32(value: number): Uint8Array<ArrayBuffer> { return uint32(value, false); }
function uint32(value: number, littleEndian: boolean): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, littleEndian);
	return bytes;
}

export async function metadataBlobBytes(blob: Blob, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	signal?.throwIfAborted();
	if (end > blob.size || start < 0 || end < start) throw new RangeError('The metadata container is truncated.');
	const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
	signal?.throwIfAborted();
	return bytes;
}

function pictureDimensions(bytes: Uint8Array, mime: string): Readonly<{ width: number; height: number; depth: number }> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (mime === 'image/png' && bytes.length >= 29) {
		const channels: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
		return { width: view.getUint32(16), height: view.getUint32(20), depth: bytes[24]! * (channels[bytes[25]!] ?? 1) };
	}
	if (mime === 'image/jpeg') {
		for (let offset = 2; offset + 4 < bytes.length;) {
			if (bytes[offset++] !== 255) break;
			while (bytes[offset] === 255) offset++;
			const marker = bytes[offset++]!;
			if (marker === 217 || marker === 218) break;
			if (marker === 0 || marker === 1 || marker >= 208 && marker <= 215) continue;
			if (offset + 2 > bytes.length) break;
			const length = view.getUint16(offset);
			if (length < 2 || offset + length > bytes.length) break;
			if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
				return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), depth: bytes[offset + 2]! * bytes[offset + 7]! };
			}
			offset += length;
		}
	}
	return { width: 0, height: 0, depth: 0 };
}
