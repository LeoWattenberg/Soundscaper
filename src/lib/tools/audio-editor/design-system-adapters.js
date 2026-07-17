import { AUDIO_EDITOR_SAMPLE_RATE } from './project.js';
import { audacityWaveformMode } from './audacity-waveform-renderer.js';

export const DESIGN_SYSTEM_GAIN_DB_MINIMUM = -60;
export const DESIGN_SYSTEM_GAIN_DB_MAXIMUM = 12;

const DEFAULT_MAXIMUM_BACKING_SIZE = 8_192;
const DEFAULT_MAXIMUM_BACKING_PIXELS = 16_777_216;
const DEFAULT_MAXIMUM_PIXEL_RATIO = 2;
const DEFAULT_MAXIMUM_WAVEFORM_SAMPLES = 4_096;
const MAXIMUM_FRAME = Number.MAX_SAFE_INTEGER;

/**
 * Convert design-system seconds to the editor's canonical 48 kHz frames.
 * Values are rounded to the nearest frame and clamped to the requested range.
 */
export function secondsToFrames(seconds, options = {}) {
	const { minimumFrame, maximumFrame } = frameBounds(options);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const value = finiteNumber(seconds, 'seconds');
	const boundedSeconds = clamp(value, minimumFrame / sampleRate, maximumFrame / sampleRate);
	return clamp(Math.round(boundedSeconds * sampleRate), minimumFrame, maximumFrame);
}

/**
 * Convert a possibly fractional frame value to design-system seconds.
 * The input is rounded to an integer frame before being clamped.
 */
export function framesToSeconds(frames, options = {}) {
	const { minimumFrame, maximumFrame } = frameBounds(options);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const value = finiteNumber(frames, 'frames');
	const boundedFrame = clamp(Math.round(value), minimumFrame, maximumFrame);
	return boundedFrame / sampleRate;
}

/** Map an editor gain in dB to the design-system's linear 0..100 control. */
export function gainDbToDesignVolume(gainDb) {
	const value = clamp(
		finiteNumber(gainDb, 'gainDb'),
		DESIGN_SYSTEM_GAIN_DB_MINIMUM,
		DESIGN_SYSTEM_GAIN_DB_MAXIMUM,
	);
	return (value - DESIGN_SYSTEM_GAIN_DB_MINIMUM)
		/ (DESIGN_SYSTEM_GAIN_DB_MAXIMUM - DESIGN_SYSTEM_GAIN_DB_MINIMUM)
		* 100;
}

/** Map the design-system's 0..100 volume control back to editor gain in dB. */
export function designVolumeToGainDb(volume) {
	const value = clamp(finiteNumber(volume, 'volume'), 0, 100);
	return DESIGN_SYSTEM_GAIN_DB_MINIMUM
		+ value / 100 * (DESIGN_SYSTEM_GAIN_DB_MAXIMUM - DESIGN_SYSTEM_GAIN_DB_MINIMUM);
}

/** Map the editor's -1..1 pan value to the design-system's -100..100 value. */
export function panToDesignValue(pan) {
	return clamp(finiteNumber(pan, 'pan'), -1, 1) * 100;
}

/** Map the design-system's -100..100 pan value to the editor's -1..1 value. */
export function designValueToPan(pan) {
	return clamp(finiteNumber(pan, 'pan'), -100, 100) / 100;
}

/** Map normalized editor progress to the design-system's percentage progress. */
export function progressToDesignValue(progress) {
	return clamp(finiteNumber(progress, 'progress'), 0, 1) * 100;
}

/** Map design-system percentage progress to normalized editor progress. */
export function designValueToProgress(progress) {
	return clamp(finiteNumber(progress, 'progress'), 0, 100) / 100;
}

/**
 * @typedef {Object} ViewportClipProjection
 * @property {number} start Projected design-system start relative to the viewport.
 * @property {number} duration Projected design-system duration in seconds.
 * @property {number} timelineStartSeconds Absolute project start in seconds.
 * @property {number} timelineDurationSeconds Canonical clip duration in seconds.
 * @property {number} clipStartSeconds Canonical clip start relative to the viewport.
 * @property {number} clipEndSeconds Canonical clip end relative to the viewport.
 * @property {number} viewportStartSeconds Alias of `start` for adapter code.
 * @property {number} viewportEndSeconds End relative to the viewport.
 * @property {number} waveformStartFrame First clip-local frame to render.
 * @property {number} waveformEndFrame Clip-local end frame to render.
 * @property {boolean} clippedAtStart Whether overscan cropped the clip's start.
 * @property {boolean} clippedAtEnd Whether overscan cropped the clip's end.
 * @property {number} visibleStartSeconds Visible start relative to the viewport.
 * @property {number} visibleEndSeconds Visible end relative to the viewport.
 * @property {boolean} isVisible Whether the clip intersects the viewport itself.
 */

