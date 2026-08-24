/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { startFramescaperNativeServicesRuntimeV3 } from '../desktop/native-services-runtime-v3.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../src/common/editor/native-media-v14-render-family.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('graceful V3 shutdown leaves active atomic work recoverable instead of cancelling it', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-shutdown-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const databasePath = join(root, 'services.sqlite');
	let now = 1_000;
	let started!: () => void;
	const didStart = new Promise<void>((resolve) => { started = resolve; });
	const cleanup: string[] = [];
	const first = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-shutdown-first', instanceId: 'instance-shutdown-first',
		processId: 71, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => ++now,
		nativeQueueExecution: {
			capacity: async () => capacity(),
			pool: { runJob: async (request) => {
				started();
				await new Promise<void>((_resolve, reject) => request.signal?.addEventListener(
					'abort', () => reject(new Error('shutdown')), { once: true },
				));
			} },
			prepare: async (record) => ({
				request: { kind: 'media-render', grant: {
					plan: { sha256: record.planFingerprint },
				} as never },
				publish: async () => undefined,
				cleanup: async (outcome) => { cleanup.push(outcome); },
			}),
		},
	});
	await first.ready;
	const grantId = 'ab'.repeat(16);
	first.roots.authorize({
		grantId, rootPath: root, volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
		authorizedAtMs: ++now,
	}, first.lease.lease(), now);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const record = createNativeQueueRecordV3({
		jobId: 'cd'.repeat(20), taskKind: 'encoded-export', plan,
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: grantId, relativeDestination: 'output.mov', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: ++now,
	});
	first.queue.enqueue(record, first.lease.lease(), now);
	void first.queueDispatcher!.dispatch([record]).catch(() => undefined);
	await didStart;
	await first.close();
	assert.deepEqual(cleanup, ['paused']);

	const second = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-shutdown-second', instanceId: 'instance-shutdown-second',
		processId: 72, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		capabilities: renderQueueCapabilities,
		watchProjectState: () => Object.freeze({ open: true, writable: true }),
		now: () => now + 10_000,
		revalidate: ({ rootAuthorized }) => ({
			projectRevisionMatches: true, planFingerprintMatches: true,
			inputFingerprintsMatch: true, rootGrantAuthorized: rootAuthorized,
			rootGrantValid: true, licensingCleared: true, helperBuildMatches: true,
			scratchIdentityMatches: true,
		}),
	});
	try {
		await second.ready;
		assert.equal(second.queue.read(record.jobId)?.state, 'paused');
		assert.equal(second.queue.read(record.jobId)?.lastFailureCode, 'awaiting-carrier-regeneration');
		const resumed = await second.controller.resumeRegeneratedQueue({
			taskKind: record.taskKind, planVersion: record.planVersion,
			derivedInputStageId: record.jobId, planFingerprint: record.planFingerprint,
			planPayload: record.planPayload, projectId: record.projectId,
			projectRevision: record.projectRevision, inputFingerprints: record.inputFingerprints,
			rootGrantId: record.rootGrantId, relativeDestination: record.relativeDestination,
			reservations: record.reservations, recoveryClass: record.recoveryClass,
		});
		assert.equal(resumed?.state, 'queued');
		assert.equal(resumed?.lastFailureCode, null);
	} finally { await second.close(); }
});

test('a queued carrier row restarts into carrier regeneration, not a false fingerprint block', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-queued-carrier-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const databasePath = join(root, 'services.sqlite');
	let now = 20_000;
	const first = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-queued-first', instanceId: 'instance-queued-first',
		processId: 81, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => ++now,
	});
	let record;
	try {
		await first.ready;
		const grantId = authorizeTestRoot(first, root, ++now);
		// Capacity-deferred: enqueued but never dispatched, so its live-staged
		// carrier exists only in this process and dies with it.
		record = enqueueCarrier(first, grantId, '44'.repeat(20), ++now);
		assert.equal(first.queue.read(record.jobId)?.state, 'queued');
	} finally { await first.close(); }
	const second = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-queued-second', instanceId: 'instance-queued-second',
		processId: 82, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => now + 10_000,
		// The real revalidator exempts rows already awaiting regeneration and
		// reports the lost process-local carrier as unmatched inputs for every
		// other state — which diagnosed a queued row's lost carrier as changed
		// inputs and blocked it outside the regeneration flow.
		revalidate: ({ record, rootAuthorized }) => ({
			projectRevisionMatches: true, planFingerprintMatches: true,
			inputFingerprintsMatch: record.state === 'paused'
				&& record.lastFailureCode === 'awaiting-carrier-regeneration',
			rootGrantAuthorized: rootAuthorized,
			rootGrantValid: true, licensingCleared: true, helperBuildMatches: true,
			scratchIdentityMatches: true,
		}),
	});
	try {
		await second.ready;
		assert.equal(second.queue.read(record.jobId)?.state, 'paused');
		assert.equal(second.queue.read(record.jobId)?.lastFailureCode, 'awaiting-carrier-regeneration');
	} finally { await second.close(); }
});

