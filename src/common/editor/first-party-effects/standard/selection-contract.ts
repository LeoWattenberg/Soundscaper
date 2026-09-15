/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StandardEffectType } from './definition.ts';
import { normalizeStandardDelayParams, standardDelayCapacityFrames, standardDelayPitchQueueFrames } from './delay-definition.ts';
import { noiseGateLatencyFrames } from './noise-gate-definition.ts';
import { STAFFPAD_MAXIMUM_MEMORY_BYTES } from '../../staffpad/parameters.js';
import { delaySelectionPitchMode, standardDelaySelectionOutputFrames, standardDelaySpeedScratchFrames } from './delay-selection-contract.ts';

interface Options {
	readonly sampleRate?: number;
	readonly channelCount?: number;
	readonly spectralWindowSize?: number;
}

/** Validate a live configuration and estimate state for a fresh processor.
 * A running delay can retain a larger bounded reserve after its tail shrinks.
 */
export function standardEffectStateBytes(type: StandardEffectType, params: Readonly<Record<string, unknown>>,
	rate: number, channels: number): number {
	if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new RangeError('channelCount must be between 1 and 32.');
	if (!Number.isFinite(rate) || rate < 8000 || rate > 384000) throw new RangeError('sampleRate must be between 8000 and 384000 Hz.');
	const frequency = type === 'noise-gate' ? Number(params.gateFrequency ?? 0) : Number(params.frequency ?? 0);
	if (type !== 'tremolo' && frequency >= rate / 2) throw new RangeError('Filter frequency must be below Nyquist.');
	if (type === 'noise-gate') return channels * noiseGateLatencyFrames(params, rate) * Float32Array.BYTES_PER_ELEMENT;
	if (type !== 'multi-tap-delay') return 0;
	const next = normalizeStandardDelayParams(params);
	const pitched = Number(next.pitchShift) !== 0;
	const rings = pitched ? Number(next.echoes) + 1 : 1;
	const history = standardDelayCapacityFrames(next, rate, channels) * rings * channels * Float32Array.BYTES_PER_ELEMENT;
	return history + (pitched ? STAFFPAD_MAXIMUM_MEMORY_BYTES + Number(next.echoes) * channels * (standardDelayPitchQueueFrames(next, rate) + 1024) * Float32Array.BYTES_PER_ELEMENT : 0);
}

/** Rendering, transferred input, output, persistence and the retained DSP state. */
export function standardSelectionEffectPeakBytes(type: StandardEffectType, frames: number,
	params: Readonly<Record<string, unknown>>, options: Options): number {
	const channels = options.channelCount ?? 2;
	const rate = options.sampleRate ?? 48000;
	if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('inputFrames must be a positive safe integer.');
	const speed = type === 'multi-tap-delay' && delaySelectionPitchMode(params.pitchMode) === 'speed' && Number(params.pitchShift ?? 0) !== 0 && Number(params.mix ?? 1) !== 0;
	if (speed) {
		// Speed renders channel pairs sequentially under StaffPad's rate limits.
		if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new RangeError('channelCount must be between 1 and 32.');
		if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError('sampleRate must be an integer between 8000 and 192000 Hz.');
	}
	const inputBytes = frames * channels * Float32Array.BYTES_PER_ELEMENT;
	const outputBytes = type === 'multi-tap-delay' ? standardDelaySelectionOutputFrames(frames, params, rate) * channels * Float32Array.BYTES_PER_ELEMENT : inputBytes;
	let scratch = speed ? STAFFPAD_MAXIMUM_MEMORY_BYTES : standardEffectStateBytes(type, params, rate, channels);
	if (type === 'multi-tap-delay') scratch += standardDelaySpeedScratchFrames(frames, params) * channels * Float32Array.BYTES_PER_ELEMENT;
	if (options.spectralWindowSize != null) {
		const size = options.spectralWindowSize;
		if (!Number.isInteger(size) || size < 32 || size > 16384 || (size & (size - 1)) !== 0) {
			throw new RangeError('spectralWindowSize must be a power of two between 32 and 16384.');
		}
		scratch += inputBytes + frames * Float64Array.BYTES_PER_ELEMENT * 2 + size * Float64Array.BYTES_PER_ELEMENT * 5;
	}
	const bytes = inputBytes * 2 + outputBytes * 2 + scratch + 2 * 1024 ** 2;
	if (!Number.isSafeInteger(bytes)) throw new RangeError('The selection effect byte estimate is too large.');
	return bytes;
}
