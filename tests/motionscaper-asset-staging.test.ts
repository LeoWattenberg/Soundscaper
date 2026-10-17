/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { MotionAssetRepository } from '../src/common/editor/storage/motion-asset-repository.ts';
import { openMotionProjectDatabase } from '../src/common/editor/storage/motion-project-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';

const databaseName = 'kw-media-motionscaper-editor-v1';
const lease = 86_400_000;
const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = digestScapeBytes(bytes);
const asset = { id: 'image-1', name: 'Image', kind: 'image' as const, mimeType: 'image/png',
	sha256, storageKey: `motion-sha256:${sha256}`, byteLength: bytes.byteLength, width: 2, height: 2, hasAlpha: true };

test('reopening reclaims expired interrupted writes without removing published assets', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const repository = new MotionAssetRepository(async () => database);
	let now = 1_000_000;
	context.mock.method(Date, 'now', () => now);
	try {
		await repository.put(asset, new Blob([bytes]));
		const publishedCount = indexedDB.recordCount(databaseName, 'chunks');
		const abandoned = await repository.stage(asset);
		await abandoned.write(bytes.slice(0, 2));
		assert.ok(indexedDB.recordCount(databaseName, 'chunks') > publishedCount);
		now += lease + 1;
		const reopened = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
		try {
			await reopened.list();
			assert.equal(indexedDB.recordCount(databaseName, 'staging'), 0);
			assert.equal(indexedDB.recordCount(databaseName, 'chunks'), publishedCount);
			const body = await reopened.loadAsset(asset);
			assert.ok(body);
			assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
			await assert.rejects(abandoned.write(bytes.slice(2)), /staging.*expired|staging.*missing/u);
		} finally { await reopened.close(); }
	} finally { database.close(); }
});

test('active writes renew their lease and rollback after publication keeps immutable bytes', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const repository = new MotionAssetRepository(async () => database);
	let now = 1_000_000;
	context.mock.method(Date, 'now', () => now);
	try {
		const staging = await repository.stage(asset);
		now += lease / 2;
		await staging.write(bytes.slice(0, 2));
		now += lease / 2 + 1;
		const reopened = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
		try {
			await reopened.list();
			assert.equal(indexedDB.recordCount(databaseName, 'staging'), 1);
			await staging.write(bytes.slice(2));
			await staging.finish();
			await transact(database, ['assets', 'chunks', 'staging'], 'readwrite', async (stores) => { await staging.publish(stores); });
			await staging.rollback();
			const body = await reopened.loadAsset(asset);
			assert.ok(body);
			assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
		} finally { await reopened.close(); }
	} finally { database.close(); }
});

test('expired staging cannot publish even when its in-memory digest was verified', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const repository = new MotionAssetRepository(async () => database);
	let now = 1_000_000;
	context.mock.method(Date, 'now', () => now);
	try {
		const staging = await repository.stage(asset);
		await staging.write(bytes);
		await staging.finish();
		now += lease + 1;
		await assert.rejects(transact(database, ['assets', 'chunks', 'staging'], 'readwrite', async (stores) => {
			await staging.publish(stores);
		}), /staging.*expired/u);
		assert.equal(await repository.load(asset), null);
		await staging.rollback();
		const remaining = await transact(database, ['chunks'], 'readonly', (stores) => request(stores.chunks.count()));
		assert.equal(remaining, 0);
	} finally { database.close(); }
});

test('orphan recovery continues beyond one bounded cursor page', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const repository = new MotionAssetRepository(async () => database);
	let now = 1_000_000;
	context.mock.method(Date, 'now', () => now);
	try {
		for (let index = 0; index < 65; index += 1) {
			const stage = await repository.stage(asset);
			await stage.write(bytes.slice(0, 2));
		}
		now += lease + 1;
		const reopened = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
		try {
			await reopened.list();
			assert.equal(indexedDB.recordCount(databaseName, 'staging'), 0);
			assert.equal(indexedDB.recordCount(databaseName, 'chunks'), 0);
			assert.equal(indexedDB.stats.getAllRequests.length, 0);
			assert.equal(indexedDB.stats.activeTransactions, 0);
		} finally { await reopened.close(); }
	} finally { database.close(); }
});

test('concurrent chunks are refused before they can overwrite private storage', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const repository = new MotionAssetRepository(async () => database);
	try {
		const stage = await repository.stage(asset);
		const first = stage.write(bytes.slice(0, 2));
		await assert.rejects(stage.write(bytes.slice(2)), /sequential/u);
		await first;
		await stage.write(bytes.slice(2));
		await stage.finish();
		await stage.rollback();
		assert.equal(indexedDB.recordCount(databaseName, 'chunks'), 0);
	} finally { database.close(); }
});
