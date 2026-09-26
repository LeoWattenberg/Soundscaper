/* SPDX-License-Identifier: AGPL-3.0-only */

export interface Mp3GaplessGeometry {
	readonly sampleRate: number;
	readonly encodedFrames: number;
	readonly sourceFrames: number;
	readonly leadingFrames: number;
}

/** Read the Xing/LAME geometry without reading the compressed original into memory. */
export async function inspectMp3GaplessGeometry(file: Blob): Promise<Mp3GaplessGeometry | null> {
	const prefix = new Uint8Array(await file.slice(0, 10).arrayBuffer());
	let offset = 0;
	if (text(prefix, 0, 3) === 'ID3') {
		if (prefix.length !== 10 || prefix.subarray(6, 10).some((byte) => byte > 127)) return null;
		offset = 10 + ((prefix[6]! << 21) | (prefix[7]! << 14) | (prefix[8]! << 7) | prefix[9]!);
		if (prefix[5]! & 16) offset += 10;
	}
	const header = new Uint8Array(await file.slice(offset, offset + 4096).arrayBuffer());
	if (header.length < 4 || header[0] !== 255 || (header[1]! & 224) !== 224) return null;
	const version = (header[1]! >> 3) & 3;
	if (version === 1 || ((header[1]! >> 1) & 3) !== 1) return null;
	const rateIndex = (header[2]! >> 2) & 3;
	if (rateIndex === 3) return null;
	const sampleRate = [44_100, 48_000, 32_000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
	const mono = (header[3]! >> 6) === 3;
	let xing = 4 + (version === 3 ? mono ? 17 : 32 : mono ? 9 : 17);
	// Some CRC-protected streams place Xing after the two CRC bytes, while
	// LAME keeps it at the usual side-info offset even when CRC is present.
	if (!(header[1]! & 1) && !['Xing', 'Info'].includes(text(header, xing, 4))
		&& ['Xing', 'Info'].includes(text(header, xing + 2, 4))) xing += 2;
	if (!['Xing', 'Info'].includes(text(header, xing, 4)) || header.length < xing + 12) return null;
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const flags = view.getUint32(xing + 4);
	if (!(flags & 1) || flags & ~15) return null;
	const packetCount = view.getUint32(xing + 8);
	let lame = xing + 8;
	for (const [flag, bytes] of [[1, 4], [2, 4], [4, 100], [8, 4]] as const) if (flags & flag) lame += bytes;
	if (header.length < lame + 24 || text(header, lame, 4) !== 'LAME') return null;
	const delay = (header[lame + 21]! << 4) | (header[lame + 22]! >> 4);
	const padding = ((header[lame + 22]! & 15) << 8) | header[lame + 23]!;
	// libmpg123's pinned frame.h declares GAPLESS_DELAY=529 for Layer III synthesis.
	const leadingFrames = delay + 529;
	const encodedFrames = packetCount * (version === 3 ? 1152 : 576);
	const sourceFrames = encodedFrames - delay - padding;
	if (packetCount < 1 || sourceFrames < 1 || padding < 529 || leadingFrames >= encodedFrames) return null;
	return Object.freeze({ sampleRate, encodedFrames, sourceFrames, leadingFrames });
}

function text(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
