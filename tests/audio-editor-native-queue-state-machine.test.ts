/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNativeQueueRecordV1,
	createNativeQueueRecordV1,
	nativeQueueRecordCarriesNoPathAuthority,
	NATIVE_QUEUE_STATES,
	NativeQueueRecordError,
	type NativeQueueRecordV1,
	type NativeQueueRecoveryClass,
	type NativeQueueTaskKind,
} from '../src/common/editor/native-queue-record.ts';
import {
	applyNativeQueueTransition,
	NATIVE_QUEUE_BLOCK_CODES,
	NATIVE_QUEUE_TERMINAL_STATES,
	NativeQueueTransitionError,
	recoverNativeQueueRecord,
	type NativeQueueRevalidationV1,
} from '../src/common/editor/native-queue-state-machine.ts';

const JOB_ID = '1a'.repeat(20);
const PLAN = 'a'.repeat(64);
const GRANT = 'f'.repeat(32);

test('a queue row carries a description, never a path or media body', () => {
	const record = queued();

	assert.equal(nativeQueueRecordCarriesNoPathAuthority(record), true);
	assert.equal(record.rootGrantId, GRANT);
	assert.equal(record.relativeDestination, 'exports/reel.mp4');
	assert.equal(record.state, 'queued');
	assert.equal(record.attempt, 0);
	assert.equal(record.progress, null);
	assert.deepEqual([...NATIVE_QUEUE_STATES], [
		'queued', 'running', 'paused', 'blocked', 'needs-authorization',
		'completed', 'failed', 'cancelled',
	]);
});

test('only an image sequence may declare a verified frame checkpoint', () => {
	assert.doesNotThrow(() => queued({
		taskKind: 'image-sequence-export', recoveryClass: 'verified-frame-checkpoint',
	}));
	for (const taskKind of ['encoded-export', 'proxy-generation'] as const) {
		assert.throws(
			() => queued({ taskKind, recoveryClass: 'verified-frame-checkpoint' }),
			/only an image sequence may declare a verified frame checkpoint/u,
		);
	}
});

test('a row that is not in its canonical form is refused', () => {
	const record = queued() as unknown as Record<string, unknown>;

	for (const mutate of [
		(value: Record<string, unknown>) => { value.rootGrantId = '/var/exports'; },
		(value: Record<string, unknown>) => { value.relativeDestination = '../escape.mp4'; },
		(value: Record<string, unknown>) => { value.planVersion = 20; },
		(value: Record<string, unknown>) => { value.planPayload = ''; },
		(value: Record<string, unknown>) => { value.progress = 1.5; },
		(value: Record<string, unknown>) => { value.attempt = -1; },
		(value: Record<string, unknown>) => { value.state = 'failed'; },
		(value: Record<string, unknown>) => { value.updatedAtMs = 0; value.createdAtMs = 10; },
		(value: Record<string, unknown>) => { value.extra = true; },
	]) {
		const tampered = { ...record };
		mutate(tampered);
		assert.throws(() => assertNativeQueueRecordV1(tampered), NativeQueueRecordError);
	}
});

test('the same input source is never listed twice', () => {
	assert.throws(() => queued({
		inputFingerprints: [
			{ sourceId: 'source-a', sha256: 'b'.repeat(64) },
			{ sourceId: 'source-a', sha256: 'c'.repeat(64) },
		],
	}), /names the same input source twice/u);
});

test('dispatch is idempotent so a crash cannot start a second helper', () => {
	const first = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10);
	const again = applyNativeQueueTransition(first.record, { kind: 'dispatch' }, 20);

	assert.equal(first.record.state, 'running');
	assert.equal(first.record.attempt, 1);
	assert.equal(first.record.progress, 0);
	assert.equal(again.idempotent, true);
	assert.equal(again.record.attempt, 1);
	assert.strictEqual(again.record, first.record);
});

