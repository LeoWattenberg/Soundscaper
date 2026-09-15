/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStandardDelayParams } from './delay-definition.ts';

export function delaySelectionPitchMode(value: unknown): 'pitch-shift' | 'speed' {
	if (value == null || value === 'pitch-shift') return 'pitch-shift';
	if (value === 'speed') return 'speed';
	throw new RangeError('Invalid multi-tap-delay.pitchMode.');
}

export function delaySelectionDuration(value: unknown): 'keep' | 'extend' {
	if (value == null || value === 'keep') return 'keep';
	if (value === 'extend') return 'extend';
	throw new RangeError('Invalid multi-tap-delay.duration.');
}

export function delayEchoOffsetFrames(params: Readonly<Record<string, unknown>>, sampleRate: number, echo: number): number {
	const count = Number(params.echoes);
	const spacing = params.delayType === 'regular' ? echo : params.delayType === 'bouncing-ball'
		? echo * (2 * count + 1 - echo) / (2 * count) : echo * (echo + 1) / (2 * count);
	return Math.round(Number(params.time) * sampleRate * spacing);
}

export function standardDelaySelectionOutputFrames(frames: number, params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('inputFrames must be a positive safe integer.');
	const next = normalizeStandardDelayParams(params);
	const mode = delaySelectionPitchMode(params.pitchMode);
	if (delaySelectionDuration(params.duration) === 'keep' || Number(next.mix) === 0) return frames;
	const ratio = mode === 'speed' ? 2 ** (-Number(next.pitchShift) / 12) : 1;
	let echoFrames = frames;
	let output = frames;
	for (let echo = 1; echo <= Number(next.echoes); echo++) {
		echoFrames = Math.max(1, Math.round(echoFrames * ratio));
		output = Math.max(output, echoFrames + delayEchoOffsetFrames(next, sampleRate, echo));
	}
	if (!Number.isSafeInteger(output)) throw new RangeError('The delay output is too large.');
	return output;
}

/** Speed can enlarge each successive source; admission covers the largest
 * source, destination, accumulated output, transfers and native runtime.
 */
export function standardDelaySpeedScratchFrames(frames: number, params: Readonly<Record<string, unknown>>): number {
	const next = normalizeStandardDelayParams(params);
	if (delaySelectionPitchMode(params.pitchMode) !== 'speed' || Number(next.pitchShift) === 0 || Number(next.mix) === 0) return 0;
	const ratio = 2 ** (-Number(next.pitchShift) / 12);
	let largest = frames;
	let echoFrames = frames;
	for (let echo = 1; echo <= Number(next.echoes); echo++) {
		echoFrames = Math.max(1, Math.round(echoFrames * ratio));
		largest = Math.max(largest, echoFrames);
	}
	return largest * 2;
}
