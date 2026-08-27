/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The persistent queue's state machine and its restart recovery.
 *
 * Two properties drive the design. Dispatch and final commit are idempotent, so
 * a crash between "the database says running" and "the helper actually started"
 * cannot double-run or double-publish a job. And pausing a running atomic job
 * *cancels* it into a clean restartable state rather than suspending an encoder
 * process: an encoded container has no verifiable partial state, so claiming
 * resume for one would be a mislabelled recovery class, which is precisely what
 * the downstream exit gate forbids.
 *
 * Recovery never trusts a row. Before a job read back from the database may run
 * again, its project revision, plan, inputs, root grant, helper build, and
 * scratch identity are all revalidated; anything that no longer
 * matches becomes a typed blocked or needs-authorization state rather than a
 * job that quietly renders something else.
 */

import {
	assertNativeQueueRecordV1,
	assertNativeQueueRecordV2,
	isNativeQueueRecordV2Dispatchable,
	type NativeQueueRecordV1,
	type NativeQueueRecordV2,
	type NativeQueueState,
} from './native-queue-record.ts';
import {
	assertNativeQueueRecordV3,
	isNativeQueueRecordV3Dispatchable,
	type NativeQueueRecordV3,
} from './native-queue-record-v3.ts';

export const NATIVE_QUEUE_TERMINAL_STATES: readonly NativeQueueState[] = Object.freeze([
	'completed', 'failed', 'cancelled',
]);

export const NATIVE_QUEUE_ACTIVE_STATES: readonly NativeQueueState[] = Object.freeze([
	'queued', 'running', 'paused', 'blocked', 'needs-authorization',
]);

export const NATIVE_QUEUE_BLOCK_CODES = Object.freeze([
	'project-revision-changed',
	'plan-fingerprint-changed',
	'input-fingerprint-changed',
	'root-grant-invalid',
	'helper-build-changed',
	'scratch-identity-changed',
] as const);

export type NativeQueueBlockCode = (typeof NATIVE_QUEUE_BLOCK_CODES)[number];

export type NativeQueueTransitionV1 =
	| Readonly<{ kind: 'dispatch' }>
	| Readonly<{ kind: 'report-progress'; value: number }>
	| Readonly<{ kind: 'pause' }>
	| Readonly<{ kind: 'await-carrier-regeneration' }>
	| Readonly<{ kind: 'resume' }>
	| Readonly<{ kind: 'cancel' }>
	| Readonly<{ kind: 'complete' }>
	| Readonly<{ kind: 'fail'; code: string }>
	| Readonly<{ kind: 'retry' }>
	| Readonly<{ kind: 'block'; code: NativeQueueBlockCode }>
	| Readonly<{ kind: 'require-authorization' }>
	| Readonly<{ kind: 'authorize'; rootGrantId?: string }>
	| Readonly<{ kind: 'reorder'; position: number }>;

export interface NativeQueueTransitionResultV1 {
	readonly record: NativeQueueRecordV1;
	/** The job's temporary sibling and scratch must be discarded before retry. */
	readonly discardedPartialOutput: boolean;
	/** The transition was a no-op because the row was already in that state. */
	readonly idempotent: boolean;
}

export interface NativeQueueRevalidationV1 {
	readonly projectRevisionMatches: boolean;
	readonly planFingerprintMatches: boolean;
	readonly inputFingerprintsMatch: boolean;
	readonly rootGrantAuthorized: boolean;
	readonly rootGrantValid: boolean;
	readonly helperBuildMatches: boolean;
	readonly scratchIdentityMatches: boolean;
	/** Frames that passed the plan, source, number, size, and digest checks. */
	readonly verifiedFrameCount?: number;
	readonly plannedFrameCount?: number;
}

export class NativeQueueTransitionError extends Error {
	readonly from: NativeQueueState;
	readonly transition: string;

	constructor(from: NativeQueueState, transition: string) {
		super(`A native queue job in ${from} cannot ${transition}.`);
		this.name = 'NativeQueueTransitionError';
		this.from = from;
		this.transition = transition;
	}
}

