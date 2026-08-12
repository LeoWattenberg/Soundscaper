/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	TRANSIENT_ANALYSIS_ALGORITHM,
	normalizeTransientAnalysisParameters,
	type TransientAnalysisResult,
} from '../src/common/editor/transient-analysis.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createTransientAnalysisCacheRecord,
	transientAnalysisIdentity,
	type TransientAnalysisCacheRecord,
} from '../src/common/editor/storage/transient-analysis-cache.ts';
import {
	TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX,
	TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES,
	TransientAnalysisCacheRepository,
	transientAnalysisCacheEntryKey,
	type TransientAnalysisCacheKeyValuePort,
} from '../src/common/editor/storage/transient-analysis-cache-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
type Backend = 'memory' | 'indexeddb';

interface InstrumentedIndexedDB extends IDBFactory {
	readonly stats: {
		readonly cursorRequests: readonly Readonly<{ store: string; delivered: number }>[];
	};
	failNextDeleteForStore(storeName: string, error?: Error): void;
	recordCount(databaseName: string, storeName: string): number;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}
const PARAMETERS = normalizeTransientAnalysisParameters({
	windowFrames: 64,
	hopFrames: 32,
	baselineWindowHops: 4,
	sensitivity: 1.5,
	minimumSpacingFrames: 128,
	floorDbfs: -60,
});
for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} transient cache bounds useful bytes and evicts the least recently used row`, async () => {
		let now = 1_000;
		const records = [cacheRecord(1, 2), cacheRecord(2, 3), cacheRecord(3, 4)];
		const fixture = await repositoryFixture(backend, {
			maximumBytes: records.reduce((sum, record) => sum + record.payloadByteLength, 0),
			maximumEntries: 2,
			maximumAgeMs: 60_000,
		}, () => now);

		await fixture.repository.save(records[0]!.key, records[0]);
		now += 1;
		await fixture.repository.save(records[1]!.key, records[1]);
		now += 1;
		assert.equal((await fixture.repository.load(records[0]!.key))?.key, records[0]!.key);
		now += 1;
		await fixture.repository.save(records[2]!.key, records[2]);

		assert.equal(await fixture.repository.load(records[1]!.key), null);
		assert.equal((await fixture.repository.load(records[0]!.key))?.key, records[0]!.key);
		assert.equal((await fixture.repository.load(records[2]!.key))?.key, records[2]!.key);
		assert.deepEqual(fixture.transientPayloadKeys(), [records[0]!.key, records[2]!.key].sort());
		assert.equal(fixture.transientEntryKeys().length, 2);
	});

	test(`${backend} transient cache accounts exact payload bytes rather than metadata overhead`, async () => {
		const records = [cacheRecord(4, 1), cacheRecord(5, 5)];
		const fixture = await repositoryFixture(backend, {
			maximumBytes: records[0]!.payloadByteLength + records[1]!.payloadByteLength,
			maximumEntries: 2,
			maximumAgeMs: 60_000,
		}, () => 5_000);

		await fixture.repository.save(records[0]!.key, records[0]);
		await fixture.repository.save(records[1]!.key, records[1]);

		assert.equal((await fixture.repository.load(records[0]!.key))?.key, records[0]!.key);
		assert.equal((await fixture.repository.load(records[1]!.key))?.key, records[1]!.key);
		assert.equal(fixture.analysisRecords().length, 4, 'each useful payload has one scalar LRU companion');
	});

	test(`${backend} transient cache applies expiry before touch at and above the exact age boundary`, async () => {
		let now = 1_000;
		const boundary = cacheRecord(40, 1);
		const younger = cacheRecord(41, 1);
		const fixture = await repositoryFixture(backend, {
			maximumBytes: 1_000_000,
			maximumEntries: 2,
			maximumAgeMs: 100,
		}, () => now);

		await fixture.repository.save(boundary.key, boundary);
		now = 1_100;
		assert.equal(await fixture.repository.load(boundary.key), null, 'the exact boundary is expired');
		now = 2_000;
		await fixture.repository.save(younger.key, younger);
		now = 2_099;
		assert.equal((await fixture.repository.load(younger.key))?.key, younger.key, 'one millisecond younger hits');
		now = 2_200;
		assert.equal(await fixture.repository.load(younger.key), null, 'a row above the touched boundary expires');
	});

	test(`${backend} transient cache resolves equal-time eviction ties by canonical key`, async () => {
		const records = [cacheRecord(42, 1), cacheRecord(43, 1), cacheRecord(44, 1)]
			.sort((left, right) => left.key.localeCompare(right.key));
		const fixture = await repositoryFixture(backend, {
			maximumBytes: 1_000_000,
			maximumEntries: 2,
			maximumAgeMs: 60_000,
		}, () => 3_000);

		for (const record of records) await fixture.repository.save(record.key, record);

		assert.deepEqual(fixture.transientPayloadKeys(), [records[1]!.key, records[2]!.key]);
		assert.equal(await fixture.repository.load(records[0]!.key), null);
	});
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} transient cache deletes corrupt payloads and malformed LRU metadata when encountered`, async () => {
		let now = 10_000;
		const fixture = await repositoryFixture(backend, {
			maximumBytes: 1_000_000,
			maximumEntries: 4,
			maximumAgeMs: 60_000,
		}, () => now);
		const corruptPayload = cacheRecord(6, 2);
		const corruptMetadata = cacheRecord(7, 2);
		await fixture.putUnrelated('waveform:keep', { levels: [0.5] });
		await fixture.repository.save(corruptPayload.key, corruptPayload);
		now += 1;
		await fixture.repository.save(corruptMetadata.key, corruptMetadata);

		fixture.seed(corruptPayload.key, {
			...corruptPayload,
			payloadSha256: '0'.repeat(64),
		});
		const metadataKey = transientAnalysisCacheEntryKey(corruptMetadata.key);
		const metadataRow = fixture.record(metadataKey);
		assert.ok(metadataRow);
		fixture.seed(metadataKey, {
			...(metadataRow.value as Record<string, unknown>),
			committedAt: 'not-a-canonical-timestamp',
		});
		const malformedEntryKey = `${TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX}%malformed`;
		fixture.seed(malformedEntryKey, { version: 1 });

		assert.equal(await fixture.repository.load(corruptPayload.key), null);
		assert.equal(await fixture.repository.load(corruptMetadata.key), null);
		assert.equal(fixture.record(corruptPayload.key), null);
		assert.equal(fixture.record(transientAnalysisCacheEntryKey(corruptPayload.key)), null);
		assert.equal(fixture.record(corruptMetadata.key), null);
		assert.equal(fixture.record(metadataKey), null);
		assert.equal(fixture.record(malformedEntryKey), null);
		assert.deepEqual(await fixture.loadUnrelated('waveform:keep'), { levels: [0.5] });
	});
}
test('malformed transient namespace keys cannot bypass lifecycle accounting through generic analysis storage', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueName('transient-malformed-key'),
	});
	await assert.rejects(
		store.saveAnalysis('transient-analysis-sha256:not-a-digest', { arbitrary: true }),
		/transient analysis cache key/iu,
	);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} source deletion purges only disposable transient cache prefixes`, async () => {
		const indexedDB = backend === 'indexeddb'
			? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
			: null;
		const databaseName = uniqueName(`transient-source-delete-${backend}`);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName,
		});
		const records = [cacheRecord(8, 1), cacheRecord(9, 2)];
		for (const record of records) await store.saveAnalysis(record.key, record);
		await store.saveAnalysis('waveform:keep', { levels: [0.25] });
		const malformedEntryKey = `${TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX}malformed`;
		const malformedEntry = { key: malformedEntryKey, value: { version: 99 } };
		if (indexedDB) {
			for (let index = 0; index < 130; index += 1) {
				indexedDB.seedRecord(databaseName, 'analysis', {
					key: `unrelated:${String(index).padStart(3, '0')}`,
					value: index,
				});
			}
			indexedDB.seedRecord(databaseName, 'analysis', malformedEntry);
		} else {
			getMemoryDatabase(databaseName).analysis.set(malformedEntryKey, malformedEntry);
		}
		const writer = await store.beginSourceWrite('source-to-delete', {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
		});
		await writer.write([Float32Array.of(0, 0.25)]);
		await writer.commit();
		const cursorCountBeforeDelete = indexedDB?.stats.cursorRequests.length ?? 0;

		await store.deleteSource('source-to-delete');
		const purgeCursors = indexedDB?.stats.cursorRequests.slice(cursorCountBeforeDelete) ?? [];

		assert.equal(await store.getSourceMetadata('source-to-delete'), null);
		assert.deepEqual(await store.loadAnalysis('waveform:keep'), { levels: [0.25] });
		for (const record of records) assert.equal(await store.loadAnalysis(record.key), null);
		const physicalRows = indexedDB
			? indexedDB.records(databaseName, 'analysis')
			: [...getMemoryDatabase(databaseName).analysis.values()] as Record<string, unknown>[];
		assert.ok(physicalRows.every(({ key }) => (
			!String(key).startsWith('transient-analysis-sha256:')
			&& !String(key).startsWith(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX)
		)));
		if (indexedDB) {
			assert.equal(indexedDB.recordCount(databaseName, 'analysis'), 131);
			assert.ok(purgeCursors.length >= 6, 'the physical purge must use multiple short cursor transactions');
			assert.ok(purgeCursors.every(({ store: storeName, delivered }) => (
				storeName !== 'analysis' || delivered <= 64
			)), JSON.stringify(purgeCursors));
		}
		await store.close();
	});
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} retention pruning purges transient rows without consulting them as deletion roots`, async () => {
		const indexedDB = backend === 'indexeddb'
			? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
			: null;
		const databaseName = uniqueName(`transient-prune-${backend}`);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName,
		});
		const cached = cacheRecord(45, 2);
		await store.saveAnalysis(cached.key, cached);
		await store.saveAnalysis('waveform:keep', { levels: [0.125] });
		const writer = await store.beginSourceWrite('prune-source', {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
		});
		await writer.write([Float32Array.of(0, 0.5)]);
		await writer.commit();

		const result = await store.pruneUnreferencedSources({
			minimumAgeMs: 0,
			now: Date.now() + 24 * 60 * 60 * 1_000,
		});

		assert.deepEqual(result.deletedSourceIds, ['prune-source']);
		assert.equal(await store.getSourceMetadata('prune-source'), null);
		assert.equal(await store.loadAnalysis(cached.key), null);
		assert.deepEqual(await store.loadAnalysis('waveform:keep'), { levels: [0.125] });
		await store.close();
	});
}

