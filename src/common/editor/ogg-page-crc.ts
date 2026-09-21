/* SPDX-License-Identifier: AGPL-3.0-only */

const OGG_CRC_TABLE = createOggCrcTable();

/** Compute an Ogg page checksum with the on-page checksum field treated as zero. */
export function oggPageCrc(page: Uint8Array): number {
	let crc = 0;
	for (const [index, sourceByte] of page.entries()) {
		const byte = index >= 22 && index < 26 ? 0 : sourceByte;
		const tableValue = OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 255];
		if (tableValue === undefined) throw new Error('The Ogg CRC lookup table is incomplete.');
		crc = ((crc << 8) ^ tableValue) >>> 0;
	}
	return crc;
}

function createOggCrcTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index << 24;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 0x8000_0000 ? (value << 1) ^ 0x04c1_1db7 : value << 1;
		}
		table[index] = value >>> 0;
	}
	return table;
}
