/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from './key-value-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';
import { restoreRawPcmAcknowledgedPrefix } from './raw-pcm-spool-prefix-repair.ts';
import {
	normalizeRawPcmSpoolChunkTiming,
	normalizeTimedRawPcmSpoolChunk,
	type RawPcmSpoolChunkTiming,
	type TimedRawPcmSpoolChunk,
} from './raw-pcm-spool-chunk-timing.ts';
import {
	putCaptureSpoolIfFenceCurrent,
	replaceCaptureSpoolIfFenceCurrent,
	type CaptureSpoolCreationFence,
} from './capture-spool-creation-fence.ts';
import {
	normalizeRawPcmSpoolCreateRequest,
	type CreateRawPcmSpoolRequest,
	type RawPcmSpoolReservationIdentity,
} from './raw-pcm-spool-create.ts';
import { prepareRawPcmSpoolTail, recoverRawPcmSpoolTail } from './raw-pcm-spool-tail-cleanup.ts';
import {
	commitRawPcmAppendMetadata,
	assertNoPendingRawPcmAppend,
	prepareRawPcmAppend,
	reconcileRawPcmAppend,
	recoverRawPcmAppendBeforeLoad,
	recoverRawPcmAppendWhileLocked,
	type RawPcmAcknowledgedPrefix,
} from './raw-pcm-spool-append.ts';
import { withCaptureSpoolOperationLock } from './capture-spool-operation-lock.ts';
import {
	assertRawPcmSpoolOwnership as assertSameOwnership,
	freezeRawPcmSpoolRecord as freezeRecord,
	freezeRawPcmSpoolRegistry as freezeRegistry,
	normalizeRawPcmSpoolRecord as normalizeRecord,
	normalizeRawPcmSpoolRegistry as normalizeRegistry,
	normalizeRawPcmSpoolChunkIndex,
	sameRawPcmSpoolRecord as sameRecord,
	snapshotRawPcmChannels as snapshotChannels,
	snapshotRawPcmData as snapshotData,
	type RawPcmSpoolRecord,
} from './raw-pcm-spool-record.ts';
import {
	freezeRawPcmSpoolGlobalInventory as freezeGlobalInventory,
	normalizeRawPcmSpoolGlobalInventory as normalizeGlobalInventory,
	rawPcmSpoolGlobalEntry as globalEntry,
	RAW_PCM_MAXIMUM_GLOBAL_ACTIVE_SPOOLS as MAXIMUM_GLOBAL_ACTIVE_SPOOLS,
	type RawPcmSpoolGlobalInventory,
} from './raw-pcm-spool-global-inventory.ts';

export type { CreateRawPcmSpoolRequest, RawPcmSpoolReservationIdentity } from './raw-pcm-spool-create.ts';
export type { RawPcmSpoolRecord, RawPcmSpoolState } from './raw-pcm-spool-record.ts';
const KEY_PREFIX = 'raw-pcm-spool-registry-v1:';
const GENERATION_KEY_PREFIX = 'take-cycle-publication-generation-v1:';
const GLOBAL_INVENTORY_KEY = 'raw-pcm-spool-global-inventory-v1';
const MAXIMUM_ACTIVE_SPOOLS = 64;
const MAXIMUM_CAS_ATTEMPTS = 32;

export type RawPcmSpoolChunk = TimedRawPcmSpoolChunk;
export type { RawPcmSpoolChunkTiming } from './raw-pcm-spool-chunk-timing.ts';
type RawPcmSpoolValues = Pick<KeyValueRepository,
	'get' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent' | 'listByPrefix'
> & Partial<Pick<KeyValueRepository,
	'putIfAbsentWhenCurrent' | 'replaceIfCurrentWhenCurrent' | 'replaceIfCurrentAndPutIfAbsent'
>>;
type RawPcmSpoolChunks = Pick<SourceRecordRepository, 'writeChunk' | 'chunk' | 'deleteChunks'>
	& Partial<Pick<SourceRecordRepository, 'deleteChunksFrom'>>;
/** CAS-owned raw PCM prefixes using existing analysis and source-chunk stores. */
export class RawPcmSpoolRepository {
	readonly #values: RawPcmSpoolValues;
	readonly #chunks: RawPcmSpoolChunks;

