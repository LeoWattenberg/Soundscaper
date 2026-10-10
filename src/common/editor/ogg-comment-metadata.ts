/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioMetadataComments, artworkComments, metadataBlobBytes, metadataBytes, vorbisCommentBytes } from './audio-metadata-values.ts';
import { oggPageCrc } from './ogg-page-crc.ts';

interface OggPage {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly end: number;
	readonly serial: number;
	readonly sequence: number;
	readonly laces: Uint8Array;
	readonly body: Uint8Array;
}

/** Replace the comment packet; retain audio packet boundaries, granules and bytes. */
export async function writeOggFileMetadata(blob: Blob, format: 'opus' | 'ogg-vorbis', metadata: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<Blob> {
	const first = await readPage(blob, 0, signal);
	if (first.sequence !== 0 || first.bytes[5] !== 2 || first.laces.at(-1) === 255) throw new RangeError('Invalid Ogg identification page.');
	const signature = format === 'opus' ? 'OpusHead' : '\u0001vorbis';
	if (new TextDecoder().decode(first.body.subarray(0, signature.length)) !== signature) throw new RangeError('The Ogg codec does not match its metadata plan.');
	let offset = first.end;
	let oldSequence = 1;
	let commentLength = 0;
	const oldComment: Uint8Array[] = [];
	let tail: OggPage | null = null;
	let tailLaceIndex = 0;
	let tailBodyOffset = 0;
	while (!tail) {
		const page = await readPage(blob, offset, signal);
		if (page.sequence !== oldSequence++ || page.serial !== first.serial
			|| Boolean(page.bytes[5]! & 1) !== (commentLength > 0)) throw new RangeError('Invalid continued Ogg comment page.');
		let bodyOffset = 0;
		for (const [index, length] of page.laces.entries()) {
			oldComment.push(page.body.subarray(bodyOffset, bodyOffset + length));
			commentLength += length;
			if (commentLength > 16 * 1024 ** 2) throw new RangeError('The Ogg comment header exceeds its bound.');
			bodyOffset += length;
			if (length < 255) { tail = page; tailLaceIndex = index + 1; tailBodyOffset = bodyOffset; break; }
		}
		offset = page.end;
	}
	const oldPacket = metadataBytes(...oldComment);
	const prefix = format === 'opus' ? 'OpusTags' : '\u0003vorbis';
	if (new TextDecoder().decode(oldPacket.subarray(0, prefix.length)) !== prefix) throw new RangeError('The Ogg comment packet is missing.');
	const vendorStart = prefix.length + 4;
	if (oldPacket.length < vendorStart) throw new RangeError('The Ogg vendor string is truncated.');
	const vendorLength = new DataView(oldPacket.buffer).getUint32(prefix.length, true);
	if (vendorLength > 65536 || vendorStart + vendorLength > oldPacket.length) throw new RangeError('The Ogg vendor string is invalid.');
	const vendor = new TextDecoder('utf-8', { fatal: true }).decode(oldPacket.subarray(vendorStart, vendorStart + vendorLength));
	const packet = metadataBytes(new TextEncoder().encode(prefix),
		vorbisCommentBytes([...audioMetadataComments(metadata), ...artworkComments(metadata)], vendor),
		...(format === 'ogg-vorbis' ? [Uint8Array.of(1)] : []));
	const parts: BlobPart[] = [blob.slice(0, first.end)];
	let sequence = 1;
	const laces = Array.from({ length: Math.floor(packet.length / 255) }, () => 255);
	laces.push(packet.length % 255);
	let packetOffset = 0;
	for (let laceOffset = 0; laceOffset < laces.length; laceOffset += 255) {
		const pageLaces = Uint8Array.from(laces.slice(laceOffset, laceOffset + 255));
		const length = pageLaces.reduce((sum, byte) => sum + byte, 0);
		const completed = laceOffset + pageLaces.length === laces.length;
		parts.push(makePage(first.serial, sequence++, laceOffset ? 1 : 0, completed ? 0n : 0xffff_ffff_ffff_ffffn,
			pageLaces, packet.subarray(packetOffset, packetOffset + length)));
		packetOffset += length;
	}
	if (tailLaceIndex < tail.laces.length) {
		const granule = new DataView(tail.bytes.buffer).getBigUint64(6, true);
		parts.push(makePage(first.serial, sequence++, tail.bytes[5]! & ~1, granule,
			tail.laces.subarray(tailLaceIndex), tail.body.subarray(tailBodyOffset)));
	}
	const delta = sequence - oldSequence;
	if (delta === 0) parts.push(blob.slice(offset));
	else while (offset < blob.size) {
		const page = await readPage(blob, offset, signal);
		if (page.serial !== first.serial || page.sequence !== oldSequence++) throw new RangeError('The Ogg stream sequence is invalid.');
		const view = new DataView(page.bytes.buffer);
		view.setUint32(18, sequence++, true);
		view.setUint32(22, oggPageCrc(page.bytes), true);
		parts.push(page.bytes.slice(0, 27), blob.slice(offset + 27, page.end));
		offset = page.end;
		if (sequence % 256 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
	}
	signal?.throwIfAborted();
	return new Blob(parts, { type: blob.type });
}

async function readPage(blob: Blob, offset: number, signal?: AbortSignal): Promise<OggPage> {
	const header = await metadataBlobBytes(blob, offset, offset + 27, signal);
	if (new TextDecoder().decode(header.subarray(0, 4)) !== 'OggS' || header[4] !== 0 || header[5]! & ~7) throw new RangeError('Invalid Ogg page header.');
	const laces = await metadataBlobBytes(blob, offset + 27, offset + 27 + header[26]!, signal);
	if (!laces.length) throw new RangeError('An Ogg page requires segments.');
	const end = offset + 27 + laces.length + laces.reduce((sum, byte) => sum + byte, 0);
	const bytes = await metadataBlobBytes(blob, offset, end, signal);
	const view = new DataView(bytes.buffer);
	if (view.getUint32(22, true) !== oggPageCrc(bytes)) throw new RangeError('The Ogg page checksum is invalid.');
	return { bytes, end, serial: view.getUint32(14, true), sequence: view.getUint32(18, true), laces, body: bytes.subarray(27 + laces.length) };
}

function makePage(serial: number, sequence: number, flags: number, granule: bigint, laces: Uint8Array, body: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = metadataBytes(new Uint8Array(27), laces, body);
	bytes.set(new TextEncoder().encode('OggS'));
	bytes[5] = flags;
	bytes[26] = laces.length;
	const view = new DataView(bytes.buffer);
	view.setBigUint64(6, granule, true);
	view.setUint32(14, serial, true);
	view.setUint32(18, sequence, true);
	view.setUint32(22, oggPageCrc(bytes), true);
	return bytes;
}
