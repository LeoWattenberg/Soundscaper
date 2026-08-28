/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FramescaperNativeMediaQueueDispatcher } from '../desktop/native-media-queue-dispatcher.ts';
import { startFramescaperNativeServicesRuntime } from '../desktop/native-services-runtime.ts';
import type { NativeQueueCapacityV1 } from '../src/common/editor/native-queue-admission.ts';
import { createNativeQueueRecordV2, type NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

test('the durable dispatcher reparses V7-V12, limits concurrency, runs the pool, publishes, and completes', async () => {
	let now = 1_000;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const records = queueRecords(runtime, 3, ++now);
		let active = 0;
		let maximumActive = 0;
		const published: string[] = [];
		const cleaned: Array<Readonly<{ jobId: string; outcome: string }>> = [];
		const dispatcher = new FramescaperNativeMediaQueueDispatcher({
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			capacity: async () => capacity(),
			pool: {
				async runJob(request) {
					active += 1;
					maximumActive = Math.max(maximumActive, active);
					request.onProgress?.(0.5);
					await new Promise<void>((resolve) => setImmediate(resolve));
					active -= 1;
					return { output: true };
				},
			},
			prepare: async (record) => {
				assert.equal(record.state, 'running');
				assert.equal(runtime.queue.read(record.jobId)?.state, 'running');
				return {
					request: {
						kind: 'media-render',
						grant: { plan: { sha256: record.planFingerprint } } as never,
					},
					publish: async () => { published.push(record.jobId); },
					cleanup: async (outcome) => { cleaned.push({ jobId: record.jobId, outcome }); },
				};
			},
		});
		await dispatcher.dispatch(records);
		assert.equal(maximumActive, 2);
		assert.deepEqual(published.sort(), records.map(({ jobId }) => jobId).sort());
		assert.deepEqual(records.map(({ jobId }) => runtime.queue.read(jobId)?.state), [
			'completed', 'completed', 'completed',
		]);
		assert.deepEqual(cleaned.map(({ outcome }) => outcome), ['succeeded', 'succeeded', 'succeeded']);
		assert.equal(await dispatcher.dispose(), true);
	} finally {
		await runtime.close();
	}
});

test('unavailable policy and a mismatched prepared plan remain fail-closed without helper execution', async () => {
	let now = 2_000;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const [record] = queueRecords(runtime, 1, ++now);
		let poolCalls = 0;
		const errors: unknown[] = [];
		const base = {
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, nativeMediaEnabled: () => true,
			capacity: async () => capacity(),
			pool: { runJob: async () => { poolCalls += 1; } },
			prepare: async () => ({
				request: {
					kind: 'media-render' as const,
					grant: { plan: { sha256: '0'.repeat(64) } } as never,
				},
				publish: async () => undefined,
			}),
			onError: (error: unknown) => { errors.push(error); },
		};
		const unavailable = new FramescaperNativeMediaQueueDispatcher({ ...base, available: () => false });
		await unavailable.dispatch([record!]);
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'queued');
		const mismatched = new FramescaperNativeMediaQueueDispatcher({ ...base, available: () => true });
		await mismatched.dispatch([record!]);
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'failed');
		assert.equal(runtime.queue.read(record!.jobId)?.lastFailureCode, 'native-prepare-failed');
		assert.equal(poolCalls, 0);
		assert.match(String(errors[0]), /exact plan fingerprint/u);
	} finally {
		await runtime.close();
	}
});

test('missing or invalid capacity fails closed without claiming queued work', async () => {
	let now = 2_500;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const [record] = queueRecords(runtime, 1, ++now);
		let poolCalls = 0;
		const base = {
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			pool: { runJob: async () => { poolCalls += 1; } },
			prepare: async (current: NativeQueueRecordV2) => ({
				request: {
					kind: 'media-render' as const,
					grant: { plan: { sha256: current.planFingerprint } } as never,
				},
				publish: async () => undefined,
			}),
		};
		assert.throws(
			() => new FramescaperNativeMediaQueueDispatcher(base as never),
			/capacity snapshot provider/iu,
		);
		const absent = new FramescaperNativeMediaQueueDispatcher({
			...base, capacity: async () => null,
		});
		await absent.dispatch([record!]);
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'queued');
		assert.equal(poolCalls, 0);
		const invalid = new FramescaperNativeMediaQueueDispatcher({
			...base, capacity: async () => ({ ...capacity(), availableCpuCores: -1 }),
		});
		await assert.rejects(invalid.dispatch([record!]), /availableCpuCores/u);
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'queued');
		assert.equal(poolCalls, 0);
	} finally {
		await runtime.close();
	}
});

