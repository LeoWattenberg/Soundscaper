/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCurvesEffectV1, createCurvesTransferV1 } from '../src/common/editor/video-curves-v1.ts';
import type { VideoCurvePointsV1 } from '../src/common/editor/video-curve-types-v1.ts';

const CHANNELS = ['master', 'red', 'green', 'blue'] as const, REGIONS = ['Shadows', 'Darks', 'Lights', 'Highlights'];
const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
type Fraction = readonly [bigint, bigint];
const zero: Fraction = [0n, 1n], one: Fraction = [1n, 1n];

test('all256 point samples agree with independent adaptive rational interpolation, including32 knots and near-adjacent Float64 x', () => {
	const cases = [
		{ master: Array.from({ length: 32 }, (_, n) => ({ x: n / 31, y: ((n * 17) % 32) / 31 })) },
		{ master: [{ x: 0, y: 1 }, { x: 0.5, y: 0.1 }, { x: 0.5000000000000001, y: 0.9 }, { x: 1, y: 0 }],
			red: [{ x: 0, y: 0.2 }, { x: 0.2, y: 0.8 }, { x: 1, y: 0.3 }],
			green: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], blue: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
		{ master: [{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 1 }, { x: 1, y: 0 }] },
	];
	for (const params of cases) {
		const transfer = createCurvesTransferV1(prepareCurvesEffectV1({ id: 'p', type: 'point-curves-v1', enabled: true, params }));
		const curves = CHANNELS.map(channel => (params[channel as keyof typeof params] ?? identity) as VideoCurvePointsV1);
		for (let byte = 0; byte < 256; byte++) {
			const master = pointSample(byte, curves[0]!);
			assert.deepEqual([...transfer.subarray(byte * 4, byte * 4 + 4)], [pointSample(master, curves[1]!),
				pointSample(master, curves[2]!), pointSample(master, curves[3]!), 255]);
		}
	}
});

