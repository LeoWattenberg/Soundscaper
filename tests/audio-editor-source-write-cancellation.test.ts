/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	sameStoredSourceIdentity,
	type StorageRecord,
} from '../src/common/editor/storage/media-records.ts';
import { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import { SourceWriteRepository } from '../src/common/editor/storage/source-write-repository.ts';

interface FixtureHooks {
	onGetMetadata?: (record: StorageRecord | null, sourceId: string) => PromiseLike<void> | void;
	onPutMetadata?: (record: StorageRecord) => PromiseLike<void> | void;
	onWriteChunk?: (record: Record<string, unknown>) => PromiseLike<void> | void;
	onDeleteStored?: (record: StorageRecord) => PromiseLike<void> | void;
}

test('source commit cancellation before metadata publication discards staging and preserves an overwrite target', async () => {
	const controller = new AbortController();
	const hooks: FixtureHooks = {};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.5, -0.5)], { signal: controller.signal });
	hooks.onGetMetadata = () => {
		controller.abort(abortReason('cancel before source publication'));
	};

	await assert.rejects(
		writer.commit({}, { signal: controller.signal }),
		(error: unknown) => error instanceof Error && error.name === 'AbortError',
	);
	await writer.abort();
	assert.deepEqual(fixture.metadata.get('source-a'), fixture.previous);
	assert.deepEqual(fixture.chunkTokens(), ['old-token']);
});

test('source commit treats a resolved metadata put as its publication point despite late cancellation', async () => {
	const controller = new AbortController();
	const hooks: FixtureHooks = {};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.25, -0.25)], { signal: controller.signal });
	hooks.onPutMetadata = (record) => {
		if (record.sourceToken !== 'old-token') controller.abort(abortReason('cancel after source publication'));
	};

	const committed = await writer.commit({}, { signal: controller.signal });
	assert.equal(controller.signal.aborted, true);
	assert.notEqual(committed.sourceToken, 'old-token');
	assert.deepEqual(fixture.metadata.get('source-a'), committed);
	assert.deepEqual(fixture.chunkTokens(), [String(committed.sourceToken)]);
	await writer.abort();
	assert.deepEqual(fixture.metadata.get('source-a'), committed);
	assert.deepEqual(fixture.chunkTokens(), [String(committed.sourceToken)]);
});

test('a metadata port that rejects after publication restores prior metadata before deleting new payload', async () => {
	const reason = abortReason('metadata put rejected after publication');
	const hooks: FixtureHooks = {};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	let rejectedNewPut = false;
	hooks.onPutMetadata = (record) => {
		if (record.sourceToken !== 'old-token' && !rejectedNewPut) {
			rejectedNewPut = true;
			throw reason;
		}
	};
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.75, -0.75)]);

	await assert.rejects(
		writer.commit(),
		(error: unknown) => error instanceof Error && error.name === 'AbortError',
	);
	assert.deepEqual(fixture.metadata.get('source-a'), fixture.previous);
	assert.deepEqual(fixture.chunkTokens(), ['old-token']);
});

test('publication-error reconciliation cannot overwrite a concurrent metadata replacement', async () => {
	const reason = abortReason('metadata put failed after a concurrent replacement');
	const hooks: FixtureHooks = {};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	const replacement = { ...fixture.previous, name: 'concurrent winner' };
	hooks.onPutMetadata = (record) => {
		if (record.sourceToken !== 'old-token') {
			fixture.metadata.set('source-a', structuredClone(replacement));
			throw reason;
		}
	};
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.6, -0.6)]);

	await assert.rejects(writer.commit(), (error: unknown) => error === reason);
	assert.deepEqual(fixture.metadata.get('source-a'), replacement);
	assert.deepEqual(fixture.chunkTokens(), ['old-token']);
});

