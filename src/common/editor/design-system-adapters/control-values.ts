import type { FrameConversionOptions } from './types.ts';
import { sampleFrameToSeconds, secondsToSampleFrame } from '../timeline-time.ts';
import {
	clamp,
	finiteNumber,
	frameBounds,
	normalizeSampleRate,
} from './validation.ts';

export const DESIGN_SYSTEM_GAIN_DB_MINIMUM = -60;
export const DESIGN_SYSTEM_GAIN_DB_MAXIMUM = 12;

/** Convert design-system seconds to canonical editor frames. */
export function secondsToFrames(seconds: number, options: FrameConversionOptions = {}): number {
	const { minimumFrame, maximumFrame } = frameBounds(options);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const value = finiteNumber(seconds, 'seconds');
	const boundedSeconds = clamp(value, minimumFrame / sampleRate, maximumFrame / sampleRate);
	return clamp(secondsToSampleFrame(boundedSeconds, sampleRate), minimumFrame, maximumFrame);
}

/** Convert a possibly fractional frame value to design-system seconds. */
export function framesToSeconds(frames: number, options: FrameConversionOptions = {}): number {
	const { minimumFrame, maximumFrame } = frameBounds(options);
	const sampleRate = normalizeSampleRate(options.sampleRate);
	const value = finiteNumber(frames, 'frames');
	const boundedFrame = clamp(Math.round(value), minimumFrame, maximumFrame);
	return sampleFrameToSeconds(boundedFrame, sampleRate);
}

export function gainDbToDesignVolume(gainDb: number): number {
	const value = clamp(
		finiteNumber(gainDb, 'gainDb'),
		DESIGN_SYSTEM_GAIN_DB_MINIMUM,
		DESIGN_SYSTEM_GAIN_DB_MAXIMUM,
	);
	return (value - DESIGN_SYSTEM_GAIN_DB_MINIMUM)
		/ (DESIGN_SYSTEM_GAIN_DB_MAXIMUM - DESIGN_SYSTEM_GAIN_DB_MINIMUM)
		* 100;
}

export function designVolumeToGainDb(volume: number): number {
	const value = clamp(finiteNumber(volume, 'volume'), 0, 100);
	return DESIGN_SYSTEM_GAIN_DB_MINIMUM
		+ value / 100 * (DESIGN_SYSTEM_GAIN_DB_MAXIMUM - DESIGN_SYSTEM_GAIN_DB_MINIMUM);
}

export function panToDesignValue(pan: number): number {
	return clamp(finiteNumber(pan, 'pan'), -1, 1) * 100;
}

export function designValueToPan(pan: number): number {
	return clamp(finiteNumber(pan, 'pan'), -100, 100) / 100;
}

export function progressToDesignValue(progress: number): number {
	return clamp(finiteNumber(progress, 'progress'), 0, 1) * 100;
}

export function designValueToProgress(progress: number): number {
	return clamp(finiteNumber(progress, 'progress'), 0, 100) / 100;
}