test('all256 parametric samples agree with independent gain/split arithmetic for fractional/extreme controls and either chain order', () => {
	for (const splits of [[0.25, 0.5, 0.75], [0.1, 0.6, 0.9], [0.49999999999999994, 0.5, 0.5000000000000001]]) {
		const params: Record<string, number> = { shadowSplit: splits[0]!, midtoneSplit: splits[1]!, highlightSplit: splits[2]! };
		CHANNELS.forEach((channel, index) => REGIONS.forEach((region, n) => {
			params[`${channel}${region}`] = [100, -100, 12.5, -37.125, 33.3, -73.25][(index + n) % 6]!;
		}));
		const prepared = prepareCurvesEffectV1({ id: 'q', type: 'parametric-curves-v1', enabled: true, params }), transfer = createCurvesTransferV1(prepared);
		const curves = CHANNELS.map(channel => parametricPoints(params, channel));
		for (let byte = 0; byte < 256; byte++) {
			const master = rationalSample(byte, curves[0]!);
			assert.deepEqual([...transfer.subarray(byte * 4, byte * 4 + 4)], [rationalSample(master, curves[1]!),
				rationalSample(master, curves[2]!), rationalSample(master, curves[3]!), 255]);
		}
		const inversion = createCurvesTransferV1({ id: 'p', type: 'point-curves-v1', enabled: true,
			params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
		assert.notEqual(transfer[inversion[64 * 4]! * 4], inversion[transfer[64 * 4]! * 4], 'Authored curve order remains visible.');
	}
});

test('enabled point endpoints remain free and all shared transfer tables have exact bounded bytes and independent ownership', () => {
	const value = { id: 'p', type: 'point-curves-v1', enabled: true, params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } };
	const first = createCurvesTransferV1(value), second = createCurvesTransferV1(value);
	assert.equal(first.byteLength, 1024); assert.notEqual(first.buffer, second.buffer); first.fill(0);
	assert.deepEqual([...second.subarray(0, 4)], [255, 255, 255, 255]); assert.deepEqual([...second.subarray(1020)], [0, 0, 0, 255]);
});

test('a one-ULP input interval is preserved and sampled without Q16 coordinate aliasing', () => {
	const points = [{ x: 0, y: 0 }, { x: 64 / 255, y: 0 }, { x: 0.2509803921568628, y: 1 }, { x: 1, y: 1 }];
	const transfer = createCurvesTransferV1({ id: 'exact', type: 'point-curves-v1', enabled: true, params: { master: points } });
	// 64/255 lies16/255 of the way across this exact binary-rational interval.
	for (let byte = 0; byte < 256; byte++) {
		const expected = byte < 64 ? 0 : byte === 64 ? 16 : 255;
		assert.equal(pointSample(byte, points), expected); assert.deepEqual([...transfer.subarray(byte * 4, byte * 4 + 4)], [expected, expected, expected, 255]);
	}
});

function pointSample(byte: number, points: VideoCurvePointsV1): number {
	return rationalSample(byte, points.map(point => [fromFloat(point.x), fromFloat(point.y)] as const));
}
function parametricPoints(params: Readonly<Record<string, number>>, channel: string): readonly (readonly [Fraction, Fraction])[] {
	const edges = [zero, fromFloat(params.shadowSplit!), fromFloat(params.midtoneSplit!), fromFloat(params.highlightSplit!), one];
	const points: (readonly [Fraction, Fraction])[] = [[zero, zero]];
	for (let n = 0; n < 4; n++) {
		const x = divide(add(edges[n]!, edges[n + 1]!), [2n, 1n]), remainder = subtract(one, x);
		const distance = compare(x, remainder) < 0 ? x : remainder;
		const gain: Fraction = [BigInt(Math.round(params[`${channel}${REGIONS[n]!}`]! / 100 * 65536)), 65536n];
		points.push([x, add(x, multiply(gain, distance))]);
	}
	points.push([one, one]); return points;
}
function rationalSample(byte: number, points: readonly (readonly [Fraction, Fraction])[]): number {
	const position: Fraction = [BigInt(byte), 255n]; let right = 1;
	while (right < points.length - 1 && compare(points[right]![0], position) < 0) right++;
	const [a, b] = [points[right - 1]!, points[right]!];
	const result = add(a[1], multiply(subtract(b[1], a[1]), divide(subtract(position, a[0]), subtract(b[0], a[0]))));
	const scaled = multiply(result, [255n, 1n]); return Number((2n * scaled[0] + scaled[1]) / (2n * scaled[1]));
}

// Independent adaptive fractions use the binary exponent directly, rather than the production fixed2^-1074 scale.
function fromFloat(value: number): Fraction {
	const buffer = Buffer.alloc(8); buffer.writeDoubleBE(value); const bits = buffer.readBigUInt64BE();
	const exp = Number((bits >> 52n) & 2047n), mantissa = (bits & ((1n << 52n) - 1n)) + (exp === 0 ? 0n : 1n << 52n);
	const power = (exp === 0 ? 1 : exp) - 1023 - 52;
	return power >= 0 ? reduce([mantissa << BigInt(power), 1n]) : reduce([mantissa, 1n << BigInt(-power)]);
}
function add(a: Fraction, b: Fraction): Fraction { return reduce([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]); }
function subtract(a: Fraction, b: Fraction): Fraction { return add(a, [-b[0], b[1]]); }
function multiply(a: Fraction, b: Fraction): Fraction { return reduce([a[0] * b[0], a[1] * b[1]]); }
function divide(a: Fraction, b: Fraction): Fraction { return reduce([a[0] * b[1], a[1] * b[0]]); }
function compare(a: Fraction, b: Fraction): bigint { return a[0] * b[1] - b[0] * a[1]; }
function reduce([n, d]: Fraction): Fraction {
	let a = n < 0 ? -n : n, b = d < 0 ? -d : d;
	while (b) { const next = a % b; a = b; b = next; }
	return [n / a, d / a];
}
