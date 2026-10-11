/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { DEVELOP_PROXY_REFERENCE_V1 as SPEC, DEVELOP_PROXY_BLUR_SUMS_V1, createDevelopProxyPngV1,
	developProxyReferenceByteV1, developProxyReferenceFactsV1, developProxyReferenceWitnessesV1,
	validateDevelopProxyRgbaV1, type DevelopProxyReferenceStageV1 } from './browser/helpers/lightscaper-develop-proxy-reference.ts';

const AMOUNTS = [25, 50, 75, 100, 125] as const;
const GRAY = [40n, 100n, 160n], DEHAZED = [28n, 91n, 155n];
const SUMS = [[953,1777,1654],[1271,1524,1589],[1018,1459,1907],
	[1271,1524,1589],[1398,1461,1525],[1335,1397,1652],
	[1018,1459,1907],[1335,1397,1652],[1273,1142,1969]];
const INTERIOR = [[13,91,170],[0,91,185],[0,91,200],[0,91,215],[0,91,230]];

// Exact signed floor and rational ties toward +infinity. No production effect,
// resize, PNG parser, histogram or hashing code supplies these expected values.
function floor(n: bigint, d: bigint): bigint { return n >= 0n ? n / d : -((-n + d - 1n) / d); }
function mod3(n: number): number { return ((n % 3) + 3) % 3; }
function clamp(n: bigint): number { return Number(n < 0n ? 0n : n > 255n ? 255n : n); }
function haze(gray: bigint, dark: bigint): number {
	const gain = 95n, transmission = 256n - dark * gain * 243n / 65280n;
	return clamp(255n + floor(2n * (gray - 255n) * 256n + transmission, 2n * transmission));
}
function classSum(row: number, column: number, phase: number): bigint {
	let sum = 0n;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const x = column === 0 ? Math.max(0, dx) : column === 2 ? Math.min(0, dx) : dx;
		const y = row === 0 ? Math.max(0, dy) : row === 2 ? Math.min(0, dy) : dy;
		const weight = BigInt((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1));
		sum += weight * DEHAZED[mod3(phase + x + y)]!;
	}
	return sum;
}
function independentTable(stage: DevelopProxyReferenceStageV1): number[][] {
	return SUMS.map((_, kind) => [0, 1, 2].map(phase => {
		if (stage === 'before') return Number(GRAY[phase]);
		if (stage === 'dehaze') return Number(DEHAZED[phase]);
		const sum = classSum(Math.floor(kind / 3), kind % 3, phase), blur = (sum + 8n) / 16n;
		const gray = DEHAZED[phase]!, gain = BigInt(stage * 256 / 100);
		return clamp(gray + floor((gray - blur) * gain + 128n, 256n));
	}));
}
function independentFrame(stage: DevelopProxyReferenceStageV1) {
	const table = independentTable(stage), pixels = new Uint8Array(2048 * 1536 * 4), bins = new Array<number>(256).fill(0);
	for (let y = 0; y < 1536; y++) for (let x = 0; x < 2048; x++) {
		const row = y === 0 ? 0 : y === 1535 ? 2 : 1, column = x === 0 ? 0 : x === 2047 ? 2 : 1;
		const gray = table[row * 3 + column]![mod3(x + y)]!, offset = 4 * (y * 2048 + x);
		pixels.set([gray, gray, gray, 255], offset); bins[gray]!++;
	}
	return { pixels, bins, sha256: createHash('sha256').update(pixels).digest('hex') };
}

test('proxy pattern dimensions, nearest phase and fractional Dehaze transmission have exact literal proofs', () => {
	assert.deepEqual([SPEC.width, SPEC.height, SPEC.proxyWidth, SPEC.proxyHeight], [4096, 3072, 2048, 1536]);
	assert.equal(SPEC.sourceRgbaBytes, 50_331_648); assert.equal(SPEC.proxyRgbaBytes, 12_582_912);
	assert.equal(SPEC.dehazeAmount, 37.125); assert.equal(SPEC.dehazeGainQ8, 95); assert.equal(SPEC.transmissionQ8, 242);
	assert.deepEqual(SPEC.dehazedGray, [28, 91, 155]);
	assert.equal(floor(40n * 95n * 243n, 65280n), 14n);
	assert.deepEqual(GRAY.map(value => haze(value, 40n)), [28, 91, 155]);
	// A replicated 3x3 corner or edge still contains all three phases, so its
	// dark minimum remains40. The exact2:1 nearest coordinate hits block2x/2y.
	for (const x of [0, 1, 2046, 2047]) for (const y of [0, 1, 1534, 1535]) {
		const neighborhood: number[] = [];
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighborhood.push(Number(GRAY[mod3(Math.max(0, Math.min(2047, x + dx)) + Math.max(0, Math.min(1535, y + dy)))]));
		assert.equal(Math.min(...neighborhood), 40);
		assert.equal(developProxyReferenceByteV1(x, y, 'before'), Number(GRAY[mod3(Math.floor((2 * x) / 2) + Math.floor((2 * y) / 2))]));
	}
});