test('a rich-plan proxy restarts without waiting for renderer carrier regeneration', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-ready-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const databasePath = join(root, 'services.sqlite');
	let now = 20_000;
	let firstStarted!: () => void;
	const didFirstStart = new Promise<void>((resolve) => { firstStarted = resolve; });
	const firstCleanup: string[] = [];
	const first = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-ready-first', instanceId: 'instance-ready-first',
		processId: 73, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => ++now,
		nativeQueueExecution: {
			capacity: async () => capacity(),
			pool: { runJob: async (request) => {
				firstStarted();
				await new Promise<void>((_resolve, reject) => {
					const abort = (): void => reject(new Error('graceful shutdown'));
					if (request.signal?.aborted) abort();
					else request.signal?.addEventListener('abort', abort, { once: true });
				});
			} },
			prepare: async (current) => ({
				request: { kind: 'media-proxy', grant: {
					plan: { sha256: current.planFingerprint },
				} as never }, publish: async () => undefined,
				cleanup: async (outcome) => { firstCleanup.push(outcome); },
			}),
		},
	});
	await first.ready;
	const grantId = 'ef'.repeat(16);
	first.roots.authorize({ grantId, rootPath: root, volumeIdentity: 'volume-b',
		directoryIdentity: 'directory-b', authorizedAtMs: ++now }, first.lease.lease(), now);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	assert.equal(nativeMediaV14RequiresEvaluatedCarrier(plan), true,
		'the project plan is deliberately rich even though proxy work never consumes its carrier');
	const record = createNativeQueueRecordV3({
		jobId: '12'.repeat(20), taskKind: 'proxy-generation', plan,
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: grantId, relativeDestination: 'proxy.mov', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: ++now,
	});
	first.queue.enqueue(record, first.lease.lease(), now);
	void first.queueDispatcher!.dispatch([record]).catch(() => undefined);
	await didFirstStart;
	await first.close();
	assert.deepEqual(firstCleanup, ['paused']);

	let started!: () => void; let release!: () => void;
	const didStart = new Promise<void>((resolve) => { started = resolve; });
	const barrier = new Promise<void>((resolve) => { release = resolve; });
	const second = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-ready-second', instanceId: 'instance-ready-second',
		processId: 74, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => ++now, revalidate: ({ rootAuthorized }) => ({
			projectRevisionMatches: true, planFingerprintMatches: true,
			inputFingerprintsMatch: true, rootGrantAuthorized: rootAuthorized,
			rootGrantValid: true, licensingCleared: true, helperBuildMatches: true,
			scratchIdentityMatches: true,
		}),
		nativeQueueExecution: {
			capacity: async () => capacity(),
			pool: { runJob: async () => { started(); await barrier; return {}; } },
			prepare: async (current) => ({
				request: { kind: 'media-proxy', grant: {
					plan: { sha256: current.planFingerprint },
				} as never }, publish: async () => undefined,
			}),
		},
	});
	try {
		await second.ready;
		await waitFor(() => second.queue.read(record.jobId)?.state === 'running');
		await didStart;
		assert.equal(second.queue.read(record.jobId)?.lastFailureCode, null);
		release();
		await waitFor(() => second.queue.read(record.jobId)?.state === 'completed');
	} finally {
		release?.();
		await second.close();
	}
});

test('inactive carrier pause and cancel remove capacity-deferred replay custody before returning', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-inactive-carrier-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let now = 30_000;
	const removed: string[] = [];
	const runtime = startFramescaperNativeServicesRuntimeV3({
		databasePath: ':memory:', leaseId: 'lease-inactive-carrier',
		instanceId: 'instance-inactive-carrier', processId: 75,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true, now: () => ++now,
		removeRenderInputs: async (record) => { removed.push(record.jobId); },
		nativeQueueExecution: {
			capacity: async () => capacity(),
			pool: { runJob: async () => { throw new Error('capacity-deferred work must not run'); } },
			prepare: async () => { throw new Error('capacity-deferred work must not prepare'); },
		},
	});
	try {
		await runtime.ready;
		const grantId = authorizeTestRoot(runtime, root, ++now);
		const paused = enqueueCarrier(runtime, grantId, '31'.repeat(20), ++now);
		const pauseResult = await runtime.controller.control({ jobId: paused.jobId, action: 'pause' });
		assert.equal(pauseResult.state, 'paused');
		assert.equal(pauseResult.lastFailureCode, 'awaiting-carrier-regeneration');
		const cancelled = enqueueCarrier(runtime, grantId, '32'.repeat(20), ++now);
		assert.equal((await runtime.controller.control({
			jobId: cancelled.jobId, action: 'cancel',
		})).state, 'cancelled');
		assert.deepEqual(removed, [paused.jobId, cancelled.jobId]);
	} finally { await runtime.close(); }
});