test('a transient cache deletion fault cannot roll back or reject authoritative source deletion', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const databaseName = uniqueName('transient-source-delete-fault');
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	const record = cacheRecord(10, 2);
	await store.saveAnalysis(record.key, record);
	await store.saveAnalysis('waveform:keep', { levels: [0.75] });
	const writer = await store.beginSourceWrite('authoritative-source', {
		sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
	});
	await writer.write([Float32Array.of(0, 0.5)]);
	await writer.commit();
	indexedDB.failNextDeleteForStore('analysis', new Error('planned disposable cache cleanup failure'));

	await store.deleteSource('authoritative-source');

	assert.equal(await store.getSourceMetadata('authoritative-source'), null);
	assert.deepEqual(await store.loadAnalysis('waveform:keep'), { levels: [0.75] });
	assert.ok(
		indexedDB.records(databaseName, 'analysis').some(({ key }) => key === record.key),
		'the failed disposable cleanup remains retryable instead of changing source deletion truth',
	);
	await store.close();
});

test('the retained ceiling leaves one physical publication slot and repairs it after reopen', async () => {
	assert.equal(TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES, 4_095);
	const databaseName = uniqueName('transient-physical-headroom');
	const memory = getMemoryDatabase(databaseName);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	assert.throws(() => new TransientAnalysisCacheRepository(port, {
		limits: { maximumBytes: 10_000_000, maximumEntries: 4_096 },
	}), /maximumEntries cannot exceed 4095/iu);
	const retained: Readonly<TransientAnalysisCacheRecord>[] = [];
	for (let index = 0; index < TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES; index += 1) {
		const record = cacheRecord(10_000 + index, 0);
		retained.push(record);
		seedMemoryValue(memory, record.key, record);
		seedMemoryValue(memory, transientAnalysisCacheEntryKey(record.key), cacheEntryValue(record, 1_000));
	}
	const orphan = cacheRecord(20_000, 0);
	seedMemoryValue(memory, orphan.key, orphan);
	assert.equal(transientPayloadKeys(memory).length, 4_096, 'one repair slot is physically representable');

	const reopened = new TransientAnalysisCacheRepository(port, {
		limits: {
			maximumBytes: 10_000_000,
			maximumEntries: TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES,
		},
		now: () => 2_000,
	});
	assert.equal((await reopened.load(retained.at(-1)!.key))?.key, retained.at(-1)!.key);
	assert.equal(memory.analysis.has(orphan.key), false, 'reopen maintenance repairs the unpaired slot');
	const incoming = cacheRecord(20_001, 0);
	await reopened.save(incoming.key, incoming);
	assert.equal(transientPayloadKeys(memory).length, TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES);
	assert.equal(transientEntryKeys(memory).length, TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES);
	assert.equal(memory.analysis.has(incoming.key), true);

	const secondReopen = new TransientAnalysisCacheRepository(port, {
		limits: {
			maximumBytes: 10_000_000,
			maximumEntries: TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES,
		},
		now: () => 2_001,
	});
	assert.equal((await secondReopen.load(incoming.key))?.key, incoming.key);
	assert.equal(transientPayloadKeys(memory).length, TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES);
});

