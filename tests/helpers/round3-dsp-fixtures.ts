/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import * as basic from '../../src/common/editor/audacity-effects/basic.js';
import * as spectral from '../../src/common/editor/audacity-effects/spectral.js';
import * as edits from '../../src/common/editor/spectral-edit.js';
import { initializePffft } from '../../src/common/editor/pffft.js';
import { createAudacityLiveProcessor } from '../../src/common/editor/audacity-effects/live.js';
import { LiveProcessor } from '../../src/common/editor/audacity-effects/live-processor-base.js';
import { createTremoloProcessor } from '../../src/common/editor/first-party-effects/standard/tremolo-dsp.ts';
import { createVocoderProcessor } from '../../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { createNoiseGateProcessor } from '../../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { createBitcrusherProcessor } from '../../src/common/editor/first-party-effects/bitcrusher/dsp.js';

export function round3Audio(frames: number, channel = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => frame % 31 === 0 ? -0
		: (frame % 997 < 81 ? .71 : .017) * Math.sin(frame * .071 + channel) + Math.cos(frame * .173) * .011);
}

export function round3Digest(channels: readonly (Float32Array | Float64Array)[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

interface BlockProcessor {
	processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void;
	updateParams(params: Readonly<Record<string, unknown>>): void;
}

function render(processor: BlockProcessor, input: readonly Float32Array[], blockSize: number,
	updates: readonly Readonly<Record<string, unknown>>[] = []): Float32Array[] {
	const result = input.map(channel => new Float32Array(channel.length));
	let block = 0;
	for (let start = 0; start < input[0]!.length; start += blockSize) {
		if (updates[block]) processor.updateParams(updates[block]!);
		const end = Math.min(input[0]!.length, start + blockSize);
		processor.processBlock(input.map(channel => channel.subarray(start, end)), result.map(channel => channel.subarray(start, end)), end - start);
		block++;
	}
	return result;
}

/** Generated from an independent bundle of the merged baseline before source edits. */
export async function collectRound3DspFixtures(): Promise<Record<string, string>> {
	await initializePffft();
	const result: Record<string, string> = {};
	const small = [round3Audio(3089), round3Audio(3089, 1), round3Audio(3089, 2)];
	for (const usePeak of [false, true]) for (const normalize of [false, true]) for (const ratio of [1.1, 6]) {
		result[`legacy-${String(usePeak)}-${String(normalize)}-${String(ratio)}`] = round3Digest(basic.applyAudacityLegacyCompressor(small, 8000, { usePeak, normalize, ratio }));
	}
	for (const stereoIndependent of [false, true]) for (const mode of ['lufs', 'rms']) {
		result[`loudness-${mode}-${String(stereoIndependent)}`] = round3Digest(basic.applyAudacityLoudnessNormalization(small, 8000, { stereoIndependent, mode }));
	}
	for (const frames of [4097, 8192, 12289, 20113]) for (const maximumWidth of [1, 4, 20, 40]) {
		const input = [round3Audio(frames), round3Audio(frames, 1)];
		input[0]![2048] = .99; input[1]![3077] = -.99;
		result[`click-${String(frames)}-${String(maximumWidth)}`] = round3Digest(spectral.applyAudacityClickRemoval(input, 8000, { maximumWidth }));
	}
	for (const frames of [1025, 5099]) {
		const input = [round3Audio(frames), round3Audio(frames, 1)];
		const profile = spectral.captureAudacityNoiseProfile([round3Audio(4097)], 8000);
		result[`noise-profile-${String(frames)}`] = round3Digest([profile.meanPowers]);
		for (const frequencySmoothingBands of [0, 6, 12]) for (const output of ['reduce', 'residue']) {
			result[`noise-${String(frames)}-${String(frequencySmoothingBands)}-${output}`] = round3Digest(spectral.applyAudacityNoiseReduction(input, 8000, { output, frequencySmoothingBands }, profile));
		}
	}
	for (const channelCount of [1, 2, 3]) for (const stretchFactor of [1, 2.3]) {
		result[`paulstretch-${String(channelCount)}-${String(stretchFactor)}`] = round3Digest(spectral.applyAudacityPaulstretch(small.slice(0, channelCount), 8000, { stretchFactor, timeResolution: .032 }, { seed: 71 }));
	}
	for (const windowSize of [32, 256, 2048]) for (const hopSize of [windowSize / 4, windowSize]) for (const gainDb of [-Infinity, -7, 11]) {
		const options = { sampleRate: 8000, startFrame: 17, endFrame: 3088, minimumFrequency: 71, maximumFrequency: 2301, windowSize, hopSize, gainDb };
		result[`spectral-gain-${String(windowSize)}-${String(hopSize)}-${String(gainDb)}`] = round3Digest(edits.applySpectralGain(small, options));
		result[`spectral-replacement-${String(windowSize)}-${String(hopSize)}`] = round3Digest(edits.applySpectralReplacement(small, small.map(channel => Float32Array.from(channel, sample => sample * .37)), options));
	}
	for (const filterLength of [21, 127, 513]) {
		const params = { filterLength, points: [{ frequency: 20, gain: -7 }, { frequency: 997, gain: 4 }, { frequency: 4000, gain: -11 }] };
		for (const linearFrequencyScale of [false, true]) {
			result[`filter-eq-${String(filterLength)}-${String(linearFrequencyScale)}`] = round3Digest(spectral.applyAudacityFilterCurveEq(small, 8000, { ...params, linearFrequencyScale }));
		}
		const live = createAudacityLiveProcessor('audacity-filter-curve-eq', 8000, params);
		if (!(live instanceof LiveProcessor)) throw new TypeError('Expected Audacity live processor.');
		const input = [round3Audio(12817), round3Audio(12817, 1)];
		const output = input.map(channel => new Float32Array(channel.length));
		for (let start = 0; start < input[0]!.length; start += 127) {
			live.process(input.map(channel => channel.subarray(start, start + 127)), output.map(channel => channel.subarray(start, start + 127)));
		}
		result[`live-eq-${String(filterLength)}`] = round3Digest(output);
	}
	for (const waveform of ['sine', 'triangle', 'sawtooth', 'inverse-sawtooth', 'square']) for (const blockSize of [1, 127, 3089]) {
		const processor = createTremoloProcessor({ sampleRate: 8000, channelCount: 3, params: { waveform, frequency: 100, phase: 179, depth: 71 } });
		result[`tremolo-${waveform}-${String(blockSize)}`] = round3Digest(render(processor, small, blockSize));
	}
	for (const frequency of [0, 997]) for (const stereoLink of ['linked', 'independent']) {
		const processor = createNoiseGateProcessor({ sampleRate: 8000, channelCount: 3, params: { gateFrequency: frequency, stereoLink, lookahead: .013, attack: .019 } });
		result[`gate-${String(frequency)}-${stereoLink}`] = round3Digest(render(processor, small, 127, [{}, { threshold: '-24' }, { gateFrequency: 997 }, { release: .073 }]));
	}
	for (const channelCount of [1, 2, 3]) {
		const processor = createVocoderProcessor({ sampleRate: 8000, channelCount, params: { bands: 12, noiseLevel: 17 } });
		result[`vocoder-${String(channelCount)}`] = round3Digest(render(processor, small.slice(0, channelCount), 127, [{}, { distance: 32 }, { outputMode: 'right-only' }, { bands: 18 }]));
	}
	for (const dither of ['none', 'rectangular', 'triangular', 'triangular-highpass', 'shaped']) for (const interpolation of ['sample-hold', 'linear', 'smooth', 'cubic']) {
		const processor = createBitcrusherProcessor({ sampleRate: 8000, channelCount: 3, seed: 37, params: { dither, interpolation, downsampling: 3.7, bitDepth: 7 } });
		result[`bitcrusher-${dither}-${interpolation}`] = round3Digest(render(processor, small, 127, [{}, { dither, interpolation, downsampling: 3.7, bitDepth: 7 }, { dither: 'shaped', interpolation: 'cubic' }, { dither, interpolation }]));
	}
	return result;
}
