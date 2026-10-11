/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DEVELOP_FULL_RESOLUTION_REFERENCE_V1 as SPEC, DEVELOP_FULL_RESOLUTION_TABLES_V1,
	developFullResolutionReferenceByteV1, developFullResolutionReferenceFactsV1, developFullResolutionReferenceWitnessesV1,
	validateDevelopFullResolutionRgbaV1, validateDevelopFullResolutionCanvasV1,
	type DevelopFullResolutionReferenceStageV1 } from './browser/helpers/lightscaper-develop-full-resolution-reference.ts';
import { developProxyReferenceByteV1 } from './browser/helpers/lightscaper-develop-proxy-reference.ts';

const WIDTH = 4096, HEIGHT = 3072, BYTES = WIDTH * HEIGHT * 4;
const GRAY = [40n, 100n, 160n], STAGES = ['before', 'dehaze', 'sharpen50'] as const;
const XS = [0, 1, 2, 3, 4, 5, 6, 7, WIDTH - 2, WIDTH - 1];
const YS = [0, 1, 2, 3, 4, 5, 6, 7, HEIGHT - 2, HEIGHT - 1];

// These exact rational calculations are independent of the renderer, its scalar
// kernels, its LUT/resize code and the reference helper's literal class tables.
function floor(n: bigint, d: bigint): bigint { return n >= 0n ? n / d : -((-n + d - 1n) / d); }
function clampByte(n: bigint): bigint { return n < 0n ? 0n : n > 255n ? 255n : n; }
function bound(n: number, extent: number): number { return Math.max(0, Math.min(extent - 1, n)); }
function source(x: number, y: number): bigint {
	return GRAY[(Math.floor(bound(x, WIDTH) / 2) + Math.floor(bound(y, HEIGHT) / 2)) % 3]!;
}
function transmission(dark: bigint): bigint { return 256n - dark * 95n * 243n / 65280n; }
function haze(gray: bigint, dark: bigint): bigint {
	const t = transmission(dark); return clampByte(255n + floor(2n * (gray - 255n) * 256n + t, 2n * t));
}
function dehaze(x: number, y: number): bigint {
	x = bound(x, WIDTH); y = bound(y, HEIGHT); let dark = 255n;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const gray = source(x + dx, y + dy); if (gray < dark) dark = gray;
	}
	return haze(source(x, y), dark);
}
function binomial(read: (x: number, y: number) => bigint, x: number, y: number): bigint {
	let sum = 0n;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		sum += BigInt((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)) * read(bound(x + dx, WIDTH), bound(y + dy, HEIGHT));
	}
	return sum;
}
function sharpen(read: (x: number, y: number) => bigint, x: number, y: number): bigint {
	x = bound(x, WIDTH); y = bound(y, HEIGHT);
	const gray = read(x, y), blur = (binomial(read, x, y) + 8n) / 16n;
	return clampByte(gray + floor((gray - blur) * 128n + 128n, 256n));
}
function exact(x: number, y: number, stage: DevelopFullResolutionReferenceStageV1): number {
	return Number(stage === 'before' ? source(x, y) : stage === 'dehaze' ? dehaze(x, y) : sharpen(dehaze, x, y));
}
function axisClass(n: number, extent: number): number { return n < 2 ? n : n >= extent - 2 ? 8 + n - (extent - 2) : 2 + (n - 2) % 6; }
function independentTable(stage: DevelopFullResolutionReferenceStageV1): number[][] {
	return YS.map(y => XS.map(x => exact(x, y, stage)));
}
function independentFrame(stage: DevelopFullResolutionReferenceStageV1) {
	const table = independentTable(stage), pixels = new Uint8Array(BYTES), bins = new Array<number>(256).fill(0);
	for (let y = 0; y < HEIGHT; y++) {
		const row = table[axisClass(y, HEIGHT)]!;
		for (let x = 0; x < WIDTH; x++) {
			const gray = row[axisClass(x, WIDTH)]!, offset = 4 * (y * WIDTH + x);
			pixels[offset] = gray; pixels[offset + 1] = gray; pixels[offset + 2] = gray; pixels[offset + 3] = 255; bins[gray]!++;
		}
	}
	return { pixels, bins, sha256: createHash('sha256').update(pixels).digest('hex') };
}

