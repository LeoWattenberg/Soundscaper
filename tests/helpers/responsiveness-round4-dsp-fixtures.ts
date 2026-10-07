/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createEbuR128Meter } from '../../src/common/editor/ebu-r128.js';
import { FrequencyWaveformAnalyzer, generateFrequencyWaveformWindowWithFft } from '../../src/common/editor/frequency-waveform-analysis.ts';
import { fft, initializePffft } from '../../src/common/editor/pffft.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';
import { createAudioEditorSignalRenderer } from '../../src/common/editor/signal-generator-renderer.ts';
import { createDeesserProcessor, applyDeesser } from '../../src/common/editor/first-party-effects/deesser/dsp.ts';
import { createMultibandCompressorProcessor, applyMultibandCompressor } from '../../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';
import { applyStandardEffect, createStandardEffectProcessor, type StandardEffectProcessor } from '../../src/common/editor/first-party-effects/standard/dsp.ts';
import { paintSpectrogram, pffftSpectrogramBandEnergies, preparePffftSpectrogram } from '../../src/common/editor/pffft-spectrogram.js';

export function round4Audio(frames: number, channel = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => frame % 43 === 0 ? -0
		: (frame % 877 < 101 ? .91 : .027) * Math.sin(frame * .073 + channel) + Math.cos(frame * .177) * .019);
}