test('deferred work waits for an explicit wake and hardware reservations stay exclusive', async () => {
	let now = 2_750;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const records = queueRecords(runtime, 2, ++now, { hardwareBackend: 'nvenc' });
		let available = false;
		let capacityCalls = 0;
		let active = 0;
		let maximumActive = 0;
		let helperStarts = 0;
		let enterFirst!: () => void;
		const firstStarted = new Promise<void>((resolve) => { enterFirst = resolve; });
		let releaseFirst!: () => void;
		const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const dispatcher = new FramescaperNativeMediaQueueDispatcher({
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			capacity: async () => {
				capacityCalls += 1;
				return capacity({
					configuredConcurrency: 4,
					availableCpuCores: available ? 8 : 0,
					busyHardwareBackends: active > 0 ? ['nvenc'] : [],
				});
			},
			pool: { runJob: async () => {
				active += 1;
				helperStarts += 1;
				maximumActive = Math.max(maximumActive, active);
				if (helperStarts === 1) {
					enterFirst();
					await firstBarrier;
				}
				active -= 1;
				return {};
			} },
			prepare: async (record) => ({
				request: {
					kind: 'media-render', grant: { plan: { sha256: record.planFingerprint } } as never,
				},
				publish: async () => undefined,
			}),
		});
		await dispatcher.dispatch(records);
		assert.equal(capacityCalls, 1, 'a deferred row must not create a self-waking drain loop');
		assert.deepEqual(records.map(({ jobId }) => runtime.queue.read(jobId)?.state), ['queued', 'queued']);
		available = true;
		const draining = dispatcher.dispatch(records);
		await firstStarted;
		const callsBeforeWake = capacityCalls;
		const explicitlyWoken = dispatcher.dispatch([records[1]!]);
		await waitFor(() => capacityCalls > callsBeforeWake);
		assert.equal(runtime.queue.read(records[1]!.jobId)?.state, 'queued');
		releaseFirst();
		await Promise.all([draining, explicitlyWoken]);
		assert.equal(maximumActive, 1);
		assert.deepEqual(records.map(({ jobId }) => runtime.queue.read(jobId)?.state), [
			'completed', 'completed',
		]);
		await dispatcher.dispose();
	} finally {
		await runtime.close();
	}
});

test('reorder changes the next durable dispatch rather than only its displayed position', async () => {
	let now = 3_000;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const records = queueRecords(runtime, 3, ++now);
		let releaseFirst!: () => void;
		const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const started: string[] = [];
		const dispatcher = new FramescaperNativeMediaQueueDispatcher({
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			capacity: async () => capacity({ configuredConcurrency: 1 }),
			pool: { async runJob(request) {
				const id = (request.grant as unknown as { output: { path: string } }).output.path;
				started.push(id);
				if (started.length === 1) await firstBarrier;
				return {};
			} },
			prepare: async (record) => ({
				request: {
					kind: 'media-render',
					grant: {
						plan: { sha256: record.planFingerprint }, output: { path: record.jobId },
					} as never,
				},
				publish: async () => undefined,
			}),
		});
		const draining = dispatcher.dispatch(records);
		await new Promise<void>((resolve) => setImmediate(resolve));
		runtime.queue.reorder(records[2]!.jobId, 0, runtime.lease.lease(), ++now);
		releaseFirst();
		await draining;
		assert.deepEqual(started, [records[0]!.jobId, records[2]!.jobId, records[1]!.jobId]);
		await dispatcher.dispose();
	} finally {
		await runtime.close();
	}
});

test('async dispatcher disposal aborts a running job and waits for authenticated cleanup', async () => {
	let now = 4_000;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const [record] = queueRecords(runtime, 1, ++now);
		let releaseCleanup!: () => void;
		const cleanupBarrier = new Promise<void>((resolve) => { releaseCleanup = resolve; });
		let helperStarted!: () => void;
		const helperStart = new Promise<void>((resolve) => { helperStarted = resolve; });
		const dispatcher = new FramescaperNativeMediaQueueDispatcher({
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			capacity: async () => capacity(),
			pool: { runJob: async (request) => {
				helperStarted();
				await new Promise<void>((_resolve, reject) => request.signal?.addEventListener(
					'abort', () => reject(request.signal?.reason ?? new Error('aborted')), { once: true },
				));
			} },
			prepare: async (current) => ({
				request: {
					kind: 'media-render', grant: { plan: { sha256: current.planFingerprint } } as never,
				},
				publish: async () => undefined,
				cleanup: async () => cleanupBarrier,
			}),
		});
		void dispatcher.dispatch([record!]).catch(() => undefined);
		await helperStart;
		let closed = false;
		const closing = dispatcher.dispose().then((result) => { closed = true; return result; });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(closed, false);
		releaseCleanup();
		assert.equal(await closing, true);
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'cancelled');
	} finally {
		await runtime.close();
	}
});

