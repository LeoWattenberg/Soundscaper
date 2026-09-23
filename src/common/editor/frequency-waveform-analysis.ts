/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Rainbow spectral-centroid analysis adapted from Freesound's processing.py at
 * commit ef5e42938c9ca4aace39d9d04b65752d161321e8. Copyright (C) 2008 MUSIC
 * TECHNOLOGY GROUP (MTG), UNIVERSITAT POMPEU FABRA; author Bram de Jong;
 * AGPL-3.0-or-later upstream, with version 3 selected for this adaptation.
 * See THIRD_PARTY_LICENSES.md for the exact source and modification notice.
 */

import { ComplementaryCrossover } from './complementary-crossover.ts';
import {
	FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	frequencyWaveformBlockSizes,
	frequencyWaveformVisualChannelCount,
	normalizeFrequencyWaveformCrossovers,
	type FrequencyWaveformAnalysis,
	type FrequencyWaveformBands,
	type FrequencyWaveformCrossovers,
	type FrequencyWaveformWindow,
} from './frequency-waveform-contract.ts';
import { fft, initializePffft } from './pffft.js';

export type FrequencyWaveformFft = (real: Float32Array, imaginary: Float32Array) => void;

export interface FrequencyWaveformAnalyzerOptions {
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly crossovers?: FrequencyWaveformCrossovers;
}

export interface GenerateFrequencyWaveformOptions {
	readonly crossovers?: FrequencyWaveformCrossovers;
}

export interface GenerateFrequencyWaveformWindowOptions extends GenerateFrequencyWaveformOptions {
	/** Original source metadata when only the first visual channels were transported. */
	readonly sourceChannelCount?: number;
	/** Absolute source frame represented by channels[0][0]. */
	readonly sourceStartFrame?: number;
	/** First returned frame relative to the supplied channel arrays. */
	readonly visibleStartOffset?: number;
	/** Returned frame count. Defaults to the remaining supplied samples. */
	readonly visibleFrameCount?: number;
}

interface MutableBandChannel {
	readonly minimums: Float32Array;
	readonly maximums: Float32Array;
}

interface MutableLevel {
	readonly blockSize: number;
	readonly bands: FrequencyWaveformBands<MutableBandChannel[]>;
	readonly centroid: {
		readonly numerators: Float32Array;
		readonly weights: Float32Array;
	};
}

export class FrequencyWaveformBandSplitter {
	private readonly lower: ComplementaryCrossover;
	private readonly upper: ComplementaryCrossover;
	private readonly lowerBypassed: boolean;
	private readonly upperBypassed: boolean;
	private readonly channelCount: number;

	constructor(
		private readonly sampleRate: number,
		channelCount: number,
		crossovers: FrequencyWaveformCrossovers,
	) {
		validateGeometry(sampleRate, channelCount);
		const normalized = normalizeFrequencyWaveformCrossovers(crossovers);
		this.channelCount = channelCount;
		this.lower = new ComplementaryCrossover(sampleRate, channelCount, normalized.lowMidHz);
		this.upper = new ComplementaryCrossover(sampleRate, channelCount, normalized.midHighHz);
		this.lowerBypassed = normalized.lowMidHz >= sampleRate / 2;
		this.upperBypassed = normalized.midHighHz >= sampleRate / 2;
	}

	process(channels: readonly Float32Array[]): FrequencyWaveformBands<Float32Array[]> {
		const frames = validateChannels(channels, this.channelCount);
		const output = {
			low: Array.from({ length: this.channelCount }, () => new Float32Array(frames)),
			mid: Array.from({ length: this.channelCount }, () => new Float32Array(frames)),
			high: Array.from({ length: this.channelCount }, () => new Float32Array(frames)),
		};
		for (let frame = 0; frame < frames; frame += 1) {
			this.lower.tick();
			this.upper.tick();
			for (let channel = 0; channel < this.channelCount; channel += 1) {
				const input = finiteSample(channels[channel]![frame]);
				const low = this.lowerBypassed ? input : this.lower.low(input, channel);
				const upperLow = this.upperBypassed ? input : this.upper.low(input, channel);
				output.low[channel]![frame] = low;
				output.mid[channel]![frame] = upperLow - low;
				output.high[channel]![frame] = input - upperLow;
			}
		}
		return output;
	}

	reset(): void {
		this.lower.reset();
		this.upper.reset();
	}
}

