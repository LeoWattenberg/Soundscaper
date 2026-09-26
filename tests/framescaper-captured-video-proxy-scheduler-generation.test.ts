/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createVideoProxyCandidateObserver } from '../src/common/editor/video-proxy-candidate-observation.ts';
import {
	createFramescaperCapturedVideoProxyScheduler as createRuntimeScheduler,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-runtime.ts';
import { FramescaperDesktopProjectLibraryIndeterminateError } from
	'../src/framescaper/desktop-project-library-errors.ts';
import { createFramescaperDesktopProjectLibraryShadow } from
	'../src/framescaper/desktop-project-library-shadow.ts';
import { CapturedVideoProxyDesktopIndeterminateReconciliationError } from
	'../src/framescaper/editor-captured-video-proxy-desktop-publication.ts';
import { capturedVideoProxySchedulerDependencies } from
	'../src/framescaper/editor-captured-video-proxy-scheduler-composition.ts';
import type { CapturedVideoProxySchedulerDependencies } from
	'../src/framescaper/editor-captured-video-proxy-scheduler-composition.ts';
import { createFramescaperCapturedVideoProxyScheduler as createCoreScheduler } from
	'../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	createFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from '../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperProjectStoreAuthority } from '../src/framescaper/editor-project-store.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;

const PROJECT_ID = 'framescaper-v20';
const SOURCE_ID = 'video-source';
const ORIGINAL = Uint8Array.of(1, 3, 5, 7, 9);
const CANDIDATE = Uint8Array.of(2, 4, 6, 8, 10, 12);
const PROXY_KEY = `video-proxy-sha256:${bytesToHex(sha256(CANDIDATE))}`;
const TIMING = {
	timescale: 10,
	presentationTicks: Array.from({ length: 10 }, (_value, index) => BigInt(index)),
	finalFrameDurationTicks: 1n,
};
const TIMING_KEY = createVideoTimingAssetPublication(
	bytesToHex(sha256(CANDIDATE)), TIMING,
).reference.storageKey;

interface InstrumentedIndexedDB extends IDBFactory {
	failNextPutForStore(storeName: string, error?: Error): void;
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}

function session() {
	return {
		getSnapshot: () => ({ activeProjectId: null, tabs: [] }),
		captureProjectHistory: () => ({ token: {}, history: {} }),
		assertProjectHistoryToken: () => undefined,
		beginProjectActivation: () => ({ token: {}, release: () => true }),
		installCommittedProjectHistory: () => undefined,
	};
}

async function environment(
	indexedDB: InstrumentedIndexedDB,
	context: TestContext,
): Promise<Readonly<FramescaperEditorProjectEnvironment>> {
	const value = await createFramescaperEditorProjectEnvironment({
		storeOptions: { indexedDB, preferOpfs: false, storageManager: persistentStorage() },
	});
	context.after(() => value.close());
	return value;
}

async function seedCapturedOriginal(value: Readonly<FramescaperEditorProjectEnvironment>): Promise<Data> {
	const digest = bytesToHex(sha256(ORIGINAL));
	const writer = await value.store.beginMediaAssetWrite(SOURCE_ID, { mimeType: 'video/mp4' }, {
		expectedBytes: ORIGINAL.byteLength, expectedSha256: digest,
	});
	await writer.write(ORIGINAL);
	await writer.commitOwned();
	const options = framescaperV20Options();
	options.sources = (options.sources as Data[]).map((source) => source.id === SOURCE_ID
		? { ...source, contentSha256: digest }
		: source);
	const project = createFramescaperProject(PROFILE, options as never) as unknown as Data;
	assert.ok(await value.createProjectIfAbsent(project as never));
	const loaded = await value.store.loadProject(PROJECT_ID) as Data | null;
	assert.ok(loaded);
	return loaded;
}

async function mediaRow(database: IDBDatabase, key: string): Promise<Data | undefined> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => (
		request(mediaAssets.get(key)) as Promise<Data | undefined>
	));
}

async function claims(database: IDBDatabase): Promise<unknown[]> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', ({ mediaAssetStaging }) => (
		request(mediaAssetStaging.index('kind').getAll('video-proxy-claim')) as Promise<unknown[]>
	));
}

