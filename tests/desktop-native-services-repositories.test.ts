/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	FRAMESCAPER_NATIVE_SERVICES_LEASE_MS,
	initializeFramescaperNativeServicesDatabase,
	renewFramescaperNativeServicesWriterLease,
} from '../desktop/native-services-database.ts';
import {
	FramescaperNativeQueueRepository,
} from '../desktop/native-services-queue-repository.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_RENEW_INTERVAL_MS,
	FramescaperNativeServicesLeaseCoordinator,
} from '../desktop/native-services-lease-coordinator.ts';
import {
	FramescaperNativeRootRepository,
} from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueCapacityV1 } from '../src/common/editor/native-queue-admission.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const GRANT_ID = 'f'.repeat(32);
const ROOT = '/volumes/exports';

test('the native queue repository persists CRUD and dispatches only the default two jobs', () => {
	const database = open();
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquire(database, 'lease-a', 'instance-a', 0);
	roots.authorize(rootGrant(), lease, 0);
	const queue = new FramescaperNativeQueueRepository(database);

	for (const [suffix, position] of [['1a', 2], ['2b', 0], ['3c', 1]] as const) {
		queue.enqueue(queueRecord(suffix, position), lease, 1);
	}
	assert.deepEqual(queue.list().map((record) => record.position), [0, 1, 2]);

	const dispatch = queue.dispatchReady(lease, 2, capacity());
	assert.deepEqual(dispatch.admission.admitted, [jobId('2b'), jobId('3c')]);
	assert.equal(dispatch.records.length, 2);
	assert.equal(queue.list().filter((record) => record.state === 'running').length, 2);
	assert.equal(queue.read(jobId('1a'))?.state, 'queued');

	const paused = queue.control(jobId('2b'), { kind: 'pause' }, lease, 3);
	assert.equal(paused.record.state, 'paused');
	assert.equal(paused.discardedPartialOutput, true);
	assert.equal(queue.control(jobId('2b'), { kind: 'resume' }, lease, 4).record.state, 'queued');
	assert.equal(queue.control(jobId('2b'), { kind: 'cancel' }, lease, 5).record.state, 'cancelled');
	assert.equal(queue.control(jobId('2b'), { kind: 'retry' }, lease, 6).record.state, 'queued');
	assert.equal(queue.control(jobId('2b'), { kind: 'cancel' }, lease, 7).record.state, 'cancelled');
	assert.equal(queue.remove(jobId('2b'), lease, 8), true);
	assert.equal(queue.read(jobId('2b')), null);
	database.close();
});

test('writer renewal preserves the fence and a takeover stops stale queue mutation', () => {
	const database = open();
	const roots = new FramescaperNativeRootRepository(database);
	const first = acquire(database, 'lease-a', 'instance-a', 0);
	roots.authorize(rootGrant(), first, 0);
	const renewed = renewFramescaperNativeServicesWriterLease(database, first, 10_000);

	assert.equal(renewed.leaseId, first.leaseId);
	assert.equal(renewed.fencingToken, first.fencingToken);
	assert.equal(renewed.expiresAtMs, 10_000 + FRAMESCAPER_NATIVE_SERVICES_LEASE_MS);
	const queue = new FramescaperNativeQueueRepository(database);
	queue.enqueue(queueRecord('1a', 0), renewed, 10_001);

	const takeoverAt = renewed.expiresAtMs;
	const second = acquire(database, 'lease-b', 'instance-b', takeoverAt);
	assert.ok(second.fencingToken > renewed.fencingToken);
	assert.throws(
		() => queue.control(jobId('1a'), { kind: 'pause' }, renewed, takeoverAt + 1),
		/writer lease was taken over/u,
	);
	assert.equal(queue.control(jobId('1a'), { kind: 'pause' }, second, takeoverAt + 1).record.state, 'paused');
	database.close();
});

test('the process lease coordinator renews inside the TTL and permanently fences on ownership loss', async () => {
	const database = open();
	let nowMs = 0;
	const delays: number[] = [];
	const fenced: unknown[] = [];
	const coordinator = new FramescaperNativeServicesLeaseCoordinator({
		database,
		leaseId: 'lease-a',
		instanceId: 'instance-a',
		processId: 1,
		now: () => nowMs,
		schedule: (_callback, delayMs) => { delays.push(delayMs); return delays.length; },
		cancelSchedule: () => {},
		onFenced: (error) => fenced.push(error),
	});
	const first = coordinator.start();
	assert.equal(delays[0], FRAMESCAPER_NATIVE_SERVICES_RENEW_INTERVAL_MS);
	nowMs = FRAMESCAPER_NATIVE_SERVICES_RENEW_INTERVAL_MS;
	const renewed = await coordinator.renewNow();
	assert.equal(renewed.fencingToken, first.fencingToken);
	assert.ok(renewed.expiresAtMs > first.expiresAtMs);

	nowMs = renewed.expiresAtMs;
	acquire(database, 'lease-b', 'instance-b', nowMs);
	await assert.rejects(() => coordinator.renewNow(), /writer lease was taken over/u);
	assert.equal(fenced.length, 1);
	assert.throws(() => coordinator.lease(), /fenced/u);
	coordinator.stop();
	database.close();
});

