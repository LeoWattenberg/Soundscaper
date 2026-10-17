/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type DevelopFullResolutionReferenceStageV1 = 'before' | 'dehaze' | 'sharpen50';
export const DEVELOP_FULL_RESOLUTION_REFERENCE_V1 = Object.freeze({
	id: 'lightscaper-develop-full-resolution-spatial-4096x3072-v1', width: 4096, height: 3072, byteLength: 50_331_648,
	dehazeAmount: 37.125, dehazeGainQ8: 95, sharpenAmount: 50, sharpenGainQ8: 128, sharpenThreshold: 0, pngSrgbIntent: 0,
});

// Independent exact BigInt enumeration in the owning test proves every cell.
// Each axis has ten classes: first/second, six interior modulo6 phases, then
// penultimate/last. Both stages together observe a two-pixel border radius.
// The source is opaque gray2x2 blocks [40,100,160], not the resized proxy.
export const DEVELOP_FULL_RESOLUTION_TABLES_V1 = Object.freeze({
	before: freezeTable([
		[40,40,100,100,160,160,40,40,100,100],
		[40,40,100,100,160,160,40,40,100,100],
		[100,100,160,160,40,40,100,100,160,160],
		[100,100,160,160,40,40,100,100,160,160],
		[160,160,40,40,100,100,160,160,40,40],
		[160,160,40,40,100,100,160,160,40,40],
		[40,40,100,100,160,160,40,40,100,100],
		[40,40,100,100,160,160,40,40,100,100],
		[160,160,40,40,100,100,160,160,40,40],
		[160,160,40,40,100,100,160,160,40,40],
	]),
	dehaze: freezeTable([
		[28,28,91,75,145,155,28,28,91,75],
		[28,28,91,91,155,155,28,28,91,75],
		[91,91,155,155,28,28,91,91,155,145],
		[75,91,155,155,28,28,91,91,155,155],
		[145,155,28,28,91,91,155,155,28,28],
		[155,155,28,28,91,91,155,155,28,28],
		[28,28,91,91,155,155,28,28,91,91],
		[28,28,91,91,155,155,28,28,91,75],
		[145,155,28,28,91,91,155,155,28,28],
		[133,155,28,28,91,75,145,155,28,28],
	]),
	sharpen50: freezeTable([
		[28,20,101,63,152,172,12,20,101,73],
		[20,12,92,83,174,181,10,12,93,65],
		[101,92,171,173,2,10,101,91,172,152],
		[63,83,173,181,10,12,91,81,173,172],
		[152,174,2,10,101,91,171,173,2,12],
		[172,181,10,12,91,81,173,181,10,20],
		[12,10,101,91,171,173,2,10,102,101],
		[20,12,91,81,173,181,10,12,92,63],
		[154,175,2,10,102,92,172,173,2,12],
		[129,173,12,20,101,63,152,172,12,28],
	]),
});

export interface DevelopFullResolutionReferenceHistogramV1 {
	readonly schemaVersion: 1; readonly sampledPixels: number; readonly transparentPixels: number;
	readonly bins: Readonly<{ red: readonly number[]; green: readonly number[]; blue: readonly number[] }>;
	readonly lowClippedChannels: readonly [number, number, number]; readonly highClippedChannels: readonly [number, number, number];
	readonly lowClippedPixels: number; readonly highClippedPixels: number;
}
export interface DevelopFullResolutionReferenceFactsV1 {
	readonly schemaVersion: 1; readonly width: 4096; readonly height: 3072; readonly byteLength: 50331648;
	readonly stage: DevelopFullResolutionReferenceStageV1; readonly rgbaSha256: string; readonly histogram: DevelopFullResolutionReferenceHistogramV1;
}
export interface DevelopFullResolutionReferenceValidationV1 {
	readonly schemaVersion: 1; readonly width: 4096; readonly height: 3072; readonly byteLength: 50331648;
	readonly stage: DevelopFullResolutionReferenceStageV1; readonly mismatchCount: number; readonly maximumChannelError: number;
	readonly firstMismatch: Readonly<{ x: number; y: number; channel: 0 | 1 | 2 | 3; expected: number; actual: number }> | null;
	readonly actualRgbaSha256: string; readonly expectedRgbaSha256: string; readonly histogram: DevelopFullResolutionReferenceHistogramV1;
}

