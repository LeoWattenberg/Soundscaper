/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectUnwarpedClipSourceRange } from '../../audio-clip-source-projection.ts';
import {
	createAudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import {
	FREQUENCY_WAVEFORM_SILENCE_WEIGHT,
	frequencyWaveformCentroidColor,
	selectFrequencyWaveformLevel,
	validateFrequencyWaveformAnalysis,
	validateFrequencyWaveformWindow,
	type FrequencyWaveformBandChannel,
	type FrequencyWaveformLevel,
	type FrequencyWaveformWindow,
} from '../../frequency-waveform-contract.ts';
import type {
	SummaryWaveformChannel,
	WaveformRendering,
} from '../../design-system-adapters/types.ts';
import { maximumFadeEnvelope } from '../../design-system-adapters/waveform-internals.ts';

type FrequencyBandName = 'low' | 'mid' | 'high';

export interface FrequencyWaveformProjectionClip {
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly durationFrames: number;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly reversed?: boolean;
	readonly inverted?: boolean;
	readonly warpMap?: unknown;
	readonly kind?: unknown;
	readonly anchor?: unknown;
	readonly musicalStartBeat?: unknown;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: unknown;
}

export interface FrequencyWaveformProjectionOptions {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelWidth: number;
	readonly project?: AudioWarpRuntimeProject | null;
}

export interface FrequencyWaveformProjection {
	readonly sampleRate: number;
	readonly peakBlockSize: number;
	readonly bands: Readonly<Record<FrequencyBandName, WaveformRendering>>;
	readonly centroidHz: Float32Array;
	readonly centroidWeight: Float32Array;
}

/**
 * Project a source-owned frequency summary into the exact visible clip window.
 * The output deliberately mirrors an Audacity summary plan so the canvas owns
 * no signal processing and can reuse the established waveform painter.
 */
export function prepareFrequencyWaveformProjection(
	value: unknown,
	clip: FrequencyWaveformProjectionClip,
	options: FrequencyWaveformProjectionOptions,
): FrequencyWaveformProjection {
	let analysis: ReturnType<typeof validateFrequencyWaveformAnalysis> | null = null;
	let window: FrequencyWaveformWindow | null = null;
	try {
		analysis = validateFrequencyWaveformAnalysis(value);
	} catch (analysisError) {
		try {
			window = validateFrequencyWaveformWindow(value);
		} catch {
			throw analysisError;
		}
	}
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(
		clip.sourceDurationFrames ?? durationFrames,
		'clip.sourceDurationFrames',
	);
	const startFrame = localFrame(options.startFrame, durationFrames, 'startFrame');
	const endFrame = localFrame(options.endFrame, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const pixelWidth = positiveFinite(options.pixelWidth, 'pixelWidth');
	const frameCount = endFrame - startFrame;
	const columnCount = frameCount ? Math.max(1, Math.ceil(pixelWidth)) : 0;
	const sourceRangeAt = createSourceRangeProjector(
		clip,
		options.project,
		durationFrames,
		sourceStartFrame,
		sourceDurationFrames,
	);
	const visibleSourceRange = sourceRangeAt(startFrame, endFrame);
	const sourceWindowStart = window?.startFrame ?? 0;
	const sourceWindowEnd = window ? window.startFrame + window.frameCount : analysis!.frameCount;
	if (Math.floor(visibleSourceRange.startFrame) < sourceWindowStart
		|| Math.ceil(visibleSourceRange.endFrame) > sourceWindowEnd) {
		throw new RangeError('The requested clip exceeds the frequency analysis source frame count.');
	}
	const visibleSourceFrames = Math.max(0, visibleSourceRange.endFrame - visibleSourceRange.startFrame);
	const level = analysis
		? selectFrequencyWaveformLevel(analysis.levels, visibleSourceFrames / pixelWidth)
		: null;
	const peakBlockSize = level?.blockSize ?? 1;
	const sourceBands = level?.bands ?? window!.bands;
	const signedGain = finiteNumber(clip.gain ?? 1, 'clip.gain') * (clip.inverted ? -1 : 1);
	const fadeInFrames = localFrame(clip.fadeInFrames ?? 0, durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = localFrame(clip.fadeOutFrames ?? 0, durationFrames, 'clip.fadeOutFrames');
	const centroidHz = new Float32Array(columnCount);
	const centroidWeight = new Float32Array(columnCount);
	const bandChannels = Object.fromEntries((['low', 'mid', 'high'] as const).map((band) => [
		band,
		sourceBands[band].map((): SummaryWaveformChannel => ({
			minimum: new Float32Array(columnCount),
			maximum: new Float32Array(columnCount),
			rms: null,
		})),
	])) as Record<FrequencyBandName, SummaryWaveformChannel[]>;

	for (let column = 0; column < columnCount; column += 1) {
		const localStart = startFrame + frameCount * column / columnCount;
		const localEnd = startFrame + frameCount * (column + 1) / columnCount;
		const sourceRange = sourceRangeAt(localStart, localEnd);
		const fade = maximumFadeEnvelope(
			localStart,
			localEnd,
			durationFrames,
			fadeInFrames,
			fadeOutFrames,
		);
		const signedScale = signedGain * fade;
		for (const band of ['low', 'mid', 'high'] as const) {
			for (let channelIndex = 0; channelIndex < sourceBands[band].length; channelIndex += 1) {
				const range = level
					? aggregateBandRange(
						level.bands[band][channelIndex]!,
						level.blockSize,
						sourceRange.startFrame,
						sourceRange.endFrame,
					)
					: aggregateWindowBandRange(
						window!.bands[band][channelIndex]!,
						window!.startFrame,
						sourceRange.startFrame,
						sourceRange.endFrame,
					);
				const output = bandChannels[band][channelIndex]!;
				let minimum = Math.min(range.minimum * signedScale, range.maximum * signedScale);
				let maximum = Math.max(range.minimum * signedScale, range.maximum * signedScale);
				if (column > 0 && output.minimum[column - 1]! > maximum) maximum = output.minimum[column - 1]!;
				if (column > 0 && output.maximum[column - 1]! < minimum) minimum = output.maximum[column - 1]!;
				output.minimum[column] = minimum;
				output.maximum[column] = maximum;
			}
		}
		const centroid = level
			? aggregateCentroid(level, sourceRange.startFrame, sourceRange.endFrame)
			: aggregateWindowCentroid(window!, sourceRange.startFrame, sourceRange.endFrame);
		const magnitudeScale = Math.abs(signedScale);
		const scaledWeight = centroid.weight * magnitudeScale;
		centroidWeight[column] = scaledWeight;
		centroidHz[column] = scaledWeight > FREQUENCY_WAVEFORM_SILENCE_WEIGHT
			? centroid.numerator / centroid.weight
			: 0;
	}

	const renderingCommon = {
		mode: 'summary',
		pixelWidth,
		pixelsPerSample: visibleSourceFrames ? pixelWidth / visibleSourceFrames : 0,
		startFrame,
		endFrame,
		frameCount,
		peakBlockSize,
	};
	return {
		sampleRate: analysis?.sampleRate ?? window!.sampleRate,
		peakBlockSize,
		bands: {
			low: { ...renderingCommon, channels: bandChannels.low },
			mid: { ...renderingCommon, channels: bandChannels.mid },
			high: { ...renderingCommon, channels: bandChannels.high },
		},
		centroidHz,
		centroidWeight,
	};
}

function aggregateWindowBandRange(
	channel: Float32Array,
	windowStartFrame: number,
	absoluteStart: number,
	absoluteEnd: number,
): Readonly<{ minimum: number; maximum: number }> {
	const { start, end } = bucketRange(
		channel.length,
		1,
		absoluteStart - windowStartFrame,
		absoluteEnd - windowStartFrame,
	);
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (let frame = start; frame < end; frame += 1) {
		const sample = finiteSample(channel[frame]);
		minimum = Math.min(minimum, sample);
		maximum = Math.max(maximum, sample);
	}
	return { minimum, maximum };
}

/** Map spectral centroid to the log-frequency palette used by Freesound waveforms. */
export function frequencyWaveformColor(frequencyHz: number, weight: number, sampleRate: number): string {
	const magnitude = finiteNumber(weight, 'weight');
	const frequency = finiteNumber(frequencyHz, 'frequencyHz');
	return frequencyWaveformCentroidColor(frequency * magnitude, magnitude, sampleRate);
}

function createSourceRangeProjector(
	clip: FrequencyWaveformProjectionClip,
	project: AudioWarpRuntimeProject | null | undefined,
	durationFrames: number,
	sourceStartFrame: number,
	sourceDurationFrames: number,
): (startFrame: number, endFrame: number) => Readonly<{ startFrame: number; endFrame: number }> {
	if (clip.warpMap != null) {
		if (!project) throw new TypeError('A project is required to project a warped frequency waveform.');
		const evaluator = createAudioWarpRuntimeEvaluator(
			project,
			clip as Parameters<typeof createAudioWarpRuntimeEvaluator>[1],
		);
		return (startFrame, endFrame) => {
			const first = rationalNumber(evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + startFrame));
			const last = rationalNumber(evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + endFrame));
			return { startFrame: Math.min(first, last), endFrame: Math.max(first, last) };
		};
	}
	return (startFrame, endFrame) => projectUnwarpedClipSourceRange({
		durationFrames,
		sourceStartFrame,
		sourceDurationFrames,
		reversed: Boolean(clip.reversed),
	}, startFrame, endFrame);
}

function aggregateBandRange(
	channel: FrequencyWaveformBandChannel,
	blockSize: number,
	absoluteStart: number,
	absoluteEnd: number,
): Readonly<{ minimum: number; maximum: number }> {
	const { start, end } = bucketRange(channel.minimums.length, blockSize, absoluteStart, absoluteEnd);
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (let bucket = start; bucket < end; bucket += 1) {
		minimum = Math.min(minimum, finiteSample(channel.minimums[bucket]));
		maximum = Math.max(maximum, finiteSample(channel.maximums[bucket]));
	}
	return { minimum, maximum };
}

function aggregateCentroid(
	level: FrequencyWaveformLevel,
	absoluteStart: number,
	absoluteEnd: number,
): Readonly<{ numerator: number; weight: number }> {
	const { start, end } = bucketRange(
		level.centroid.weights.length,
		level.blockSize,
		absoluteStart,
		absoluteEnd,
	);
	let numerator = 0;
	let weight = 0;
	for (let bucket = start; bucket < end; bucket += 1) {
		numerator += finiteSample(level.centroid.numerators[bucket]);
		weight += Math.max(0, finiteSample(level.centroid.weights[bucket]));
	}
	return { numerator, weight };
}

function aggregateWindowCentroid(
	window: FrequencyWaveformWindow,
	absoluteStart: number,
	absoluteEnd: number,
): Readonly<{ numerator: number; weight: number }> {
	if (!window.centroid.weights.length) return { numerator: 0, weight: 0 };
	const { start, end } = bucketRange(
		window.centroid.weights.length,
		window.centroid.hopSize,
		absoluteStart - window.centroid.firstCenterFrame,
		absoluteEnd - window.centroid.firstCenterFrame,
	);
	let numerator = 0;
	let weight = 0;
	for (let bucket = start; bucket < end; bucket += 1) {
		numerator += finiteSample(window.centroid.numerators[bucket]);
		weight += Math.max(0, finiteSample(window.centroid.weights[bucket]));
	}
	return { numerator, weight };
}

function bucketRange(length: number, blockSize: number, startFrame: number, endFrame: number) {
	const start = Math.max(0, Math.min(length - 1, Math.floor(startFrame / blockSize)));
	const end = Math.min(length, Math.max(start + 1, Math.ceil(endFrame / blockSize)));
	if (!length || end <= start) throw new RangeError('Frequency analysis does not cover the requested source range.');
	return { start, end };
}

function finiteSample(value: unknown): number {
	const sample = Number(value);
	return Number.isFinite(sample) ? sample : 0;
}

function localFrame(value: unknown, durationFrames: number, name: string): number {
	const frame = nonNegativeSafeInteger(value, name);
	if (frame > durationFrames) throw new RangeError(`${name} must remain within the clip duration.`);
	return frame;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function finiteNumber(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function rationalNumber(value: Readonly<{ num: number; den: number }>): number {
	return value.num / value.den;
}
