/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ScapeImportTransaction } from '../src/common/editor/scape-import-transaction.ts';
import type { OwnedMediaAssetPublication } from '../src/common/editor/storage/media-asset-write-contract.ts';

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
