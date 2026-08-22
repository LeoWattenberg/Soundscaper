/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	startFramescaperNativeServicesRuntime,
} from '../desktop/native-services-runtime.ts';
import { FramescaperNativeProjectAuthority } from '../desktop/native-services-project-authority.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

test('the main-owned runtime composes one fenced database and truthful controller', async () => {
	let mediaEnabled = false;
	const runtime = startFramescaperNativeServicesRuntime({
		databasePath: ':memory:',
		leaseId: 'lease-native-runtime',
		instanceId: 'instance-native-runtime',
		processId: 42,
		runtimeAvailable: () => false,
		nativeMediaEnabled: () => mediaEnabled,
		now: () => 1_000,
	});
	await runtime.ready;

	assert.equal(runtime.databaseVersion, 2);
	assert.equal(runtime.controller.snapshot().runtimeAvailable, false);
	assert.equal(runtime.controller.snapshot().nativeMediaEnabled, false);
	mediaEnabled = true;
	assert.equal(runtime.controller.snapshot().nativeMediaEnabled, true);
	assert.deepEqual(runtime.controller.snapshot().queue, []);
	assert.deepEqual(runtime.controller.snapshot().roots, []);
	assert.deepEqual(runtime.controller.snapshot().watchRules, []);
	assert.ok(runtime.queue);
	assert.ok(runtime.roots);
	assert.ok(runtime.watch);
	assert.ok(runtime.scratch);
	const closing = runtime.close();
	assert.equal(runtime.close(), closing);
	assert.equal(await closing, true);
});

test('an unqualified startup recovery is fail-closed and never dispatches', async () => {
	const recoveries: unknown[] = [];
	const runtime = startFramescaperNativeServicesRuntime({
		databasePath: ':memory:',
		leaseId: 'lease-native-recovery',
		instanceId: 'instance-native-recovery',
		processId: 43,
		runtimeAvailable: () => false,
		nativeMediaEnabled: () => false,
		now: () => 2_000,
		onRecovery: (rows) => recoveries.push(...rows),
	});
	await runtime.ready;
	assert.deepEqual(recoveries, []);
	assert.deepEqual(runtime.queue.dispatchReady(runtime.lease.lease(), 2_001, {
		configuredConcurrency: 2,
		availableCpuCores: 8,
		availableProcessTreeRssBytes: 1_073_741_824,
		availableScratchBytes: 0,
		volumeFreeBytes: 0,
		reservedFreeBytes: 0,
	}).records, []);
	await runtime.close();
});

test('qualified recovery reaches an explicitly mounted dispatcher during startup', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-runtime-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const databasePath = join(temporary, 'services.sqlite');
	const first = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-native-first', instanceId: 'instance-native-first',
		processId: 44, runtimeAvailable: () => false, nativeMediaEnabled: () => false,
		now: () => 3_000,
	});
	await first.ready;
	const rootGrantId = 'ab'.repeat(16);
	first.roots.authorize({
		grantId: rootGrantId, rootPath: '/private/exports', volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a', authorizedAtMs: 3_000,
	}, first.lease.lease(), 3_000);
	const record = createNativeQueueRecordV2({
		jobId: 'cd'.repeat(20), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1, inputFingerprints: [], rootGrantId,
		relativeDestination: 'programme.mp4', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: 3_000,
	});
	first.queue.enqueue(record, first.lease.lease(), 3_000);
	first.queue.control(record.jobId, { kind: 'dispatch' }, first.lease.lease(), 3_000);
	await first.close();

	const dispatched: string[] = [];
	const second = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-native-second', instanceId: 'instance-native-second',
		processId: 45, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => 30_000,
		revalidate: ({ rootAuthorized }) => ({
			projectRevisionMatches: true, planFingerprintMatches: true,
			inputFingerprintsMatch: true, rootGrantAuthorized: rootAuthorized,
			rootGrantValid: true, licensingCleared: true, helperBuildMatches: true,
			scratchIdentityMatches: true,
		}),
		dispatchRecovered: (records) => { dispatched.push(...records.map((row) => row.jobId)); },
	});
	await second.ready;
	assert.deepEqual(dispatched, [record.jobId]);
	assert.equal(second.queue.read(record.jobId)?.state, 'queued');
	await second.close();
});

