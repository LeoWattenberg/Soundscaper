/* SPDX-License-Identifier: AGPL-3.0-only */

import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../wavpack/pcm.js';
import type { TakeCycleSourceDescription } from './take-cycle-recording-repository-composition.ts';

export function normalizeTakeCycleSourceDescription(
	value: TakeCycleSourceDescription,
	expectedFrames: number,
	projectSampleRate: number,
): TakeCycleSourceDescription {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Take cycle source description is required.');
	}
	const frameCount = positiveInteger(value.frameCount, 'take cycle source frameCount');
	const channelCount = positiveInteger(value.channelCount, 'take cycle source channelCount');
	const chunkFrames = positiveInteger(value.chunkFrames, 'take cycle source chunkFrames');
	const sampleRate = positiveInteger(value.sampleRate, 'take cycle source sampleRate');
	if (frameCount !== expectedFrames) throw new Error('Take cycle source frameCount must equal its exact pass extent.');
	if (sampleRate !== projectSampleRate) throw new Error('Take cycle source PCM must use the project sample rate.');
	if (channelCount > 64) throw new RangeError('Take cycle source channelCount exceeds its limit.');
	if (chunkFrames > WAVPACK_PCM_MAXIMUM_FRAMES) throw new RangeError('Take cycle source chunkFrames exceeds its limit.');
	const name = String(value.name ?? '').trim();
	if (!name || name !== value.name || name.length > 255) throw new TypeError('Take cycle source name is invalid.');
	return Object.freeze({ name, sampleRate, channelCount, chunkFrames, frameCount });
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
