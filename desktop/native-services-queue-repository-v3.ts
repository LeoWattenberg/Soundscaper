/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import {
	admitNativeQueueJobs,
	type NativeQueueAdmissionV1,
	type NativeQueueCapacityV1,
} from '../src/common/editor/native-queue-admission.ts';
import {
	assertNativeQueueRecordV3,
	isNativeQueueRecordV3Dispatchable,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import {
	applyNativeQueueTransition,
	recoverNativeQueueRecord,
	type NativeQueueRevalidationV1,
	type NativeQueueTransitionResultV1,
	type NativeQueueTransitionV1,
} from '../src/common/editor/native-queue-state-machine.ts';
import {
	assertFramescaperNativeServicesWriterLease,
	type FramescaperNativeServicesLease,
} from './native-services-database.ts';
import {
	admitFramescaperNativeRootSelection,
	type FramescaperNativeRootSelection,
} from './native-services-root-repository.ts';

const MAXIMUM_QUEUE_ROWS = 100_000;

export interface FramescaperNativeQueueDispatch {
	readonly admission: NativeQueueAdmissionV1;
	readonly records: readonly NativeQueueRecordV3[];
}

export interface FramescaperNativeQueueRecovery {
	readonly jobId: string;
	readonly record: NativeQueueRecordV3;
	readonly discardedPartialOutput: boolean;
}

export type FramescaperNativeQueueRevalidator = (
	record: NativeQueueRecordV3,
) => NativeQueueRevalidationV1;

export function nativeQueueRecordNeedsRecoveryRevalidation(
	record: NativeQueueRecordV3,
): boolean {
	return isNativeQueueRecordV3Dispatchable(record)
		&& record.state !== 'completed' && record.state !== 'failed' && record.state !== 'cancelled';
}

export class FramescaperNativeQueueRepository {
	readonly #database: DatabaseSync;

	constructor(database: DatabaseSync) {
		this.#database = database;
	}

	enqueue(
		record: NativeQueueRecordV3,
		lease: FramescaperNativeServicesLease,
		nowMs: number,
	): NativeQueueRecordV3 {
		assertNativeQueueRecordV3(record);
		this.#mutation(lease, nowMs, () => {
			const count = Number((this.#database.prepare(
				'SELECT COUNT(*) AS count FROM render_queue_jobs',
			).get() as Record<string, unknown>).count);
			if (count >= MAXIMUM_QUEUE_ROWS) throw new RangeError('The native render queue is full.');
			insertRecord(this.#database, record);
		});
		return record;
	}

	read(jobId: string): NativeQueueRecordV3 | null {
		const row = this.#database.prepare(
			'SELECT * FROM render_queue_jobs WHERE job_id = ?',
		).get(jobIdValue(jobId)) as Record<string, unknown> | undefined;
		return row ? decodeRecord(row) : null;
	}

	list(): readonly NativeQueueRecordV3[] {
		const rows = this.#database.prepare(`
			SELECT * FROM render_queue_jobs
			ORDER BY position, created_at_ms, job_id LIMIT ${String(MAXIMUM_QUEUE_ROWS + 1)}
		`).all() as Record<string, unknown>[];
		if (rows.length > MAXIMUM_QUEUE_ROWS) throw new RangeError('The native render queue exceeds its row ceiling.');
		return Object.freeze(rows.map(decodeRecord));
	}

	/** Recheck the exact writer generation around an awaited physical operation. */
	assertWriterLease(lease: FramescaperNativeServicesLease, nowMs: number): void {
		assertFramescaperNativeServicesWriterLease(this.#database, lease, nowMs);
	}

	control(
		jobId: string,
		transition: NativeQueueTransitionV1,
		lease: FramescaperNativeServicesLease,
		atMs: number,
	): NativeQueueTransitionResultV1 & Readonly<{ record: NativeQueueRecordV3 }> {
		return this.#mutation(lease, atMs, () => {
			const current = this.#require(jobId);
			const result = applyNativeQueueTransition(current, transition, atMs);
			assertNativeQueueRecordV3(result.record);
			if (!result.idempotent) updateRecord(this.#database, result.record, current.updatedAtMs);
			return Object.freeze({ ...result, record: result.record });
		});
	}

	reauthorizeRoot(
		expected: NativeQueueRecordV3,
		selectionValue: FramescaperNativeRootSelection,
		lease: FramescaperNativeServicesLease,
		atMs: number,
	): NativeQueueRecordV3 {
		assertNativeQueueRecordV3(expected);
		const selection = admitFramescaperNativeRootSelection(selectionValue);
		return this.#mutation(lease, atMs, () => {
			const current = this.#require(expected.jobId);
			if (current.updatedAtMs !== expected.updatedAtMs
				|| current.rootGrantId !== expected.rootGrantId
				|| current.state !== 'needs-authorization') {
				throw new Error('The native queue job changed before root reauthorization committed.');
			}
			const former = this.#database.prepare(`
				SELECT root_path, volume_identity, directory_identity
				FROM durable_root_grants WHERE grant_id = ?
			`).get(current.rootGrantId) as Record<string, unknown> | undefined;
			if (!former
				|| former.root_path !== selection.rootPath
				|| former.volume_identity !== selection.volumeIdentity
				|| former.directory_identity !== selection.directoryIdentity) {
				throw new Error('Queue reauthorization no longer names the same physical destination.');
			}
			if (this.#database.prepare(
				'SELECT 1 AS present FROM durable_root_grants WHERE grant_id = ?',
			).get(selection.grantId)) {
				throw new Error('Queue reauthorization requires a fresh durable-root grant id.');
			}
			this.#database.prepare(`
				INSERT INTO durable_root_grants (
					grant_id, root_path, volume_identity, directory_identity, authorized_at_ms, revoked_at_ms
				) VALUES (?, ?, ?, ?, ?, NULL)
			`).run(
				selection.grantId, selection.rootPath, selection.volumeIdentity,
				selection.directoryIdentity, selection.authorizedAtMs,
			);
			const next = applyNativeQueueTransition(current, {
				kind: 'authorize', rootGrantId: selection.grantId,
			}, atMs).record;
			assertNativeQueueRecordV3(next);
			updateRecord(this.#database, next, current.updatedAtMs);
			return next;
		});
	}

	reorder(
		jobId: string,
		index: number,
		lease: FramescaperNativeServicesLease,
		atMs: number,
	): readonly NativeQueueRecordV3[] {
		if (!Number.isSafeInteger(index) || index < 0) {
			throw new RangeError('A native queue reorder index must be a non-negative safe integer.');
		}
		return this.#mutation(lease, atMs, () => {
			const rows = [...this.list()];
			const selected = rows.find((record) => record.jobId === jobIdValue(jobId));
			if (!selected) throw new Error('The native queue job does not exist.');
			if (selected.state === 'running') throw new Error('A running native queue job cannot be reordered.');
			const reorderable = rows.filter((record) => (
				record.state === 'queued' || record.state === 'paused'
				|| record.state === 'blocked' || record.state === 'needs-authorization'
			));
			const from = reorderable.findIndex((record) => record.jobId === jobIdValue(jobId));
			if (from < 0) throw new Error('A terminal native queue job cannot be reordered.');
			const positions = reorderable.map(({ position }) => position).sort((left, right) => left - right);
			const [target] = reorderable.splice(from, 1);
			reorderable.splice(Math.min(index, reorderable.length), 0, target!);
			for (const [offset, record] of reorderable.entries()) {
				const position = positions[offset]!;
				if (record.position === position) continue;
				const transitioned = applyNativeQueueTransition(
					record, { kind: 'reorder', position }, Math.max(atMs, record.updatedAtMs),
				).record;
				assertNativeQueueRecordV3(transitioned);
				updateRecord(this.#database, transitioned, record.updatedAtMs);
			}
			return this.list();
		});
	}

	remove(jobId: string, lease: FramescaperNativeServicesLease, nowMs: number): boolean {
		return this.#mutation(lease, nowMs, () => {
			const record = this.read(jobId);
			if (record === null) return false;
			const removable = record.state === 'completed' || record.state === 'failed'
				|| record.state === 'cancelled'
				|| (record.state === 'blocked' && record.lastFailureCode === 'unsupported-plan-version');
			if (!removable) throw new Error('An active native queue job must be cancelled before removal.');
			return this.#database.prepare(
				'DELETE FROM render_queue_jobs WHERE job_id = ? AND updated_at_ms = ?',
			).run(record.jobId, record.updatedAtMs).changes === 1;
		});
	}

	dispatchReady(
		lease: FramescaperNativeServicesLease,
		atMs: number,
		capacity: NativeQueueCapacityV1,
	): FramescaperNativeQueueDispatch {
		return this.#mutation(lease, atMs, () => {
			const records = this.list();
			const runningCount = records.filter((record) => record.state === 'running').length;
			const admission = admitNativeQueueJobs(records, runningCount, capacity);
			const dispatched: NativeQueueRecordV3[] = [];
			for (const jobId of admission.admitted) {
				const current = this.#require(jobId);
				if (!isNativeQueueRecordV3Dispatchable(current) || current.state !== 'queued') {
					throw new Error('A native queue admission changed before dispatch.');
				}
				const next = applyNativeQueueTransition(current, { kind: 'dispatch' }, atMs).record;
				assertNativeQueueRecordV3(next);
				updateRecord(this.#database, next, current.updatedAtMs);
				dispatched.push(next);
			}
			return Object.freeze({ admission, records: Object.freeze(dispatched) });
		});
	}

	recover(
		lease: FramescaperNativeServicesLease,
		atMs: number,
		revalidate: FramescaperNativeQueueRevalidator,
	): readonly FramescaperNativeQueueRecovery[] {
		return this.#mutation(lease, atMs, () => {
			const recovered: FramescaperNativeQueueRecovery[] = [];
			for (const current of this.list()) {
				if (!nativeQueueRecordNeedsRecoveryRevalidation(current)) continue;
				const result = recoverNativeQueueRecord(current, revalidate(current), atMs);
				assertNativeQueueRecordV3(result.record);
				if (!result.idempotent) updateRecord(this.#database, result.record, current.updatedAtMs);
				if (!result.idempotent || result.record.state === 'queued') {
					recovered.push(Object.freeze({
						jobId: current.jobId,
						record: result.record,
						discardedPartialOutput: result.discardedPartialOutput,
					}));
				}
			}
			return Object.freeze(recovered);
		});
	}

	#require(jobId: string): NativeQueueRecordV3 {
		const record = this.read(jobId);
		if (record === null) throw new Error('The native queue job does not exist.');
		return record;
	}

	#mutation<Result>(
		lease: FramescaperNativeServicesLease,
		nowMs: number,
		operation: () => Result,
	): Result {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			assertFramescaperNativeServicesWriterLease(this.#database, lease, nowMs);
			const result = operation();
			this.#database.exec('COMMIT');
			return result;
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}
}

function insertRecord(database: DatabaseSync, record: NativeQueueRecordV3): void {
	database.prepare(`
		INSERT INTO render_queue_jobs (
			job_id, record_version, task_kind, plan_version, plan_fingerprint, plan_payload,
			project_id, project_revision, input_fingerprints, root_grant_id,
			relative_destination, reservations, recovery_class, state, position, progress,
			attempt, last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(...recordValues(record));
}

function updateRecord(database: DatabaseSync, record: NativeQueueRecordV3, previousUpdatedAtMs: number): void {
	const result = database.prepare(`
		UPDATE render_queue_jobs SET
			record_version = ?, task_kind = ?, plan_version = ?, plan_fingerprint = ?, plan_payload = ?,
			project_id = ?, project_revision = ?, input_fingerprints = ?, root_grant_id = ?,
			relative_destination = ?, reservations = ?, recovery_class = ?, state = ?, position = ?,
			progress = ?, attempt = ?, last_failure_code = ?, created_at_ms = ?, updated_at_ms = ?
		WHERE job_id = ? AND updated_at_ms = ?
	`).run(...recordValues(record).slice(1), record.jobId, previousUpdatedAtMs);
	if (result.changes !== 1) throw new Error('The native queue job lost its durable compare-and-swap.');
}

function recordValues(record: NativeQueueRecordV3): readonly SQLInputValue[] {
	return [
		record.jobId, record.recordVersion, record.taskKind, record.planVersion,
		record.planFingerprint, record.planPayload, record.projectId, record.projectRevision,
		JSON.stringify(record.inputFingerprints), record.rootGrantId, record.relativeDestination,
		JSON.stringify(record.reservations), record.recoveryClass, record.state, record.position,
		record.progress, record.attempt, record.lastFailureCode, record.createdAtMs, record.updatedAtMs,
	];
}

function decodeRecord(row: Record<string, unknown>): NativeQueueRecordV3 {
	const record: NativeQueueRecordV3 = {
		jobId: row.job_id as string,
		recordVersion: row.record_version as 3,
		taskKind: row.task_kind as NativeQueueRecordV3['taskKind'],
		planVersion: row.plan_version as NativeQueueRecordV3['planVersion'],
		planFingerprint: row.plan_fingerprint as string,
		planPayload: row.plan_payload as string,
		projectId: row.project_id as string,
		projectRevision: row.project_revision as number,
		inputFingerprints: parseJson(row.input_fingerprints, 'input fingerprints') as NativeQueueRecordV3['inputFingerprints'],
		rootGrantId: row.root_grant_id as string,
		relativeDestination: row.relative_destination as string,
		reservations: parseJson(row.reservations, 'reservations') as NativeQueueRecordV3['reservations'],
		recoveryClass: row.recovery_class as NativeQueueRecordV3['recoveryClass'],
		state: row.state as NativeQueueRecordV3['state'],
		position: row.position as number,
		progress: row.progress as number | null,
		attempt: row.attempt as number,
		lastFailureCode: row.last_failure_code as string | null,
		createdAtMs: row.created_at_ms as number,
		updatedAtMs: row.updated_at_ms as number,
	};
	assertNativeQueueRecordV3(record);
	return Object.freeze(record);
}

function parseJson(value: unknown, label: string): unknown {
	if (typeof value !== 'string') throw new TypeError(`Stored native queue ${label} are not JSON text.`);
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new TypeError(`Stored native queue ${label} are invalid JSON.`);
	}
}

function jobIdValue(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A native queue operation requires an exact job id.');
	}
	return value;
}