test('full-resolution source, fractional dehaze and replicated corner values have exact literal proofs', () => {
	assert.deepEqual([SPEC.width, SPEC.height, SPEC.byteLength], [4096, 3072, 50_331_648]);
	assert.equal(SPEC.dehazeAmount, 37.125); assert.equal(SPEC.dehazeGainQ8, 95); assert.equal(SPEC.sharpenAmount, 50); assert.equal(SPEC.sharpenGainQ8, 128);
	assert.equal(SPEC.sharpenThreshold, 0); assert.equal(SPEC.pngSrgbIntent, 0);
	assert.deepEqual([transmission(40n), transmission(100n), transmission(160n)], [242n, 221n, 200n]);
	assert.deepEqual([haze(40n, 40n), haze(100n, 40n), haze(160n, 40n)], [28n, 91n, 155n]);
	assert.deepEqual([dehaze(4095, 0), dehaze(0, 3071), sharpen(dehaze, 4095, 0), sharpen(dehaze, 0, 3071)], [75n, 133n, 73n, 129n]);
	assert.equal(binomial(dehaze, 4, 2), 1273n); assert.equal(sharpen(dehaze, 4, 2), 2n);
	assert.equal(floor(-52n * 128n + 128n, 256n), -26n);
});

test('all100 full-resolution border and six-phase classes are independently enumerated and immutable', () => {
	for (const stage of STAGES) {
		const table = independentTable(stage); assert.deepEqual(DEVELOP_FULL_RESOLUTION_TABLES_V1[stage], table);
		assert.ok(Object.isFrozen(DEVELOP_FULL_RESOLUTION_TABLES_V1[stage]));
		for (const row of DEVELOP_FULL_RESOLUTION_TABLES_V1[stage]) assert.ok(Object.isFrozen(row));
		for (const x of [...XS, 8, 9, 42, 43, 4092, 4093]) for (const y of [...YS, 8, 9, 68, 69, 3068, 3069]) {
			assert.equal(developFullResolutionReferenceByteV1(x, y, stage), exact(x, y, stage));
		}
		for (const witness of developFullResolutionReferenceWitnessesV1(stage)) {
			const gray = exact(witness.x, witness.y, stage); assert.deepEqual(witness.rgba, [gray, gray, gray, 255]);
			assert.ok(Object.isFrozen(witness)); assert.ok(Object.isFrozen(witness.rgba));
		}
	}
});

test('full spatial rendering differs from applying the same recipe to the nearest fit-screen proxy', () => {
	assert.equal(developProxyReferenceByteV1(2, 1, 50), 0); assert.equal(developFullResolutionReferenceByteV1(4, 2, 'sharpen50'), 2);
	assert.deepEqual([[4, 2], [5, 2], [4, 3], [5, 3]].map(([x, y]) => exact(x!, y!, 'sharpen50')), [2, 10, 10, 12]);
	assert.equal(developProxyReferenceByteV1(2047, 0, 'dehaze'), 91); assert.equal(developFullResolutionReferenceByteV1(4095, 0, 'dehaze'), 75);
	assert.equal(developProxyReferenceByteV1(0, 1535, 'dehaze'), 155); assert.equal(developFullResolutionReferenceByteV1(0, 3071, 'dehaze'), 133);
});

