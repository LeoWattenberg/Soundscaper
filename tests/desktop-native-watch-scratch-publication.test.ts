/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
	releaseFramescaperNativeServicesWriterLease,
} from '../desktop/native-services-database.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import {
	FramescaperNativeScratchRepository,
} from '../desktop/native-services-scratch-repository.ts';
import {
	FramescaperNativeWatchReconciler,
	FramescaperNativeWatchRepository,
} from '../desktop/native-services-watch-repository.ts';
import {
	FramescaperNativeWatchCoordinator,
} from '../desktop/native-services-watch-coordinator.ts';
import {
	publishVerifiedNativeMediaOutput,
	verifyNativeImageSequenceCheckpoint,
} from '../desktop/native-services-publication.ts';
import { createNativeMediaPublicationPlan } from '../src/common/editor/native-media-atomic-publication.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { NATIVE_WATCH_RECONCILE_INTERVAL_MS } from '../src/common/editor/native-watch-reconciliation.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const GRANT_ID = 'f'.repeat(32);
const ROOT = '/volumes/ingest';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('watch rules default to link and reconcile non-recursively after two stable observations', async () => {
	const database = open();
	const roots = rootRepository(database);
	const rules = new FramescaperNativeWatchRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 1, nowMs: 0,
	});
	const rule = rules.create({
		ruleId: 'a'.repeat(32), grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['mov', '.mp4'], createdAtMs: 0,
	}, lease, 0);
	assert.equal(rule.importMode, 'link');
	assert.equal(rule.recursive, false);
	assert.throws(() => rules.create({
		ruleId: 'b'.repeat(32), grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['mov'], recursive: true, createdAtMs: 0,
	}, lease, 0), /recursion is disabled/u);

	const imported: Array<{ name: string; mode: string }> = [];
	const recorded: string[] = [];
	const reconciler = new FramescaperNativeWatchReconciler({
		repository: rules,
		roots,
		scan: async () => [
			file('camera.mov', 'file-1'),
			file('link.mov', 'file-2', { symbolicLink: true }),
			file('notes.txt', 'file-3'),
		],
		probe: async (entry) => ({ succeeded: true, contentSha256: entry.name === 'camera.mov' ? SHA_A : SHA_B }),
		projectState: () => ({ open: true, writable: true }),
		lease: () => lease,
		importFile: async ({ entry, rule: selectedRule }) => {
			imported.push({ name: entry.name, mode: selectedRule.importMode });
			return true;
		},
		importRecorded: ({ contentSha256 }) => { recorded.push(contentSha256); },
	});

	assert.equal((await reconciler.reconcile(0)).imports, 0);
	assert.equal((await reconciler.reconcile(1_999)).imports, 0);
	assert.equal((await reconciler.reconcile(2_000)).imports, 1);
	assert.deepEqual(imported, [{ name: 'camera.mov', mode: 'link' }]);
	assert.deepEqual(recorded, [SHA_A]);
	assert.equal(rules.hasImported(rule.ruleId, 'file-1', SHA_A), true);
	assert.equal((await reconciler.reconcile(2_000 + NATIVE_WATCH_RECONCILE_INTERVAL_MS)).imports, 0);
	assert.equal((await reconciler.reconcile(4_000 + NATIVE_WATCH_RECONCILE_INTERVAL_MS)).duplicates, 1);
	assert.deepEqual(recorded, [SHA_A, SHA_A], 'a durable duplicate retries broker acknowledgement');
	database.close();
});

test('fs.watch is only a hint and the coordinator always schedules an authoritative 30-second sweep', async () => {
	const database = open();
	const roots = rootRepository(database);
	const rules = new FramescaperNativeWatchRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 1, nowMs: 0,
	});
	rules.create({
		ruleId: 'a'.repeat(32), grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['mov'], createdAtMs: 0,
	}, lease, 0);
	const delays: number[] = [];
	const watchers: Array<{ path: string; recursive: boolean; hint: () => void; closed: boolean }> = [];
	let sweeps = 0;
	const coordinator = new FramescaperNativeWatchCoordinator({
		repository: rules,
		roots,
		reconcile: async () => { sweeps += 1; },
		watch: (path, options, hint) => {
			const watcher = { path, recursive: options.recursive, hint, closed: false };
			watchers.push(watcher);
			return { close: () => { watcher.closed = true; } };
		},
		schedule: (_callback, delayMs) => { delays.push(delayMs); return delays.length; },
		cancelSchedule: () => {},
	});
	await coordinator.start();
	assert.equal(sweeps, 1, 'startup is an authoritative reconciliation');
	assert.deepEqual(watchers.map(({ path, recursive }) => ({ path, recursive })), [{ path: ROOT, recursive: false }]);
	assert.deepEqual(delays, [NATIVE_WATCH_RECONCILE_INTERVAL_MS]);

	watchers[0]!.hint();
	assert.deepEqual(delays, [NATIVE_WATCH_RECONCILE_INTERVAL_MS, 0]);
	await coordinator.reconcileNow();
	assert.equal(sweeps, 2);
	assert.equal(delays.at(-1), NATIVE_WATCH_RECONCILE_INTERVAL_MS);
	coordinator.stop();
	assert.equal(watchers[0]!.closed, true);
	database.close();
});