/**
 * Project canonical clips into design-system time coordinates. The result
 * contains clips intersecting the viewport plus one full viewport of overscan
 * on both sides. Input order is preserved and input clip objects are not changed.
 *
 * @param {Array<import('./project.js').AudioEditorClipV1 & Record<string, *>} clips
 * @param {{ viewportStartFrame?: number, viewportDurationFrames: number }} options
 * @returns {{
 *   viewportStartFrame: number,
 *   viewportEndFrame: number,
 *   viewportDurationFrames: number,
 *   viewportStartSeconds: number,
 *   viewportDurationSeconds: number,
 *   overscanStartFrame: number,
 *   overscanEndFrame: number,
 *   clips: Array<import('./project.js').AudioEditorClipV1 & Record<string, *> & ViewportClipProjection>,
 * }}
 */
export function projectClipsToViewport(clips, options = {}) {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	const viewportStartFrame = nonNegativeSafeInteger(options.viewportStartFrame ?? 0, 'viewportStartFrame');
	const viewportDurationFrames = positiveSafeInteger(options.viewportDurationFrames, 'viewportDurationFrames');
	const viewportEndFrame = addFrames(viewportStartFrame, viewportDurationFrames, 'viewport');
	const overscanStartFrame = Math.max(0, viewportStartFrame - viewportDurationFrames);
	const overscanEndFrame = Math.min(MAXIMUM_FRAME, viewportEndFrame + viewportDurationFrames);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const viewportDurationSeconds = viewportDurationFrames / sampleRate;

	const projectedClips = [];
	for (const clip of clips) {
		if (!clip || typeof clip !== 'object') throw new TypeError('Each clip must be an object.');
		const clipStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const clipDurationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
		const clipEndFrame = addFrames(clipStartFrame, clipDurationFrames, 'clip');
		if (clipStartFrame >= overscanEndFrame || clipEndFrame <= overscanStartFrame) continue;

		const projectedStartFrame = Math.max(clipStartFrame, overscanStartFrame);
		const projectedEndFrame = Math.min(clipEndFrame, overscanEndFrame);
		const start = (projectedStartFrame - viewportStartFrame) / sampleRate;
		const end = (projectedEndFrame - viewportStartFrame) / sampleRate;
		projectedClips.push({
			...clip,
			start,
			duration: (projectedEndFrame - projectedStartFrame) / sampleRate,
			timelineStartSeconds: clipStartFrame / sampleRate,
			timelineDurationSeconds: clipDurationFrames / sampleRate,
			clipStartSeconds: (clipStartFrame - viewportStartFrame) / sampleRate,
			clipEndSeconds: (clipEndFrame - viewportStartFrame) / sampleRate,
			viewportStartSeconds: start,
			viewportEndSeconds: end,
			waveformStartFrame: projectedStartFrame - clipStartFrame,
			waveformEndFrame: projectedEndFrame - clipStartFrame,
			clippedAtStart: projectedStartFrame !== clipStartFrame,
			clippedAtEnd: projectedEndFrame !== clipEndFrame,
			visibleStartSeconds: clamp(start, 0, viewportDurationSeconds),
			visibleEndSeconds: clamp(end, 0, viewportDurationSeconds),
			isVisible: clipStartFrame < viewportEndFrame && clipEndFrame > viewportStartFrame,
		});
	}

	return {
		viewportStartFrame,
		viewportEndFrame,
		viewportDurationFrames,
		viewportStartSeconds: viewportStartFrame / sampleRate,
		viewportDurationSeconds,
		overscanStartFrame,
		overscanEndFrame,
		clips: projectedClips,
	};
}

/**
 * Return the visible clip nearest the viewport's right edge. A clip with a
 * later visible start wins when two clips end at the same visible position.
 */
export function rightmostVisibleClip(clips) {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	let result = null;
	for (const clip of clips) {
		if (!clip?.isVisible) continue;
		if (!result || clip.visibleEndSeconds > result.visibleEndSeconds
			|| (clip.visibleEndSeconds === result.visibleEndSeconds
				&& clip.visibleStartSeconds >= result.visibleStartSeconds)) {
			result = clip;
		}
	}
	return result;
}