test('the final commit is idempotent so a crash cannot double-publish', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const completed = applyNativeQueueTransition(running, { kind: 'complete' }, 20);
	const again = applyNativeQueueTransition(completed.record, { kind: 'complete' }, 30);

	assert.equal(completed.record.state, 'completed');
	assert.equal(completed.record.progress, 1);
	assert.equal(again.idempotent, true);
	assert.strictEqual(again.record, completed.record);
});

test('progress is monotonic and only a running job reports it', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const advanced = applyNativeQueueTransition(running, { kind: 'report-progress', value: 0.4 }, 20).record;

	assert.equal(advanced.progress, 0.4);
	assert.throws(
		() => applyNativeQueueTransition(advanced, { kind: 'report-progress', value: 0.3 }, 30),
		/monotonic/u,
	);
	assert.throws(
		() => applyNativeQueueTransition(queued(), { kind: 'report-progress', value: 0.5 }, 30),
		NativeQueueTransitionError,
	);
});

test('pausing a running atomic job cancels it into a clean restartable state', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const advanced = applyNativeQueueTransition(running, { kind: 'report-progress', value: 0.6 }, 20).record;
	const paused = applyNativeQueueTransition(advanced, { kind: 'pause' }, 30);

	assert.equal(paused.record.state, 'paused');
	assert.equal(paused.record.progress, null, 'an encoded container has no verifiable partial state');
	assert.equal(paused.discardedPartialOutput, true);

	const resumed = applyNativeQueueTransition(paused.record, { kind: 'resume' }, 40);
	assert.equal(resumed.record.state, 'queued');
	assert.equal(resumed.record.attempt, 1);
});

test('pausing a checkpointed image sequence keeps its verified progress', () => {
	const record = queued({
		taskKind: 'image-sequence-export', recoveryClass: 'verified-frame-checkpoint',
	});
	const running = applyNativeQueueTransition(record, { kind: 'dispatch' }, 10).record;
	const advanced = applyNativeQueueTransition(running, { kind: 'report-progress', value: 0.6 }, 20).record;
	const paused = applyNativeQueueTransition(advanced, { kind: 'pause' }, 30);

	assert.equal(paused.record.progress, 0.6);
	assert.equal(paused.discardedPartialOutput, false);
});

test('cancel, fail, and retry move a job through settled states without losing its identity', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const failed = applyNativeQueueTransition(running, { kind: 'fail', code: 'encoder-exited' }, 20);
	assert.equal(failed.record.state, 'failed');
	assert.equal(failed.record.lastFailureCode, 'encoder-exited');

	const retried = applyNativeQueueTransition(failed.record, { kind: 'retry' }, 30);
	assert.equal(retried.record.state, 'queued');
	assert.equal(retried.record.progress, null);
	assert.equal(retried.discardedPartialOutput, true);
	assert.equal(retried.record.jobId, JOB_ID);

	const cancelled = applyNativeQueueTransition(
		applyNativeQueueTransition(retried.record, { kind: 'dispatch' }, 40).record,
		{ kind: 'cancel' }, 50,
	);
	assert.equal(cancelled.record.state, 'cancelled');
	assert.equal(cancelled.discardedPartialOutput, true);
	assert.equal(applyNativeQueueTransition(cancelled.record, { kind: 'retry' }, 60).record.state, 'queued');
});

test('a completed job is terminal', () => {
	const completed = applyNativeQueueTransition(
		applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record,
		{ kind: 'complete' }, 20,
	).record;

	for (const transition of [
		{ kind: 'cancel' }, { kind: 'retry' }, { kind: 'pause' },
		{ kind: 'dispatch' }, { kind: 'reorder', position: 3 },
	] as const) {
		assert.throws(
			() => applyNativeQueueTransition(completed, transition, 30),
			NativeQueueTransitionError,
			transition.kind,
		);
	}
});

test('a running job cannot be reordered out from under itself', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	assert.throws(
		() => applyNativeQueueTransition(running, { kind: 'reorder', position: 0 }, 20),
		NativeQueueTransitionError,
	);
	assert.equal(
		applyNativeQueueTransition(queued(), { kind: 'reorder', position: 4 }, 20).record.position,
		4,
	);
});