const WIDTH = 4096, HEIGHT = 3072, BYTE_LENGTH = 50_331_648;
const factsCache = new Map<DevelopFullResolutionReferenceStageV1, DevelopFullResolutionReferenceFactsV1>();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;

/** Literal natural-resolution reference only; no production effect, resize,
 * histogram, decoder or renderer supplies these expected pixels. */
export function developFullResolutionReferenceByteV1(x: number, y: number, stage: DevelopFullResolutionReferenceStageV1): number {
	assertStage(stage);
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
		throw new RangeError('Full-resolution reference coordinate is outside its fixed extent.');
	}
	return DEVELOP_FULL_RESOLUTION_TABLES_V1[stage][axisClass(y, HEIGHT)]![axisClass(x, WIDTH)]!;
}

/** Small interior and corner witnesses; complete validation always follows. */
export function developFullResolutionReferenceWitnessesV1(stage: DevelopFullResolutionReferenceStageV1) {
	assertStage(stage);
	return Object.freeze([[4, 2], [2, 2], [4095, 0], [0, 3071]].map(([x, y]) => {
		const gray = developFullResolutionReferenceByteV1(x!, y!, stage);
		return Object.freeze({ x: x!, y: y!, rgba: Object.freeze([gray, gray, gray, 255] as const) });
	}));
}

/** Only one16384-byte expected row, fixed bins and three scalar summaries are
 * retained. A full expected plane is never allocated or sent to Playwright. */
export function developFullResolutionReferenceFactsV1(stage: DevelopFullResolutionReferenceStageV1): DevelopFullResolutionReferenceFactsV1 {
	assertStage(stage); const cached = factsCache.get(stage); if (cached) return cached;
	const table = DEVELOP_FULL_RESOLUTION_TABLES_V1[stage], bins = new Array<number>(256).fill(0), row = new Uint8Array(WIDTH * 4), hash = sha256.create();
	try {
		for (let y = 0; y < HEIGHT; y++) {
			const reference = table[axisClass(y, HEIGHT)]!;
			for (let x = 0; x < WIDTH; x++) {
				const gray = reference[axisClass(x, WIDTH)]!, offset = x * 4;
				row[offset] = gray; row[offset + 1] = gray; row[offset + 2] = gray; row[offset + 3] = 255; bins[gray]!++;
			}
			hash.update(row);
		}
		const facts = Object.freeze({ schemaVersion: 1 as const, width: WIDTH, height: HEIGHT, byteLength: BYTE_LENGTH, stage,
			rgbaSha256: bytesToHex(hash.digest()), histogram: histogram([bins, [...bins], [...bins]], WIDTH * HEIGHT, 0, bins[0]!, bins[255]!) });
		factsCache.set(stage, facts); return facts;
	} finally { row.fill(0); hash.destroy(); }
}

/** Inspect every borrowed RGBA channel without modifying its plane; retain
 * only scalar mismatches, a first witness, SHA and complete256-bin facts. */
