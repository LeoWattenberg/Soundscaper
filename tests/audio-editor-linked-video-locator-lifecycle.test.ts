/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { LinkedVideoOriginalLocatorReference } from '../src/common/editor/storage/linked-video-original-repository.ts';
import type { LinkedVideoOriginalPort, LinkedVideoOriginalSource } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import { createStorageRepositories, type StorageRepositoryFactory } from '../src/common/editor/storage/repositories.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const LOCATOR_A = 'locator_0000000000000001';
const LOCATOR_B = 'locator_0000000000000002';
const REVISION_A = 'snapshot_0000000000000001';
const REVISION_B = 'snapshot_0000000000000002';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} project deletion exact-releases unique locators and preserves aliases`, async (context) => {
		const fixture = await lifecycleFixture(context, backend);
		await fixture.store.saveProject({ id: 'project-a', revision: 0 });
		await fixture.store.saveProject({ id: 'project-b', revision: 0 });
		await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);
		await fixture.store.bindLinkedVideoOriginal('project-b', source('source-b', 'storage-b'), LOCATOR_A);
		await fixture.store.bindLinkedVideoOriginal('project-a', source('source-c', 'storage-c'), LOCATOR_B);

		await fixture.store.deleteProject('project-a');
		assert.deepEqual(fixture.releases, [reference(LOCATOR_B, REVISION_B)]);
		assert.ok(await fixture.store.getLinkedVideoOriginalBinding('project-b', 'source-b'));
		assert.equal(fixture.externalBodies.has(LOCATOR_A), true);
		assert.equal(fixture.externalBodies.has(LOCATOR_B), true);

		await fixture.store.deleteProject('project-b');
		assert.deepEqual(fixture.releases, [
			reference(LOCATOR_B, REVISION_B),
			reference(LOCATOR_A, REVISION_A),
		]);
	});

	test(`${backend} clear deduplicates exact releases after the local binding commit`, async (context) => {
		const fixture = await lifecycleFixture(context, backend);
		await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);
		await fixture.store.bindLinkedVideoOriginal('project-b', source('source-b', 'storage-b'), LOCATOR_A);
		await fixture.store.bindLinkedVideoOriginal('project-b', source('source-c', 'storage-c'), LOCATOR_B);

		const first = fixture.store.clear();
		assert.strictEqual(fixture.store.clear(), first);
		await first;
		assert.deepEqual(fixture.releases.sort(byLocator), [
			reference(LOCATOR_A, REVISION_A),
			reference(LOCATOR_B, REVISION_B),
		]);
		assert.equal(fixture.externalBodies.size, 2, 'locator cleanup must not delete external video bodies');
	});
}

test('post-delete release failure reports without rollback and retries after rechecking aliases', async (context) => {
	let releaseAttempts = 0;
	const successfulReleases: LinkedVideoOriginalLocatorReference[] = [];
	const reported: unknown[] = [];
	const fixture = await lifecycleFixture(context, 'memory', {
		onCleanupError: (error) => { reported.push(error); },
		release: async (value) => {
			releaseAttempts += 1;
			if (releaseAttempts === 1) throw new Error('planned locator release failure');
			successfulReleases.push(value);
			return true;
		},
	});
	await fixture.store.saveProject({ id: 'project-a', revision: 0 });
	await fixture.store.saveProject({ id: 'project-b', revision: 0 });
	await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);

	await fixture.store.deleteProject('project-a');
	assert.equal(await fixture.store.loadProject('project-a'), null);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding('project-a', 'source-a'), null);
	assert.equal(releaseAttempts, 1);
	assert.equal(reported.length, 1);
	assert.deepEqual(
		pickCleanupErrorFields(reported[0]),
		{
			name: 'LinkedVideoOriginalLocatorCleanupError',
			committed: true,
			operation: 'delete-project',
			pendingCount: 1,
		},
	);

	await fixture.store.bindLinkedVideoOriginal('project-b', source('source-b', 'storage-b'), LOCATOR_A);
	assert.equal(releaseAttempts, 1, 'the newly rebound alias must suppress pending cleanup');
	await fixture.store.deleteProject('project-b');
	assert.equal(releaseAttempts, 2);
	assert.deepEqual(successfulReleases, [reference(LOCATOR_A, REVISION_A)]);
});

test('a fulfilled false settles pending cleanup and prevents repeated release attempts', async (context) => {
	let releaseAttempts = 0;
	const reported: unknown[] = [];
	const fixture = await lifecycleFixture(context, 'memory', {
		onCleanupError: (error) => { reported.push(error); },
		release: async () => {
			releaseAttempts += 1;
			if (releaseAttempts === 1) throw new Error('planned locator release failure');
			return false;
		},
	});
	await fixture.store.saveProject({ id: 'project-a', revision: 0 });
	await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);

	await fixture.store.deleteProject('project-a');
	assert.equal(releaseAttempts, 1);
	assert.equal(reported.length, 1);
	await fixture.store.deleteProject('retry-trigger');
	assert.equal(releaseAttempts, 2);
	await fixture.store.deleteProject('later-trigger');
	assert.equal(releaseAttempts, 2, 'fulfilled false must retire the pending exact reference');
});

test('release-unused is serialized, alias-aware, and keeps operational failures observable', async (context) => {
	let releaseCalls = 0;
	const failure = new Error('planned explicit release failure');
	const fixture = await lifecycleFixture(context, 'memory', {
		release: async () => {
			releaseCalls += 1;
			throw failure;
		},
	});
	const binding = await fixture.store.bindLinkedVideoOriginal(
		'project-a', source('source-a', 'storage-a'), LOCATOR_A,
	);
	let locatorReads = 0;
	const proxiedReference = new Proxy({}, {
		ownKeys: () => ['locatorId', 'locatorRevision'],
		getOwnPropertyDescriptor: (_target, property) => ({
			configurable: true,
			enumerable: true,
			value: property === 'locatorId' ? LOCATOR_A : REVISION_A,
		}),
		get: () => { locatorReads += 1; throw new Error('untrusted locator getter executed'); },
	});
	assert.equal(await fixture.store.releaseLinkedVideoOriginalLocator(proxiedReference), false);
	assert.equal(locatorReads, 0, 'only the sanitized exact reference may be read');
	await assert.rejects(
		fixture.store.releaseLinkedVideoOriginalLocator({
			...reference(LOCATOR_A, REVISION_A),
			unsupported: true,
		}),
		/unsupported field/iu,
	);
	assert.equal(
		await fixture.store.releaseLinkedVideoOriginalLocator(reference(LOCATOR_A, REVISION_A)),
		false,
	);
	assert.equal(releaseCalls, 0);
	assert.equal(await fixture.store.unlinkLinkedVideoOriginal(
		'project-a', 'source-a', binding.bindingToken,
	), true);
	await assert.rejects(
		fixture.store.releaseLinkedVideoOriginalLocator(reference(LOCATOR_A, REVISION_A)),
		(error) => error === failure,
	);
	assert.equal(releaseCalls, 1);
});

test('a bind admitted first completes before queued project deletion and exact release', async (context) => {
	const loaded = deferred<void>();
	const resume = deferred<void>();
	const fixture = await lifecycleFixture(context, 'memory', {
		load: async (locatorId) => {
			loaded.resolve();
			await resume.promise;
			return { blob: new Blob([locatorId]), locatorRevision: REVISION_A };
		},
	});
	await fixture.store.saveProject({ id: 'project-a', revision: 0 });
	const binding = fixture.store.bindLinkedVideoOriginal(
		'project-a', source('source-a', 'storage-a'), LOCATOR_A,
	);
	await loaded.promise;
	const deletion = fixture.store.deleteProject('project-a');
	assert.equal(fixture.releases.length, 0);
	resume.resolve();
	await binding;
	await deletion;
	assert.deepEqual(fixture.releases, [reference(LOCATOR_A, REVISION_A)]);
});

test('an IndexedDB binding-delete failure rolls back the project and emits no release', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const fixture = await lifecycleFixture(context, 'indexeddb', { indexedDB });
	await fixture.store.saveProject({ id: 'project-a', revision: 0 });
	await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);
	const failure = new Error('planned binding transaction failure');
	indexedDB.failNextDeleteForStore(LINKED_VIDEO_ORIGINAL_STORE_NAME, failure);

	await assert.rejects(fixture.store.deleteProject('project-a'), /aborted|transaction/iu);
	assert.ok(await fixture.store.loadProject('project-a'));
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding('project-a', 'source-a'));
	assert.deepEqual(fixture.releases, []);
});

test('clear failure before the local commit preserves bindings and only retries older cleanup', async (context) => {
	const failure = new Error('planned precommit clear failure');
	let locatorAAttempts = 0;
	const successfulReleases: LinkedVideoOriginalLocatorReference[] = [];
	const fixture = await lifecycleFixture(context, 'memory', {
		repositoryFactory: clearFailureFactory('precommit', failure),
		onCleanupError: () => undefined,
		release: async (value) => {
			if (value.locatorId === LOCATOR_A) {
				locatorAAttempts += 1;
				if (locatorAAttempts === 1) throw new Error('planned older release failure');
			}
			successfulReleases.push(value);
			return true;
		},
	});
	await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);
	await fixture.store.bindLinkedVideoOriginal('project-b', source('source-b', 'storage-b'), LOCATOR_B);
	await fixture.store.deleteProject('project-a');
	assert.equal(locatorAAttempts, 1);

	await assert.rejects(fixture.store.clear(), (error) => error === failure);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding('project-b', 'source-b'));
	assert.equal(locatorAAttempts, 2);
	assert.deepEqual(successfulReleases, [reference(LOCATOR_A, REVISION_A)]);
});

test('clear failure after the local commit still exact-releases removed bindings', async (context) => {
	const failure = new Error('planned postcommit physical clear failure');
	const fixture = await lifecycleFixture(context, 'memory', {
		repositoryFactory: clearFailureFactory('postcommit', failure),
	});
	await fixture.store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);

	await assert.rejects(fixture.store.clear(), (error) => error === failure);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding('project-a', 'source-a'), null);
	assert.deepEqual(fixture.releases, [reference(LOCATOR_A, REVISION_A)]);
});

test('a store without a locator resolver skips inventories for local delete and clear', async (context) => {
	const databaseName = `locator-lifecycle-no-resolver-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const store = createProjectStore({ indexedDB: null, databaseName, preferOpfs: false });
	context.after(async () => { await store.close(); });
	await store.ready();
	await store.saveProject({ id: 'project-a', revision: 0 });
	const firstKey = linkedVideoOriginalBindingKey('project-a', 'source-a');
	memory.linkedVideoOriginalBindings.set(firstKey, malformedBindingRecord(firstKey, 'project-a'));

	await store.deleteProject('project-a');
	assert.equal(await store.loadProject('project-a'), null);
	assert.equal(memory.linkedVideoOriginalBindings.has(firstKey), false);

	const secondKey = linkedVideoOriginalBindingKey('project-b', 'source-b');
	memory.linkedVideoOriginalBindings.set(secondKey, malformedBindingRecord(secondKey, 'project-b'));
	await store.clear();
	assert.equal(memory.linkedVideoOriginalBindings.size, 0);
});

