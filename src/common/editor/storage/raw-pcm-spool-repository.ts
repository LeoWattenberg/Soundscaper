/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from './key-value-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';

const KEY_PREFIX = 'raw-pcm-spool-registry-v1:';
const GENERATION_KEY_PREFIX = 'take-cycle-publication-generation-v1:';
const MAXIMUM_ACTIVE_SPOOLS = 64;
const MAXIMUM_GLOBAL_ACTIVE_SPOOLS = 4_096;
const MAXIMUM_CHUNK_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CAS_ATTEMPTS = 32;

export type RawPcmSpoolState = 'capturing' | 'sealed' | 'deleting';

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
}

export interface CreateRawPcmSpoolRequest {
	readonly projectId: string;
	readonly spoolId: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly data: unknown;
}

interface RawPcmSpoolRegistry {
	readonly version: 1;
	readonly projectId: string;
	readonly records: readonly RawPcmSpoolRecord[];
}

export interface RawPcmSpoolChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

/** CAS-owned raw PCM prefixes using existing analysis and source-chunk stores. */
export class RawPcmSpoolRepository {
	readonly #values: Pick<KeyValueRepository,
		'get' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent' | 'listByPrefix'
	>;
	readonly #chunks: Pick<SourceRecordRepository, 'writeChunk' | 'chunk' | 'deleteChunks'>;

	constructor(
		values: Pick<KeyValueRepository,
			'get' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent' | 'listByPrefix'
		>,
		chunks: Pick<SourceRecordRepository, 'writeChunk' | 'chunk' | 'deleteChunks'>,
	) {
		this.#values = values;
		this.#chunks = chunks;
	}

