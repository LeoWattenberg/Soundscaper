/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeCaptureSpoolCreationFence,
	type CaptureSpoolCreationFence,
} from './capture-spool-creation-fence.ts';

const MAXIMUM_CHUNK_BYTES = 8 * 1024 * 1024;

export interface CreateRawPcmSpoolRequest {
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken?: string;
	readonly creationFence?: CaptureSpoolCreationFence;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly data: unknown;
}

export interface RawPcmSpoolReservationIdentity {
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
}

export function normalizeRawPcmSpoolCreateRequest(
	value: CreateRawPcmSpoolRequest,
): CreateRawPcmSpoolRequest {
	const creationFence = normalizeCaptureSpoolCreationFence(value?.creationFence);
	const request = {
		projectId: stableId(value?.projectId, 'raw PCM spool projectId'),
		spoolId: stableId(value?.spoolId, 'raw PCM spool ID'),
		...(value?.spoolToken === undefined ? {} : {
			spoolToken: stableId(value.spoolToken, 'raw PCM spool token'),
		}),
		...(creationFence === undefined ? {} : { creationFence }),
		sampleRate: boundedPositiveInteger(value?.sampleRate, 768_000, 'raw PCM spool sampleRate'),
		channelCount: boundedPositiveInteger(value?.channelCount, 64, 'raw PCM spool channelCount'),
		chunkFrames: boundedPositiveInteger(value?.chunkFrames, 65_536, 'raw PCM spool chunkFrames'),
		data: snapshotData(value?.data),
	};
	if (request.channelCount * request.chunkFrames * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Raw PCM spool chunks exceed the strict memory bound.');
	}
	return Object.freeze(request);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} must be a supported positive integer.`);
	}
	return Number(value);
}

function snapshotData<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
