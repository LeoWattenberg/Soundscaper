/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerResources } from '../src/common/editor/controller/composition/controller-resources.ts';
import { createFileSizeWarningConfirmation } from '../src/common/editor/controller/shared/file-size-warning-confirmation.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { AudioEditorProjectStoreOptions } from '../src/common/editor/storage/project-store-options.ts';
import { MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const expectedBytes = MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES + 1;
const expectedSha256 = '0'.repeat(64);
const callbacks = { copy: { staffPadRangeWarning: '{stageCount} stages', ffmpegLoading: 'Loading' },
	onPosition() {}, onMeter() {}, onState() {}, setStatus() {}, updateExportProgress() {} };

test('production ephemeral media storage admits an approved large file and preserves bounded chunks and cleanup', async () => {
	let prompts = 0;
	const resources = createControllerResources({ confirmFileSizeWarning: async (warning, options) => {
		prompts += 1;
		assert.deepEqual(warning, { label: 'Temporary media storage', byteLength: expectedBytes,
			thresholdBytes: MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES });
		assert.ok(options?.signal instanceof AbortSignal);
		assert.equal(resources.store.memory.mediaAssetChunks.size, 0);
		assert.equal((await resources.store.mediaRepository.activeAssetStaging()).mediaChunkTokens.size, 0);
		return true;
	} }, callbacks);
	try {
		assert.equal(resources.fileService.isDesktop, false);
		assert.equal(resources.store.getStatus().state, 'memory-ephemeral');
		const writer = await resources.store.beginMediaAssetWrite('approved-ephemeral-size-warning', {}, { expectedBytes, expectedSha256 });
		assert.equal(prompts, 1);
		assert.equal(writer.maximumChunkBytes, MEDIA_ASSET_STREAM_CHUNK_BYTES);
		await writer.write(new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES));
		assert.equal(resources.store.memory.mediaAssetChunks.size, 1);
		await assert.rejects(writer.commit(), /do not match the declared asset size/u);
		assert.equal(resources.store.memory.mediaAssetChunks.size, 0);
		assert.equal((await resources.store.mediaRepository.activeAssetStaging()).mediaChunkTokens.size, 0);
		assert.equal(await resources.store.getMediaAssetMetadata('approved-ephemeral-size-warning'), null);
	} finally { await disposeResources(resources); }
});

test('production ephemeral media storage declines before retaining any body chunks or staging lease', async () => {
	let prompts = 0;
	const resources = createControllerResources({ confirmFileSizeWarning: async () => { prompts += 1; return false; } }, callbacks);
	try {
		const before = resources.store.memory.mediaAssetStaging.size;
		await assert.rejects(resources.store.beginMediaAssetWrite('declined-ephemeral-size-warning', {},
			{ expectedBytes, expectedSha256 }), { name: 'AbortError' });
		assert.equal(prompts, 1);
		assert.equal(resources.store.memory.mediaAssetChunks.size, 0);
		assert.equal(resources.store.memory.mediaAssetStaging.size, before);
		assert.equal(await resources.store.getMediaAssetMetadata('declined-ephemeral-size-warning'), null);
	} finally { await disposeResources(resources); }
});

test('maintenance cancels a pending memory warning and prevents late admission', async () => {
	const confirmation = createFileSizeWarningConfirmation();
	const resources = createControllerResources({ confirmFileSizeWarning: confirmation.confirm }, callbacks);
	let prompted!: () => void;
	const ready = new Promise<void>((resolve) => { prompted = resolve; });
	const unsubscribe = confirmation.subscribe(prompted);
	try {
		const operation = resources.store.beginMediaAssetWrite('cancelled-ephemeral-size-warning', {}, { expectedBytes, expectedSha256 });
		const rejected = assert.rejects(operation, { name: 'AbortError' });
		await ready;
		const prompt = confirmation.getSnapshot();
		assert.ok(prompt);
		const maintenance = resources.store.mediaRepository.beginAssetMaintenance();
		try { await maintenance.abortActive(); } finally { maintenance.release(); }
		await rejected;
		assert.equal(confirmation.getSnapshot(), null);
		assert.equal(confirmation.settle(prompt, true), false);
		assert.equal(resources.store.memory.mediaAssetChunks.size, 0);
		assert.equal((await resources.store.mediaRepository.activeAssetStaging()).mediaChunkTokens.size, 0);
	} finally { unsubscribe(); confirmation.dispose(); await disposeResources(resources); }
});

test('durable IndexedDB chunks bypass the memory warning and constructor ports remain validated', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({ indexedDB, databaseName: `durable-size-warning-${crypto.randomUUID()}`,
		preferOpfs: false, confirmFileSizeWarning: async () => { throw new Error('Durable chunks must not prompt for memory storage.'); } });
	try {
		const writer = await store.beginMediaAssetWrite('durable-size-warning', {}, { expectedBytes, expectedSha256 });
		assert.equal(store.getStatus().state, 'indexeddb');
		await writer.abort();
		assert.equal(indexedDB.recordCount(store.databaseName, 'mediaAssetChunks'), 0);
	} finally { await store.close(); }
	assert.throws(() => createProjectStore({ confirmFileSizeWarning: 'yes' } as unknown as AudioEditorProjectStoreOptions),
		/confirmFileSizeWarning must be a function/u);
});

async function disposeResources(resources: ReturnType<typeof createControllerResources>): Promise<void> {
	await resources.clipTimePitchCache.dispose?.(); await resources.engine.dispose();
	resources.ffmpeg.dispose(); resources.nyquistClient?.dispose(); await resources.store.close();
}