/**
 * Calculate a canvas backing size without allowing high-DPI or very large CSS
 * dimensions to allocate an unbounded pixel buffer.
 *
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {{
 *   devicePixelRatio?: number,
 *   maximumPixelRatio?: number,
 *   maximumBackingWidth?: number,
 *   maximumBackingHeight?: number,
 *   maximumBackingPixels?: number,
 * }} [options]
 */
export function boundedCanvasDimensions(cssWidth, cssHeight, options = {}) {
	const width = positiveSafeInteger(Math.round(finiteNumber(cssWidth, 'cssWidth')), 'cssWidth');
	const height = positiveSafeInteger(Math.round(finiteNumber(cssHeight, 'cssHeight')), 'cssHeight');
	const maximumPixelRatio = positiveFiniteNumber(
		options.maximumPixelRatio ?? DEFAULT_MAXIMUM_PIXEL_RATIO,
		'maximumPixelRatio',
	);
	const requestedPixelRatio = Math.min(
		positiveFiniteNumber(options.devicePixelRatio ?? 1, 'devicePixelRatio'),
		maximumPixelRatio,
	);
	const maximumBackingWidth = positiveSafeInteger(
		Math.floor(options.maximumBackingWidth ?? DEFAULT_MAXIMUM_BACKING_SIZE),
		'maximumBackingWidth',
	);
	const maximumBackingHeight = positiveSafeInteger(
		Math.floor(options.maximumBackingHeight ?? DEFAULT_MAXIMUM_BACKING_SIZE),
		'maximumBackingHeight',
	);
	const maximumBackingPixels = positiveSafeInteger(
		Math.floor(options.maximumBackingPixels ?? DEFAULT_MAXIMUM_BACKING_PIXELS),
		'maximumBackingPixels',
	);

	const dimensionScale = Math.min(
		requestedPixelRatio,
		maximumBackingWidth / width,
		maximumBackingHeight / height,
	);
	const pixelScale = Math.sqrt(maximumBackingPixels / (width * height));
	const scale = Math.min(dimensionScale, pixelScale);
	const backingWidth = Math.max(1, Math.min(maximumBackingWidth, Math.floor(width * scale)));
	const backingHeight = Math.max(1, Math.min(maximumBackingHeight, Math.floor(height * scale)));

	return {
		cssWidth: width,
		cssHeight: height,
		backingWidth,
		backingHeight,
		requestedPixelRatio,
		pixelRatioX: backingWidth / width,
		pixelRatioY: backingHeight / height,
	};
}

/**
 * Prepare a clip-local waveform window for the design system. Only the
 * requested frame window is read and every output channel is capped at
 * `maxSamples`. Downsampled windows store each bucket's minimum and maximum in
 * chronological order so short peaks survive without retaining full source PCM.
 * Clip gain is the canonical linear multiplier, not a dB value. Supplying
 * `pixelWidth` also attaches a non-enumerable Audacity canvas plan as
 * `result.rendering`, independently of the compatibility sample cap.
 *
 * @param {Array<Float32Array | number[]>} sourceChannels
 * @param {import('./project.js').AudioEditorClipV1 | {
 *   sourceStartFrame: number,
 *   durationFrames: number,
 *   sourceDurationFrames?: number,
 *   gain?: number,
 *   fadeInFrames?: number,
 *   fadeOutFrames?: number,
 *   reversed?: boolean,
 * }} clip
 * @param {{ startFrame?: number, endFrame?: number, maxSamples?: number, pixelWidth?: number }} [options]
 * @returns {{
 *   channels: Float32Array[],
 *   startFrame: number,
 *   endFrame: number,
 *   frameCount: number,
 *   sampleCount: number,
 *   framesPerBucket: number,
 *   downsampled: boolean,
 * }}
 */
