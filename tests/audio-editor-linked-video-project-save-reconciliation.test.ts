/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { LinkedVideoOriginalPort } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'save-reachability-project';
const LOCATOR_ID = 'locator_save_reachability_0001';
const LOCATOR_REVISION = 'snapshot_save_reachability_0001';
const NOW = '2026-08-02T12:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} save cleanup waits until the last linked revision ages out`, async (context) => {
		const fixture = await storeFixture(context, backend);
		const source = videoSource('revision-video');
		await saveWithRoots(fixture.store, project(1, source), []);
		await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);

		await saveWithRoots(fixture.store, project(2), []);
		assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
		assert.deepEqual(fixture.releases, []);

		await saveWithRoots(fixture.store, project(3), []);
		assert.equal(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
		assert.deepEqual(fixture.releases, [{
			locatorId: LOCATOR_ID,
			locatorRevision: LOCATOR_REVISION,
		}]);
	});
}

test('one authoritative live-history save root protects then relinquishes a transient binding', async (context) => {
	const fixture = await storeFixture(context, 'memory');
	const source = videoSource('undo-only-video');
	await saveWithRoots(fixture.store, project(1), []);
	await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);

	await saveWithRoots(fixture.store, project(2), [source.id]);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
	await saveWithRoots(fixture.store, project(3), []);

	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(fixture.releases.length, 1);
});

test('durable open maintenance preserves the current video-only lifecycle facade', async (context) => {
	const fixture = await storeFixture(context, 'indexeddb');
	const source = videoSource('open-maintenance-video');
	await fixture.store.saveProject(project(1, source));
	await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	await fixture.store.saveProject(project(2));
	await fixture.store.saveProject(project(3));

	assert.equal(await fixture.store.maintainOpenedProject(
		PROJECT_ID, () => [{ kind: 'video', sourceId: source.id }],
	), true);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
	assert.equal(await fixture.store.maintainOpenedProject(PROJECT_ID, () => []), true);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(fixture.releases.length, 1);
});

test('direct saves without authoritative live roots never opt into source cleanup', async (context) => {
	const fixture = await storeFixture(context, 'memory');
	const source = videoSource('unqualified-video');
	await fixture.store.saveProject(project(1));
	await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);

	await fixture.store.saveProject(project(2));
	await fixture.store.saveProject(project(3));

	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, []);
});

test('a store without a locator release port still retires unreachable binding rows', async (context) => {
	const databaseName = `save-reachability-no-resolver-${Date.now()}-${Math.random()}`;
	const source = videoSource('load-only-video');
	const owner = createProjectStore({
		indexedDB: null,
		databaseName,
		preferOpfs: false,
		revisionLimit: 2,
		linkedVideoOriginalPort: {
			load: async () => ({ blob: new Blob(['external']), locatorRevision: LOCATOR_REVISION }),
		},
	});
	await owner.ready();
	await saveWithRoots(owner, project(1, source), []);
	await owner.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	await owner.close();
	const cleanup = createProjectStore({
		indexedDB: null,
		databaseName,
		preferOpfs: false,
		revisionLimit: 2,
	});
	context.after(async () => { await cleanup.close(); });
	await cleanup.ready();

	await saveWithRoots(cleanup, project(2), []);
	await saveWithRoots(cleanup, project(3), []);

	assert.equal(await cleanup.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
});

test('Desktop remote rejection leaves shadow-adjacent bindings and locators untouched', async (context) => {
	let rejectCommit = false;
	const failure = new Error('planned shared publication failure');
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async ({ document }) => {
			if (rejectCommit) throw failure;
			return { status: 'committed', document };
		},
		deleteSharedProject: async () => true,
	};
	const fixture = await storeFixture(context, 'memory', { desktopProjectBridge: bridge });
	const source = videoSource('desktop-video');
	await saveWithRoots(fixture.store, project(1, source), []);
	await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	rejectCommit = true;

	await assert.rejects(saveWithRoots(fixture.store, project(2), []), (error) => error === failure);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, []);
});

test('post-commit binding deletion failure reports, preserves the save, and retries later', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const reported: unknown[] = [];
	const fixture = await storeFixture(context, 'indexeddb', { indexedDB, reported });
	const source = videoSource('retry-video');
	await saveWithRoots(fixture.store, project(1, source), []);
	await fixture.store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	await saveWithRoots(fixture.store, project(2), []);
	indexedDB.failNextDeleteForStore('linkedVideoOriginalBindings', new Error('planned binding deletion failure'));

	await saveWithRoots(fixture.store, project(3), []);
	assert.equal((await fixture.store.loadProject(PROJECT_ID))?.revision, 3);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id));
	assert.deepEqual(fixture.releases, []);
	assert.deepEqual(pickCleanupError(reported[0]), {
		name: 'LinkedVideoOriginalProjectBindingCleanupError',
		committed: true,
		operation: 'save-project',
		projectId: PROJECT_ID,
	});

	await saveWithRoots(fixture.store, project(4), []);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(fixture.releases.length, 1);
});

interface FixtureOptions {
	readonly indexedDB?: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly reported?: unknown[];
	readonly desktopProjectBridge?: DesktopSharedProjectBridge;
}

async function storeFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	options: FixtureOptions = {},
) {
	const indexedDB = options.indexedDB ?? (backend === 'indexeddb' ? createInstrumentedIndexedDB() : null);
	const releases: Array<{ locatorId: string; locatorRevision: string }> = [];
	const port: LinkedVideoOriginalPort = {
		load: async () => ({ blob: new Blob(['external linked video']), locatorRevision: LOCATOR_REVISION }),
		release: async (reference) => { releases.push(reference); return true; },
	};
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory | null,
		databaseName: `save-reachability-${backend}-${Date.now()}-${Math.random()}`,
		preferOpfs: false,
		revisionLimit: 2,
		linkedVideoOriginalPort: port,
		desktopProjectBridge: options.desktopProjectBridge,
		onLinkedVideoOriginalLocatorCleanupError: (error: unknown) => { options.reported?.push(error); },
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	return { store, releases };
}

function videoSource(id: string) {
	return createVideoSourceV9({
		id,
		storageKey: id,
		name: `${id}.mp4`,
		mimeType: 'video/mp4',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
}

function project(revision: number, source?: ReturnType<typeof videoSource>) {
	const clip = source ? createVideoClipV9({
		id: `clip-${source.id}`,
		sourceId: source.id,
		title: source.name,
		durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount,
	}) : null;
	return createAudioEditorProjectV10({
		id: PROJECT_ID,
		title: 'Save reachability',
		revision,
		now: NOW,
		sources: source ? [source] : [],
		clips: clip ? [clip] : [],
		tracks: clip ? [createVideoTrackV9({ id: 'video-track', clipIds: [clip.id] })] : [],
	});
}

function saveWithRoots(
	store: ReturnType<typeof createProjectStore>,
	value: ReturnType<typeof project>,
	protectedLinkedVideoSourceIds: readonly string[],
) {
	return store.saveProject(value, { protectedLinkedVideoSourceIds });
}

function pickCleanupError(value: unknown) {
	const error = value as Record<string, unknown>;
	return {
		name: error.name,
		committed: error.committed,
		operation: error.operation,
		projectId: error.projectId,
	};
}
