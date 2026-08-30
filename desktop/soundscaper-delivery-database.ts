/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';

/** `SSDL` — deliberately distinct from both project-library databases. */
export const SOUNDSCAPER_DELIVERY_APPLICATION_ID = 0x5353444c;
export const SOUNDSCAPER_DELIVERY_DATABASE_VERSION = 4;
export const SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME = 'soundscaper-delivery-services-v1.sqlite';
export const SOUNDSCAPER_DELIVERY_LEASE_MS = 30_000;

export interface SoundscaperDeliveryWriterLease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly expiresAtMs: number;
}

export class SoundscaperDeliveryDatabaseError extends Error {
	override readonly name = 'SoundscaperDeliveryDatabaseError';
}

export function initializeSoundscaperDeliveryDatabase(database: DatabaseSync): number {
	const applicationId = pragma(database, 'application_id');
	if (applicationId !== 0 && applicationId !== SOUNDSCAPER_DELIVERY_APPLICATION_ID) {
		throw new SoundscaperDeliveryDatabaseError(
			'The Soundscaper delivery database belongs to another application.',
		);
	}
	const version = pragma(database, 'user_version');
	if (version > SOUNDSCAPER_DELIVERY_DATABASE_VERSION) {
		throw new SoundscaperDeliveryDatabaseError(
			'The Soundscaper delivery database was written by a newer build and is refused.',
		);
	}
	database.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = FULL;
		PRAGMA trusted_schema = OFF;
		PRAGMA foreign_keys = ON;
	`);
	database.exec('BEGIN IMMEDIATE');
	try {
		if (version < 1) applyVersionOne(database);
		if (version < 2) applyVersionTwo(database);
		if (version < 3) applyVersionThree(database);
		if (version < 4) applyVersionFour(database);
		database.exec(`PRAGMA application_id = ${String(SOUNDSCAPER_DELIVERY_APPLICATION_ID)}`);
		database.exec(`PRAGMA user_version = ${String(SOUNDSCAPER_DELIVERY_DATABASE_VERSION)}`);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
	return SOUNDSCAPER_DELIVERY_DATABASE_VERSION;
}

export function acquireSoundscaperDeliveryWriterLease(
	database: DatabaseSync,
	options: Readonly<{
		leaseId: string; instanceId: string; processId: number; nowMs: number;
	}>,
): SoundscaperDeliveryWriterLease {
	const nowMs = timestamp(options.nowMs, 'lease acquisition time');
	const expiresAtMs = nowMs + SOUNDSCAPER_DELIVERY_LEASE_MS;
	database.exec('BEGIN IMMEDIATE');
	try {
		const row = database.prepare('SELECT * FROM delivery_writer_lease WHERE singleton = 1')
			.get() as Record<string, unknown>;
		if (Number(row.active) === 1 && row.owner_instance_id !== options.instanceId
			&& Number(row.expires_at_ms) > nowMs) {
			throw new SoundscaperDeliveryDatabaseError(
				'Another process holds the Soundscaper delivery writer lease.',
			);
		}
		const fencingToken = Number(row.fencing_token) + 1;
		database.prepare(`
			UPDATE delivery_writer_lease SET active = 1, lease_id = ?, fencing_token = ?,
				owner_process_id = ?, owner_instance_id = ?, acquired_at_ms = ?, expires_at_ms = ?
			WHERE singleton = 1
		`).run(
			opaqueId(options.leaseId, 'lease id'), fencingToken,
			positiveInteger(options.processId, 'owner process id'),
			opaqueId(options.instanceId, 'owner instance id'), nowMs, expiresAtMs,
		);
		database.exec('COMMIT');
		return Object.freeze({ leaseId: options.leaseId, fencingToken, expiresAtMs });
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

export function assertSoundscaperDeliveryWriterLease(
	database: DatabaseSync,
	lease: SoundscaperDeliveryWriterLease,
	nowMs: number,
): void {
	const row = database.prepare(`
		SELECT active, lease_id, fencing_token, expires_at_ms
		FROM delivery_writer_lease WHERE singleton = 1
	`).get() as Record<string, unknown>;
	if (Number(row.active) !== 1 || row.lease_id !== lease.leaseId
		|| Number(row.fencing_token) !== lease.fencingToken) {
		throw new SoundscaperDeliveryDatabaseError(
			'The Soundscaper delivery writer lease was taken over and is fenced.',
		);
	}
	if (Number(row.expires_at_ms) <= timestamp(nowMs, 'lease assertion time')) {
		throw new SoundscaperDeliveryDatabaseError('The Soundscaper delivery writer lease expired.');
	}
}

export function renewSoundscaperDeliveryWriterLease(
	database: DatabaseSync,
	lease: SoundscaperDeliveryWriterLease,
	nowMs: number,
): SoundscaperDeliveryWriterLease {
	const renewedAtMs = timestamp(nowMs, 'lease renewal time');
	const expiresAtMs = renewedAtMs + SOUNDSCAPER_DELIVERY_LEASE_MS;
	database.exec('BEGIN IMMEDIATE');
	try {
		assertSoundscaperDeliveryWriterLease(database, lease, renewedAtMs);
		const changed = database.prepare(`
			UPDATE delivery_writer_lease SET expires_at_ms = ?
			WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
		`).run(expiresAtMs, lease.leaseId, lease.fencingToken).changes;
		if (changed !== 1) throw new SoundscaperDeliveryDatabaseError('The delivery lease renewal lost its fence.');
		database.exec('COMMIT');
		return Object.freeze({ ...lease, expiresAtMs });
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

export function releaseSoundscaperDeliveryWriterLease(
	database: DatabaseSync,
	lease: SoundscaperDeliveryWriterLease,
): boolean {
	return database.prepare(`
		UPDATE delivery_writer_lease SET active = 0, expires_at_ms = 0
		WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
	`).run(lease.leaseId, lease.fencingToken).changes === 1;
}

function applyVersionTwo(database: DatabaseSync): void {
	database.exec('ALTER TABLE delivery_queue ADD COLUMN staging_recovery_token TEXT');
}

function applyVersionThree(database: DatabaseSync): void {
	database.exec('ALTER TABLE delivery_queue ADD COLUMN report_json TEXT');
	database.exec(`
		UPDATE delivery_queue SET report_json = json_extract(result_json, '$.report')
		WHERE result_json IS NOT NULL
	`);
}

function applyVersionFour(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE delivery_attempt_reports (
			job_id TEXT NOT NULL REFERENCES delivery_queue(job_id),
			attempt INTEGER NOT NULL CHECK (attempt >= 1),
			outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed')),
			failure_code TEXT CHECK (
				failure_code IS NULL OR (length(failure_code) >= 1 AND length(failure_code) <= 128)
			),
			report_json TEXT NOT NULL CHECK (
				json_valid(report_json) AND json_type(report_json) = 'object'
			),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			PRIMARY KEY (job_id, attempt)
		) STRICT, WITHOUT ROWID;
		INSERT INTO delivery_attempt_reports (
			job_id, attempt, outcome, failure_code, report_json, created_at_ms
		)
		SELECT job_id, attempt,
			CASE WHEN state = 'completed' THEN 'completed' ELSE 'failed' END,
			CASE WHEN state = 'completed' THEN NULL ELSE last_failure_code END,
			report_json, updated_at_ms
		FROM delivery_queue
		WHERE report_json IS NOT NULL AND attempt >= 1;
		CREATE TRIGGER delivery_attempt_reports_no_update
		BEFORE UPDATE ON delivery_attempt_reports BEGIN
			SELECT RAISE(ABORT, 'Soundscaper delivery attempt reports are append-only');
		END;
		CREATE TRIGGER delivery_attempt_reports_no_delete
		BEFORE DELETE ON delivery_attempt_reports BEGIN
			SELECT RAISE(ABORT, 'Soundscaper delivery attempt reports are append-only');
		END;
	`);
}

