/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBinding,
} from '../src/common/editor/storage/linked-original-binding.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { LinkedOriginalProjectReachabilityRepository } from '../src/common/editor/storage/linked-original-project-reachability-repository.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-03T16:00:00.000Z';
const PROJECT_ID = 'provisional-root-reachability-project';
const SOURCE_ID = 'provisional-audio-source';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} two-store maintenance preserves a real repository bind until owner settlement`, async (context) => {
		const fixture = await createFixture(context, backend);
		await fixture.projects.save(project());
		const first = await fixture.bindings.putIfCurrent(bindingInput('locator_first_000000001'), null);
		assert.ok(first);
		const owner = ownerReference(first);

		const foreignResult = await fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [], []);
		assert.deepEqual(foreignResult?.settledTransientBindings, []);
		assert.ok(await fixture.foreignBindings.get(PROJECT_ID, SOURCE_ID));
		assert.ok(await readRoot(fixture));

		const ownerResult = await fixture.ownerReachability.pruneProjectBindings(PROJECT_ID, [], [owner]);
		assert.deepEqual(ownerResult?.settledTransientBindings, [owner]);
		assert.ok(await fixture.bindings.get(PROJECT_ID, SOURCE_ID), 'the exact-owner pass keeps the binding');
		assert.equal(await readRoot(fixture), undefined, 'the exact owner consumes its root');

		const followingResult = await fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [], []);
		assert.deepEqual(followingResult?.settledTransientBindings, []);
		assert.equal(await fixture.bindings.get(PROJECT_ID, SOURCE_ID), null);
	});

	test(`${backend} stale owner settlement cannot consume a replacement root`, async (context) => {
		const fixture = await createFixture(context, backend);
		await fixture.projects.save(project());
		const first = await fixture.bindings.putIfCurrent(bindingInput('locator_first_000000001'), null);
		assert.ok(first);
		const staleOwner = ownerReference(first);
		const replacement = await fixture.bindings.putIfCurrent(
			bindingInput('locator_second_00000001'),
			first.bindingToken,
		);
		assert.ok(replacement);

		const staleResult = await fixture.ownerReachability.pruneProjectBindings(PROJECT_ID, [], [staleOwner]);
		assert.deepEqual(staleResult?.settledTransientBindings, [staleOwner]);
		assert.equal(
			(await fixture.bindings.get(PROJECT_ID, SOURCE_ID))?.bindingToken,
			replacement.bindingToken,
		);
		assert.equal((await readRoot(fixture) as { bindingToken?: unknown })?.bindingToken, replacement.bindingToken);

		const replacementOwner = ownerReference(replacement);
		const replacementResult = await fixture.foreignReachability.pruneProjectBindings(
			PROJECT_ID,
			[],
			[replacementOwner],
		);
		assert.deepEqual(replacementResult?.settledTransientBindings, [replacementOwner]);
		assert.ok(await fixture.bindings.get(PROJECT_ID, SOURCE_ID));
		assert.equal(await readRoot(fixture), undefined);
	});
}

test('durable membership consumes a provisional root without an owner token', async (context) => {
	const fixture = await createFixture(context, 'memory');
	await fixture.projects.save(project(true));
	const binding = await fixture.bindings.putIfCurrent(bindingInput('locator_durable_00000001'), null);
	assert.ok(binding);

	const result = await fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [], []);

	assert.deepEqual(result?.durableSourceReferences, [{ kind: 'audio', sourceId: SOURCE_ID }]);
	assert.deepEqual(result?.settledTransientBindings, []);
	assert.ok(await fixture.bindings.get(PROJECT_ID, SOURCE_ID));
	assert.equal(await readRoot(fixture), undefined);
});

test('caller live roots protect a binding but do not consume its provisional root', async (context) => {
	const fixture = await createFixture(context, 'memory');
	await fixture.projects.save(project());
	const binding = await fixture.bindings.putIfCurrent(bindingInput('locator_caller_000000001'), null);
	assert.ok(binding);

	await fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [{
		kind: 'audio',
		sourceId: SOURCE_ID,
	}], []);

	assert.ok(await fixture.bindings.get(PROJECT_ID, SOURCE_ID));
	assert.ok(await readRoot(fixture));
});

test('valid orphan roots clean only after the complete binding inventory validates', async (context) => {
	const fixture = await createFixture(context, 'memory');
	await fixture.projects.save(project());
	const binding = await fixture.bindings.putIfCurrent(bindingInput('locator_orphan_000000001'), null);
	assert.ok(binding);
	const key = linkedOriginalBindingKey(PROJECT_ID, SOURCE_ID);
	fixture.memory.linkedVideoOriginalBindings.delete(key);
	fixture.memory.linkedVideoOriginalBindings.set('malformed-binding', { key: 'malformed-binding' });

	await assert.rejects(
		fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [], []),
		/linked original|stored binding/iu,
	);
	assert.ok(await readRoot(fixture), 'a later validation failure cannot partially clean the orphan');

	fixture.memory.linkedVideoOriginalBindings.delete('malformed-binding');
	await fixture.foreignReachability.pruneProjectBindings(PROJECT_ID, [], []);
	assert.equal(await readRoot(fixture), undefined);
});

interface Fixture {
	readonly database: IDBDatabase | null;
	readonly memory: EditorMemoryDatabase;
	readonly projects: ProjectRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly foreignBindings: LinkedOriginalRepository;
	readonly ownerReachability: LinkedOriginalProjectReachabilityRepository;
	readonly foreignReachability: LinkedOriginalProjectReachabilityRepository;
}

async function createFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
): Promise<Fixture> {
	const databaseName = `provisional-root-reachability-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	const foreignDatabase = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); foreignDatabase?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	const foreignPort: StorageRepositoryPort = { memory, database: async () => foreignDatabase };
	let token = 0;
	const repositoryOptions = {
		now: () => new Date(NOW),
		createBindingToken: () => {
			token += 1;
			return `provisional_binding_${String(token).padStart(8, '0')}`;
		},
	};
	return {
		database,
		memory,
		projects: new ProjectRepository(port, 20),
		bindings: new LinkedOriginalRepository(port, repositoryOptions),
		foreignBindings: new LinkedOriginalRepository(foreignPort, repositoryOptions),
		ownerReachability: new LinkedOriginalProjectReachabilityRepository(port),
		foreignReachability: new LinkedOriginalProjectReachabilityRepository(foreignPort),
	};
}