	async allocateGeneration(projectIdValue: string): Promise<number> {
		const projectId = stableId(projectIdValue, 'take cycle generation projectId');
		const key = `${GENERATION_KEY_PREFIX}${encodeURIComponent(projectId)}`;
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(key);
			if (value === undefined || value === null) {
				const initial = freezeGeneration(projectId, 1);
				if (await this.#values.putIfAbsent(key, initial)) return initial.generation;
				continue;
			}
			const current = normalizeGeneration(value, projectId);
			const next = freezeGeneration(
				projectId,
				exactSum(current.generation, 1, 'take cycle publication generation'),
			);
			if (await this.#values.replaceIfCurrent(key, value, next)) return next.generation;
		}
		throw new Error('Take cycle generation allocation exceeded its bounded CAS retry limit.');
	}

	async create(requestValue: CreateRawPcmSpoolRequest): Promise<RawPcmSpoolRecord> {
		const request = normalizeCreateRequest(requestValue);
		const record = freezeRecord({
			version: 1,
			projectId: request.projectId,
			spoolId: request.spoolId,
			spoolToken: `${request.spoolId}:capture:${createId()}`,
			state: 'capturing',
			sampleRate: request.sampleRate,
			channelCount: request.channelCount,
			chunkFrames: request.chunkFrames,
			frameCount: 0,
			chunkCount: 0,
			data: snapshotData(request.data),
		});
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const registry = await this.#loadRegistry(record.projectId);
			if (registry.records.some(({ spoolId }) => spoolId === record.spoolId)) {
				throw new Error(`Raw PCM spool ${record.spoolId} already exists.`);
			}
			if (registry.records.length >= MAXIMUM_ACTIVE_SPOOLS) {
				throw new RangeError(`Project ${record.projectId} has too many active raw PCM spools.`);
			}
			const next = freezeRegistry(record.projectId, [...registry.records, record]);
			if (registry.records.length === 0 && !registry.exists) {
				if (await this.#values.putIfAbsent(registryKey(record.projectId), next)) return record;
			} else if (await this.#values.replaceIfCurrent(registryKey(record.projectId), registry.value, next)) {
				return record;
			}
		}
		throw new Error('Raw PCM spool creation exceeded its bounded CAS retry limit.');
	}

	async list(projectIdValue: string): Promise<readonly RawPcmSpoolRecord[]> {
		const projectId = stableId(projectIdValue, 'raw PCM spool projectId');
		return this.#loadRegistry(projectId).then(({ records }) => records);
	}

	async listAll(): Promise<readonly RawPcmSpoolRecord[]> {
		const records: RawPcmSpoolRecord[] = [];
		for (const value of await this.#values.listByPrefix(KEY_PREFIX)) {
			const record = dataRecord(value, 'raw PCM spool registry entry');
			const registry = normalizeRegistry(record.value, stableId(record.projectId, 'raw PCM spool projectId'));
			records.push(...registry.records);
			if (records.length > MAXIMUM_GLOBAL_ACTIVE_SPOOLS) {
				throw new RangeError('Raw PCM spool inventory exceeds its global bound.');
			}
		}
		return Object.freeze(records);
	}

	async load(projectIdValue: string, spoolIdValue: string): Promise<RawPcmSpoolRecord | null> {
		const projectId = stableId(projectIdValue, 'raw PCM spool projectId');
		const spoolId = stableId(spoolIdValue, 'raw PCM spool ID');
		return (await this.#loadRegistry(projectId)).records.find((record) => record.spoolId === spoolId) ?? null;
	}

	async append(
		expectedValue: RawPcmSpoolRecord,
		channelsValue: readonly Float32Array[],
		data: unknown,
	): Promise<RawPcmSpoolRecord> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'capturing') throw new Error('Only a capturing raw PCM spool can append PCM.');
		const channels = snapshotChannels(channelsValue, expected.channelCount, expected.chunkFrames);
		const frames = channels[0]!.length;
		const next = freezeRecord({
			...expected,
			frameCount: exactSum(expected.frameCount, frames, 'raw PCM spool frameCount'),
			chunkCount: exactSum(expected.chunkCount, 1, 'raw PCM spool chunkCount'),
			data: snapshotData(data),
		});
		await this.#assertCurrent(expected);
		const chunk: SourceChunkRecord = {
			key: chunkKey(expected.spoolToken, expected.chunkCount),
			sourceToken: expected.spoolToken,
			index: expected.chunkCount,
			frames,
			channels: channels.map((channel) => channel.buffer.slice(0)),
			createdAt: Date.now(),
		};
		await this.#chunks.writeChunk(chunk);
		const replaced = await this.#replace(expected, next);
		if (!replaced) {
			throw new Error('Raw PCM spool ownership changed after its next chunk became a removable tail.');
		}
		return next;
	}

