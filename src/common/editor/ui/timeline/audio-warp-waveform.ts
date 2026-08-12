/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import {
	aggregateWaveformPeakRange,
	maximumFadeEnvelope,
	selectWaveformPeakLevel,
	validateWaveformPeakLevels,
	waveformCompatibilityFromSummary,
	withWaveformRendering,
} from '../../design-system-adapters/waveform-internals.ts';
import type {
	NumericChannel,
	PeakPyramidWindowOptions,
	PreparedWaveformWindow,
	SummaryWaveformChannel,
	WaveformRendering,
} from '../../design-system-adapters/types.ts';

const DEFAULT_MAXIMUM_WAVEFORM_SAMPLES = 4_096;

export interface AudioWarpWaveformClip extends AudioWarpRuntimeClip {
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

export interface AudioWarpWaveformOptions {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly maxSamples?: number;
	readonly pixelWidth: number;
	readonly sourceFrameOffset?: number;
}

export type AudioWarpPeakPyramidWaveformOptions = PeakPyramidWindowOptions;

/** Build one bounded summary whose column ranges come from the shared warp evaluator. */
export function prepareAudioWarpWaveformWindow(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpWaveformClip,
	sourceChannels: readonly NumericChannel[],
	options: Readonly<AudioWarpWaveformOptions>,
): PreparedWaveformWindow {
	const sourceLength = validateChannels(sourceChannels);
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const startFrame = localFrame(options.startFrame ?? 0, durationFrames, 'startFrame');
	const endFrame = localFrame(options.endFrame ?? durationFrames, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const pixelWidth = positiveFinite(options.pixelWidth, 'pixelWidth');
	const sourceFrameOffset = nonNegativeSafeInteger(options.sourceFrameOffset ?? 0, 'sourceFrameOffset');
	const maximumSamples = positiveSafeInteger(
		Math.floor(options.maxSamples ?? DEFAULT_MAXIMUM_WAVEFORM_SAMPLES),
		'maxSamples',
	);
	const frameCount = endFrame - startFrame;
	const columnCount = frameCount ? Math.max(1, Math.ceil(pixelWidth)) : 0;
	const evaluator = createAudioWarpRuntimeEvaluator(project, clip);
	const mappedStart = rationalNumber(evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + startFrame));
	const mappedEnd = rationalNumber(evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + endFrame));
	if (Math.floor(mappedStart) < sourceFrameOffset
		|| Math.ceil(mappedEnd) > sourceFrameOffset + sourceLength) {
		throw new RangeError('The warped waveform window exceeds the supplied source channels.');
	}
	const visibleSourceSamples = Math.max(0, mappedEnd - mappedStart);
	const rendering: WaveformRendering = {
		mode: 'summary',
		pixelWidth,
		pixelsPerSample: visibleSourceSamples ? pixelWidth / visibleSourceSamples : 0,
		startFrame,
		endFrame,
		frameCount,
		channels: sourceChannels.map((channel) => renderChannel(
			channel,
			clip,
			startFrame,
			frameCount,
			columnCount,
			sourceFrameOffset,
			evaluator.sourceAtTimelineFrame,
		)),
	};
	if (!frameCount) {
		return withWaveformRendering({
			channels: sourceChannels.map(() => new Float32Array(0)),
			startFrame,
			endFrame,
			frameCount,
			sampleCount: 0,
			framesPerBucket: 0,
			downsampled: true,
		}, rendering);
	}
	const compatibility = waveformCompatibilityFromSummary(rendering, frameCount, maximumSamples);
	return withWaveformRendering({ ...compatibility, startFrame, endFrame, frameCount }, rendering);
}

