/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createFramescaperNativeQueueCapacityProvider,
} from '../desktop/native-queue-capacity-provider.ts';
import type { FramescaperNativeScratchReservation } from '../desktop/native-services-scratch-repository.ts';
import { admitNativeQueueJobs } from '../src/common/editor/native-queue-admission.ts';
import {
	assertNativeQueueRecordV2,
	createNativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import { applyNativeQueueTransition } from '../src/common/editor/native-queue-state-machine.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const GIB = 1024 ** 3;

test('the capacity provider accounts for running work and durable scratch exactly once', async () => {
	const provider = createFramescaperNativeQueueCapacityProvider({
		scratchRoot: '/private/framescaper-scratch',
		availableParallelism: () => 8,
		freeMemory: () => 16 * GIB,
		inspectScratchVolume: async () => ({ totalBytes: 200 * GIB, freeBytes: 50 * GIB }),
	});
	const running = runningRecord('a1', {
		cpuCores: 2, processTreeRssBytes: 4 * GIB, scratchBytes: 8 * GIB,
		minimumFreeBytes: 0, hardwareBackend: 'nvenc',
	});
	const queued = queueRecord('a2', {
		cpuCores: 4, processTreeRssBytes: 2 * GIB, scratchBytes: 4 * GIB,
		minimumFreeBytes: 0, hardwareBackend: 'qsv',
	});
	const retained = scratchReservation('b1', 2 * GIB, 'retained');
	const snapshots = await Promise.all([
		provider({ queue: [running, queued], scratch: [scratchReservation('a1', 8 * GIB), retained] }),
		provider({ queue: [running, queued], scratch: [retained] }),
		provider({ queue: [running, queued], scratch: [scratchReservation('a1', 3 * GIB), retained] }),
	]);

	for (const snapshot of snapshots) {
		assert.deepEqual(snapshot, {
			availableCpuCores: 6,
			availableProcessTreeRssBytes: 12 * GIB,
			availableScratchBytes: 20 * GIB,
			volumeFreeBytes: 40 * GIB,
			reservedFreeBytes: 20 * GIB,
			busyHardwareBackends: ['nvenc'],
		});
		assert.equal(Object.isFrozen(snapshot), true);
	}
});

test('multiple pre-materialized scratch promises cannot overcommit raw volume free space', async () => {
	let freeBytes = 40 * GIB;
	const provider = createFramescaperNativeQueueCapacityProvider({
		scratchRoot: '/private/framescaper-scratch',
		availableParallelism: () => 8,
		freeMemory: () => 16 * GIB,
		configuredConcurrency: () => 4,
		inspectScratchVolume: async () => ({ totalBytes: 200 * GIB, freeBytes }),
	});
	const running = ['c1', 'c2'].map((suffix) => runningRecord(suffix, {
		cpuCores: 1, processTreeRssBytes: GIB, scratchBytes: 8 * GIB,
		minimumFreeBytes: 0, hardwareBackend: null,
	}));
	const queued = queueRecord('c3', {
		cpuCores: 1, processTreeRssBytes: GIB, scratchBytes: 4 * GIB,
		minimumFreeBytes: 0, hardwareBackend: null,
	});
	const exact = await provider({ queue: [...running, queued], scratch: [] });
	assert.equal(exact.volumeFreeBytes, 24 * GIB);
	assert.equal(exact.reservedFreeBytes, 20 * GIB);
	assert.equal(exact.availableScratchBytes, 4 * GIB);
	assert.deepEqual(admitNativeQueueJobs([queued], running.length, exact).admitted, [queued.jobId]);

	freeBytes -= 1;
	const below = await provider({ queue: [...running, queued], scratch: [] });
	assert.equal(below.volumeFreeBytes, (24 * GIB) - 1);
	assert.equal(below.availableScratchBytes, (4 * GIB) - 1);
	assert.deepEqual(admitNativeQueueJobs([queued], running.length, below).admitted, []);
});

test('the production sampler uses real bounded host and scratch-volume observations', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-capacity-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const provider = createFramescaperNativeQueueCapacityProvider({
		scratchRoot: join(temporary, 'managed-scratch'),
	});
	const snapshot = await provider({ queue: [], scratch: [] });
	for (const value of [
		snapshot.availableCpuCores,
		snapshot.availableProcessTreeRssBytes,
		snapshot.availableScratchBytes,
		snapshot.volumeFreeBytes,
		snapshot.reservedFreeBytes,
	]) assert.equal(Number.isSafeInteger(value) && value >= 0, true);
	assert.equal(snapshot.availableCpuCores >= 1, true);
	assert.deepEqual(snapshot.busyHardwareBackends, []);
});

test('invalid physical observations fail closed before becoming capacity', async () => {
	const context = { queue: [], scratch: [] };
	const committedContext = {
		queue: [runningRecord('d1', {
			cpuCores: 1, processTreeRssBytes: GIB, scratchBytes: 8 * GIB,
			minimumFreeBytes: 0, hardwareBackend: null,
		})],
		scratch: [],
	};
	await assert.rejects(createFramescaperNativeQueueCapacityProvider({
		scratchRoot: '/private/scratch', availableParallelism: () => 0,
		inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 20 * GIB }),
	})(context), /parallelism/iu);
	await assert.rejects(createFramescaperNativeQueueCapacityProvider({
		scratchRoot: '/private/scratch', freeMemory: () => -1,
		inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 20 * GIB }),
	})(context), /free memory/iu);
	await assert.rejects(createFramescaperNativeQueueCapacityProvider({
		scratchRoot: '/private/scratch',
		inspectScratchVolume: async () => ({ totalBytes: 20 * GIB, freeBytes: 21 * GIB }),
	})(committedContext), /more free bytes/iu);
});

function queueRecord(
	suffix: string,
	reservations: Readonly<{
		cpuCores: number;
		processTreeRssBytes: number;
		scratchBytes: number;
		minimumFreeBytes: number;
		hardwareBackend: string | null;
	}>,
) {
	return createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: suffix.repeat(20), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1, inputFingerprints: [],
		rootGrantId: 'f'.repeat(32), relativeDestination: `${suffix}.mov`, reservations,
		position: 0, createdAtMs: 1,
	});
}

function runningRecord(
	suffix: string,
	reservations: Parameters<typeof queueRecord>[1],
) {
	const record = applyNativeQueueTransition(
		queueRecord(suffix, reservations), { kind: 'dispatch' }, 2,
	).record;
	assertNativeQueueRecordV2(record);
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
