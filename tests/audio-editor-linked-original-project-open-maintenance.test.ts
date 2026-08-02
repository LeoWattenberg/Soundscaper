/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
} from '../src/common/editor/project-v9.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DesktopSharedProjectRepository,
	type DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import { LinkedOriginalLifecycleCoordinator } from '../src/common/editor/storage/linked-original-lifecycle-coordinator.ts';
import { maintainOpenedProjectWithLinkedOriginalReachability } from '../src/common/editor/storage/linked-original-project-open-maintenance.ts';
import type { LinkedOriginalProjectReachabilityRepository } from '../src/common/editor/storage/linked-original-project-reachability-repository.ts';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'linked-original-open-maintenance-project';
const ALIAS_PROJECT_ID = 'linked-original-open-maintenance-alias';
const LOCATOR_ID = 'locator_open_maintenance_000001';
const LOCATOR_REVISION = 'revision_open_maintenance_0001';
const NOW = '2026-08-03T00:00:00.000Z';

test('durable open maintenance protects live roots, prunes stale bindings, and preserves aliases', async (context) => {
	const fixture = await createStoreFixture(context, 'indexeddb');
	const source = audioSource();
	await ageSourceOutOfDurableHistory(fixture.store, PROJECT_ID, source);
	await fixture.store.saveProject(project(ALIAS_PROJECT_ID, 1, source));
	await bind(fixture.store, ALIAS_PROJECT_ID, source, fixture.body);

	await fixture.store.maintainOpenedProject(PROJECT_ID, () => [{ kind: 'audio', sourceId: source.id }]);
	assert.ok(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id));

	await fixture.store.maintainOpenedProject(PROJECT_ID, () => []);
	assert.equal(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id), null);
	assert.ok(await fixture.store.getLinkedOriginalBinding(ALIAS_PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, [], 'the same-store alias must retain the exact locator');
	assert.equal(fixture.body.size, fixture.originalBodyBytes);

	await fixture.store.deleteProject(ALIAS_PROJECT_ID);
	assert.deepEqual(fixture.releases, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}]);
});

test('memory and degraded stores do not run activation-triggered binding maintenance', async (context) => {
	const fixture = await createStoreFixture(context, 'memory');
	const source = audioSource();
	await ageSourceOutOfDurableHistory(fixture.store, PROJECT_ID, source);

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), false);
	assert.ok(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, []);
});

test('a later activation retries a failed exact locator release without rediscovering its binding', async (context) => {
	let releaseAttempts = 0;
	const reported: unknown[] = [];
	const fixture = await createStoreFixture(context, 'indexeddb', {
		reported,
		release: (reference) => {
			releaseAttempts += 1;
			if (releaseAttempts === 1) throw new Error('planned locator release failure');
			fixture.releases.push(reference);
			return true;
		},
	});
	const source = audioSource();
	await ageSourceOutOfDurableHistory(fixture.store, PROJECT_ID, source);
	assert.equal(await fixture.store.maintainOpenedProject(
		PROJECT_ID, () => [{ kind: 'audio', sourceId: source.id }],
	), true, 'the first durable maintenance consumes the transient bind root');
	assert.equal(releaseAttempts, 0);

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), true);
	assert.equal(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(releaseAttempts, 1);
	assert.deepEqual(pickCleanupError(reported[0]), {
		name: 'LinkedOriginalLocatorCleanupError', committed: true,
		operation: 'open-project', projectId: undefined,
	});

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), true);
	assert.equal(releaseAttempts, 2);
	assert.equal(reported.length, 1);
	assert.equal(fixture.releases.length, 1);
});

test('activation binding-prune failure is report-only and a later activation retries it', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const reported: unknown[] = [];
	const fixture = await createStoreFixture(context, 'indexeddb', { indexedDB, reported });
	const source = audioSource();
	await ageSourceOutOfDurableHistory(fixture.store, PROJECT_ID, source);
	assert.equal(await fixture.store.maintainOpenedProject(
		PROJECT_ID, () => [{ kind: 'audio', sourceId: source.id }],
	), true, 'the first durable maintenance consumes the transient bind root');
	indexedDB.failNextDeleteForStore('linkedVideoOriginalBindings', new Error('planned binding delete failure'));

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), false);
	assert.ok(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(pickCleanupError(reported[0]), {
		name: 'LinkedOriginalProjectBindingCleanupError', committed: true,
		operation: 'open-project', projectId: PROJECT_ID,
	});

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), true);
	assert.equal(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(fixture.releases.length, 1);
});

test('missing durable current project state suppresses open maintenance', async (context) => {
	const fixture = await createStoreFixture(context, 'indexeddb');
	const source = audioSource();
	await bind(fixture.store, PROJECT_ID, source, fixture.body);

	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), false);
	assert.ok(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, []);
});

test('desktop open maintenance serializes with the latest project mutation queue', async () => {
	const events: string[] = [];
	const maintenanceGate = deferred<void>();
	const maintenanceStarted = deferred<void>();
	const projectValue = project(PROJECT_ID, 1);
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async (document) => { events.push('remote:save'); return document; },
		deleteSharedProject: async () => true,
	};
	const shadow = {
		save: async (value: unknown) => { events.push('shadow:save'); return value; },
		load: async () => null,
		list: async () => [],
		listRevisions: async () => [],
		delete: async () => undefined,
	} as unknown as ProjectRepositoryPort;
	const repository = new DesktopSharedProjectRepository({
		bridge,
		shadow,
		sourceAvailability: {
			getSourceMetadata: async () => null,
			readSourceChunks: async function* () { /* No source payload. */ },
			getMediaAssetMetadata: async () => null,
			loadMediaAsset: async () => null,
		},
		onLocalCleanupError: () => undefined,
	});

	const maintenance = repository.maintainCurrentProject(PROJECT_ID, async () => {
		events.push('maintenance:start');
		maintenanceStarted.resolve();
		await maintenanceGate.promise;
		events.push('maintenance:end');
	});
	await maintenanceStarted.promise;
	const save = repository.save(projectValue);
	await Promise.resolve();
	assert.deepEqual(events, ['maintenance:start']);

	maintenanceGate.resolve();
	await Promise.all([maintenance, save]);
	assert.deepEqual(events, ['maintenance:start', 'maintenance:end', 'shadow:save', 'remote:save']);
});

