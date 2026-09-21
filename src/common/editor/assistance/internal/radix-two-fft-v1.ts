/* SPDX-License-Identifier: AGPL-3.0-only */

/** In-place deterministic Float64 radix-two FFT shared by assistance DSP. */
export function fftRadixTwoFloat64V1(
	real: Float64Array,
	imaginary: Float64Array,
	inverse: boolean,
): void {
	const size = real.length;
	if (imaginary.length !== size || size < 1 || (size & (size - 1)) !== 0) {
		throw new RangeError('Float64 radix-two FFT planes must have the same positive power-of-two length.');
	}
	for (let source = 1, destination = 0; source < size; source += 1) {
		let bit = size >> 1;
		for (; destination & bit; bit >>= 1) destination ^= bit;
		destination ^= bit;
		if (source < destination) {
			[real[source], real[destination]] = [real[destination]!, real[source]!];
			[imaginary[source], imaginary[destination]] = [imaginary[destination]!, imaginary[source]!];
		}
	}
	for (let length = 2; length <= size; length *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const rootReal = Math.cos(angle);
		const rootImaginary = Math.sin(angle);
		for (let offset = 0; offset < size; offset += length) {
			let factorReal = 1;
			let factorImaginary = 0;
			for (let index = 0; index < length / 2; index += 1) {
				const even = offset + index;
				const odd = even + length / 2;
				const oddReal = real[odd]! * factorReal - imaginary[odd]! * factorImaginary;
				const oddImaginary = real[odd]! * factorImaginary + imaginary[odd]! * factorReal;
				real[odd] = real[even]! - oddReal;
				imaginary[odd] = imaginary[even]! - oddImaginary;
				real[even] = (real[even] ?? 0) + oddReal;
				imaginary[even] = (imaginary[even] ?? 0) + oddImaginary;
				const nextReal = factorReal * rootReal - factorImaginary * rootImaginary;
				factorImaginary = factorReal * rootImaginary + factorImaginary * rootReal;
				factorReal = nextReal;
			}
		}
	}
	if (inverse) {
		for (let index = 0; index < size; index += 1) {
			real[index] = (real[index] ?? 0) / size;
			imaginary[index] = (imaginary[index] ?? 0) / size;
		}
	}
}
