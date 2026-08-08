/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoredChunkProvider } from '../src/common/editor/controller/source-audio.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT } from '../src/common/editor/storage/owned-source-pcm-read-session.ts';
import {
	SourceReadRepository,
	type SourceReadOptions,
} from '../src/common/editor/storage/source-read-repository.ts';
import { PCM_CONTAINER_STORAGE_TYPE } from '../src/common/editor/wavpack/index.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('project stores open and close owned PCM sessions on memory and IndexedDB backends', async (t) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await t.test(backend, async () => {
			const store = createProjectStore({
				indexedDB: backend === 'indexeddb'
					? createInstrumentedIndexedDB() as unknown as IDBFactory
					: null,
				memoryFallback: false,
				preferOpfs: false,
				databaseName: `owned-session-${backend}-${Date.now()}-${Math.random()}`,
			});
			const writer = await store.beginSourceWrite('owned', {
				sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
			});
			await writer.write([Float32Array.of(0.25)]);
			await writer.write([Float32Array.of(0.75)]);
			const expected = await writer.commit({ chunkFrames: 1 });
			const session = await store.openSourceReadSession('owned', { expectedSource: expected });
			assert.ok(session);
			assert.deepEqual([...((await session.chunk(1)).channels[0])], [0.75]);
			assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.25]);

			await store.close();
			await assert.rejects(session.chunk(0), /released|closed/iu);
		});
	}
});

test('owned PCM sessions keep one exact root generation across random reads', async () => {
	const fixture = sourceFixture([
		sourceRecord('owned', 'owned-token', { chunkCount: 2, pcmEncodingVersion: 0 }),
	], [
		chunkRecord('owned-token', 0, 0.25),
		chunkRecord('owned-token', 1, 0.75),
	]);
	const expected = await fixture.records.getMetadata('owned');
	const session = await fixture.reader.openSession('owned', { expectedSource: expected ?? undefined });
	assert.ok(session);

	assert.deepEqual([...((await session.chunk(1)).channels[0])], [0.75]);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.25]);
	assert.deepEqual(fixture.decoded, ['owned-token:1', 'owned-token:0']);
	assert.deepEqual(fixture.migrations, [], 'a stable session must not schedule self-invalidating migration');

	await session.release();
	await session.release();
	await assert.rejects(session.chunk(0), /released|closed/iu);
});

test('owned sessions read PCM-container and legacy OPFS chunks', async () => {
	const calls: string[] = [];
	const fixture = sourceFixture([
		sourceRecord('container', 'container-token', { storage: PCM_CONTAINER_STORAGE_TYPE }),
		sourceRecord('legacy', 'legacy-token', { storage: 'opfs' }),
	], [], {
		opfs: {
			async readPcmContainerChunk(source: StorageRecord, chunkIndex: number) {
				calls.push(`${String(source.id)}:${String(chunkIndex)}:container`);
				return { index: chunkIndex, frames: 1, channels: [Float32Array.of(0.25)] };
			},
			async readLegacyChunk(source: StorageRecord, chunkIndex: number) {
				calls.push(`${String(source.id)}:${String(chunkIndex)}:legacy`);
				return { index: chunkIndex, frames: 1, channels: [Float32Array.of(0.75)] };
			},
		} as never,
	});
	const container = await fixture.reader.openSession('container');
	const legacy = await fixture.reader.openSession('legacy');
	assert.ok(container);
	assert.ok(legacy);
	assert.deepEqual([...((await container.chunk(0)).channels[0])], [0.25]);
	assert.deepEqual([...((await legacy.chunk(0)).channels[0])], [0.75]);
	assert.deepEqual(calls, ['container:0:container', 'legacy:0:legacy']);
	await Promise.all([container.release(), legacy.release()]);
});

test('owned session request cancellation stays local to that chunk read', async () => {
	const fixture = sourceFixture([
		sourceRecord('owned', 'owned-token'),
	], [
		chunkRecord('owned-token', 0, 0.25),
	]);
	const session = await fixture.reader.openSession('owned');
	assert.ok(session);
	const cancellation = new Error('cancel only this request');
	const request = new AbortController();
	request.abort(cancellation);

	await assert.rejects(session.chunk(0, { signal: request.signal }), (error) => error === cancellation);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.25]);
	await session.release();
});

