/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBinding,
} from '../src/common/editor/storage/linked-original-binding.ts';
import {
	linkedOriginalProvisionalRoot,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import { LinkedOriginalStartupReconciliationRepository } from '../src/common/editor/storage/linked-original-startup-reconciliation-repository.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-03T17:00:00.000Z';
const SOURCE_ID = 'startup-rooted-audio';

test('startup retains a catalog-live provisional pair and durable membership consumes its root', async (context) => {
	const fixture = await createFixture(context, 'startup-root-live');
	await fixture.projects.save(project(fixture.projectId, 1));
	const binding = await seedRootedBinding(fixture, 'audio');

	const rootedReferences = await fixture.startup.reconcileDurableLocatorReferences([
		{ id: fixture.projectId, revision: 1 },
	]);
	assert.deepEqual(rootedReferences, [{
		kind: 'audio',
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
	}]);
	assert.ok(await fixture.bindings.get(fixture.projectId, SOURCE_ID));
	assert.ok(await readRoot(fixture, SOURCE_ID));

	await fixture.projects.save(project(fixture.projectId, 2, true));
	await fixture.startup.reconcileDurableLocatorReferences([{ id: fixture.projectId, revision: 2 }]);
	assert.ok(await fixture.bindings.get(fixture.projectId, SOURCE_ID));
	assert.equal(await readRoot(fixture, SOURCE_ID), undefined);
});

test('startup catalog absence removes an exact binding/root pair atomically', async (context) => {
	const fixture = await createFixture(context, 'startup-root-absent');
	await fixture.projects.save(project(fixture.projectId, 1));
	await seedRootedBinding(fixture, 'audio');

	assert.deepEqual(await fixture.startup.reconcileDurableLocatorReferences([]), []);
	assert.equal(await fixture.bindings.get(fixture.projectId, SOURCE_ID), null);
	assert.equal(await readRoot(fixture, SOURCE_ID), undefined);
});

test('video-only startup validates but preserves a catalog-live audio pair', async (context) => {
	const fixture = await createFixture(context, 'startup-root-video-only');
	await fixture.projects.save(project(fixture.projectId, 1));
	await seedRootedBinding(fixture, 'audio');

	assert.deepEqual(await fixture.startup.reconcileDurableVideoLocatorReferences([
		{ id: fixture.projectId, revision: 1 },
	]), []);
	assert.ok(await fixture.bindings.get(fixture.projectId, SOURCE_ID));
	assert.ok(await readRoot(fixture, SOURCE_ID));
});

test('startup validates every root before deleting an unreachable binding', async (context) => {
	const fixture = await createFixture(context, 'startup-root-malformed');
	await fixture.projects.save(project(fixture.projectId, 1));
	const binding = await fixture.bindings.putIfCurrent(bindingInput(fixture.projectId, 'audio'), null);
	assert.ok(binding);
	await transact(
		fixture.database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readwrite',
		(stores) => request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].put({
			...linkedOriginalProvisionalRoot(binding),
			bindingToken: 'different_binding_00000001',
		})).then(() => undefined),
	);

	await assert.rejects(
		fixture.startup.reconcileDurableLocatorReferences([{ id: fixture.projectId, revision: 1 }]),
		/does not match its extant binding generation/iu,
	);
	assert.ok(await fixture.bindings.get(fixture.projectId, SOURCE_ID));
});

interface Fixture {
	readonly projectId: string;
	readonly database: IDBDatabase;
	readonly projects: ProjectRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly startup: LinkedOriginalStartupReconciliationRepository;
}

async function createFixture(context: TestContext, label: string): Promise<Fixture> {
	const projectId = `${label}-project`;
	const databaseName = `${label}-${Date.now()}-${Math.random()}`;
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(databaseName),
		database: async () => database,
	};
	return {
		projectId,
		database,
		projects: new ProjectRepository(port, 20),
		bindings: new LinkedOriginalRepository(port, {
			now: () => new Date(NOW),
			createBindingToken: () => `${label}_binding_00000001`,
		}),
		startup: new LinkedOriginalStartupReconciliationRepository(port),
	};
}

async function seedRootedBinding(fixture: Fixture, kind: 'audio'): Promise<LinkedOriginalBinding> {
	const binding = await fixture.bindings.putIfCurrent(bindingInput(fixture.projectId, kind), null);
	assert.ok(binding);
	await transact(
		fixture.database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readwrite',
		(stores) => request(
			stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].put(linkedOriginalProvisionalRoot(binding)),
		).then(() => undefined),
	);
	return binding;
}

async function readRoot(fixture: Fixture, sourceId: string): Promise<unknown> {
	return transact(
		fixture.database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readonly',
		(stores) => request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].get(
			linkedOriginalBindingKey(fixture.projectId, sourceId),
		)),
	);
}

function bindingInput(projectId: string, kind: 'audio') {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind,
		projectId,
		sourceId: SOURCE_ID,
		storageKey: `${projectId}-audio-storage`,
		locatorId: `${projectId}_locator_00000001`,
		locatorRevision: 'startup_root_revision_01',
		mimeType: 'audio/wav',
		byteLength: 65_536,
		sha256: 'cd'.repeat(32),
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

function project(projectId: string, revision: number, rooted = false): AudioEditorProjectV9 {
	const source = createAudioSourceV9({
		id: SOURCE_ID,
		storageKey: `${projectId}-audio-storage`,
		mimeType: 'audio/wav',
		frameCount: 120,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	});
	const clip = createAudioClipV9({
		id: `${projectId}-clip`,
		sourceId: source.id,
		durationFrames: 120,
		sourceDurationFrames: 120,
	});
	return createAudioEditorProjectV9({
		id: projectId,
		title: 'Startup provisional root',
		revision,
		now: NOW,
		sources: rooted ? [source] : [],
		clips: rooted ? [clip] : [],
		tracks: rooted ? [createAudioTrackV9({ id: `${projectId}-track`, clipIds: [clip.id] })] : [],
	});
}
