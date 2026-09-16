/* SPDX-License-Identifier: AGPL-3.0-only */

export interface OggGaplessGeometry {
	readonly sampleRate: number;
	readonly sourceFrames: number;
}

const MAXIMUM_PAGE_BYTES = 65_307;

/** The final Ogg granule, rather than the full last codec packet, ends the source. */
export async function inspectOggGaplessGeometry(file: Blob, codec: 'opus' | 'vorbis'): Promise<OggGaplessGeometry | null> {
	const header = new Uint8Array(await file.slice(0, 27).arrayBuffer());
	if (header.length !== 27 || ascii(header, 0, 4) !== 'OggS' || header[4] || (header[5]! & 3) !== 2) return null;
	const first = new Uint8Array(await file.slice(0, MAXIMUM_PAGE_BYTES).arrayBuffer());
	const bodyOffset = 27 + header[26]!;
	if (bodyOffset > first.length) return null;
	const firstSize = pageSize(first, 0);
	if (!firstSize) return null;
	verifyPageChecksum(first.subarray(0, firstSize));
	const body = first.subarray(bodyOffset, firstSize);
	let preSkip = 0;
	let sampleRate = 48_000;
	if (codec === 'opus') {
		if (body.length < 19 || ascii(body, 0, 8) !== 'OpusHead') return null;
		preSkip = body[10]! | (body[11]! << 8);
	} else {
		if (body.length < 30 || body[0] !== 1 || ascii(body, 1, 6) !== 'vorbis') return null;
		sampleRate = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(12, true);
	}
	const serial = new DataView(first.buffer).getUint32(14, true);
	const tail = new Uint8Array(await file.slice(Math.max(0, file.size - MAXIMUM_PAGE_BYTES * 2)).arrayBuffer());
	for (let offset = tail.length - 27; offset >= 0; offset -= 1) {
		if (ascii(tail, offset, 4) !== 'OggS' || tail[offset + 4] || !(tail[offset + 5]! & 4)) continue;
		const size = pageSize(tail, offset);
		if (!size) continue;
		const view = new DataView(tail.buffer, tail.byteOffset + offset, size);
		if (view.getUint32(14, true) !== serial) continue;
		verifyPageChecksum(tail.subarray(offset, offset + size));
		const granule = view.getBigUint64(6, true);
		if (granule > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The Ogg source granule exceeds the safe range.');
		const sourceFrames = Number(granule) - preSkip;
		if (sourceFrames < 1 || sampleRate < 1) throw new Error('The Ogg source declares empty gapless geometry.');
		return Object.freeze({ sampleRate, sourceFrames });
	}
	throw new Error('The Ogg audio source has no final granule for its primary stream.');
}

function pageSize(bytes: Uint8Array, offset: number): number {
	const segments = bytes[offset + 26]!;
	if (offset + 27 + segments > bytes.length) return 0;
	let size = 27 + segments;
	for (let index = 0; index < segments; index += 1) size += bytes[offset + 27 + index]!;
	return offset + size <= bytes.length ? size : 0;
}

function verifyPageChecksum(page: Uint8Array): void {
	let checksum = 0;
	for (let index = 0; index < page.length; index += 1) {
		checksum ^= (index >= 22 && index < 26 ? 0 : page[index]!) << 24;
		for (let bit = 0; bit < 8; bit += 1) checksum = (checksum << 1) ^ (checksum & 0x8000_0000 ? 0x04c1_1db7 : 0);
	}
	if ((checksum >>> 0) !== new DataView(page.buffer, page.byteOffset, page.byteLength).getUint32(22, true)) {
		throw new Error('The Ogg source page checksum failed.');
	}
}

function ascii(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