test('startup leaves terminal rows visible without invoking project exact-plan revalidation', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-terminal-runtime-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const databasePath = join(temporary, 'services.sqlite');
	const first = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-terminal-first', instanceId: 'instance-terminal-first',
		processId: 48, runtimeAvailable: () => false, nativeMediaEnabled: () => false,
		now: () => 5_000,
	});
	await first.ready;
	const rootGrantId = 'ad'.repeat(16);
	first.roots.authorize({
		grantId: rootGrantId, rootPath: '/private/exports', volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a', authorizedAtMs: 5_000,
	}, first.lease.lease(), 5_000);
	const record = createNativeQueueRecordV2({
		jobId: 'cf'.repeat(20), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1, inputFingerprints: [], rootGrantId,
		relativeDestination: 'terminal.mp4', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: 5_000,
	});
	first.queue.enqueue(record, first.lease.lease(), 5_000);
	first.queue.control(record.jobId, { kind: 'fail', code: 'test-failure' }, first.lease.lease(), 5_000);
	await first.close();

	let revalidations = 0;
	const second = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-terminal-second', instanceId: 'instance-terminal-second',
		processId: 49, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => 50_000,
		revalidate: () => {
			revalidations += 1;
			throw new Error('terminal rows must not ask the project for exact-plan authority');
		},
	});
	await second.ready;
	assert.equal(revalidations, 0);
	assert.equal(second.queue.read(record.jobId)?.state, 'failed');
	await second.close();
});