test('a load-only locator resolver does not reconcile or block local cleanup', async (context) => {
	let loadCalls = 0;
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `locator-lifecycle-load-only-${Date.now()}-${Math.random()}`,
		preferOpfs: false,
		linkedVideoOriginalPort: {
			load: async () => {
				loadCalls += 1;
				return { blob: new Blob(['external']), locatorRevision: REVISION_A };
			},
		},
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	await store.saveProject({ id: 'project-a', revision: 0 });
	await store.bindLinkedVideoOriginal('project-a', source('source-a', 'storage-a'), LOCATOR_A);
	assert.equal(await store.reconcileLinkedVideoOriginalLocators(), false);
	assert.ok(await store.getLinkedVideoOriginalBinding('project-a', 'source-a'));

	await store.deleteProject('project-a');
	assert.equal(await store.getLinkedVideoOriginalBinding('project-a', 'source-a'), null);
	assert.equal(loadCalls, 1);
});

test('a rejected clear inventory neither mutates bindings nor leaves media maintenance active', async (context) => {
	const fixture = await lifecycleFixture(context, 'memory');
	const key = linkedVideoOriginalBindingKey('project-a', 'source-a');
	fixture.store.memory.linkedVideoOriginalBindings.set(key, malformedBindingRecord(key, 'project-a'));

	await assert.rejects(fixture.store.clear(), /linked video original binding/iu);
	assert.equal(fixture.store.memory.linkedVideoOriginalBindings.has(key), true);
	await fixture.store.writeMediaAsset('media-after-rejection', new Blob(['safe local media']));
	assert.ok(await fixture.store.getMediaAssetMetadata('media-after-rejection'));
});

