import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MockAudioBuffer,
} from './helpers/mock-audio-context.js';

test('memory project store retains revisions and streams immutable source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `test-${Date.now()}-${Math.random()}` });
	assert.equal(store.backend, 'memory');
	await store.saveProject({ id: 'project-1', title: 'First', revision: 1, updatedAt: '2026-01-01' });
	await store.saveProject({ id: 'project-1', title: 'Second', revision: 2, updatedAt: '2026-01-02' });
	assert.equal((await store.loadProject('project-1')).title, 'Second');
	assert.equal((await store.loadProject('project-1', { revision: 1 })).title, 'First');
	assert.deepEqual((await store.listProjectRevisions('project-1')).map((entry) => entry.revision), [2, 1]);

	await store.saveSetting('monitor', false);
	await store.saveAnalysis('mix:1', { lufs: -14 });
	assert.equal(await store.loadSetting('monitor', true), false);
	assert.deepEqual(await store.loadAnalysis('mix:1'), { lufs: -14 });

	const writer = await store.beginSourceWrite('source-1', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0, 0.5), Float32Array.of(1, -1)]);
	await writer.write([Float32Array.of(0.25), Float32Array.of(-0.25)]);
	const metadata = await writer.commit({ name: 'take.wav' });
	assert.equal(metadata.storage, 'indexeddb-chunks');
	assert.equal(metadata.frameLength, 3);
	assert.equal(metadata.channelCount, 2);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('source-1')) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [2, 1]);
	assert.deepEqual([...chunks[0].channels[1]], [1, -1]);
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['source-1']);
	const restored = await store.loadSourceAudioBuffer('source-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.deepEqual([...restored.getChannelData(0)], [0, 0.5, 0.25]);

	const abandoned = await store.beginSourceWrite('source-2');
	await abandoned.write([Float32Array.of(1)]);
	await abandoned.abort();
	assert.equal(await store.getSourceMetadata('source-2'), null);

	const copy = await store.duplicateProject('project-1', { id: 'project-2', title: 'Copy' });
	assert.equal(copy.id, 'project-2');
	assert.equal((await store.listProjects()).length, 2);
	await store.deleteSource('source-1');
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('source-1')) { /* consume */ }
	}, /could not be found/);
	await store.clear();
	assert.deepEqual(await store.listProjects(), []);
});

test('copy-on-write sources share untouched chunks and retain base dependencies through garbage collection', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `copy-on-write-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite('cow-base', {
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	await writer.write([Float32Array.from({ length: 65_536 }, (_, frame) => frame / 65_536)]);
	await writer.write([Float32Array.of(0.25, 0.5)]);
	await writer.commit({ chunkFrames: 65_536 });

	const replacement = Float32Array.from({ length: 65_536 }, () => -0.5);
	const derived = await store.writeDerivedSource('cow-derived', 'cow-base', [
		{ index: 0, channels: [replacement] },
	], { sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 });
	assert.equal(derived.storage, 'copy-on-write');
	assert.equal(derived.overrideChunkCount, 1);
	assert.equal(derived.baseSourceId, 'cow-base');

	const chunks = [];
	for await (const chunk of store.readSourceChunks('cow-derived')) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [65_536, 2]);
	assert.equal(chunks[0].channels[0][100], -0.5);
	assert.deepEqual([...chunks[1].channels[0]], [0.25, 0.5]);
	await assert.rejects(() => store.deleteSource('cow-base'), /retained by derived source cow-derived/);

	const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
	let result = await store.pruneUnreferencedSources({
		protectedProjects: [{ schemaFamily: 'soundscaper', schemaVersion: 1, clips: [{ sourceId: 'cow-derived' }] }],
		minimumAgeMs: 0,
		now: future,
	});
	assert.deepEqual(result.deletedSourceIds, []);
	assert.deepEqual(new Set(result.retainedSourceIds), new Set(['cow-base', 'cow-derived']));

	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: future });
	assert.deepEqual(new Set(result.deletedSourceIds), new Set(['cow-base', 'cow-derived']));
	assert.equal(await store.getSourceMetadata('cow-base'), null);
	assert.equal(await store.getSourceMetadata('cow-derived'), null);
});

test('project store bounds durable manifest revisions while retaining recovery history', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `revision-limit-${Date.now()}-${Math.random()}`, revisionLimit: 4 });
	for (let revision = 0; revision < 7; revision += 1) {
		await store.saveProject({ id: 'bounded', revision, updatedAt: `2026-01-${String(revision + 1).padStart(2, '0')}` });
	}
	assert.deepEqual((await store.listProjectRevisions('bounded')).map((entry) => entry.revision), [6, 5, 4, 3]);
});

test('source pruning preserves live history and retained revisions before removing metadata, peaks, and chunks', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-retention-${Date.now()}-${Math.random()}`,
		revisionLimit: 2,
	});
	const sourceIds = ['original', 'effect-1', 'effect-2', 'abandoned'];
	for (const sourceId of sourceIds) {
		const writer = await store.beginSourceWrite(sourceId, { sampleRate: 48_000, name: `${sourceId}.wav` });
		await writer.write([Float32Array.of(0.1, 0.2)]);
		await writer.commit();
		await store.saveAnalysis(`audio-editor-peaks-v1:${sourceId}`, { levels: [sourceId] });
		await store.saveAnalysis(`audio-editor-peaks-v2:${sourceId}`, { levels: [sourceId] });
	}
	const project = (revision, sourceId, extraSources = []) => ({
		id: 'retained-project', schemaFamily: 'soundscaper', schemaVersion: 1,
		revision,
		updatedAt: `2026-07-13T00:00:0${revision}.000Z`,
		sources: [sourceId, ...extraSources].map((id) => ({ id, frameCount: 2, channelCount: 1 })),
		clips: [{ id: `clip-${revision}`, sourceId }],
	});
	const pruneNow = Date.now() + 2 * 24 * 60 * 60 * 1000;

	await store.saveProject(project(1, 'original', ['abandoned']));
	await store.saveProject(project(2, 'effect-1'));
	assert.equal((await store.getSourceMetadata('original')).pendingProjectUntil, undefined);
	assert.equal((await store.getSourceMetadata('effect-1')).pendingProjectUntil, undefined);
	assert.equal(typeof (await store.getSourceMetadata('effect-2')).pendingProjectUntil, 'string');
	let result = await store.pruneUnreferencedSources({
		protectedProjects: [project(3, 'effect-2')],
		minimumAgeMs: 0,
		now: pruneNow,
	});
	assert.deepEqual(result.deletedSourceIds, ['abandoned']);
	assert.equal(await store.getSourceMetadata('original') != null, true);
	assert.equal(await store.getSourceMetadata('effect-1') != null, true);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.equal(await store.getSourceMetadata('abandoned'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:abandoned'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v2:abandoned'), null);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 1 })).sources.map((source) => source.id), ['original']);

	await store.saveProject(project(3, 'effect-2'));
	assert.deepEqual((await store.listProjectRevisions('retained-project')).map((entry) => entry.revision), [3, 2]);
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['original']);
	assert.equal(await store.getSourceMetadata('original'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:original'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v2:original'), null);
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('original')) { /* consume */ }
	}, /could not be found/);
	const retainedRevision = await store.loadProject('retained-project', { revision: 2 });
	assert.deepEqual(retainedRevision.sources.map((source) => source.id), ['effect-1']);
	const retainedAudio = await store.loadSourceAudioBuffer('effect-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.equal(retainedAudio.length, 2);

	await store.saveProject(project(4, 'effect-2'));
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['effect-1']);
	assert.equal(await store.getSourceMetadata('effect-1'), null);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 3 })).sources.map((source) => source.id), ['effect-2']);
});

