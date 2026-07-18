import test from 'node:test';
import assert from 'node:assert/strict';

import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';

test('memory storage persists immutable media assets and timestamped video derivatives', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-memory'),
	});
	const original = new Blob(['original-video'], { type: 'video/webm' });
	const metadata = await store.writeMediaAsset('video-source', original, {
		name: 'scene.webm',
		width: 1280,
		height: 720,
	});

	assert.equal(metadata.sourceId, 'video-source');
	assert.equal(metadata.storage, 'indexeddb-blob');
	assert.equal(metadata.mimeType, 'video/webm');
	assert.equal(metadata.name, 'scene.webm');
	assert.equal(metadata.size, original.size);
	assert.equal('blob' in metadata, false);
	assert.equal(await (await store.loadMediaAsset('video-source')).text(), 'original-video');
	assert.deepEqual(await store.getMediaAssetMetadata('video-source'), metadata);
	await assert.rejects(
		store.writeMediaAsset('video-source', new Blob(['replacement'])),
		/Immutable media asset video-source cannot be overwritten/,
	);

	await store.saveVideoDerivative('video-source', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['five'], { type: 'image/webp' }),
		metadata: { width: 160 },
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster'], { type: 'image/webp' }),
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'thumbnail',
		blob: new Blob(['zero'], { type: 'image/webp' }),
	});

	assert.deepEqual(
		(await store.listVideoDerivatives('video-source')).map(({ timestamp, type }) => [timestamp, type]),
		[[0, 'poster'], [0, 'thumbnail'], [5, 'thumbnail']],
	);
	assert.deepEqual(
		(await store.listVideoDerivatives('video-source', { type: 'thumbnail' })).map(({ timestamp }) => timestamp),
		[0, 5],
	);
	assert.equal(
		await (await store.loadVideoDerivative('video-source', { timestamp: 5, type: 'thumbnail' })).text(),
		'five',
	);

	await store.saveVideoDerivative('video-source', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['updated']),
	});
	assert.equal(
		await (await store.loadVideoDerivative('video-source', { timestamp: 5, type: 'thumbnail' })).text(),
		'updated',
	);
	await store.deleteVideoDerivative('video-source', { timestamp: 0, type: 'poster' });
	assert.equal(await store.loadVideoDerivative('video-source', { timestamp: 0, type: 'poster' }), null);
	assert.equal((await store.listVideoDerivatives('video-source')).length, 2);
});

test('media-only sources participate in project retention and cascade on source deletion', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-retention'),
	});
	await store.writeMediaAsset('retained-video', new Blob(['video']));
	await store.saveVideoDerivative('retained-video', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});
	await store.saveProject({
		id: 'video-project',
		revision: 1,
		updatedAt: '2026-07-18T00:00:00.000Z',
		sources: [{ id: 'retained-video' }],
		clips: [{ id: 'video-clip', sourceId: 'retained-video' }],
	});

	assert.equal((await store.getMediaAssetMetadata('retained-video')).pendingProjectUntil, undefined);
	let result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, []);

	await store.deleteProject('video-project');
	result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, ['retained-video']);
	assert.equal(await store.loadMediaAsset('retained-video'), null);
	assert.deepEqual(await store.listVideoDerivatives('retained-video'), []);

	await store.writeMediaAsset('media-only', new Blob(['video']));
	await store.saveVideoDerivative('media-only', {
		timestamp: 10,
		type: 'thumbnail',
		blob: new Blob(['ten']),
	});
	await store.deleteSource('media-only');
	assert.equal(await store.getMediaAssetMetadata('media-only'), null);
	assert.deepEqual(await store.listVideoDerivatives('media-only'), []);
});

test('deleting a media asset leaves PCM intact while deleting its media derivatives', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-pcm'),
	});
	const writer = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25, 0.5)]);
	await writer.commit();
	await store.writeMediaAsset('shared-source', new Blob(['container']));
	await store.saveVideoDerivative('shared-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});

	await store.deleteMediaAsset('shared-source');

	assert.equal(await store.getMediaAssetMetadata('shared-source'), null);
	assert.deepEqual(await store.listVideoDerivatives('shared-source'), []);
	assert.equal((await store.getSourceMetadata('shared-source')).frameCount, 2);
	assert.deepEqual([...((await store.readSourceChunk('shared-source', 0)).channels[0])], [0.25, 0.5]);
});

test('OPFS stores raw media and derivatives alongside PCM and cascades only requested files', async () => {
	const files = new Map();
	const sourceDirectory = createOpfsDirectory(files);
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: null,
		databaseName: uniqueDatabaseName('media-opfs'),
		storageManager: { async getDirectory() { return root; } },
	});
	const writer = await store.beginSourceWrite('opfs-media', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.5)]);
	await writer.commit();
	const media = await store.writeMediaAsset('opfs-media', new Blob(['container'], { type: 'video/mp4' }));
	const derivative = await store.saveVideoDerivative('opfs-media', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['thumbnail'], { type: 'image/webp' }),
	});

	assert.equal(media.storage, 'opfs');
	assert.equal(derivative.storage, 'opfs');
	assert.equal(files.size, 3);
	const loadedMedia = await store.loadMediaAsset('opfs-media');
	assert.equal(await loadedMedia.text(), 'container');
	assert.equal(loadedMedia.type, 'video/mp4');
	assert.equal(
		await (await store.loadVideoDerivative('opfs-media', { timestamp: 5, type: 'thumbnail' })).text(),
		'thumbnail',
	);

	await store.deleteMediaAsset('opfs-media');
	assert.equal(files.size, 1, 'the PCM file remains after deleting only the media asset');
	assert.equal((await store.getSourceMetadata('opfs-media')).storage, 'opfs');
	await store.deleteSource('opfs-media');
	assert.equal(files.size, 0);
});

function createOpfsDirectory(files) {
	return {
		async getFileHandle(path, options = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path);
			return {
				async createWritable() {
					const parts = [];
					return {
						async write(part) { parts.push(part); },
						async close() { entry.blob = new Blob(parts); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return entry.blob; },
			};
		},
		async removeEntry(path) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
}

function uniqueDatabaseName(prefix) {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