export class FrequencyWaveformAnalyzer {
	private readonly options: Required<FrequencyWaveformAnalyzerOptions>;
	private readonly visualChannelCount: number;
	private readonly splitter: FrequencyWaveformBandSplitter;
	private readonly levels: MutableLevel[];
	private readonly spectralBuffers: Float32Array[];
	private readonly hann: Float32Array;
	private readonly real = new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE);
	private readonly imaginary = new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE);
	private spectralLength = FREQUENCY_WAVEFORM_FFT_SIZE / 2;
	private nextCenterFrame = 0;
	private framesProcessed = 0;
	private finished = false;

	constructor(options: FrequencyWaveformAnalyzerOptions, private readonly transform: FrequencyWaveformFft) {
		validateGeometry(options.sampleRate, options.channelCount);
		if (!Number.isSafeInteger(options.frameCount) || options.frameCount < 0) {
			throw new RangeError('Invalid frequency waveform frame count.');
		}
		this.options = {
			...options,
			crossovers: normalizeFrequencyWaveformCrossovers(options.crossovers),
		};
		this.visualChannelCount = frequencyWaveformVisualChannelCount(options.channelCount);
		this.splitter = new FrequencyWaveformBandSplitter(
			options.sampleRate,
			this.visualChannelCount,
			this.options.crossovers,
		);
		this.levels = frequencyWaveformBlockSizes(options.frameCount, options.channelCount)
			.map((blockSize) => createMutableLevel(
				blockSize,
				Math.ceil(options.frameCount / blockSize),
				this.visualChannelCount,
			));
		this.spectralBuffers = Array.from(
			{ length: this.visualChannelCount },
			() => new Float32Array(FREQUENCY_WAVEFORM_FFT_SIZE),
		);
		this.hann = Float32Array.from({ length: FREQUENCY_WAVEFORM_FFT_SIZE }, (_, index) => (
			0.5 - 0.5 * Math.cos(2 * Math.PI * index / (FREQUENCY_WAVEFORM_FFT_SIZE - 1))
		));
	}

	push(channels: readonly Float32Array[]): void {
		if (this.finished) throw new Error('Frequency waveform analysis is already finished.');
		if (channels.length !== this.options.channelCount && channels.length !== this.visualChannelCount) {
			throw new RangeError('Frequency waveform channel count changed.');
		}
		const frames = validateChannels(channels, channels.length);
		if (this.framesProcessed + frames > this.options.frameCount) {
			throw new RangeError('Frequency waveform chunks exceed the declared frame count.');
		}
		const visualChannels = channels.slice(0, this.visualChannelCount);
		const bands = this.splitter.process(visualChannels);
		for (let frame = 0; frame < frames; frame += 1) {
			const absoluteFrame = this.framesProcessed + frame;
			for (const level of this.levels) this.accumulateBands(level, bands, frame, absoluteFrame);
			this.appendSpectralFrame(visualChannels, frame);
		}
		this.framesProcessed += frames;
	}

	finish(): FrequencyWaveformAnalysis {
		if (this.finished) throw new Error('Frequency waveform analysis is already finished.');
		if (this.framesProcessed !== this.options.frameCount) {
			throw new RangeError('Frequency waveform chunks do not match the declared frame count.');
		}
		while (this.nextCenterFrame < this.options.frameCount) this.appendSpectralSilence();
		this.finished = true;
		for (const level of this.levels) replaceEmptyExtrema(level);
		return {
			version: FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
			sampleRate: this.options.sampleRate,
			frameCount: this.options.frameCount,
			channelCount: this.options.channelCount,
			visualChannelCount: this.visualChannelCount,
			crossovers: this.options.crossovers,
			fftSize: FREQUENCY_WAVEFORM_FFT_SIZE,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			levels: this.levels,
		};
	}

	private accumulateBands(
		level: MutableLevel,
		bands: FrequencyWaveformBands<Float32Array[]>,
		frame: number,
		absoluteFrame: number,
	): void {
		const bucket = Math.floor(absoluteFrame / level.blockSize);
		for (const band of ['low', 'mid', 'high'] as const) {
			for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
				const value = bands[band][channel]![frame]!;
				const target = level.bands[band][channel]!;
				target.minimums[bucket] = Math.min(target.minimums[bucket]!, value);
				target.maximums[bucket] = Math.max(target.maximums[bucket]!, value);
			}
		}
	}

	private appendSpectralFrame(channels: readonly Float32Array[], frame: number): void {
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			this.spectralBuffers[channel]![this.spectralLength] = finiteSample(channels[channel]![frame]);
		}
		this.spectralLength += 1;
		this.analyzeFullSpectralBuffer();
	}

	private appendSpectralSilence(): void {
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			this.spectralBuffers[channel]![this.spectralLength] = 0;
		}
		this.spectralLength += 1;
		this.analyzeFullSpectralBuffer();
	}

	private analyzeFullSpectralBuffer(): void {
		if (this.spectralLength < FREQUENCY_WAVEFORM_FFT_SIZE) return;
		let numerator = 0;
		let weight = 0;
		for (let channel = 0; channel < this.visualChannelCount; channel += 1) {
			const buffer = this.spectralBuffers[channel]!;
			this.imaginary.fill(0);
			for (let index = 0; index < FREQUENCY_WAVEFORM_FFT_SIZE; index += 1) {
				this.real[index] = buffer[index]! * this.hann[index]!;
			}
			this.transform(this.real, this.imaginary);
			for (let bin = 2; bin <= FREQUENCY_WAVEFORM_FFT_SIZE / 2; bin += 1) {
				const magnitude = Math.hypot(this.real[bin]!, this.imaginary[bin]!);
				weight += magnitude;
				numerator += magnitude * bin * this.options.sampleRate / FREQUENCY_WAVEFORM_FFT_SIZE;
			}
		}
		for (const level of this.levels) {
			const bucket = Math.floor(this.nextCenterFrame / level.blockSize);
			if (bucket < level.centroid.weights.length) {
				level.centroid.numerators[bucket] += numerator;
				level.centroid.weights[bucket] += weight;
			}
		}
		this.nextCenterFrame += FREQUENCY_WAVEFORM_HOP_SIZE;
		for (const buffer of this.spectralBuffers) {
			buffer.copyWithin(0, FREQUENCY_WAVEFORM_HOP_SIZE, FREQUENCY_WAVEFORM_FFT_SIZE);
			buffer.fill(0, FREQUENCY_WAVEFORM_FFT_SIZE - FREQUENCY_WAVEFORM_HOP_SIZE);
		}
		this.spectralLength -= FREQUENCY_WAVEFORM_HOP_SIZE;
	}
}

