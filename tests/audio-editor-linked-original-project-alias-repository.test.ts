/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBinding,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalProjectAliasRepository } from '../src/common/editor/storage/linked-original-project-alias-repository.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import type { LinkedOriginalSource } from '../src/common/editor/storage/linked-original-resolver.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const SOURCE_PROJECT_ID = 'generic-alias-source-project';
const DESTINATION_PROJECT_ID = 'generic-alias-destination-project';
const SEED_NOW = '2026-08-02T10:00:00.000Z';
const ALIAS_NOW = '2026-08-02T11:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} copies reachable audio and video as independent exact aliases`, async (context) => {
		const fixture = await createFixture(context, backend);
		const audio = audioSource('audio-source');
		const video = videoSource('video-source');
		const stale = audioSource('stale-source');
		const originals = await Promise.all([
			seedBinding(fixture, audio, 'audio_locator_000000001', 'audio_revision_00000001'),
			seedBinding(fixture, video, 'video_locator_000000001', 'video_revision_00000001'),
			seedBinding(fixture, stale, 'stale_locator_000000001', 'stale_revision_00000001'),
		]);

		const aliases = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[audio, video],
		);

		assert.equal(Object.isFrozen(aliases), true);
		assert.deepEqual(aliases.map(({ kind, sourceId }) => ({ kind, sourceId })), [
			{ kind: 'audio', sourceId: audio.id },
			{ kind: 'video', sourceId: video.id },
		]);
		for (const [index, alias] of aliases.entries()) {
			const original = originals[index];
			assert.deepEqual(sharedFields(alias), sharedFields(original));
			assert.equal(alias.projectId, DESTINATION_PROJECT_ID);
			assert.notEqual(alias.bindingToken, original.bindingToken);
			assert.equal(alias.boundAt, ALIAS_NOW);
			assert.deepEqual(await fixture.bindings.get(
				DESTINATION_PROJECT_ID,
				alias.sourceId,
			), alias);
		}
		assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, stale.id), null);
	});
}

test('same opaque locator identity remains independent across media kinds', async (context) => {
	const fixture = await createFixture(context, 'memory');
	const audio = audioSource('audio-shared-locator');
	const video = videoSource('video-shared-locator');
	await seedBinding(fixture, audio, 'shared_locator_000000001', 'audio_revision_00000001');
	await seedBinding(fixture, video, 'shared_locator_000000001', 'video_revision_00000001');

	const aliases = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[audio, video],
	);

	assert.equal(aliases.length, 2);
	assert.deepEqual(aliases.map(({ kind, locatorRevision }) => ({ kind, locatorRevision })), [
		{ kind: 'audio', locatorRevision: 'audio_revision_00000001' },
		{ kind: 'video', locatorRevision: 'video_revision_00000001' },
	]);
});

test('rollback rechecks every alias fence before deleting any mixed row', async (context) => {
	const fixture = await createFixture(context, 'memory');
	const audio = audioSource('audio-rollback');
	const video = videoSource('video-rollback');
	await seedBinding(fixture, audio, 'audio_rollback_00000001', 'audio_revision_00000001');
	await seedBinding(fixture, video, 'video_rollback_00000001', 'video_revision_00000001');
	const aliases = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[audio, video],
	);
	const replacement = await fixture.bindings.putIfCurrent(
		bindingInputFrom(aliases[1]),
		aliases[1].bindingToken,
	);
	assert.ok(replacement);

	await assert.rejects(fixture.aliases.rollbackAliases(aliases), /replaced|token.*match/iu);
	assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, audio.id), aliases[0]);
	assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, video.id), replacement);
});

