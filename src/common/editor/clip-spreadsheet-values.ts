/* SPDX-License-Identifier: AGPL-3.0-only */

import { sampleFrameToSeconds, scaleSampleFrame, secondsToSampleFrame } from './timeline-time.ts';

/** Cell parsers shared by edits and new rows so pasted values obey the same limits. */
export function spreadsheetNumber(raw: string, minimum: number, maximum: number, label: string): number {
	const value = Number(raw.trim());
	if (!raw.trim() || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
	return value;
}
export function spreadsheetFrames(raw: string, rate: number, positive: boolean): number {
	const value = secondsToSampleFrame(spreadsheetNumber(raw, 0, Number.MAX_SAFE_INTEGER / rate, 'Time'), rate, 'point');
	if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new RangeError('Time must resolve to a valid sample position.');
	return value;
}
export function spreadsheetDurationFrames(sourceFrames: number, sourceRate: number, projectRate: number, speed: number): number {
	return speed === 1 ? scaleSampleFrame(sourceFrames, sourceRate, projectRate, 'point')
		: secondsToSampleFrame(sampleFrameToSeconds(sourceFrames, sourceRate) / speed, projectRate, 'point');
}
export function spreadsheetSourceDurationFrames(durationFrames: number, projectRate: number, sourceRate: number, speed: number): number {
	return speed === 1 ? scaleSampleFrame(durationFrames, projectRate, sourceRate, 'point')
		: secondsToSampleFrame(sampleFrameToSeconds(durationFrames, projectRate) * speed, sourceRate, 'point');
}
export function spreadsheetBoolean(raw: string): boolean {
	if (/^(true|yes|1)$/i.test(raw.trim())) return true;
	if (/^(false|no|0)$/i.test(raw.trim())) return false;
	throw new RangeError('Boolean cells accept true or false.');
}
export function spreadsheetGain(raw: string): number {
	return raw.trim().toLowerCase() === '-infinity' || raw.trim() === '-∞'
		? 0 : 10 ** (spreadsheetNumber(raw, -1_000, 20 * Math.log10(16), 'Gain') / 20);
}
