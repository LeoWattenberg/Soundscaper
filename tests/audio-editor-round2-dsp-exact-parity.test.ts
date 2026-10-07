/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as basic from '../src/common/editor/audacity-effects/basic.js';
import * as realtime from '../src/common/editor/audacity-effects/realtime.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { LiveProcessor } from '../src/common/editor/audacity-effects/live-processor-base.js';
import { ReverbLiveProcessor } from '../src/common/editor/audacity-effects/reverb-live-processor.ts';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { createStreamingLinearResampler, createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { BandCompressor } from '../src/common/editor/first-party-effects/dynamics/core.ts';

function digest(channels: readonly (Float32Array | Float64Array)[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}
function audio(frames: number, channel = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => frame % 31 === 0 ? -0
		: frame % 37 === 0 ? 0 : Math.sin(frame * .071 + channel) * .7 + Math.cos(frame * .173) * .11);
}
function fixtures(): Record<string, string> {
	const output: Record<string, string> = {};
	const channels = [audio(3089), audio(3089, 1), audio(3089, 2)];
	for (const removeDc of [false, true]) for (const applyGain of [false, true]) for (const stereoIndependent of [false, true]) {
		output[`normalize-${String(removeDc)}-${String(applyGain)}-${String(stereoIndependent)}`] = digest(basic.applyAudacityNormalize(channels, 48000, { removeDc, applyGain, stereoIndependent }));
	}
	for (const usePeak of [false, true]) for (const normalize of [false, true]) {
		output[`legacy-${String(usePeak)}-${String(normalize)}`] = digest(basic.applyAudacityLegacyCompressor(channels, 48000, { usePeak, normalize }));
	}
	for (const count of [1, 2, 3, 7, 13, 127]) output[`repeat-${String(count)}`] = digest(basic.applyAudacityRepeat(channels, 48000, { count }));
	for (const mode of realtime.AUDACITY_DISTORTION_MODES as readonly string[]) for (const dcBlock of [false, true]) {
		const params = { mode, dcBlock, parameter1: 57, parameter2: 43, repeats: 2, thresholdDb: -11 };
		output[`distortion-${mode}-${String(dcBlock)}`] = digest(realtime.applyAudacityDistortion(channels, 48000, params));
		const live = createAudacityLiveProcessor('audacity-distortion', 48000, params);
		assert.ok(live instanceof LiveProcessor);
		const result = channels.map(channel => new Float32Array(channel.length));
		live.process(channels, result);
		output[`live-distortion-${mode}-${String(dcBlock)}`] = digest(result);
		live.updateParams({ parameter2: 17, dcBlock: !dcBlock });
		live.process(channels, result);
		output[`live-distortion-update-${mode}-${String(dcBlock)}`] = digest(result);
	}
	for (const type of ['audacity-phaser', 'audacity-echo'] as const) {
		const params = type === 'audacity-phaser' ? { stages: 8, feedbackPercent: 37 } : { delaySeconds: .001, decay: .51 };
		const apply = type === 'audacity-phaser' ? realtime.applyAudacityPhaser : realtime.applyAudacityEcho;
		output[type] = digest(apply(channels, 48000, params));
		const live = createAudacityLiveProcessor(type, 48000, params);
		const result = channels.map(channel => new Float32Array(channel.length));
		for (let start = 0; start < channels[0]!.length; start += 127) {
			live.process(channels.map(channel => channel.subarray(start, start + 127)), result.map(channel => channel.subarray(start, start + 127)));
		}
		output[`live-${type}`] = digest(result);
	}
	for (const channelCount of [1, 2, 3]) {
		const source = channels.slice(0, channelCount);
		const reverb = new ReverbLiveProcessor(8000, { preDelay: 3, reverberance: 71, damping: 39 });
		const result = source.map(() => new Float32Array(12031));
		for (let start = 0; start < 12031; start += 127) {
			const count = Math.min(127, 12031 - start);
			const input = source.map(channel => { const block = new Float32Array(count); if (start < channel.length) block.set(channel.subarray(start, start + count)); return block; });
			reverb.process(input, result.map(channel => channel.subarray(start, start + count)));
			if (start === 127) reverb.updateParams({ damping: 39 });
		}
		output[`reverb-${String(channelCount)}`] = digest(result);
	}
	for (const type of ['tone', 'chirp'] as const) for (const waveform of ['sine', 'square', 'sawtooth']) for (const interpolation of ['linear', 'logarithmic']) {
		const renderer = createAudioEditorSignalRenderer(type, { sampleRate: 8000, channelCount: 2, durationSeconds: .813,
			frequency: 997, startFrequency: 13, endFrequency: 3999, startAmplitude: .13, endAmplitude: .97, waveform, interpolation });
		const result = Array.from({ length: 2 }, () => new Float32Array(renderer.frameCount));
		let offset = 0;
		for (let block = renderer.next(127); block; block = renderer.next(127)) {
			result.forEach((channel, index) => channel.set(block[index]!, offset)); offset += block[0]!.length;
		}
		output[`generator-${type}-${waveform}-${interpolation}`] = digest(result);
	}
	for (const type of ['morse', 'noise'] as const) for (const color of ['white', 'pink', 'brown']) {
		const renderer = createAudioEditorSignalRenderer(type, { sampleRate: 8000, channelCount: 3, durationSeconds: .817, color, text: 'SOS TEST', wordsPerMinute: 29, amplitude: .37, seed: 42 });
		const result = Array.from({ length: 3 }, () => new Float32Array(renderer.frameCount));
		let offset = 0;
		for (let block = renderer.next(129); block; block = renderer.next(129)) {
			result.forEach((channel, index) => channel.set(block[index]!, offset)); offset += block[0]!.length;
		}
		output[`generator-${type}-${color}`] = digest(result);
	}
	for (const size of [32, 256, 2048]) for (const average of [false, true]) {
		output[`spectrum-${String(size)}-${String(average)}`] = createHash('sha256').update(JSON.stringify(calculateAudioSpectrum(channels, 48000, { size, average, offsetFrame: 17 }))).digest('hex');
	}
	for (const kind of ['linear', 'sinc']) for (const rate of [8000, 44100, 48000, 96000]) for (const blockSize of [1, 127, 1024, 8192]) {
		const createResampler = kind === 'linear' ? createStreamingLinearResampler : createStreamingWindowedSincResampler;
		const resampler = createResampler(48000, rate, channels.length) as { push(input: Float32Array[]): Float32Array[]; finish(): Float32Array[] };
		const blocks: Float32Array[][] = [];
		for (let start = 0; start < channels[0]!.length; start += blockSize) blocks.push(resampler.push(channels.map(channel => channel.subarray(start, start + blockSize))));
		blocks.push(resampler.finish());
		const frames = blocks.reduce((total, block) => total + block[0]!.length, 0);
		const result = channels.map(() => new Float32Array(frames));
		let offset = 0;
		for (const block of blocks) { result.forEach((channel, index) => channel.set(block[index]!, offset)); offset += block[0]!.length; }
		output[`${kind}-${String(rate)}-${String(blockSize)}`] = digest(result);
	}
	for (const mix of [0, .37, 1]) for (const delayType of ['regular', 'bouncing-ball', 'reverse-bouncing-ball']) {
		const delay = createStandardDelayProcessor({ sampleRate: 8000, channelCount: 3, params: { mix, delayType, echoes: 3, time: .001 } });
		const result = channels.map(channel => new Float32Array(channel.length));
		for (let start = 0; start < channels[0]!.length; start += 127) delay.processBlock(channels.map(channel => channel.subarray(start, start + 127)), result.map(channel => channel.subarray(start, start + 127)), Math.min(127, channels[0]!.length - start));
		output[`delay-${String(mix)}-${delayType}`] = digest(result);
	}
	const filter = createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate: 48000, channelCount: 3, params: { frequency: 997, rolloff: 24 } });
	const filtered = channels.map(channel => new Float32Array(channel.length));
	filter.processBlock(channels, filtered, channels[0]!.length);
	filter.updateParams({ frequency: '997' });
	filter.processBlock(channels, filtered, channels[0]!.length);
	output.filter = digest(filtered);
	for (const channelCount of [1, 2, 3]) {
		const source = channels.slice(0, channelCount);
		const vocoder = createVocoderProcessor({ sampleRate: 48000, channelCount, params: { bands: 12, noiseLevel: 17 } });
		const result = source.map(channel => new Float32Array(channel.length));
		vocoder.processBlock(source, result, source[0]!.length);
		output[`vocoder-${String(channelCount)}`] = digest(result);
	}
	for (const ratio of [1, 6]) {
		const compressor = new BandCompressor(48000);
		compressor.configure(-24, ratio, .01, .1);
		const result = Float64Array.from({ length: 3089 }, (_, frame) => compressor.gain(Math.sin(frame * .01) ** 2));
		compressor.configure(-24, 6, .01, .1);
		output[`band-${String(ratio)}`] = digest([result, Float64Array.of(compressor.gain(.5))]);
	}
	return output;
}

test('round-two DSP retains exact pre-change Float32/Float64 words across all optimized owners', () => {
	const expected: unknown = JSON.parse(readFileSync(new URL('./fixtures/dsp-round2-parity.json', import.meta.url), 'utf8'));
	assert.deepEqual(fixtures(), expected);
});