test('queued open maintenance collects current roots and suppresses lost ownership under its lock', async () => {
	let entered = deferred<void>();
	let gate = deferred<void>();
	let roots: unknown = [];
	let pruneCalls = 0;
	const observed: unknown[] = [];
	const projects = {
		maintainCurrentProject: async (_projectId: string, maintenance: () => PromiseLike<void> | void) => {
			entered.resolve();
			await gate.promise;
			await maintenance();
		},
	};
	const lifecycle = new LinkedOriginalLifecycleCoordinator(null, null);
	const reachability = {
		pruneProjectBindings: async (_projectId: string, protectedRoots: unknown) => {
			pruneCalls += 1;
			observed.push(protectedRoots);
			return { durableSourceReferences: [], removedLocatorReferences: [] };
		},
	} as unknown as LinkedOriginalProjectReachabilityRepository;
	const dependencies = { projects, lifecycle, reachability, isDurable: () => true };

	const currentRoots = maintainOpenedProjectWithLinkedOriginalReachability(
		dependencies, PROJECT_ID, () => roots,
	);
	await entered.promise;
	roots = [{ kind: 'audio', sourceId: 'newly-live-source' }];
	gate.resolve();
	assert.equal(await currentRoots, true);
	assert.deepEqual(observed, [[{ kind: 'audio', sourceId: 'newly-live-source' }]]);

	entered = deferred<void>();
	gate = deferred<void>();
	let writable = true;
	const lostOwnership = maintainOpenedProjectWithLinkedOriginalReachability(
		dependencies, PROJECT_ID, () => writable ? [] : null,
	);
	await entered.promise;
	writable = false;
	gate.resolve();
	assert.equal(await lostOwnership, false);
	assert.equal(pruneCalls, 1);
});

interface StoreFixtureOptions {
	readonly indexedDB?: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly reported?: unknown[];
	readonly release?: (reference: Readonly<{
		kind: 'audio' | 'video'; locatorId: string; locatorRevision: string;
	}>) => boolean | Promise<boolean>;
}

async function createStoreFixture(
	context: TestContext,
	backend: 'indexeddb' | 'memory',
	options: StoreFixtureOptions = {},
) {
	const body = wavBlob(Float32Array.of(-1, -0.5, 0.5, 1));
	const releases: Array<Readonly<{
		kind: 'audio' | 'video'; locatorId: string; locatorRevision: string;
	}>> = [];
	const port: LinkedOriginalPort = {
		load: (_kind, _locatorId, { expectedRevision }) => ({
			blob: body,
			locatorRevision: expectedRevision ?? LOCATOR_REVISION,
		}),
		release: options.release ?? ((reference) => { releases.push(reference); return true; }),
	};
	const store = createProjectStore({
		indexedDB: backend === 'indexeddb'
			? (options.indexedDB ?? createInstrumentedIndexedDB()) as unknown as IDBFactory
			: null,
		memoryFallback: backend === 'memory',
		preferOpfs: false,
		revisionLimit: 2,
		databaseName: `linked-open-maintenance-${backend}-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: port,
		onLinkedVideoOriginalLocatorCleanupError: (error: unknown) => { options.reported?.push(error); },
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	return { body, originalBodyBytes: body.size, releases, store };
}

async function ageSourceOutOfDurableHistory(
	store: ReturnType<typeof createProjectStore>,
	projectId: string,
	source: ReturnType<typeof audioSource>,
): Promise<void> {
	await store.saveProject(project(projectId, 1, source));
	await bind(store, projectId, source, wavBlob(Float32Array.of(-1, -0.5, 0.5, 1)));
	await store.saveProject(project(projectId, 2));
	await store.saveProject(project(projectId, 3));
	assert.ok(await store.getLinkedOriginalBinding(projectId, source.id));
}

function bind(
	store: ReturnType<typeof createProjectStore>,
	projectId: string,
	source: ReturnType<typeof audioSource>,
	body: Blob,
) {
	return store.bindLinkedAudioOriginal(projectId, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});
}

function audioSource() {
	return createAudioSourceV9({
		id: 'linked-audio-source', storageKey: 'linked-audio-storage', mimeType: 'audio/wav',
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 2,
	});
}

function project(
	id: string,
	revision: number,
	source?: ReturnType<typeof audioSource>,
) {
	return createAudioEditorProjectV9({
		id,
		title: id,
		revision,
		now: NOW,
		sources: source ? [source] : [],
		clips: source ? [createAudioClipV9({
			id: `${id}-clip`, sourceId: source.id,
			durationFrames: source.frameCount, sourceDurationFrames: source.frameCount,
		})] : [],
	});
}

function wavBlob(channel: Float32Array): Blob {
	const encoded = encodeWav([channel], { float: true, dither: false, sampleRate: 48_000 });
	return new Blob([new Uint8Array(encoded)], { type: 'audio/wav' });
}

function pickCleanupError(value: unknown) {
	const error = value as Readonly<Record<string, unknown>>;
	return {
		name: error.name,
		committed: error.committed,
		operation: error.operation,
		projectId: error.projectId,
	};
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return Object.freeze({ promise, resolve });
}
