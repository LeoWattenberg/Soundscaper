/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitNativeQueueJobs,
	clampNativeQueueConcurrency,
	NATIVE_QUEUE_DEFAULT_CONCURRENCY,
	NATIVE_QUEUE_MAXIMUM_CONCURRENCY,
	NATIVE_QUEUE_MINIMUM_CONCURRENCY,
	NativeQueueAdmissionError,
	type NativeQueueCapacityV1,
} from '../src/common/editor/native-queue-admission.ts';
import {
	applyNativeQueueTransition,
} from '../src/common/editor/native-queue-state-machine.ts';
import {
	createNativeQueueRecordV1,
	type NativeQueueRecordV1,
} from '../src/common/editor/native-queue-record.ts';

const GIB = 1024 ** 3;

test('concurrency defaults to two and clamps into one through four', () => {
	assert.equal(NATIVE_QUEUE_MINIMUM_CONCURRENCY, 1);
	assert.equal(NATIVE_QUEUE_MAXIMUM_CONCURRENCY, 4);
	assert.equal(NATIVE_QUEUE_DEFAULT_CONCURRENCY, 2);
	assert.equal(clampNativeQueueConcurrency(undefined), 2);
	assert.equal(clampNativeQueueConcurrency(0), 1);
	assert.equal(clampNativeQueueConcurrency(-5), 1);
	assert.equal(clampNativeQueueConcurrency(9), 4);
	assert.equal(clampNativeQueueConcurrency(3), 3);
	assert.throws(() => clampNativeQueueConcurrency(1.5), NativeQueueAdmissionError);
});

test('the default ceiling admits two jobs and defers the rest in queue order', () => {
	const admission = admitNativeQueueJobs(
		[job('01', { position: 2 }), job('02', { position: 0 }), job('03', { position: 1 })],
		0,
		capacity(),
	);

	assert.equal(admission.concurrencyCeiling, 2);
	assert.deepEqual(admission.admitted, [jobId('02'), jobId('03')]);
	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'concurrency-limit' }]);
});

test('running jobs count against the ceiling', () => {
	const admission = admitNativeQueueJobs([job('01')], 2, capacity());

	assert.deepEqual(admission.admitted, []);
	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'concurrency-limit' }]);
});

test('a reservation the machine cannot honour lowers concurrency below the ceiling', () => {
	for (const [reservations, availability, reason] of [
		[{ cpuCores: 32 }, { availableCpuCores: 8 }, 'cpu-reservation'],
		[{ processTreeRssBytes: 4 * GIB }, { availableProcessTreeRssBytes: GIB }, 'rss-reservation'],
		[{ scratchBytes: 200 * GIB }, { availableScratchBytes: 50 * GIB }, 'scratch-reservation'],
	] as const) {
		const admission = admitNativeQueueJobs(
			[job('01', { reservations })],
			0,
			capacity(availability),
		);
		assert.deepEqual(admission.admitted, [], reason);
		assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason }]);
	}
});

test('a job is deferred when running it would eat the volume free-space floor', () => {
	const admission = admitNativeQueueJobs(
		[job('01', { reservations: { scratchBytes: 95 * GIB } })],
		0,
		capacity({ availableScratchBytes: 100 * GIB, volumeFreeBytes: 100 * GIB, reservedFreeBytes: 10 * GIB }),
	);

	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'free-space-reservation' }]);
});

test('a job may declare a higher free-space floor than the volume policy', () => {
	const admission = admitNativeQueueJobs(
		[job('01', { reservations: { scratchBytes: GIB, minimumFreeBytes: 80 * GIB } })],
		0,
		capacity({ volumeFreeBytes: 60 * GIB, reservedFreeBytes: 10 * GIB }),
	);

	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'free-space-reservation' }]);
});

test('two jobs cannot hold the same hardware backend at once', () => {
	const admission = admitNativeQueueJobs(
		[
			job('01', { position: 0, reservations: { hardwareBackend: 'nvenc' } }),
			job('02', { position: 1, reservations: { hardwareBackend: 'nvenc' } }),
			job('03', { position: 2, reservations: { hardwareBackend: 'qsv' } }),
		],
		0,
		capacity({ configuredConcurrency: 4 }),
	);

	assert.deepEqual(admission.admitted, [jobId('01'), jobId('03')]);
	assert.deepEqual(admission.deferred, [{ jobId: jobId('02'), reason: 'hardware-busy' }]);
});