test('source pruning durably protects unpublished sources and reports when abandoned writes become eligible', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-grace-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite('fresh-orphan', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25)]);
	const metadata = await writer.commit();
	const pendingProjectUntil = Date.parse(metadata.pendingProjectUntil);
	let result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil - 1 });
	assert.deepEqual(result.deletedSourceIds, []);
	assert.deepEqual(result.deferredSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, pendingProjectUntil);
	assert.equal(await store.getSourceMetadata('fresh-orphan') != null, true);

	result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil });
	assert.deepEqual(result.deletedSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, null);
	assert.equal(await store.getSourceMetadata('fresh-orphan'), null);
});

test('project store prefers OPFS for bounded source writes when it is available', async () => {
	const files = new Map();
	const sourceDirectory = {
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
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `opfs-${Date.now()}-${Math.random()}`,
		storageManager: { async getDirectory() { return root; } },
	});
	const writer = await store.beginSourceWrite('opfs-source', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0.1, 0.2)]);
	await writer.write([Float32Array.of(0.3)]);
	const metadata = await writer.commit();
	assert.equal(metadata.storage, 'opfs-pcm-v1');
	assert.match(metadata.path, /\.scpcm$/);
	assert.equal(metadata.pcmEncodingVersion, 1);
	assert.equal(files.size, 1);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('opfs-source')) chunks.push([...chunk.channels[0]]);
	assert.ok(Math.abs(chunks[0][0] - 0.1) < 1e-6);
	assert.ok(Math.abs(chunks[1][0] - 0.3) < 1e-6);
	await store.deleteSource('opfs-source');
	assert.equal(files.size, 0);
});

test('project store writes AudioBuffers in bounded source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `buffer-${Date.now()}-${Math.random()}` });
	const buffer = new MockAudioBuffer(1, 5, 48000);
	buffer.getChannelData(0).set([1, 2, 3, 4, 5]);
	const metadata = await store.writeAudioBuffer('buffer-source', buffer, { name: 'buffer' }, { chunkFrames: 2 });
	assert.equal(metadata.chunkCount, 3);
	const frames = [];
	for await (const chunk of store.readSourceChunks('buffer-source')) frames.push(chunk.frames);
	assert.deepEqual(frames, [2, 2, 1]);
});

test('project store demand-loads one immutable chunk and records its fixed layout', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `runtime-random-chunk-${Date.now()}` });
	const writer = await store.beginSourceWrite('stream-source', { sampleRate: 48_000, channelCount: 1 });
	await writer.write([new Float32Array(65_536).fill(0.25)]);
	await writer.write([Float32Array.of(0.5, 0.75)]);
	const metadata = await writer.commit();
	assert.equal(metadata.chunkFrames, 65_536);
	assert.equal(metadata.chunkCount, 2);
	const second = await store.readSourceChunk('stream-source', 1);
	assert.equal(second.index, 1);
	assert.equal(second.frames, 2);
	assert.deepEqual([...second.channels[0]], [0.5, 0.75]);
	assert.notEqual(second.channels[0].buffer, (await store.readSourceChunk('stream-source', 1)).channels[0].buffer);
	await assert.rejects(store.readSourceChunk('stream-source', 2), /does not exist/);
});
