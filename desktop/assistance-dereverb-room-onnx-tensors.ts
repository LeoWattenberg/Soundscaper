/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic owned tensor packing and complex-mask application for dereverb-room. */

import type { DereverbRoomSpectrumV1 } from
	'../src/common/editor/assistance/dereverb-room-signal-v1.ts';

/**
 * Pack one mono spectrum as the converted graph's `input` tensor layout:
 * (1, timeFrameCount, 2 * frequencyBinCount), frequency-major real/imaginary
 * interleave per frame — [Re(f0), Im(f0), Re(f1), Im(f1), ...].
 */
export function packDereverbRoomSpectrumV1(spectrum: DereverbRoomSpectrumV1): Float32Array {
	const { frequencyBinCount, timeFrameCount } = spectrum;
	const output = new Float32Array(timeFrameCount * frequencyBinCount * 2);
	for (let time = 0; time < timeFrameCount; time += 1) {
		const spectrumBase = time * frequencyBinCount;
		const outputBase = time * frequencyBinCount * 2;
		for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
			output[outputBase + 2 * frequency] = spectrum.real[spectrumBase + frequency]!;
			output[outputBase + 2 * frequency + 1] = spectrum.imaginary[spectrumBase + frequency]!;
		}
	}
	return output;
}

/**
 * Apply the graph's `output` complex mask, shaped (1, 1, frequencyBinCount,
 * timeFrameCount, 2), to the spectrum it was predicted from.
 */
export function applyDereverbRoomMaskV1(
	spectrum: DereverbRoomSpectrumV1,
	mask: Float32Array,
): DereverbRoomSpectrumV1 {
	const { frequencyBinCount, timeFrameCount } = spectrum;
	if (mask.length !== frequencyBinCount * timeFrameCount * 2) {
		throw new RangeError('The dereverb-room mask tensor geometry is invalid.');
	}
	const real = new Float32Array(frequencyBinCount * timeFrameCount);
	const imaginary = new Float32Array(real.length);
	for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
		for (let time = 0; time < timeFrameCount; time += 1) {
			const spectrumOffset = time * frequencyBinCount + frequency;
			const maskOffset = (frequency * timeFrameCount + time) * 2;
			const sourceReal = spectrum.real[spectrumOffset]!;
			const sourceImaginary = spectrum.imaginary[spectrumOffset]!;
			const maskReal = mask[maskOffset]!;
			const maskImaginary = mask[maskOffset + 1]!;
			real[spectrumOffset] = sourceReal * maskReal - sourceImaginary * maskImaginary;
			imaginary[spectrumOffset] = sourceReal * maskImaginary + sourceImaginary * maskReal;
		}
	}
	return Object.freeze({ ...spectrum, real, imaginary });
}