	async seal(expectedValue: RawPcmSpoolRecord, data: unknown): Promise<RawPcmSpoolRecord> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'capturing' && expected.state !== 'sealed') {
			throw new Error('A deleting raw PCM spool cannot be sealed.');
		}
		if (expected.frameCount < 1 || expected.chunkCount < 1) {
			throw new Error('A raw PCM spool requires at least one durable chunk before sealing.');
		}
		const next = freezeRecord({ ...expected, state: 'sealed', data: snapshotData(data) });
		if (sameRecord(expected, next)) return expected;
		if (!await this.#replace(expected, next)) throw new Error('Raw PCM spool changed before sealing.');
		return next;
	}

	async replaceData(expectedValue: RawPcmSpoolRecord, data: unknown): Promise<RawPcmSpoolRecord> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state === 'deleting') throw new Error('A deleting raw PCM spool cannot replace data.');
		const next = freezeRecord({ ...expected, data: snapshotData(data) });
		if (sameRecord(expected, next)) return expected;
		if (!await this.#replace(expected, next)) throw new Error('Raw PCM spool changed before data replacement.');
		return next;
	}

	async *chunks(recordValue: RawPcmSpoolRecord): AsyncGenerator<RawPcmSpoolChunk> {
		const record = normalizeRecord(recordValue);
		await this.#assertCurrent(record);
		for (let index = 0; index < record.chunkCount; index += 1) {
			const stored = await this.#chunks.chunk(record.spoolToken, index);
			const chunk = normalizeStoredChunk(stored, record, index);
			yield chunk;
		}
		await this.#assertCurrent(record);
	}

	async chunk(recordValue: RawPcmSpoolRecord, indexValue: number): Promise<RawPcmSpoolChunk> {
		const record = normalizeRecord(recordValue);
		const index = nonNegativeInteger(indexValue, 'raw PCM spool chunk index');
		if (index >= record.chunkCount) throw new RangeError(`Raw PCM spool chunk ${String(index)} is outside its prefix.`);
		await this.#assertCurrent(record);
		const stored = await this.#chunks.chunk(record.spoolToken, index);
		const chunk = normalizeStoredChunk(stored, record, index);
		await this.#assertCurrent(record);
		return chunk;
	}

	async remove(expectedValue: RawPcmSpoolRecord): Promise<boolean> {
		let expected = normalizeRecord(expectedValue);
		if (expected.state !== 'deleting') {
			const deleting = freezeRecord({ ...expected, state: 'deleting' });
			if (!await this.#replace(expected, deleting)) return false;
			expected = deleting;
		}
		await this.#chunks.deleteChunks(expected.spoolToken);
		return this.#removeRecord(expected);
	}

	async #assertCurrent(expected: RawPcmSpoolRecord): Promise<void> {
		const current = (await this.#loadRegistry(expected.projectId)).records
			.find(({ spoolId }) => spoolId === expected.spoolId);
		if (!current || !sameRecord(current, expected)) throw new Error('Raw PCM spool ownership changed.');
	}

	async #replace(expected: RawPcmSpoolRecord, replacement: RawPcmSpoolRecord): Promise<boolean> {
		assertSameOwnership(expected, replacement);
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const registry = await this.#loadRegistry(expected.projectId);
			const index = registry.records.findIndex(({ spoolId }) => spoolId === expected.spoolId);
			if (index < 0 || !sameRecord(registry.records[index]!, expected)) return false;
			const records = [...registry.records];
			records[index] = replacement;
			const next = freezeRegistry(expected.projectId, records);
			if (await this.#values.replaceIfCurrent(registryKey(expected.projectId), registry.value, next)) return true;
		}
		throw new Error('Raw PCM spool replacement exceeded its bounded CAS retry limit.');
	}

	async #removeRecord(expected: RawPcmSpoolRecord): Promise<boolean> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const registry = await this.#loadRegistry(expected.projectId);
			const index = registry.records.findIndex(({ spoolId }) => spoolId === expected.spoolId);
			if (index < 0) return true;
			if (!sameRecord(registry.records[index]!, expected)) return false;
			const records = registry.records.filter((_, recordIndex) => recordIndex !== index);
			if (!records.length) {
				if (await this.#values.deleteIfCurrent(registryKey(expected.projectId), registry.value)) return true;
			} else {
				const next = freezeRegistry(expected.projectId, records);
				if (await this.#values.replaceIfCurrent(registryKey(expected.projectId), registry.value, next)) return true;
			}
		}
		throw new Error('Raw PCM spool removal exceeded its bounded CAS retry limit.');
	}

	async #loadRegistry(projectId: string): Promise<Readonly<{
		readonly exists: boolean;
		readonly value: unknown;
		readonly records: readonly RawPcmSpoolRecord[];
	}>> {
		const value = await this.#values.get(registryKey(projectId));
		if (value === undefined || value === null) {
			return Object.freeze({ exists: false, value, records: Object.freeze([]) });
		}
		const registry = normalizeRegistry(value, projectId);
		return Object.freeze({ exists: true, value, records: registry.records });
	}
}