function candidateObserver(onGenerate: () => void = () => undefined) {
	return createVideoProxyCandidateObserver({
		generator: {
			id: 'test-capture-proxy-generator', version: 1,
			generate: () => {
				onGenerate();
				return new Blob([CANDIDATE], { type: 'video/mp4' });
			},
		},
		recipe: { id: 'test-capture-proxy-recipe', version: 1 },
		probes: [{
			id: 'test-exact-timing-probe',
			probe: () => Promise.resolve({ nominalRate: { num: 10, den: 1 }, ...TIMING }),
		}],
	});
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((value) => { resolve = value; });
	return { promise, resolve };
}

test('generated captured proxy cleans both staged bodies after failed project CAS, then survives retry and reopen', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const value = await environment(indexedDB, context);
	const base = await seedCapturedOriginal(value);
	const authority = framescaperProjectStoreAuthority(PROFILE, value.store);
	const database = await authority.port.database();
	assert.ok(database);
	let generated = 0;
	const scheduler = createRuntimeScheduler(value, session(), {
		runtime: null, candidateObserver: candidateObserver(() => { generated += 1; }),
	});
	context.after(() => scheduler.dispose());
	const scheduled = {
		projectId: PROJECT_ID, sourceId: SOURCE_ID, sessionId: 'capture-session',
		expectedProjectRevision: Number(base.revision),
		expectedContentSha256: bytesToHex(sha256(ORIGINAL)),
	};
	const failure = new Error('planned project CAS failure');
	indexedDB.failNextPutForStore('projects', failure);

	await assert.rejects(scheduler(scheduled), /IndexedDB transaction failed/u);
	assert.equal(generated, 1);
	assert.deepEqual(await value.store.loadProject(PROJECT_ID), base);
	assert.equal(await mediaRow(database, PROXY_KEY), undefined);
	assert.equal(await mediaRow(database, TIMING_KEY), undefined);
	assert.ok(await mediaRow(database, SOURCE_ID), 'the captured original remains after proxy cleanup');
	assert.deepEqual(await claims(database), []);

	await scheduler(scheduled);
	assert.equal(generated, 2, 'retry regenerates after the first candidate was cleaned');
	const published = await value.store.loadProject(PROJECT_ID) as Data;
	const attached = (published.sources as Data[]).find((source) => source.id === SOURCE_ID)?.proxyAttachment as Data;
	assert.equal(published.revision, Number(base.revision) + 1);
	assert.equal(attached.storageKey, PROXY_KEY);
	assert.equal((attached.timingAsset as Data).storageKey, TIMING_KEY);
	assert.ok(await mediaRow(database, PROXY_KEY));
	assert.ok(await mediaRow(database, TIMING_KEY));
	assert.deepEqual(await claims(database), []);
	await scheduler.dispose();
	await value.close();

	const reopened = await environment(indexedDB, context);
	assert.deepEqual(await reopened.store.loadProject(PROJECT_ID), published);
	assert.deepEqual(
		new Uint8Array(await (await reopened.store.loadMediaAsset(PROXY_KEY))!.arrayBuffer()),
		CANDIDATE,
	);
	assert.ok(await reopened.store.loadMediaAsset(TIMING_KEY));
});

