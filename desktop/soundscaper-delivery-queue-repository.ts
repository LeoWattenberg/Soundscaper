/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import type {
	SoundscaperDeliveryDescriptionV1,
	SoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import {
	assertSoundscaperDeliveryWriterLease,
	type SoundscaperDeliveryWriterLease,
} from './soundscaper-delivery-database.ts';
import {
	soundscaperDeliveryId,
	type SoundscaperDeliveryEvent,
	type SoundscaperDeliveryAttemptReportRow,
	type SoundscaperDeliveryPersistedState,
	type SoundscaperDeliveryQueueRow,
} from './soundscaper-delivery-service-contract.ts';

const RETAINED_EVENTS = 10_000;

export interface SoundscaperDeliveryInsertItem {
	readonly jobId: string;
	readonly description: SoundscaperDeliveryDescriptionV1;
	readonly batch: Readonly<{
		batchId: string;
		member: Readonly<Record<string, unknown>>;
	}> | null;
}

export class SoundscaperDeliveryQueueRepository {
	readonly #database: DatabaseSync;
	readonly #lease: () => SoundscaperDeliveryWriterLease;
	readonly #now: () => number;

	constructor(
		database: DatabaseSync,
		lease: () => SoundscaperDeliveryWriterLease,
		now: () => number,
	) {
		this.#database = database;
		this.#lease = lease;
		this.#now = now;
	}

	mutation<Result>(
		type: string,
		jobId: string | null,
		state: SoundscaperDeliveryPersistedState | null,
		operation: () => Result,
	): Result {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			assertSoundscaperDeliveryWriterLease(this.#database, this.#lease(), this.#now());
			const result = operation();
			this.#insertEvent(type, jobId, state);
			this.#database.exec('COMMIT');
			return result;
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}
	}

	insert(items: readonly SoundscaperDeliveryInsertItem[]): void {
		const now = this.#now();
		this.mutation('batch-enqueued', null, 'queued', () => {
			const firstPosition = Number((this.#database.prepare(
				'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM delivery_queue',
			).get() as Record<string, unknown>).position);
			const insert = this.#database.prepare(`
				INSERT INTO delivery_queue (
					job_id, description_json, label, project_id, project_revision, project_sha256,
					destination_grant_id, batch_id, batch_member_json, state, position, attempt,
					progress, claim_id, staging_name, staging_volume_identity,
					staging_file_identity, staging_recovery_token, final_name, staged_byte_length,
					staged_sha256, last_failure_code, result_json, created_at_ms, updated_at_ms
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
			`);
			items.forEach(({ description, batch, jobId }, index) => insert.run(
				jobId, JSON.stringify(description), description.label,
				description.projectIdentity.projectId, description.projectIdentity.projectRevision,
				description.projectIdentity.projectSha256, description.destinationGrantId,
				batch?.batchId ?? null, batch ? JSON.stringify(batch.member) : null,
				firstPosition + index, now, now,
			));
		});
	}

	row(jobId: unknown): SoundscaperDeliveryQueueRow {
		const row = this.#database.prepare('SELECT * FROM delivery_queue WHERE job_id = ?')
			.get(soundscaperDeliveryId(jobId, 'job')) as SoundscaperDeliveryQueueRow | undefined;
		if (!row) throw new Error('The Soundscaper delivery job does not exist.');
		return row;
	}

	rows(where: string, ...parameters: string[]): SoundscaperDeliveryQueueRow[] {
		return this.#database.prepare(`SELECT * FROM delivery_queue WHERE ${where}`)
			.all(...parameters) as SoundscaperDeliveryQueueRow[];
	}

	page(after: number, limit: number): SoundscaperDeliveryQueueRow[] {
		return this.#database.prepare(`
			SELECT * FROM delivery_queue WHERE position > ? ORDER BY position, created_at_ms LIMIT ?
		`).all(after, limit + 1) as SoundscaperDeliveryQueueRow[];
	}

	paused(): boolean {
		const row = this.#database.prepare(
			'SELECT paused FROM delivery_queue_state WHERE singleton = 1',
		).get() as Record<string, unknown>;
		return Number(row.paused) === 1;
	}

	events(after: number, limit: number): readonly SoundscaperDeliveryEvent[] {
		const rows = this.#database.prepare(`
			SELECT sequence, event_json, created_at_ms FROM delivery_events
			WHERE sequence > ? ORDER BY sequence LIMIT ?
		`).all(after, limit + 1) as Record<string, unknown>[];
		return Object.freeze(rows.map((row) => {
			const event = JSON.parse(String(row.event_json)) as Omit<SoundscaperDeliveryEvent, 'sequence' | 'createdAtMs'>;
			return Object.freeze({ ...event, sequence: Number(row.sequence), createdAtMs: Number(row.created_at_ms) });
		}));
	}

	attemptReports(jobId: string): readonly SoundscaperDeliveryAttemptReportRow[] {
		return this.#database.prepare(`
			SELECT attempt, outcome, failure_code, report_json
			FROM delivery_attempt_reports WHERE job_id = ? ORDER BY attempt
		`).all(jobId) as SoundscaperDeliveryAttemptReportRow[];
	}

	claim(jobId: string, claimId: string): void {
		this.mutation('claimed', jobId, 'running', () => {
			this.#database.prepare(`
				UPDATE delivery_queue SET state = 'running', claim_id = ?, attempt = attempt + 1,
					progress = 0, last_failure_code = NULL,
					updated_at_ms = ? WHERE job_id = ?
			`).run(claimId, this.#now(), jobId);
		});
	}

	progress(jobId: string, progress: number): void {
		this.mutation('progress', jobId, 'running', () => {
			const current = this.#database.prepare('SELECT progress FROM delivery_queue WHERE job_id = ?')
				.get(jobId) as Readonly<{ progress: number | null }> | undefined;
			if (!current) throw new Error('The Soundscaper delivery job does not exist.');
			if (current.progress !== null && progress < current.progress) {
				throw new RangeError('Soundscaper delivery progress cannot move backwards.');
			}
			this.#database.prepare('UPDATE delivery_queue SET progress = ?, updated_at_ms = ? WHERE job_id = ?')
				.run(progress, this.#now(), jobId);
		});
	}

	prepareWrite(jobId: string, stagingName: string, finalName: string): void {
		this.mutation('write-prepared', jobId, 'running', () => {
			this.#database.prepare(`
				UPDATE delivery_queue SET staging_name = ?, staging_volume_identity = NULL,
					staging_file_identity = NULL, staging_recovery_token = NULL,
					final_name = ?, updated_at_ms = ? WHERE job_id = ?
			`).run(stagingName, finalName, this.#now(), jobId);
		});
	}

	authenticateWrite(
		jobId: string,
		volumeIdentity: string,
		fileIdentity: string,
		recoveryToken: string,
	): void {
		this.mutation('write-authenticated', jobId, 'running', () => {
			this.#database.prepare(`
				UPDATE delivery_queue SET staging_volume_identity = ?, staging_file_identity = ?,
					staging_recovery_token = ?,
					updated_at_ms = ? WHERE job_id = ?
			`).run(volumeIdentity, fileIdentity, recoveryToken, this.#now(), jobId);
		});
	}

	sealWrite(jobId: string, byteLength: number, sha256: string): void {
		this.mutation('write-sealed', jobId, 'running', () => {
			this.#database.prepare(`
				UPDATE delivery_queue SET staged_byte_length = ?, staged_sha256 = ?, progress = 1,
					updated_at_ms = ? WHERE job_id = ?
			`).run(byteLength, sha256, this.#now(), jobId);
		});
	}

	clearStaging(jobId: string): void {
		this.mutation('write-cleared', jobId, 'running', () => {
			this.#database.prepare(`
				UPDATE delivery_queue SET staging_name = NULL, staging_volume_identity = NULL,
					staging_file_identity = NULL, staging_recovery_token = NULL, final_name = NULL,
					staged_byte_length = NULL, staged_sha256 = NULL, updated_at_ms = ? WHERE job_id = ?
			`).run(this.#now(), jobId);
		});
	}

	preparePublication(row: SoundscaperDeliveryQueueRow, result: SoundscaperDeliveryResultV1): void {
		this.mutation('publication-prepared', row.job_id, 'running', () => {
			this.#database.prepare(`
				INSERT INTO delivery_publication_journal (
					job_id, staging_name, final_name, byte_length, sha256, result_json, phase, created_at_ms
				) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)
			`).run(
				row.job_id, row.staging_name, row.final_name, row.staged_byte_length,
				row.staged_sha256, JSON.stringify(result), this.#now(),
			);
		});
	}

	markPublished(jobId: string): void {
		this.mutation('publication-linked', jobId, 'running', () => {
			this.#database.prepare(
				"UPDATE delivery_publication_journal SET phase = 'published' WHERE job_id = ?",
			).run(jobId);
		});
	}

	journal(jobId: string): Record<string, unknown> | undefined {
		return this.#database.prepare('SELECT * FROM delivery_publication_journal WHERE job_id = ?')
			.get(jobId) as Record<string, unknown> | undefined;
	}

	journals(): Record<string, unknown>[] {
		return this.#database.prepare(
			'SELECT * FROM delivery_publication_journal ORDER BY created_at_ms',
		).all() as Record<string, unknown>[];
	}

	settleCompleted(jobId: string, result: SoundscaperDeliveryResultV1): void {
		this.mutation('completed', jobId, 'completed', () => {
			this.#appendAttemptReport(jobId, 'completed', null, result.report);
			this.#database.prepare(`
				UPDATE delivery_queue SET state = 'completed', result_json = ?, report_json = ?, claim_id = NULL,
					staging_name = NULL, staging_volume_identity = NULL,
					staging_file_identity = NULL, staging_recovery_token = NULL,
					progress = 1, last_failure_code = NULL, updated_at_ms = ?
				WHERE job_id = ?
			`).run(JSON.stringify(result), JSON.stringify(result.report), this.#now(), jobId);
			this.#database.prepare('DELETE FROM delivery_publication_journal WHERE job_id = ?').run(jobId);
		});
	}

	settleFailed(jobId: string, failureCode: string, report: DeliveryReport | null): void {
		this.mutation('failed', jobId, 'failed', () => {
			if (report !== null) this.#appendAttemptReport(jobId, 'failed', failureCode, report);
			this.#database.prepare(`
				UPDATE delivery_queue SET state = 'failed', last_failure_code = ?,
					report_json = COALESCE(?, report_json),
					result_json = NULL, claim_id = NULL, progress = NULL,
					staging_name = NULL, staging_volume_identity = NULL,
					staging_file_identity = NULL, staging_recovery_token = NULL,
					final_name = NULL, staged_byte_length = NULL, staged_sha256 = NULL,
					updated_at_ms = ? WHERE job_id = ?
			`).run(failureCode, report === null ? null : JSON.stringify(report), this.#now(), jobId);
		});
	}

	discardJournalAndSetState(
		jobId: string,
		state: SoundscaperDeliveryPersistedState,
		failureCode: string | null,
		report: DeliveryReport | null = null,
	): void {
		this.mutation('state-changed', jobId, state, () => {
			this.#database.prepare('DELETE FROM delivery_publication_journal WHERE job_id = ?').run(jobId);
			this.#updateState(jobId, state, failureCode, true);
			if (report !== null) {
				this.#appendAttemptReport(jobId, state === 'completed' ? 'completed' : 'failed', failureCode, report);
				this.#database.prepare('UPDATE delivery_queue SET report_json = ? WHERE job_id = ?')
					.run(JSON.stringify(report), jobId);
			}
		});
	}

	setState(
		jobId: string,
		state: SoundscaperDeliveryPersistedState,
		failureCode: string | null,
		clearStaging = false,
	): void {
		this.mutation('state-changed', jobId, state, () => {
			this.#updateState(jobId, state, failureCode, clearStaging);
		});
	}

	setPaused(paused: boolean): void {
		this.mutation(paused ? 'paused' : 'resumed', null, null, () => {
			this.#database.prepare('UPDATE delivery_queue_state SET paused = ? WHERE singleton = 1')
				.run(paused ? 1 : 0);
		});
	}

	reorder(rows: readonly SoundscaperDeliveryQueueRow[], jobId: string, position: number): void {
		this.mutation('reordered', jobId, this.row(jobId).state, () => {
			const ordered = rows.filter((row) => row.job_id !== jobId);
			ordered.splice(position, 0, this.row(jobId));
			const update = this.#database.prepare(
				'UPDATE delivery_queue SET position = ?, updated_at_ms = ? WHERE job_id = ?',
			);
			ordered.forEach((row, index) => update.run(index, this.#now(), row.job_id));
		});
	}

	#updateState(
		jobId: string,
		state: SoundscaperDeliveryPersistedState,
		failureCode: string | null,
		clearStaging: boolean,
	): void {
		this.#database.prepare(`
			UPDATE delivery_queue SET state = ?, last_failure_code = ?, claim_id = NULL,
				progress = NULL, ${clearStaging ? 'staging_name = NULL, staging_volume_identity = NULL, staging_file_identity = NULL, staging_recovery_token = NULL, final_name = NULL, staged_byte_length = NULL, staged_sha256 = NULL,' : ''}
				updated_at_ms = ? WHERE job_id = ?
		`).run(state, failureCode, this.#now(), jobId);
	}

	#insertEvent(
		type: string,
		jobId: string | null,
		state: SoundscaperDeliveryPersistedState | null,
	): void {
		const row = this.#database.prepare(`
			UPDATE delivery_queue_state SET event_sequence = event_sequence + 1 WHERE singleton = 1
			RETURNING event_sequence
		`).get() as Record<string, unknown>;
		const sequence = Number(row.event_sequence);
		this.#database.prepare(
			'INSERT INTO delivery_events (sequence, event_json, created_at_ms) VALUES (?, ?, ?)',
		).run(sequence, JSON.stringify({ type, jobId, state }), this.#now());
		this.#database.prepare('DELETE FROM delivery_events WHERE sequence <= ?')
			.run(sequence - RETAINED_EVENTS);
	}

	#appendAttemptReport(
		jobId: string,
		outcome: 'completed' | 'failed',
		failureCode: string | null,
		report: DeliveryReport,
	): void {
		const row = this.#database.prepare('SELECT attempt FROM delivery_queue WHERE job_id = ?')
			.get(jobId) as Readonly<{ attempt: number }> | undefined;
		if (!row || !Number.isSafeInteger(row.attempt) || row.attempt < 1) {
			throw new Error('A Soundscaper delivery report requires a claimed attempt.');
		}
		this.#database.prepare(`
			INSERT INTO delivery_attempt_reports (
				job_id, attempt, outcome, failure_code, report_json, created_at_ms
			) VALUES (?, ?, ?, ?, ?, ?)
		`).run(jobId, row.attempt, outcome, failureCode, JSON.stringify(report), this.#now());
	}
}
