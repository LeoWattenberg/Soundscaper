/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineMeterReading } from './public-api.ts';
import type { LiveAnalysisTap } from './live-analysis-tap.ts';

export interface StereoScopePoint {
	readonly x: number;
	readonly y: number;
}

export interface MutableEngineMeterReading extends EngineMeterReading {
	loudness?: unknown;
	stereoCorrelation?: number | null;
	stereoScope?: readonly StereoScopePoint[];
	spectrumDb?: readonly number[];
}

const MAXIMUM_SPECTRUM_BINS = 128;
const MAXIMUM_STEREO_SCOPE_POINTS = 64;
const MAXIMUM_ANALYSER_FRAMES = 4_096;
const EMPTY_VALUES: readonly number[] = Object.freeze([]);
const EMPTY_SCOPE: readonly StereoScopePoint[] = Object.freeze([]);
const timeReadBuffers = new WeakMap<AnalyserNode, Float32Array>();
const frequencyReadBuffers = new WeakMap<AnalyserNode, Float32Array>();
const spectrumWindows = new WeakMap<AnalyserNode, { count: number; bounds: readonly [number, number][] }>();

/** Existing scalar meter path; it never reads the live-analysis side taps. */
export function readEngineMeter(analyser: AnalyserNode | null | undefined): MutableEngineMeterReading {
	return meterFromSamples(analyser ? readTimeData(analyser) : null);
}

/** Visuals are sampled only when a visible panel holds the engine lease. */
export function readMasterMeter(
	analyser: AnalyserNode | null | undefined,
	tap: LiveAnalysisTap | null = null,
): MutableEngineMeterReading {
	const reading = readEngineMeter(analyser);
	if (!tap) return reading;
	reading.spectrumDb = tap.spectrum ? readSpectrum(tap.spectrum, tap.spectrumChannels) : EMPTY_VALUES;
	const left = tap.stereo[0];
	const right = tap.stereo[1];
	if (!left || !right) {
		reading.stereoScope = EMPTY_SCOPE;
		reading.stereoCorrelation = null;
		return reading;
	}
	const leftSamples = readTimeData(left);
	const rightSamples = readTimeData(right);
	if (leftSamples.length !== rightSamples.length) {
		reading.stereoScope = EMPTY_SCOPE;
		reading.stereoCorrelation = null;
		return reading;
	}
	const stereo = createStereoScopePoints(leftSamples, rightSamples);
	reading.stereoScope = stereo.points;
	reading.stereoCorrelation = stereo.correlation;
	return reading;
}

function meterFromSamples(samples: Float32Array | null): MutableEngineMeterReading {
	if (!samples) return { peak: 0, rms: 0, dbfs: -Infinity };
	let peak = 0;
	let squares = 0;
	for (const value of samples) {
		peak = Math.max(peak, Math.abs(value));
		squares += value * value;
	}
	const rms = Math.sqrt(squares / Math.max(1, samples.length));
	return { peak, rms, dbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

function readTimeData(analyser: AnalyserNode): Float32Array {
	const count = boundedCount(analyser.fftSize, MAXIMUM_ANALYSER_FRAMES);
	let values = timeReadBuffers.get(analyser);
	if (!values || values.length !== count) {
		values = new Float32Array(count);
		timeReadBuffers.set(analyser, values);
	}
	analyser.getFloatTimeDomainData(values as Float32Array<ArrayBuffer>);
	return values;
}

/** Log-spaced buckets retain the 4096-FFT tap's bass resolution. */
function readFrequencyData(analyser: AnalyserNode): Float32Array | null {
	if (typeof analyser.getFloatFrequencyData !== 'function') return null;
	const count = boundedCount(analyser.frequencyBinCount, MAXIMUM_ANALYSER_FRAMES / 2);
	let values = frequencyReadBuffers.get(analyser);
	if (!values || values.length !== count) {
		values = new Float32Array(count);
		frequencyReadBuffers.set(analyser, values);
	}
	analyser.getFloatFrequencyData(values as Float32Array<ArrayBuffer>);
	return values;
}

function readSpectrum(analyser: AnalyserNode, channelAnalysers?: readonly AnalyserNode[]): readonly number[] {
	const channels = (channelAnalysers?.length ? channelAnalysers : [analyser])
		.map(readFrequencyData).filter((values): values is Float32Array => values !== null);
	if (!channels.length) return EMPTY_VALUES;
	const count = Math.min(...channels.map(channel => channel.length));
	let windows = spectrumWindows.get(analyser);
	if (!windows || windows.count !== count) {
		const highestBin = Math.max(1, count - 1);
		const bounds: [number, number][] = [];
		for (let bucket = 0; bucket < MAXIMUM_SPECTRUM_BINS; bucket += 1) {
			const start = Math.max(1, Math.floor(highestBin ** (bucket / MAXIMUM_SPECTRUM_BINS)));
			const end = Math.max(start + 1, Math.ceil(highestBin ** ((bucket + 1) / MAXIMUM_SPECTRUM_BINS)));
			bounds.push([start, Math.min(count, end)]);
		}
		windows = { count, bounds };
		spectrumWindows.set(analyser, windows);
	}
	const bins: number[] = [];
	for (const [start, end] of windows.bounds) {
		let loudest = -120;
		for (let index = start; index < end; index += 1) {
			let value = channels[0]![index]!;
			if (channels.length > 1) {
				let power = 0;
				for (const channel of channels) power += 10 ** (channel[index]! / 10);
				value = 10 * Math.log10(power / channels.length);
			}
			if (Number.isFinite(value)) loudest = Math.max(loudest, Math.min(0, value));
		}
		bins.push(loudest);
	}
	return Object.freeze(bins);
}

function createStereoScopePoints(left: Float32Array, right: Float32Array): {
	points: readonly StereoScopePoint[]; correlation: number | null;
} {
	const step = Math.max(1, Math.ceil(left.length / MAXIMUM_STEREO_SCOPE_POINTS));
	const points: StereoScopePoint[] = [];
	let cross = 0;
	let leftSquares = 0;
	let rightSquares = 0;
	for (let start = 0; start < left.length; start += step) {
		let selectedFrame = start;
		let greatestAmplitude = 0;
		for (let frame = start; frame < Math.min(left.length, start + step); frame += 1) {
			const leftSample = left[frame]!;
			const rightSample = right[frame]!;
			cross += leftSample * rightSample;
			leftSquares += leftSample * leftSample;
			rightSquares += rightSample * rightSample;
			const amplitude = Math.abs(leftSample) + Math.abs(rightSample);
			if (amplitude > greatestAmplitude) {
				greatestAmplitude = amplitude;
				selectedFrame = frame;
			}
		}
		if (greatestAmplitude === 0) continue;
		const leftSample = left[selectedFrame]!;
		const rightSample = right[selectedFrame]!;
		points.push(Object.freeze({
			x: Math.max(-1, Math.min(1, (leftSample - rightSample) / 2)),
			y: Math.max(-1, Math.min(1, (leftSample + rightSample) / 2)),
		}));
	}
	const denominator = Math.sqrt(leftSquares * rightSquares);
	return { points: Object.freeze(points), correlation: denominator === 0
		? null : Math.max(-1, Math.min(1, cross / denominator)) };
}

function boundedCount(value: number, maximum: number): number {
	return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : 256;
}
