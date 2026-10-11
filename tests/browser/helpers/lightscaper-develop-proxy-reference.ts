/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// This encoder supplies only lossless container bytes for the literal source.
// No production effect, resize or histogram kernel computes expected pixels.
import { encodePixelFramePngV1 } from '../../../src/common/editor/imaging/pixel-frame-png-v1.ts';

export type DevelopProxyReferenceStageV1 = 'before' | 'dehaze' | 25 | 50 | 75 | 100 | 125;
export const DEVELOP_PROXY_REFERENCE_V1 = Object.freeze({
	id: 'lightscaper-develop-proxy-spatial-4096x3072-v1', width: 4096, height: 3072,
	proxyWidth: 2048, proxyHeight: 1536, sourceRgbaBytes: 50_331_648, proxyRgbaBytes: 12_582_912,
	dehazeAmount: 37.125, dehazeGainQ8: 95, transmissionQ8: 242,
	dehazedGray: Object.freeze([28, 91, 155] as const), pngSrgbIntent: 0,
});
// Nine classes, row-major: first/interior/last row × first/interior/last column.
// Each triplet is the exact 3x3 binomial sum at phase0/1/2, prior to /16.
// Independent BigInt neighborhood enumeration in the owning test proves every
// entry, including replicated corners. It does not read a production kernel.
export const DEVELOP_PROXY_BLUR_SUMS_V1 = Object.freeze([
	[953,1777,1654], [1271,1524,1589], [1018,1459,1907],
	[1271,1524,1589], [1398,1461,1525], [1335,1397,1652],
	[1018,1459,1907], [1335,1397,1652], [1273,1142,1969],
].map(row => Object.freeze(row)));

export interface DevelopProxyReferenceHistogramV1 {
	readonly schemaVersion: 1; readonly sampledPixels: number; readonly transparentPixels: number;
	readonly bins: Readonly<{ red: readonly number[]; green: readonly number[]; blue: readonly number[] }>;
	readonly lowClippedChannels: readonly [number, number, number]; readonly highClippedChannels: readonly [number, number, number];
	readonly lowClippedPixels: number; readonly highClippedPixels: number;
}
export interface DevelopProxyReferenceFactsV1 {
	readonly schemaVersion: 1; readonly width: 2048; readonly height: 1536; readonly byteLength: 12582912;
	readonly stage: DevelopProxyReferenceStageV1; readonly rgbaSha256: string; readonly histogram: DevelopProxyReferenceHistogramV1;
}
export interface DevelopProxyReferenceValidationV1 {
	readonly schemaVersion: 1; readonly width: 2048; readonly height: 1536; readonly byteLength: 12582912;
	readonly stage: DevelopProxyReferenceStageV1; readonly mismatchCount: number; readonly maximumChannelError: number;
	readonly firstMismatch: Readonly<{ x: number; y: number; channel: 0 | 1 | 2 | 3; expected: number; actual: number }> | null;
	readonly actualRgbaSha256: string; readonly expectedRgbaSha256: string; readonly histogram: DevelopProxyReferenceHistogramV1;
}
export interface DevelopProxyPngFixtureV1 {
	readonly bytes: Uint8Array<ArrayBuffer>; readonly fileName: string; readonly mimeType: 'image/png';
	readonly width: 4096; readonly height: 3072; readonly byteLength: number; readonly contentSha256: string; readonly rgbaSha256: string;
}

const SOURCE_GRAY = [40, 100, 160] as const, DEHAZED_GRAY = DEVELOP_PROXY_REFERENCE_V1.dehazedGray;
const WIDTH = 2048, HEIGHT = 1536, BYTE_LENGTH = 12_582_912;
const stages = ['before', 'dehaze', 25, 50, 75, 100, 125] as const;
const factsCache = new Map<DevelopProxyReferenceStageV1, DevelopProxyReferenceFactsV1>();
const tables = new Map<DevelopProxyReferenceStageV1, readonly (readonly number[])[]>();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;

/** Fixed source2x2 blocks become single nearest proxy pixels at exact2:1.
 * Dark minimum40 survives each replicated3x3 neighborhood. Gain rounds95.04
 * to95; floor(40*95*243/65280)=14, transmission242, reconstructed28/91/155.
 * Sharpen then rounds the /16 blur before signed gain ties toward +infinity. */
export function developProxyReferenceByteV1(x: number, y: number, stage: DevelopProxyReferenceStageV1): number {
	assertStage(stage);
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
		throw new RangeError('Proxy reference coordinate is outside its fixed extent.');
	}
	return byteAt(tableFor(stage), x, y);
}