test('stale eviction snapshots cannot delete a concurrent cache replacement', async () => {
	let now = 1_000;
	const values = new HookedKeyValuePort();
	const repository = new TransientAnalysisCacheRepository(values, {
		limits: { maximumBytes: 1_000_000, maximumEntries: 2 },
		now: () => now,
	});
	const first = cacheRecord(50, 2);
	const second = cacheRecord(51, 2);
	const incoming = cacheRecord(52, 2);
	await repository.save(first.key, first);
	now = 2_000;
	await repository.save(second.key, second);
	const replacement = replacementCacheRecord(first);
	values.beforeNextDelete(first.key, () => {
		values.seed(first.key, replacement);
		values.seed(
			transientAnalysisCacheEntryKey(first.key),
			cacheEntryValue(replacement, 4_000),
		);
	});
	now = 3_000;

	await repository.save(incoming.key, incoming);

	assert.deepEqual(await repository.load(first.key), replacement);
	assert.equal(await repository.load(second.key), null, 'a fresh inventory evicts the actual oldest row');
	assert.equal((await repository.load(incoming.key))?.key, incoming.key);
});

test('an inventory failure settles the just-written pair before a later retry', async () => {
	const values = new HookedKeyValuePort();
	const repository = new TransientAnalysisCacheRepository(values, {
		limits: { maximumBytes: 1_000_000, maximumEntries: 2 },
		now: () => 5_000,
	});
	const failed = cacheRecord(53, 1);
	values.failNextInventory(new Error('planned inventory failure'));

	await assert.rejects(repository.save(failed.key, failed), /planned inventory failure/u);
	assert.equal(values.has(failed.key), false);
	assert.equal(values.has(transientAnalysisCacheEntryKey(failed.key)), false);
	const retry = cacheRecord(54, 1);
	assert.equal((await repository.save(retry.key, retry)).key, retry.key);
});