interface LifecycleFixtureOptions {
	readonly indexedDB?: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly load?: LinkedVideoOriginalPort['load'];
	readonly release?: NonNullable<LinkedVideoOriginalPort['release']>;
	readonly onCleanupError?: (error: unknown) => void;
	readonly repositoryFactory?: StorageRepositoryFactory;
}

async function lifecycleFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	options: LifecycleFixtureOptions = {},
) {
	const indexedDB = options.indexedDB ?? (backend === 'indexeddb' ? createInstrumentedIndexedDB() : null);
	const releases: LinkedVideoOriginalLocatorReference[] = [];
	const externalBodies = new Map([
		[LOCATOR_A, new Blob(['external-a'])],
		[LOCATOR_B, new Blob(['external-b'])],
	]);
	const port: LinkedVideoOriginalPort = {
		load: options.load ?? (async (locatorId) => ({
			blob: externalBodies.get(locatorId),
			locatorRevision: locatorId === LOCATOR_A ? REVISION_A : REVISION_B,
		})),
		release: options.release ?? (async (value) => { releases.push(value); return true; }),
		reconcile: async () => 0,
	};
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory | null,
		databaseName: `locator-lifecycle-${backend}-${Date.now()}-${Math.random()}`,
		preferOpfs: false,
		linkedVideoOriginalPort: port,
		repositoryFactory: options.repositoryFactory,
		onLinkedVideoOriginalLocatorCleanupError: options.onCleanupError,
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	return { store, releases, externalBodies };
}

