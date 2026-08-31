import { audacityWaveformMode } from '../audacity-waveform-renderer.js';
import { WAVEFORM_PEAKS_VERSION } from '../waveform-peak-contract.ts';
import type {
	NumericChannel,
	PreparedWaveformWindow,
	SummaryWaveformChannel,
	ValidatedPeakChannel,
	ValidatedPeakLevel,
	ValidatedPeakPyramid,
	WaveformRendering,
} from './types.ts';
import {
	clamp,
	fadeEnvelope,
	positiveSafeInteger,
} from './validation.ts';


interface WaveformCompatibility {
	readonly channels: Float32Array[];
	readonly sampleCount: number;
	readonly framesPerBucket: number;
	readonly downsampled: true;
}

export interface AudacityWaveformRenderingOptions {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly pixelWidth: number;
	readonly gain: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly reversed: boolean;
	readonly sourceFrameOffset: number;
}

export function waveformCompatibilityFromSummary(
	rendering: WaveformRendering,
	frameCount: number,
	maximumSamples: number,
): WaveformCompatibility {
	const summaryChannels = rendering.channels as readonly SummaryWaveformChannel[];
	if (maximumSamples === 1) {
		return {
			channels: summaryChannels.map((channel) => Float32Array.of(summaryChannelPeak(channel))),
			sampleCount: 1,
			framesPerBucket: frameCount,
			downsampled: true,
		};
	}
	const columnCount = summaryChannels[0]?.minimum.length || 0;
	const bucketCount = Math.max(1, Math.min(columnCount, Math.floor(maximumSamples / 2)));
	const channels = summaryChannels.map((channel) => {
		const output = new Float32Array(bucketCount * 2);
		for (let bucket = 0; bucket < bucketCount; bucket += 1) {
			const bucketStart = Math.floor(bucket * columnCount / bucketCount);
			const bucketEnd = Math.max(bucketStart + 1, Math.floor((bucket + 1) * columnCount / bucketCount));
			let minimum = Number.POSITIVE_INFINITY;
			let maximum = Number.NEGATIVE_INFINITY;
			for (let column = bucketStart; column < bucketEnd; column += 1) {
				minimum = Math.min(minimum, finiteWaveformSample(channel.minimum[column]));
				maximum = Math.max(maximum, finiteWaveformSample(channel.maximum[column]));
			}
			output[bucket * 2] = minimum;
			output[bucket * 2 + 1] = maximum;
		}
		return output;
	});
	return {
		channels,
		sampleCount: bucketCount * 2,
		framesPerBucket: frameCount / bucketCount,
		downsampled: true,
	};
}

function summaryChannelPeak(channel: SummaryWaveformChannel): number {
	let peak = 0;
	for (let index = 0; index < channel.minimum.length; index += 1) {
		const minimum = finiteWaveformSample(channel.minimum[index]);
		const maximum = finiteWaveformSample(channel.maximum[index]);
		if (Math.abs(minimum) > Math.abs(peak)) peak = minimum;
		if (Math.abs(maximum) > Math.abs(peak)) peak = maximum;
	}
	return peak;
}

function finiteWaveformSample(value: unknown): number {
	const sample = Number(value);
	return Number.isFinite(sample) ? sample : 0;
}