function cacheRecord(seed: number, transientCount: number): Readonly<TransientAnalysisCacheRecord> {
	const sourceRange = Object.freeze({ startFrame: 0, endFrame: 10_000 });
	const identity = transientAnalysisIdentity({
		sourceSha256: seed.toString(16).padStart(64, '0'),
		sourceRange,
		parameters: PARAMETERS,
	});
	const analysis: TransientAnalysisResult = Object.freeze({
		algorithmId: TRANSIENT_ANALYSIS_ALGORITHM.id,
		algorithmRevision: TRANSIENT_ANALYSIS_ALGORITHM.revision,
		channelPolicy: identity.channelPolicy,
		parameters: PARAMETERS,
		sourceRange,
		transients: Object.freeze(Array.from({ length: transientCount }, (_, index) => Object.freeze({
			sourceFrame: 100 + index * 100,
			strength: 0.5,
		}))),
	});
	return createTransientAnalysisCacheRecord(identity, analysis);
}

function replacementCacheRecord(
	record: Readonly<TransientAnalysisCacheRecord>,
): Readonly<TransientAnalysisCacheRecord> {
	return createTransientAnalysisCacheRecord({
		key: record.key,
		derivativeBindingVersion: record.derivativeBindingVersion,
		sourceSha256: record.sourceSha256,
		sourceRange: record.sourceRange,
		channelPolicy: record.channelPolicy,
		algorithmId: record.algorithmId,
		algorithmRevision: record.algorithmRevision,
		parameters: record.parameters,
	}, {
		algorithmId: record.algorithmId,
		algorithmRevision: record.algorithmRevision,
		channelPolicy: record.channelPolicy,
		parameters: record.parameters,
		sourceRange: record.sourceRange,
		transients: record.transients.map((transient) => Object.freeze({
			...transient,
			strength: transient.strength === 0.5 ? 0.75 : 0.5,
		})),
	});
}

function cacheEntryValue(
	record: Readonly<TransientAnalysisCacheRecord>,
	committedAt: number,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		version: 1,
		key: transientAnalysisCacheEntryKey(record.key),
		payloadKey: record.key,
		size: record.payloadByteLength,
		payloadSha256: record.payloadSha256,
		committedAt: new Date(committedAt).toISOString(),
	});
}

function seedMemoryValue(memory: EditorMemoryDatabase, key: string, value: unknown): void {
	memory.analysis.set(key, { key, value: structuredClone(value) });
}