test('owned PCM sessions reject root replacement before another generation can be returned', async () => {
	const fixture = sourceFixture([
		sourceRecord('owned', 'old-token', { chunkCount: 2 }),
	], [
		chunkRecord('old-token', 0, 0.125),
		chunkRecord('old-token', 1, 0.25),
		chunkRecord('new-token', 0, 0.75),
		chunkRecord('new-token', 1, 1),
	]);
	const session = await fixture.reader.openSession('owned');
	assert.ok(session);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.125]);

	fixture.metadata.set('owned', sourceRecord('owned', 'new-token', { chunkCount: 2 }));
	await assert.rejects(session.chunk(1), /generation changed/iu);
	assert.deepEqual(fixture.decoded, ['old-token:0']);
	await assert.rejects(session.chunk(0), /released|closed/iu);
});

test('owned PCM sessions fence generation drift that occurs during one chunk read', async () => {
	const fixture = sourceFixture([
		sourceRecord('owned', 'old-token'),
	], [
		chunkRecord('old-token', 0, 0.25),
		chunkRecord('new-token', 0, 0.75),
	], {
		afterDecode() {
			fixture.metadata.set('owned', sourceRecord('owned', 'new-token'));
		},
	});
	const session = await fixture.reader.openSession('owned');
	assert.ok(session);

	await assert.rejects(session.chunk(0), /generation changed/iu);
	assert.deepEqual(fixture.decoded, ['old-token:0']);
	await assert.rejects(session.chunk(0), /released|closed/iu);
});

test('copy-on-write sessions snapshot and fence every root-to-base generation', async (t) => {
	await t.test('overlay and inherited chunks use their snapshotted owners', async () => {
		const fixture = copyOnWriteFixture();
		const session = await fixture.reader.openSession('derived');
		assert.ok(session);
		assert.deepEqual([...((await session.chunk(0)).channels[0])], [-0.5]);
		assert.deepEqual([...((await session.chunk(1)).channels[0])], [0.75]);
		assert.deepEqual(fixture.decoded, ['derived-token:0', 'base-token:1']);
		await session.release();
	});

	for (const changedSourceId of ['derived', 'base']) {
		await t.test(`${changedSourceId} replacement poisons the complete session`, async () => {
			const fixture = copyOnWriteFixture();
			const session = await fixture.reader.openSession('derived');
			assert.ok(session);
			await session.chunk(0);
			const current = fixture.metadata.get(changedSourceId) as StorageRecord;
			fixture.metadata.set(changedSourceId, {
				...current,
				sourceToken: `${changedSourceId}-replacement-token`,
			});
			await assert.rejects(session.chunk(1), /generation changed/iu);
			assert.deepEqual(fixture.decoded, ['derived-token:0']);
		});
	}
});

test('owned session admission rejects an invalid or over-bound dependency chain before PCM reads', async (t) => {
	await t.test('missing base', async () => {
		const fixture = sourceFixture([
			sourceRecord('derived', 'derived-token', { storage: 'copy-on-write', baseSourceId: 'missing' }),
		], []);
		await assert.rejects(fixture.reader.openSession('derived'), /base.*missing|dependency.*missing/iu);
		assert.deepEqual(fixture.decoded, []);
	});

	await t.test('cycle', async () => {
		const fixture = sourceFixture([
			sourceRecord('first', 'first-token', { storage: 'copy-on-write', baseSourceId: 'second' }),
			sourceRecord('second', 'second-token', { storage: 'copy-on-write', baseSourceId: 'first' }),
		], []);
		await assert.rejects(fixture.reader.openSession('first'), /cycle/iu);
		assert.deepEqual(fixture.decoded, []);
	});

	await t.test('dependency ceiling', async () => {
		const sources = Array.from(
			{ length: OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT + 1 },
			(_, index) => sourceRecord(`source-${index}`, `token-${index}`, index < OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT
				? { storage: 'copy-on-write', baseSourceId: `source-${index + 1}` }
				: {}),
		);
		const fixture = sourceFixture(sources, []);
		await assert.rejects(fixture.reader.openSession('source-0'), /4094 source generations/iu);
		assert.deepEqual(fixture.decoded, []);
	});
});