test('active early-prepare carrier controls clean custody, while root reauthorization retains it', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-early-carrier-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const action of ['pause', 'cancel'] as const) {
		let now = action === 'pause' ? 32_000 : 34_000;
		let entered!: () => void; let release!: () => void;
		const didEnter = new Promise<void>((resolve) => { entered = resolve; });
		const barrier = new Promise<void>((resolve) => { release = resolve; });
		const removed: string[] = [];
		const runtime = startFramescaperNativeServicesRuntimeV3({
			databasePath: ':memory:', leaseId: `lease-early-${action}`,
			instanceId: `instance-early-${action}`, processId: action === 'pause' ? 76 : 77,
			runtimeAvailable: () => true, nativeMediaEnabled: () => true, now: () => ++now,
			removeRenderInputs: async (record) => { removed.push(record.jobId); },
			nativeQueueExecution: {
				capacity: async () => capacity(), pool: { runJob: async () => ({}) },
				prepare: async () => { entered(); await barrier; throw new Error('early prepare failed'); },
			},
		});
		try {
			await runtime.ready;
			const grantId = authorizeTestRoot(runtime, root, ++now);
			const record = enqueueCarrier(runtime, grantId,
				action === 'pause' ? '33'.repeat(20) : '34'.repeat(20), ++now);
			void runtime.queueDispatcher!.dispatch([record]).catch(() => undefined);
			await didEnter;
			await runtime.controller.control({ jobId: record.jobId, action });
			release();
			await waitFor(() => removed.includes(record.jobId));
			assert.equal(runtime.queue.read(record.jobId)?.state,
				action === 'pause' ? 'paused' : 'cancelled');
		} finally { release?.(); await runtime.close(); }
	}

	let now = 36_000;
	const removed: string[] = [];
	const runtime = startFramescaperNativeServicesRuntimeV3({
		databasePath: ':memory:', leaseId: 'lease-root-retention',
		instanceId: 'instance-root-retention', processId: 78,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true, now: () => ++now,
		removeRenderInputs: async (record) => { removed.push(record.jobId); },
		nativeQueueExecution: {
			capacity: async () => capacity(), pool: { runJob: async () => ({}) },
			prepare: async () => { throw new Error('revoked root must fail before prepare'); },
		},
	});
	try {
		await runtime.ready;
		const grantId = authorizeTestRoot(runtime, root, ++now);
		const record = enqueueCarrier(runtime, grantId, '35'.repeat(20), ++now);
		runtime.roots.revoke(grantId, ++now, runtime.lease.lease());
		await runtime.queueDispatcher!.dispatch([record]);
		assert.equal(runtime.queue.read(record.jobId)?.state, 'needs-authorization');
		assert.deepEqual(removed, [], 'pathless root reauthorization retains the exact replay carrier');
	} finally { await runtime.close(); }
});