function clearFailureFactory(
	timing: 'precommit' | 'postcommit',
	failure: Error,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = createStorageRepositories(port, options);
		const retention = new Proxy(repositories.retention, {
			get(target, property) {
				const beginClear = () => {
					if (timing === 'precommit') {
						const localCommit = Promise.resolve(false);
						return Object.freeze({
							localCommit,
							completion: localCommit.then(() => { throw failure; }),
						});
					}
					const operation = target.beginClear();
					return Object.freeze({
						localCommit: operation.localCommit,
						completion: operation.completion.then(() => { throw failure; }),
					});
				};
				if (property === 'beginClear') return beginClear;
				if (property === 'admitClear') {
					return () => {
						let pending = true;
						return Object.freeze({
							begin: () => {
								if (!pending) throw new Error('Test clear admission is no longer current.');
								pending = false;
								return beginClear();
							},
							cancel: () => { pending = false; },
						});
					};
				}
				const value: unknown = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		return Object.freeze({ ...repositories, retention });
	};
}

function malformedBindingRecord(key: string, projectId: string): object {
	return { key, projectId, binding: Object.freeze({}) };
}

function pickCleanupErrorFields(value: unknown): object {
	const error = value as Readonly<Record<'name' | 'committed' | 'operation' | 'pendingCount', unknown>>;
	return {
		name: error.name,
		committed: error.committed,
		operation: error.operation,
		pendingCount: error.pendingCount,
	};
}

function source(id: string, storageKey: string): LinkedVideoOriginalSource {
	return Object.freeze({
		kind: 'video', id, storageKey, mimeType: 'video/mp4',
		frameCount: 1, sampleRate: 48_000, width: 16, height: 9,
		frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
}

function reference(locatorId: string, locatorRevision: string): LinkedVideoOriginalLocatorReference {
	return { locatorId, locatorRevision };
}

function byLocator(left: LinkedVideoOriginalLocatorReference, right: LinkedVideoOriginalLocatorReference): number {
	return left.locatorId.localeCompare(right.locatorId);
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
