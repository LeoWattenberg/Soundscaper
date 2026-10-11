/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperProjectStore, MotionProjectConflictError } from '../src/motionscaper/editor-project-store.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { openMotionProjectDatabase } from '../src/common/editor/storage/motion-project-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';

function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
	const project = createMotionscaperProject({ id: 'project-1', compositionId: 'comp-1', title: 'Title' });
	return { indexedDB, store, project };
}

test('durable saves survive a new store and compare-and-swap prevents lost edits', async () => {
	const { indexedDB, store, project } = fixture();
	try {
		const first = await store.save(project, null);
		assert.deepEqual((await store.load(project.id))?.project, project);
		const second = await store.save({ ...project, title: 'Updated', revision: 1 }, first.digest);
		await assert.rejects(store.save({ ...project, title: 'Stale', revision: 1 }, first.digest), MotionProjectConflictError);
		assert.equal((await store.load(project.id))?.digest, second.digest);
		assert.deepEqual(await store.list(), [{ id: project.id, title: 'Updated', revision: 1,
			savedDigest: second.digest, hasRecovery: false }]);
		const reopened = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory });
		assert.equal((await reopened.load(project.id))?.project.title, 'Updated');
		assert.equal((await reopened.loadRevision(project.id, first.digest))?.project.title, 'Title');
		await reopened.close();
	} finally { await store.close(); }
});

test('recovery autosaves remain separate from saved publications and their revision authority', async () => {
	const { store, project } = fixture();
	try {
		const published: string[] = [];
		const unsubscribe = store.subscribeSaved((revision) => published.push(revision.digest));
		const saved = await store.save(project, null);
		await store.saveRecovery({ ...project, title: 'Recovery edit', revision: 1 }, saved.digest);
		assert.equal((await store.load(project.id))?.project.title, 'Title');
		assert.equal((await store.loadRecovery(project.id))?.title, 'Recovery edit');
		assert.deepEqual(published, [saved.digest]);
		await store.save({ ...project, title: 'Explicit save', revision: 1 }, saved.digest);
		assert.equal(await store.loadRecovery(project.id), null);
		assert.equal(published.length, 2);
		unsubscribe();
	} finally { await store.close(); }
});

const bytes = new Uint8Array([1, 2, 3, 4]);
const digest = digestScapeBytes(bytes);
const asset = {
	id: 'image-1', name: 'Image', kind: 'image' as const, mimeType: 'image/png',
	sha256: digest, storageKey: `motion-sha256:${digest}`, byteLength: bytes.byteLength,
	width: 2, height: 2, hasAlpha: true,
};

test('asset writes verify content and imports atomically publish a complete offline closure', async () => {
	const { indexedDB, store, project } = fixture();
	try {
		const withAsset = { ...project, assets: [asset] };
		await assert.rejects(store.save(withAsset, null), /asset/u);
		await assert.rejects(store.putAsset(asset, new Blob([new Uint8Array([4, 3, 2, 1])])), /digest/u);
		assert.equal(await store.loadAsset(asset), null);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'chunks'), 0);
		assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'staging'), 0);
		const blob = await exportMotionscaperArchive(withAsset, () => new Blob([bytes]));
		assert.ok(blob instanceof Blob);
		await importMotionscaperArchive(blob, (value) => store.beginImport(value));
		const loaded = await store.load(project.id);
		assert.ok(loaded);
		assert.deepEqual(loaded.project, withAsset);
		const body = await store.loadAsset(asset);
		assert.ok(body instanceof Blob);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
		const streamed = await store.readAsset(asset);
		assert.ok(streamed);
		const exported = await exportMotionscaperArchive(loaded.project, (entry) => store.readAsset(entry));
		assert.ok(exported instanceof Blob);
	} finally { await store.close(); }
});

test('asset chunks remain bounded and storage failure leaves the prior saved revision intact', async () => {
	const { indexedDB, store, project } = fixture();
	try {
		const first = await store.save(project, null);
		indexedDB.failNextPutForStore('revisions', new DOMException('Quota exhausted', 'QuotaExceededError'));
		await assert.rejects(store.save({ ...project, revision: 1, title: 'Uncommitted' }, first.digest), /Quota exhausted/u);
		assert.equal((await store.load(project.id))?.project.title, 'Title');
		assert.equal(indexedDB.stats.activeTransactions, 0);
		const large = new Uint8Array(9 * 1024 * 1024).fill(17);
		const sha256 = digestScapeBytes(large);
		await store.putAsset({ ...asset, sha256, storageKey: `motion-sha256:${sha256}`, byteLength: large.byteLength }, new Blob([large]));
		const chunks = indexedDB.records('kw-media-motionscaper-editor-v1', 'chunks') as Array<{ bytes: Uint8Array }>;
		assert.ok(chunks.length >= 3);
		assert.ok(chunks.every((chunk) => chunk.bytes.byteLength <= 4 * 1024 * 1024));
	} finally { await store.close(); }
});

test('stored revision and recovery identities must match the requested project', async () => {
	const { indexedDB, store, project } = fixture();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, 'kw-media-motionscaper-editor-v1');
	try {
		const first = await store.save(project, null);
		const second = await store.save({ ...project, id: 'project-2', title: 'Other' }, null);
		await transact(database, ['revisions'], 'readwrite', async (stores) => {
			await request(stores.revisions.put({ key: `${project.id}:${first.digest}`, projectId: project.id, snapshot: second }));
		});
		await assert.rejects(store.load(project.id), /identity/u);
		await assert.rejects(store.loadRevision(project.id, first.digest), /identity/u);
		await assert.rejects(store.save({ ...project, revision: 1 }, first.digest), /identity/u);
		await transact(database, ['projects'], 'readwrite', async (stores) => {
			await request(stores.projects.put({ id: project.id, savedDigest: first.digest,
				savedTitle: project.title, savedRevision: project.revision, recovery: second.project }));
		});
		await assert.rejects(store.loadRecovery(project.id), /identity/u);
		await assert.rejects(store.list(), /identity/u);
	} finally { database.close(); await store.close(); }
});

test('stored asset records cannot amplify chunk reads beyond their declared byte length', async () => {
	const { indexedDB, store } = fixture();
	const database = await openMotionProjectDatabase(indexedDB as unknown as IDBFactory, 'kw-media-motionscaper-editor-v1');
	try {
		await store.putAsset(asset, new Blob([bytes]));
		await transact(database, ['assets'], 'readwrite', async (stores) => {
			const original = await request(stores.assets.get(asset.storageKey)) as Record<string, unknown>;
			await request(stores.assets.put({ ...original, chunkCount: 1000000 }));
		});
		await assert.rejects(store.readAsset(asset), /contract/u);
	} finally { database.close(); await store.close(); }
});
