import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createAudioEditorProjectV5 } from '../src/common/editor/project-v5.js';
import {
	SCAPE_FORMAT,
	exportScapeProject,
	importScapeProject,
} from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('scape archives round-trip mixed projects, original media, PCM, effects, and project-bin content', async () => {
	const sourceStore = memoryStore('scape-roundtrip-source');
	const targetStore = memoryStore('scape-roundtrip-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	await sourceStore.saveProject(project);

	const exported = await exportScapeProject(project, sourceStore);
	assert.equal(exported.manifest.format, SCAPE_FORMAT);
	assert.equal(exported.manifest.assets.length, 2);
	assert.ok(exported.blob.size > 0);

	const imported = await importScapeProject(exported.blob, targetStore);
	assert.equal(imported.project.id, project.id);
	assert.deepEqual(imported.project.clips.find((clip) => clip.kind === 'video').videoEffects, project.clips.find((clip) => clip.kind === 'video').videoEffects);
	assert.deepEqual(imported.project.opaqueExtensions, project.opaqueExtensions);
	assert.equal((await targetStore.loadMediaAsset('video-source')).size, 11);
	const audioChunks = [];
	for await (const channels of targetStore.readSourceChunks('audio-source')) audioChunks.push(channels);
	assert.deepEqual([...(audioChunks[0].channels || audioChunks[0])[0]], [0.25, -0.5, 0.75, 0]);
	assert.equal(imported.project.projectBin.clips[0].sourceId, 'video-source');

	const copied = await importScapeProject(exported.blob, targetStore, { collision: 'copy' });
	assert.notEqual(copied.project.id, project.id);
	assert.match(copied.project.title, /copy$/u);
	assert.notEqual(copied.project.sources[0].id, project.sources[0].id);
	for (const clip of [...copied.project.clips, ...copied.project.projectBin.clips]) {
		assert.ok(copied.project.sources.some((source) => source.id === clip.sourceId));
	}
});

test('scape imports reject checksum failures without publishing staged projects or sources', async () => {
	const sourceStore = memoryStore('scape-corrupt-source');
	const targetStore = memoryStore('scape-corrupt-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	await sourceStore.saveProject(project);
	const exported = await exportScapeProject(project, sourceStore);
	const corrupted = await rewriteManifest(exported.blob, (manifest) => {
		manifest.assets[1].sha256 = '0'.repeat(64);
	});

	await assert.rejects(() => importScapeProject(corrupted, targetStore), /SHA-256 verification/u);
	assert.deepEqual(await targetStore.listProjects(), []);
	assert.deepEqual(await targetStore.listSources(), []);
	assert.equal(await targetStore.getMediaAssetMetadata('video-source'), null);
});

test('scape imports roll back already staged media when a later source write is interrupted', async () => {
	const sourceStore = memoryStore('scape-interrupt-source');
	const backingStore = memoryStore('scape-interrupt-target');
	const project = mixedProject();
	project.sources.reverse();
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);
	const targetStore = new Proxy(backingStore, {
		get(target, property) {
			if (property === 'beginSourceWrite') return async (...args) => {
				const writer = await target.beginSourceWrite(...args);
				return {
					write: async () => { throw new Error('simulated interrupted import'); },
					commit: writer.commit.bind(writer),
					abort: writer.abort.bind(writer),
				};
			};
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(() => importScapeProject(exported.blob, targetStore));
	assert.deepEqual(await backingStore.listProjects(), []);
	assert.deepEqual(await backingStore.listSources(), []);
	assert.equal(await backingStore.getMediaAssetMetadata('video-source'), null);
});

function memoryStore(prefix) {
	return createProjectStore({ indexedDB: null, databaseName: `${prefix}-${Date.now()}-${Math.random()}` });
}

async function persistAssets(store) {
	const writer = await store.beginSourceWrite('audio-source', {
		name: 'sound.wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([new Float32Array([0.25, -0.5, 0.75, 0])]);
	await writer.commit();
	await store.writeMediaAsset('video-source', new Blob(['video-bytes'], { type: 'video/mp4' }), {
		name: 'picture.mp4',
		mimeType: 'video/mp4',
	});
}

function mixedProject() {
	return createAudioEditorProjectV5({
		id: 'mixed-scape-project',
		title: 'Mixed project',
		opaqueExtensions: { preserved: { value: 42 } },
		sources: [{
			kind: 'audio', id: 'audio-source', storageKey: 'audio-source', name: 'sound.wav', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}, {
			kind: 'video', id: 'video-source', storageKey: 'video-source', name: 'picture.mp4', mimeType: 'video/mp4',
			frameCount: 48_000, sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
			videoCodec: 'h264', audioCodec: null, hasAudio: false,
		}],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Picture', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
			videoEffects: [{ id: 'video-effect', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
		}, {
			kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Sound', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		}],
		tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }, {
			type: 'audio', id: 'audio-track', name: 'Audio', clipIds: ['audio-clip'],
		}],
		projectBin: { clips: [{
			kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin picture', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000, binItemId: 'bin-video',
			videoEffects: [{ id: 'bin-effect', type: 'vignette', enabled: true, params: { amount: 0.5 } }],
		}] },
	});
}

async function rewriteManifest(blob, mutate) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const entry of entries) {
		if (entry.filename === 'manifest.json') {
			const manifest = JSON.parse(await entry.getData(new TextWriter()));
			mutate(manifest);
			await writer.add(entry.filename, new TextReader(JSON.stringify(manifest)), { zip64: true, level: 0 });
		} else {
			await writer.add(entry.filename, (await entry.getData(new BlobWriter())).stream(), { zip64: true, level: 0 });
		}
	}
	await reader.close();
	return writer.close(undefined, { zip64: true });
}