test('explicit pathless root reauthorization replaces only an identical revoked grant after full revalidation', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v3-reauthorize-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let now = 40_000;
	const oldGrantId = '34'.repeat(16);
	const newGrantId = '56'.repeat(16);
	let selection: null | Readonly<{
		grantId: string; rootPath: string; volumeIdentity: string;
		directoryIdentity: string; authorizedAtMs: number;
	}> = null;
	let revalidations = 0;
	const databasePath = join(root, 'services.sqlite');
	const runtime = startFramescaperNativeServicesRuntimeV3({
		databasePath, leaseId: 'lease-reauthorize',
		instanceId: 'instance-reauthorize', processId: 75,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		capabilities: renderQueueCapabilities,
		watchProjectState: () => Object.freeze({ open: true, writable: true }),
		now: () => ++now,
		selectRoot: async () => selection,
		probeRoot: async (grant) => Object.freeze({
			exists: true, directory: true, symbolicLink: false, canonicalPath: grant.rootPath,
			volumeIdentity: grant.volumeIdentity, directoryIdentity: grant.directoryIdentity,
		}),
		revalidate: ({ root: candidate, rootAuthorized }) => {
			revalidations += 1;
			return Object.freeze({
				projectRevisionMatches: true, planFingerprintMatches: true,
				inputFingerprintsMatch: true, rootGrantAuthorized: rootAuthorized,
				rootGrantValid: candidate?.grantId === newGrantId,
				licensingCleared: true, helperBuildMatches: true, scratchIdentityMatches: true,
			});
		},
	});
	try {
		await runtime.ready;
		runtime.roots.authorize({ grantId: oldGrantId, rootPath: root,
			volumeIdentity: 'volume-c', directoryIdentity: 'directory-c', authorizedAtMs: ++now,
		}, runtime.lease.lease(), now);
		const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
		const project = createFramescaperProjectV28(profile, framescaperV20Options());
		const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
			profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
		);
		const row = runtime.queue.enqueue(createNativeQueueRecordV3({
			jobId: '78'.repeat(20), taskKind: 'encoded-export', plan,
			projectId: String(project.id), projectRevision: Number(project.revision),
			inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
			rootGrantId: oldGrantId, relativeDestination: 'output.mov',
			reservations: { cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
				minimumFreeBytes: 0, hardwareBackend: null }, position: 0, createdAtMs: ++now,
		}), runtime.lease.lease(), now);
		runtime.roots.revoke(oldGrantId, ++now, runtime.lease.lease());
		runtime.queue.control(row.jobId, { kind: 'require-authorization' }, runtime.lease.lease(), ++now);
		assert.equal(await runtime.controller.reauthorizeQueueRoot({ jobId: row.jobId }), null,
			'picker cancellation changes neither queue nor grants');
		assert.equal(runtime.queue.read(row.jobId)?.rootGrantId, oldGrantId);
		selection = Object.freeze({ grantId: newGrantId, rootPath: `${root}/different`,
			volumeIdentity: 'volume-c', directoryIdentity: 'directory-d', authorizedAtMs: ++now });
		await assert.rejects(() => runtime.controller.reauthorizeQueueRoot({ jobId: row.jobId }), /same directory/iu);
		assert.equal(runtime.roots.read(newGrantId), null);
		selection = Object.freeze({ grantId: newGrantId, rootPath: root,
			volumeIdentity: 'volume-c', directoryIdentity: 'directory-c', authorizedAtMs: ++now });
		const sabotage = new DatabaseSync(databasePath);
		try {
			sabotage.exec(`CREATE TRIGGER fail_root_swap BEFORE UPDATE ON render_queue_jobs
				WHEN OLD.job_id = '${row.jobId}' BEGIN SELECT RAISE(ABORT, 'forced root swap failure'); END`);
			await assert.rejects(
				() => runtime.controller.reauthorizeQueueRoot({ jobId: row.jobId }),
				/forced root swap failure/iu,
			);
			assert.equal(runtime.roots.read(newGrantId), null,
				'a failed queue compare-and-swap rolls its new grant back');
			assert.equal(runtime.queue.read(row.jobId)?.rootGrantId, oldGrantId);
			sabotage.exec('DROP TRIGGER fail_root_swap');
		} finally { sabotage.close(); }
		const authorized = await runtime.controller.reauthorizeQueueRoot({ jobId: row.jobId });
		assert.equal(authorized?.state, 'queued');
		assert.equal(runtime.queue.read(row.jobId)?.rootGrantId, newGrantId);
		assert.equal(runtime.queue.read(row.jobId)?.lastFailureCode, null);
		assert.notEqual(runtime.roots.read(newGrantId), null);
		assert.notEqual(runtime.roots.read(oldGrantId)?.revokedAtMs, null,
			'the old grant remains durably revoked');
		assert.equal(revalidations, 2);
	} finally { await runtime.close(); }
});

function authorizeTestRoot(
	runtime: ReturnType<typeof startFramescaperNativeServicesRuntimeV3>, rootPath: string, atMs: number,
): string {
	const grantId = `${atMs.toString(16).padStart(32, '0')}`;
	runtime.roots.authorize({ grantId, rootPath, volumeIdentity: 'volume-test',
		directoryIdentity: `directory-${grantId}`, authorizedAtMs: atMs }, runtime.lease.lease(), atMs);
	return grantId;
}

function enqueueCarrier(
	runtime: ReturnType<typeof startFramescaperNativeServicesRuntimeV3>,
	rootGrantId: string, jobId: string, atMs: number,
) {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	assert.equal(nativeMediaV14RequiresEvaluatedCarrier(plan), true);
	return runtime.queue.enqueue(createNativeQueueRecordV3({
		jobId, taskKind: 'encoded-export', plan, projectId: String(project.id),
		projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId, relativeDestination: `${jobId}.mov`, reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: atMs,
	}), runtime.lease.lease(), atMs);
}

function capacity() {
	return {
		configuredConcurrency: 1, availableCpuCores: 4,
		availableProcessTreeRssBytes: 1024 ** 3, availableScratchBytes: 1024 ** 3,
		volumeFreeBytes: 20 * 1024 ** 3, reservedFreeBytes: 10 * 1024 ** 3,
		busyHardwareBackends: [],
	};
}

function renderQueueCapabilities() {
	return createNativeMediaCapabilitySnapshotV1({ masterEnabled: true, entries: [{
		...NATIVE_MEDIA_CAPABILITY_IDS.renderQueue, policyCleared: true,
		buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true,
	}] });
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail('Timed out waiting for the V3 queue state.');
}