/** Small witnesses can mark the ready timing endpoint; full validation follows
 * afterward. The high-phase point changes at every measured amount, unlike91. */
export function developProxyReferenceWitnessesV1(stage: DevelopProxyReferenceStageV1) {
	assertStage(stage);
	return Object.freeze([[2, 1], [1, 1]].map(([x, y]) => {
		const gray = developProxyReferenceByteV1(x!, y!, stage);
		return Object.freeze({ x: x!, y: y!, rgba: Object.freeze([gray, gray, gray, 255] as const) });
	}));
}

/** Whole expected-plane facts, built from the finite independent class table
 * with one8192-byte row. Only seven immutable scalar summaries are retained. */
export function developProxyReferenceFactsV1(stage: DevelopProxyReferenceStageV1): DevelopProxyReferenceFactsV1 {
	assertStage(stage); const cached = factsCache.get(stage); if (cached) return cached;
	const table = tableFor(stage), bins = new Array<number>(256).fill(0), row = new Uint8Array(WIDTH * 4), hash = sha256.create();
	try {
		for (let y = 0; y < HEIGHT; y++) {
			for (let x = 0; x < WIDTH; x++) {
				const gray = byteAt(table, x, y), offset = x * 4;
				row[offset] = gray; row[offset + 1] = gray; row[offset + 2] = gray; row[offset + 3] = 255; bins[gray]!++;
			}
			hash.update(row);
		}
		const facts = Object.freeze({ schemaVersion: 1 as const, width: WIDTH, height: HEIGHT, byteLength: BYTE_LENGTH, stage,
			rgbaSha256: bytesToHex(hash.digest()), histogram: histogram([bins, [...bins], [...bins]], WIDTH * HEIGHT, 0, bins[0]!, bins[255]!) });
		factsCache.set(stage, facts); return facts;
	} finally { row.fill(0); hash.destroy(); }
}

/** Borrowed tightly packed RGBA is never mutated. One bounded traversal compares
 * every channel and retains only fixed bins, digests and the first mismatch. */
export function validateDevelopProxyRgbaV1(pixels: Uint8Array | Uint8ClampedArray, stage: DevelopProxyReferenceStageV1): DevelopProxyReferenceValidationV1 {
	assertStage(stage);
	if (Number(Reflect.apply(byteLengthGetter, pixels, [])) !== BYTE_LENGTH) throw new RangeError('Proxy byte extent must be2048x1536 RGBA.');
	const input = new Uint8Array(pixels.buffer, pixels.byteOffset, BYTE_LENGTH), expected = developProxyReferenceFactsV1(stage), table = tableFor(stage);
	const bins: [number[], number[], number[]] = [new Array<number>(256).fill(0), new Array<number>(256).fill(0), new Array<number>(256).fill(0)];
	const hash = sha256.create(); let mismatchCount = 0, maximumChannelError = 0, sampledPixels = 0, transparentPixels = 0, low = 0, high = 0;
	let firstMismatch: DevelopProxyReferenceValidationV1['firstMismatch'] = null;
	try {
		for (let y = 0; y < HEIGHT; y++) {
			for (let x = 0; x < WIDTH; x++) {
				const gray = byteAt(table, x, y), offset = 4 * (y * WIDTH + x);
				for (const channel of [0, 1, 2, 3] as const) {
					const actual = input[offset + channel]!, reference = channel === 3 ? 255 : gray, difference = Math.abs(actual - reference);
					if (difference !== 0) { mismatchCount++; if (difference > maximumChannelError) maximumChannelError = difference;
						firstMismatch ??= Object.freeze({ x, y, channel, expected: reference, actual }); }
				}
				if (input[offset + 3] === 0) { transparentPixels++; continue; }
				sampledPixels++; const red = input[offset]!, green = input[offset + 1]!, blue = input[offset + 2]!;
				bins[0][red]!++; bins[1][green]!++; bins[2][blue]!++;
				if (red === 0 || green === 0 || blue === 0) low++; if (red === 255 || green === 255 || blue === 255) high++;
			}
			hash.update(input.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4));
		}
		return Object.freeze({ schemaVersion: 1, width: WIDTH, height: HEIGHT, byteLength: BYTE_LENGTH, stage, mismatchCount, maximumChannelError,
			firstMismatch, actualRgbaSha256: bytesToHex(hash.digest()), expectedRgbaSha256: expected.rgbaSha256,
			histogram: histogram(bins, sampledPixels, transparentPixels, low, high) });
	} finally { hash.destroy(); }
}

/** Native canvas readback is independently owned and wiped after validation.
 * This reads the existing presentation; it never renders or seeds a canvas. */
