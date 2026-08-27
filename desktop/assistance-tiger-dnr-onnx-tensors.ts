/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic owned tensor packing and complex-mask application for TIGER-DnR. */

import type { TigerDnrSpectrumV1 } from
	'../src/common/editor/assistance/tiger-dnr-signal-v1.ts';

const STEM_COUNT = 3;

export function packTigerDnrSpectrumV1(spectrum: TigerDnrSpectrumV1): Float32Array {
	const { channelCount, frequencyBinCount, timeFrameCount } = spectrum;
	const output = new Float32Array(channelCount * 2 * frequencyBinCount * timeFrameCount);
	for (let channel = 0; channel < channelCount; channel += 1) {
		const source = spectrum.channels[channel]!;
		for (let component = 0; component < 2; component += 1) {
			const plane = component === 0 ? source.real : source.imaginary;
			for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
				for (let time = 0; time < timeFrameCount; time += 1) {
					output[((channel * 2 + component) * frequencyBinCount + frequency)
						* timeFrameCount + time] = plane[time * frequencyBinCount + frequency]!;
				}
			}
		}
	}
	return output;
}

export function applyTigerDnrMaskV1(
	spectrum: TigerDnrSpectrumV1,
	masks: Float32Array,
	stem: number,
): TigerDnrSpectrumV1 {
	const { frequencyBinCount, timeFrameCount } = spectrum;
	const channels = spectrum.channels.map((source, channel) => {
		const real = new Float32Array(frequencyBinCount * timeFrameCount);
		const imaginary = new Float32Array(real.length);
		for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
			for (let time = 0; time < timeFrameCount; time += 1) {
				const spectrumOffset = time * frequencyBinCount + frequency;
				const maskOffset = (((channel * STEM_COUNT + stem) * 2)
					* frequencyBinCount + frequency) * timeFrameCount + time;
				const sourceReal = source.real[spectrumOffset]!;
				const sourceImaginary = source.imaginary[spectrumOffset]!;
				const maskReal = masks[maskOffset]!;
				const maskImaginary = masks[maskOffset + frequencyBinCount * timeFrameCount]!;
				real[spectrumOffset] = sourceReal * maskReal - sourceImaginary * maskImaginary;
				imaginary[spectrumOffset] = sourceReal * maskImaginary + sourceImaginary * maskReal;
			}
		}
		return Object.freeze({ real, imaginary });
	});
	return Object.freeze({ ...spectrum, channels: Object.freeze(channels) });
}