/** Apply one transition, producing the next canonical row. */
export function applyNativeQueueTransition(
	record: NativeQueueRecordV1,
	transition: NativeQueueTransitionV1,
	atMs: number,
): NativeQueueTransitionResultV1 {
	assertCurrentOrHistoricalRecord(record);
	if (isPermanentlyUnsupported(record) && transition.kind !== 'cancel') {
		throw new NativeQueueTransitionError(record.state, 'run an unsupported plan version');
	}
	const timestamp = timestampAtOrAfter(record, atMs);
	switch (transition.kind) {
		case 'dispatch': return dispatch(record, timestamp);
		case 'report-progress': return reportProgress(record, transition.value, timestamp);
		case 'pause': return pause(record, timestamp);
		case 'await-carrier-regeneration': return awaitCarrierRegeneration(record, timestamp);
		case 'resume': return resume(record, timestamp);
		case 'cancel': return cancel(record, timestamp);
		case 'complete': return complete(record, timestamp);
		case 'fail': return fail(record, transition.code, timestamp);
		case 'retry': return retry(record, timestamp);
		case 'block': return block(record, transition.code, timestamp);
		case 'require-authorization': return requireAuthorization(record, timestamp);
		case 'authorize': return authorize(record, timestamp, transition.rootGrantId);
		case 'reorder': return reorder(record, transition.position, timestamp);
		default: throw new NativeQueueTransitionError(record.state, 'apply an unknown transition');
	}
}

/**
 * Decide what one row read back from the database may do next.
 *
 * A settled row is left exactly as the user left it: a cancelled or failed job
 * comes back cancelled or failed, and only an explicit retry puts it in line
 * again, because restarting the application is not consent to render work the
 * user stopped. An unauthorized root is `needs-authorization` because the user
 * can fix it; a changed plan, revision, input, helper build, or scratch identity
 * is `blocked`, because silently running under the new facts
 * would render something the user never asked for.
 */
export function recoverNativeQueueRecord(
	record: NativeQueueRecordV1,
	revalidation: NativeQueueRevalidationV1,
	atMs: number,
): NativeQueueTransitionResultV1 {
	assertCurrentOrHistoricalRecord(record);
	if (NATIVE_QUEUE_TERMINAL_STATES.includes(record.state)) {
		return unchanged(record);
	}
	if (isPermanentlyUnsupported(record)) return unchanged(record);
	const timestamp = recoveryTimestamp(record, atMs);
	if (!revalidation.rootGrantAuthorized) {
		return applyNativeQueueTransition(record, { kind: 'require-authorization' }, timestamp);
	}
	const blockCode = firstBlockCode(revalidation);
	if (blockCode !== null) {
		return applyNativeQueueTransition(record, { kind: 'block', code: blockCode }, timestamp);
	}
	if (record.state === 'paused') return unchanged(record);
	return requeueForRecovery(record, revalidation, timestamp);
}

function firstBlockCode(revalidation: NativeQueueRevalidationV1): NativeQueueBlockCode | null {
	if (!revalidation.rootGrantValid) return 'root-grant-invalid';
	if (!revalidation.projectRevisionMatches) return 'project-revision-changed';
	if (!revalidation.planFingerprintMatches) return 'plan-fingerprint-changed';
	if (!revalidation.inputFingerprintsMatch) return 'input-fingerprint-changed';
	if (!revalidation.helperBuildMatches) return 'helper-build-changed';
	if (!revalidation.scratchIdentityMatches) return 'scratch-identity-changed';
	return null;
}

/**
 * A checkpointed sequence resumes from its verified frames; everything else
 * restarts from zero and throws its partial output away.
 */
function requeueForRecovery(
	record: NativeQueueRecordV1,
	revalidation: NativeQueueRevalidationV1,
	atMs: number,
): NativeQueueTransitionResultV1 {
	const checkpointed = record.recoveryClass === 'verified-frame-checkpoint';
	const verified = revalidation.verifiedFrameCount ?? 0;
	const planned = revalidation.plannedFrameCount ?? 0;
	const resumable = checkpointed && planned > 0 && verified > 0 && verified < planned;
	return {
		record: next(record, {
			state: 'queued',
			progress: resumable ? verified / planned : null,
			updatedAtMs: timestampAtOrAfter(record, atMs),
		}),
		discardedPartialOutput: !resumable,
		idempotent: false,
	};
}

