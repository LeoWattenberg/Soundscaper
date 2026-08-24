/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, pathless renderer/main contract for exact desktop audio codec availability. */

import {
	DESKTOP_AUDIO_CODEC_FORMATS,
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
	type DesktopAudioCodecFormat,
} from './desktop-audio-codec-operation-contract.ts';

export const DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION = 1 as const;
export const DESKTOP_AUDIO_CODEC_CAPABILITY_QUERY_LIMIT = 14;

export type DesktopAudioCodecCapabilityProvider =
	| 'bundled'
	| 'operating-system'
	| 'external-ffmpeg';

export type DesktopAudioCodecCapabilityReason =
	| 'configure-external-ffmpeg'
	| 'unsupported-by-configured-ffmpeg'
	| 'unsupported-settings';

export interface DesktopAudioCodecCapabilityTuple {
	readonly operation: 'audio-decode' | 'audio-encode';
	readonly format: DesktopAudioCodecFormat;
	readonly sampleRate: number;
	readonly channelCount: number;
}

export interface DesktopAudioCodecCapabilityQuery {
	readonly schemaVersion: typeof DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION;
	readonly operations: readonly DesktopAudioCodecCapabilityTuple[];
}

export interface DesktopAudioCodecCapabilityEntry extends DesktopAudioCodecCapabilityTuple {
	readonly available: boolean;
	readonly provider: DesktopAudioCodecCapabilityProvider | null;
	readonly reason: DesktopAudioCodecCapabilityReason | null;
}

export interface DesktopAudioCodecCapabilityResult {
	readonly schemaVersion: typeof DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION;
	readonly capabilities: readonly DesktopAudioCodecCapabilityEntry[];
}

const FORMATS = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);
const PROVIDERS = new Set<string>(['bundled', 'operating-system', 'external-ffmpeg']);
const REASONS = new Set<string>([
	'configure-external-ffmpeg', 'unsupported-by-configured-ffmpeg', 'unsupported-settings',
]);
const QUERY_FIELDS = Object.freeze(['schemaVersion', 'operations'] as const);
const RESULT_FIELDS = Object.freeze(['schemaVersion', 'capabilities'] as const);
const TUPLE_FIELDS = Object.freeze(['operation', 'format', 'sampleRate', 'channelCount'] as const);
const ENTRY_FIELDS = Object.freeze([
	...TUPLE_FIELDS, 'available', 'provider', 'reason',
] as const);

export function normalizeDesktopAudioCodecCapabilityQuery(
	value: unknown,
): DesktopAudioCodecCapabilityQuery {
	const record = exactRecord(value, 'capability query');
	exactKeys(record, QUERY_FIELDS, 'capability query');
	if (record.schemaVersion !== DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION
		|| !Array.isArray(record.operations) || record.operations.length < 1
		|| record.operations.length > DESKTOP_AUDIO_CODEC_CAPABILITY_QUERY_LIMIT) {
		throw new TypeError('The desktop audio codec capability query is invalid or outside its bound.');
	}
	const operations = record.operations.map((operation) => normalizeTuple(operation));
	const identities = new Set(operations.map(tupleIdentity));
	if (identities.size !== operations.length) {
		throw new TypeError('The desktop audio codec capability query contains a duplicate tuple.');
	}
	return Object.freeze({
		schemaVersion: DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION,
		operations: Object.freeze(operations),
	});
}

export function normalizeDesktopAudioCodecCapabilityResult(
	value: unknown,
	queryValue: unknown,
): DesktopAudioCodecCapabilityResult {
	const query = normalizeDesktopAudioCodecCapabilityQuery(queryValue);
	const record = exactRecord(value, 'capability result');
	exactKeys(record, RESULT_FIELDS, 'capability result');
	if (record.schemaVersion !== DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION
		|| !Array.isArray(record.capabilities)
		|| record.capabilities.length !== query.operations.length) {
		throw new TypeError('The desktop audio codec capability result does not correlate with its query.');
	}
	const capabilities = record.capabilities.map((candidate, index) => {
		const entry = normalizeEntry(candidate);
		if (tupleIdentity(entry) !== tupleIdentity(query.operations[index]!)) {
			throw new TypeError('The desktop audio codec capability result tuple does not correlate with its query.');
		}
		return entry;
	});
	return Object.freeze({
		schemaVersion: DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION,
		capabilities: Object.freeze(capabilities),
	});
}

function normalizeTuple(value: unknown): DesktopAudioCodecCapabilityTuple {
	const record = exactRecord(value, 'capability tuple');
	exactKeys(record, TUPLE_FIELDS, 'capability tuple');
	if (record.operation !== 'audio-decode' && record.operation !== 'audio-encode') {
		throw new TypeError('The desktop audio codec capability tuple operation is unsupported.');
	}
	if (typeof record.format !== 'string' || !FORMATS.has(record.format)) {
		throw new TypeError('The desktop audio codec capability tuple format is unsupported.');
	}
	const sampleRate = integer(
		record.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'capability tuple sample rate',
	);
	const channelCount = integer(
		record.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
		'capability tuple channel count',
	);
	return Object.freeze({
		operation: record.operation,
		format: record.format as DesktopAudioCodecFormat,
		sampleRate,
		channelCount,
	});
}

function normalizeEntry(value: unknown): DesktopAudioCodecCapabilityEntry {
	const record = exactRecord(value, 'capability result entry');
	exactKeys(record, ENTRY_FIELDS, 'capability result entry');
	const tuple = normalizeTuple(Object.fromEntries(TUPLE_FIELDS.map((field) => [field, record[field]])));
	if (typeof record.available !== 'boolean') {
		throw new TypeError('The desktop audio codec capability result availability is invalid.');
	}
	const provider = record.provider;
	const reason = record.reason;
	if (record.available
		? typeof provider !== 'string' || !PROVIDERS.has(provider) || reason !== null
		: provider !== null || typeof reason !== 'string' || !REASONS.has(reason)) {
		throw new TypeError('The desktop audio codec capability result authority is invalid.');
	}
	return Object.freeze({
		...tuple,
		available: record.available,
		provider: provider as DesktopAudioCodecCapabilityProvider | null,
		reason: reason as DesktopAudioCodecCapabilityReason | null,
	});
}

function tupleIdentity(tuple: DesktopAudioCodecCapabilityTuple): string {
	return `${tuple.operation}:${tuple.format}:${String(tuple.sampleRate)}:${String(tuple.channelCount)}`;
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The desktop audio codec ${label} must be a plain record.`);
	}
	if (Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && !Object.hasOwn(descriptor, 'value');
	})) throw new TypeError(`The desktop audio codec ${label} must contain only data properties.`);
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, fields: readonly string[], label: string): void {
	const keys = Reflect.ownKeys(record);
	if (fields.some((field) => !Object.hasOwn(record, field))
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The desktop audio codec ${label} has an inexact shape.`);
	}
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The desktop audio codec ${label} is outside its bound.`);
	}
	return Number(value);
}
