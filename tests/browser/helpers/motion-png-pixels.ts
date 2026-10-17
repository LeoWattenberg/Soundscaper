/* SPDX-License-Identifier: AGPL-3.0-only */
import { crc32, inflateSync } from 'node:zlib';

const MAXIMUM_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PIXELS = 4 * 1024 * 1024;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Independent test-only PNG decoding: preserve straight channel bytes before browser presentation. */
export function decodeMotionPngPixels(input: Uint8Array): Readonly<{ width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }> {
	if (input.byteLength < 8 || input.byteLength > MAXIMUM_BYTES) throw new RangeError('PNG fixture byte admission failed.');
	const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Invalid PNG signature.');
	let width = 0; let height = 0; let ended = false; let dataEnded = false; let chunkCount = 0;
	const chunks: Uint8Array[] = [];
	for (let offset = 8; offset < bytes.length;) {
		if (ended) throw new Error('PNG contains trailing bytes.');
		if (++chunkCount > 4096) throw new RangeError('PNG fixture chunk admission failed.');
		if (bytes.length - offset < 12) throw new Error('Truncated PNG chunk.');
		const length = bytes.readUInt32BE(offset);
		if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk body.');
		const type = bytes.toString('latin1', offset + 4, offset + 8);
		if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(type)) throw new Error('Invalid PNG chunk type.');
		const body = bytes.subarray(offset + 8, offset + 8 + length);
		if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('PNG chunk CRC differs.');
		if (offset === 8 && type !== 'IHDR') throw new Error('PNG must begin with its header.');
		if (type === 'IHDR') {
			if (offset !== 8 || length !== 13) throw new Error('Invalid PNG header.');
			width = body.readUInt32BE(0); height = body.readUInt32BE(4);
			if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > MAXIMUM_PIXELS) throw new RangeError('PNG fixture dimensions exceed admission.');
			if (body[8] !== 8 || body[9] !== 6 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) throw new Error('Only noninterlaced RGBA8 PNG fixtures are admitted.');
		} else if (type === 'IDAT') {
			if (dataEnded) throw new Error('PNG image chunks must be consecutive.');
			chunks.push(body);
		} else if (type === 'IEND') {
			if (length !== 0 || chunks.length === 0) throw new Error('Invalid PNG end.');
			ended = true;
		} else {
			if ((bytes[offset + 4]! & 32) === 0) throw new Error('Unsupported critical PNG chunk.');
			if (chunks.length) dataEnded = true;
		}
		offset += length + 12;
	}
	if (!ended) throw new Error('PNG end is missing.');
	const stride = width * 4; const expected = (stride + 1) * height;
	const scanlines = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
	if (scanlines.length !== expected) throw new Error('PNG scanlines do not match its dimensions.');
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row++) {
		const filter = scanlines[row * (stride + 1)]!;
		if (filter > 4) throw new Error('Unsupported PNG row filter.');
		for (let column = 0; column < stride; column++) {
			const target = row * stride + column;
			const left = column >= 4 ? rgba[target - 4]! : 0;
			const above = row > 0 ? rgba[target - stride]! : 0;
			const upperLeft = row > 0 && column >= 4 ? rgba[target - stride - 4]! : 0;
			const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
				: filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
			rgba[target] = (scanlines[row * (stride + 1) + column + 1]! + prediction) & 255;
		}
	}
	return { width, height, rgba };
}
function paeth(left: number, above: number, upperLeft: number): number {
	const prediction = left + above - upperLeft;
	const a = Math.abs(prediction - left); const b = Math.abs(prediction - above); const c = Math.abs(prediction - upperLeft);
	return a <= b && a <= c ? left : b <= c ? above : upperLeft;
}