test('a backend already busy elsewhere defers its job', () => {
	const admission = admitNativeQueueJobs(
		[job('01', { reservations: { hardwareBackend: 'videotoolbox' } })],
		0,
		capacity({ busyHardwareBackends: ['videotoolbox'] }),
	);

	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'hardware-busy' }]);
});

test('admitted reservations are deducted so the next job sees what is left', () => {
	const admission = admitNativeQueueJobs(
		[
			job('01', { position: 0, reservations: { cpuCores: 6 } }),
			job('02', { position: 1, reservations: { cpuCores: 6 } }),
		],
		0,
		capacity({ availableCpuCores: 8 }),
	);

	assert.deepEqual(admission.admitted, [jobId('01')]);
	assert.deepEqual(admission.deferred, [{ jobId: jobId('02'), reason: 'cpu-reservation' }]);
});

test('a deferral never reorders the queue behind the user', () => {
	// The large job stays first and is deferred; the small job does not overtake it
	// into admission, it simply also gets its turn evaluated in place.
	const admission = admitNativeQueueJobs(
		[
			job('01', { position: 0, reservations: { cpuCores: 64 } }),
			job('02', { position: 1, reservations: { cpuCores: 1 } }),
		],
		0,
		capacity({ availableCpuCores: 8 }),
	);

	assert.deepEqual(admission.admitted, [jobId('02')]);
	assert.deepEqual(admission.deferred, [{ jobId: jobId('01'), reason: 'cpu-reservation' }]);
});

test('only queued rows are admissible', () => {
	const paused = applyNativeQueueTransition(job('01'), { kind: 'pause' }, 10).record;
	const running = applyNativeQueueTransition(job('02'), { kind: 'dispatch' }, 10).record;

	const admission = admitNativeQueueJobs([paused, running, job('03')], 0, capacity());
	assert.deepEqual(admission.admitted, [jobId('03')]);
	assert.deepEqual(admission.deferred, []);
});

test('malformed capacity is refused rather than treated as unlimited', () => {
	for (const overrides of [
		{ availableCpuCores: -1 },
		{ availableProcessTreeRssBytes: 1.5 },
		{ volumeFreeBytes: Number.NaN },
		{ reservedFreeBytes: -1 },
	]) {
		assert.throws(
			() => admitNativeQueueJobs([job('01')], 0, capacity(overrides as never)),
			NativeQueueAdmissionError,
		);
	}
	assert.throws(() => admitNativeQueueJobs([job('01')], -1, capacity()), /runningCount/u);
});

function capacity(overrides: Partial<NativeQueueCapacityV1> = {}): NativeQueueCapacityV1 {
	return {
		availableCpuCores: 16,
		availableProcessTreeRssBytes: 8 * GIB,
		availableScratchBytes: 100 * GIB,
		volumeFreeBytes: 500 * GIB,
		reservedFreeBytes: 10 * GIB,
		...overrides,
	};
}

function jobId(suffix: string): string {
	return suffix.repeat(20);
}

function job(
	suffix: string,
	overrides: Readonly<{
		position?: number;
		reservations?: Partial<NativeQueueRecordV1['reservations']>;
	}> = {},
): NativeQueueRecordV1 {
	return createNativeQueueRecordV1({
		jobId: jobId(suffix),
		taskKind: 'encoded-export',
		planVersion: 6,
		planFingerprint: 'a'.repeat(64),
		planPayload: '{"version":6}',
		projectId: 'project-1',
		projectRevision: 1,
		inputFingerprints: [],
		rootGrantId: 'f'.repeat(32),
		relativeDestination: `exports/reel-${suffix}.mp4`,
		reservations: {
			cpuCores: 1,
			processTreeRssBytes: 512 * 1024 * 1024,
			scratchBytes: GIB,
			minimumFreeBytes: 0,
			hardwareBackend: null,
			...overrides.reservations,
		},
		position: overrides.position ?? 0,
		createdAtMs: 0,
	});
}