for (const [name, mainCommits] of [
	['committed main target and preserves both proxy bodies', true],
	['unchanged main predecessor and cleans both proxy bodies', false],
] as const) {
	test(`desktop publication loses its acknowledgement; retry finds the ${name}`, { timeout: 20_000 }, async (context) => {
		const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
		const value = await environment(indexedDB, context);
		const base = await seedCapturedOriginal(value);
		const authority = framescaperProjectStoreAuthority(PROFILE, value.store);
		const database = await authority.port.database();
		assert.ok(database);
		const shadow = createFramescaperDesktopProjectLibraryShadow(PROFILE, value.store);
		const retryEntered = deferred();
		const allowRetry = deferred();
		const cleanupFinished = deferred();
		const acknowledgementFailure = new Error('main publication acknowledgement was lost');
		let mainProject = base;
		let attemptedTarget: Data | null = null;
		let failReconciliationRead = false;
		let retryPending = false;
		let retryBlocked = false;
		let publicationCalls = 0;
		let generationCalls = 0;
		const cleanup = {
			result: null as Awaited<ReturnType<typeof value.claimCleanup.cleanupOperation>> | null,
		};
		const composed = capturedVideoProxySchedulerDependencies(value, session(), {
			runtime: null,
			candidateObserver: candidateObserver(() => { generationCalls += 1; }),
			maximumReconciliationAttempts: 1,
		});
		const dependencies: CapturedVideoProxySchedulerDependencies = {
			...composed,
			loadAuthoritativeProject: async (projectId, signal) => {
				assert.equal(projectId, PROJECT_ID);
				if (failReconciliationRead) {
					failReconciliationRead = false;
					retryPending = true;
					throw new Error('main read unavailable during acknowledgement recovery');
				}
				if (retryPending && !retryBlocked) {
					retryBlocked = true;
					retryEntered.resolve();
					await allowRetry.promise;
				}
				return shadow.reconcileCommittedProject(mainProject, signal);
			},
			publishDesktopProject: async (project, _signal, beforeFinish) => {
				publicationCalls += 1;
				await beforeFinish?.();
				attemptedTarget = project as Data;
				if (mainCommits) mainProject = project as Data;
				failReconciliationRead = true;
				throw new FramescaperDesktopProjectLibraryIndeterminateError(
					'publication', PROJECT_ID, acknowledgementFailure,
				);
			},
			claimCleanup: {
				cleanupOperation: async (operation, scope) => {
					cleanup.result = await value.claimCleanup.cleanupOperation(operation, scope);
					cleanupFinished.resolve();
					return cleanup.result;
				},
			},
		};
		const scheduler = createCoreScheduler(dependencies);
		context.after(() => scheduler.dispose());
		const scheduled = {
			projectId: PROJECT_ID, sourceId: SOURCE_ID, sessionId: 'capture-session',
			expectedProjectRevision: Number(base.revision),
			expectedContentSha256: bytesToHex(sha256(ORIGINAL)),
		};

		await assert.rejects(scheduler(scheduled), (error: unknown) => {
			assert.ok(error instanceof CapturedVideoProxyDesktopIndeterminateReconciliationError);
			assert.deepEqual(error.base, base);
			assert.equal(error.target.revision, Number(base.revision) + 1);
			return true;
		});
		await retryEntered.promise;
		assert.equal(generationCalls, 1);
		assert.equal(publicationCalls, 1);
		assert.ok(attemptedTarget);
		assert.deepEqual(mainProject, mainCommits ? attemptedTarget : base);
		assert.deepEqual(await value.store.loadProject(PROJECT_ID), base);
		assert.deepEqual(
			(await claims(database) as Data[]).map(({ bodyKey }) => bodyKey).sort(),
			[PROXY_KEY, TIMING_KEY].sort(),
			'an uncertain commit must retain its exact two staged claims',
		);
		assert.ok(await mediaRow(database, PROXY_KEY));
		assert.ok(await mediaRow(database, TIMING_KEY));

		allowRetry.resolve();
		await cleanupFinished.promise;
		await scheduler.dispose();
		const cleanupResult = cleanup.result;
		assert.ok(cleanupResult);
		assert.equal(cleanupResult.status, 'settled');
		assert.equal(publicationCalls, 1, 'reconciliation must not publish a second project');
		assert.equal(generationCalls, 1, 'reconciliation must not regenerate the proxy');
		assert.deepEqual(await claims(database), []);
		assert.deepEqual(await value.store.loadProject(PROJECT_ID), mainCommits ? attemptedTarget : base);
		if (mainCommits) {
			assert.equal(cleanupResult.promotedClaimKeys.length, 2);
			assert.deepEqual(cleanupResult.cleanedBodyKeys, []);
			const proxyRow = await mediaRow(database, PROXY_KEY);
			const timingRow = await mediaRow(database, TIMING_KEY);
			assert.ok(proxyRow);
			assert.ok(timingRow);
			assert.equal(Object.hasOwn(proxyRow, 'pendingProjectUntil'), false);
			assert.equal(Object.hasOwn(timingRow, 'pendingProjectUntil'), false);
		} else {
			assert.deepEqual(cleanupResult.promotedClaimKeys, []);
			assert.deepEqual([...cleanupResult.cleanedBodyKeys].sort(), [PROXY_KEY, TIMING_KEY].sort());
			assert.equal(await mediaRow(database, PROXY_KEY), undefined);
			assert.equal(await mediaRow(database, TIMING_KEY), undefined);
		}
		assert.ok(await mediaRow(database, SOURCE_ID), 'the captured original remains durable');
		await value.close();
		const reopened = await environment(indexedDB, context);
		assert.deepEqual(await reopened.store.loadProject(PROJECT_ID), mainCommits ? attemptedTarget : base);
		assert.equal(Boolean(await reopened.store.loadMediaAsset(PROXY_KEY)), mainCommits);
		assert.equal(Boolean(await reopened.store.loadMediaAsset(TIMING_KEY)), mainCommits);
	});
}
