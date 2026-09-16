/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeDesktopAudioCodecCapabilityQuery,
	type DesktopAudioCodecCapabilityTuple } from './desktop-audio-codec-capability-contract.ts';
import { LARGE_AUDIO_FILE_BYTES, LARGE_AUDIO_DURATION_SECONDS, LARGE_AUDIO_PCM_CHUNK_FRAMES } from '../src/common/editor/large-audio-policy.ts';

export const DESKTOP_AUDIO_STREAM_MAXIMUM_BYTES = LARGE_AUDIO_FILE_BYTES;
export const DESKTOP_AUDIO_STREAM_MAXIMUM_PCM_BYTES = LARGE_AUDIO_DURATION_SECONDS * 192_000 * 8 * 4;
export const DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES = 1024 * 1024;
export const DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES = LARGE_AUDIO_PCM_CHUNK_FRAMES;
export interface DesktopAudioStreamPlan {
	readonly schemaVersion: 1;
	readonly tuple: DesktopAudioCodecCapabilityTuple;
	readonly frameCount: number;
	readonly maximumOutputBytes: number;
}
export type DesktopAudioStreamCommand =
	| Readonly<{ type: 'begin'; plan: DesktopAudioStreamPlan }>
	| Readonly<{ type: 'write'; operationId: string; offset: number; bytes: Uint8Array }>
	| Readonly<{ type: 'execute' | 'stat' | 'status' | 'delete'; operationId: string }>
	| Readonly<{ type: 'read'; operationId: string; offset: number; maximumBytes: number }>;

export function normalizeDesktopAudioStreamPlan(value: unknown): DesktopAudioStreamPlan {
	const record = audioStreamRecord(value, ['schemaVersion', 'tuple', 'frameCount', 'maximumOutputBytes']);
	const tuple = normalizeDesktopAudioCodecCapabilityQuery({ schemaVersion: 2, operations: [record.tuple] }).operations[0]!;
	if (record.schemaVersion !== 1 || tuple.operation !== 'audio-encode' || tuple.format === 'aac-m4a') {
		throw new TypeError('Desktop streaming audio requires a reviewed bundled encoder.');
	}
	const frameCount = audioStreamInteger(record.frameCount, 1, LARGE_AUDIO_DURATION_SECONDS * tuple.sampleRate, 'frame count');
	if (tuple.channelCount > 8 || frameCount * tuple.channelCount * 4 > DESKTOP_AUDIO_STREAM_MAXIMUM_PCM_BYTES) {
		throw new RangeError('Desktop streaming PCM exceeds its one-hour profile byte bound.');
	}
	return Object.freeze({ schemaVersion: 1, tuple, frameCount,
		maximumOutputBytes: audioStreamInteger(record.maximumOutputBytes, 1, DESKTOP_AUDIO_STREAM_MAXIMUM_BYTES, 'output bound') });
}
export function normalizeDesktopAudioStreamCommand(value: unknown): DesktopAudioStreamCommand {
	const type = value && typeof value === 'object' ? (value as Record<string, unknown>).type : null;
	if (type === 'begin') {
		const record = audioStreamRecord(value, ['type', 'plan']);
		return Object.freeze({ type, plan: normalizeDesktopAudioStreamPlan(record.plan) });
	}
	if (type === 'execute' || type === 'stat' || type === 'status' || type === 'delete') {
		const record = audioStreamRecord(value, ['type', 'operationId']);
		return Object.freeze({ type, operationId: audioStreamOperationId(record.operationId) });
	}
	if (type === 'write') {
		const record = audioStreamRecord(value, ['type', 'operationId', 'offset', 'bytes']);
		if (!(record.bytes instanceof Uint8Array) || record.bytes.byteLength < 1
			|| record.bytes.byteLength > DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES) {
			throw new RangeError('Desktop streaming audio packet exceeds its bound.');
		}
		return Object.freeze({ type, operationId: audioStreamOperationId(record.operationId),
			offset: audioStreamInteger(record.offset, 0, DESKTOP_AUDIO_STREAM_MAXIMUM_PCM_BYTES, 'offset'), bytes: record.bytes });
	}
	if (type === 'read') {
		const record = audioStreamRecord(value, ['type', 'operationId', 'offset', 'maximumBytes']);
		return Object.freeze({ type, operationId: audioStreamOperationId(record.operationId),
			offset: audioStreamInteger(record.offset, 0, DESKTOP_AUDIO_STREAM_MAXIMUM_BYTES, 'offset'),
			maximumBytes: audioStreamInteger(record.maximumBytes, 1, DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES, 'range length') });
	}
	throw new TypeError('Unknown desktop streaming audio command.');
}
export function audioStreamOperationId(value: unknown): string {
	if (typeof value !== 'string' || !/^desktop-audio-stream-[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Invalid desktop streaming audio operation identity.');
	}
	return value;
}
export function audioStreamInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`Desktop streaming audio ${label} exceeds its bound.`);
	}
	return Number(value);
}
export function audioStreamRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Desktop streaming audio requires a plain record.');
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some((field) => {
		const descriptor = descriptors[field]; return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
	})) throw new TypeError('Desktop streaming audio record has an inexact shape.');
	return value as Record<string, unknown>;
}