test('complete mixed inventory validation happens before alias publication', async (context) => {
	const fixture = await createFixture(context, 'memory');
	const audio = audioSource('audio-live');
	const video = videoSource('video-malformed');
	await seedBinding(fixture, audio, 'audio_live_000000000001', 'audio_revision_00000001');
	await seedBinding(
		fixture,
		video,
		'video_malformed_0000001',
		'video_revision_00000001',
		'unrelated-project',
	);
	const record = [...fixture.memory.linkedVideoOriginalBindings.entries()]
		.find(([, value]) => (value as { projectId?: unknown }).projectId === 'unrelated-project');
	assert.ok(record);
	fixture.memory.linkedVideoOriginalBindings.set(record[0], { ...record[1] as object, path: '/private/video.mp4' });

	await assert.rejects(
		fixture.aliases.copyReachableAliases(SOURCE_PROJECT_ID, DESTINATION_PROJECT_ID, [audio]),
		/unsupported field|stored binding record/iu,
	);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, audio.id), null);
});

interface Fixture {
	readonly aliases: LinkedOriginalProjectAliasRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly memory: EditorMemoryDatabase;
}

async function createFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
): Promise<Fixture> {
	const databaseName = `linked-original-alias-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	let seedToken = 0;
	let aliasToken = 0;
	return {
		aliases: new LinkedOriginalProjectAliasRepository(port, {
			now: () => new Date(ALIAS_NOW),
			createBindingToken: () => {
				aliasToken += 1;
				return `alias_binding_${String(aliasToken).padStart(8, '0')}`;
			},
		}),
		bindings: new LinkedOriginalRepository(port, {
			now: () => new Date(SEED_NOW),
			createBindingToken: () => {
				seedToken += 1;
				return `seed_binding_${String(seedToken).padStart(8, '0')}`;
			},
		}),
		memory,
	};
}

async function seedBinding(
	fixture: Fixture,
	source: LinkedOriginalSource,
	locatorId: string,
	locatorRevision: string,
	projectId = SOURCE_PROJECT_ID,
): Promise<LinkedOriginalBinding> {
	const binding = await fixture.bindings.putIfCurrent(
		bindingInput(projectId, source, locatorId, locatorRevision),
		null,
	);
	assert.ok(binding);
	return binding;
}

function bindingInput(
	projectId: string,
	source: LinkedOriginalSource,
	locatorId: string,
	locatorRevision: string,
): LinkedOriginalBindingInput {
	const shared = {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		locatorId,
		locatorRevision,
		mimeType: source.mimeType,
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
	};
	return source.kind === 'audio' ? {
		...shared,
		kind: 'audio',
		sourceShape: {
			frameCount: source.frameCount,
			channelCount: source.channelCount,
			sampleRate: source.sampleRate,
			originalSampleRate: source.originalSampleRate,
			sampleFormat: source.sampleFormat,
			chunkFrames: source.chunkFrames,
		},
	} : {
		...shared,
		kind: 'video',
		sourceShape: {
			frameCount: source.frameCount,
			sampleRate: source.sampleRate,
			width: source.width,
			height: source.height,
			frameRate: source.frameRate,
			videoCodec: source.videoCodec,
			audioCodec: source.audioCodec,
			hasAudio: source.hasAudio,
		},
	};
}

function bindingInputFrom(binding: LinkedOriginalBinding): LinkedOriginalBindingInput {
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding;
	return input;
}

function audioSource(id: string): LinkedOriginalSource {
	return {
		kind: 'audio', id, storageKey: `${id}-storage`, mimeType: 'audio/wav',
		frameCount: 120, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	};
}

function videoSource(id: string): LinkedOriginalSource {
	return {
		kind: 'video', id, storageKey: `${id}-storage`, mimeType: 'video/mp4',
		frameCount: 120, sampleRate: 48_000, width: 1_920, height: 1_080,
		frameRate: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
	};
}

function sharedFields(binding: LinkedOriginalBinding): object {
	return {
		kind: binding.kind,
		sourceId: binding.sourceId,
		storageKey: binding.storageKey,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		mimeType: binding.mimeType,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
		sourceShape: binding.sourceShape,
	};
}
