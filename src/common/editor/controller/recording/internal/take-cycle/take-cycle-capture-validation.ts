/* SPDX-License-Identifier: AGPL-3.0-only */

import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../../../../wavpack/pcm.js';
import { TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES } from './take-cycle-capture-pcm-evidence.ts';
import type {
	TakeCycleLaneTarget,
	TakeCycleSourceDescription,
} from './take-cycle-recording-repository-composition.ts';
import {
	takeCycleStableId as stableId,
	takeCycleStableName as stableName,
} from './take-cycle-value-validation.ts';

export interface TakeCycleCapturePassIdentities {
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
	readonly journalId: string;
}

export function normalizeTakeCycleCapturePassIdentities(
	value: TakeCycleCapturePassIdentities,
): TakeCycleCapturePassIdentities {
	return Object.freeze({
		laneId: stableId(value?.laneId, 'take cycle pass laneId'),
		takeId: stableId(value?.takeId, 'take cycle takeId'),
		mediaId: stableId(value?.mediaId, 'take cycle mediaId'),
		journalId: stableId(value?.journalId, 'take cycle journalId'),
	});
}

export function normalizeTakeCycleLaneTarget(value: unknown): TakeCycleLaneTarget {
	const record = dataRecord(value, 'take cycle lane target');
	return Object.freeze({
		trackId: stableId(record.trackId, 'take cycle trackId'),
		sequenceId: stableId(record.sequenceId, 'take cycle sequenceId'),
	});
}

export function normalizeTakeCycleCaptureSourceBase(
	value: unknown,
): Omit<TakeCycleSourceDescription, 'frameCount'> {
	const record = dataRecord(value, 'take cycle source description');
	const source = {
		name: stableName(record.name),
		sampleRate: boundedPositiveInteger(record.sampleRate, 768_000, 'take cycle sampleRate'),
		channelCount: boundedPositiveInteger(record.channelCount, 64, 'take cycle channelCount'),
		chunkFrames: boundedPositiveInteger(record.chunkFrames, WAVPACK_PCM_MAXIMUM_FRAMES, 'take cycle chunkFrames'),
	};
	if (source.channelCount * source.chunkFrames * Float32Array.BYTES_PER_ELEMENT
		> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Take cycle capture PCM chunk exceeds its strict memory bound.');
	}
	return Object.freeze(source);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} must be a supported positive safe integer.`);
	}
	return Number(value);
}
