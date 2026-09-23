/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Rainbow color mapping adapted from Freesound's processing.py at commit
 * ef5e42938c9ca4aace39d9d04b65752d161321e8. Copyright (C) 2008 MUSIC
 * TECHNOLOGY GROUP (MTG), UNIVERSITAT POMPEU FABRA; author Bram de Jong;
 * AGPL-3.0-or-later upstream, with version 3 selected for this adaptation.
 * See THIRD_PARTY_LICENSES.md for the exact source and modification notice.
 */

export const FREQUENCY_WAVEFORM_ANALYSIS_VERSION = 1;
export const FREQUENCY_WAVEFORM_CACHE_PREFIX = 'audio-editor-frequency-waveform-v1:';
export const FREQUENCY_WAVEFORM_FFT_SIZE = 2_048;
export const FREQUENCY_WAVEFORM_HOP_SIZE = 256;
export const FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES = 8 * 1_024 * 1_024;
export const FREQUENCY_WAVEFORM_SILENCE_WEIGHT = 1e-12;
export const FREQUENCY_WAVEFORM_BASE_BLOCK_SIZES: readonly number[] = Object.freeze([
	256, 512, 1_024, 2_048, 4_096, 16_384, 65_536,
]);
export const DEFAULT_FREQUENCY_WAVEFORM_CROSSOVERS = Object.freeze({
	lowMidHz: 250,
	midHighHz: 4_000,
});
// Freesound's AGPL waveform thumbnailer maps a 100–22,050 Hz log centroid
// through these stops and paints silence dark gray.
const FREESOUND_WAVEFORM_COLORS = Object.freeze([
	Object.freeze([50, 0, 200]),
	Object.freeze([0, 220, 80]),
	Object.freeze([255, 224, 0]),
	Object.freeze([255, 70, 0]),
] as const);
const FREESOUND_WAVEFORM_SILENCE_COLOR = 'rgb(50, 50, 50)';
const FREESOUND_WAVEFORM_MINIMUM_HZ = 100;
const FREESOUND_WAVEFORM_MAXIMUM_HZ = 22_050;

export interface FrequencyWaveformCrossovers {
	readonly lowMidHz: number;
	readonly midHighHz: number;
}

export interface FrequencyWaveformBandChannel {
	readonly minimums: Float32Array;
	readonly maximums: Float32Array;
}

export interface FrequencyWaveformCentroidBuckets {
	readonly numerators: Float32Array;
	readonly weights: Float32Array;
}

export interface FrequencyWaveformBands<T> {
	readonly low: T;
	readonly mid: T;
	readonly high: T;
}

export interface FrequencyWaveformLevel {
	readonly blockSize: number;
	readonly bands: FrequencyWaveformBands<readonly FrequencyWaveformBandChannel[]>;
	readonly centroid: FrequencyWaveformCentroidBuckets;
}

export interface FrequencyWaveformAnalysis {
	readonly version: typeof FREQUENCY_WAVEFORM_ANALYSIS_VERSION;
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly visualChannelCount: number;
	readonly crossovers: FrequencyWaveformCrossovers;
	readonly fftSize: typeof FREQUENCY_WAVEFORM_FFT_SIZE;
	readonly hopSize: typeof FREQUENCY_WAVEFORM_HOP_SIZE;
	readonly levels: readonly FrequencyWaveformLevel[];
}

export interface FrequencyWaveformWindow {
	readonly version: typeof FREQUENCY_WAVEFORM_ANALYSIS_VERSION;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly visualChannelCount: number;
	readonly crossovers: FrequencyWaveformCrossovers;
	readonly bands: FrequencyWaveformBands<readonly Float32Array[]>;
	readonly centroid: FrequencyWaveformCentroidBuckets & {
		readonly firstCenterFrame: number;
		readonly hopSize: typeof FREQUENCY_WAVEFORM_HOP_SIZE;
	};
}

export function frequencyWaveformCacheKey(sourceId: unknown): string {
	return `${FREQUENCY_WAVEFORM_CACHE_PREFIX}${String(sourceId)}`;
}

export function frequencyWaveformVisualChannelCount(channelCount: number): number {
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 1_024) {
		throw new RangeError('Invalid frequency waveform channel count.');
	}
	return Math.min(2, channelCount);
}

export function frequencyWaveformAnalysisByteLength(
	frameCount: number,
	channelCount: number,
	blockSizes: readonly number[],
): number {
	validateFrameCount(frameCount);
	const visualChannelCount = frequencyWaveformVisualChannelCount(channelCount);
	const valuesPerBucket = visualChannelCount * 3 * 2 + 2;
	return blockSizes.reduce((total, blockSize) => {
		validateBlockSize(blockSize);
		return total + Math.ceil(frameCount / blockSize) * valuesPerBucket * Float32Array.BYTES_PER_ELEMENT;
	}, 0);
}

