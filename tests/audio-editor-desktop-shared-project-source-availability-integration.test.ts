/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DesktopSharedProjectRepository,
	type DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';

const PRIOR_NOW = '2026-07-29T12:00:00.000Z';
const LATEST_NOW = '2026-07-30T12:00:00.000Z';

test('real desktop store adapters admit bound, readable recipient audio and video', async (context) => {
	const databaseName = `shared-source-availability-${Date.now()}-${Math.random()}`;
	const local = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName });
	context.after(async () => { await local.close(); });
	const audio = createAudioSource({
		id: 'logical-bound-audio',
		storageKey: 'physical-bound-audio',
		name: 'Bound audio.wav',
		mimeType: 'audio/wav',
		frameCount: 3,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	});
	const video = createVideoSource({
		id: 'logical-bound-video',
		storageKey: 'physical-bound-video',
		name: 'Bound video.mp4',
		mimeType: 'video/mp4',
		frameCount: 48,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: 30,
		videoCodec: 'h264',
		hasAudio: false,
	});
	const audioClip = createAudioClip({
		id: 'bound-audio-clip', sourceId: audio.id, durationFrames: 3,
	});
	const videoBinClip = createVideoClip({
		id: 'bound-video-bin-clip',
		sourceId: video.id,
		durationFrames: 48,
		binItemId: 'bound-video-bin-item',
	});
	const project = (revision: number, now: string) => createCurrentAudioEditorProject({
		id: 'bound-mixed-project',
		title: 'Bound mixed project',
		revision,
		now,
		sources: [audio, video],
		clips: [audioClip],
		tracks: [createAudioTrack({ id: 'bound-audio-track', clipIds: [audioClip.id] })],
		projectBin: { clips: [videoBinClip] },
	});

	const writer = await local.beginSourceWrite(audio.storageKey, {
		name: audio.name,
		mimeType: audio.mimeType,
		sampleRate: audio.sampleRate,
		channelCount: audio.channelCount,
		chunkFrames: audio.chunkFrames,
	});
	await writer.write([Float32Array.of(0.1, 0.2), Float32Array.of(0.3, 0.4)]);
	await writer.write([Float32Array.of(0.5), Float32Array.of(0.6)]);
	await writer.commit();
	const videoBody = new Blob(['recipient-local video bytes'], { type: video.mimeType });
	await local.writeMediaAsset(video.storageKey, videoBody, {
		name: video.name,
		mimeType: video.mimeType,
	});
	const prior = project(1, PRIOR_NOW);
	await local.saveProject(prior);
	await local.close();

	const latest = project(2, LATEST_NOW);
	const document = serializeScapeProjectDocument(latest);
	let remoteReads = 0;
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => [],
		readSharedProject: async (projectId) => {
			assert.equal(projectId, latest.id);
			remoteReads += 1;
			return document;
		},
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
	};
	const shared = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName,
		desktopProjectBridge: bridge,
	});
	context.after(async () => { await shared.close(); });

	assert.deepEqual(await shared.loadProject(latest.id), latest);
	assert.equal(remoteReads, 1);
	assert.deepEqual(
		(await shared.listProjectRevisions(latest.id)).map(({ revision }) => revision),
		[2, 1],
	);
	const prune = await shared.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1_000,
	});
	assert.deepEqual(prune.deletedSourceIds, []);
	assert.ok(prune.retainedSourceIds.includes(audio.storageKey));
	assert.ok(prune.retainedSourceIds.includes(video.storageKey));
	assert.ok(await shared.getSourceMetadata(audio.storageKey));
	const videoMetadata = await shared.getMediaAssetMetadata(video.storageKey);
	assert.match(String(videoMetadata?.sha256), /^[0-9a-f]{64}$/u);
});

