/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSource,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';

const PROJECT_ID = 'linked-video-composition-project';
const LOCATOR_ID = 'locator_composition_000001';
const LOCATOR_REVISION = 'revision_composition_0001';

test('project storage composes pathless linked-video binding and resolution separately from media assets', async (context) => {
	const body = new Blob(['linked video composition'], { type: 'video/mp4' });
	const reads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const port: LinkedVideoOriginalPort = {
		load(locatorId, { expectedRevision }) {
			reads.push({ locatorId, expectedRevision });
			return Promise.resolve({ blob: body, locatorRevision: LOCATOR_REVISION });
		},
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-video-composition-${Date.now()}-${Math.random()}`,
		linkedVideoOriginalPort: port,
	});
	context.after(async () => { await store.close(); });
	const source = videoSource();

	const binding = await store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	assert.equal(binding.projectId, PROJECT_ID);
	assert.equal(binding.sourceId, source.id);
	assert.equal(binding.storageKey, source.storageKey);
	assert.equal(binding.locatorId, LOCATOR_ID);
	assert.equal(binding.locatorRevision, LOCATOR_REVISION);
	assert.equal(binding.byteLength, body.size);
	assert.deepEqual(reads, [{ locatorId: LOCATOR_ID, expectedRevision: null }]);

	assert.deepEqual(
		await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id),
		binding,
	);
	assert.deepEqual(await store.getLinkedVideoOriginalMetadata(PROJECT_ID, source), {
		sourceId: source.storageKey,
		storage: 'linked-video-original-v1',
		path: null,
		committedAt: binding.boundAt,
		mimeType: source.mimeType,
		size: body.size,
		sha256: binding.sha256,
	});
	assert.equal(await store.getMediaAssetMetadata(source.storageKey), null);

	const resolved = await store.resolveLinkedVideoOriginal(PROJECT_ID, source);
	assert.ok(resolved);
	assert.equal(await resolved.blob.text(), await body.text());
	assert.deepEqual(reads.at(-1), {
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	});
	assert.equal(await store.getMediaAssetMetadata(source.storageKey), null);

	assert.equal(await store.unlinkLinkedVideoOriginal(
		PROJECT_ID,
		source.id,
		'binding_stale_token_0001',
	), false);
	assert.equal(await store.unlinkLinkedVideoOriginal(
		PROJECT_ID,
		source.id,
		binding.bindingToken,
	), true);
	assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
});

test('linked-video resolver injection is optional and facade operations fail before platform access when absent', async (context) => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-video-composition-absent-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	const source = videoSource();

	assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	await assert.rejects(
		store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID),
		/resolution is unavailable/iu,
	);
	await assert.rejects(
		store.resolveLinkedVideoOriginal(PROJECT_ID, source),
		/resolution is unavailable/iu,
	);
	await assert.rejects(
		store.getLinkedVideoOriginalMetadata(PROJECT_ID, source),
		/resolution is unavailable/iu,
	);
});

function videoSource(): LinkedVideoOriginalSource {
	return Object.freeze({
		kind: 'video',
		id: 'linked-video-logical-source',
		storageKey: 'linked-video-physical-storage',
		mimeType: 'video/mp4',
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
}