export function frequencyWaveformBlockSizes(frameCount: number, channelCount: number): readonly number[] {
	validateFrameCount(frameCount);
	frequencyWaveformVisualChannelCount(channelCount);
	let scale = 1;
	while (frequencyWaveformAnalysisByteLength(
		frameCount,
		channelCount,
		FREQUENCY_WAVEFORM_BASE_BLOCK_SIZES.map((size) => size * scale),
	) > FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES) scale *= 2;
	const sizes = FREQUENCY_WAVEFORM_BASE_BLOCK_SIZES.map((size) => size * scale);
	if (!sizes.every(Number.isSafeInteger)) {
		throw new RangeError('The audio source exceeds the supported frequency waveform frame range.');
	}
	return sizes;
}

export function normalizeFrequencyWaveformCrossovers(value: unknown): FrequencyWaveformCrossovers {
	const candidate = value as Partial<FrequencyWaveformCrossovers> | null;
	const lowMidHz = Number(candidate?.lowMidHz ?? DEFAULT_FREQUENCY_WAVEFORM_CROSSOVERS.lowMidHz);
	const midHighHz = Number(candidate?.midHighHz ?? DEFAULT_FREQUENCY_WAVEFORM_CROSSOVERS.midHighHz);
	if (!Number.isFinite(lowMidHz) || !Number.isFinite(midHighHz)
		|| lowMidHz < 20 || midHighHz > 20_000 || lowMidHz >= midHighHz) {
		throw new RangeError('Frequency waveform crossovers must be ordered between 20 and 20000 Hz.');
	}
	return Object.freeze({ lowMidHz, midHighHz });
}

export function selectFrequencyWaveformLevel(
	levels: readonly FrequencyWaveformLevel[],
	sourceFramesPerPixel: number,
): FrequencyWaveformLevel {
	if (!levels.length) throw new RangeError('The frequency waveform pyramid must contain a level.');
	const target = Math.max(1, Number(sourceFramesPerPixel) || 1);
	let selected = levels[0]!;
	for (const level of levels) {
		if (level.blockSize > target) break;
		selected = level;
	}
	return selected;
}

export function frequencyWaveformCentroidColor(
	numerator: number,
	weight: number,
	sampleRate: number,
): string {
	if (!Number.isFinite(numerator) || !Number.isFinite(weight)
		|| weight <= FREQUENCY_WAVEFORM_SILENCE_WEIGHT) return FREESOUND_WAVEFORM_SILENCE_COLOR;
	validateSampleRate(sampleRate);
	const frequency = Math.max(
		FREESOUND_WAVEFORM_MINIMUM_HZ,
		Math.min(FREESOUND_WAVEFORM_MAXIMUM_HZ, numerator / weight),
	);
	const normalized = (
		(Math.log(frequency) - Math.log(FREESOUND_WAVEFORM_MINIMUM_HZ))
		/ (Math.log(FREESOUND_WAVEFORM_MAXIMUM_HZ) - Math.log(FREESOUND_WAVEFORM_MINIMUM_HZ))
	);
	const position = Math.max(0, Math.min(
		FREESOUND_WAVEFORM_COLORS.length - 1,
		normalized * (FREESOUND_WAVEFORM_COLORS.length - 1),
	));
	const left = Math.min(FREESOUND_WAVEFORM_COLORS.length - 2, Math.floor(position));
	const amount = position - left;
	const color = FREESOUND_WAVEFORM_COLORS[left]!;
	const next = FREESOUND_WAVEFORM_COLORS[left + 1]!;
	return `rgb(${interpolate(color[0], next[0], amount)}, ${interpolate(color[1], next[1], amount)}, ${interpolate(color[2], next[2], amount)})`;
}

export function validateFrequencyWaveformAnalysis(value: unknown): FrequencyWaveformAnalysis {
	const analysis = value as Partial<FrequencyWaveformAnalysis> | null;
	if (!analysis || typeof analysis !== 'object'
		|| analysis.version !== FREQUENCY_WAVEFORM_ANALYSIS_VERSION) {
		throw new TypeError(`A version ${FREQUENCY_WAVEFORM_ANALYSIS_VERSION} frequency waveform analysis is required.`);
	}
	const frameCount = validateFrameCount(analysis.frameCount);
	const sampleRate = validateSampleRate(analysis.sampleRate);
	const channelCount = validateChannelCount(analysis.channelCount);
	const visualChannelCount = frequencyWaveformVisualChannelCount(channelCount);
	if (analysis.visualChannelCount !== visualChannelCount
		|| analysis.fftSize !== FREQUENCY_WAVEFORM_FFT_SIZE
		|| analysis.hopSize !== FREQUENCY_WAVEFORM_HOP_SIZE
		|| !Array.isArray(analysis.levels)) {
		throw new RangeError('The frequency waveform analysis geometry is invalid.');
	}
	const crossovers = normalizeFrequencyWaveformCrossovers(analysis.crossovers);
	const expectedSizes = frequencyWaveformBlockSizes(frameCount, channelCount);
	if (analysis.levels.length !== expectedSizes.length) {
		throw new RangeError('The frequency waveform pyramid has invalid levels.');
	}
	analysis.levels.forEach((level, index) => validateLevel(
		level,
		expectedSizes[index]!,
		Math.ceil(frameCount / expectedSizes[index]!),
		visualChannelCount,
	));
	if (analysis.sampleRate !== sampleRate || analysis.channelCount !== channelCount
		|| analysis.frameCount !== frameCount
		|| analysis.crossovers?.lowMidHz !== crossovers.lowMidHz
		|| analysis.crossovers?.midHighHz !== crossovers.midHighHz) {
		throw new RangeError('The frequency waveform analysis metadata is invalid.');
	}
	return analysis as FrequencyWaveformAnalysis;
}