export function prepareBoundedWaveformWindow(sourceChannels, clip, options = {}) {
	const sourceLength = validateSourceChannels(sourceChannels);
	if (!clip || typeof clip !== 'object') throw new TypeError('clip must be an object.');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames ?? durationFrames, 'clip.sourceDurationFrames');
	const sourceEndFrame = addFrames(sourceStartFrame, sourceDurationFrames, 'clip source range');
	if (sourceEndFrame > sourceLength) throw new RangeError('The clip exceeds the supplied source channels.');

	const startFrame = clampedLocalFrame(options.startFrame ?? 0, durationFrames, 'startFrame');
	const endFrame = clampedLocalFrame(options.endFrame ?? durationFrames, durationFrames, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame must not be before startFrame.');
	const frameCount = endFrame - startFrame;
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
	const reversed = Boolean(clip.reversed);
	const transformSample = (channel, localFrame) => {
		const mappedFrame = Math.min(sourceDurationFrames - 1, Math.floor(localFrame * sourceDurationFrames / durationFrames));
		const sourceLocalFrame = reversed ? sourceDurationFrames - mappedFrame - 1 : mappedFrame;
		const sourceFrame = sourceStartFrame + sourceLocalFrame;
		const sample = Number(sourceChannels[channel][sourceFrame]);
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
	});

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

/*
 * GPL-3.0-only browser adaptation of Audacity's WaveDataCache and sample
 * painters. Exact upstream paths and revision are in THIRD_PARTY_LICENSES.md.
 */
function prepareAudacityWaveformRendering(sourceChannels, options) {
	const sourceSamplesPerTimelineFrame = options.sourceDurationFrames / options.durationFrames;
	const visibleSourceStart = options.startFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceEnd = options.endFrame * sourceSamplesPerTimelineFrame;
	const visibleSourceSamples = options.frameCount * sourceSamplesPerTimelineFrame;
	const pixelsPerSample = options.pixelWidth / visibleSourceSamples;
	const mode = audacityWaveformMode(pixelsPerSample);
	const transformSourceSample = (channel, visualOrdinal) => {
		const sourceLocalFrame = options.reversed
			? options.sourceDurationFrames - visualOrdinal - 1
			: visualOrdinal;
		const sample = Number(sourceChannels[channel][options.sourceStartFrame + sourceLocalFrame]);
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
		const firstSample = Math.max(0, Math.floor(visibleSourceStart));
		const lastSample = Math.min(options.sourceDurationFrames - 1, Math.ceil(visibleSourceEnd));
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
					bucketStart = clamp(Math.floor(Math.min(rawStart, visibleSourceEnd - Number.EPSILON)), 0, options.sourceDurationFrames - 1);
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

function withWaveformRendering(result, rendering) {
	if (rendering) Object.defineProperty(result, 'rendering', { value: rendering });
	return result;
}

function frameBounds(options) {
	const minimumFrame = nonNegativeSafeInteger(options.minimumFrame ?? 0, 'minimumFrame');
	const maximumFrame = nonNegativeSafeInteger(options.maximumFrame ?? MAXIMUM_FRAME, 'maximumFrame');
	if (maximumFrame < minimumFrame) throw new RangeError('maximumFrame must not be below minimumFrame.');
	return { minimumFrame, maximumFrame };
}

function normalizeSampleRate(value) {
	const sampleRate = Number(value ?? AUDIO_EDITOR_SAMPLE_RATE);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be a positive safe integer.');
	return sampleRate;
}

function validateSourceChannels(channels) {
	if (!Array.isArray(channels) || !channels.length) {
		throw new TypeError('sourceChannels must contain at least one channel.');
	}
	const length = channels[0]?.length;
	if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('Source channels must be array-like.');
	for (const channel of channels) {
		if ((!Array.isArray(channel) && !ArrayBuffer.isView(channel)) || channel.length !== length) {
			throw new RangeError('Source channels must be equally sized arrays.');
		}
	}
	return length;
}

function fadeEnvelope(localFrame, durationFrames, fadeInFrames, fadeOutFrames) {
	let envelope = 1;
	if (fadeInFrames > 0 && localFrame < fadeInFrames) envelope *= localFrame / fadeInFrames;
	if (fadeOutFrames > 0 && localFrame > durationFrames - fadeOutFrames) {
		envelope *= (durationFrames - localFrame) / fadeOutFrames;
	}
	return Math.max(0, envelope);
}

function clampedLocalFrame(value, durationFrames, name) {
	return clamp(Math.round(finiteNumber(value, name)), 0, durationFrames);
}

function addFrames(startFrame, durationFrames, name) {
	if (durationFrames > MAXIMUM_FRAME - startFrame) throw new RangeError(`${name} exceeds the safe frame range.`);
	return startFrame + durationFrames;
}

function nonNegativeSafeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
}

function positiveSafeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return value;
}

function positiveFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function finiteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
