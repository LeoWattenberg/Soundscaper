/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalProjectReachabilityRepository } from '../src/common/editor/storage/linked-original-project-reachability-repository.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-02T12:00:00.000Z';
const PROJECT_ID = 'linked-original-reachability-project';
const REVISION = 'locator_revision_00000001';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} retains exact audio and video roots and prunes both stale kinds`, async (context) => {
		const fixture = await createFixture(context, backend);
		const audio = audioSource('audio-live');
		const video = videoSource('video-live');
		const staleAudio = audioSource('audio-stale');
		const staleVideo = videoSource('video-stale');
		await fixture.projects.save(rootedProject(1, audio, video));
		for (const [index, source] of [audio, video, staleAudio, staleVideo].entries()) {
			await seedBinding(fixture, source, `locator_${source.kind}_${String(index).padStart(16, '0')}`);
		}

		const result = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);

		assert.deepEqual(result?.durableSourceReferences, [
			{ kind: 'audio', sourceId: audio.id },
			{ kind: 'video', sourceId: video.id },
		]);
		assert.deepEqual(result?.removedLocatorReferences, [
			{ kind: 'audio', locatorId: 'locator_audio_0000000000000002', locatorRevision: REVISION },
			{ kind: 'video', locatorId: 'locator_video_0000000000000003', locatorRevision: REVISION },
		]);
		assert.ok(await fixture.bindings.get(PROJECT_ID, audio.id));
		assert.ok(await fixture.bindings.get(PROJECT_ID, video.id));
		assert.equal(await fixture.bindings.get(PROJECT_ID, staleAudio.id), null);
		assert.equal(await fixture.bindings.get(PROJECT_ID, staleVideo.id), null);
	});
}

test('reachability keys roots and locator aliases by kind', async (context) => {
	const fixture = await createFixture(context, 'memory');
	const audio = audioSource('shared-source');
	await fixture.projects.save(rootedProject(1, audio));
	await seedBinding(fixture, videoSource('shared-source'), 'shared_locator_000000001');
	await seedBinding(fixture, audioSource('stale-audio'), 'same_locator_0000000001');
	await seedBinding(fixture, videoSource('stale-video'), 'same_locator_0000000001');

	const result = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);

	assert.deepEqual(result?.durableSourceReferences, [{ kind: 'audio', sourceId: 'shared-source' }]);
	assert.deepEqual(result?.removedLocatorReferences, [
		{ kind: 'audio', locatorId: 'same_locator_0000000001', locatorRevision: REVISION },
		{ kind: 'video', locatorId: 'same_locator_0000000001', locatorRevision: REVISION },
		{ kind: 'video', locatorId: 'shared_locator_000000001', locatorRevision: REVISION },
	]);
	assert.equal(await fixture.bindings.get(PROJECT_ID, 'shared-source'), null);
});

test('kindful caller roots protect only their exact binding kind', async (context) => {
	const fixture = await createFixture(context, 'memory');
	await fixture.projects.save(rootedProject(1));
	await seedBinding(fixture, audioSource('protected-source'), 'protected_audio_0000001');

	const protectedResult = await fixture.reachability.pruneProjectBindings(PROJECT_ID, [{
		kind: 'audio',
		sourceId: 'protected-source',
	}]);
	assert.deepEqual(protectedResult?.durableSourceReferences, []);
	assert.deepEqual(protectedResult?.removedLocatorReferences, []);

	const removed = await fixture.reachability.pruneProjectBindings(PROJECT_ID, [{
		kind: 'video',
		sourceId: 'protected-source',
	}]);
	assert.deepEqual(removed?.removedLocatorReferences, [{
		kind: 'audio',
		locatorId: 'protected_audio_0000001',
		locatorRevision: REVISION,
	}]);
});

test('a malformed unrelated mixed row rejects before any deletion', async (context) => {
	const fixture = await createFixture(context, 'memory');
	await fixture.projects.save(rootedProject(1));
	const stale = audioSource('stale-valid');
	await seedBinding(fixture, stale, 'stale_audio_0000000001');
	const unrelated = videoSource('unrelated');
	await seedBinding(fixture, unrelated, 'unrelated_video_000001', 'other-project');
	const key = linkedOriginalBindingKey('other-project', unrelated.id);
	const record = fixture.memory.linkedVideoOriginalBindings.get(key) as Record<string, unknown>;
	fixture.memory.linkedVideoOriginalBindings.set(key, { ...record, path: '/private/original.wav' });

	await assert.rejects(
		fixture.reachability.pruneProjectBindings(PROJECT_ID, []),
		/unsupported field|stored binding record/iu,
	);
	assert.ok(await fixture.bindings.get(PROJECT_ID, stale.id));
});

interface TestSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'audio' | 'video';
	readonly id: string;
}

interface Fixture {
	readonly port: StorageRepositoryPort;
	readonly projects: ProjectRepository;
	readonly reachability: LinkedOriginalProjectReachabilityRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly memory: EditorMemoryDatabase;
}

async function createFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
): Promise<Fixture> {
	const databaseName = `linked-original-reachability-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	let token = 0;
	return {
		port,
		projects: new ProjectRepository(port, 20),
		reachability: new LinkedOriginalProjectReachabilityRepository(port),
		bindings: new LinkedOriginalRepository(port, {
			now: () => new Date(NOW),
			createBindingToken: () => {
				token += 1;
				return `reachability_binding_${String(token).padStart(8, '0')}`;
			},
		}),
		memory,
	};
}