function dispatch(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	// Idempotent by design: a crash between the row update and the real spawn
	// must not be able to charge a second attempt or start a second helper.
	if (record.state === 'running') return unchanged(record);
	if (record.state !== 'queued') throw new NativeQueueTransitionError(record.state, 'dispatch');
	return {
		record: next(record, { state: 'running', progress: 0, attempt: record.attempt + 1, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function reportProgress(
	record: NativeQueueRecordV1,
	value: number,
	atMs: number,
): NativeQueueTransitionResultV1 {
	if (record.state !== 'running') throw new NativeQueueTransitionError(record.state, 'report progress');
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('Native queue progress must be a finite ratio in [0, 1].');
	}
	if (value < (record.progress ?? 0)) {
		throw new RangeError('Native queue progress is monotonic; a job never reports going backwards.');
	}
	return {
		record: next(record, { progress: value, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function pause(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	if (record.state === 'paused') return unchanged(record);
	if (record.state !== 'queued' && record.state !== 'running') {
		throw new NativeQueueTransitionError(record.state, 'pause');
	}
	const wasRunning = record.state === 'running';
	const keepsCheckpoint = record.recoveryClass === 'verified-frame-checkpoint';
	return {
		record: next(record, {
			state: 'paused',
			progress: wasRunning && !keepsCheckpoint ? null : record.progress,
			updatedAtMs: atMs,
		}),
		discardedPartialOutput: wasRunning && !keepsCheckpoint,
		idempotent: false,
	};
}

function awaitCarrierRegeneration(
	record: NativeQueueRecordV1,
	atMs: number,
): NativeQueueTransitionResultV1 {
	if (record.state !== 'queued' && record.state !== 'running') {
		throw new NativeQueueTransitionError(record.state, 'await carrier regeneration');
	}
	return {
		record: next(record, {
			state: 'paused', progress: null,
			lastFailureCode: 'awaiting-carrier-regeneration', updatedAtMs: atMs,
		}),
		discardedPartialOutput: true,
		idempotent: false,
	};
}

function resume(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	if (record.state === 'queued') return unchanged(record);
	if (record.state !== 'paused') throw new NativeQueueTransitionError(record.state, 'resume');
	return {
		record: next(record, { state: 'queued', lastFailureCode: null, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function cancel(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	if (record.state === 'cancelled') return unchanged(record);
	if (!NATIVE_QUEUE_ACTIVE_STATES.includes(record.state)) {
		throw new NativeQueueTransitionError(record.state, 'cancel');
	}
	return {
		record: next(record, { state: 'cancelled', progress: null, updatedAtMs: atMs }),
		discardedPartialOutput: true,
		idempotent: false,
	};
}

function complete(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	// The final commit is idempotent for the same reason dispatch is: the
	// rename may have succeeded before the row update was durable.
	if (record.state === 'completed') return unchanged(record);
	if (record.state !== 'running') throw new NativeQueueTransitionError(record.state, 'complete');
	return {
		record: next(record, { state: 'completed', progress: 1, lastFailureCode: null, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function fail(record: NativeQueueRecordV1, code: string, atMs: number): NativeQueueTransitionResultV1 {
	if (record.state !== 'queued' && record.state !== 'running') {
		throw new NativeQueueTransitionError(record.state, 'fail');
	}
	return {
		record: next(record, { state: 'failed', lastFailureCode: code, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function retry(record: NativeQueueRecordV1, atMs: number): NativeQueueTransitionResultV1 {
	if (record.state !== 'failed' && record.state !== 'cancelled') {
		throw new NativeQueueTransitionError(record.state, 'retry');
	}
	return {
		record: next(record, { state: 'queued', progress: null, updatedAtMs: atMs }),
		discardedPartialOutput: true,
		idempotent: false,
	};
}

function block(
	record: NativeQueueRecordV1,
	code: NativeQueueBlockCode,
	atMs: number,
): NativeQueueTransitionResultV1 {
	if (!NATIVE_QUEUE_ACTIVE_STATES.includes(record.state)) {
		throw new NativeQueueTransitionError(record.state, 'become blocked');
	}
	if (!NATIVE_QUEUE_BLOCK_CODES.includes(code)) {
		throw new RangeError('A native queue block must name a known revalidation failure.');
	}
	return {
		record: next(record, {
			state: 'blocked', progress: null, lastFailureCode: code, updatedAtMs: atMs,
		}),
		discardedPartialOutput: true,
		idempotent: false,
	};
}

function requireAuthorization(
	record: NativeQueueRecordV1,
	atMs: number,
): NativeQueueTransitionResultV1 {
	if (!NATIVE_QUEUE_ACTIVE_STATES.includes(record.state)) {
		throw new NativeQueueTransitionError(record.state, 'require authorization');
	}
	return {
		record: next(record, {
			state: 'needs-authorization', progress: null,
			lastFailureCode: 'root-grant-invalid', updatedAtMs: atMs,
		}),
		discardedPartialOutput: true,
		idempotent: false,
	};
}

function authorize(
	record: NativeQueueRecordV1,
	atMs: number,
	rootGrantId: string | undefined,
): NativeQueueTransitionResultV1 {
	if (record.state !== 'needs-authorization' && record.state !== 'blocked') {
		throw new NativeQueueTransitionError(record.state, 'be authorized');
	}
	return {
		record: next(record, {
			state: 'queued', lastFailureCode: null, updatedAtMs: atMs,
			...(rootGrantId === undefined ? {} : { rootGrantId }),
		}),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function reorder(
	record: NativeQueueRecordV1,
	position: number,
	atMs: number,
): NativeQueueTransitionResultV1 {
	if (record.state === 'running' || !NATIVE_QUEUE_ACTIVE_STATES.includes(record.state)) {
		throw new NativeQueueTransitionError(record.state, 'be reordered');
	}
	return {
		record: next(record, { position, updatedAtMs: atMs }),
		discardedPartialOutput: false,
		idempotent: false,
	};
}

function unchanged(record: NativeQueueRecordV1): NativeQueueTransitionResultV1 {
	return { record, discardedPartialOutput: false, idempotent: true };
}

function next(
	record: NativeQueueRecordV1,
	changes: Partial<NativeQueueRecordV1>,
): NativeQueueRecordV1 {
	const updated = Object.freeze({ ...record, ...changes });
	assertCurrentOrHistoricalRecord(updated);
	return updated;
}

function assertCurrentOrHistoricalRecord(
	record: NativeQueueRecordV1,
): asserts record is NativeQueueRecordV1 | NativeQueueRecordV2 {
	if (Object.hasOwn(record, 'recordVersion')) {
		if ((record as Readonly<{ recordVersion?: unknown }>).recordVersion === 3) {
			assertNativeQueueRecordV3(record);
		} else assertNativeQueueRecordV2(record);
		return;
	}
	assertNativeQueueRecordV1(record);
}

function isPermanentlyUnsupported(record: NativeQueueRecordV1): boolean {
	return Object.hasOwn(record, 'recordVersion')
		&& ((record as Readonly<{ recordVersion?: unknown }>).recordVersion === 3
			? !isNativeQueueRecordV3Dispatchable(record as NativeQueueRecordV3)
			: !isNativeQueueRecordV2Dispatchable(record as NativeQueueRecordV2));
}

function timestampAtOrAfter(record: NativeQueueRecordV1, atMs: number): number {
	if (!Number.isSafeInteger(atMs) || atMs < record.updatedAtMs) {
		throw new RangeError('A native queue transition timestamp never precedes the row it updates.');
	}
	return atMs;
}

/**
 * A row written before the clock was corrected backwards is a fact about the
 * machine, not a caller mistake, so recovery keeps the later of the two stamps
 * and still answers with a typed decision rather than an error.
 */
function recoveryTimestamp(record: NativeQueueRecordV1, atMs: number): number {
	if (!Number.isSafeInteger(atMs) || atMs < 0) {
		throw new RangeError('A native queue recovery timestamp must be a non-negative safe integer.');
	}
	return Math.max(atMs, record.updatedAtMs);
}