test('every original-size RGBA hash, histogram and clipped channel matches an independent complete plane', () => {
	for (const stage of STAGES) {
		const expected = independentFrame(stage);
		try {
			const facts = developFullResolutionReferenceFactsV1(stage), result = validateDevelopFullResolutionRgbaV1(expected.pixels, stage);
			assert.equal(facts.rgbaSha256, expected.sha256); assert.equal(result.actualRgbaSha256, expected.sha256); assert.equal(result.expectedRgbaSha256, expected.sha256);
			if (stage === 'before') assert.equal(expected.sha256, '41db31fb6114cdd03b0cb3fbba0b6a6ab5c4a0d3718f633c891b2001ffab4833');
			assert.equal(result.mismatchCount, 0); assert.equal(result.maximumChannelError, 0); assert.equal(result.firstMismatch, null);
			assert.equal(createHash('sha256').update(expected.pixels).digest('hex'), expected.sha256, 'validation must not mutate borrowed pixels');
			assert.equal(facts.histogram.sampledPixels, 12_582_912); assert.equal(facts.histogram.transparentPixels, 0);
			for (const channel of ['red', 'green', 'blue'] as const) {
				assert.deepEqual(facts.histogram.bins[channel], expected.bins); assert.deepEqual(result.histogram.bins[channel], expected.bins);
			}
			assert.deepEqual(result.histogram.lowClippedChannels, [expected.bins[0], expected.bins[0], expected.bins[0]]);
			assert.deepEqual(result.histogram.highClippedChannels, [expected.bins[255], expected.bins[255], expected.bins[255]]);
			assert.equal(result.histogram.lowClippedPixels, expected.bins[0]); assert.equal(result.histogram.highClippedPixels, expected.bins[255]);
			assert.equal(facts.histogram.lowClippedPixels, expected.bins[0]); assert.equal(facts.histogram.highClippedPixels, expected.bins[255]);
			assert.ok(Object.isFrozen(facts)); assert.ok(Object.isFrozen(facts.histogram.bins.red));
		} finally { expected.pixels.fill(0); }
	}
});

test('full validator rejects reversed stage order, blur truncation and single-channel or alpha corruption', () => {
	const expected = independentFrame('sharpen50'), offset = 4 * (2 * WIDTH + 4);
	try {
		let dark = 255n;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const gray = sharpen(source, 4 + dx, 2 + dy); if (gray < dark) dark = gray;
		}
		const reversed = Number(haze(sharpen(source, 4, 2), dark)); assert.notEqual(reversed, 2);
		expected.pixels.set([reversed, reversed, reversed], offset);
		const wrongOrder = validateDevelopFullResolutionRgbaV1(expected.pixels, 'sharpen50');
		assert.equal(wrongOrder.mismatchCount, 3); assert.deepEqual(wrongOrder.firstMismatch, { x: 4, y: 2, channel: 0, expected: 2, actual: reversed });
		expected.pixels.set([2, 2, 2], offset);
		const truncated = Number(clampByte(28n + floor((28n - 1273n / 16n) * 128n + 128n, 256n))); assert.equal(truncated, 3);
		expected.pixels[offset] = truncated;
		const wrongRounding = validateDevelopFullResolutionRgbaV1(expected.pixels, 'sharpen50');
		assert.equal(wrongRounding.mismatchCount, 1); assert.equal(wrongRounding.maximumChannelError, 1);
		expected.pixels[offset] = 2; expected.pixels[3] = 0;
		const corrupt = validateDevelopFullResolutionRgbaV1(expected.pixels, 'sharpen50');
		assert.equal(corrupt.mismatchCount, 1); assert.equal(corrupt.maximumChannelError, 255); assert.notEqual(corrupt.actualRgbaSha256, corrupt.expectedRgbaSha256);
		assert.equal(corrupt.histogram.transparentPixels, 1); assert.equal(corrupt.histogram.sampledPixels, 12_582_911);
	} finally { expected.pixels.fill(0); }
});

test('full reference refuses foreign stages, invalid coordinates, wrong extents and detached planes', () => {
	for (const stage of [50, 37.125, '50', 'after', NaN, undefined]) assert.throws(() => developFullResolutionReferenceFactsV1(stage as DevelopFullResolutionReferenceStageV1), /stage/u);
	for (const [x, y] of [[-1, 0], [4096, 0], [0, 3072], [0.5, 1], [1, Infinity]]) assert.throws(() => developFullResolutionReferenceByteV1(x!, y!, 'sharpen50'), /coordinate/u);
	assert.throws(() => validateDevelopFullResolutionRgbaV1(new Uint8Array(16), 'before'), /extent/u);
	const detached = new Uint8Array(BYTES); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.throws(() => validateDevelopFullResolutionRgbaV1(detached, 'before'), /extent/u);
	assert.throws(() => validateDevelopFullResolutionCanvasV1({ width: WIDTH, height: HEIGHT } as HTMLCanvasElement, 'before'), /canvas/u);
});
