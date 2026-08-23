/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ScapeImportTransaction } from '../src/common/editor/scape-import-transaction.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import type { OwnedMediaAssetPublication } from '../src/common/editor/storage/media-asset-write-contract.ts';

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

	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject('p1');
	await transaction.publishProject({ id: 'p1', revision: 1, title: 'Imported', sources: [] });
	const primary = new Error('user cancelled after publish');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);

	const restored = await store.loadProject('p1');
	assert.equal(restored?.title, 'Original', 'the captured project document is restored');
	assert.ok(
		await store.getLinkedOriginalBinding('p1', 'src-1'),
		'the linked-original binding survives the rollback',
	);
	assert.deepEqual(releases, [], 'no platform locator grant was released during rollback');
});

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
		async deleteSource(sourceId: string) { cleanup.push(`source:${sourceId}`); },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject('project-1');
	transaction.trackProvisionalSource('audio-1');
	transaction.trackProvisionalMedia(publication('video-1', cleanup));
	transaction.trackProvisionalMedia(publication('timing-1', cleanup));
	const primary = new Error('later import failure');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(cleanup, ['media:timing-1', 'media:video-1', 'source:audio-1']);
});

test('Scape publishes an absent target create-only and rolls it back by exact ownership', async () => {
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
		async deleteSource() {},
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(project.id);
	await transaction.publishProject(project);
	assert.deepEqual(events, ['created']);
	const primary = new Error('archive closure failed');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(events, ['created', 'deleted-exact']);
});

test('Scape preserves project assets when a later writer defeats exact create rollback', async () => {
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
		async deleteProjectIfCurrent() { cleanup.push('project-preserved'); return false; },
		async saveProject() { throw new Error('ordinary save must not create'); },
		async deleteProject() { throw new Error('broad delete must not remove an adopted target'); },
		async deleteSource(sourceId: string) { cleanup.push(`source:${sourceId}`); },
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(project.id);
	transaction.trackProvisionalSource('audio-1');
	transaction.trackProvisionalMedia(publication('video-1', cleanup));
	await transaction.publishProject(project);
	const primary = new Error('archive closure failed');
	await assert.rejects(transaction.rollback(primary), (error: unknown) => error === primary);
	assert.deepEqual(cleanup, ['project-preserved']);
});

test('Scape routes a captured existing target through ordinary repository update', async () => {
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
		async saveProject(value: typeof replacement) { events.push('save'); assert.equal(value, replacement); },
		async deleteProject() { throw new Error('unused'); },
		async deleteSource() {},
	};
	const transaction = new ScapeImportTransaction(store);
	await transaction.captureProject(existing.id);
	await transaction.publishProject(replacement);
	transaction.complete();
	assert.deepEqual(events, ['save']);
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
