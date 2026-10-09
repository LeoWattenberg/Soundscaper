/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CurveChannelV1, ParametricCurvesParamsV1, PointCurvesParamsV1 } from './video-curve-types-v1.ts';

const CHANNELS: readonly CurveChannelV1[] = ['master', 'red', 'green', 'blue'];
const REGIONS = ['Shadows', 'Darks', 'Lights', 'Highlights'];
const UNIT = 1n << 1074n;
const BITS = new DataView(new ArrayBuffer(8));
const SET = DataView.prototype.setFloat64, GET = DataView.prototype.getBigUint64;
interface Point { readonly x: bigint; readonly y: bigint }

/** Owning callers supply already admitted frozen coordinates. No sampled/persisted LUT replaces them.
 * At most4x32 binary-rational point pairs and one1KiB transfer are prepared synchronously.
 * Intermediate integers remain below2200 bits; this is not a whole-frame heap claim. */
export function pointCurvesTransferV1(params: PointCurvesParamsV1): Uint8Array<ArrayBuffer> {
	const curves = CHANNELS.map(channel => params[channel].map(point => ({ x: binary(point.x), y: binary(point.y) })));
	return transfer(curves, UNIT);
}

/** Region centers use the exact admitted IEEE split values; only authored gains use Q16. */
export function parametricCurvesTransferV1(params: ParametricCurvesParamsV1): Uint8Array<ArrayBuffer> {
	const edges = [0n, binary(params.shadowSplit!), binary(params.midtoneSplit!), binary(params.highlightSplit!), UNIT];
	const scale = UNIT * 131072n;
	const curves = CHANNELS.map(channel => {
		const points: Point[] = [{ x: 0n, y: 0n }];
		for (let index = 0; index < 4; index++) {
			const x = (edges[index]! + edges[index + 1]!) * 65536n;
			const gain = BigInt(Math.round(params[`${channel}${REGIONS[index]!}`]! / 100 * 65536));
			const distance = x < scale - x ? x : scale - x;
			points.push({ x, y: x + gain * distance / 65536n });
		}
		points.push({ x: scale, y: scale }); return points;
	});
	return transfer(curves, scale);
}

function transfer(curves: readonly (readonly Point[])[], scale: bigint): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(1024);
	for (let byte = 0; byte < 256; byte++) {
		const master = sample(byte, curves[0]!, scale);
		for (let channel = 0; channel < 3; channel++) bytes[byte * 4 + channel] = sample(master, curves[channel + 1]!, scale);
		bytes[byte * 4 + 3] = 255;
	}
	return bytes;
}

function sample(byte: number, points: readonly Point[], scale: bigint): number {
	const position = BigInt(byte) * scale;
	let right = 1;
	while (right < points.length - 1 && 255n * points[right]!.x < position) right++;
	const a = points[right - 1]!, b = points[right]!, width = b.x - a.x;
	const numerator = 255n * a.y * width + (b.y - a.y) * (position - 255n * a.x), denominator = scale * width;
	return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Every finite[0,1] Float64 is an integer multiple of2^-1074, including subnormals. */
function binary(value: number): bigint {
	Reflect.apply(SET, BITS, [0, value, false]);
	const bits = Reflect.apply(GET, BITS, [0, false]) as bigint;
	const fraction = bits & ((1n << 52n) - 1n), exponent = Number((bits >> 52n) & 2047n);
	return exponent === 0 ? fraction : ((1n << 52n) | fraction) << BigInt(exponent - 1);
}

/** A balanced byte-domain decision tree has depth8, avoiding unbounded FFmpeg expression nesting. */
export function curveTransferExpressionV1(bytes: Uint8Array, channel: 0 | 1 | 2, sampleName: string): string {
	const lookup = (first: number, last: number): string => {
		if (first === last) return String(bytes[first * 4 + channel]!);
		const middle = Math.floor((first + last) / 2);
		return `if(lte(${sampleName},${String(middle)}),${lookup(first, middle)},${lookup(middle + 1, last)})`;
	};
	return lookup(0, 255);
}