export async function generateFrequencyWaveformAnalysis(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: GenerateFrequencyWaveformOptions = {},
): Promise<FrequencyWaveformAnalysis> {
	await initializePffft();
	return generateFrequencyWaveformAnalysisWithFft(channels, sampleRate, options, fft);
}

export function generateFrequencyWaveformAnalysisWithFft(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: GenerateFrequencyWaveformOptions,
	transform: FrequencyWaveformFft,
): FrequencyWaveformAnalysis {
	const frameCount = validateChannels(channels, channels.length);
	const analyzer = new FrequencyWaveformAnalyzer({
		channelCount: channels.length,
		crossovers: options.crossovers,
		frameCount,
		sampleRate,
	}, transform);
	analyzer.push(channels.slice(0, frequencyWaveformVisualChannelCount(channels.length)));
	return analyzer.finish();
}

export async function generateFrequencyWaveformWindow(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: GenerateFrequencyWaveformWindowOptions = {},
): Promise<FrequencyWaveformWindow> {
	await initializePffft();
	return generateFrequencyWaveformWindowWithFft(channels, sampleRate, options, fft);
}

export function generateFrequencyWaveformWindowWithFft(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: GenerateFrequencyWaveformWindowOptions,
	transform: FrequencyWaveformFft,
): FrequencyWaveformWindow {
	const sourceChannelCount = options.sourceChannelCount ?? channels.length;
	const visualChannelCount = frequencyWaveformVisualChannelCount(sourceChannelCount);
	if (channels.length !== sourceChannelCount && channels.length !== visualChannelCount) {
		throw new RangeError('Frequency waveform channel count changed.');
	}
	const suppliedFrames = validateChannels(channels, channels.length);
	const visualChannels = channels.slice(0, visualChannelCount);
	const startOffset = integerInRange(options.visibleStartOffset ?? 0, 0, suppliedFrames, 'visible start offset');
	const visibleFrames = integerInRange(
		options.visibleFrameCount ?? suppliedFrames - startOffset,
		0,
		suppliedFrames - startOffset,
		'visible frame count',
	);
	const sourceStartFrame = integerInRange(
		options.sourceStartFrame ?? 0,
		0,
		Number.MAX_SAFE_INTEGER - suppliedFrames,
		'source start frame',
	);
	const crossovers = normalizeFrequencyWaveformCrossovers(options.crossovers);
	const splitter = new FrequencyWaveformBandSplitter(sampleRate, visualChannelCount, crossovers);
	const split = splitter.process(visualChannels);
	const bands = mapBands(split, (channel) => channel.slice(startOffset, startOffset + visibleFrames));
	const spectral = analyzeWindowCentroids(
		visualChannels,
		sampleRate,
		transform,
		sourceStartFrame,
		sourceChannelCount,
	);
	// Keep the immediately preceding center so a tiny visible range between hop
	// boundaries still has a deterministic predominant-frequency sample.
	const alignedSourceStart = sourceStartFrame
		- sourceStartFrame % FREQUENCY_WAVEFORM_HOP_SIZE;
	const firstVisibleCenter = Math.floor(
		(sourceStartFrame + startOffset - alignedSourceStart) / FREQUENCY_WAVEFORM_HOP_SIZE,
	);
	const endVisibleCenter = Math.ceil(
		(sourceStartFrame + startOffset + visibleFrames - alignedSourceStart)
			/ FREQUENCY_WAVEFORM_HOP_SIZE,
	);
	return {
		version: FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
		sampleRate,
		startFrame: sourceStartFrame + startOffset,
		frameCount: visibleFrames,
		channelCount: sourceChannelCount,
		visualChannelCount,
		crossovers,
		bands,
		centroid: {
			firstCenterFrame: alignedSourceStart + firstVisibleCenter * FREQUENCY_WAVEFORM_HOP_SIZE,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			numerators: spectral.numerators.slice(firstVisibleCenter, endVisibleCenter),
			weights: spectral.weights.slice(firstVisibleCenter, endVisibleCenter),
		},
	};
}

