/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertScapeImportStore,
	ScapeImportTransaction,
} from '../src/common/editor/scape-import-transaction.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import type { OwnedMediaAssetPublication } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('replace-import rollback preserves linked-original bindings and their locators', async () => {
	// A rollback restores the captured documents; it must never pass through
	// the full project-delete lifecycle, which destroys linked-original
	// binding rows and actively releases their platform locator grants —
	// state a document re-save can never bring back.
	const body = new Blob(['linked pcm original bytes'], { type: 'audio/wav' });
	const releases: unknown[] = [];
	const port: LinkedOriginalPort = {
		async load(kind, locatorId, { expectedRevision }) {
			if (locatorId !== 'locator_rollback_survives_0001') return null;
			if (expectedRevision !== null && expectedRevision !== 'revision_rollback_0001') return null;
			return { blob: body, locatorRevision: 'revision_rollback_0001' };
		},
		release(reference) { releases.push(reference); return true; },
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: 'scape-rollback-binding-parity',
		linkedOriginalPort: port,
	});
	await store.ready();
	await store.saveProject({
		id: 'p1', revision: 0, title: 'Original',
		updatedAt: '2026-01-01T00:00:00.000Z',
		sources: [{ id: 'src-1', kind: 'audio', name: 'orig.wav' }],
	});
	await store.bindLinkedAudioOriginal(
		'p1',
		{
			kind: 'audio', id: 'src-1', storageKey: 'stor-1', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 2,
		},
		'locator_rollback_survives_0001',
		{ expectedLocatorRevision: 'revision_rollback_0001', expectedSnapshot: body },
	);
	assert.ok(await store.getLinkedOriginalBinding('p1', 'src-1'));

	const primary = new Error('project persistence failed after its local write');
	const importStore: unknown = new Proxy(store, {
		get(target, property, receiver) {
			if (property === 'saveProjectIfCurrent') return async (
				expected: Parameters<typeof target.saveProjectIfCurrent>[0],
				project: Parameters<typeof target.saveProjectIfCurrent>[1],
			) => {
				await target.saveProjectIfCurrent(expected, project);
				throw primary;
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	assertScapeImportStore(importStore);
	const transaction = new ScapeImportTransaction(importStore);
	await transaction.captureProject('p1');
	await assert.rejects(
		transaction.publishProject({ id: 'p1', revision: 1, title: 'Imported', sources: [] }),
		(error: unknown) => error === primary,
	);
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);

	const restored = await store.loadProject('p1');
	assert.equal(restored?.title, 'Original', 'the captured project document is restored');
	assert.ok(
		await store.getLinkedOriginalBinding('p1', 'src-1'),
		'the linked-original binding survives the rollback',
	);
	assert.deepEqual(releases, [], 'no platform locator grant was released during rollback');
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`committed replace-import does not rewind a project saved afterward in ${backend}`, async () => {
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const options = {
			indexedDB: indexedDB as unknown as IDBFactory | null,
			preferOpfs: false,
			databaseName: `scape-rollback-concurrent-project-${backend}`,
		};
		const store = createProjectStore(options);
		const concurrentStore = createProjectStore(options);
		await Promise.all([store.ready(), concurrentStore.ready()]);
		await store.saveProject({ id: 'p1', revision: 0, title: 'Original', sources: [] });

		const importStore: unknown = store;
		assertScapeImportStore(importStore);
		const transaction = new ScapeImportTransaction(importStore);
		await transaction.captureProject('p1');
		await transaction.publishProject({ id: 'p1', revision: 1, title: 'Imported', sources: [] });
		await concurrentStore.saveProject({
			id: 'p1', revision: 2, title: 'Concurrent edit', sources: [],
		});

		const primary = new Error('archive closure failed after a later save');
		await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
		assert.equal((await store.loadProject('p1'))?.title, 'Concurrent edit');
		assert.deepEqual(
			(await store.listProjectRevisions('p1')).map(({ revision }) => revision),
			[2, 1, 0],
		);
	});
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`replace-import publication refuses a project saved after capture in ${backend}`, async () => {
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const options = {
			indexedDB: indexedDB as unknown as IDBFactory | null,
			preferOpfs: false,
			databaseName: `scape-publication-concurrent-project-${backend}`,
		};
		const store = createProjectStore(options);
		const concurrentStore = createProjectStore(options);
		await Promise.all([store.ready(), concurrentStore.ready()]);
		await store.saveProject({ id: 'p1', revision: 0, title: 'Original', sources: [] });

		const importStore: unknown = store;
		assertScapeImportStore(importStore);
		const transaction = new ScapeImportTransaction(importStore);
		await transaction.captureProject('p1');
		await concurrentStore.saveProject({
			id: 'p1', revision: 1, title: 'Concurrent edit', sources: [],
		});

		await assert.rejects(
			transaction.publishProject({ id: 'p1', revision: 2, title: 'Imported', sources: [] }),
			/project.*changed concurrently|concurrent.*project/iu,
		);
		assert.equal((await store.loadProject('p1'))?.title, 'Concurrent edit');
		assert.deepEqual(
			(await store.listProjectRevisions('p1')).map(({ revision }) => revision),
			[1, 0],
		);
	});
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`Scape rollback preserves a newer same-ID PCM generation in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: `scape-rollback-concurrent-source-${backend}-${Date.now()}-${Math.random()}`,
		});
		try {
			const importStore: unknown = store;
			assertScapeImportStore(importStore);
			const transaction = new ScapeImportTransaction(importStore);
			const importedWriter = await store.beginSourceWrite('shared-source', sourceMetadata());
			await importedWriter.write([Float32Array.of(0.25, -0.5)]);
			const imported = await importedWriter.commit();
			transaction.trackProvisionalSource(imported);

			const newerWriter = await store.beginSourceWrite('shared-source', sourceMetadata());
			await newerWriter.write([Float32Array.of(0.75, -0.125)]);
			const newer = await newerWriter.commit();
			assert.notEqual(imported.sourceToken, newer.sourceToken);

			const primary = new Error('import lost a later project publication race');
			await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
			assert.equal((await store.getSourceMetadata('shared-source'))?.sourceToken, newer.sourceToken);
		} finally {
			await store.close();
		}
	});
}

test('Scape rollback discards exact owned media publications and PCM sources', async () => {
	const cleanup: string[] = [];
	const store = {
		async loadProject() { return null; },
		async listProjectRevisions() { return []; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async saveProject() { throw new Error('unused'); },
		async deleteProject() { cleanup.push('project'); },
		async discardSourceIfCurrent(source: StorageRecord) { cleanup.push(`source:${source.id}`); return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject('project-1');
	transaction.trackProvisionalSource(sourcePublication('audio-1'));
	transaction.trackProvisionalMedia(publication('video-1', cleanup));
	transaction.trackProvisionalMedia(publication('timing-1', cleanup));
	const primary = new Error('later import failure');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(cleanup, ['media:timing-1', 'media:video-1', 'source:audio-1']);
});

for (const [label, current] of [
	['create', null],
	['replace', { id: 'capability-refusal', revision: 1 }],
] as const) {
	test(`Scape ${label} capability refusal discards assets staged before project publication`, async () => {
		const cleanup: string[] = [];
		const store = {
			async loadProject() { return current; },
			async listProjectRevisions() {
				return current === null ? [] : [{ revision: current.revision, project: current }];
			},
			async getSourceMetadata() { return null; },
			async getMediaAssetMetadata() { return null; },
			async beginSourceWrite() { throw new Error('unused'); },
			async beginMediaAssetWrite() { throw new Error('unused'); },
			async saveProject() { throw new Error('unconditional publication must not run'); },
			async deleteProject() { throw new Error('broad rollback must not run'); },
			async discardSourceIfCurrent(source: StorageRecord) {
				cleanup.push(`source:${source.id}`);
				return true;
			},
		};
		const transaction = new ScapeImportTransaction(store);
		await transaction.captureProject('capability-refusal');
		transaction.trackProvisionalSource(sourcePublication('staged-audio'));
		transaction.trackProvisionalMedia(publication('staged-video', cleanup));
		let publicationFailure: unknown;
		try {
			await transaction.publishProject({ id: 'capability-refusal', revision: 2 });
		} catch (error) {
			publicationFailure = error;
		}
		assert.match(String(publicationFailure), /requires exact-current/iu);
		await assert.rejects(transaction.rollback(publicationFailure), (error: unknown) => (
			error === publicationFailure
		));
		assert.deepEqual(cleanup, ['media:staged-video', 'source:staged-audio']);
	});
}

test('Scape create-only publication is an irreversible commit point', async () => {
	const events: string[] = [];
	const project = { id: 'new-project', revision: 0 };
	const created = structuredClone(project);
	const store = {
		async loadProject() { return null; },
		async listProjectRevisions() { return []; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async createProjectIfAbsent(value: typeof project) {
			events.push('created');
			assert.deepEqual(value, project);
			return created;
		},
		async deleteProjectIfCurrent(value: typeof project) {
			events.push('deleted-exact');
			assert.equal(value, created);
			return true;
		},
		async saveProject() { throw new Error('ordinary save must not create'); },
		async deleteProject() { throw new Error('broad delete must not remove a created target'); },
		async discardSourceIfCurrent() { return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(project.id);
	await transaction.publishProject(project);
	assert.deepEqual(events, ['created']);
	const primary = new Error('archive closure failed');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(events, ['created']);
});

test('Scape preserves project assets after committed create-only publication', async () => {
	const cleanup: string[] = [];
	const project = { id: 'adopted-project', revision: 0 };
	const created = structuredClone(project);
	const store = {
		async loadProject() { return null; },
		async listProjectRevisions() { return []; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async createProjectIfAbsent() { return created; },
		async deleteProjectIfCurrent() { throw new Error('committed creation cannot be rolled back'); },
		async saveProject() { throw new Error('ordinary save must not create'); },
		async deleteProject() { throw new Error('broad delete must not remove an adopted target'); },
		async discardSourceIfCurrent(source: StorageRecord) { cleanup.push(`source:${source.id}`); return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(project.id);
	transaction.trackProvisionalSource(sourcePublication('audio-1'));
	transaction.trackProvisionalMedia(publication('video-1', cleanup));
	await transaction.publishProject(project);
	const primary = new Error('archive closure failed');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(cleanup, []);
});

test('Scape preserves project assets when a concurrent creator wins initial publication', async () => {
	const cleanup: string[] = [];
	const project = { id: 'concurrent-project', revision: 0 };
	const store = {
		async loadProject() { return null; },
		async listProjectRevisions() { return []; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async createProjectIfAbsent() { return null; },
		async deleteProjectIfCurrent() { throw new Error('an unowned project cannot be deleted'); },
		async saveProject() { throw new Error('ordinary save must not create'); },
		async deleteProject() { throw new Error('broad delete must not remove a concurrent target'); },
		async discardSourceIfCurrent(source: StorageRecord) { cleanup.push(`source:${source.id}`); return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(project.id);
	transaction.trackProvisionalSource(sourcePublication('shared-audio'));
	transaction.trackProvisionalMedia(publication('shared-video', cleanup));
	let publicationFailure: unknown;
	try {
		await transaction.publishProject(project);
	} catch (error) {
		publicationFailure = error;
	}
	assert.match(String(publicationFailure), /created concurrently/iu);
	await assert.rejects(transaction.rollback(publicationFailure), (error: unknown) => error === publicationFailure);
	assert.deepEqual(cleanup, []);
});

test('Scape preserves project assets when a concurrent replacement wins publication', async () => {
	const cleanup: string[] = [];
	const existing = { id: 'concurrent-replacement', revision: 1 };
	const replacement = { ...existing, revision: 2 };
	const store = {
		async loadProject() { return existing; },
		async listProjectRevisions() { return [{ revision: 1, project: existing }]; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async saveProject() { throw new Error('ordinary save must not publish replacement'); },
		async saveProjectIfCurrent() { return null; },
		async restoreProjectSnapshotIfCurrent() {
			throw new Error('a comparison loser did not publish a restorable project');
		},
		async deleteProject() { throw new Error('broad delete must not remove a concurrent target'); },
		async discardSourceIfCurrent(source: StorageRecord) { cleanup.push(`source:${source.id}`); return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(existing.id);
	transaction.trackProvisionalSource(sourcePublication('shared-audio'));
	transaction.trackProvisionalMedia(publication('shared-video', cleanup));
	let publicationFailure: unknown;
	try {
		await transaction.publishProject(replacement);
	} catch (error) {
		publicationFailure = error;
	}
	assert.match(String(publicationFailure), /changed concurrently/iu);
	await assert.rejects(transaction.rollback(publicationFailure), (error: unknown) => error === publicationFailure);
	assert.deepEqual(cleanup, []);
});

test('Scape routes a captured existing target through exact-current repository update', async () => {
	const existing = { id: 'existing-project', revision: 1 };
	const replacement = { id: existing.id, revision: 2 };
	const events: string[] = [];
	const store = {
		async loadProject() { return existing; },
		async listProjectRevisions() { return [{ revision: 1, project: existing }]; },
		async getSourceMetadata() { return null; },
		async getMediaAssetMetadata() { return null; },
		async beginSourceWrite() { throw new Error('unused'); },
		async beginMediaAssetWrite() { throw new Error('unused'); },
		async createProjectIfAbsent() { throw new Error('updates must not use create-only publication'); },
		async deleteProjectIfCurrent() { throw new Error('unused'); },
		async saveProject() { throw new Error('replace imports must not use unconditional publication'); },
		async saveProjectIfCurrent(expected: typeof existing, value: typeof replacement) {
			events.push('save-exact');
			assert.equal(expected, existing);
			assert.equal(value, replacement);
			return replacement;
		},
		async restoreProjectSnapshotIfCurrent() { throw new Error('completed imports do not roll back'); },
		async deleteProject() { throw new Error('unused'); },
		async discardSourceIfCurrent() { return true; },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(existing.id);
	await transaction.publishProject(replacement);
	transaction.complete();
	assert.deepEqual(events, ['save-exact']);
});

function publication(
	sourceId: string,
	cleanup: string[],
): OwnedMediaAssetPublication {
	return Object.freeze({
		metadata: Object.freeze({ sourceId }),
		async discardIfCurrent() { cleanup.push(`media:${sourceId}`); return true; },
	});
}

function sourceMetadata(): Record<string, unknown> {
	return { sampleRate: 48_000, channelCount: 1, chunkFrames: 2 };
}

function sourcePublication(sourceId: string): StorageRecord {
	return Object.freeze({
		id: sourceId,
		storage: 'indexeddb-chunks',
		sourceToken: `${sourceId}:pending:test-generation`,
	});
}
