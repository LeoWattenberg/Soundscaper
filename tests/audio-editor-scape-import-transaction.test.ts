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

function publication(
	sourceId: string,
	cleanup: string[],
): OwnedMediaAssetPublication {
	return Object.freeze({
		metadata: Object.freeze({ sourceId }),
		async discardIfCurrent() { cleanup.push(`media:${sourceId}`); return true; },
	});
}