	constructor(values: RawPcmSpoolValues, chunks: RawPcmSpoolChunks) {
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
		return this.#create(requestValue, false);
	}

	async createFramescaper(requestValue: CreateRawPcmSpoolRequest): Promise<RawPcmSpoolRecord> {
		return this.#create(requestValue, true);
	}

	async #create(requestValue: CreateRawPcmSpoolRequest, framescaper: boolean): Promise<RawPcmSpoolRecord> {
		const request = normalizeRawPcmSpoolCreateRequest(requestValue);
		const record = freezeRecord({
			version: 1,
			projectId: request.projectId,
			spoolId: request.spoolId,
			spoolToken: request.spoolToken ?? `${request.spoolId}:capture:${createId()}`,
			state: 'capturing',
			sampleRate: request.sampleRate,
			channelCount: request.channelCount,
			chunkFrames: request.chunkFrames,
			frameCount: 0,
			chunkCount: 0,
			data: snapshotData(request.data),
			...(framescaper ? { appendProtocol: 'framescaper-manifest-v1' as const } : {}),
		});
		await this.#reserveGlobal(record, request.creationFence);
		try {
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
					if (await putCaptureSpoolIfFenceCurrent(
						this.#values, request.creationFence, registryKey(record.projectId), next,
					)) return record;
				} else if (await replaceCaptureSpoolIfFenceCurrent(
					this.#values, request.creationFence, registryKey(record.projectId), registry.value, next,
				)) {
					return record;
				}
			}
			throw new Error('Raw PCM spool creation exceeded its bounded CAS retry limit.');
		} catch (error) {
			await this.#releaseGlobal(record);
			throw error;
		}
	}

	async list(projectIdValue: string): Promise<readonly RawPcmSpoolRecord[]> {
		const projectId = stableId(projectIdValue, 'raw PCM spool projectId');
		return this.#loadRegistry(projectId).then(({ records }) => records);
	}

	async listAll(): Promise<readonly RawPcmSpoolRecord[]> {
		const records: RawPcmSpoolRecord[] = [];
		for (const value of await this.#values.listByPrefix(KEY_PREFIX)) {
			const record = dataRecord(value, 'raw PCM spool registry entry');
			const registry = await this.#loadRegistry(stableId(record.projectId, 'raw PCM spool projectId'));
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

	async releaseReservation(identityValue: RawPcmSpoolReservationIdentity): Promise<boolean> {
		const identity: RawPcmSpoolReservationIdentity = Object.freeze({
			projectId: stableId(identityValue?.projectId, 'raw PCM spool projectId'),
			spoolId: stableId(identityValue?.spoolId, 'raw PCM spool ID'),
			spoolToken: stableId(identityValue?.spoolToken, 'raw PCM spool token'),
		});
		if (await this.load(identity.projectId, identity.spoolId)) return false;
		return this.#releaseGlobalIdentity(identity);
	}

	async append(
		expectedValue: RawPcmSpoolRecord,
		channelsValue: readonly Float32Array[],
		data: unknown,
		timingValue: RawPcmSpoolChunkTiming | null = null,
	): Promise<RawPcmSpoolRecord> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'capturing') throw new Error('Only a capturing raw PCM spool can append PCM.');
		const channels = snapshotChannels(channelsValue, expected.channelCount, expected.chunkFrames);
		const timing = normalizeRawPcmSpoolChunkTiming(timingValue);
		const frames = channels[0]!.length;
		const next = freezeRecord({
			...expected,
			frameCount: exactSum(expected.frameCount, frames, 'raw PCM spool frameCount'),
			chunkCount: exactSum(expected.chunkCount, 1, 'raw PCM spool chunkCount'),
			data: snapshotData(data),
		});
		const chunk: SourceChunkRecord = {
			key: chunkKey(expected.spoolToken, expected.chunkCount),
			sourceToken: expected.spoolToken,
			index: expected.chunkCount,
			frames,
			channels: channels.map((channel) => channel.buffer.slice(0)),
			createdAt: Date.now(),
			...(timing ? { framescaperCaptureTimingV1: timing } : {}),
		};
		if (expected.appendProtocol !== 'framescaper-manifest-v1') {
			await this.#assertCurrent(expected);
			await this.#chunks.writeChunk(chunk);
			if (!await this.#replace(expected, next)) {
				throw new Error('Raw PCM spool ownership changed after its next chunk became a removable tail.');
			}
			return next;
		}
		return withCaptureSpoolOperationLock(operationIdentity(expected), async () => {
		const registry = await this.#loadRegistry(expected.projectId, false);
		const index = registry.records.findIndex(({ spoolId }) => spoolId === expected.spoolId);
		if (index < 0 || !sameRecord(registry.records[index]!, expected)) {
			throw new Error('Raw PCM spool ownership changed.');
		}
		const records = [...registry.records];
		records[index] = next;
		const nextRegistry = freezeRegistry(expected.projectId, records);
		const intent = await prepareRawPcmAppend(
			this.#values, expected, next, registryKey(expected.projectId), registry.value, normalizeRecord,
		);
		await this.#chunks.writeChunk(chunk);
		await commitRawPcmAppendMetadata(
			this.#values, intent, registryKey(expected.projectId), registry.value, nextRegistry, next, normalizeRecord,
			(value) => normalizeRegistry(value, expected.projectId).records
				.find(({ spoolId }) => spoolId === expected.spoolId) ?? null,
		);
		return next;
		});
	}

	async reconcileAppend(
		currentValue: RawPcmSpoolRecord,
		prefix: RawPcmAcknowledgedPrefix,
	): Promise<RawPcmSpoolRecord> {
		const current = normalizeRecord(currentValue);
		return reconcileRawPcmAppend(
			this.#values, current, prefix, normalizeRecord,
			async () => (await this.#loadRegistry(current.projectId, false)).records
				.find(({ spoolId }) => spoolId === current.spoolId) ?? null,
			(advanced, previous) => this.restoreAcknowledgedPrefix(advanced, previous),
		);
	}

	/** Restore the exact manifest-acknowledged prefix after its following manifest CAS is refused. */
	async restoreAcknowledgedPrefix(
		currentValue: RawPcmSpoolRecord,
		acknowledgedValue: RawPcmSpoolRecord,
	): Promise<RawPcmSpoolRecord> {
		const current = normalizeRecord(currentValue);
		const acknowledged = normalizeRecord(acknowledgedValue);
		assertSameOwnership(current, acknowledged);
		if (!this.#chunks.deleteChunksFrom) throw new Error('Raw PCM acknowledged-prefix cleanup is unavailable.');
		return withCaptureSpoolOperationLock(operationIdentity(current), async () => {
			const loadCurrent = async () => (await this.#loadRegistry(current.projectId, false)).records
				.find(({ spoolId }) => spoolId === current.spoolId) ?? null;
			const restored = await restoreRawPcmAcknowledgedPrefix(current, acknowledged, {
				replace: () => prepareRawPcmSpoolTail(
					this.#values, current, acknowledged, registryKey(current.projectId),
					() => this.#loadRegistry(current.projectId, false),
				),
				load: loadCurrent,
				deleteTail: () => recoverRawPcmSpoolTail(this.#values, this.#chunks, acknowledged),
			});
			const reconciled = await recoverRawPcmAppendWhileLocked(
				this.#values, this.#chunks, restored, normalizeRecord, loadCurrent,
			);
			if (!reconciled || !sameRecord(reconciled, restored)) {
				throw new Error('Raw PCM append intent changed after acknowledged-prefix repair.');
			}
			return reconciled;
		});
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
		if (expected.state === 'discarded' || expected.state === 'deleting') {
			throw new Error('A settled raw PCM spool cannot replace data.');
		}
		const next = freezeRecord({ ...expected, data: snapshotData(data) });
		if (sameRecord(expected, next)) return expected;
		if (!await this.#replace(expected, next)) throw new Error('Raw PCM spool changed before data replacement.');
		return next;
	}

	async *chunks(recordValue: RawPcmSpoolRecord): AsyncGenerator<RawPcmSpoolChunk> {
		const record = normalizeRecord(recordValue);
		if (record.state === 'discarded' || record.state === 'deleting') {
			throw new Error('Discarded raw PCM is not readable capture evidence.');
		}
		await this.#assertCurrent(record);
		for (let index = 0; index < record.chunkCount; index += 1) {
			const stored = await this.#chunks.chunk(record.spoolToken, index);
			const chunk = normalizeTimedRawPcmSpoolChunk(stored, record, index);
			yield chunk;
		}
		await this.#assertCurrent(record);
	}

	async chunk(recordValue: RawPcmSpoolRecord, indexValue: number): Promise<RawPcmSpoolChunk> {
		const record = normalizeRecord(recordValue);
		if (record.state === 'discarded' || record.state === 'deleting') {
			throw new Error('Discarded raw PCM is not readable capture evidence.');
		}
		const index = normalizeRawPcmSpoolChunkIndex(indexValue);
		if (index >= record.chunkCount) throw new RangeError(`Raw PCM spool chunk ${String(index)} is outside its prefix.`);
		await this.#assertCurrent(record);
		const stored = await this.#chunks.chunk(record.spoolToken, index);
		const chunk = normalizeTimedRawPcmSpoolChunk(stored, record, index);
		await this.#assertCurrent(record);
		return chunk;
	}

	/** Settle an exact capturing prefix as failed before reclaiming its owned PCM. */
	async discard(expectedValue: RawPcmSpoolRecord, data: unknown): Promise<boolean> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'capturing') return false;
		const discarded = freezeRecord({ ...expected, state: 'discarded', data: snapshotData(data) });
		let settled: RawPcmSpoolRecord | null = null;
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const current = (await this.#loadRegistry(expected.projectId)).records
				.find(({ spoolId }) => spoolId === expected.spoolId);
			if (!current) return true;
			if (sameRecord(current, discarded)) {
				settled = current;
				break;
			}
			if (!sameRecord(current, expected)) return false;
			if (await this.#replace(current, discarded)) {
				settled = discarded;
				break;
			}
		}
		if (!settled) throw new Error('Raw PCM spool discard exceeded its bounded CAS retry limit.');
		await this.#chunks.deleteChunks(settled.spoolToken);
		return this.#removeRecord(settled);
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
		if (expected.appendProtocol !== 'framescaper-manifest-v1') {
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
		return withCaptureSpoolOperationLock(operationIdentity(expected), async () => {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const registry = await this.#loadRegistry(expected.projectId, false);
			const index = registry.records.findIndex(({ spoolId }) => spoolId === expected.spoolId);
			if (index < 0 || !sameRecord(registry.records[index]!, expected)) return false;
			await recoverRawPcmSpoolTail(this.#values, this.#chunks, expected);
			await assertNoPendingRawPcmAppend(this.#values, expected, normalizeRecord);
			const records = [...registry.records];
			records[index] = replacement;
			const next = freezeRegistry(expected.projectId, records);
			if (await this.#values.replaceIfCurrent(registryKey(expected.projectId), registry.value, next)) return true;
		}
		throw new Error('Raw PCM spool replacement exceeded its bounded CAS retry limit.');
		});
	}

	async #removeRecord(expected: RawPcmSpoolRecord): Promise<boolean> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const registry = await this.#loadRegistry(expected.projectId);
			const index = registry.records.findIndex(({ spoolId }) => spoolId === expected.spoolId);
			if (index < 0) {
				await this.#releaseGlobal(expected);
				return true;
			}
			if (!sameRecord(registry.records[index]!, expected)) return false;
			const records = registry.records.filter((_, recordIndex) => recordIndex !== index);
			if (!records.length) {
				if (await this.#values.deleteIfCurrent(registryKey(expected.projectId), registry.value)) {
					await this.#releaseGlobal(expected);
					return true;
				}
			} else {
				const next = freezeRegistry(expected.projectId, records);
				if (await this.#values.replaceIfCurrent(registryKey(expected.projectId), registry.value, next)) {
					await this.#releaseGlobal(expected);
					return true;
				}
			}
		}
		throw new Error('Raw PCM spool removal exceeded its bounded CAS retry limit.');
	}

	async #reserveGlobal(record: RawPcmSpoolRecord, fence: CaptureSpoolCreationFence | undefined): Promise<void> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(GLOBAL_INVENTORY_KEY);
			const inventory = value == null ? await this.#repairGlobalInventory() : normalizeGlobalInventory(value);
			if (inventory.entries.some((entry) => entry.projectId === record.projectId && entry.spoolId === record.spoolId)) {
				throw new Error(`Raw PCM spool ${record.spoolId} already exists.`);
			}
			if (inventory.entries.length >= MAXIMUM_GLOBAL_ACTIVE_SPOOLS) {
				throw new RangeError('Raw PCM spool inventory exceeds its global bound.');
			}
			const next = freezeGlobalInventory([...inventory.entries, globalEntry(record)]);
			if (value == null) {
				if (await putCaptureSpoolIfFenceCurrent(this.#values, fence, GLOBAL_INVENTORY_KEY, next)) return;
			} else if (await replaceCaptureSpoolIfFenceCurrent(
				this.#values, fence, GLOBAL_INVENTORY_KEY, value, next,
			)) return;
		}
		throw new Error('Raw PCM spool global admission exceeded its bounded CAS retry limit.');
	}

	async #releaseGlobal(record: RawPcmSpoolRecord): Promise<void> {
		if (!await this.#releaseGlobalIdentity(record)) throw new Error('Raw PCM spool global reservation ownership changed.');
	}

	async #releaseGlobalIdentity(identity: RawPcmSpoolReservationIdentity): Promise<boolean> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(GLOBAL_INVENTORY_KEY);
			if (value == null) return true;
			const inventory = normalizeGlobalInventory(value);
			const owned = inventory.entries.find((entry) => (
				entry.projectId === identity.projectId && entry.spoolId === identity.spoolId
			));
			if (!owned) return !inventory.entries.some(({ spoolToken }) => spoolToken === identity.spoolToken);
			if (owned.spoolToken !== identity.spoolToken) return false;
			const entries = inventory.entries.filter((entry) => entry !== owned);
			const next = freezeGlobalInventory(entries);
			if (await this.#values.replaceIfCurrent(GLOBAL_INVENTORY_KEY, value, next)) return true;
		}
		throw new Error('Raw PCM spool global release exceeded its bounded CAS retry limit.');
	}

	async #repairGlobalInventory(): Promise<RawPcmSpoolGlobalInventory> {
		const entries = [];
		for (const value of await this.#values.listByPrefix(KEY_PREFIX)) {
			const record = dataRecord(value, 'raw PCM spool registry entry');
			const registry = normalizeRegistry(record.value, stableId(record.projectId, 'raw PCM spool projectId'));
			entries.push(...registry.records.map(globalEntry));
			if (entries.length > MAXIMUM_GLOBAL_ACTIVE_SPOOLS) {
				throw new RangeError('Raw PCM spool inventory exceeds its global bound.');
			}
		}
		return freezeGlobalInventory(entries);
	}

	async #loadRegistry(projectId: string, recoverAppends = true): Promise<Readonly<{
		readonly exists: boolean;
		readonly value: unknown;
		readonly records: readonly RawPcmSpoolRecord[];
	}>> {
		const key = registryKey(projectId);
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(key);
			if (value === undefined || value === null) {
				return Object.freeze({ exists: false, value, records: Object.freeze([]) });
			}
			const registry = normalizeRegistry(value, projectId);
			if (!recoverAppends) return Object.freeze({ exists: true, value, records: registry.records });
			for (const observed of registry.records) {
				if (observed.appendProtocol !== 'framescaper-manifest-v1') continue;
				await recoverRawPcmAppendBeforeLoad(
					this.#values, this.#chunks, observed, normalizeRecord, async () => {
						const latest = await this.#values.get(key);
						if (latest == null) return null;
						return normalizeRegistry(latest, projectId).records
							.find(({ spoolId }) => spoolId === observed.spoolId) ?? null;
					},
					(record) => recoverRawPcmSpoolTail(this.#values, this.#chunks, record),
				);
			}
			if (sameData(await this.#values.get(key), value)) {
				return Object.freeze({ exists: true, value, records: registry.records });
			}
		}
		throw new Error('Raw PCM spool load exceeded its bounded concurrent-change retry limit.');
	}
}

function operationIdentity(record: RawPcmSpoolRecord) {
	return Object.freeze({
		storageKind: 'raw-pcm' as const, projectId: record.projectId,
		spoolId: record.spoolId, spoolToken: record.spoolToken,
	});
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

function sameData(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}
function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
function chunkKey(token: string, index: number): string { return `${token}:${String(index).padStart(10, '0')}`; }
function registryKey(projectId: string): string { return `${KEY_PREFIX}${encodeURIComponent(projectId)}`; }
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

function createId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
