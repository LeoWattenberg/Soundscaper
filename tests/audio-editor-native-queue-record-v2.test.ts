/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	assertNativeQueueRecordV1,
	assertNativeQueueRecordV2,
	createNativeQueueRecordV1,
	createNativeQueueRecordV2,
	isNativeQueueRecordV2Dispatchable,
	migrateNativeQueueRecordV1ToV2,
	NATIVE_QUEUE_ACTIVE_PLAN_VERSIONS,
	NativeQueueRecordError,
	type NativeQueueRecordV1,
} from '../src/common/editor/native-queue-record.ts';
import {
	applyNativeQueueTransition,
	NativeQueueTransitionError,
} from '../src/common/editor/native-queue-state-machine.ts';
import {
	nativeQueueKeyedPlanV7,
	nativeQueueStaticPlanV8,
} from './helpers/native-queue-plan-fixture.ts';

const JOB_ID = '1a'.repeat(20);
const GRANT = 'f'.repeat(32);

test('V2 admits exactly the executable V7–V12 plan union and derives immutable plan identity', () => {
	assert.deepEqual([...NATIVE_QUEUE_ACTIVE_PLAN_VERSIONS], [7, 8, 9, 10, 11, 12]);
	for (const plan of [nativeQueueKeyedPlanV7(), nativeQueueStaticPlanV8()]) {
		const record = createNativeQueueRecordV2(input(plan));
		const fingerprint = fingerprintNativeMediaPlan(plan);

		assert.equal(record.recordVersion, 2);
		assert.equal(record.planVersion, plan.version);
		assert.equal(record.planPayload, canonicalizeNativeMediaPlan(plan));
		assert.equal(record.planFingerprint, fingerprint.sha256);
		assert.equal(isNativeQueueRecordV2Dispatchable(record), true);
		assert.doesNotThrow(() => assertNativeQueueRecordV2(record));
	}
});

test('V2 reparses the exact plan and refuses payload, fingerprint, version, or unsupported-plan drift', () => {
	const record = createNativeQueueRecordV2(input(nativeQueueKeyedPlanV7()));
	for (const mutate of [
		(value: Record<string, unknown>) => { value.planFingerprint = '0'.repeat(64); },
		(value: Record<string, unknown>) => { value.planPayload = `${String(value.planPayload)} `; },
		(value: Record<string, unknown>) => { value.planVersion = 8; },
		(value: Record<string, unknown>) => { value.recordVersion = 3; },
	]) {
		const tampered = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
		mutate(tampered);
		assert.throws(() => assertNativeQueueRecordV2(tampered), NativeQueueRecordError);
	}

	const future = { ...nativeQueueStaticPlanV8(), version: 13 };
	assert.throws(() => createNativeQueueRecordV2(input(future)), /exact executable canonical plan/iu);
});

test('the V1 contract remains frozen for historical rows', () => {
	const historical = historicalRecord(6, '{"version":6}');
	assert.doesNotThrow(() => assertNativeQueueRecordV1(historical));
	assert.throws(() => assertNativeQueueRecordV2(historical), /schema keys/u);
});

test('migration keeps V6 visible but blocks it permanently from dispatch or retry', () => {
	const plan = { version: 6 };
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const historical = createNativeQueueRecordV1({
		...historicalInput(6, fingerprint.canonical, fingerprint.sha256),
	});
	const migrated = migrateNativeQueueRecordV1ToV2(historical);

	assert.equal(migrated.recordVersion, 2);
	assert.equal(migrated.planVersion, 6);
	assert.equal(migrated.state, 'blocked');
	assert.equal(migrated.lastFailureCode, 'unsupported-plan-version');
	assert.equal(isNativeQueueRecordV2Dispatchable(migrated), false);
	assert.throws(
		() => applyNativeQueueTransition(migrated, { kind: 'dispatch' }, 1),
		NativeQueueTransitionError,
	);

	const cancelled = applyNativeQueueTransition(migrated, { kind: 'cancel' }, 1).record;
	assert.equal(cancelled.state, 'cancelled');
	assert.equal(cancelled.lastFailureCode, 'unsupported-plan-version');
	assert.throws(
		() => applyNativeQueueTransition(cancelled, { kind: 'retry' }, 2),
		NativeQueueTransitionError,
	);
});

test('migration revalidates supported payloads and fingerprints before producing V2', () => {
	const plan = nativeQueueKeyedPlanV7();
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const historical = createNativeQueueRecordV1({
		...historicalInput(7, fingerprint.canonical, fingerprint.sha256),
	});
	const migrated = migrateNativeQueueRecordV1ToV2(historical);

	assert.equal(migrated.recordVersion, 2);
	assert.equal(migrated.planVersion, 7);
	assert.equal(migrated.state, 'queued');
	assert.equal(isNativeQueueRecordV2Dispatchable(migrated), true);

	for (const broken of [
		{ ...historical, planFingerprint: '0'.repeat(64) },
		{ ...historical, planPayload: `${historical.planPayload} ` },
	]) {
		assert.throws(() => migrateNativeQueueRecordV1ToV2(broken), NativeQueueRecordError);
	}
});

function input(plan: Record<string, unknown>) {
	return {
		...baseInput(),
		plan,
	};
}

function historicalRecord(planVersion: number, planPayload: string): NativeQueueRecordV1 {
	return createNativeQueueRecordV1({
		...historicalInput(planVersion, planPayload, 'a'.repeat(64)),
	});
}

function historicalInput(planVersion: number, planPayload: string, planFingerprint: string) {
	return {
		...baseInput(), planVersion, planPayload, planFingerprint,
	};
}

function baseInput(): Omit<Parameters<typeof createNativeQueueRecordV2>[0], 'plan'> {
	return {
		jobId: JOB_ID,
		taskKind: 'encoded-export',
		projectId: 'project-1',
		projectRevision: 42,
		inputFingerprints: [{ sourceId: 'source-a', sha256: 'b'.repeat(64) }],
		rootGrantId: GRANT,
		relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 4, processTreeRssBytes: 1024 ** 3, scratchBytes: 8 * 1024 ** 3,
			minimumFreeBytes: 10 * 1024 ** 3, hardwareBackend: null,
		},
		position: 0,
		createdAtMs: 0,
	};
}
