/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RawPcmSpoolRecord } from './raw-pcm-spool-repository.ts';
import type { SourceChunkRecord } from './source-record-repository.ts';

export const FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES = 1_048_576;

export interface RawPcmSpoolChunkTiming {
	readonly presentationTimeMicroseconds: number;
	readonly durationMicroseconds: number;
	readonly droppedFramesBefore: number;
}

export interface TimedRawPcmSpoolChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
	readonly timing: Readonly<RawPcmSpoolChunkTiming> | null;
}

export function normalizeRawPcmSpoolChunkTiming(
	value: unknown,
): Readonly<RawPcmSpoolChunkTiming> | null {
	if (value === undefined || value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Raw PCM spool chunk timing must be a data record.');
	}
	const timing = value as Readonly<Record<string, unknown>>;
	if (Object.keys(timing).length !== 3
		|| !Object.hasOwn(timing, 'presentationTimeMicroseconds')
		|| !Object.hasOwn(timing, 'durationMicroseconds')
		|| !Object.hasOwn(timing, 'droppedFramesBefore')) {
		throw new TypeError('Raw PCM spool chunk timing has an invalid closed shape.');
	}
	return Object.freeze({
		presentationTimeMicroseconds: nonNegativeInteger(
			timing.presentationTimeMicroseconds,
			'Raw PCM presentation time',
		),
		durationMicroseconds: positiveInteger(timing.durationMicroseconds, 'Raw PCM duration'),
		droppedFramesBefore: boundedNonNegativeInteger(
			timing.droppedFramesBefore,
			FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES,
			'Raw PCM dropped frames',
		),
	});
}

export function normalizeTimedRawPcmSpoolChunk(
	value: SourceChunkRecord | null,
	record: RawPcmSpoolRecord,
	index: number,
): TimedRawPcmSpoolChunk {
	if (!value || value.sourceToken !== record.spoolToken || value.index !== index
		|| !Array.isArray(value.channels) || value.channels.length !== record.channelCount) {
		throw new Error(`Raw PCM spool chunk ${String(index)} is missing or invalid.`);
	}
	const frames = boundedPositiveInteger(value.frames, record.chunkFrames, 'raw PCM spool chunk frames');
	const channels = value.channels.map((buffer) => {
		if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== frames * Float32Array.BYTES_PER_ELEMENT) {
			throw new Error(`Raw PCM spool chunk ${String(index)} has invalid channel bytes.`);
		}
		return new Float32Array(buffer.slice(0));
	});
	return Object.freeze({
		index,
		frames,
		channels: Object.freeze(channels),
		timing: normalizeRawPcmSpoolChunkTiming(value.framescaperCaptureTimingV1),
	});
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	const result = positiveInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
}

function boundedNonNegativeInteger(value: unknown, maximum: number, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
}
