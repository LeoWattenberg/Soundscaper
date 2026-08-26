/* SPDX-License-Identifier: AGPL-3.0-only */

import { UTILITY_GAIN_MANIFEST } from './utility-gain-package.ts';

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MEMORY_ESTIMATE_OVERHEAD_BYTES = 2 * 1024 ** 2;

export const REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE = 'reviewed-utility-gain' as const;
export const REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_LABEL = 'Utility Gain (Reviewed)' as const;
export const REVIEWED_UTILITY_GAIN_PACKAGE_REFERENCE = Object.freeze({
	id: UTILITY_GAIN_MANIFEST.id,
	version: UTILITY_GAIN_MANIFEST.version,
});

export const REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({ gain: 1 }),
	ranges: Object.freeze({
		gain: Object.freeze([0, 4, Object.freeze({
			unit: 'ratio', step: 0.01, taper: 'linear',
		})]),
	}),
});

/** Utility Gain is length preserving and is admitted with its exact catalog parameter range. */
export function estimateReviewedUtilityGainOutputFrames(
	inputFramesValue: unknown,
	paramsValue: unknown,
): number {
	const inputFrames = positiveInteger(inputFramesValue, 'inputFrames');
	normalizeReviewedUtilityGainParams(paramsValue);
	return inputFrames;
}

/** Bound the complete selection, output, persistence copy, and one WASM block. */
export function estimateReviewedUtilityGainPeakBytes(
	inputFramesValue: unknown,
	paramsValue: unknown,
	channelCountValue: unknown = 2,
): number {
	const inputFrames = positiveInteger(inputFramesValue, 'inputFrames');
	const channelCount = positiveInteger(
		channelCountValue,
		'channelCount',
		UTILITY_GAIN_MANIFEST.resources.maximumChannels,
	);
	normalizeReviewedUtilityGainParams(paramsValue);
	const pcmBytes = safeBytes(inputFrames * channelCount * FLOAT32_BYTES);
	const persistenceScratch = Math.min(inputFrames, 65_536) * channelCount * FLOAT32_BYTES
		+ Math.ceil(pcmBytes / 8);
	return safeBytes(
		pcmBytes * 3
		+ persistenceScratch
		+ UTILITY_GAIN_MANIFEST.resources.maximumMemoryPages * 65_536
		+ MEMORY_ESTIMATE_OVERHEAD_BYTES,
	);
}

export function normalizeReviewedUtilityGainParams(value: unknown): Readonly<{ gain: number }> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Reviewed Utility Gain parameters must be a plain object.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Reviewed Utility Gain parameters must be a plain object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'gain')) {
		throw new RangeError('Reviewed Utility Gain accepts only the gain parameter.');
	}
	const gain = Number((value as Readonly<{ gain?: unknown }>).gain ?? 1);
	if (!Number.isFinite(gain) || gain < 0 || gain > 4) {
		throw new RangeError('Reviewed Utility Gain gain must be between 0 and 4.');
	}
	return Object.freeze({ gain });
}

function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

function safeBytes(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The reviewed effect memory estimate is too large.');
	}
	return Math.ceil(value);
}