function transientPayloadKeys(memory: EditorMemoryDatabase): string[] {
	return [...memory.analysis.keys()].filter((key) => key.startsWith('transient-analysis-sha256:'));
}

function transientEntryKeys(memory: EditorMemoryDatabase): string[] {
	return [...memory.analysis.keys()].filter((key) => key.startsWith(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX));
}

class HookedKeyValuePort implements TransientAnalysisCacheKeyValuePort {
	readonly #values = new Map<string, unknown>();
	readonly #beforeDelete = new Map<string, () => void>();
	#inventoryFailure: Error | null = null;

	get(key: string): unknown {
		return clone(this.#values.get(key));
	}

	put(key: string, value: unknown): unknown {
		this.#values.set(key, clone(value));
		return clone(value);
	}

	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): boolean {
		if (!sameValue(this.#values.get(key), expected)) return false;
		this.#values.set(key, clone(replacement));
		return true;
	}

	deleteIfCurrent(key: string, expected: unknown): boolean {
		const beforeDelete = this.#beforeDelete.get(key);
		if (beforeDelete) {
			this.#beforeDelete.delete(key);
			beforeDelete();
		}
		if (!sameValue(this.#values.get(key), expected)) return false;
		return this.#values.delete(key);
	}

	delete(key: string): void {
		this.#values.delete(key);
	}

	deleteByPrefix(prefix: string): number {
		let deleted = 0;
		for (const key of this.#values.keys()) {
			if (key.startsWith(prefix) && this.#values.delete(key)) deleted += 1;
		}
		return deleted;
	}

	listByPrefix(prefix: string): readonly Readonly<{ key: string; projectId: string; value: unknown }>[] {
		if (this.#inventoryFailure) {
			const failure = this.#inventoryFailure;
			this.#inventoryFailure = null;
			throw failure;
		}
		return Object.freeze([...this.#values.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => Object.freeze({ key, projectId: '', value: clone(value) })));
	}

	seed(key: string, value: unknown): void {
		this.#values.set(key, clone(value));
	}

	beforeNextDelete(key: string, callback: () => void): void {
		this.#beforeDelete.set(key, callback);
	}

	failNextInventory(error: Error): void {
		this.#inventoryFailure = error;
	}

	has(key: string): boolean {
		return this.#values.has(key);
	}
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function clone<Value>(value: Value): Value {
	return value === undefined ? value : structuredClone(value);
}

async function repositoryFixture(
	backend: Backend,
	limits: Readonly<{ maximumBytes: number; maximumEntries: number; maximumAgeMs: number }>,
	now: () => number,
): Promise<Readonly<{
	repository: TransientAnalysisCacheRepository;
	analysisRecords(): Record<string, unknown>[];
	transientPayloadKeys(): string[];
	transientEntryKeys(): string[];
	record(key: string): Record<string, unknown> | null;
	seed(key: string, value: unknown): void;
	putUnrelated(key: string, value: unknown): Promise<void>;
	loadUnrelated(key: string): Promise<unknown>;
}>> {
	const databaseName = uniqueName(`transient-repository-${backend}`);
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb'
		? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
		: null;
	const database = indexedDB ? await openDatabase(indexedDB, databaseName) : null;
	const port: StorageRepositoryPort = {
		memory,
		database: async () => database,
	};
	const repository = new TransientAnalysisCacheRepository(port, { limits, now });
	const analysisRecords = (): Record<string, unknown>[] => (
		indexedDB
			? indexedDB.records(databaseName, 'analysis')
			: [...memory.analysis.values()] as Record<string, unknown>[]
	);
	const record = (key: string): Record<string, unknown> | null => (
		analysisRecords().find((candidate) => candidate.key === key) ?? null
	);
	const seed = (key: string, value: unknown): void => {
		const row = { key, value: structuredClone(value) };
		if (indexedDB) indexedDB.seedRecord(databaseName, 'analysis', row);
		else memory.analysis.set(key, row);
	};
	return Object.freeze({
		repository,
		analysisRecords,
		transientPayloadKeys: () => analysisRecords()
			.map(({ key }) => String(key))
			.filter((key) => key.startsWith('transient-analysis-sha256:'))
			.sort(),
		transientEntryKeys: () => analysisRecords()
			.map(({ key }) => String(key))
			.filter((key) => key.startsWith(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX))
			.sort(),
		record,
		seed,
		putUnrelated: async (key, value) => {
			seed(key, value);
		},
		loadUnrelated: async (key) => record(key)?.value ?? null,
	});
}

function uniqueName(prefix: string): string {
	return `${prefix}-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
}
