/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FramescaperNativeMediaQueueDispatcherV3 } from
	'../desktop/native-media-queue-dispatcher-v3.ts';
import {
	createFramescaperNativeQueueCapacityProviderV3,
} from '../desktop/native-queue-capacity-provider-v3.ts';
import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
} from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from
	'../desktop/native-services-database-v3.ts';
import { FramescaperNativeQueueRepository } from
	'../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from
	'../desktop/native-services-root-repository.ts';
import type { FramescaperNativeScratchReservation } from
	'../desktop/native-services-scratch-repository.ts';
import { admitNativeQueueJobs } from '../src/common/editor/native-queue-admission.ts';
import {
	assertNativeQueueRecordV3,
	createNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import { applyNativeQueueTransition } from '../src/common/editor/native-queue-state-machine.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from
	'../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from
	'../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from
	'../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const GIB = 1024 ** 3;
const ROOT_GRANT_ID = 'f'.repeat(32);
const PROFILE = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;
const PROJECT = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
const PLAN = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
	PROFILE,
	PROJECT,
	createFramescaperNativeRenderPlanAuthorityNativeMedia(PROJECT),
);

test('the V3 sampler counts running and retained scratch once and reports backend occupancy', async () => {
	const scratchRoot = '/private/framescaper-v3-scratch';
	const provider = createFramescaperNativeQueueCapacityProviderV3({
		scratchRoot,
		availableParallelism: () => 8,
		freeMemory: () => 16 * GIB,
		configuredConcurrency: () => 4,
		inspectScratchVolume: async (observedRoot) => {
			assert.equal(observedRoot, scratchRoot);
			return { totalBytes: 200 * GIB, freeBytes: 50 * GIB };
		},
	});
	const running = runningRecord('a1', {
		cpuCores: 2, processTreeRssBytes: 4 * GIB, scratchBytes: 8 * GIB,
		minimumFreeBytes: 0, hardwareBackend: 'nvenc',
	});
	const queued = queueRecord('b2', {
		cpuCores: 1, processTreeRssBytes: GIB, scratchBytes: GIB,
		minimumFreeBytes: 0, hardwareBackend: 'nvenc',
	}, 1);
	const snapshot = await provider({
		queue: [running, queued],
		scratch: [
			scratchReservation('a1', 8 * GIB),
			scratchReservation('c3', 2 * GIB, 'retained'),
			scratchReservation('d4', 30 * GIB, 'released'),
		],
	});

	assert.deepEqual(snapshot, {
		configuredConcurrency: 4,
		availableCpuCores: 6,
		availableProcessTreeRssBytes: 12 * GIB,
		availableScratchBytes: 20 * GIB,
		volumeFreeBytes: 40 * GIB,
		reservedFreeBytes: 20 * GIB,
		busyHardwareBackends: ['nvenc'],
	});
	assert.equal(Object.isFrozen(snapshot), true);
	assert.deepEqual(admitNativeQueueJobs([queued], 1, snapshot), {
		concurrencyCeiling: 4,
		admitted: [],
		deferred: [{ jobId: queued.jobId, reason: 'hardware-busy' }],
	});
});

test('the V3 sampler clamps overcommitted host and volume capacity to zero', async () => {
	const provider = createFramescaperNativeQueueCapacityProviderV3({
		scratchRoot: '/private/framescaper-v3-scratch',
		availableParallelism: () => 2,
		freeMemory: () => GIB,
		inspectScratchVolume: async () => ({ totalBytes: 100 * GIB, freeBytes: 5 * GIB }),
	});
	const running = runningRecord('a1', {
		cpuCores: 4, processTreeRssBytes: 3 * GIB, scratchBytes: 20 * GIB,
		minimumFreeBytes: 0, hardwareBackend: null,
	});

	assert.deepEqual(await provider({ queue: [running], scratch: [] }), {
		availableCpuCores: 0,
		availableProcessTreeRssBytes: 0,
		availableScratchBytes: 0,
		volumeFreeBytes: 0,
		reservedFreeBytes: 10 * GIB,
		busyHardwareBackends: [],
	});
});