test('digestless recipient video rejects before body read without changing the prior revision', async () => {
	const source = createVideoSource({
		id: 'digestless-logical-video',
		storageKey: 'digestless-physical-video',
		name: 'Digestless video.mp4',
		mimeType: 'video/mp4',
		frameCount: 1,
		sampleRate: 48_000,
		width: 1,
		height: 1,
		frameRate: 30,
		videoCodec: 'h264',
		hasAudio: false,
	});
	const clip = createVideoClip({
		id: 'digestless-video-clip',
		sourceId: source.id,
		durationFrames: 1,
		binItemId: 'digestless-video-bin-item',
	});
	const project = (revision: number) => createCurrentAudioEditorProject({
		id: 'digestless-shared-project',
		title: 'Digestless shared project',
		revision,
		now: revision === 1 ? PRIOR_NOW : LATEST_NOW,
		sources: [source],
		projectBin: { clips: [clip] },
	});
	const local = new ProjectRepository({
		memory: getMemoryDatabase(`digestless-shared-load-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, 5);
	const prior = project(1);
	const latest = project(2);
	await local.save(prior);
	let bodyReads = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: {
			async getSourceMetadata() { throw new Error('unexpected audio metadata read'); },
			readSourceChunks() { throw new Error('unexpected audio body read'); },
			async getMediaAssetMetadata(sourceId) {
				assert.equal(sourceId, source.storageKey);
				return {
					sourceId: source.storageKey,
					storage: 'indexeddb-blob',
					committedAt: PRIOR_NOW,
					mimeType: source.mimeType,
					size: 12,
				};
			},
			async loadMediaAsset() {
				bodyReads += 1;
				return new Blob(['video bytes'], { type: source.mimeType });
			},
		},
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => serializeScapeProjectDocument(latest),
			commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
			deleteSharedProject: async () => true,
		},
	});

	await assert.rejects(repository.load(latest.id), /recipient-local video source/iu);
	assert.equal(bodyReads, 0);
	assert.deepEqual(await local.load(prior.id), prior);
	assert.deepEqual((await local.listRevisions(prior.id)).map(({ revision }) => revision), [1]);
});

test('repository cancellation abandons stalled PCM cleanup without changing the prior revision', async () => {
	const source = createAudioSource({
		id: 'cancelled-logical-audio',
		storageKey: 'cancelled-physical-audio',
		frameCount: 1,
		channelCount: 1,
		chunkFrames: 1,
	});
	const clip = createAudioClip({ id: 'cancelled-clip', sourceId: source.id, durationFrames: 1 });
	const project = (revision: number) => createCurrentAudioEditorProject({
		id: 'cancelled-shared-project',
		title: 'Cancelled shared project',
		revision,
		now: revision === 1 ? PRIOR_NOW : LATEST_NOW,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrack({ id: 'cancelled-track', clipIds: [clip.id] })],
	});
	const local = new ProjectRepository({
		memory: getMemoryDatabase(`cancelled-shared-load-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, 5);
	const prior = project(1);
	const latest = project(2);
	await local.save(prior);
	const readStarted = deferred<void>();
	const never = deferred<void>();
	const iterator: AsyncIterableIterator<Readonly<{
		index: number;
		frames: number;
		channels: readonly Float32Array[];
	}>> = {
		async next() {
			readStarted.resolve();
			await never.promise;
			return { done: true, value: undefined };
		},
		async return() {
			await never.promise;
			return { done: true, value: undefined };
		},
		[Symbol.asyncIterator]() { return iterator; },
	};
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: {
			async getSourceMetadata() {
				return {
					id: source.storageKey,
					storage: 'indexeddb-chunks',
					sourceToken: 'cancelled-generation',
					committedAt: PRIOR_NOW,
					frameCount: 1,
					channelCount: 1,
					sampleRate: source.sampleRate,
					chunkFrames: 1,
					chunkCount: 1,
				};
			},
			readSourceChunks() { return iterator; },
			async getMediaAssetMetadata() { throw new Error('unexpected video metadata read'); },
			async loadMediaAsset() { throw new Error('unexpected video body read'); },
		},
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => serializeScapeProjectDocument(latest),
			commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
			deleteSharedProject: async () => true,
		},
	});
	const controller = new AbortController();
	const reason = new Error('cancel shared recipient read');
	const loading = repository.load(latest.id, { signal: controller.signal });
	await readStarted.promise;
	controller.abort(reason);

	await assert.rejects(loading, (error: unknown) => error === reason);
	assert.deepEqual(await local.load(prior.id), prior);
	assert.deepEqual((await local.listRevisions(prior.id)).map(({ revision }) => revision), [1]);
});

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