test('a transition never travels backwards in time', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 100).record;
	assert.throws(
		() => applyNativeQueueTransition(running, { kind: 'complete' }, 99),
		/never precedes the row it updates/u,
	);
});

test('recovery revalidates everything before a job may run again', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const recovered = recoverNativeQueueRecord(running, revalidation(), 20);

	assert.equal(recovered.record.state, 'queued');
	assert.equal(recovered.record.progress, null);
	assert.equal(recovered.discardedPartialOutput, true, 'an atomic job restarts from zero');
});

test('each revalidation failure becomes its own typed blocked state', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;

	for (const [key, code] of [
		['rootGrantValid', 'root-grant-invalid'],
		['projectRevisionMatches', 'project-revision-changed'],
		['planFingerprintMatches', 'plan-fingerprint-changed'],
		['inputFingerprintsMatch', 'input-fingerprint-changed'],
		['licensingCleared', 'licensing-row-blocked'],
		['helperBuildMatches', 'helper-build-changed'],
		['scratchIdentityMatches', 'scratch-identity-changed'],
	] as const) {
		const recovered = recoverNativeQueueRecord(running, revalidation({ [key]: false }), 20);
		assert.equal(recovered.record.state, 'blocked', key);
		assert.equal(recovered.record.lastFailureCode, code, key);
		assert.equal(recovered.discardedPartialOutput, true, key);
		assert.ok(NATIVE_QUEUE_BLOCK_CODES.includes(code));
	}
});

test('an unauthorized root asks the user rather than blocking outright', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const recovered = recoverNativeQueueRecord(running, revalidation({ rootGrantAuthorized: false }), 20);

	assert.equal(recovered.record.state, 'needs-authorization');
	const authorized = applyNativeQueueTransition(recovered.record, { kind: 'authorize' }, 30);
	assert.equal(authorized.record.state, 'queued');
	assert.equal(authorized.record.lastFailureCode, null);
});

test('a checkpointed sequence resumes from its verified frames only', () => {
	const record = queued({
		taskKind: 'image-sequence-export', recoveryClass: 'verified-frame-checkpoint',
	});
	const running = applyNativeQueueTransition(record, { kind: 'dispatch' }, 10).record;

	const partial = recoverNativeQueueRecord(running, revalidation({
		verifiedFrameCount: 250, plannedFrameCount: 1_000,
	}), 20);
	assert.equal(partial.record.progress, 0.25);
	assert.equal(partial.discardedPartialOutput, false);

	// No verified frames means nothing to resume from.
	const none = recoverNativeQueueRecord(running, revalidation({
		verifiedFrameCount: 0, plannedFrameCount: 1_000,
	}), 20);
	assert.equal(none.record.progress, null);
	assert.equal(none.discardedPartialOutput, true);
});

test('recovery leaves a completed job and a paused job alone', () => {
	const completed = applyNativeQueueTransition(
		applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record,
		{ kind: 'complete' }, 20,
	).record;
	const paused = applyNativeQueueTransition(queued(), { kind: 'pause' }, 10).record;

	assert.strictEqual(recoverNativeQueueRecord(completed, revalidation(), 30).record, completed);
	assert.strictEqual(recoverNativeQueueRecord(paused, revalidation(), 30).record, paused);
});

test('a settled job keeps the state the user left it in, whatever the world now says', () => {
	assert.deepEqual([...NATIVE_QUEUE_TERMINAL_STATES], ['completed', 'failed', 'cancelled']);

	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record;
	const failed = applyNativeQueueTransition(running, { kind: 'fail', code: 'encoder-exited' }, 20).record;
	const cancelled = applyNativeQueueTransition(running, { kind: 'cancel' }, 20).record;

	for (const settled of [failed, cancelled]) {
		for (const facts of [revalidation(), revalidation({ planFingerprintMatches: false })]) {
			const recovered = recoverNativeQueueRecord(settled, facts, 30);
			assert.strictEqual(recovered.record, settled, settled.state);
			assert.equal(recovered.idempotent, true, settled.state);
			assert.equal(recovered.discardedPartialOutput, false, settled.state);
		}
	}
	assert.equal(failed.lastFailureCode, 'encoder-exited');
});