async function seedBinding(
	fixture: Fixture,
	source: TestSource,
	locatorId: string,
	projectId = PROJECT_ID,
): Promise<void> {
	const binding = await fixture.bindings.putIfCurrent(bindingInput(projectId, source, locatorId), null);
	assert.ok(binding);
}

function bindingInput(
	projectId: string,
	source: TestSource,
	locatorId: string,
): LinkedOriginalBindingInput {
	const shared = {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId: String(source.id),
		storageKey: String(source.storageKey),
		locatorId,
		locatorRevision: REVISION,
		mimeType: String(source.mimeType),
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
	};
	return source.kind === 'audio' ? {
		...shared,
		kind: 'audio',
		sourceShape: {
			frameCount: Number(source.frameCount),
			channelCount: Number(source.channelCount),
			sampleRate: Number(source.sampleRate),
			originalSampleRate: Number(source.originalSampleRate),
			sampleFormat: 'float32',
			chunkFrames: Number(source.chunkFrames),
		},
	} : {
		...shared,
		kind: 'video',
		sourceShape: {
			frameCount: Number(source.frameCount),
			sampleRate: Number(source.sampleRate),
			width: Number(source.width),
			height: Number(source.height),
			frameRate: Number(source.frameRate),
			videoCodec: String(source.videoCodec),
			audioCodec: source.audioCodec === null ? null : String(source.audioCodec),
			hasAudio: Boolean(source.hasAudio),
		},
	};
}

function rootedProject(
	revision: number,
	audio?: TestSource,
	video?: TestSource,
): AudioEditorProjectV9 {
	const audioClip = audio ? createAudioClipV9({
		id: 'audio-clip', sourceId: audio.id, durationFrames: 120, sourceDurationFrames: 120,
	}) : null;
	const videoClip = video ? createVideoClipV9({
		id: 'video-clip', sourceId: video.id, durationFrames: 120, sourceDurationFrames: 120,
	}) : null;
	return createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Linked original reachability',
		revision,
		now: NOW,
		sources: [audio, video].filter((source): source is TestSource => source !== undefined),
		clips: [audioClip, videoClip].filter((clip): clip is Record<string, unknown> => clip !== null),
		tracks: [
			...(audioClip ? [createAudioTrackV9({ id: 'audio-track', clipIds: [audioClip.id] })] : []),
			...(videoClip ? [createVideoTrackV9({ id: 'video-track', clipIds: [videoClip.id] })] : []),
		],
	});
}

function audioSource(id: string): TestSource {
	return createAudioSourceV9({
		id, storageKey: `${id}-storage`, mimeType: 'audio/wav', frameCount: 120,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	}) as TestSource;
}

function videoSource(id: string): TestSource {
	return createVideoSourceV9({
		id, storageKey: `${id}-storage`, mimeType: 'video/mp4', frameCount: 120,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
		videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
	}) as TestSource;
}
