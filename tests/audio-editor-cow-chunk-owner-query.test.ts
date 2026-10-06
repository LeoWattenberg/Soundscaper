/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) test(`${backend} finds the newest COW owner in bounded coherent key queries and reads just its payload`, async (t) => {
	const name = `owner-query-${backend}-${crypto.randomUUID()}`;
	const database = backend === 'indexeddb' ? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name) : null;
	t.after(() => database?.close());
	const records = new SourceRecordRepository({ memory: getMemoryDatabase(name), database: async () => database });
	const tokens = Array.from({ length: 100 }, (_, index) => `generation-${String(index)}`);
	await records.writeChunk({ key: `${tokens[88]}:0000000003`, sourceToken: tokens[88]!, index: 3, payload: Uint8Array.of(1, 2, 3).buffer });
	await records.writeChunk({ key: `${tokens[99]}:0000000003`, sourceToken: tokens[99]!, index: 3, payload: Uint8Array.of(4).buffer });
	const transactions = database ? t.mock.method(database, 'transaction') : null;
	const owner = await records.firstChunk(tokens, 3);
	assert.equal(owner?.ownerIndex, 88);
	assert.deepEqual(new Uint8Array(owner?.record.payload as ArrayBuffer), Uint8Array.of(1, 2, 3));
	if (transactions) assert.equal(transactions.mock.callCount(), 2, 'two <=64-key transactions instead of 89 serialized full-payload lookups');
	new Uint8Array(owner?.record.payload as ArrayBuffer).fill(9);
	assert.deepEqual(new Uint8Array((await records.chunk(tokens[88]!, 3))?.payload as ArrayBuffer), Uint8Array.of(1, 2, 3));
	assert.equal(await records.firstChunk(tokens, 4), null);
	// A freshly added newer record must never be hidden by an absence/owner memo.
	await records.writeChunk({ key: `${tokens[2]}:0000000003`, sourceToken: tokens[2]!, index: 3, payload: Uint8Array.of(5).buffer });
	assert.equal((await records.firstChunk(tokens, 3))?.ownerIndex, 2);
	await assert.rejects(records.firstChunk(Array.from({ length: 4_095 }, () => 'token'), 0), /bounded|generation/iu);
});

test('owned COW sessions use fresh bounded owner lookup while preserving all generation fences', async () => {
	const { SourceReadRepository } = await import('../src/common/editor/storage/source-read-repository.ts');
	const memory = getMemoryDatabase(`owned-owner-${crypto.randomUUID()}`);
	const records = new SourceRecordRepository({ memory, database: async () => null });
	for (let index = 0; index < 100; index += 1) await records.putMetadata({
		id: `source-${String(index)}`, sourceToken: `token-${String(index)}`, storage: index === 99 ? 'indexeddb-chunks' : 'copy-on-write',
		baseSourceId: index === 99 ? null : `source-${String(index + 1)}`, frameCount: 1, frameLength: 1,
		channelCount: 1, chunkFrames: 1, chunkCount: 1, sampleRate: 48_000, pcmEncodingVersion: 1,
	});
	await records.writeChunk({ key: 'token-99:0000000000', sourceToken: 'token-99', index: 0, frames: 1, channels: [Float32Array.of(0.25)] });
	let decodedSource = '';
	const reader = new SourceReadRepository({ records, opfs: {} as never, pcm: {
		async decodeRecord(record: Record<string, unknown>, source: Record<string, unknown>) {
			decodedSource = String(source.id);
			return { index: Number(record.index), frames: Number(record.frames), channels: (record.channels as Float32Array[]).map((channel) => channel.slice()) };
		},
	} as never });
	const session = await reader.openSession('source-0'); assert.ok(session);
	assert.equal((await session.chunk(0)).channels[0]?.[0], 0.25); assert.equal(decodedSource, 'source-99');
	await records.writeChunk({ key: 'token-20:0000000000', sourceToken: 'token-20', index: 0, frames: 1, channels: [Float32Array.of(-0.5)] });
	assert.equal((await session.chunk(0)).channels[0]?.[0], -0.5); assert.equal(decodedSource, 'source-20');
	const metadata = await records.getMetadata('source-99'); assert.ok(metadata);
	await records.putMetadata({ ...metadata, sourceToken: 'changed' });
	await assert.rejects(session.chunk(0), /generation changed/iu); await session.release();
});