test('every replicated border class has an independent exact binomial sum and signed amount result', () => {
	assert.deepEqual(DEVELOP_PROXY_BLUR_SUMS_V1, SUMS);
	for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) for (let phase = 0; phase < 3; phase++) {
		assert.equal(classSum(row, column, phase), BigInt(SUMS[row * 3 + column]![phase]!));
	}
	for (const [index, amount] of AMOUNTS.entries()) {
		assert.deepEqual(independentTable(amount)[4], INTERIOR[index]);
		for (const x of [0, 1, 2, 3, 2046, 2047]) for (const y of [0, 1, 2, 3, 1534, 1535]) {
			const row = y === 0 ? 0 : y === 1535 ? 2 : 1, column = x === 0 ? 0 : x === 2047 ? 2 : 1;
			assert.equal(developProxyReferenceByteV1(x, y, amount), independentTable(amount)[row * 3 + column]![mod3(x + y)]);
		}
		const witnesses = developProxyReferenceWitnessesV1(amount);
		assert.deepEqual(witnesses.map(point => point.rgba), [[INTERIOR[index]![0], INTERIOR[index]![0], INTERIOR[index]![0], 255],
			[INTERIOR[index]![2], INTERIOR[index]![2], INTERIOR[index]![2], 255]]);
	}
});

test('every full proxy RGBA hash, histogram and clipped class matches independently enumerated pixels', () => {
	for (const stage of ['before', 'dehaze', ...AMOUNTS] as const) {
		const expected = independentFrame(stage);
		try {
			const facts = developProxyReferenceFactsV1(stage), checked = validateDevelopProxyRgbaV1(expected.pixels, stage);
			assert.equal(facts.rgbaSha256, expected.sha256); assert.equal(checked.actualRgbaSha256, expected.sha256);
			assert.equal(checked.expectedRgbaSha256, expected.sha256); assert.equal(checked.mismatchCount, 0); assert.equal(checked.maximumChannelError, 0); assert.equal(checked.firstMismatch, null);
			assert.equal(facts.histogram.sampledPixels, 3_145_728); assert.equal(facts.histogram.transparentPixels, 0);
			for (const channel of ['red', 'green', 'blue'] as const) {
				assert.deepEqual(facts.histogram.bins[channel], expected.bins); assert.deepEqual(checked.histogram.bins[channel], expected.bins);
			}
			assert.equal(facts.histogram.lowClippedPixels, expected.bins[0]); assert.equal(facts.histogram.highClippedPixels, expected.bins[255]);
			assert.deepEqual(facts.histogram.lowClippedChannels, [expected.bins[0], expected.bins[0], expected.bins[0]]);
			assert.deepEqual(facts.histogram.highClippedChannels, [expected.bins[255], expected.bins[255], expected.bins[255]]);
		} finally { expected.pixels.fill(0); }
	}
});

test('validator exposes wrong stage order, stale final amount and one-byte corruption rather than accepting its own digest', () => {
	const expected = independentFrame(50), offset = 4 * (1 * 2048 + 2);
	try {
		// Independent reversed-order point: sharpen source first, then dark3
		// reconstruction of that changed neighborhood, rather than Dehaze first.
		const sharpenSource = (x: number, y: number) => {
			let sum = 0n;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += BigInt((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1))
				* GRAY[mod3(Math.max(0, Math.min(2047, x + dx)) + Math.max(0, Math.min(1535, y + dy)))]!;
			const center = GRAY[mod3(x + y)]!; return clamp(center + floor((center - (sum + 8n) / 16n) * 128n + 128n, 256n));
		};
		let dark = 255;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dark = Math.min(dark, sharpenSource(2 + dx, 1 + dy));
		const reversed = haze(BigInt(sharpenSource(2, 1)), BigInt(dark)); assert.equal(reversed, 8); assert.notEqual(reversed, expected.pixels[offset]);
		expected.pixels.set([reversed, reversed, reversed], offset);
		const wrongOrder = validateDevelopProxyRgbaV1(expected.pixels, 50); assert.equal(wrongOrder.mismatchCount, 3); assert.equal(wrongOrder.maximumChannelError, 8);
		assert.deepEqual(wrongOrder.firstMismatch, { x: 2, y: 1, channel: 0, expected: 0, actual: 8 });
		expected.pixels.set([0, 0, 0], offset); const stale = validateDevelopProxyRgbaV1(expected.pixels, 100);
		assert.ok(stale.mismatchCount > 1_000_000); assert.notEqual(stale.actualRgbaSha256, stale.expectedRgbaSha256);
		expected.pixels[3] = 254; const corrupt = validateDevelopProxyRgbaV1(expected.pixels, 50);
		assert.equal(corrupt.mismatchCount, 1); assert.equal(corrupt.maximumChannelError, 1); assert.notEqual(corrupt.actualRgbaSha256, corrupt.expectedRgbaSha256);
	} finally { expected.pixels.fill(0); }
});

