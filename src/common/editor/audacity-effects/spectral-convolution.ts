/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Overlap-add convolution extracted from the Audacity 3.7.7 equalization
 * adaptation in spectral-equalization-curves.js. Upstream EqualizationFilter
 * authors: Mitch Golden, Vaughan Johnson, Martyn Shaw, and Paul Licameli.
 * The Float64 accumulation order and centred Float32 output are preserved.
 */
import { fft } from '../pffft.js';

/** Prepare one immutable kernel spectrum and reuse bounded scratch sequentially. */
export function createSameConvolver(kernel: Float64Array): (input: Float32Array) => Float32Array {
	const fftSize = 2 ** Math.ceil(Math.log2(kernel.length * 2));
	const blockSize = fftSize - kernel.length + 1;
	const kernelReal = new Float64Array(fftSize);
	const kernelImaginary = new Float64Array(fftSize);
	kernelReal.set(kernel);
	fft(kernelReal, kernelImaginary, false);
	const real = new Float64Array(fftSize);
	const imaginary = new Float64Array(fftSize);
	const accumulated = new Float64Array(fftSize);
	const mask = fftSize - 1;
	const delay = (kernel.length - 1) / 2;
	return (input) => {
		const output = new Float32Array(input.length);
		// An even kernel previously indexed the full accumulator at half-integers.
		if (!Number.isInteger(delay)) return output.fill(Number.NaN);
		accumulated.fill(0);
		for (let inputOffset = 0; inputOffset < input.length; inputOffset += blockSize) {
			const count = Math.min(blockSize, input.length - inputOffset);
			real.fill(0);
			imaginary.fill(0);
			real.set(input.subarray(inputOffset, inputOffset + count));
			fft(real, imaginary, false);
			for (let bin = 0; bin < fftSize; bin += 1) {
				const re = real[bin];
				const im = imaginary[bin];
				real[bin] = re * kernelReal[bin] - im * kernelImaginary[bin];
				imaginary[bin] = re * kernelImaginary[bin] + im * kernelReal[bin];
			}
			fft(real, imaginary, true);
			const convolutionFrames = count + kernel.length - 1;
			for (let index = 0; index < convolutionFrames; index += 1) {
				accumulated[(inputOffset + index) & mask] += real[index];
			}
			// No later input block contributes before its own start. Flush those
			// samples now, including the final tail, then recycle their ring slots.
			const finalBlock = inputOffset + count === input.length;
			const end = inputOffset + (finalBlock ? convolutionFrames : count);
			for (let frame = inputOffset; frame < end; frame += 1) {
				const destination = frame - delay;
				const slot = frame & mask;
				if (destination >= 0 && destination < output.length) output[destination] = accumulated[slot];
				accumulated[slot] = 0;
			}
		}
		return output;
	};
}
