/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_ACTIVE_SPOOLS = 64;
const MAXIMUM_CHUNK_BYTES = 8 * 1024 * 1024;

export type RawPcmSpoolState = 'capturing' | 'sealed' | 'discarded' | 'deleting';

export interface RawPcmSpoolRecord {
	readonly version: 1;
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly state: RawPcmSpoolState;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly frameCount: number;
	readonly chunkCount: number;
	readonly data: unknown;
	readonly appendProtocol?: 'framescaper-manifest-v1';
}

export interface RawPcmSpoolRegistry {
	readonly version: 1;
	readonly projectId: string;
	readonly records: readonly RawPcmSpoolRecord[];
}

export function normalizeRawPcmSpoolRegistry(value: unknown, expectedProjectId: string): RawPcmSpoolRegistry {
	const record = dataRecord(value, 'raw PCM spool registry');
	if (record.version !== 1 || record.projectId !== expectedProjectId) throw new Error('Raw PCM spool registry identity changed.');
	if (!Array.isArray(record.records) || record.records.length > MAXIMUM_ACTIVE_SPOOLS) {
		throw new Error('Raw PCM spool registry exceeds its active-record bound.');
	}
	const records = record.records.map(normalizeRawPcmSpoolRecord);
	const identities = new Set(records.map(({ spoolId }) => spoolId));
	if (identities.size !== records.length || records.some(({ projectId }) => projectId !== expectedProjectId)) {
		throw new Error('Raw PCM spool registry contains conflicting ownership.');
	}
	return freezeRawPcmSpoolRegistry(expectedProjectId, records);
}

export function normalizeRawPcmSpoolRecord(value: unknown): RawPcmSpoolRecord {
	const record = dataRecord(value, 'raw PCM spool record');
	const state = record.state;
	if (record.version !== 1 || (state !== 'capturing' && state !== 'sealed'
		&& state !== 'discarded' && state !== 'deleting')) {
		throw new Error('Raw PCM spool record version or state is invalid.');
	}
	const channelCount = boundedPositiveInteger(record.channelCount, 64, 'raw PCM spool channelCount');
	const chunkFrames = boundedPositiveInteger(record.chunkFrames, 65_536, 'raw PCM spool chunkFrames');
	if (channelCount * chunkFrames * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Raw PCM spool chunks exceed the strict memory bound.');
	}
	return freezeRawPcmSpoolRecord({
		version: 1,
		projectId: stableId(record.projectId, 'raw PCM spool projectId'),
		spoolId: stableId(record.spoolId, 'raw PCM spool ID'),
		spoolToken: stableId(record.spoolToken, 'raw PCM spool token'),
		state,
		sampleRate: boundedPositiveInteger(record.sampleRate, 768_000, 'raw PCM spool sampleRate'),
		channelCount,
		chunkFrames,
		frameCount: nonNegativeInteger(record.frameCount, 'raw PCM spool frameCount'),
		chunkCount: nonNegativeInteger(record.chunkCount, 'raw PCM spool chunkCount'),
		data: snapshotRawPcmData(record.data),
		...(record.appendProtocol === undefined
			? {}
			: { appendProtocol: framescaperAppendProtocol(record.appendProtocol) }),
	});
}

export function freezeRawPcmSpoolRecord(value: RawPcmSpoolRecord): RawPcmSpoolRecord {
	return Object.freeze({ ...value, data: snapshotRawPcmData(value.data) });
}

export function freezeRawPcmSpoolRegistry(
	projectId: string,
	records: readonly RawPcmSpoolRecord[],
): RawPcmSpoolRegistry {
	return Object.freeze({
		version: 1,
		projectId,
		records: Object.freeze([...records].sort((left, right) => left.spoolId.localeCompare(right.spoolId))),
	});
}

export function snapshotRawPcmChannels(
	value: readonly Float32Array[],
	channelCount: number,
	chunkFrames: number,
): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length !== channelCount || !(value[0] instanceof Float32Array)) {
		throw new Error('Raw PCM spool input has invalid channel geometry.');
	}
	const frames = value[0].length;
	if (frames < 1 || frames > chunkFrames
		|| frames * channelCount * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_CHUNK_BYTES
		|| value.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new Error('Raw PCM spool input exceeds its bounded canonical geometry.');
	}
	return Object.freeze(value.map((channel) => channel.slice()));
}

export function assertRawPcmSpoolOwnership(
	expected: RawPcmSpoolRecord,
	replacement: RawPcmSpoolRecord,
): void {
	for (const key of [
		'version', 'projectId', 'spoolId', 'spoolToken', 'sampleRate', 'channelCount', 'chunkFrames', 'appendProtocol',
	] as const) {
		if (expected[key] !== replacement[key]) throw new Error(`Raw PCM spool replacement changed ${key}.`);
	}
}

export function sameRawPcmSpoolRecord(left: RawPcmSpoolRecord, right: RawPcmSpoolRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeRawPcmSpoolChunkIndex(value: unknown): number {
	return nonNegativeInteger(value, 'raw PCM spool chunk index');
}

export function snapshotRawPcmData<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function framescaperAppendProtocol(value: unknown): 'framescaper-manifest-v1' {
	if (value !== 'framescaper-manifest-v1') throw new Error('Raw PCM spool append protocol is invalid.');
	return value;
}
function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
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
function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