test('a rule whose root cannot be watched degrades to sweeps instead of aborting startup', async () => {
	const database = open();
	const roots = rootRepository(database);
	const rules = new FramescaperNativeWatchRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-missing', instanceId: 'instance-missing', processId: 1, nowMs: 0,
	});
	rules.create({
		ruleId: 'd'.repeat(32), grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['mov'], createdAtMs: 0,
	}, lease, 0);
	const failures: unknown[] = [];
	let sweeps = 0;
	// No watch factory: this exercises the real fs.watch hint source against the
	// fixture root, which does not exist on disk — the unplugged-drive shape.
	const coordinator = new FramescaperNativeWatchCoordinator({
		repository: rules,
		roots,
		reconcile: async () => { sweeps += 1; },
		schedule: () => 1,
		cancelSchedule: () => undefined,
		onError: (error) => { failures.push(error); },
	});
	await coordinator.start();
	assert.equal(sweeps, 1, 'a missing watch folder must not abort startup');
	assert.equal(failures.length, 1, 'the lost hint source is reported, not swallowed');
	coordinator.refreshHints();
	assert.equal(failures.length, 2, 'later refreshes degrade the same way instead of throwing');
	coordinator.stop();
	database.close();
});

test('watch shutdown closes hint sources immediately and drains an in-progress reconciliation', async () => {
	const database = open();
	const roots = rootRepository(database);
	const rules = new FramescaperNativeWatchRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-drain', instanceId: 'instance-drain', processId: 1, nowMs: 0,
	});
	rules.create({
		ruleId: 'c'.repeat(32), grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['mov'], createdAtMs: 0,
	}, lease, 0);
	let enterSecond!: () => void;
	const secondEntered = new Promise<void>((resolve) => { enterSecond = resolve; });
	let releaseSecond!: () => void;
	const secondBarrier = new Promise<void>((resolve) => { releaseSecond = resolve; });
	let sweeps = 0;
	let watcherClosed = false;
	const coordinator = new FramescaperNativeWatchCoordinator({
		repository: rules,
		roots,
		reconcile: async () => {
			sweeps += 1;
			if (sweeps === 2) { enterSecond(); await secondBarrier; }
		},
		watch: () => ({ close: () => { watcherClosed = true; } }),
		schedule: () => 1,
		cancelSchedule: () => undefined,
	});
	await coordinator.start();
	const reconciling = coordinator.reconcileNow();
	await secondEntered;
	let drained = false;
	const draining = coordinator.drain().then(() => { drained = true; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(watcherClosed, true);
	assert.equal(drained, false);
	releaseSecond();
	await Promise.all([reconciling, draining]);
	assert.equal(drained, true);
	database.close();
});

