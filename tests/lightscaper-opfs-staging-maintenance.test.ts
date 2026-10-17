/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openDatabase, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MediaAssetStagingRepository, revokeSourceStageInStore } from '../src/common/editor/storage/media-asset-staging-repository.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME as STORE } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { captureOriginalPrefix, replayOriginalPrefix } from './helpers/lightscaper-opfs-original-staging-fixture.ts';
import { observed } from './helpers/lightscaper-opfs-writer-acquisition-fixture.ts';

// These controlled native transaction ports qualify durable evidence changes;
// they do not establish native browser process-death timing.
test('Light storage clear accepts a fresh native staging store without inventing path ownership', async () => {
	const backing = createInstrumentedIndexedDB(), name = `lightscaper-empty-clear-${randomUUID()}`;
	const database = await openDatabase(backing as unknown as IDBFactory, name);
	const repositories = createStorageRepositories({ memory: getMemoryDatabase(name), database: () => Promise.resolve(database) },
		{ revisionLimit: 10, preferOpfs: false });
	try {
		await repositories.retention.clear();
		assert.deepEqual(backing.records(name, STORE).map(row => (row as Record<string, unknown>).kind), ['state']);
	} finally {
		try { await repositories.retention.releaseSession(database); }
		finally { repositories.opfs.close(); database.close(); }
	}
});

for (const maintenance of ['generation', 'source-revocation'] as const) {
	test(`Light OPFS staging ${maintenance} fences publication while retaining exact path evidence`, async () => {
		const backing = createInstrumentedIndexedDB();
		const name = `lightscaper-staging-maintenance-${randomUUID()}`;
		const database = await openDatabase(backing as unknown as IDBFactory, name);
		const port = { memory: getMemoryDatabase(name), database: () => Promise.resolve(database) };
		const staging = new MediaAssetStagingRepository(port);
		try {
			const lease = await staging.acquirePath('original', 'owned-original.blob', database);
			await staging.acquire('chunk-source', { mediaChunkToken: 'chunk-body' }, database);
			const before = (backing.records(name, STORE) as Record<string, unknown>[]).find(row => row.path === 'owned-original.blob');
			assert.ok(before);
			await transact(database, STORE, 'readwrite', async stores => {
				if (maintenance === 'generation') await staging.invalidateStore(stores[STORE]!);
				else await revokeSourceStageInStore(stores[STORE]!, 'original');
			});
			const rows = backing.records(name, STORE) as Record<string, unknown>[];
			assert.deepEqual(rows.find(row => row.path === 'owned-original.blob'), before,
				'Maintenance must retain its original durable path receipt until exact physical absence is proved.');
			if (maintenance === 'generation') {
				assert.equal(rows.some(row => row.mediaChunkToken === 'chunk-body'), false);
				assert.notEqual(rows.find(row => row.key === 'state')?.generation, before.generation);
			} else assert.equal(rows.some(row => row.mediaChunkToken === 'chunk-body'), true);
			await assert.rejects(transact(database, STORE, 'readwrite', stores => lease.assertInStore(stores[STORE]!)),
				{ name: 'MediaAssetStagingLeaseError' });
		} finally { database.close(); }
	});
}

