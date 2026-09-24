/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('repeated immutable sample overlays materialize a shallow chain without losing earlier audio', async (t) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await t.test(backend, async () => {
			const store = createProjectStore({
				indexedDB: backend === 'indexeddb'
					? createInstrumentedIndexedDB() as unknown as IDBFactory
					: null,
				preferOpfs: false,
				databaseName: `derived-materialization-${backend}-${Date.now()}-${Math.random()}`,
			});
			try {
				const writer = await store.beginSourceWrite('original', {
					sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
				});
				await writer.write([Float32Array.of(0)]);
				await writer.write([Float32Array.of(0.5)]);
				await writer.commit({ chunkFrames: 1 });

				const editCount = backend === 'memory' ? 100 : 18;
				let baseId = 'original';
				let lastSecondChunkEdit = 0;
				for (let edit = 1; edit <= editCount; edit += 1) {
					const sourceId = `edit-${edit}`;
					const index = edit % 10 === 0 ? 1 : 0;
					if (index === 1) lastSecondChunkEdit = edit;
					await store.writeDerivedSource(sourceId, baseId, [{
						index, channels: [Float32Array.of(edit / 200)],
					}], { sampleRate: 48_000, chunkFrames: 1 });
					baseId = sourceId;
				}

				const chain = await sourceChain(store, baseId);
				assert.ok(chain.length <= 16, `latest source retained ${chain.length} generations`);
				assert.equal(chain.at(-1)?.id, 'original');
				const latest = await store.openSourceReadSession(baseId);
				assert.ok(latest);
				const lastFirstChunkEdit = editCount % 10 === 0 ? editCount - 1 : editCount;
				assert.equal((await latest.chunk(0)).channels[0][0], Float32Array.of(lastFirstChunkEdit / 200)[0]);
				assert.equal((await latest.chunk(1)).channels[0][0], Float32Array.of(lastSecondChunkEdit / 200)[0]);
				await latest.release();

				const earlier = await store.openSourceReadSession('edit-1');
				assert.ok(earlier);
				assert.equal((await earlier.chunk(0)).channels[0][0], Float32Array.of(1 / 200)[0]);
				await earlier.release();

				const pruned = await store.pruneUnreferencedSources({
					protectedProjects: [{ schemaFamily: 'soundscaper', schemaVersion: 1,
						clips: [{ sourceId: baseId }] }],
					minimumAgeMs: 0,
					now: Date.now() + 2 * 24 * 60 * 60 * 1_000,
				});
				assert.ok(pruned.deletedSourceIds.includes('edit-1'));
				assert.equal((await store.readSourceChunk(baseId, 1)).channels[0][0],
					Float32Array.of(lastSecondChunkEdit / 200)[0]);
			} finally {
				await store.close();
			}
		});
	}
});

test('a flattened overlay publishes only while every copied dependency generation is current', async (t) => {
	for (const backend of ['memory', 'indexeddb'] as const) {
		await t.test(backend, async () => {
			const databaseName = `flattened-publication-${backend}-${Date.now()}-${Math.random()}`;
			const database = backend === 'indexeddb'
				? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName)
				: null;
			try {
				const records = new SourceRecordRepository({
					memory: getMemoryDatabase(databaseName), database: async () => database,
				});
				const root: StorageRecord = {
					id: 'root', storage: 'indexeddb-chunks', sourceToken: 'root-token',
				};
				const middle: StorageRecord = {
					id: 'middle', storage: 'copy-on-write', sourceToken: 'middle-token', baseSourceId: 'root',
				};
				const base: StorageRecord = {
					id: 'base', storage: 'copy-on-write', sourceToken: 'base-token', baseSourceId: 'middle',
				};
				const flattened: StorageRecord = {
					id: 'flattened', storage: 'copy-on-write', sourceToken: 'flattened-token', baseSourceId: 'root',
				};
				for (const source of [root, middle, base]) await records.putMetadata(source);
				await records.putMetadata({ ...middle, sourceToken: 'changed-middle-token' });
				assert.equal(await records.putDerivedMetadataIfBaseCurrent(
					flattened, base, [base, middle, root],
				), 'base-changed');
				assert.equal(await records.getMetadata('flattened'), null);
				await records.putMetadata(middle);
				assert.equal(await records.putDerivedMetadataIfBaseCurrent(
					flattened, base, [base, middle, root],
				), 'published');
			} finally {
				database?.close();
			}
		});
	}
});

async function sourceChain(
	store: ReturnType<typeof createProjectStore>,
	sourceId: string,
): Promise<StorageRecord[]> {
	const chain: StorageRecord[] = [];
	let currentId = sourceId;
	while (true) {
		const source = await store.getSourceMetadata(currentId);
		assert.ok(source);
		chain.push(source);
		if (source.storage !== 'copy-on-write') return chain;
		if (typeof source.baseSourceId !== 'string') throw new Error('A derived source has no base.');
		currentId = source.baseSourceId;
	}
}
