/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBandDynamicsParams } from '../dynamics/definition.ts';
import { BandCompressor, ComplementaryCrossover, validateChannels, validateGeometry, type BandDynamicsOptions } from '../dynamics/core.ts';

/** Three complementary bands, each with independent stereo-linked compression.
 * The mid band is the difference of the two low-pass outputs. At unity gains
 * the band corrections are zero, preserving the original samples exactly.
 */
export function createMultibandCompressorProcessor({ sampleRate, channelCount, params = {} }: BandDynamicsOptions) {
	validateGeometry(sampleRate, channelCount);
	let settings = normalizeBandDynamicsParams('multiband-compressor', params);
	const lower = new ComplementaryCrossover(sampleRate, channelCount, settings.lowCrossover);
	const upper = new ComplementaryCrossover(sampleRate, channelCount, settings.highCrossover);
	const compressors = Array.from({ length: 3 }, () => new BandCompressor(sampleRate));
	const dry = new Float64Array(channelCount);
	const bands = Array.from({ length: 3 }, () => new Float64Array(channelCount));
	const powers = new Float64Array(3);
	const gains = new Float64Array(3);
	const makeup = new Float64Array(3);
	const targetMakeup = new Float64Array(3);
	const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
	let analysisFrames = 0;
	let analysisInputPeak = 0;
	let analysisOutputPeak = 0;
	let analysisMinimumGain = 1;
	function resetAnalysis(): void {
		analysisFrames = 0;
		analysisInputPeak = 0;
		analysisOutputPeak = 0;
		analysisMinimumGain = 1;
	}
	function updateParams(value: Readonly<Record<string, unknown>>): void {
		settings = normalizeBandDynamicsParams('multiband-compressor', { ...settings, ...value });
		lower.configure(settings.lowCrossover); upper.configure(settings.highCrossover);
		for (const [band, prefix] of ['low', 'mid', 'high'].entries()) {
			compressors[band].configure(settings[`${prefix}Threshold`], settings[`${prefix}Ratio`], settings.attack, settings.release);
			targetMakeup[band] = 10 ** (settings[`${prefix}Gain`] / 20);
		}
	}
	updateParams(settings);
	makeup.set(targetMakeup);
	return {
		updateParams,
		reset() {
			lower.reset(); upper.reset(); compressors.forEach(compressor => compressor.reset()); makeup.set(targetMakeup);
			resetAnalysis();
		},
		readAnalysis() {
			if (!analysisFrames) return null;
			const analysis = {
				frames: analysisFrames,
				inputPeak: analysisInputPeak,
				outputPeak: analysisOutputPeak,
				reductionDb: 20 * Math.log10(Math.max(1e-30, analysisMinimumGain)),
			};
			resetAnalysis();
			return analysis;
		},
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				lower.tick(); upper.tick(); powers.fill(0);
				for (let channel = 0; channel < channelCount; channel += 1) {
					const value = input[channel]?.[frame] ?? 0;
					dry[channel] = Number.isFinite(value) ? value : 0;
					analysisInputPeak = Math.max(analysisInputPeak, Math.abs(dry[channel]));
					const low = lower.low(dry[channel], channel);
					const lowMid = upper.low(dry[channel], channel);
					bands[0][channel] = low;
					bands[1][channel] = lowMid - low;
					bands[2][channel] = dry[channel] - lowMid;
					for (let band = 0; band < 3; band += 1) powers[band] = Math.max(powers[band], bands[band][channel] ** 2);
				}
				for (let band = 0; band < 3; band += 1) {
					makeup[band] += smoothing * (targetMakeup[band] - makeup[band]);
					const compressionGain = compressors[band].gain(powers[band]);
					analysisMinimumGain = Math.min(analysisMinimumGain, compressionGain);
					gains[band] = compressionGain * makeup[band];
				}
				for (let channel = 0; channel < output.length; channel += 1) {
					let value = dry[channel] ?? 0;
					if (channel < channelCount) {
						for (let band = 0; band < 3; band += 1) value += bands[band][channel] * (gains[band] - 1);
					}
					output[channel][frame] = value;
					analysisOutputPeak = Math.max(analysisOutputPeak, Math.abs(value));
				}
			}
			analysisFrames += frames;
		},
	};
}

export function applyMultibandCompressor(channels: readonly Float32Array[], sampleRate: number, params: Readonly<Record<string, unknown>> = {}) {
	const frames = validateChannels(channels, sampleRate);
	const processor = createMultibandCompressorProcessor({ sampleRate, channelCount: channels.length, params });
	const output = channels.map(() => new Float32Array(frames));
	processor.processBlock(channels, output, frames);
	return output;
}