test('a rejected first publication removes metadata before deleting its payload', async () => {
	const reason = abortReason('first metadata put rejected after publication');
	const hooks: FixtureHooks = {
		onPutMetadata: () => { throw reason; },
	};
	const fixture = sourceWriterFixture(hooks);
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.1, -0.1)]);

	await assert.rejects(
		writer.commit(),
		(error: unknown) => error instanceof Error && error.name === 'AbortError',
	);
	assert.equal(fixture.metadata.has('source-a'), false);
	assert.deepEqual(fixture.chunkTokens(), []);
});

test('if-absent commit preserves a winner and deletes loser staging', async () => {
	const fixture = sourceWriterFixture({});
	fixture.seedPrevious();
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.4, -0.4)]);

	await assert.rejects(writer.commit({}, { ifAbsent: true }), /already exists|if-absent/iu);
	assert.deepEqual(fixture.metadata.get('source-a'), fixture.previous);
	assert.deepEqual(fixture.chunkTokens(), ['old-token']);
});

test('abort cannot race a commit owner into publishing metadata for deleted staging', async () => {
	const enteredMetadataRead = deferred<void>();
	const releaseMetadataRead = deferred<void>();
	const hooks: FixtureHooks = {
		onGetMetadata: async () => {
			enteredMetadataRead.resolve();
			await releaseMetadataRead.promise;
		},
	};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.2, -0.2)]);
	const committing = writer.commit();
	await enteredMetadataRead.promise;
	await writer.abort();
	releaseMetadataRead.resolve();
	const committed = await committing;

	assert.deepEqual(fixture.metadata.get('source-a'), committed);
	assert.deepEqual(fixture.chunkTokens(), [String(committed.sourceToken)]);
});

test('failure to collect an overwritten payload does not turn a published source into a failed commit', async () => {
	const hooks: FixtureHooks = {
		onDeleteStored: () => { throw new Error('simulated old-payload cleanup failure'); },
	};
	const fixture = sourceWriterFixture(hooks);
	fixture.seedPrevious();
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	await writer.write([Float32Array.of(0.3, -0.3)]);
	const committed = await writer.commit();

	assert.deepEqual(fixture.metadata.get('source-a'), committed);
	assert.ok(fixture.chunkTokens().includes(String(committed.sourceToken)));
});

test('concurrent writes fail closed without publishing duplicate chunk indices or leaving staging', async () => {
	const enteredFirstWrite = deferred<void>();
	const releaseFirstWrite = deferred<void>();
	let writeCalls = 0;
	const fixture = sourceWriterFixture({
		onWriteChunk: async () => {
			writeCalls += 1;
			if (writeCalls !== 1) return;
			enteredFirstWrite.resolve();
			await releaseFirstWrite.promise;
		},
	});
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	const first = writer.write([Float32Array.of(0.1, -0.1)]);
	await enteredFirstWrite.promise;
	const second = writer.write([Float32Array.of(0.2, -0.2)]);
	releaseFirstWrite.resolve();

	const results = await Promise.allSettled([first, second]);
	assert.equal(results.every((result) => result.status === 'rejected'), true);
	assert.equal(writeCalls, 1);
	assert.deepEqual(fixture.chunkTokens(), []);
	await assert.rejects(writer.commit(), /closed|concurrent/iu);
});

test('abort waits for an active write and removes the chunk persisted after abort began', async () => {
	const enteredWrite = deferred<void>();
	const releaseWrite = deferred<void>();
	const fixture = sourceWriterFixture({
		onWriteChunk: async () => {
			enteredWrite.resolve();
			await releaseWrite.promise;
		},
	});
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	const writing = writer.write([Float32Array.of(0.3, -0.3)]);
	await enteredWrite.promise;
	const aborting = writer.abort();
	releaseWrite.resolve();

	await assert.rejects(writing, /closed|aborted/iu);
	await aborting;
	assert.deepEqual(fixture.chunkTokens(), []);
	await assert.rejects(writer.commit(), /closed/iu);
});

