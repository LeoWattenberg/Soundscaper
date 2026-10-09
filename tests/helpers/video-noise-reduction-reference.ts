/* SPDX-License-Identifier: AGPL-3.0-only */

/** Test-only independent rational specification. No production math, admission,
 * prepared passes or normalizers are imported. At most 1024 fixture pixels. */
export interface NoiseReductionReferenceControlsV1 {
	readonly luminance: number; readonly luminanceDetail: number; readonly luminanceContrast: number;
	readonly color: number; readonly colorDetail: number; readonly colorSmoothness: number;
}
interface Pixel { readonly rgb: readonly bigint[]; readonly alpha: bigint; readonly y: bigint; readonly co: bigint; readonly cg: bigint }
interface Tap { readonly pixel: Pixel; readonly dx: number; readonly dy: number }

/** Floor, rather than truncation, is required by the reversible signed lifts. */
function floorRatio(numerator: bigint, denominator: bigint): bigint {
	const quotient = numerator / denominator, remainder = numerator % denominator;
	return quotient - (remainder < 0n ? 1n : 0n);
}
/** Nearest rational integer; exact signed half ties go toward positive infinity. */
function nearest(numerator: bigint, denominator: bigint): bigint { return floorRatio(2n * numerator + denominator, 2n * denominator); }
function magnitude(value: bigint): bigint { return value < 0n ? -value : value; }
function byte(value: bigint): number { return Number(value < 0n ? 0n : value > 255n ? 255n : value); }

/** The contract deliberately specifies these binary64 operations, including the
 * division's intermediate rounding. BigInt rational filtering starts after Q8
 * admission; quantizing the exact input rational directly would skip that step. */
function percentCode(value: number): bigint {
	if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Reference controls require finite percentages.');
	return BigInt(Math.round(value * 256 / 100));
}

function lift(rgb: readonly number[], alpha: number): Pixel {
	const [r, g, b] = rgb.map(BigInt) as [bigint, bigint, bigint], co = r - b;
	const temporary = b + floorRatio(co, 2n), cg = g - temporary;
	return { rgb: [r,g,b], alpha: BigInt(alpha), y: temporary + floorRatio(cg, 2n), co, cg };
}
function reconstruct(y: bigint, co: bigint, cg: bigint): number[] {
	const temporary = y - floorRatio(cg, 2n), b = temporary - floorRatio(co, 2n);
	return [byte(b + co), byte(temporary + cg), byte(b)];
}
function blend(original: bigint, sum: bigint, weight: bigint, strength: bigint): bigint {
	if (weight === 0n) return original;
	return original + nearest((nearest(sum, weight) - original) * strength, 256n);
}
function bilateral(distance: bigint, detail: bigint): bigint {
	const rejected = floorRatio(distance * detail, 256n);
	return rejected >= 16n ? 0n : 16n - rejected;
}

export function noiseReductionReferenceV1(source: readonly number[], width: number,
	controls: NoiseReductionReferenceControlsV1, enabled = true): number[] {
	const count = source.length / 4, height = count / width;
	if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || count > 1024
		|| !source.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new RangeError('Reference fixture geometry/bytes refuse.');
	const q = { luminance: percentCode(controls.luminance), detailY: percentCode(controls.luminanceDetail),
		contrast: percentCode(controls.luminanceContrast), color: percentCode(controls.color),
		detailC: percentCode(controls.colorDetail), smooth: percentCode(controls.colorSmoothness) };
	const output = [...source]; if (!enabled || (q.luminance === 0n && q.color === 0n)) return output;
	const input = Array.from({ length: count }, (_, index) => lift(source.slice(4 * index, 4 * index + 3), source[4 * index + 3]!));
	const taps = (x: number, y: number, radius: number): Tap[] => {
		const result: Tap[] = [];
		for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
			const row = Math.max(0, Math.min(height - 1, y + dy)), column = Math.max(0, Math.min(width - 1, x + dx));
			result.push({ pixel: input[row * width + column]!, dx, dy });
		}
		return result;
	};
	for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
		const index = row * width + column, center = input[index]!; if (center.alpha === 0n) continue;
		let y = center.y, co = center.co, cg = center.cg;
		if (q.luminance > 0n) {
			const visible = taps(column, row, 1).filter(tap => tap.pixel.alpha > 0n);
			let low = center.y, high = center.y, sum = 0n, total = 0n;
			for (const { pixel, dx, dy } of visible) {
				if (pixel.y < low) low = pixel.y; if (pixel.y > high) high = pixel.y;
				const spatial = BigInt((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1));
				const weight = pixel.alpha * spatial * bilateral(magnitude(pixel.y - center.y), q.detailY);
				sum += pixel.y * weight; total += weight;
			}
			const protection = nearest(q.contrast * (high - low), 255n);
			y = blend(center.y, sum, total, nearest(q.luminance * (256n - protection), 256n));
		}
		if (q.color > 0n) {
			let sumCo = 0n, sumCg = 0n, total = 0n;
			const binomial = [1n,4n,6n,4n,1n];
			for (const { pixel, dx, dy } of taps(column, row, 2)) {
				if (pixel.alpha === 0n) continue;
				const small = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? BigInt((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)) * 16n : 0n;
				const large = binomial[dx + 2]! * binomial[dy + 2]!;
				const spatial = nearest(small * (256n - q.smooth) + large * q.smooth, 256n);
				const distanceCo = magnitude(pixel.co - center.co), distanceCg = magnitude(pixel.cg - center.cg);
				const weight = pixel.alpha * spatial * bilateral(distanceCo > distanceCg ? distanceCo : distanceCg, q.detailC);
				sumCo += pixel.co * weight; sumCg += pixel.cg * weight; total += weight;
			}
			co = blend(center.co, sumCo, total, q.color); cg = blend(center.cg, sumCg, total, q.color);
		}
		const rgb = reconstruct(y, co, cg);
		for (let channel = 0; channel < 3; channel++) output[4 * index + channel] = rgb[channel]!;
	}
	return output;
}
