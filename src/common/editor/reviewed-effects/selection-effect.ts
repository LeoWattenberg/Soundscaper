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
import {
	REVIEWED_UTILITY_GAIN_PACKAGE_REFERENCE,
	normalizeReviewedUtilityGainParams,
} from './selection-effect-contract.ts';

export * from './selection-effect-contract.ts';

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
	const parameters = normalizeReviewedUtilityGainParams(paramsValue);
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
	const parameters = normalizeReviewedUtilityGainParams(paramsValue);
	const output = channels.map((channel) => new Float32Array(channel.length));
	const maximumBlockFrames = UTILITY_GAIN_MANIFEST.resources.maximumBlockFrames;
	const frameCount = channels[0]!.length;
	for (let startFrame = 0; startFrame < frameCount; startFrame += maximumBlockFrames) {
		const endFrame = Math.min(frameCount, startFrame + maximumBlockFrames);
		const block = await processReviewedEffectOffline(REVIEWED_UTILITY_GAIN_PACKAGE_REFERENCE, {
			sampleRate,
			channels: channels.map((channel) => channel.subarray(startFrame, endFrame)),
			parameters,
		}, options);
		for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
			output[channelIndex]!.set(block[channelIndex]!, startFrame);
		}
		// One worker is constructed and terminated per admitted block, so a long selection
		// is a long wall-clock apply. Report the block boundary the caller can render.
		options.onProgress?.(endFrame / frameCount);
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