test('commit racing an active write closes the writer and cannot publish partial metadata', async () => {
	const enteredWrite = deferred<void>();
	const releaseWrite = deferred<void>();
	const fixture = sourceWriterFixture({
		onWriteChunk: async () => {
			enteredWrite.resolve();
			await releaseWrite.promise;
		},
	});
	const writer = await fixture.repository.begin('source-a', sourceMetadata());
	const writing = writer.write([Float32Array.of(0.35, -0.35)]);
	await enteredWrite.promise;
	const committing = writer.commit();
	releaseWrite.resolve();

	await assert.rejects(writing, /closed|aborted/iu);
	await assert.rejects(committing, /write is active/iu);
	assert.equal(fixture.metadata.has('source-a'), false);
	assert.deepEqual(fixture.chunkTokens(), []);
});

test('concurrent derived-source publication keeps one immutable winner and deletes loser chunks', async () => {
	const bothCheckedTarget = deferred<void>();
	const releaseTargetChecks = deferred<void>();
	let targetChecks = 0;
	const fixture = sourceWriterFixture({
		onGetMetadata: async (record, sourceId) => {
			if (sourceId !== 'derived-source' || record) return;
			targetChecks += 1;
			if (targetChecks === 2) bothCheckedTarget.resolve();
			await releaseTargetChecks.promise;
		},
	});
	fixture.seedBase();
	const replacement = [{ index: 0, channels: [Float32Array.of(0.4, -0.4)] }];
	const first = fixture.repository.writeDerived('derived-source', 'base-source', replacement);
	const second = fixture.repository.writeDerived('derived-source', 'base-source', replacement);
	await bothCheckedTarget.promise;
	releaseTargetChecks.resolve();

	const results = await Promise.allSettled([first, second]);
	const fulfilled = results.filter((result) => result.status === 'fulfilled');
	const rejected = results.filter((result) => result.status === 'rejected');
	assert.equal(fulfilled.length, 1);
	assert.equal(rejected.length, 1);
	assert.match(String((rejected[0] as PromiseRejectedResult).reason), /immutable|already exists/iu);
	const winner = (fulfilled[0] as PromiseFulfilledResult<StorageRecord>).value;
	assert.deepEqual(fixture.metadata.get('derived-source'), winner);
	assert.deepEqual(fixture.chunkTokens(), [String(winner.sourceToken)]);
});

test('base deletion fences a derived source whose replacement payload is still staging', async () => {
	const enteredChunkWrite = deferred<void>();
	const releaseChunkWrite = deferred<void>();
	const fixture = sourceWriterFixture({
		onWriteChunk: async () => {
			enteredChunkWrite.resolve();
			await releaseChunkWrite.promise;
		},
	});
	fixture.seedBase();
	const sources = new SourceRepository({
		records: fixture.records as never,
		writer: fixture.repository,
		reader: {} as never,
		media: { deleteAsset: async () => undefined } as never,
		analysis: { delete: async () => undefined } as never,
		opfs: {} as never,
		pcm: {} as never,
	});
	const publishing = sources.writeDerived('derived-source', 'base-source', [{
		index: 0,
		channels: [Float32Array.of(0.4, -0.4)],
	}]);
	await enteredChunkWrite.promise;
	await sources.delete('base-source');
	releaseChunkWrite.resolve();

	await assert.rejects(publishing, /base source.*changed|could not be found/iu);
	assert.equal(fixture.metadata.has('derived-source'), false);
	assert.deepEqual(fixture.chunkTokens(), []);
});