export function validateWaveformPeakLevels(peaks: unknown): ValidatedPeakPyramid {
	const candidate = peaks as {
		readonly version?: unknown;
		readonly channelCount?: unknown;
		readonly levels?: unknown;
	} | null;
	if (!candidate || typeof candidate !== 'object'
		|| candidate.version !== WAVEFORM_PEAKS_VERSION || !Array.isArray(candidate.levels)) {
		throw new TypeError(`A version ${WAVEFORM_PEAKS_VERSION} waveform peak pyramid is required.`);
	}
	const channelCount = positiveSafeInteger(candidate.channelCount, 'peaks.channelCount');
	const levels = candidate.levels.map((untypedLevel: unknown): ValidatedPeakLevel => {
		if (!untypedLevel || typeof untypedLevel !== 'object') {
			throw new TypeError('Each waveform peak level must be an object.');
		}
		const level = untypedLevel as {
			readonly blockSize?: unknown;
			readonly channels?: unknown;
		};
		const blockSize = positiveSafeInteger(level.blockSize, 'peak level blockSize');
		if (!Array.isArray(level.channels) || level.channels.length !== channelCount) {
			throw new RangeError('Each waveform peak level must contain every source channel.');
		}
		const channels = level.channels.map((untypedChannel: unknown): ValidatedPeakChannel => {
			const channel = untypedChannel as {
				readonly minimums?: unknown;
				readonly maximums?: unknown;
				readonly rms?: unknown;
			} | null;
			const minimums = channel?.minimums;
			const maximums = channel?.maximums;
			const rms = channel?.rms;
			if (
				(!Array.isArray(minimums) && !ArrayBuffer.isView(minimums))
				|| (!Array.isArray(maximums) && !ArrayBuffer.isView(maximums))
			) {
				throw new TypeError('Waveform peak extrema must be array-like.');
			}
			const typedMinimums = minimums as NumericChannel;
			const typedMaximums = maximums as NumericChannel;
			if (!typedMinimums.length || typedMinimums.length !== typedMaximums.length) {
				throw new RangeError('Waveform peak extrema must be non-empty equally sized arrays.');
			}
			if (rms != null && (
				(!Array.isArray(rms) && !ArrayBuffer.isView(rms))
				|| (rms as NumericChannel).length !== typedMinimums.length
			)) {
				throw new RangeError('Waveform RMS values must match the peak extrema.');
			}
			return {
				blockSize,
				minimums: typedMinimums,
				maximums: typedMaximums,
				rms: rms ? rms as NumericChannel : null,
			};
		});
		return { blockSize, channels };
	});
	if (!levels.length) throw new RangeError('peaks.levels must contain at least one level.');
	return { channelCount, levels: levels.sort((left, right) => left.blockSize - right.blockSize) };
}

export function selectWaveformPeakLevel(
	levels: readonly ValidatedPeakLevel[],
	sourceSamplesPerPixel: number,
): ValidatedPeakLevel {
	const targetBlockSize = Math.max(1, sourceSamplesPerPixel);
	let selected = levels[0];
	for (const level of levels) {
		if (level.blockSize > targetBlockSize) break;
		selected = level;
	}
	return selected;
}

export function aggregateWaveformPeakRange(
	level: ValidatedPeakChannel,
	absoluteStart: number,
	absoluteEnd: number,
): { readonly minimum: number; readonly maximum: number; readonly rms: number } {
	const startBlock = Math.max(0, Math.floor(absoluteStart / level.blockSize));
	const endBlock = Math.min(level.minimums.length, Math.max(
		startBlock + 1,
		Math.ceil(absoluteEnd / level.blockSize),
	));
	if (startBlock >= level.minimums.length || endBlock <= startBlock) {
		throw new RangeError('The waveform peak pyramid does not cover the requested clip range.');
	}
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	let squareSum = 0;
	for (let block = startBlock; block < endBlock; block += 1) {
		minimum = Math.min(minimum, finiteWaveformSample(level.minimums[block]));
		maximum = Math.max(maximum, finiteWaveformSample(level.maximums[block]));
		const blockRms = finiteWaveformSample(level.rms?.[block]);
		squareSum += blockRms * blockRms;
	}
	return { minimum, maximum, rms: Math.sqrt(squareSum / (endBlock - startBlock)) };
}

export function maximumFadeEnvelope(
	startFrame: number,
	endFrame: number,
	durationFrames: number,
	fadeInFrames: number,
	fadeOutFrames: number,
): number {
	const candidates = [
		startFrame,
		endFrame,
		clamp(fadeInFrames, startFrame, endFrame),
		clamp(durationFrames - fadeOutFrames, startFrame, endFrame),
		clamp(durationFrames / 2, startFrame, endFrame),
	];
	let maximum = 0;
	for (const frame of candidates) {
		maximum = Math.max(
			maximum,
			fadeEnvelope(frame, durationFrames, fadeInFrames, fadeOutFrames),
		);
	}
	return maximum;
}

/*
 * GPL-3.0-only browser adaptation of Audacity's WaveDataCache and sample
 * painters. Exact upstream paths and revision are in THIRD_PARTY_LICENSES.md.
 */