test('Light storage clear retains the exact directory witness while physical original removal is pending', async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const database = await openDatabase(context.factory, MEDIA.databaseName);
	const repositories = createStorageRepositories({
		memory: getMemoryDatabase(MEDIA.databaseName), database: () => Promise.resolve(database),
	}, { revisionLimit: 10, preferOpfs: true, opfsRoot: context.fixture.root as unknown as FileSystemDirectoryHandle,
		opfsDirectoryName: MEDIA.opfsDirectoryName, opfsWorkerName: MEDIA.opfsWorkerName });
	let clearing: ReturnType<typeof observed<void>> | undefined;
	const errors: unknown[] = [];
	try {
		context.fixture.path = prefix.priorPath;
		context.fixture.removeFailure = new Error('The controlled physical original remains present.');
		const clear = repositories.retention.admitClear().begin();
		clearing = observed(clear.completion);
		assert.equal(await clear.localCommit, true);
		await context.fixture.removalEntered.promise;
		const records = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[];
		const binding = records.find(row => row.key === `audio-editor-opfs-directory-binding-v1:${prefix.lease.leaseId}`);
		assert.ok(binding, 'The actual clear transaction must retain the paired witness until physical absence is certified.');
		const value = binding.value as Record<string, unknown>;
		assert.equal(value.sourceId, prefix.lease.sourceId); assert.equal(value.path, prefix.lease.path);
		assert.equal(await Reflect.apply(FileSystemHandle.prototype.isSameEntry, context.fixture.directory, [value.directoryHandle]), true);
		const rows = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, STORE) as Record<string, unknown>[];
		assert.deepEqual(rows.find(row => row.key === prefix.lease.key), prefix.lease);
		assert.notEqual(rows.find(row => row.key === 'state')?.generation, prefix.lease.generation);
		assert.equal(context.fixture.files.has(prefix.lease.path!), true);
	} catch (error) { errors.push(error); }
	finally {
		context.fixture.releaseAll();
		if (clearing) { const result = await clearing; if (!result.ok) errors.push(result.error); }
		try { await repositories.retention.releaseSession(database); } catch (error) { errors.push(error); }
		try { repositories.opfs.close(); } catch (error) { errors.push(error); }
		try { database.close(); } catch (error) { errors.push(error); }
		try { await context.dispose(); } catch (error) { errors.push(error); }
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, 'Light storage clear assertions and cleanup failed.');
});

test('Light storage clear defers a legacy unbound physical path for authenticated startup recovery', async () => {
	const prefix = await captureOriginalPrefix(true), context = await replayOriginalPrefix(prefix);
	const database = await openDatabase(context.factory, MEDIA.databaseName);
	const repositories = createStorageRepositories({
		memory: getMemoryDatabase(MEDIA.databaseName), database: () => Promise.resolve(database),
	}, { revisionLimit: 10, preferOpfs: true, opfsRoot: context.fixture.root as unknown as FileSystemDirectoryHandle,
		opfsDirectoryName: MEDIA.opfsDirectoryName, opfsWorkerName: MEDIA.opfsWorkerName });
	try {
		await repositories.retention.clear();
		assert.equal(context.fixture.files.has(prefix.lease.path!), true,
			'A relative path without its historical directory witness cannot authorize clear to delete a physical file.');
		const rows = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, STORE) as Record<string, unknown>[];
		assert.deepEqual(rows.find(row => row.key === prefix.lease.key), prefix.lease);
		assert.equal(context.fixture.events.includes(`remove-enter:${prefix.lease.path!}`), false);
	} finally {
		try { await repositories.retention.releaseSession(database); }
		finally { repositories.opfs.close(); database.close(); await context.dispose(); }
	}
});

test('Light storage clear rolls back metadata and the generation fence when a paired witness is malformed', async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const database = await openDatabase(context.factory, MEDIA.databaseName);
	const repositories = createStorageRepositories({
		memory: getMemoryDatabase(MEDIA.databaseName), database: () => Promise.resolve(database),
	}, { revisionLimit: 10, preferOpfs: true, opfsRoot: context.fixture.root as unknown as FileSystemDirectoryHandle,
		opfsDirectoryName: MEDIA.opfsDirectoryName, opfsWorkerName: MEDIA.opfsWorkerName });
	try {
		assert.equal((await repositories.retention.withSoleSession(() => undefined)).admitted, true);
		const raw = context.native.raw(MEDIA.databaseName), key = `audio-editor-opfs-directory-binding-v1:${prefix.lease.leaseId}`;
		const binding = (raw.records(MEDIA.databaseName, 'settings') as Record<string, unknown>[]).find(row => row.key === key)!;
		raw.seedRecord(MEDIA.databaseName, 'settings', { ...binding, value: { ...binding.value as object, path: 'unrelated-original.blob' } });
		const before = new Map([...database.objectStoreNames].map(store => [store, raw.records(MEDIA.databaseName, store)]));
		const clear = repositories.retention.admitClear().begin();
		const completion = observed(clear.completion);
		assert.equal(await clear.localCommit, false);
		const result = await completion;
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(String(result.error), /directory witness is malformed/);
		for (const [store, rows] of before) assert.deepEqual(raw.records(MEDIA.databaseName, store), rows, store);
		assert.equal(context.fixture.files.has(prefix.lease.path!), true);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally {
		try { await repositories.retention.releaseSession(database); }
		finally { repositories.opfs.close(); database.close(); await context.dispose(); }
	}
});