export function validateDevelopFullResolutionRgbaV1(pixels: Uint8Array | Uint8ClampedArray,
	stage: DevelopFullResolutionReferenceStageV1): DevelopFullResolutionReferenceValidationV1 {
	assertStage(stage);
	if (Number(Reflect.apply(byteLengthGetter, pixels, [])) !== BYTE_LENGTH) throw new RangeError('Full-resolution byte extent must be4096x3072 RGBA.');
	const input = new Uint8Array(pixels.buffer, pixels.byteOffset, BYTE_LENGTH), expected = developFullResolutionReferenceFactsV1(stage), table = DEVELOP_FULL_RESOLUTION_TABLES_V1[stage];
	const bins: [number[], number[], number[]] = [new Array<number>(256).fill(0), new Array<number>(256).fill(0), new Array<number>(256).fill(0)];
	const hash = sha256.create(); let mismatchCount = 0, maximumChannelError = 0, sampledPixels = 0, transparentPixels = 0, low = 0, high = 0;
	let firstMismatch: DevelopFullResolutionReferenceValidationV1['firstMismatch'] = null;
	try {
		for (let y = 0; y < HEIGHT; y++) {
			const referenceRow = table[axisClass(y, HEIGHT)]!;
			for (let x = 0; x < WIDTH; x++) {
				const gray = referenceRow[axisClass(x, WIDTH)]!, offset = 4 * (y * WIDTH + x);
				for (let channel = 0; channel < 4; channel++) {
					const actual = input[offset + channel]!, reference = channel === 3 ? 255 : gray, difference = Math.abs(actual - reference);
					if (difference !== 0) {
						mismatchCount++; if (difference > maximumChannelError) maximumChannelError = difference;
						firstMismatch ??= Object.freeze({ x, y, channel: channel as 0 | 1 | 2 | 3, expected: reference, actual });
					}
				}
				if (input[offset + 3] === 0) { transparentPixels++; continue; }
				sampledPixels++; const red = input[offset]!, green = input[offset + 1]!, blue = input[offset + 2]!;
				bins[0][red]!++; bins[1][green]!++; bins[2][blue]!++;
				if (red === 0 || green === 0 || blue === 0) low++; if (red === 255 || green === 255 || blue === 255) high++;
			}
		}
		hash.update(input);
		return Object.freeze({ schemaVersion: 1, width: WIDTH, height: HEIGHT, byteLength: BYTE_LENGTH, stage, mismatchCount, maximumChannelError,
			firstMismatch, actualRgbaSha256: bytesToHex(hash.digest()), expectedRgbaSha256: expected.rgbaSha256,
			histogram: histogram(bins, sampledPixels, transparentPixels, low, high) });
	} finally { hash.destroy(); }
}

/** Native canvas observation only; owned sRGB readback is wiped after compare. */
export function validateDevelopFullResolutionCanvasV1(canvas: HTMLCanvasElement,
	stage: DevelopFullResolutionReferenceStageV1): DevelopFullResolutionReferenceValidationV1 {
	assertStage(stage);
	if (typeof HTMLCanvasElement !== 'function' || !(canvas instanceof HTMLCanvasElement) || canvas.width !== WIDTH || canvas.height !== HEIGHT) {
		throw new RangeError('Full-resolution canvas extent must be4096x3072.');
	}
	const context = canvas.getContext('2d'); if (!context) throw new Error('Existing native full-resolution canvas is unavailable.');
	const readback = context.getImageData(0, 0, WIDTH, HEIGHT, { colorSpace: 'srgb' });
	try { return validateDevelopFullResolutionRgbaV1(readback.data, stage); } finally { readback.data.fill(0); }
}

function freezeTable(table: number[][]): readonly (readonly number[])[] { return Object.freeze(table.map(row => Object.freeze(row))); }
function assertStage(value: unknown): asserts value is DevelopFullResolutionReferenceStageV1 {
	if (value !== 'before' && value !== 'dehaze' && value !== 'sharpen50') throw new RangeError('Unsupported full-resolution reference stage.');
}
function axisClass(n: number, extent: number): number { return n < 2 ? n : n >= extent - 2 ? 8 + n - (extent - 2) : 2 + (n - 2) % 6; }
function histogram(bins: [number[], number[], number[]], sampledPixels: number, transparentPixels: number,
	low: number, high: number): DevelopFullResolutionReferenceHistogramV1 {
	return Object.freeze({ schemaVersion: 1, sampledPixels, transparentPixels,
		bins: Object.freeze({ red: Object.freeze(bins[0]), green: Object.freeze(bins[1]), blue: Object.freeze(bins[2]) }),
		lowClippedChannels: Object.freeze([bins[0][0]!, bins[1][0]!, bins[2][0]!] as const), highClippedChannels: Object.freeze([bins[0][255]!, bins[1][255]!, bins[2][255]!] as const),
		lowClippedPixels: low, highClippedPixels: high });
}