function analyzeWindowCentroids(
	channels: readonly Float32Array[],
	sampleRate: number,
	transform: FrequencyWaveformFft,
	sourceStartFrame: number,
	sourceChannelCount: number,
): { readonly numerators: Float32Array; readonly weights: Float32Array } {
	const alignmentOffset = sourceStartFrame % FREQUENCY_WAVEFORM_HOP_SIZE;
	const alignedChannels = alignmentOffset === 0 ? channels : channels.map((channel) => {
		const aligned = new Float32Array(channel.length + alignmentOffset);
		aligned.set(channel, alignmentOffset);
		return aligned;
	});
	const analyzer = new FrequencyWaveformAnalyzer({
		channelCount: sourceChannelCount,
		frameCount: alignedChannels[0]?.length || 0,
		sampleRate,
	}, transform);
	analyzer.push(alignedChannels);
	const level = analyzer.finish().levels[0]!;
	const centers = Math.ceil((alignedChannels[0]?.length || 0) / FREQUENCY_WAVEFORM_HOP_SIZE);
	const numerators = new Float32Array(centers);
	const weights = new Float32Array(centers);
	for (let center = 0; center < centers; center += 1) {
		const bucket = Math.floor(center * FREQUENCY_WAVEFORM_HOP_SIZE / level.blockSize);
		// The finest source pyramid bucket is one hop, so this remains exact.
		numerators[center] = level.centroid.numerators[bucket]!;
		weights[center] = level.centroid.weights[bucket]!;
	}
	return { numerators, weights };
}

function createMutableLevel(blockSize: number, buckets: number, channels: number): MutableLevel {
	const createChannels = (): MutableBandChannel[] => Array.from({ length: channels }, () => ({
		minimums: new Float32Array(buckets).fill(Number.POSITIVE_INFINITY),
		maximums: new Float32Array(buckets).fill(Number.NEGATIVE_INFINITY),
	}));
	return {
		blockSize,
		bands: { low: createChannels(), mid: createChannels(), high: createChannels() },
		centroid: { numerators: new Float32Array(buckets), weights: new Float32Array(buckets) },
	};
}

function replaceEmptyExtrema(level: MutableLevel): void {
	for (const band of ['low', 'mid', 'high'] as const) {
		for (const channel of level.bands[band]) {
			for (let bucket = 0; bucket < channel.minimums.length; bucket += 1) {
				if (!Number.isFinite(channel.minimums[bucket]!)) channel.minimums[bucket] = 0;
				if (!Number.isFinite(channel.maximums[bucket]!)) channel.maximums[bucket] = 0;
			}
		}
	}
}

function mapBands<T, U>(bands: FrequencyWaveformBands<readonly T[]>, map: (value: T) => U): FrequencyWaveformBands<U[]> {
	return {
		low: bands.low.map(map),
		mid: bands.mid.map(map),
		high: bands.high.map(map),
	};
}

function validateGeometry(sampleRate: number, channelCount: number): void {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000) {
		throw new RangeError('The sample rate must be an integer between 1 and 768000 Hz.');
	}
	frequencyWaveformVisualChannelCount(channelCount);
}

function validateChannels(channels: readonly Float32Array[], expectedChannels: number): number {
	if (channels.length !== expectedChannels || expectedChannels < 1) {
		throw new RangeError('Frequency waveform channel count changed.');
	}
	const frames = channels[0]?.length ?? 0;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array) || channel.length !== frames) {
			throw new TypeError('Frequency waveform channels must be equally sized Float32Arrays.');
		}
	}
	return frames;
}

function finiteSample(value: number | undefined): number {
	return Number.isFinite(value) ? value! : 0;
}

function integerInRange(value: number, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Invalid frequency waveform ${name}.`);
	}
	return value;
}