/** Include typed-array bytes and exact double spellings, including signed zero. */
export function round4Digest(value: unknown): string {
	const hash = createHash('sha256');
	function visit(item: unknown): void {
		if (ArrayBuffer.isView(item)) {
			hash.update(item.constructor.name);
			hash.update(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
		} else if (Array.isArray(item)) {
			hash.update('['); for (const entry of item) visit(entry); hash.update(']');
		} else if (item !== null && typeof item === 'object') {
			for (const [key, entry] of Object.entries(item)) { hash.update(key); visit(entry); }
		} else hash.update(typeof item === 'number' && Object.is(item, -0) ? '-0' : String(item));
	}
	visit(value);
	return hash.digest('hex');
}

interface BlockProcessor extends StandardEffectProcessor { readAnalysis?: () => unknown }

function render(processor: BlockProcessor, input: readonly Float32Array[], blockSize: number): unknown {
	const output = input.map(channel => new Float32Array(channel.length));
	const analysis: unknown[] = [];
	let block = 0;
	for (let start = 0; start < input[0]!.length; start += blockSize) {
		if (block === 2) processor.updateParams({ threshold: -31, lowThreshold: -41 });
		if (block === 4) processor.updateParams({ attack: .007, release: .071 });
		if (block === 6) processor.reset();
		const end = Math.min(input[0]!.length, start + blockSize);
		processor.processBlock(input.map(channel => channel.subarray(start, end)), output.map(channel => channel.subarray(start, end)), end - start);
		if (processor.readAnalysis) analysis.push(processor.readAnalysis());
		block++;
	}
	return { output, analysis };
}

/** Frozen before production edits; every entry reaches a public production API. */
export async function collectRound4DspFixtures(): Promise<Record<string, string>> {
	await initializePffft();
	await preparePffftSpectrogram(64);
	const result: Record<string, string> = {};
	for (const rate of [8000, 11025, 48000]) for (const count of [1, 2, 6]) {
		const frames = Math.ceil(rate * 3.13);
		const input = Array.from({ length: count }, (_, channel) => round4Audio(frames, channel));
		input[0]!.fill(0, Math.floor(rate * 1.13), Math.floor(rate * 1.73));
		const meter = createEbuR128Meter({ sampleRate: rate, channelCount: count, running: true });
		const snapshots: unknown[] = [];
		for (let start = 0; start < frames; start += 997) {
			if (start === 997 * 3) meter.setRunning(false);
			if (start === 997 * 5) { meter.reset(); meter.setRunning(true); }
			meter.push(input.map(channel => channel.subarray(start, start + 997)), (snapshot: unknown) => snapshots.push(snapshot), start % 2 ? .7 : 1);
			snapshots.push(meter.snapshot(), meter.snapshot());
		}
		result[`ebu-${String(rate)}-${String(count)}`] = round4Digest(snapshots);
	}
	for (const count of [1, 2, 6]) for (const frames of [0, 1, 257, 4097]) for (const block of [1, 127, 8192]) {
		const input = Array.from({ length: count }, (_, channel) => round4Audio(frames, channel));
		if (frames > 257) { input[0]![129] = NaN; input[0]![257] = Infinity; }
		const analyzer = new FrequencyWaveformAnalyzer({ sampleRate: 8000, frameCount: frames, channelCount: count }, fft);
		for (let start = 0; start < frames; start += block) analyzer.push(input.map(channel => channel.subarray(start, start + block)));
		result[`waveform-${String(count)}-${String(frames)}-${String(block)}`] = round4Digest(analyzer.finish());
	}
	const input = [round4Audio(4097), round4Audio(4097, 1), round4Audio(4097, 2)];
	for (const startFrame of [0, 17, 1023]) result[`waveform-window-${String(startFrame)}`] = round4Digest(
		generateFrequencyWaveformWindowWithFft(input, 8000, { sourceStartFrame: startFrame, visibleStartOffset: 31, visibleFrameCount: 1701 }, fft));
	for (const size of [32, 256, 2048]) for (const offsetFrame of [0, .5, 4077]) for (const average of [false, true]) {
		result[`spectrum-${String(size)}-${String(offsetFrame)}-${String(average)}`] = round4Digest(calculateAudioSpectrum(input, 8000, { size, offsetFrame, average }));
	}
	for (const length of [2.5, 2, 7]) {
		const unusual = Float32Array.of(0, 1, .5, .25);
		Object.defineProperty(unusual, 'length', { value: length });
		result[`spectrum-reported-length-${String(length)}`] = round4Digest(calculateAudioSpectrum([unusual], 48000, { size: 32 }));
	}
	for (const channels of [1, 3]) for (const blockSize of [1, 127, 8192]) {
		const source = input.slice(0, channels);
		result[`deesser-live-${String(channels)}-${String(blockSize)}`] = round4Digest(render(createDeesserProcessor({ sampleRate: 8000, channelCount: channels }), source, blockSize));
		result[`multiband-live-${String(channels)}-${String(blockSize)}`] = round4Digest(render(createMultibandCompressorProcessor({ sampleRate: 8000, channelCount: channels }), source, blockSize));
	}
	result['deesser-offline'] = round4Digest(applyDeesser(input, 8000));
	result['multiband-offline'] = round4Digest(applyMultibandCompressor(input, 8000));
	for (const type of ['lowpass-filter', 'highpass-filter', 'notch-filter', 'shelf-filter', 'tremolo', 'noise-gate'] as const) {
		const params = type === 'noise-gate' ? { lookahead: .013 } : { rolloff: 48 };
		result[`standard-${type}`] = round4Digest(applyStandardEffect(type, input, 8000, params));
		if (type !== 'noise-gate') result[`standard-live-${type}`] = round4Digest(render(createStandardEffectProcessor({ type, sampleRate: 8000, channelCount: 3, params }), input, 127));
	}
	for (const waveform of ['sine', 'square', 'sawtooth']) for (const interpolation of ['linear', 'logarithmic']) for (const constant of [false, true]) {
		const options = { sampleRate: 8000, channelCount: 2, durationSeconds: .37, waveform, interpolation, startFrequency: 211, endFrequency: constant ? 211 : 977, startAmplitude: .7, endAmplitude: constant ? .7 : .13 };
		for (const block of [1, 127, 8192]) {
			const renderer = createAudioEditorSignalRenderer('chirp', options);
			const blocks: unknown[] = []; let chunk;
			while ((chunk = renderer.next(block))) blocks.push(chunk);
			result[`chirp-${waveform}-${interpolation}-${String(constant)}-${String(block)}`] = round4Digest(blocks);
		}
	}
	for (const type of ['dtmf', 'morse']) for (const block of [1, 127, 8192]) for (const scaled of [false, true]) {
		const options = { sampleRate: 8000, channelCount: 2, sequence: '11A*2', text: 'TEST SOS', toneSeconds: 2.11, silenceSeconds: .013,
			...(scaled ? { durationSeconds: 1.13 } : {}) };
		const renderer = createAudioEditorSignalRenderer(type, options); const blocks: unknown[] = []; let chunk;
		while ((chunk = renderer.next(block))) blocks.push(chunk);
		result[`${type}-${String(block)}-${String(scaled)}`] = round4Digest(blocks);
	}
	for (const fftWindowSize of [64, 256]) for (const bands of [1, 13, 32]) {
		const options = { fftWindowSize, frequencyBands: bands, pixelStart: 0, pixelEnd: 19, pixelSkip: 2 };
		result[`spectrogram-array-${String(fftWindowSize)}-${String(bands)}`] = round4Digest(pffftSpectrogramBandEnergies(input[0], 23, options));
		result[`spectrogram-accessor-${String(fftWindowSize)}-${String(bands)}`] = round4Digest(pffftSpectrogramBandEnergies({ length: 97, sampleAt: (frame: number) => Math.sin(frame * .073) }, 23, options));
	}
	for (const scale of ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period']) for (const height of [17, 127.5]) {
		const rectangles: unknown[] = [];
		const context = { fillStyle: '', fillRect(x: number, y: number, width: number, rectangleHeight: number) { rectangles.push([x, y, width, rectangleHeight, this.fillStyle]); } };
		paintSpectrogram(context, [[.1, .2, 0, .7], [.7, .2, .1, 0]], 3, 7, 2, height, { scale, minFreq: 11, maxFreq: 3777, sampleRate: 8000 });
		result[`spectrogram-paint-${scale}-${String(height)}`] = round4Digest(rectangles);
	}
	return result;
}