test('runtime close waits for an in-progress watch reconciliation before closing its database', async () => {
	let enterScan!: () => void;
	const scanEntered = new Promise<void>((resolve) => { enterScan = resolve; });
	let releaseScan!: () => void;
	const scanBarrier = new Promise<void>((resolve) => { releaseScan = resolve; });
	const runtime = startFramescaperNativeServicesRuntime({
		databasePath: ':memory:', leaseId: 'lease-watch-close', instanceId: 'instance-watch-close',
		processId: 50, runtimeAvailable: () => false, nativeMediaEnabled: () => false,
		now: () => 60_000,
		watchScan: async () => { enterScan(); await scanBarrier; return []; },
		watchProbe: async () => ({ succeeded: false, contentSha256: null }),
		watchProjectState: () => ({ open: true, writable: true }),
		watchImportFile: async () => true,
		watchFactory: () => ({ close: () => undefined }),
	});
	await runtime.ready;
	const rootGrantId = 'ae'.repeat(16);
	runtime.roots.authorize({
		grantId: rootGrantId, rootPath: '/private/watch', volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a', authorizedAtMs: 60_000,
	}, runtime.lease.lease(), 60_000);
	runtime.watch.create({
		ruleId: 'af'.repeat(16), grantId: rootGrantId, projectId: 'project-1',
		extensions: ['mov'], createdAtMs: 60_000,
	}, runtime.lease.lease(), 60_000);
	runtime.watchCoordinator.refreshHints();
	const reconciling = runtime.watchCoordinator.reconcileNow();
	await scanEntered;
	let closed = false;
	const closing = runtime.close().then((result) => { closed = true; return result; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	const closedBeforeRelease = closed;
	releaseScan();
	const [reconciled, closeResult] = await Promise.allSettled([reconciling, closing]);
	assert.equal(closedBeforeRelease, false);
	assert.equal(reconciled.status, 'fulfilled');
	assert.deepEqual(closeResult, { status: 'fulfilled', value: true });
});

test('startup recovery dispatch uses frame counts reverified by project authority', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-checkpoint-runtime-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const databasePath = join(temporary, 'services.sqlite');
	const first = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-checkpoint-first', instanceId: 'instance-checkpoint-first',
		processId: 46, runtimeAvailable: () => false, nativeMediaEnabled: () => false,
		now: () => 4_000,
	});
	await first.ready;
	const rootGrantId = 'ac'.repeat(16);
	const root = first.roots.authorize({
		grantId: rootGrantId, rootPath: '/private/exports', volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a', authorizedAtMs: 4_000,
	}, first.lease.lease(), 4_000);
	const inputs = Object.freeze([
		Object.freeze({ sourceId: 'source-a', sha256: '12'.repeat(32) }),
		Object.freeze({ sourceId: 'source-b', sha256: '34'.repeat(32) }),
	]);
	const record = createNativeQueueRecordV2({
		jobId: 'ce'.repeat(20), taskKind: 'image-sequence-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 7, inputFingerprints: inputs, rootGrantId,
		relativeDestination: 'frames/frame.png', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 4_096,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, recoveryClass: 'verified-frame-checkpoint', position: 0, createdAtMs: 4_000,
	});
	first.queue.enqueue(record, first.lease.lease(), 4_000);
	first.queue.control(record.jobId, { kind: 'dispatch' }, first.lease.lease(), 4_000);
	await first.close();

	const sourceInventoryDigest = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
	const manifest = Object.freeze([0, 1].map((frameIndex) => Object.freeze({
		frameIndex, relativePath: `frames/frame-${String(frameIndex).padStart(6, '0')}.png`,
		byteLength: frameIndex + 10, sha256: String(frameIndex + 1).repeat(64),
		planFingerprint: record.planFingerprint, sourceInventoryDigest,
	})));
	const authority = new FramescaperNativeProjectAuthority({
		project: {
			projectState: () => Object.freeze({ open: true, writable: true }),
			projectRecord: () => Object.freeze({
				projectId: record.projectId, projectRevision: record.projectRevision,
				projectSha256: '56'.repeat(32),
				bodies: Object.freeze(inputs.map((input) => Object.freeze({
					kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
					sourceId: input.sourceId, storageKey: input.sourceId, mimeType: 'video/mp4',
					byteLength: 1, sha256: input.sha256,
				}))),
			}),
			readProjectBundle: async () => null, readBody: async () => new Uint8Array(),
		},
		scratchRoot: '/private/scratch',
		executable: () => Object.freeze({
			path: '/private/media-host', byteLength: 1, sha256: '78'.repeat(32),
			identity: Object.freeze({ dev: 1, ino: 2 }),
		}),
		createMessageChannel: () => { throw new Error('must not stage during recovery'); },
		probeRoot: async () => Object.freeze({
			exists: true, directory: true, symbolicLink: false, canonicalPath: root.rootPath,
			volumeIdentity: root.volumeIdentity, directoryIdentity: root.directoryIdentity,
		}),
		publicationPortFor: () => { throw new Error('must not publish during recovery'); },
		publicationFenceFor: () => { throw new Error('must not fence during recovery'); },
		reserveScratch: () => undefined, settleScratch: async () => undefined,
		scratchMatches: () => true, licensingCleared: () => true,
		checkpointStore: {
			read: async () => Object.freeze({
				version: 1 as const, jobId: record.jobId, planFingerprint: record.planFingerprint,
				sourceInventoryDigest, plannedFrameCount: 30, manifest,
			}),
			write: async () => undefined,
		},
		checkpointInspectFor: () => async (frame) => Object.freeze({
			byteLength: frame.byteLength, sha256: frame.sha256, symbolicLink: false,
		}),
		onCheckpointError: (error) => { throw error; },
	});
	const dispatched: Array<{ jobId: string; progress: number | null }> = [];
	const second = startFramescaperNativeServicesRuntime({
		databasePath, leaseId: 'lease-checkpoint-second', instanceId: 'instance-checkpoint-second',
		processId: 47, runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		now: () => 40_000,
		revalidate: ({ record: current, root: currentRoot, rootAuthorized }) => (
			authority.revalidate(current, currentRoot, rootAuthorized)
		),
		dispatchRecovered: (records) => {
			dispatched.push(...records.map(({ jobId, progress }) => ({ jobId, progress })));
		},
	});
	await second.ready;
	assert.deepEqual(dispatched, [{ jobId: record.jobId, progress: 2 / 30 }]);
	assert.equal(second.queue.read(record.jobId)?.progress, 2 / 30);
	await second.close();
});
