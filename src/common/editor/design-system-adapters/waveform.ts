import { audacityWaveformMode } from '../audacity-waveform-renderer.js';
import type {
	NumericChannel,
	PeakPyramidWindowOptions,
	PreparedWaveformWindow,
	WaveformClipLike,
	WaveformRendering,
	WaveformWindowOptions,
} from './types.ts';
import {
	addFrames,
	clampedLocalFrame,
	fadeEnvelope,
	finiteNumber,
	nonNegativeSafeInteger,
	positiveFiniteNumber,
	positiveSafeInteger,
	validateSourceChannels,
} from './validation.ts';
import {
	aggregateWaveformPeakRange,
	maximumFadeEnvelope,
	prepareAudacityWaveformRendering,
	selectWaveformPeakLevel,
	validateWaveformPeakLevels,
	waveformCompatibilityFromSummary,
	withWaveformRendering,
} from './waveform-internals.ts';

const DEFAULT_MAXIMUM_WAVEFORM_SAMPLES = 4_096;

/** Prepare a bounded compatibility waveform and optional Audacity canvas plan. */
export function prepareBoundedWaveformWindow(
	sourceChannels: readonly NumericChannel[],
	clip: WaveformClipLike,
	options: WaveformWindowOptions = {},
): PreparedWaveformWindow {
	const sourceLength = validateSourceChannels(sourceChannels);
	if (!clip || typeof clip !== 'object') throw new TypeError('clip must be an object.');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames ?? durationFrames, 'clip.sourceDurationFrames');
	const sourceFrameOffset = nonNegativeSafeInteger(options.sourceFrameOffset ?? 0, 'sourceFrameOffset');

	const startFrame = clampedLocalFrame(options.startFrame ?? 0, durationFrames, 'startFrame');
	const endFrame = clampedLocalFrame(options.endFrame ?? durationFrames, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const frameCount = endFrame - startFrame;
	const reversed = Boolean(clip.reversed);
	if (frameCount) {
		const sourceSamplesPerTimelineFrame = sourceDurationFrames / durationFrames;
		const visibleSourceStart = startFrame * sourceSamplesPerTimelineFrame;
		const visibleSourceEnd = endFrame * sourceSamplesPerTimelineFrame;
		const absoluteStart = sourceStartFrame + (reversed
			? sourceDurationFrames - visibleSourceEnd
			: visibleSourceStart);
		const absoluteEnd = sourceStartFrame + (reversed
			? sourceDurationFrames - visibleSourceStart
			: visibleSourceEnd);
		if (Math.floor(absoluteStart) < sourceFrameOffset
			|| Math.ceil(absoluteEnd) > sourceFrameOffset + sourceLength) {
			throw new RangeError('The requested clip window exceeds the supplied source channels.');
		}
	}
	const maximumSamples = positiveSafeInteger(
		Math.floor(options.maxSamples ?? DEFAULT_MAXIMUM_WAVEFORM_SAMPLES),
		'maxSamples',
	);
	const pixelWidth = options.pixelWidth == null
		? null
		: positiveFiniteNumber(options.pixelWidth, 'pixelWidth');
	if (!frameCount) {
		return withWaveformRendering({
			channels: sourceChannels.map(() => new Float32Array(0)),
			startFrame,
			endFrame,
			frameCount: 0,
			sampleCount: 0,
			framesPerBucket: 0,
			downsampled: false,
		}, pixelWidth == null ? null : {
			mode: 'summary',
			pixelWidth,
			pixelsPerSample: 0,
			startFrame,
			endFrame,
			frameCount: 0,
			channels: sourceChannels.map(() => ({
				minimum: new Float32Array(0),
				maximum: new Float32Array(0),
				rms: new Float32Array(0),
			})),
		});
	}
	const gain = finiteNumber(clip.gain ?? 1, 'clip.gain');
	const fadeInFrames = clampedLocalFrame(clip.fadeInFrames ?? 0, durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = clampedLocalFrame(clip.fadeOutFrames ?? 0, durationFrames, 'clip.fadeOutFrames');
	const transformSample = (channel: number, localFrame: number): number => {
		const mappedFrame = Math.min(
			sourceDurationFrames - 1,
			Math.floor(localFrame * sourceDurationFrames / durationFrames),
		);
		const sourceLocalFrame = reversed ? sourceDurationFrames - mappedFrame - 1 : mappedFrame;
		const sourceFrame = sourceStartFrame + sourceLocalFrame;
		const sample = Number(sourceChannels[channel]?.[sourceFrame - sourceFrameOffset]);
		return (Number.isFinite(sample) ? sample : 0)
			* gain
			* fadeEnvelope(localFrame, durationFrames, fadeInFrames, fadeOutFrames);
	};
	const rendering = pixelWidth == null ? null : prepareAudacityWaveformRendering(sourceChannels, {
		sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		startFrame,
		endFrame,
		frameCount,
		pixelWidth,
		gain,
		fadeInFrames,
		fadeOutFrames,
		reversed,
		sourceFrameOffset,
	});
	if (rendering?.mode === 'summary' && options.reuseSummaryForCompatibility) {
		const compatibility = waveformCompatibilityFromSummary(rendering, frameCount, maximumSamples);
		return withWaveformRendering({
			...compatibility,
			startFrame,
			endFrame,
			frameCount,
		}, rendering);
	}

	if (frameCount <= maximumSamples) {
		const channels = sourceChannels.map((_, channel) => {
			const output = new Float32Array(frameCount);
			for (let index = 0; index < frameCount; index += 1) {
				output[index] = transformSample(channel, startFrame + index);
			}
			return output;
		});
		return withWaveformRendering({
			channels,
			startFrame,
			endFrame,
			frameCount,
			sampleCount: frameCount,
			framesPerBucket: 1,
			downsampled: false,
		}, rendering);
	}

	if (maximumSamples === 1) {
		const channels = sourceChannels.map((_, channel) => {
			let peak = 0;
			for (let localFrame = startFrame; localFrame < endFrame; localFrame += 1) {
				const sample = transformSample(channel, localFrame);
				if (Math.abs(sample) > Math.abs(peak)) peak = sample;
			}
			return Float32Array.of(peak);
		});
		return withWaveformRendering({
			channels,
			startFrame,
			endFrame,
			frameCount,
			sampleCount: 1,
			framesPerBucket: frameCount,
			downsampled: true,
		}, rendering);
	}

	const bucketCount = Math.max(1, Math.min(frameCount, Math.floor(maximumSamples / 2)));
	const sampleCount = bucketCount * 2;
	const channels = sourceChannels.map((_, channel) => {
		const output = new Float32Array(sampleCount);
		for (let bucket = 0; bucket < bucketCount; bucket += 1) {
			const bucketStart = startFrame + Math.floor(bucket * frameCount / bucketCount);
			const bucketEnd = startFrame + Math.floor((bucket + 1) * frameCount / bucketCount);
			let minimum = Number.POSITIVE_INFINITY;
			let maximum = Number.NEGATIVE_INFINITY;
			let minimumFrame = bucketStart;
			let maximumFrame = bucketStart;
			for (let localFrame = bucketStart; localFrame < bucketEnd; localFrame += 1) {
				const sample = transformSample(channel, localFrame);
				if (sample < minimum) {
					minimum = sample;
					minimumFrame = localFrame;
				}
				if (sample > maximum) {
					maximum = sample;
					maximumFrame = localFrame;
				}
			}
			const outputIndex = bucket * 2;
			if (minimumFrame <= maximumFrame) {
				output[outputIndex] = minimum;
				output[outputIndex + 1] = maximum;
			} else {
				output[outputIndex] = maximum;
				output[outputIndex + 1] = minimum;
			}
		}
		return output;
	});

	return withWaveformRendering({
		channels,
		startFrame,
		endFrame,
		frameCount,
		sampleCount,
		framesPerBucket: frameCount / bucketCount,
		downsampled: true,
	}, rendering);
}

/** Prepare an Audacity summary plan directly from a persisted peak pyramid. */
export function preparePeakPyramidWaveformWindow(
	peaks: unknown,
	clip: WaveformClipLike,
	options: PeakPyramidWindowOptions = {} as PeakPyramidWindowOptions,
): PreparedWaveformWindow {
	if (!clip || typeof clip !== 'object') throw new TypeError('clip must be an object.');
	const validatedPeaks = validateWaveformPeakLevels(peaks);
	const levels = validatedPeaks.levels;
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames ?? durationFrames, 'clip.sourceDurationFrames');
	const sourceEndFrame = addFrames(sourceStartFrame, sourceDurationFrames, 'clip source range');
	if (options.sourceFrameCount != null) {
		const sourceFrameCount = nonNegativeSafeInteger(options.sourceFrameCount, 'sourceFrameCount');
		if (sourceEndFrame > sourceFrameCount) throw new RangeError('The clip exceeds the supplied source frame count.');
	}

	const startFrame = clampedLocalFrame(options.startFrame ?? 0, durationFrames, 'startFrame');
	const endFrame = clampedLocalFrame(options.endFrame ?? durationFrames, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const frameCount = endFrame - startFrame;
	const maximumSamples = positiveSafeInteger(
		Math.floor(options.maxSamples ?? DEFAULT_MAXIMUM_WAVEFORM_SAMPLES),
		'maxSamples',
	);
	const pixelWidth = positiveFiniteNumber(options.pixelWidth, 'pixelWidth');
	const channelCount = positiveSafeInteger(
		Math.floor(options.channelCount ?? validatedPeaks.channelCount),
		'channelCount',
	);
	if (channelCount > validatedPeaks.channelCount) {
		throw new RangeError('channelCount exceeds the channels stored in the waveform peak pyramid.');
	}
	const columnCount = frameCount ? Math.max(1, Math.ceil(pixelWidth)) : 0;
	const sourceSamplesPerTimelineFrame = sourceDurationFrames / durationFrames;
	const visibleSourceStart = startFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceEnd = endFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceSamples = frameCount * sourceSamplesPerTimelineFrame;
	const sourceSamplesPerPixel = visibleSourceSamples / pixelWidth;
	const pixelsPerSample = visibleSourceSamples ? pixelWidth / visibleSourceSamples : 0;
	const level = selectWaveformPeakLevel(levels, sourceSamplesPerPixel);
	const gain = finiteNumber(clip.gain ?? 1, 'clip.gain');
	const fadeInFrames = clampedLocalFrame(clip.fadeInFrames ?? 0, durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = clampedLocalFrame(clip.fadeOutFrames ?? 0, durationFrames, 'clip.fadeOutFrames');
	const reversed = Boolean(clip.reversed);

	const renderingChannels = Array.from({ length: channelCount }, (_, channel) => {
		const channelLevel = level.channels[channel];
		if (!channelLevel) throw new RangeError('The waveform peak pyramid does not contain the requested channel.');
		const minimum = new Float32Array(columnCount);
		const maximum = new Float32Array(columnCount);
		const rms = channelLevel.rms && pixelsPerSample > 0 && audacityWaveformMode(pixelsPerSample) === 'summary'
			? new Float32Array(columnCount)
			: null;
		for (let column = 0; column < columnCount; column += 1) {
			const visualStart = Math.min(
				visibleSourceEnd,
				visibleSourceStart + column * sourceSamplesPerPixel,
			);
			const visualEnd = Math.min(
				visibleSourceEnd,
				visibleSourceStart + (column + 1) * sourceSamplesPerPixel,
			);
			const absoluteStart = sourceStartFrame + (reversed
				? sourceDurationFrames - visualEnd
				: visualStart);
			const absoluteEnd = sourceStartFrame + (reversed
				? sourceDurationFrames - visualStart
				: visualEnd);
			const range = aggregateWaveformPeakRange(channelLevel, absoluteStart, absoluteEnd);
			const localStart = visualStart / sourceSamplesPerTimelineFrame;
			const localEnd = visualEnd / sourceSamplesPerTimelineFrame;
			const scale = gain * maximumFadeEnvelope(
				localStart,
				localEnd,
				durationFrames,
				fadeInFrames,
				fadeOutFrames,
			);
			let bucketMinimum = Math.min(range.minimum * scale, range.maximum * scale);
			let bucketMaximum = Math.max(range.minimum * scale, range.maximum * scale);
			if (column > 0 && minimum[column - 1] > bucketMaximum) {
				bucketMaximum = minimum[column - 1];
			}
			if (column > 0 && maximum[column - 1] < bucketMinimum) {
				bucketMinimum = maximum[column - 1];
			}
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
		channels: renderingChannels,
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
	return withWaveformRendering({
		...compatibility,
		startFrame,
		endFrame,
		frameCount,
	}, rendering);
}
