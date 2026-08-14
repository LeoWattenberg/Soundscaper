/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ReviewedEffectWasmRuntime,
	loadReviewedEffectPackage,
} from './runtime.ts';
import {
	processReviewedEffectOffline,
	type ReviewedEffectOfflineOptions,
} from './offline-worker-client.ts';
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
	normalizeUtilityGainParams(paramsValue);
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
	normalizeUtilityGainParams(paramsValue);
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

/**
 * Process an arbitrary selection through the release-pinned package in bounded
 * ABI blocks. Product callers route this function through the editor's
 * terminating selection worker; the worker service refuses a main-thread
 * fallback for reviewed packages.
 */
export async function applyReviewedUtilityGainSelection(
	channelsValue: unknown,
	sampleRate: number,
	paramsValue: unknown,
): Promise<readonly Float32Array[]> {
	const channels = normalizeChannels(channelsValue);
	const parameters = normalizeUtilityGainParams(paramsValue);
	const runtime = new ReviewedEffectWasmRuntime(
		await loadReviewedEffectPackage(REVIEWED_UTILITY_GAIN_PACKAGE_REFERENCE),
	);
	const output = channels.map((channel) => new Float32Array(channel.length));
	const maximumBlockFrames = UTILITY_GAIN_MANIFEST.resources.maximumBlockFrames;
	for (let startFrame = 0; startFrame < channels[0]!.length; startFrame += maximumBlockFrames) {
		const endFrame = Math.min(channels[0]!.length, startFrame + maximumBlockFrames);
		const block = runtime.process({
			sampleRate,
			channels: channels.map((channel) => channel.subarray(startFrame, endFrame)),
			parameters,
		});
		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			output[channelIndex]!.set(block[channelIndex]!, startFrame);
		}
	}
	return Object.freeze(output);
}

/**
 * Process a complete selection through terminating, catalog-locked workers.
 * Each request remains inside the package block envelope; no package code or
 * WASM instance is evaluated in the editor or its generic selection worker.
 */
export async function applyReviewedUtilityGainSelectionOffline(
	channelsValue: unknown,
	sampleRate: number,
	paramsValue: unknown,
	options: ReviewedEffectOfflineOptions = {},
): Promise<readonly Float32Array[]> {
	const channels = normalizeChannels(channelsValue);
	const parameters = normalizeUtilityGainParams(paramsValue);
	const output = channels.map((channel) => new Float32Array(channel.length));
	const maximumBlockFrames = UTILITY_GAIN_MANIFEST.resources.maximumBlockFrames;
	for (let startFrame = 0; startFrame < channels[0]!.length; startFrame += maximumBlockFrames) {
		const endFrame = Math.min(channels[0]!.length, startFrame + maximumBlockFrames);
		const block = await processReviewedEffectOffline(REVIEWED_UTILITY_GAIN_PACKAGE_REFERENCE, {
			sampleRate,
			channels: channels.map((channel) => channel.subarray(startFrame, endFrame)),
			parameters,
		}, options);
		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			output[channelIndex]!.set(block[channelIndex]!, startFrame);
		}
	}
	return Object.freeze(output);
}

function normalizeChannels(value: unknown): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > UTILITY_GAIN_MANIFEST.resources.maximumChannels
		|| value.some((channel) => !(channel instanceof Float32Array))) {
		throw new RangeError('Reviewed Utility Gain requires one or two Float32Array channels.');
	}
	const channels = value as Float32Array[];
	const frameCount = channels[0]!.length;
	if (frameCount < 1 || channels.some((channel) => channel.length !== frameCount)) {
		throw new RangeError('Reviewed Utility Gain channels must have one matching, non-empty frame count.');
	}
	return channels;
}

function normalizeUtilityGainParams(value: unknown): Readonly<{ gain: number }> {
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
