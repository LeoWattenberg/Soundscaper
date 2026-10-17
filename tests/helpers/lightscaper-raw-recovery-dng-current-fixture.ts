/* SPDX-License-Identifier: AGPL-3.0-only */

/** Repository-owned Bayer samples and TIFF fields, independent of LibRaw. No
 * rendered preview or decoded-pixel substitute is embedded in this fixture. */
export const RAW_RECOVERY_WIDTH = 128, RAW_RECOVERY_HEIGHT = 96;
export const RAW_RECOVERY_BLACK = 64, RAW_RECOVERY_WHITE = 4095;
export type RawRecoveryOrientationV1 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type RawRecoveryFixtureVariantV1 = 'recovery' | 'color-canary';
export interface RawRecoveryRoiV1 { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export const RAW_RECOVERY_ROIS = Object.freeze({
	seed: Object.freeze({ x: 12, y: 8, width: 4, height: 4 }),
	midtone: Object.freeze({ x: 12, y: 40, width: 4, height: 4 }),
	highlights: Object.freeze([36, 48, 60, 72].map(x => Object.freeze({ x, y: 40, width: 4, height: 4 }))),
	saturated: Object.freeze({ x: 100, y: 40, width: 4, height: 4 }),
	canary: Object.freeze({ x: 40, y: 40, width: 4, height: 4 }),
});
export const RAW_RECOVERY_HIGHLIGHT_RED = Object.freeze([2217, 2620, 3023, 3426] as const);

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
function ascii(tag: number, value: string): Entry {
	const bytes = new TextEncoder().encode(`${value}\0`); return { tag, type: 2, count: bytes.length, bytes };
}
function rationals(tag: number, values: readonly number[], signed = false, denominator = 1): Entry {
	const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		if (signed) { view.setInt32(index * 8, value, true); view.setInt32(index * 8 + 4, denominator, true); }
		else { view.setUint32(index * 8, value, true); view.setUint32(index * 8 + 4, denominator, true); }
	}
	return { tag, type: signed ? 10 : 5, count: values.length, bytes };
}

/** A neutral reference has half as many red sensor codes: the red camera-matrix
 * row is likewise half sensitivity. In the highlight slabs only G/B sensor
 * samples clip; R retains four independently authored levels. */
export function rawRecoverySensorSampleV1(x: number, y: number, width = RAW_RECOVERY_WIDTH, height = RAW_RECOVERY_HEIGHT,
	variant: RawRecoveryFixtureVariantV1 = 'recovery'): number {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) throw new RangeError('Owned recovery sample is outside its sensor.');
	const channel = y % 2 === 0 ? x % 2 === 0 ? 0 : 1 : x % 2 === 0 ? 1 : 2;
	let values: readonly number[] = [1713, 3426, 3426];
	if (x >= 8 && x < 24 && y >= 24 && y < 72) values = [504, 1008, 1008];
	if (x >= 32 && x < 80 && y >= 24 && y < 72) values = [RAW_RECOVERY_HIGHLIGHT_RED[Math.floor((x - 32) / 12)]!, 4031, 4031];
	if (x >= 96 && x < 112 && y >= 24 && y < 72) values = [4031, 4031, 4031];
	// A separately declared mixed-sensitivity camera matrix unmixes this green
	// field into signed red. It is not a recovery-detail claim.
	if (variant === 'color-canary' && x >= 32 && x < 80 && y >= 24 && y < 72) values = [0, 2016, 1008];
	return RAW_RECOVERY_BLACK + values[channel]!;
}

export function rawRecoveryDngFixtureV1(options: Readonly<{ orientation?: RawRecoveryOrientationV1;
	width?: number; height?: number; variant?: RawRecoveryFixtureVariantV1 }> = {}): Readonly<{
	bytes: Uint8Array<ArrayBuffer>; sensor: Uint16Array<ArrayBuffer>; rawOffset: number; width: number; height: number;
}> {
	const { orientation = 1, width = RAW_RECOVERY_WIDTH, height = RAW_RECOVERY_HEIGHT, variant = 'recovery' } = options;
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 256 || height > 256) throw new RangeError('Owned recovery fixture extent is bounded.');
	const stripOffset = numbers(273, 4, [0]);
	const entries: Entry[] = [
		numbers(254, 4, [0]), numbers(256, 4, [width]), numbers(257, 4, [height]), numbers(258, 3, [16]),
		numbers(259, 3, [1]), numbers(262, 3, [32803]), ascii(271, 'Lightscaper'), ascii(272, 'Owned recovery Bayer fixture'),
		stripOffset, numbers(274, 3, [orientation]), numbers(277, 3, [1]), numbers(278, 4, [height]),
		numbers(279, 4, [width * height * 2]), numbers(284, 3, [1]), numbers(33421, 3, [2, 2]), numbers(33422, 1, [0, 1, 1, 2]),
		numbers(50706, 1, [1, 4, 0, 0]), numbers(50707, 1, [1, 1, 0, 0]), ascii(50708, `Lightscaper owned recovery ${variant}`),
		numbers(50710, 1, [0, 1, 2]), numbers(50711, 3, [1]), numbers(50713, 3, [1, 1]),
		rationals(50714, [RAW_RECOVERY_BLACK]), numbers(50717, 4, [RAW_RECOVERY_WHITE]), rationals(50718, [1, 1]),
		numbers(50719, 4, [0, 0]), numbers(50720, 4, [width, height]),
		// XYZ→camera under D65. The canary adds 1/4 green sensitivity to red
		// before halving its row; the inverse must preserve negative RGB.
		rationals(50721, variant === 'recovery'
			? [16203, -7686, -2493, -9689, 18758, 415, 557, -2040, 10570]
			: [119935, -42730, -19529, -77512, 150064, 3320, 4456, -16320, 84560], true, variant === 'recovery' ? 10000 : 80000),
		rationals(50727, [1, 1, 1]), rationals(50728, [1, 2, 2], false, 2), rationals(50730, [0], true),
		numbers(50778, 3, [21]), numbers(50829, 4, [0, 0, height, width]),
	];
	entries.sort((left, right) => left.tag - right.tag);
	let cursor = 8 + 2 + entries.length * 12 + 4;
	const offsets = entries.map(entry => { if (entry.bytes.length <= 4) return 0; const offset = cursor; cursor += entry.bytes.length + entry.bytes.length % 2; return offset; });
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
		const sample = rawRecoverySensorSampleV1(x, y, width, height, variant); sensor[y * width + x] = sample; view.setUint16(rawOffset + (y * width + x) * 2, sample, true);
	}
	return Object.freeze({ bytes, sensor, rawOffset, width, height });
}