test('pausing a running selected-V20 job reports paused cleanup so durable V7 inputs can resume', async () => {
	let now = 5_000;
	const runtime = serviceRuntime(() => ++now);
	await runtime.ready;
	try {
		const [record] = queueRecords(runtime, 1, ++now);
		let helperStarted!: () => void;
		const started = new Promise<void>((resolve) => { helperStarted = resolve; });
		const outcomes: string[] = [];
		const dispatcher = new FramescaperNativeMediaQueueDispatcher({
			queue: runtime.queue, roots: runtime.roots, lease: () => runtime.lease.lease(),
			now: () => ++now, available: () => true, nativeMediaEnabled: () => true,
			capacity: async () => capacity(),
			pool: { runJob: async (request) => {
				helperStarted();
				await new Promise<void>((_resolve, reject) => request.signal?.addEventListener(
					'abort', () => reject(request.signal?.reason ?? new Error('aborted')), { once: true },
				));
			} },
			prepare: async (current) => ({
				request: {
					kind: 'media-render', grant: { plan: { sha256: current.planFingerprint } } as never,
				},
				publish: async () => undefined,
				cleanup: async (outcome) => { outcomes.push(outcome); },
			}),
		});
		const draining = dispatcher.dispatch([record!]);
		await started;
		const paused = runtime.queue.control(
			record!.jobId, { kind: 'pause' }, runtime.lease.lease(), ++now,
		);
		dispatcher.control(paused.record, 'pause');
		await draining;
		assert.equal(runtime.queue.read(record!.jobId)?.state, 'paused');
		assert.deepEqual(outcomes, ['paused']);
		assert.equal(runtime.queue.control(
			record!.jobId, { kind: 'resume' }, runtime.lease.lease(), ++now,
		).record.state, 'queued');
		await dispatcher.dispose();
	} finally {
		await runtime.close();
	}
});

function serviceRuntime(now: () => number) {
	return startFramescaperNativeServicesRuntime({
		databasePath: ':memory:', leaseId: `lease-${String(now())}`,
		instanceId: `instance-${String(now())}`, processId: 42,
		runtimeAvailable: () => false, nativeMediaEnabled: () => false, now,
	});
}

function queueRecords(
	runtime: ReturnType<typeof serviceRuntime>, count: number, createdAtMs: number,
	reservationOverrides: Partial<NativeQueueRecordV2['reservations']> = {},
): readonly NativeQueueRecordV2[] {
	const rootGrantId = 'ab'.repeat(16);
	if (runtime.roots.read(rootGrantId) === null) {
		runtime.roots.authorize({
			grantId: rootGrantId, rootPath: '/private/exports', volumeIdentity: 'volume-a',
			directoryIdentity: 'directory-a', authorizedAtMs: createdAtMs,
		}, runtime.lease.lease(), createdAtMs);
	}
	return Object.freeze(Array.from({ length: count }, (_, index) => {
		const record = createNativeQueueRecordV2({
			schemaFamily: 'framescaper', schemaVersion: 1,
			jobId: (index + 1).toString(16).padStart(2, '0').repeat(20),
			taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
			projectId: 'project-1', projectRevision: 1, inputFingerprints: [], rootGrantId,
			relativeDestination: `output-${String(index)}.mov`, reservations: {
				cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
				minimumFreeBytes: 0, hardwareBackend: null, ...reservationOverrides,
			}, position: index, createdAtMs,
		});
		return runtime.queue.enqueue(record, runtime.lease.lease(), createdAtMs);
	}));
}

function capacity(overrides: Partial<NativeQueueCapacityV1> = {}): NativeQueueCapacityV1 {
	return {
		availableCpuCores: 8,
		availableProcessTreeRssBytes: 1024 ** 3,
		availableScratchBytes: 1024 ** 3,
		volumeFreeBytes: 20 * 1024 ** 3,
		reservedFreeBytes: 10 * 1024 ** 3,
		busyHardwareBackends: [],
		...overrides,
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail('Timed out waiting for the native queue dispatcher.');
}