test('reference refuses foreign amounts, coordinates, extents and detached byte planes', () => {
	for (const stage of [0, 37.125, 200, NaN, '50', 'after', undefined]) assert.throws(() => developProxyReferenceFactsV1(stage as DevelopProxyReferenceStageV1), /stage/u);
	for (const [x, y] of [[-1, 0], [2048, 0], [0, 1536], [0.5, 1], [1, Infinity]]) assert.throws(() => developProxyReferenceByteV1(x!, y!, 50), /coordinate/u);
	assert.throws(() => validateDevelopProxyRgbaV1(new Uint8Array(16), 50), /extent/u);
	const detached = new Uint8Array(2048 * 1536 * 4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.throws(() => validateDevelopProxyRgbaV1(detached, 50), /extent/u);
});

test('lossless source PNG authenticates every original block, CRC, geometry and deterministic byte digest', async () => {
	const fixture = await createDevelopProxyPngV1(), idat: Uint8Array[] = [], types: string[] = [];
	try {
		assert.equal(fixture.width, 4096); assert.equal(fixture.height, 3072); assert.equal(fixture.byteLength, fixture.bytes.length); assert.ok(fixture.byteLength < 67_108_864);
		assert.equal(createHash('sha256').update(fixture.bytes).digest('hex'), fixture.contentSha256);
		assert.deepEqual([...fixture.bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
		let offset = 8;
		while (offset < fixture.bytes.length) {
			const view = new DataView(fixture.bytes.buffer, fixture.bytes.byteOffset + offset), length = view.getUint32(0);
			const type = String.fromCharCode(...fixture.bytes.subarray(offset + 4, offset + 8)), body = fixture.bytes.subarray(offset + 8, offset + 8 + length);
			assert.equal(crc32(fixture.bytes.subarray(offset + 4, offset + 8 + length)), view.getUint32(8 + length)); types.push(type);
			if (type === 'IHDR') assert.deepEqual([...body], [0,0,16,0,0,0,12,0,8,6,0,0,0]);
			if (type === 'sRGB') assert.deepEqual([...body], [0]); if (type === 'IDAT') idat.push(body); offset += length + 12;
		}
		assert.equal(offset, fixture.bytes.length); assert.equal(types[0], 'IHDR'); assert.equal(types[1], 'sRGB'); assert.equal(types.at(-1), 'IEND'); assert.ok(types.slice(2, -1).every(type => type === 'IDAT'));
		const raw = inflateSync(Buffer.concat(idat)), sourceHash = createHash('sha256'), counts = [0, 0, 0]; let mismatches = 0;
		try {
			assert.equal(raw.length, (4096 * 4 + 1) * 3072);
			for (let y = 0; y < 3072; y++) {
				const row = raw.subarray(y * (4096 * 4 + 1) + 1, (y + 1) * (4096 * 4 + 1)); assert.equal(raw[y * (4096 * 4 + 1)], 0); sourceHash.update(row);
				for (let x = 0; x < 4096; x++) {
					const phase = mod3(Math.floor(x / 2) + Math.floor(y / 2)), gray = Number(GRAY[phase]); counts[phase]!++;
					if (row[x * 4] !== gray || row[x * 4 + 1] !== gray || row[x * 4 + 2] !== gray || row[x * 4 + 3] !== 255) mismatches++;
				}
			}
			assert.equal(mismatches, 0); assert.deepEqual(counts, [4_194_304, 4_194_304, 4_194_304]); assert.equal(sourceHash.digest('hex'), fixture.rgbaSha256);
		} finally { raw.fill(0); }
	} finally { fixture.bytes.fill(0); }
});

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0;
}
