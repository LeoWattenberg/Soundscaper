/* SPDX-License-Identifier: AGPL-3.0-only */

import { deflateSync } from 'node:zlib';

const CRC32_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
}));

export function createPngFixture(size) {
	if (!Number.isSafeInteger(size) || size < 1 || size > 1_024) {
		throw new RangeError('The PNG fixture size is invalid.');
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.set([8, 6, 0, 0, 0], 8);
	const scanlines = Buffer.alloc((size * 4 + 1) * size);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(scanlines)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function chunk(type, data) {
	const name = Buffer.from(type, 'ascii');
	const bytes = Buffer.alloc(12 + data.byteLength);
	bytes.writeUInt32BE(data.byteLength, 0);
	name.copy(bytes, 4);
	data.copy(bytes, 8);
	bytes.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.byteLength);
	return bytes;
}

function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}