test('a cancelled job never renders itself again after a restart', () => {
	const cancelled = applyNativeQueueTransition(
		applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record,
		{ kind: 'cancel' }, 20,
	).record;

	const recovered = recoverNativeQueueRecord(cancelled, revalidation(), 30);
	assert.equal(recovered.record.state, 'cancelled');

	const retried = applyNativeQueueTransition(recovered.record, { kind: 'retry' }, 40);
	assert.equal(retried.record.state, 'queued', 'only the user brings a cancelled job back');
});

test('a failed job waits for a retry instead of charging an attempt every restart', () => {
	const failed = applyNativeQueueTransition(
		applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10).record,
		{ kind: 'fail', code: 'encoder-exited' }, 20,
	).record;

	let recovered = failed;
	for (const atMs of [30, 40, 50]) {
		recovered = recoverNativeQueueRecord(recovered, revalidation(), atMs).record;
	}

	assert.equal(recovered.state, 'failed');
	assert.equal(recovered.attempt, 1);
	assert.equal(recovered.lastFailureCode, 'encoder-exited');
});

test('recovery stays total when the wall clock regressed since the row was written', () => {
	const running = applyNativeQueueTransition(queued(), { kind: 'dispatch' }, 10_000).record;

	const blocked = recoverNativeQueueRecord(running, revalidation({ helperBuildMatches: false }), 9_000);
	assert.equal(blocked.record.state, 'blocked');
	assert.equal(blocked.record.lastFailureCode, 'helper-build-changed');

	const unauthorized = recoverNativeQueueRecord(running, revalidation({ rootGrantAuthorized: false }), 9_000);
	assert.equal(unauthorized.record.state, 'needs-authorization');

	const requeued = recoverNativeQueueRecord(running, revalidation(), 9_000);
	assert.equal(requeued.record.state, 'queued');

	for (const recovered of [blocked, unauthorized, requeued]) {
		assert.ok(
			recovered.record.updatedAtMs >= running.updatedAtMs,
			`a recovered row never travels backwards in time: ${recovered.record.state}`,
		);
	}
	assert.throws(() => recoverNativeQueueRecord(running, revalidation(), Number.NaN), RangeError);
});

function revalidation(
	overrides: Partial<NativeQueueRevalidationV1> = {},
): NativeQueueRevalidationV1 {
	return {
		projectRevisionMatches: true,
		planFingerprintMatches: true,
		inputFingerprintsMatch: true,
		rootGrantAuthorized: true,
		rootGrantValid: true,
		licensingCleared: true,
		helperBuildMatches: true,
		scratchIdentityMatches: true,
		...overrides,
	};
}

function queued(overrides: Readonly<{
	taskKind?: NativeQueueTaskKind;
	recoveryClass?: NativeQueueRecoveryClass;
	inputFingerprints?: readonly { sourceId: string; sha256: string }[];
}> = {}): NativeQueueRecordV1 {
	return createNativeQueueRecordV1({
		jobId: JOB_ID,
		taskKind: overrides.taskKind ?? 'encoded-export',
		planVersion: 6,
		planFingerprint: PLAN,
		planPayload: '{"version":6}',
		projectId: 'project-1',
		projectRevision: 42,
		inputFingerprints: overrides.inputFingerprints
			?? [{ sourceId: 'source-a', sha256: 'b'.repeat(64) }],
		rootGrantId: GRANT,
		relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 4,
			processTreeRssBytes: 1024 ** 3,
			scratchBytes: 8 * 1024 ** 3,
			minimumFreeBytes: 10 * 1024 ** 3,
			hardwareBackend: null,
		},
		recoveryClass: overrides.recoveryClass,
		position: 0,
		createdAtMs: 0,
	});
}