test('provider lazy opening refuses an owned generation newer than its admitted metadata', async () => {
	const fixture = sourceFixture([
		sourceRecord('stored', 'old-token'),
	], [
		chunkRecord('old-token', 0, 0.25),
		chunkRecord('new-token', 0, 0.75),
	]);
	const expected = await fixture.records.getMetadata('stored') as StorageRecord;
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('The unfenced fallback read must not run.'); },
		openSourceReadSession: (sourceId, options) => fixture.reader.openSession(
			sourceId,
			options as SourceReadOptions,
		),
	}, {
		id: 'logical', storageKey: 'stored', frameCount: 1, channelCount: 1, sampleRate: 48_000, chunkFrames: 1,
	}, expected);
	fixture.metadata.set('stored', sourceRecord('stored', 'new-token'));

	await assert.rejects(Promise.resolve(provider.readStorageChunk(0)), /generation changed/iu);
	assert.deepEqual(fixture.decoded, []);
	await provider.dispose();
});

test('provider lazy opening refuses owned deletion instead of falling through to another source route', async () => {
	let fallbackOpens = 0;
	const fallbackMetadata = sourceRecord('stored', 'linked-token', { storage: 'external-pcm' });
	const fixture = sourceFixture([
		sourceRecord('stored', 'owned-token'),
	], [
		chunkRecord('owned-token', 0, 0.25),
	], {
		fallback: {
			getMetadata: async () => fallbackMetadata,
			openSession: async () => {
				fallbackOpens += 1;
				return {
					chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.75)] }),
					release: async () => undefined,
				};
			},
			async *chunks() { /* Provider playback must use the session route. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.75)] }),
		},
	});
	const expected = await fixture.records.getMetadata('stored') as StorageRecord;
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('The unfenced fallback read must not run.'); },
		openSourceReadSession: (sourceId, options) => fixture.reader.openSession(
			sourceId,
			options as SourceReadOptions,
		),
	}, {
		id: 'logical', storageKey: 'stored', frameCount: 1, channelCount: 1, sampleRate: 48_000, chunkFrames: 1,
	}, expected);
	fixture.metadata.delete('stored');

	await assert.rejects(Promise.resolve(provider.readStorageChunk(0)), /generation changed/iu);
	assert.equal(fallbackOpens, 0);
	await provider.dispose();
});

test('expected fallback identities are checked before and after generic session opening', async () => {
	let current = sourceRecord('external', 'fallback-token', { storage: 'external-pcm' });
	let replaceDuringOpen = false;
	let opens = 0;
	let releases = 0;
	const fixture = sourceFixture([], [], {
		fallback: {
			getMetadata: async () => clone(current),
			openSession: async () => {
				opens += 1;
				if (replaceDuringOpen) current = { ...current, sourceToken: 'replacement-token' };
				return {
					chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
					release: async () => { releases += 1; },
				};
			},
			async *chunks() { /* The session route owns playback. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
		},
	});
	const expected = clone(current);
	const session = await fixture.reader.openSession('external', { expectedSource: expected });
	assert.ok(session);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.5]);
	await session.release();
	assert.equal(opens, 1);
	assert.equal(releases, 1);

	replaceDuringOpen = true;
	current = clone(expected);
	await assert.rejects(
		fixture.reader.openSession('external', { expectedSource: expected }),
		/generation changed/iu,
	);
	assert.equal(opens, 2);
	assert.equal(releases, 2, 'a post-open identity race must release the acquired fallback session');

	replaceDuringOpen = false;
	current = { ...current, sourceToken: 'replacement-token' };
	await assert.rejects(
		fixture.reader.openSession('external', { expectedSource: expected }),
		/generation changed/iu,
	);
	assert.equal(opens, 2, 'a stale expected fallback must reject before opening');
});

test('fallback session chunks recheck the admitted identity before and after every read', async () => {
	let current = sourceRecord('external', 'fallback-token', { storage: 'external-pcm' });
	let mutateDuringRead = false;
	let reads = 0;
	let releases = 0;
	const fixture = sourceFixture([], [], {
		fallback: {
			getMetadata: async () => clone(current),
			openSession: async () => ({
				chunk: async (chunkIndex: number) => {
					reads += 1;
					if (mutateDuringRead) current = { ...current, sourceToken: 'replacement-token' };
					return { index: chunkIndex, frames: 1, channels: [Float32Array.of(0.25)] };
				},
				release: async () => { releases += 1; },
			}),
			async *chunks() { /* The session route owns playback. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.25)] }),
		},
	});
	const expected = clone(current);
	const session = await fixture.reader.openSession('external', { expectedSource: expected });
	assert.ok(session);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.25]);

	mutateDuringRead = true;
	await assert.rejects(session.chunk(1), /generation changed/iu, 'a mid-read replacement fails the post-read fence');
	assert.equal(reads, 2, 'the post-read fence rejects after the underlying read observed the mutation');

	mutateDuringRead = false;
	await assert.rejects(session.chunk(2), /generation changed/iu, 'a stale identity fails the pre-read fence');
	assert.equal(reads, 2, 'the pre-read fence rejects before the underlying read runs');

	await session.release();
	assert.equal(releases, 1);
});

test('bulk cleanup aborts and awaits fallback metadata admission without a late session', async () => {
	const expected = sourceRecord('external', 'fallback-token', { storage: 'external-pcm' });
	const metadataAdmission = deferred<StorageRecord | null>();
	const metadataStarted = deferred<void>();
	let opens = 0;
	let liveSessions = 0;
	const fixture = sourceFixture([], [], {
		fallback: {
			getMetadata() {
				metadataStarted.resolve();
				return metadataAdmission.promise;
			},
			openSession: async () => {
				opens += 1;
				liveSessions += 1;
				return {
					chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
					release: async () => { liveSessions -= 1; },
				};
			},
			async *chunks() { /* The session route owns playback. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
		},
	});
	const opening = fixture.reader.openSession('external', { expectedSource: expected });
	await metadataStarted.promise;
	const rejectedOpening = assert.rejects(opening, /being released|cancel/iu);
	let cleanupFinished = false;
	const cleanup = fixture.reader.releaseSessions().then(() => { cleanupFinished = true; });

	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(cleanupFinished, false, 'cleanup must await the in-flight outer admission');
	metadataAdmission.resolve(clone(expected));
	await rejectedOpening;
	await cleanup;
	assert.equal(opens, 0, 'an aborted metadata admission must not open a fallback session later');
	assert.equal(liveSessions, 0);
});

test('bulk cleanup reports one fallback-admission release failure without its cancellation', async () => {
	const expected = sourceRecord('external', 'fallback-token', { storage: 'external-pcm' });
	const postAdmission = deferred<StorageRecord | null>();
	const postAdmissionStarted = deferred<void>();
	const componentFailures = [new Error('first release detail'), new Error('second release detail')];
	const fallbackFailure = new AggregateError(componentFailures, 'fallback session release failed');
	let metadataReads = 0;
	let releaseCalls = 0;
	let releasePromise: Promise<void> | null = null;
	const fallbackSession = {
		chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
		release() {
			releaseCalls += releasePromise ? 0 : 1;
			releasePromise ??= Promise.reject(fallbackFailure);
			return releasePromise;
		},
	};
	const fixture = sourceFixture([], [], {
		fallback: {
			getMetadata() {
				metadataReads += 1;
				if (metadataReads === 1) return clone(expected);
				postAdmissionStarted.resolve();
				return postAdmission.promise;
			},
			openSession: async () => fallbackSession,
			releaseSessions: async () => fallbackSession.release(),
			async *chunks() { /* The session route owns playback. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
		},
	});
	const opening = fixture.reader.openSession('external', { expectedSource: expected });
	await postAdmissionStarted.promise;
	const openingFailure = assert.rejects(opening, (error) => error === fallbackFailure);
	const cleanupFailure = assert.rejects(
		fixture.reader.releaseSessions(),
		(error) => error === fallbackFailure,
	);
	postAdmission.resolve(clone(expected));

	await Promise.all([openingFailure, cleanupFailure]);
	assert.equal(releaseCalls, 1);
	assert.deepEqual([...fallbackFailure.errors], componentFailures);
});

test('an owned generation inserted during fallback admission wins effective routing', async () => {
	const expected = sourceRecord('external', 'fallback-token', { storage: 'external-pcm' });
	let opens = 0;
	let releases = 0;
	const fixture = sourceFixture([], [], {
		fallback: {
			getMetadata: async () => clone(expected),
			openSession: async () => {
				opens += 1;
				fixture.metadata.set('external', sourceRecord('external', 'owned-token'));
				return {
					chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
					release: async () => { releases += 1; },
				};
			},
			async *chunks() { /* The session route owns playback. */ },
			chunk: async () => ({ index: 0, frames: 1, channels: [Float32Array.of(0.5)] }),
		},
	});

	await assert.rejects(
		fixture.reader.openSession('external', { expectedSource: expected }),
		/generation changed/iu,
	);
	assert.equal(opens, 1);
	assert.equal(releases, 1, 'the fallback session acquired across an owned-wins race must be released');
	assert.equal((await fixture.reader.getMetadata('external'))?.sourceToken, 'owned-token');
});