async function readRoot(fixture: Fixture): Promise<unknown> {
	const key = linkedOriginalBindingKey(PROJECT_ID, SOURCE_ID);
	if (!fixture.database) return fixture.memory.linkedOriginalProvisionalRoots.get(key);
	return transact(
		fixture.database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readonly',
		(stores) => request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].get(key)),
	);
}

function ownerReference(binding: LinkedOriginalBinding): Readonly<{
	kind: 'audio';
	sourceId: string;
	bindingToken: string;
}> {
	return Object.freeze({ kind: 'audio', sourceId: binding.sourceId, bindingToken: binding.bindingToken });
}

function bindingInput(locatorId: string) {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio' as const,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		storageKey: 'provisional-audio-storage',
		locatorId,
		locatorRevision: 'provisional_snapshot_0001',
		mimeType: 'audio/wav',
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: 120,
			channelCount: 2,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32' as const,
			chunkFrames: 65_536,
		},
	};
}

function project(rooted = false): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: SOURCE_ID,
		storageKey: 'provisional-audio-storage',
		mimeType: 'audio/wav',
		frameCount: 120,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'provisional-audio-clip',
		sourceId: source.id,
		durationFrames: 120,
		sourceDurationFrames: 120,
	});
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Provisional-root reachability',
		revision: 1,
		now: NOW,
		sources: rooted ? [source] : [],
		clips: rooted ? [clip] : [],
		tracks: rooted ? [createAudioTrack({ id: 'provisional-audio-track', clipIds: [clip.id] })] : [],
	});
}