function normalizeGeneration(value: unknown, projectId: string): Readonly<{
	readonly version: 1;
	readonly projectId: string;
	readonly generation: number;
}> {
	const record = dataRecord(value, 'take cycle publication generation');
	if (record.version !== 1 || record.projectId !== projectId) {
		throw new Error('Take cycle publication generation ownership changed.');
	}
	return freezeGeneration(
		projectId,
		boundedPositiveInteger(record.generation, Number.MAX_SAFE_INTEGER, 'take cycle publication generation'),
	);
}

function freezeGeneration(projectId: string, generation: number) {
	return Object.freeze({ version: 1 as const, projectId, generation });
}

function normalizeCreateRequest(value: CreateRawPcmSpoolRequest): CreateRawPcmSpoolRequest {
	const request = {
		projectId: stableId(value?.projectId, 'raw PCM spool projectId'),
		spoolId: stableId(value?.spoolId, 'raw PCM spool ID'),
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

function normalizeRegistry(value: unknown, expectedProjectId: string): RawPcmSpoolRegistry {
	const record = dataRecord(value, 'raw PCM spool registry');
	if (record.version !== 1 || record.projectId !== expectedProjectId) throw new Error('Raw PCM spool registry identity changed.');
	if (!Array.isArray(record.records) || record.records.length > MAXIMUM_ACTIVE_SPOOLS) {
		throw new Error('Raw PCM spool registry exceeds its active-record bound.');
	}
	const records = record.records.map(normalizeRecord);
	const identities = new Set(records.map(({ spoolId }) => spoolId));
	if (identities.size !== records.length || records.some(({ projectId }) => projectId !== expectedProjectId)) {
		throw new Error('Raw PCM spool registry contains conflicting ownership.');
	}
	return freezeRegistry(expectedProjectId, records);
}

function normalizeRecord(value: unknown): RawPcmSpoolRecord {
	const record = dataRecord(value, 'raw PCM spool record');
	const state = record.state;
	if (record.version !== 1 || (state !== 'capturing' && state !== 'sealed' && state !== 'deleting')) {
		throw new Error('Raw PCM spool record version or state is invalid.');
	}
	const channelCount = boundedPositiveInteger(record.channelCount, 64, 'raw PCM spool channelCount');
	const chunkFrames = boundedPositiveInteger(record.chunkFrames, 65_536, 'raw PCM spool chunkFrames');
	if (channelCount * chunkFrames * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Raw PCM spool chunks exceed the strict memory bound.');
	}
	return freezeRecord({
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
		data: snapshotData(record.data),
	});
}

function freezeRecord(value: RawPcmSpoolRecord): RawPcmSpoolRecord {
	return Object.freeze({ ...value, data: snapshotData(value.data) });
}

function freezeRegistry(projectId: string, records: readonly RawPcmSpoolRecord[]): RawPcmSpoolRegistry {
	return Object.freeze({
		version: 1,
		projectId,
		records: Object.freeze([...records].sort((left, right) => left.spoolId.localeCompare(right.spoolId))),
	});
}

function normalizeStoredChunk(
	value: SourceChunkRecord | null,
	record: RawPcmSpoolRecord,
	index: number,
): RawPcmSpoolChunk {
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
	return Object.freeze({ index, frames, channels: Object.freeze(channels) });
}

function snapshotChannels(
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

function assertSameOwnership(expected: RawPcmSpoolRecord, replacement: RawPcmSpoolRecord): void {
	for (const key of ['version', 'projectId', 'spoolId', 'spoolToken', 'sampleRate', 'channelCount', 'chunkFrames'] as const) {
		if (expected[key] !== replacement[key]) throw new Error(`Raw PCM spool replacement changed ${key}.`);
	}
}

function sameRecord(left: RawPcmSpoolRecord, right: RawPcmSpoolRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}

function snapshotData<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function chunkKey(token: string, index: number): string {
	return `${token}:${String(index).padStart(10, '0')}`;
}

function registryKey(projectId: string): string {
	return `${KEY_PREFIX}${encodeURIComponent(projectId)}`;
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

function createId(): string {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