test('scratch reservations obey the existing quota and cleanup only an authenticated manifest', async () => {
	const database = open();
	const roots = rootRepository(database);
	assert.ok(roots.read(GRANT_ID));
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 1, nowMs: 0,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	queue.enqueue(queueRecord('1a', 0), lease, 1);
	queue.enqueue(queueRecord('2b', 1), lease, 1);
	const scratch = new FramescaperNativeScratchRepository(database);

	const first = scratch.reserve({
		jobId: jobId('1a'), directoryName: `job-${jobId('1a')}`,
		manifestDigest: SHA_A, rootIdentity: 'scratch-root-a', requestedBytes: 4_096,
		createdAtMs: 2, volume: volume(),
	}, lease, 2);
	assert.equal(first.reservedBytes, 4_096);
	assert.throws(() => scratch.reserve({
		jobId: jobId('2b'), directoryName: `job-${jobId('2b')}`,
		manifestDigest: SHA_B, rootIdentity: 'scratch-root-a', requestedBytes: 4_097,
		createdAtMs: 2, volume: volume(),
	}, lease, 2), /job reservation/u);

	const removals: string[] = [];
	assert.equal(await scratch.settle(jobId('1a'), 'succeeded', 3, {
		inspect: async () => ({
			jobId: first.jobId, manifestDigest: first.manifestDigest, rootIdentity: first.rootIdentity,
		}),
		remove: async (directoryName) => { removals.push(directoryName); },
	}, lease), 'released');
	assert.deepEqual(removals, [first.directoryName]);

	const second = scratch.reserve({
		jobId: jobId('2b'), directoryName: `job-${jobId('2b')}`,
		manifestDigest: SHA_B, rootIdentity: 'scratch-root-a', requestedBytes: 1_024,
		createdAtMs: 4, volume: volume(),
	}, lease, 4);
	queue.control(jobId('2b'), { kind: 'cancel' }, lease, 5);
	assert.equal(await scratch.settle(jobId('2b'), 'cancelled', 6, {
		inspect: async () => ({
			jobId: second.jobId, manifestDigest: SHA_A, rootIdentity: second.rootIdentity,
		}),
		remove: async () => { throw new Error('tampered scratch must not be removed'); },
	}, lease), 'retained');
	await assert.rejects(() => scratch.removeForQueueRemoval(jobId('2b'), {
		inspect: async () => ({
			jobId: second.jobId, manifestDigest: SHA_A, rootIdentity: second.rootIdentity,
		}),
		remove: async () => { throw new Error('tampered scratch must not be removed'); },
	}, lease, 7), /unauthenticated physical scratch/u);
	assert.equal(scratch.read(jobId('2b'))?.state, 'retained');
	await scratch.removeForQueueRemoval(jobId('2b'), {
		inspect: async () => ({
			jobId: second.jobId, manifestDigest: second.manifestDigest, rootIdentity: second.rootIdentity,
		}),
		remove: async (directoryName) => { removals.push(directoryName); },
	}, lease, 8);
	assert.equal(scratch.read(jobId('2b'))?.state, 'released');
	database.close();
});

test('a failed job retry re-arms only its exact authenticated scratch reservation', async () => {
	const database = open();
	rootRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-retry', instanceId: 'instance-retry', processId: 1, nowMs: 0,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const record = queue.enqueue(queueRecord('3c', 0), lease, 1);
	const scratch = new FramescaperNativeScratchRepository(database);
	const request = {
		jobId: record.jobId, directoryName: `job-${record.jobId}`,
		manifestDigest: SHA_A, rootIdentity: 'scratch-root-a', requestedBytes: 4_096,
		createdAtMs: 2, volume: { ...volume(), userCapBytes: 4_096 },
	};
	const first = scratch.reserve(request, lease, 2);
	queue.control(record.jobId, { kind: 'fail', code: 'native-helper-failed' }, lease, 3);
	assert.equal(await scratch.settle(record.jobId, 'failed', 4, {
		inspect: async () => { throw new Error('failed scratch remains retained'); },
		remove: async () => { throw new Error('failed scratch remains retained'); },
	}, lease), 'retained');
	queue.control(record.jobId, { kind: 'retry' }, lease, 5);
	assert.throws(() => scratch.reserve({
		...request, manifestDigest: SHA_B, createdAtMs: 6,
	}, lease, 6), /manifest|identity/iu);
	const retried = scratch.reserve({ ...request, createdAtMs: 7 }, lease, 7);
	assert.deepEqual(retried, { ...first, state: 'reserved', createdAtMs: 7, expiresAtMs: null });
	assert.equal(scratch.list().length, 1);
	database.close();
});

test('publication verifies a temporary sibling and recognizes the same completed rename after a crash', async () => {
	const plan = createNativeMediaPublicationPlan({
		jobId: jobId('1a'), relativeDestination: 'exports/reel.mp4', planFingerprint: SHA_A,
	});
	const files = new Map<string, { byteLength: number; sha256: string; symbolicLink: boolean }>([
		[plan.temporaryRelativePath, { byteLength: 5, sha256: SHA_B, symbolicLink: false }],
	]);
	let renames = 0;
	const port = {
		inspect: async (relativePath: string) => files.get(relativePath) ?? null,
		renameTemporarySibling: async (temporary: string, destination: string) => {
			renames += 1;
			const entry = files.get(temporary);
			if (!entry) throw new Error('missing temporary');
			files.delete(temporary);
			files.set(destination, entry);
		},
		removePublishedOutput: async (destination: string, expected: {
			byteLength: number; sha256: string; symbolicLink: boolean;
		}) => {
			assert.deepEqual(files.get(destination), expected);
			files.delete(destination);
		},
	};
	const request = {
		plan, currentPlanFingerprint: SHA_A, finalized: true,
		declaredByteLength: 5, declaredSha256: SHA_B,
	};
	assert.equal((await publishVerifiedNativeMediaOutput(request, port)).outcome, 'published');
	assert.equal((await publishVerifiedNativeMediaOutput(request, port)).outcome, 'already-published');
	assert.equal(renames, 1);

	files.set(plan.relativeDestination, { byteLength: 6, sha256: SHA_B, symbolicLink: false });
	await assert.rejects(() => publishVerifiedNativeMediaOutput(request, port), /different output/u);
});