export function validateDevelopProxyCanvasV1(canvas: HTMLCanvasElement, stage: DevelopProxyReferenceStageV1): DevelopProxyReferenceValidationV1 {
	assertStage(stage);
	if (!(canvas instanceof HTMLCanvasElement) || canvas.width !== WIDTH || canvas.height !== HEIGHT) throw new RangeError('Proxy canvas extent must be2048x1536.');
	const context = canvas.getContext('2d'); if (!context) throw new Error('Existing native Develop canvas is unavailable.');
	const readback = context.getImageData(0, 0, WIDTH, HEIGHT, { colorSpace: 'srgb' });
	try { return validateDevelopProxyRgbaV1(readback.data, stage); } finally { readback.data.fill(0); }
}

/** Actual lossless sRGB PNG encoding of the literal50MiB source. Source pixels
 * remain owned through encoder settlement, then are wiped; returned PNG bytes
 * belong to the caller. This is fixture construction, never an output oracle. */
export async function createDevelopProxyPngV1(): Promise<DevelopProxyPngFixtureV1> {
	const pixels = new Uint8Array(DEVELOP_PROXY_REFERENCE_V1.sourceRgbaBytes); let encoded: Uint8Array<ArrayBuffer> | null = null, delivered = false;
	try {
		for (let y = 0; y < 3072; y++) for (let x = 0; x < 4096; x++) {
			const gray = SOURCE_GRAY[(Math.floor(x / 2) + Math.floor(y / 2)) % 3]!, offset = 4 * (y * 4096 + x);
			pixels[offset] = gray; pixels[offset + 1] = gray; pixels[offset + 2] = gray; pixels[offset + 3] = 255;
		}
		const rgbaSha256 = bytesToHex(sha256(pixels));
		encoded = await encodePixelFramePngV1({ descriptor: { schemaVersion: 1, width: 4096, height: 3072, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels },
			{ limits: { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 }, maximumOutputBytes: 67_108_864 });
		if (encoded.byteLength >= 67_108_864) throw new RangeError('Encoded proxy fixture exceeds actual image import capacity.');
		const result = Object.freeze({ bytes: encoded, fileName: 'develop-proxy-spatial-4096x3072.png', mimeType: 'image/png' as const,
			width: 4096 as const, height: 3072 as const, byteLength: encoded.byteLength, contentSha256: bytesToHex(sha256(encoded)), rgbaSha256 });
		delivered = true; return result;
	} finally { pixels.fill(0); if (!delivered) encoded?.fill(0); }
}

function assertStage(value: unknown): asserts value is DevelopProxyReferenceStageV1 {
	if (!stages.some(stage => stage === value)) throw new RangeError('Unsupported proxy reference stage.');
}
function tableFor(stage: DevelopProxyReferenceStageV1): readonly (readonly number[])[] {
	const cached = tables.get(stage); if (cached) return cached;
	const table = stage === 'before' || stage === 'dehaze' ? DEVELOP_PROXY_BLUR_SUMS_V1.map(() => stage === 'before' ? SOURCE_GRAY : DEHAZED_GRAY)
		: DEVELOP_PROXY_BLUR_SUMS_V1.map(sums => Object.freeze(sums.map((sum, phase) => {
			const gray = DEHAZED_GRAY[phase]!, blur = Math.floor((sum + 8) / 16), gain = stage * 256 / 100;
			return Math.max(0, Math.min(255, gray + Math.floor(((gray - blur) * gain + 128) / 256)));
		})));
	const frozen = Object.freeze(table); tables.set(stage, frozen); return frozen;
}
function byteAt(table: readonly (readonly number[])[], x: number, y: number): number {
	const row = y === 0 ? 0 : y === HEIGHT - 1 ? 2 : 1, column = x === 0 ? 0 : x === WIDTH - 1 ? 2 : 1;
	return table[row * 3 + column]![(x + y) % 3]!;
}
function histogram(bins: [number[], number[], number[]], sampledPixels: number, transparentPixels: number, low: number, high: number): DevelopProxyReferenceHistogramV1 {
	return Object.freeze({ schemaVersion: 1, sampledPixels, transparentPixels,
		bins: Object.freeze({ red: Object.freeze(bins[0]), green: Object.freeze(bins[1]), blue: Object.freeze(bins[2]) }),
		lowClippedChannels: Object.freeze([bins[0][0]!, bins[1][0]!, bins[2][0]!] as const), highClippedChannels: Object.freeze([bins[0][255]!, bins[1][255]!, bins[2][255]!] as const),
		lowClippedPixels: low, highClippedPixels: high });
}