test('startup recovery revalidates rows before dispatch and keeps verified sequence progress', () => {
	const database = open();
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquire(database, 'lease-a', 'instance-a', 0);
	roots.authorize(rootGrant(), lease, 0);
	const queue = new FramescaperNativeQueueRepository(database);
	const record = queueRecord('1a', 0, 'image-sequence-export');
	queue.enqueue(record, lease, 1);
	queue.control(record.jobId, { kind: 'dispatch' }, lease, 2);

	const recovered = queue.recover(lease, 3, () => ({
		projectRevisionMatches: true,
		planFingerprintMatches: true,
		inputFingerprintsMatch: true,
		rootGrantAuthorized: true,
		rootGrantValid: true,
		helperBuildMatches: true,
		scratchIdentityMatches: true,
		verifiedFrameCount: 25,
		plannedFrameCount: 100,
	}));

	assert.equal(recovered.length, 1);
	assert.equal(recovered[0]?.record.state, 'queued');
	assert.equal(recovered[0]?.record.progress, 0.25);
	assert.equal(recovered[0]?.discardedPartialOutput, false);
	database.close();
});

test('durable roots are exact-identity grants and never follow a symlink', async () => {
	const database = open();
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquire(database, 'lease-a', 'instance-a', 0);
	const granted = roots.authorize(rootGrant(), lease, 0);
	assert.equal(granted.rootPath, ROOT);
	assert.equal(roots.resolveDestination(GRANT_ID, 'deliveries/reel.mp4'), `${ROOT}/deliveries/reel.mp4`);
	assert.throws(() => roots.resolveDestination(GRANT_ID, '../escape.mp4'), /traverse/u);

	assert.equal(await roots.revalidate(GRANT_ID, async () => ({
		exists: true, directory: true, symbolicLink: false,
		canonicalPath: ROOT, volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
	})), true);
	assert.equal(await roots.revalidate(GRANT_ID, async () => ({
		exists: true, directory: true, symbolicLink: true,
		canonicalPath: '/different', volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
	})), false);

	assert.equal(roots.revoke(GRANT_ID, 10, lease), true);
	assert.equal(roots.list()[0]?.revokedAtMs, 10);
	assert.throws(() => roots.resolveDestination(GRANT_ID, 'reel.mp4'), /revoked/u);
	database.close();
});

test('revoking a root atomically disables every dependent watch rule', () => {
	const database = open();
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquire(database, 'lease-a', 'instance-a', 0);
	roots.authorize(rootGrant(), lease, 0);
	const watch = new FramescaperNativeWatchRepository(database);
	watch.create({
		ruleId: 'a'.repeat(32), grantId: GRANT_ID,
		schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project-1',
		extensions: ['mov'], enabled: true, createdAtMs: 0,
	}, lease, 0);
	watch.create({
		ruleId: 'b'.repeat(32), grantId: GRANT_ID,
		schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project-2',
		extensions: ['mp4'], enabled: false, createdAtMs: 0,
	}, lease, 0);

	assert.equal(roots.revoke(GRANT_ID, 10, lease), true);
	assert.deepEqual(watch.list().map(({ enabled }) => enabled), [false, false]);
	assert.throws(() => watch.setEnabled('a'.repeat(32), true, lease, 11), /revoked|active root/u);
	database.close();
});

function open(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	return database;
}

function acquire(database: DatabaseSync, leaseId: string, instanceId: string, nowMs: number) {
	return acquireFramescaperNativeServicesWriterLease(database, {
		leaseId, instanceId, processId: 1, nowMs,
	});
}

function rootGrant() {
	return {
		grantId: GRANT_ID,
		rootPath: ROOT,
		volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a',
		authorizedAtMs: 0,
	};
}

function jobId(byte: string): string {
	return byte.repeat(20);
}

function queueRecord(
	byte: string,
	position: number,
	taskKind: 'encoded-export' | 'image-sequence-export' = 'encoded-export',
) {
	return createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: jobId(byte), taskKind, plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'source-a', sha256: 'b'.repeat(64) }],
		rootGrantId: GRANT_ID, relativeDestination: `exports/${byte}.mp4`,
		reservations: {
			cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 4096,
			minimumFreeBytes: 0, hardwareBackend: null,
		},
		...(taskKind === 'image-sequence-export' ? { recoveryClass: 'verified-frame-checkpoint' as const } : {}),
		position, createdAtMs: 0,
	});
}

function capacity(): NativeQueueCapacityV1 {
	return {
		availableCpuCores: 8,
		availableProcessTreeRssBytes: 1024 ** 3,
		availableScratchBytes: 1024 ** 3,
		volumeFreeBytes: 1024 ** 3,
		reservedFreeBytes: 0,
	};
}
