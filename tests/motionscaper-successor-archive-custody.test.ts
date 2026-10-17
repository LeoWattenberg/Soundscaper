/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createScapeArchiveByteSource, createBlobScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { openFramescaperSuccessorDatabase } from '../src/framescaper/editor-project-successor-database.ts';
import { stageFramescaperArchiveCustody, readFramescaperArchiveCustody, reclaimFramescaperArchiveStaging } from '../src/framescaper/editor-project-successor-archive-custody.ts';
import { FRAMESCAPER_ARCHIVE_STORES, FRAMESCAPER_ARCHIVE_CHUNK_BYTES } from '../src/framescaper/editor-project-successor-archive-record.ts';

async function fixture() {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	return { factory, indexedDB, database: await openFramescaperSuccessorDatabase(indexedDB, 'successor') };
}

test('M10 successor custody stores bounded typed chunks and publishes only with its owner transaction', async () => {
	const f = await fixture(); const bytes = Uint8Array.from({ length: FRAMESCAPER_ARCHIVE_CHUNK_BYTES + 31 }, (_, i) => i % 251);
	let maximumRead = 0; const digest = digestScapeBytes(bytes);
	const input = createScapeArchiveByteSource({ size: bytes.length, maximumReadBytes: 65536, read({ offset, length }) { maximumRead = Math.max(maximumRead, length); return bytes.subarray(offset, offset + length); } });
	try {
		const stage = await stageFramescaperArchiveCustody(f.database, input, digest);
		assert.equal(maximumRead, 65536); assert.equal(stage.reference.chunkCount, 2);
		assert.equal(f.factory.recordCount(f.database.name, 'archiveBodies'), 0);
		assert.deepEqual(await stage.source.read({ offset: FRAMESCAPER_ARCHIVE_CHUNK_BYTES - 3, length: 12 }), bytes.subarray(FRAMESCAPER_ARCHIVE_CHUNK_BYTES - 3, FRAMESCAPER_ARCHIVE_CHUNK_BYTES + 9));
		const unpublished = readFramescaperArchiveCustody(stage.reference, digest, f.indexedDB);
		assert.ok(!(unpublished instanceof Blob)); await assert.rejects(unpublished.read({ offset: 0, length: 4 }), /unavailable/u);
		await assert.rejects(transact(f.database, [...FRAMESCAPER_ARCHIVE_STORES, 'projects'], 'readwrite', async stores => {
			await stage.publish(stores); await request(stores.projects!.add({ id: 'owner', archive: stage.reference })); throw new Error('owner failed');
		}), /owner failed/u);
		assert.equal(f.factory.recordCount(f.database.name, 'archiveBodies'), 0);
		await transact(f.database, [...FRAMESCAPER_ARCHIVE_STORES, 'projects'], 'readwrite', async stores => { await stage.publish(stores); await request(stores.projects!.add({ id: 'owner', archive: stage.reference })); });
		await stage.rollback(); // A late cleanup cannot destroy published custody.
		assert.equal(f.factory.recordCount(f.database.name, 'archiveStages'), 0);
		f.database.close(); const reopened = readFramescaperArchiveCustody(stage.reference, digest, f.indexedDB); assert.ok(!(reopened instanceof Blob));
		assert.deepEqual(await reopened.read({ offset: bytes.length - 31, length: 31 }), bytes.slice(-31));
	} finally { f.database.close(); }
});

test('M10 successor custody refuses mismatched digests, cancels between chunks and removes private writes', async () => {
	const f = await fixture(); const body = new Blob([new Uint8Array([1, 2, 3, 4])]);
	try {
		await assert.rejects(stageFramescaperArchiveCustody(f.database, body, 'a'.repeat(64)), /digest/u);
		assert.equal(f.factory.recordCount(f.database.name, 'archiveChunks'), 0);
		const abort = new AbortController(); let reads = 0;
		const input = createScapeArchiveByteSource({ size: FRAMESCAPER_ARCHIVE_CHUNK_BYTES + 1, read({ length }) { if (++reads === 2) abort.abort(); return new Uint8Array(length); } });
		await assert.rejects(stageFramescaperArchiveCustody(f.database, input, undefined, abort.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
		assert.equal(f.factory.recordCount(f.database.name, 'archiveChunks'), 0); assert.equal(f.factory.recordCount(f.database.name, 'archiveStages'), 0);
	} finally { f.database.close(); }
});

test('M10 successor custody validates immutable chunk size/digest and keeps legacy Blob reads compatible', async () => {
	const f = await fixture(); const blob = new Blob([new Uint8Array([1, 2, 3, 4])]); const digest = digestScapeBytes(new Uint8Array([1, 2, 3, 4]));
	try {
		assert.equal(readFramescaperArchiveCustody(blob, digest, f.indexedDB), blob);
		const stage = await stageFramescaperArchiveCustody(f.database, blob, digest); await transact(f.database, FRAMESCAPER_ARCHIVE_STORES, 'readwrite', stores => stage.publish(stores));
		const source = readFramescaperArchiveCustody(stage.reference, digest, f.indexedDB); assert.ok(!(source instanceof Blob));
		await transact(f.database, ['archiveChunks'], 'readwrite', async stores => {
			const row = await request(stores.archiveChunks!.get(`${stage.reference.token}:0`)) as { key: string; token: string; bytes: Uint8Array; sha256: string };
			await request(stores.archiveChunks!.put({ ...row, bytes: new Uint8Array([9, 2, 3, 4]) }));
		});
		await assert.rejects(source.read({ offset: 0, length: 4 }), /digest/u);
		const wrongSize = readFramescaperArchiveCustody({ ...stage.reference, size: stage.reference.size + 1 }, digest, f.indexedDB); assert.ok(!(wrongSize instanceof Blob));
		await assert.rejects(wrongSize.read({ offset: 0, length: 4 }), /size/u);
		assert.throws(() => readFramescaperArchiveCustody({ ...stage.reference, extra: true }, digest, f.indexedDB), /field|unsupported/u);
	} finally { f.database.close(); }
});

test('M10 successor archive orphan recovery removes expired private chunks and leaves published bodies intact', async () => {
	const f = await fixture(); const source = createBlobScapeArchiveByteSource(new Blob(['custody']));
	try {
		const privateStage = await stageFramescaperArchiveCustody(f.database, source); const published = await stageFramescaperArchiveCustody(f.database, source);
		await transact(f.database, FRAMESCAPER_ARCHIVE_STORES, 'readwrite', async stores => {
			await published.publish(stores);
			const row = await request(stores.archiveStages!.get(privateStage.reference.token)) as Record<string, unknown>;
			await request(stores.archiveStages!.put({ ...row, expiresAt: 0 }));
		});
		await reclaimFramescaperArchiveStaging(f.database);
		assert.equal(f.factory.recordCount(f.database.name, 'archiveChunks'), 1); assert.equal(f.factory.recordCount(f.database.name, 'archiveBodies'), 1);
		await assert.rejects(transact(f.database, FRAMESCAPER_ARCHIVE_STORES, 'readwrite', stores => privateStage.publish(stores)), /missing|expired/u);
	} finally { f.database.close(); }
});