function applyVersionOne(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE delivery_writer_lease (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			active INTEGER NOT NULL CHECK (active IN (0, 1)),
			lease_id TEXT,
			fencing_token INTEGER NOT NULL CHECK (fencing_token >= 0),
			owner_process_id INTEGER,
			owner_instance_id TEXT,
			acquired_at_ms INTEGER,
			expires_at_ms INTEGER
		) STRICT;
		INSERT INTO delivery_writer_lease (
			singleton, active, lease_id, fencing_token, owner_process_id,
			owner_instance_id, acquired_at_ms, expires_at_ms
		) VALUES (1, 0, NULL, 0, NULL, NULL, NULL, 0);
		CREATE TABLE delivery_roots (
			grant_id TEXT PRIMARY KEY CHECK (length(grant_id) = 48),
			root_path TEXT NOT NULL CHECK (length(root_path) > 0),
			volume_identity TEXT NOT NULL CHECK (length(volume_identity) > 0),
			directory_identity TEXT NOT NULL CHECK (length(directory_identity) > 0),
			authorized_at_ms INTEGER NOT NULL CHECK (authorized_at_ms >= 0),
			revoked_at_ms INTEGER CHECK (
				revoked_at_ms IS NULL OR revoked_at_ms >= authorized_at_ms
			)
		) STRICT;
		CREATE TABLE delivery_queue_state (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
			event_sequence INTEGER NOT NULL CHECK (event_sequence >= 0)
		) STRICT;
		INSERT INTO delivery_queue_state (singleton, paused, event_sequence) VALUES (1, 0, 0);
		CREATE TABLE delivery_queue (
			job_id TEXT PRIMARY KEY CHECK (length(job_id) = 48),
			description_json TEXT NOT NULL CHECK (length(description_json) > 0),
			label TEXT NOT NULL CHECK (length(label) > 0),
			project_id TEXT NOT NULL CHECK (length(project_id) > 0),
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			project_sha256 TEXT NOT NULL CHECK (length(project_sha256) = 64),
			destination_grant_id TEXT NOT NULL REFERENCES delivery_roots(grant_id),
			batch_id TEXT,
			batch_member_json TEXT,
			state TEXT NOT NULL CHECK (state IN (
				'queued', 'running', 'needs-authorization', 'stale',
				'completed', 'failed', 'cancelled'
			)),
			position INTEGER NOT NULL CHECK (position >= 0),
			attempt INTEGER NOT NULL CHECK (attempt >= 0),
			progress REAL CHECK (progress IS NULL OR (progress >= 0.0 AND progress <= 1.0)),
			claim_id TEXT CHECK (claim_id IS NULL OR length(claim_id) = 48),
			staging_name TEXT,
			staging_volume_identity TEXT,
			staging_file_identity TEXT,
			final_name TEXT,
			staged_byte_length INTEGER CHECK (staged_byte_length IS NULL OR staged_byte_length >= 0),
			staged_sha256 TEXT CHECK (staged_sha256 IS NULL OR length(staged_sha256) = 64),
			last_failure_code TEXT,
			result_json TEXT,
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
			CHECK (state <> 'running' OR claim_id IS NOT NULL),
			CHECK (state <> 'failed' OR last_failure_code IS NOT NULL),
			CHECK (state <> 'completed' OR result_json IS NOT NULL)
		) STRICT;
		CREATE INDEX delivery_queue_dispatch ON delivery_queue (state, position, created_at_ms);
		CREATE TABLE delivery_events (
			sequence INTEGER PRIMARY KEY CHECK (sequence >= 1),
			event_json TEXT NOT NULL CHECK (length(event_json) > 0),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
		) STRICT;
		CREATE TABLE delivery_publication_journal (
			job_id TEXT PRIMARY KEY REFERENCES delivery_queue(job_id) ON DELETE CASCADE,
			staging_name TEXT NOT NULL,
			final_name TEXT NOT NULL,
			byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
			sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
			result_json TEXT NOT NULL CHECK (length(result_json) > 0),
			phase TEXT NOT NULL CHECK (phase IN ('prepared', 'published')),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
		) STRICT;
	`);
}

function pragma(database: DatabaseSync, name: string): number {
	const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
	return Number(row[name]);
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
		throw new TypeError(`Soundscaper delivery ${label} is invalid.`);
	}
	return value;
}

function timestamp(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`Soundscaper delivery ${label} is invalid.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	const result = timestamp(value, label);
	if (result < 1) throw new RangeError(`Soundscaper delivery ${label} must be positive.`);
	return result;
}
