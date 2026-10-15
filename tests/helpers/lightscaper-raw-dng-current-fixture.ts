/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owned synthetic sensor data, not a camera photograph or decoded-pixel seam.
 * TIFF/DNG fields and literal RGGB samples are written independently of LibRaw.
 * The actual decoder must open, unpack, demosaic, color-convert and orient it. */
export const RAW_DNG_DIMENSIONS = Object.freeze({ width: 32, height: 32 });
export const RAW_DNG_BLACK = 64;
export const RAW_DNG_WHITE = 4095;
export const RAW_DNG_GRAY_SAMPLES = Object.freeze([1024, 1025] as const);

interface Entry { readonly tag: number; readonly type: number; readonly count: number; readonly bytes: Uint8Array<ArrayBuffer>; }
function numbers(tag: number, type: 1 | 3 | 4, values: readonly number[]): Entry {
	const unit = type === 1 ? 1 : type === 3 ? 2 : 4, bytes = new Uint8Array(values.length * unit), view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		if (unit === 1) bytes[index] = value;
		else if (unit === 2) view.setUint16(index * unit, value, true);
		else view.setUint32(index * unit, value, true);
	}
	return { tag, type, count: values.length, bytes };
}
function ascii(tag: number, value: string): Entry { const bytes = new TextEncoder().encode(`${value}\0`); return { tag, type: 2, count: bytes.length, bytes }; }
function rationals(tag: number, values: readonly number[], signed = false, denominator = 1): Entry {
	const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		if (signed) { view.setInt32(index * 8, value, true); view.setInt32(index * 8 + 4, denominator, true); }
		else { view.setUint32(index * 8, value, true); view.setUint32(index * 8 + 4, denominator, true); }
	}
	return { tag, type: signed ? 10 : 5, count: values.length, bytes };
}

export function rawDngSensorSample(x: number, y: number): number {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 32 || y >= 32) throw new RangeError('Owned DNG sample is outside its 32×32 sensor.');
	if (y < 16) return x < 16 ? 1024 : 1025;
	const channel = y % 2 === 0 ? x % 2 === 0 ? 0 : 1 : x % 2 === 0 ? 1 : 2;
	return (x < 16 ? [768, 1536, 3072] : [3072, 1536, 768])[channel]!;
}

export function rawDngFixtureV1(orientation: 1 | 3 | 6 | 8 = 1): Readonly<{
	bytes: Uint8Array<ArrayBuffer>; sensor: Uint16Array<ArrayBuffer>; rawOffset: number;
}> {
	const { width, height } = RAW_DNG_DIMENSIONS, stripOffset = numbers(273, 4, [0]);
	const entries: Entry[] = [
		numbers(254, 4, [0]), numbers(256, 4, [width]), numbers(257, 4, [height]), numbers(258, 3, [16]),
		numbers(259, 3, [1]), numbers(262, 3, [32803]), ascii(271, 'Lightscaper'), ascii(272, 'Owned Bayer fixture'),
		stripOffset, numbers(274, 3, [orientation]), numbers(277, 3, [1]), numbers(278, 4, [height]),
		numbers(279, 4, [width * height * 2]), numbers(284, 3, [1]),
		numbers(33421, 3, [2, 2]), numbers(33422, 1, [0, 1, 1, 2]),
		numbers(50706, 1, [1, 4, 0, 0]), numbers(50707, 1, [1, 1, 0, 0]), ascii(50708, 'Lightscaper owned RGGB 32'),
		numbers(50710, 1, [0, 1, 2]), numbers(50711, 3, [1]), numbers(50713, 3, [1, 1]),
		rationals(50714, [RAW_DNG_BLACK]), numbers(50717, 4, [RAW_DNG_WHITE]), rationals(50718, [1, 1]),
		numbers(50719, 4, [0, 0]), numbers(50720, 4, [width, height]),
		// XYZ-to-linear-sRGB camera matrix, integer rationals under D65. No
		// embedded rendered preview can substitute for the Bayer image plane.
		rationals(50721, [32406, -15372, -4986, -9689, 18758, 415, 557, -2040, 10570], true, 10000),
		rationals(50727, [1, 1, 1]), rationals(50728, [1, 1, 1]), rationals(50730, [0], true),
		numbers(50778, 3, [21]), numbers(50829, 4, [0, 0, height, width]),
	];
	entries.sort((left, right) => left.tag - right.tag);
	let cursor = 8 + 2 + entries.length * 12 + 4;
	const offsets = entries.map(entry => {
		if (entry.bytes.length <= 4) return 0;
		const offset = cursor; cursor += entry.bytes.length + entry.bytes.length % 2; return offset;
	});
	const rawOffset = cursor, bytes = new Uint8Array(rawOffset + width * height * 2), view = new DataView(bytes.buffer);
	new DataView(stripOffset.bytes.buffer).setUint32(0, rawOffset, true);
	bytes.set([73, 73, 42, 0, 8, 0, 0, 0]); view.setUint16(8, entries.length, true);
	for (const [index, entry] of entries.entries()) {
		const at = 10 + index * 12; view.setUint16(at, entry.tag, true); view.setUint16(at + 2, entry.type, true); view.setUint32(at + 4, entry.count, true);
		if (entry.bytes.length <= 4) bytes.set(entry.bytes, at + 8);
		else { view.setUint32(at + 8, offsets[index]!, true); bytes.set(entry.bytes, offsets[index]!); }
	}
	const sensor = new Uint16Array(width * height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const sample = rawDngSensorSample(x, y); sensor[y * width + x] = sample; view.setUint16(rawOffset + (y * width + x) * 2, sample, true);
	}
	return Object.freeze({ bytes, sensor, rawOffset });
}
