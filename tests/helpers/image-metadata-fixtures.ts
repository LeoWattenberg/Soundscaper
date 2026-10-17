/* SPDX-License-Identifier: AGPL-3.0-only */

import { crc32 } from 'node:zlib';

export interface TiffEntryFixture {
	readonly tag: number;
	readonly type: number;
	readonly count: number;
	readonly data: Uint8Array;
}

export function textEntry(tag: number, value: string): TiffEntryFixture {
	const data = new TextEncoder().encode(`${value}\0`);
	return { tag, type: 2, count: data.length, data };
}

export function numberEntry(tag: number, value: number, little = true, type = 3): TiffEntryFixture {
	const data = new Uint8Array(type === 3 ? 2 : 4);
	const view = new DataView(data.buffer);
	if (type === 3) view.setUint16(0, value, little);
	else view.setUint32(0, value, little);
	return { tag, type, count: 1, data };
}

export function rationalEntry(tag: number, numerator: number, denominator: number, little = true): TiffEntryFixture {
	const data = new Uint8Array(8);
	const view = new DataView(data.buffer);
	view.setUint32(0, numerator, little);
	view.setUint32(4, denominator, little);
	return { tag, type: 5, count: 1, data };
}

export function tiffFixture(root: readonly TiffEntryFixture[], exif: readonly TiffEntryFixture[] = [], little = true): Uint8Array {
	const entries = [...root];
	const subdirectory = exif.length ? 8 + 2 + (entries.length + 1) * 12 + 4 : 0;
	if (subdirectory) entries.push(numberEntry(0x8769, subdirectory, little, 4));
	const bodyStart = 8 + 2 + entries.length * 12 + 4 + (subdirectory ? 2 + exif.length * 12 + 4 : 0);
	const bytes = new Uint8Array(bodyStart + [...entries, ...exif].reduce((size, entry) => size + (entry.data.length > 4 ? entry.data.length : 0), 0));
	const view = new DataView(bytes.buffer);
	bytes.set(little ? [0x49, 0x49, 0x2a, 0] : [0x4d, 0x4d, 0, 0x2a]);
	view.setUint32(4, 8, little);
	let body = bodyStart;
	for (const [offset, values] of [[8, entries], [subdirectory, exif]] as const) {
		if (!offset) continue;
		view.setUint16(offset, values.length, little);
		values.forEach((entry, index) => {
			const position = offset + 2 + index * 12;
			view.setUint16(position, entry.tag, little);
			view.setUint16(position + 2, entry.type, little);
			view.setUint32(position + 4, entry.count, little);
			if (entry.data.length <= 4) bytes.set(entry.data, position + 8);
			else { view.setUint32(position + 8, body, little); bytes.set(entry.data, body); body += entry.data.length; }
		});
	}
	return bytes;
}

export function joinBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}

export function jpegSegment(marker: number, body: Uint8Array): Uint8Array {
	const header = new Uint8Array([0xff, marker, 0, 0]);
	new DataView(header.buffer).setUint16(2, body.length + 2);
	return joinBytes(header, body);
}

export function jpegExif(tiff: Uint8Array): Uint8Array {
	return jpegSegment(0xe1, joinBytes(new Uint8Array([69, 120, 105, 102, 0, 0]), tiff));
}

export function jpegFixture(...segments: readonly Uint8Array[]): Uint8Array {
	return joinBytes(new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xd9]));
}

export function iptcDataSet(record: number, tag: number, body: Uint8Array, extended = false): Uint8Array {
	const header = new Uint8Array(extended ? 9 : 5);
	header.set([0x1c, record, tag]);
	const view = new DataView(header.buffer);
	view.setUint16(3, extended ? 0x8004 : body.length);
	if (extended) view.setUint32(5, body.length);
	return joinBytes(header, body);
}

export function iptcText(tag: number, text: string): Uint8Array {
	return iptcDataSet(2, tag, new TextEncoder().encode(text));
}

export function photoshopIptc(data: Uint8Array, name = ''): Uint8Array {
	const encoded = new TextEncoder().encode(name);
	const header = new Uint8Array(6 + Math.ceil((1 + encoded.length) / 2) * 2);
	header.set([56, 66, 73, 77, 4, 4, encoded.length]);
	header.set(encoded, 7);
	const length = new Uint8Array(4);
	new DataView(length.buffer).setUint32(0, data.length);
	return jpegSegment(0xed, joinBytes(new TextEncoder().encode('Photoshop 3.0\0'), header, length,
		data, new Uint8Array(data.length % 2)));
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(data.length + 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, data.length);
	bytes.set(new TextEncoder().encode(type), 4);
	bytes.set(data, 8);
	view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
	return bytes;
}

export function pngFixture(...chunks: readonly Uint8Array[]): Uint8Array {
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, 1); view.setUint32(4, 1); ihdr.set([8, 2], 8);
	return joinBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
		...chunks, pngChunk('IEND', new Uint8Array()));
}