test('publication removes a newly renamed output and advertises nothing when its post-publication fence is lost', async () => {
	const plan = createNativeMediaPublicationPlan({
		jobId: jobId('3c'), relativeDestination: 'exports/fenced.mp4', planFingerprint: SHA_A,
	});
	const observation = Object.freeze({ byteLength: 5, sha256: SHA_B, symbolicLink: false });
	const files = new Map([[plan.temporaryRelativePath, observation]]);
	const phases: string[] = [];
	const port = {
		inspect: async (relativePath: string) => files.get(relativePath) ?? null,
		renameTemporarySibling: async (temporary: string, destination: string) => {
			const entry = files.get(temporary);
			if (!entry) throw new Error('missing temporary');
			files.delete(temporary);
			files.set(destination, entry);
			phases.push('renamed');
		},
		removePublishedOutput: async (destination: string, expected: {
			byteLength: number; sha256: string; symbolicLink: boolean;
		}) => {
			assert.deepEqual(files.get(destination), expected);
			files.delete(destination);
			phases.push('removed');
		},
	};
	await assert.rejects(() => publishVerifiedNativeMediaOutput({
		plan, currentPlanFingerprint: SHA_A, finalized: true,
		declaredByteLength: 5, declaredSha256: SHA_B,
	}, port, {
		beforePublication: async () => { phases.push('before'); },
		afterPublication: async () => {
			phases.push('after');
			throw new Error('writer lease was taken over');
		},
	}), /writer lease was taken over/u);
	assert.deepEqual(phases, ['before', 'renamed', 'after', 'removed']);
	assert.equal(files.has(plan.relativeDestination), false);
});

test('image-sequence recovery keeps only one contiguous run of exactly verified frames', async () => {
	const result = await verifyNativeImageSequenceCheckpoint({
		planFingerprint: SHA_A,
		sourceInventoryDigest: SHA_B,
		plannedFrameCount: 4,
		manifest: [
			frameCheckpoint(0, SHA_A),
			frameCheckpoint(1, SHA_B),
			frameCheckpoint(2, SHA_A),
		],
		inspect: async (entry) => entry.frameIndex === 2
			? { byteLength: entry.byteLength, sha256: SHA_B, symbolicLink: false }
			: { byteLength: entry.byteLength, sha256: entry.sha256, symbolicLink: false },
	});
	assert.deepEqual(result, {
		verifiedFrameCount: 2,
		plannedFrameCount: 4,
		complete: false,
	});
});

function open(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	return database;
}

function rootRepository(database: DatabaseSync): FramescaperNativeRootRepository {
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'setup-lease', instanceId: 'setup-instance', processId: 1, nowMs: 0,
	});
	roots.authorize({
		grantId: GRANT_ID, rootPath: ROOT,
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a', authorizedAtMs: 0,
	}, lease, 0);
	releaseFramescaperNativeServicesWriterLease(database, lease);
	return roots;
}

function file(
	name: string,
	fileIdentity: string,
	overrides: Partial<{ symbolicLink: boolean }> = {},
) {
	return {
		name, fileIdentity, sizeBytes: 100, modifiedAtMs: 1,
		isDirectory: false, symbolicLink: false, ...overrides,
	};
}

function jobId(byte: string): string {
	return byte.repeat(20);
}

function queueRecord(byte: string, position: number) {
	return createNativeQueueRecordV2({
		jobId: jobId(byte), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1, inputFingerprints: [],
		rootGrantId: GRANT_ID, relativeDestination: `exports/${byte}.mp4`,
		reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 4_096,
			minimumFreeBytes: 0, hardwareBackend: null,
		},
		position, createdAtMs: 0,
	});
}

function volume() {
	return { totalBytes: 200 * 1024 ** 3, freeBytes: 100 * 1024 ** 3 };
}

function frameCheckpoint(frameIndex: number, sha256: string) {
	return Object.freeze({
		frameIndex,
		relativePath: `frames/frame-${String(frameIndex).padStart(6, '0')}.png`,
		byteLength: 100 + frameIndex,
		sha256,
		planFingerprint: SHA_A,
		sourceInventoryDigest: SHA_B,
	});
}