test('the V3 dispatcher wakes and admits queued work after sampled CPU capacity recovers', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'capacity-v3', instanceId: 'capacity-v3-test', processId: 19, nowMs: 0,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	let now = 1;
	roots.authorize({
		grantId: ROOT_GRANT_ID, rootPath: '/private/export-root',
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a', authorizedAtMs: now,
	}, lease, now);
	const reservations = {
		cpuCores: 1, processTreeRssBytes: GIB, scratchBytes: 0,
		minimumFreeBytes: 0, hardwareBackend: null,
	};
	const first = queueRecord('a1', reservations, 0);
	const second = queueRecord('b2', reservations, 1);
	queue.enqueue(first, lease, ++now);
	queue.enqueue(second, lease, ++now);
	let hostCpuCores = 1;
	const capacity = createFramescaperNativeQueueCapacityProviderV3({
		scratchRoot: '/private/framescaper-v3-scratch',
		availableParallelism: () => hostCpuCores,
		freeMemory: () => 8 * GIB,
		configuredConcurrency: () => 2,
		inspectScratchVolume: async () => ({ totalBytes: 200 * GIB, freeBytes: 100 * GIB }),
	});
	const firstStarted = deferred();
	const secondStarted = deferred();
	const firstRelease = deferred();
	const secondRelease = deferred();
	const published: string[] = [];
	const dispatcher = new FramescaperNativeMediaQueueDispatcherV3({
		queue,
		roots,
		lease: () => lease,
		now: () => ++now,
		available: () => true,
		nativeMediaEnabled: () => true,
		capacity: () => capacity({ queue: queue.list(), scratch: [] }),
		prepare: async (record) => ({
			execute: async () => {
				if (record.jobId === first.jobId) {
					firstStarted.resolve();
					await firstRelease.promise;
				}
				else {
					secondStarted.resolve();
					await secondRelease.promise;
				}
				return record.jobId;
			},
			publish: async (result) => { published.push(String(result)); },
		}),
	});

	try {
		const initialDrain = dispatcher.dispatch(queue.list());
		await firstStarted.promise;
		assert.equal(queue.read(first.jobId)?.state, 'running');
		assert.equal(queue.read(second.jobId)?.state, 'queued');

		hostCpuCores = 2;
		const queuedSecond = queue.read(second.jobId);
		assert.ok(queuedSecond);
		const wokenDrain = dispatcher.dispatch([queuedSecond]);
		await secondStarted.promise;
		assert.equal(queue.read(first.jobId)?.state, 'running');
		assert.equal(queue.read(second.jobId)?.state, 'running');

		firstRelease.resolve();
		secondRelease.resolve();
		await Promise.all([initialDrain, wokenDrain]);
		assert.equal(queue.read(first.jobId)?.state, 'completed');
		assert.equal(queue.read(second.jobId)?.state, 'completed');
		assert.deepEqual(published.sort(), [first.jobId, second.jobId].sort());
	} finally {
		firstRelease.resolve();
		secondRelease.resolve();
		await dispatcher.dispose();
		database.close();
	}
});

test('the V3 sampler rejects invalid injected observations', async () => {
	const context = { queue: [], scratch: [] };
	const invalid = [
		{
			provider: createFramescaperNativeQueueCapacityProviderV3({
				scratchRoot: '/private/scratch', availableParallelism: () => 0,
				freeMemory: () => GIB,
				inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 20 * GIB }),
			}),
			message: /parallelism/iu,
		},
		{
			provider: createFramescaperNativeQueueCapacityProviderV3({
				scratchRoot: '/private/scratch', availableParallelism: () => 2,
				freeMemory: () => -1,
				inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 20 * GIB }),
			}),
			message: /free memory/iu,
		},
		{
			provider: createFramescaperNativeQueueCapacityProviderV3({
				scratchRoot: '/private/scratch', availableParallelism: () => 2,
				freeMemory: () => GIB,
				inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 21 * GIB }),
			}),
			message: /more free bytes/iu,
		},
		{
			provider: createFramescaperNativeQueueCapacityProviderV3({
				scratchRoot: '/private/scratch', availableParallelism: () => 2,
				freeMemory: () => GIB, configuredConcurrency: () => 1.5,
				inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 20 * GIB }),
			}),
			message: /concurrency/iu,
		},
	];
	for (const { provider, message } of invalid) {
		await assert.rejects(provider(context), message);
	}
});

function queueRecord(
	suffix: string,
	reservations: NativeQueueRecordV3['reservations'],
	position = 0,
): NativeQueueRecordV3 {
	return createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: suffix.repeat(20), taskKind: 'encoded-export', plan: PLAN,
		projectId: String(PROJECT.id), projectRevision: Number(PROJECT.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: ROOT_GRANT_ID, relativeDestination: `renders/${suffix}.mov`,
		reservations, position, createdAtMs: position + 1,
	});
}

function runningRecord(
	suffix: string,
	reservations: NativeQueueRecordV3['reservations'],
): NativeQueueRecordV3 {
	const record = applyNativeQueueTransition(
		queueRecord(suffix, reservations), { kind: 'dispatch' }, 2,
	).record;
	assertNativeQueueRecordV3(record);
	return record;
}

function scratchReservation(
	suffix: string,
	reservedBytes: number,
	state: FramescaperNativeScratchReservation['state'] = 'reserved',
): FramescaperNativeScratchReservation {
	return Object.freeze({
		jobId: suffix.repeat(20), directoryName: `job-${suffix.repeat(20)}`,
		manifestDigest: 'd'.repeat(64), rootIdentity: 'volume-a', reservedBytes,
		state, createdAtMs: 1, expiresAtMs: state === 'retained' ? 10_000 : null,
	});
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((accept) => { resolve = accept; });
	return { promise, resolve };
}