export function prepareAudacityWaveformRendering(
	sourceChannels: readonly NumericChannel[],
	options: AudacityWaveformRenderingOptions,
): WaveformRendering {
	const sourceSamplesPerTimelineFrame = options.sourceDurationFrames / options.durationFrames;
	const visibleSourceStart = options.startFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceEnd = options.endFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceSamples = options.frameCount * sourceSamplesPerTimelineFrame;
	const pixelsPerSample = options.pixelWidth / visibleSourceSamples;
	const mode = audacityWaveformMode(pixelsPerSample) as string;
	const transformSourceSample = (channel: number, visualOrdinal: number): number => {
		const sourceLocalFrame = options.reversed
			? options.sourceDurationFrames - visualOrdinal - 1
			: visualOrdinal;
		const sample = Number(sourceChannels[channel][options.sourceStartFrame + sourceLocalFrame - options.sourceFrameOffset]);
		const timelineFrame = visualOrdinal / sourceSamplesPerTimelineFrame;
		return (Number.isFinite(sample) ? sample : 0)
			* options.gain
			* fadeEnvelope(timelineFrame, options.durationFrames, options.fadeInFrames, options.fadeOutFrames);
	};
	const common = {
		mode,
		pixelWidth: options.pixelWidth,
		pixelsPerSample,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		frameCount: options.frameCount,
	};

	if (mode !== 'summary') {
		const sourceLength = sourceChannels[0]?.length ?? 0;
		const firstAvailableSample = options.reversed
			? options.sourceStartFrame + options.sourceDurationFrames - options.sourceFrameOffset - sourceLength
			: options.sourceFrameOffset - options.sourceStartFrame;
		const lastAvailableSample = options.reversed
			? options.sourceStartFrame + options.sourceDurationFrames - options.sourceFrameOffset - 1
			: options.sourceFrameOffset + sourceLength - options.sourceStartFrame - 1;
		const firstSample = Math.max(0, firstAvailableSample, Math.floor(visibleSourceStart));
		const lastSample = Math.min(
			options.sourceDurationFrames - 1,
			lastAvailableSample,
			Math.ceil(visibleSourceEnd),
		);
		return {
			...common,
			channels: sourceChannels.map((_, channel) => {
				const samples = new Float32Array(Math.max(0, lastSample - firstSample + 1));
				for (let index = 0; index < samples.length; index += 1) {
					samples[index] = transformSourceSample(channel, firstSample + index);
				}
				return {
					firstSample,
					firstSampleX: (firstSample - visibleSourceStart) * pixelsPerSample,
					samples,
				};
			}),
		};
	}

	const columnCount = Math.max(1, Math.ceil(options.pixelWidth));
	const sourceSamplesPerPixel = 1 / pixelsPerSample;
	const lastVisibleSourceFrame = Math.ceil(visibleSourceEnd) - 1;
	return {
		...common,
		channels: sourceChannels.map((_, channel) => {
			const minimum = new Float32Array(columnCount);
			const maximum = new Float32Array(columnCount);
			const rms = new Float32Array(columnCount);
			for (let column = 0; column < columnCount; column += 1) {
				const rawStart = Math.min(visibleSourceEnd, visibleSourceStart + column * sourceSamplesPerPixel);
				const rawEnd = Math.min(visibleSourceEnd, visibleSourceStart + (column + 1) * sourceSamplesPerPixel);
				let bucketStart = clamp(Math.round(rawStart), 0, options.sourceDurationFrames);
				let bucketEnd = clamp(Math.round(rawEnd), 0, options.sourceDurationFrames);
				if (bucketEnd <= bucketStart) {
					bucketStart = clamp(
						Math.min(Math.floor(rawStart), lastVisibleSourceFrame),
						0,
						options.sourceDurationFrames - 1,
					);
					bucketEnd = bucketStart + 1;
				}
				let bucketMinimum = Number.POSITIVE_INFINITY;
				let bucketMaximum = Number.NEGATIVE_INFINITY;
				let squareSum = 0;
				for (let visualOrdinal = bucketStart; visualOrdinal < bucketEnd; visualOrdinal += 1) {
					const sample = transformSourceSample(channel, visualOrdinal);
					bucketMinimum = Math.min(bucketMinimum, sample);
					bucketMaximum = Math.max(bucketMaximum, sample);
					squareSum += sample * sample;
				}
				let joinedToPrevious = false;
				if (column > 0 && minimum[column - 1] > bucketMaximum) {
					bucketMaximum = minimum[column - 1];
					joinedToPrevious = true;
				}
				if (column > 0 && maximum[column - 1] < bucketMinimum) {
					bucketMinimum = maximum[column - 1];
					joinedToPrevious = true;
				}
				minimum[column] = bucketMinimum;
				maximum[column] = bucketMaximum;
				const bucketRms = Math.sqrt(squareSum / (bucketEnd - bucketStart));
				rms[column] = joinedToPrevious ? clamp(bucketRms, bucketMinimum, bucketMaximum) : bucketRms;
			}
			return { minimum, maximum, rms };
		}),
	};
}

export function withWaveformRendering<
	Result extends Omit<PreparedWaveformWindow, 'rendering'>,
>(result: Result, rendering: WaveformRendering | null): Result & { readonly rendering?: WaveformRendering } {
	if (rendering) Object.defineProperty(result, 'rendering', { value: rendering });
	return result as Result & { readonly rendering?: WaveformRendering };
}