test('bulk cleanup releases owned sessions even when linked-session cleanup fails', async () => {
	const cleanupFailure = new Error('linked cleanup failed');
	const fixture = sourceFixture([
		sourceRecord('owned', 'owned-token'),
	], [
		chunkRecord('owned-token', 0, 0.25),
	], {
		fallback: {
			getMetadata: async () => null,
			async *chunks() { /* No linked source is read in this case. */ },
			chunk: async () => { throw new Error('No linked source is read in this case.'); },
			releaseSessions() { throw cleanupFailure; },
		},
	});
	const session = await fixture.reader.openSession('owned');
	assert.ok(session);

	await assert.rejects(fixture.reader.releaseSessions(), (error: unknown) => error === cleanupFailure);
	await assert.rejects(session.chunk(0), /released|closed/iu);
});

function copyOnWriteFixture() {
	return sourceFixture([
		sourceRecord('derived', 'derived-token', {
			storage: 'copy-on-write', baseSourceId: 'base', chunkCount: 2,
		}),
		sourceRecord('base', 'base-token', { chunkCount: 2 }),
	], [
		chunkRecord('derived-token', 0, -0.5),
		chunkRecord('base-token', 0, 0.25),
		chunkRecord('base-token', 1, 0.75),
	]);
}

function sourceFixture(
	sources: readonly StorageRecord[],
	chunks: readonly Readonly<Record<string, unknown>>[],
	options: Readonly<{
		afterDecode?: () => void;
		fallback?: ConstructorParameters<typeof SourceReadRepository>[0]['fallback'];
		opfs?: ConstructorParameters<typeof SourceReadRepository>[0]['opfs'];
	}> = {},
) {
	const metadata = new Map(sources.map((source) => [String(source.id), clone(source)]));
	const storedChunks = new Map(chunks.map((chunk) => [String(chunk.key), clone(chunk)]));
	const decoded: string[] = [];
	const migrations: string[] = [];
	const records = {
		async getMetadata(sourceId: string) {
			const value = metadata.get(sourceId);
			return value ? clone(value) : null;
		},
		async chunk(sourceToken: string, chunkIndex: number) {
			const value = storedChunks.get(chunkKey(sourceToken, chunkIndex));
			return value ? clone(value) : null;
		},
		async *chunks(sourceToken: string) {
			for (const value of [...storedChunks.values()]
				.filter((chunk) => chunk.sourceToken === sourceToken)
				.sort((left, right) => Number(left.index) - Number(right.index))) {
				yield clone(value);
			}
		},
	};
	const reader = new SourceReadRepository({
		records: records as never,
		pcm: {
			async decodeRecord(record: Readonly<Record<string, unknown>>) {
				decoded.push(`${String(record.sourceToken)}:${String(record.index)}`);
				const channels = (record.channels as readonly Float32Array[]).map((channel) => channel.slice());
				options.afterDecode?.();
				return { index: record.index, frames: Number(record.frames), channels };
			},
		} as never,
		opfs: options.opfs ?? {
			readPcmContainerChunk: async () => { throw new Error('Unexpected OPFS PCM-container read.'); },
			readLegacyChunk: async () => { throw new Error('Unexpected legacy OPFS read.'); },
		} as never,
		migrations: { queue: (source: StorageRecord) => { migrations.push(String(source.id)); } } as never,
		fallback: options.fallback,
	});
	return { decoded, metadata, migrations, reader, records };
}

function sourceRecord(
	id: string,
	sourceToken: string,
	overrides: Readonly<Record<string, unknown>> = {},
): StorageRecord {
	return Object.freeze({
		id,
		storage: 'indexeddb-chunks',
		sourceToken,
		baseSourceId: null,
		path: null,
		pcmEncodingVersion: 1,
		frameCount: 1,
		frameLength: 1,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 1,
		chunkCount: 1,
		...overrides,
	});
}

function chunkRecord(sourceToken: string, index: number, sample: number) {
	return Object.freeze({
		key: chunkKey(sourceToken, index),
		sourceToken,
		index,
		frames: 1,
		channels: [Float32Array.of(sample)],
	});
}

function chunkKey(sourceToken: string, index: number): string {
	return `${sourceToken}:${String(index).padStart(10, '0')}`;
}

function clone<Value>(value: Value): Value {
	return structuredClone(value);
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return Object.freeze({ promise, reject, resolve });
}