export function validateFrequencyWaveformWindow(value: unknown): FrequencyWaveformWindow {
	const window = value as Partial<FrequencyWaveformWindow> | null;
	if (!window || typeof window !== 'object'
		|| window.version !== FREQUENCY_WAVEFORM_ANALYSIS_VERSION) {
		throw new TypeError(`A version ${FREQUENCY_WAVEFORM_ANALYSIS_VERSION} frequency waveform window is required.`);
	}
	const sampleRate = validateSampleRate(window.sampleRate);
	const frameCount = validateFrameCount(window.frameCount);
	const startFrame = validateFrameCount(window.startFrame);
	const channelCount = validateChannelCount(window.channelCount);
	const visualChannelCount = frequencyWaveformVisualChannelCount(channelCount);
	const crossovers = normalizeFrequencyWaveformCrossovers(window.crossovers);
	if (window.visualChannelCount !== visualChannelCount || !window.bands
		|| typeof window.bands !== 'object' || !window.centroid
		|| typeof window.centroid !== 'object'
		|| window.centroid.hopSize !== FREQUENCY_WAVEFORM_HOP_SIZE) {
		throw new RangeError('The frequency waveform window geometry is invalid.');
	}
	for (const band of ['low', 'mid', 'high'] as const) {
		const channels = window.bands[band];
		if (!Array.isArray(channels) || channels.length !== visualChannelCount) {
			throw new RangeError('The frequency waveform window has invalid band channels.');
		}
		for (const channel of channels) validateFloat32Length(channel, frameCount);
	}
	const firstCenterFrame = validateFrameCount(window.centroid.firstCenterFrame);
	if (firstCenterFrame > startFrame
		|| startFrame - firstCenterFrame >= FREQUENCY_WAVEFORM_HOP_SIZE) {
		throw new RangeError('The frequency waveform window centroid alignment is invalid.');
	}
	const centroidCount = Math.max(0, Math.ceil(
		(startFrame + frameCount - firstCenterFrame) / FREQUENCY_WAVEFORM_HOP_SIZE,
	));
	validateFloat32Length(window.centroid.numerators, centroidCount);
	validateFloat32Length(window.centroid.weights, centroidCount);
	if (window.sampleRate !== sampleRate || window.channelCount !== channelCount
		|| window.frameCount !== frameCount || window.startFrame !== startFrame
		|| window.crossovers?.lowMidHz !== crossovers.lowMidHz
		|| window.crossovers?.midHighHz !== crossovers.midHighHz) {
		throw new RangeError('The frequency waveform window metadata is invalid.');
	}
	return window as FrequencyWaveformWindow;
}

function validateLevel(level: unknown, blockSize: number, bucketCount: number, channels: number): void {
	const candidate = level as Partial<FrequencyWaveformLevel> | null;
	if (!candidate || typeof candidate !== 'object' || candidate.blockSize !== blockSize
		|| !candidate.bands || typeof candidate.bands !== 'object') {
		throw new RangeError('The frequency waveform pyramid has invalid levels.');
	}
	for (const band of ['low', 'mid', 'high'] as const) {
		const values = candidate.bands[band];
		if (!Array.isArray(values) || values.length !== channels) {
			throw new RangeError('The frequency waveform pyramid has invalid band channels.');
		}
		for (const channel of values) {
			validateFloat32Length(channel?.minimums, bucketCount);
			validateFloat32Length(channel?.maximums, bucketCount);
		}
	}
	validateFloat32Length(candidate.centroid?.numerators, bucketCount);
	validateFloat32Length(candidate.centroid?.weights, bucketCount);
}

function validateFloat32Length(value: unknown, length: number): void {
	if (!(value instanceof Float32Array) || value.length !== length) {
		throw new RangeError('Frequency waveform arrays do not match the pyramid geometry.');
	}
}

function validateFrameCount(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Invalid frequency waveform frame count.');
	}
	return value;
}

function validateChannelCount(value: unknown): number {
	frequencyWaveformVisualChannelCount(Number(value));
	return Number(value);
}

function validateSampleRate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 768_000) {
		throw new RangeError('The sample rate must be an integer between 1 and 768000 Hz.');
	}
	return value;
}

function validateBlockSize(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('Invalid frequency waveform block size.');
	}
	return value;
}

function interpolate(left: number, right: number, amount: number): number {
	return Math.round(left + (right - left) * amount);
}