/** Build an exact warped summary directly from the persisted peak pyramid. */
export function prepareAudioWarpPeakPyramidWaveformWindow(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpWaveformClip,
	peaks: unknown,
	options: Readonly<AudioWarpPeakPyramidWaveformOptions>,
): PreparedWaveformWindow {
	const validated = validateWaveformPeakLevels(peaks);
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const startFrame = localFrame(options.startFrame ?? 0, durationFrames, 'startFrame');
	const endFrame = localFrame(options.endFrame ?? durationFrames, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const pixelWidth = positiveFinite(options.pixelWidth, 'pixelWidth');
	const maximumSamples = positiveSafeInteger(
		Math.floor(options.maxSamples ?? DEFAULT_MAXIMUM_WAVEFORM_SAMPLES),
		'maxSamples',
	);
	const channelCount = positiveSafeInteger(
		Math.floor(options.channelCount ?? validated.channelCount),
		'channelCount',
	);
	if (channelCount > validated.channelCount) {
		throw new RangeError('channelCount exceeds the channels stored in the waveform peak pyramid.');
	}
	const evaluator = createAudioWarpRuntimeEvaluator(project, clip);
	const sourceStart = rationalNumber(evaluator.sourceAtTimelineFrame(
		clip.timelineStartFrame + startFrame,
	));
	const sourceEnd = rationalNumber(evaluator.sourceAtTimelineFrame(
		clip.timelineStartFrame + endFrame,
	));
	if (options.sourceFrameCount != null) {
		const sourceFrameCount = nonNegativeSafeInteger(options.sourceFrameCount, 'sourceFrameCount');
		if (Math.floor(sourceStart) < 0 || Math.ceil(sourceEnd) > sourceFrameCount) {
			throw new RangeError('The warped clip exceeds the supplied source frame count.');
		}
	}
	const frameCount = endFrame - startFrame;
	const columnCount = frameCount ? Math.max(1, Math.ceil(pixelWidth)) : 0;
	const visibleSourceSamples = Math.max(0, sourceEnd - sourceStart);
	const sourceSamplesPerPixel = visibleSourceSamples / pixelWidth;
	const pixelsPerSample = visibleSourceSamples ? pixelWidth / visibleSourceSamples : 0;
	const level = selectWaveformPeakLevel(validated.levels, sourceSamplesPerPixel);
	const gain = finiteNumber(clip.gain ?? 1, 'clip.gain');
	const fadeInFrames = localFrame(clip.fadeInFrames ?? 0, durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = localFrame(clip.fadeOutFrames ?? 0, durationFrames, 'clip.fadeOutFrames');
	const channels: SummaryWaveformChannel[] = Array.from({ length: channelCount }, (_, channelIndex) => {
		const channel = level.channels[channelIndex];
		if (!channel) throw new RangeError('The waveform peak pyramid does not contain the requested channel.');
		const minimum = new Float32Array(columnCount);
		const maximum = new Float32Array(columnCount);
		const rms = channel.rms ? new Float32Array(columnCount) : null;
		for (let column = 0; column < columnCount; column += 1) {
			const localStart = startFrame + frameCount * column / columnCount;
			const localEnd = startFrame + frameCount * (column + 1) / columnCount;
			const absoluteStart = rationalNumber(evaluator.sourceAtTimelineFrame(
				clip.timelineStartFrame + Math.floor(localStart),
			));
			const absoluteEnd = rationalNumber(evaluator.sourceAtTimelineFrame(
				clip.timelineStartFrame + Math.ceil(localEnd),
			));
			const range = aggregateWaveformPeakRange(channel, absoluteStart, absoluteEnd);
			const scale = gain * maximumFadeEnvelope(
				localStart,
				localEnd,
				durationFrames,
				fadeInFrames,
				fadeOutFrames,
			);
			let bucketMinimum = Math.min(range.minimum * scale, range.maximum * scale);
			let bucketMaximum = Math.max(range.minimum * scale, range.maximum * scale);
			if (column > 0 && minimum[column - 1]! > bucketMaximum) bucketMaximum = minimum[column - 1]!;
			if (column > 0 && maximum[column - 1]! < bucketMinimum) bucketMinimum = maximum[column - 1]!;
			minimum[column] = bucketMinimum;
			maximum[column] = bucketMaximum;
			if (rms) rms[column] = Math.abs(range.rms * scale);
		}
		return { minimum, maximum, rms };
	});
	const rendering: WaveformRendering = {
		mode: 'summary',
		pixelWidth,
		pixelsPerSample,
		startFrame,
		endFrame,
		frameCount,
		peakBlockSize: level.blockSize,
		channels,
	};
	if (!frameCount) {
		return withWaveformRendering({
			channels: Array.from({ length: channelCount }, () => new Float32Array(0)),
			startFrame,
			endFrame,
			frameCount,
			sampleCount: 0,
			framesPerBucket: 0,
			downsampled: true,
		}, rendering);
	}
	const compatibility = waveformCompatibilityFromSummary(rendering, frameCount, maximumSamples);
	return withWaveformRendering({ ...compatibility, startFrame, endFrame, frameCount }, rendering);
}

function renderChannel(
	channel: NumericChannel,
	clip: AudioWarpWaveformClip,
	startFrame: number,
	frameCount: number,
	columnCount: number,
	sourceFrameOffset: number,
	sourceAtTimelineFrame: (timelineFrame: number) => Readonly<{ num: number; den: number }>,
): SummaryWaveformChannel {
	const minimum = new Float32Array(columnCount);
	const maximum = new Float32Array(columnCount);
	const rms = new Float32Array(columnCount);
	const gain = finiteNumber(clip.gain ?? 1, 'clip.gain');
	const fadeInFrames = localFrame(clip.fadeInFrames ?? 0, clip.durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = localFrame(clip.fadeOutFrames ?? 0, clip.durationFrames, 'clip.fadeOutFrames');
	for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
		const localStart = startFrame + frameCount * columnIndex / columnCount;
		const localEnd = startFrame + frameCount * (columnIndex + 1) / columnCount;
		const sourceStart = rationalNumber(sourceAtTimelineFrame(
			clip.timelineStartFrame + Math.floor(localStart),
		));
		const sourceEnd = rationalNumber(sourceAtTimelineFrame(
			clip.timelineStartFrame + Math.ceil(localEnd),
		));
		const sampleStart = Math.floor(sourceStart);
		let sampleEnd = Math.ceil(sourceEnd);
		if (sampleEnd <= sampleStart) sampleEnd = sampleStart + 1;
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		let squareSum = 0;
		let count = 0;
		for (let sourceFrame = sampleStart; sourceFrame < sampleEnd; sourceFrame += 1) {
			const sourceSpan = Math.max(Number.EPSILON, sourceEnd - sourceStart);
			const position = Math.max(0, Math.min(1, (sourceFrame - sourceStart) / sourceSpan));
			const timelineFrame = localStart + (localEnd - localStart) * position;
			const scale = gain * fadeEnvelope(timelineFrame, clip.durationFrames, fadeInFrames, fadeOutFrames);
			const value = finiteSample(channel[sourceFrame - sourceFrameOffset]) * scale;
			low = Math.min(low, value);
			high = Math.max(high, value);
			squareSum += value * value;
			count += 1;
		}
		minimum[columnIndex] = count ? low : 0;
		maximum[columnIndex] = count ? high : 0;
		rms[columnIndex] = count ? Math.sqrt(squareSum / count) : 0;
	}
	return { minimum, maximum, rms };
}

function fadeEnvelope(
	frame: number,
	durationFrames: number,
	fadeInFrames: number,
	fadeOutFrames: number,
): number {
	const fadeIn = fadeInFrames ? Math.max(0, Math.min(1, frame / fadeInFrames)) : 1;
	const fadeOutStart = durationFrames - fadeOutFrames;
	const fadeOut = fadeOutFrames && frame > fadeOutStart
		? Math.max(0, Math.min(1, (durationFrames - frame) / fadeOutFrames))
		: 1;
	return Math.min(fadeIn, fadeOut);
}

function validateChannels(channels: readonly NumericChannel[]): number {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new RangeError('Warped waveform PCM requires at least one source channel.');
	}
	const length = Number(channels[0]?.length);
	if (!Number.isSafeInteger(length) || length < 0
		|| channels.some((channel) => Number(channel?.length) !== length)) {
		throw new RangeError('Warped waveform source channels must have matching finite lengths.');
	}
	return length;
}

function localFrame(value: unknown, duration: number, name: string): number {
	const frame = nonNegativeSafeInteger(value, name);
	if (frame > duration) throw new RangeError(`${name} must remain within the clip duration.`);
	return frame;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be positive and finite.`);
	}
	return value;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function finiteSample(value: unknown): number {
	const sample = Number(value);
	return Number.isFinite(sample) ? sample : 0;
}

function rationalNumber(value: Readonly<{ num: number; den: number }>): number {
	return value.num / value.den;
}