function sourceWriterFixture(hooks: FixtureHooks) {
	const metadata = new Map<string, StorageRecord>();
	const chunks = new Map<string, Record<string, unknown>>();
	const previous: StorageRecord = {
		id: 'source-a',
		storage: 'indexeddb-chunks',
		sourceToken: 'old-token',
		frameCount: 2,
		frameLength: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
		chunkCount: 1,
	};
	const records = {
		async getMetadata(sourceId: string) {
			const record = metadata.get(sourceId) ?? null;
			await hooks.onGetMetadata?.(record, sourceId);
			return record ? structuredClone(record) : null;
		},
		async putMetadata(record: StorageRecord) {
			metadata.set(String(record.id), structuredClone(record));
			await hooks.onPutMetadata?.(record);
		},
		async putMetadataIfAbsent(record: StorageRecord) {
			if (metadata.has(String(record.id))) return false;
			metadata.set(String(record.id), structuredClone(record));
			await hooks.onPutMetadata?.(record);
			return true;
		},
		async putDerivedMetadataIfBaseCurrent(record: StorageRecord, expectedBase: StorageRecord) {
			const currentBase = metadata.get(String(expectedBase.id));
			if (!sameStoredSourceIdentity(currentBase, expectedBase)) return 'base-changed' as const;
			if (metadata.has(String(record.id))) return 'target-exists' as const;
			metadata.set(String(record.id), structuredClone(record));
			await hooks.onPutMetadata?.(record);
			return 'published' as const;
		},
		async deleteMetadataIfUnreferenced(sourceId: string) {
			const current = metadata.get(sourceId);
			if (!current) return { status: 'missing' } as const;
			const dependent = [...metadata.values()].find((candidate) => candidate.baseSourceId === sourceId);
			if (dependent) {
				return { status: 'retained', dependentSourceId: String(dependent.id) } as const;
			}
			metadata.delete(sourceId);
			return { status: 'deleted', record: structuredClone(current) } as const;
		},
		async deleteMetadata(sourceId: string) { metadata.delete(sourceId); },
		async deleteMetadataIfCurrent(expected: StorageRecord) {
			const current = metadata.get(String(expected.id));
			if (!sameStoredSourceIdentity(current, expected)) return false;
			metadata.delete(String(expected.id));
			return true;
		},
		async compareAndSwapMetadata(expected: StorageRecord, replacement: StorageRecord) {
			const current = metadata.get(String(expected.id));
			if (!sameStoredSourceIdentity(current, expected)) return false;
			metadata.set(String(replacement.id), structuredClone(replacement));
			return true;
		},
		async writeChunk(record: Record<string, unknown>) {
			await hooks.onWriteChunk?.(record);
			chunks.set(String(record.key), structuredClone(record));
		},
		async deleteChunks(token: string) {
			for (const [key, record] of chunks) {
				if (record.sourceToken === token) chunks.delete(key);
			}
		},
		async list() { return [...metadata.values()].map((record) => structuredClone(record)); },
	};
	const repository = new SourceWriteRepository({
		records: records as never,
		pcm: {} as never,
		opfs: { createPcmWriter: async () => null } as never,
		database: async () => null,
		deleteStoredSource: async (source) => {
			await hooks.onDeleteStored?.(source);
			await records.deleteChunks(String(source.sourceToken));
		},
	});
	return {
		chunkTokens: () => [...new Set([...chunks.values()].map((record) => String(record.sourceToken)))].sort(),
		metadata,
		previous,
		records,
		repository,
		seedPrevious() {
			metadata.set('source-a', structuredClone(previous));
			chunks.set('old-token:0000000000', { key: 'old-token:0000000000', sourceToken: 'old-token' });
		},
		seedBase() {
			metadata.set('base-source', {
				id: 'base-source',
				storage: 'indexeddb-chunks',
				sourceToken: 'base-token',
				frameCount: 2,
				frameLength: 2,
				channelCount: 1,
				sampleRate: 48_000,
				chunkFrames: 2,
				chunkCount: 1,
			});
		},
	};
}

function sourceMetadata(): Record<string, unknown> {
	return { name: 'source.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1, chunkFrames: 2 };
}

function abortReason(message: string): DOMException {
	return new DOMException(message, 'AbortError');
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}
