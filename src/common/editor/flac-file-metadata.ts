/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioMetadataComments, flacPictureBytes, metadataBlobBytes, vorbisCommentBytes } from './audio-metadata-values.ts';
import { parseId3Artwork } from './id3-artwork.ts';

export async function writeFlacFileMetadata(blob: Blob, metadata: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<Blob> {
	const marker = await metadataBlobBytes(blob, 0, 4, signal);
	if (new TextDecoder().decode(marker) !== 'fLaC') throw new RangeError('The FLAC marker is missing.');
	const blocks: Readonly<{ type: number; body: Blob | Uint8Array<ArrayBuffer> }>[] = [];
	let offset = 4;
	let last = false;
	let count = 0;
	while (!last) {
		if (++count > 128 || offset > 16 * 1024 ** 2) throw new RangeError('The FLAC metadata exceeds its bound.');
		const header = await metadataBlobBytes(blob, offset, offset + 4, signal);
		last = Boolean(header[0]! & 128);
		const type = header[0]! & 127;
		const length = header[1]! * 65536 + header[2]! * 256 + header[3]!;
		if (offset + 4 + length > blob.size || type === 127 || count === 1 && (type !== 0 || length !== 34)
			|| count > 1 && type === 0) throw new RangeError('Invalid FLAC metadata block.');
		if (type !== 4 && type !== 6 && type !== 1) blocks.push({ type, body: blob.slice(offset + 4, offset + 4 + length) });
		offset += 4 + length;
	}
	if (offset >= blob.size) throw new RangeError('The FLAC file has no audio frames.');
	blocks.push({ type: 4, body: vorbisCommentBytes(audioMetadataComments(metadata)) });
	for (const picture of parseId3Artwork(metadata.id3Artwork)) blocks.push({ type: 6, body: flacPictureBytes(picture) });
	const parts: BlobPart[] = [marker];
	for (const [index, block] of blocks.entries()) {
		const length = block.body instanceof Blob ? block.body.size : block.body.length;
		if (length > 0xff_ffff) throw new RangeError('The FLAC metadata block is too large.');
		parts.push(Uint8Array.of(block.type | (index === blocks.length - 1 ? 128 : 0), length >>> 16, length >>> 8, length), block.body);
	}
	parts.push(blob.slice(offset));
	return new Blob(parts, { type: blob.type });
}
