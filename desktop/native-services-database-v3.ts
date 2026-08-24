/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	assertNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import {
	migrateNativeQueueRecordV2ToV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID,
	initializeFramescaperNativeServicesDatabase,
} from './native-services-database.ts';

export const FRAMESCAPER_NATIVE_SERVICES_DATABASE_V3_VERSION = 3 as const;

const TASKS = Object.freeze(['encoded-export', 'image-sequence-export', 'proxy-generation']);
const RECOVERY = Object.freeze(['atomic-restart', 'verified-frame-checkpoint']);
const STATES = Object.freeze([
	'queued', 'running', 'paused', 'blocked', 'needs-authorization',
	'completed', 'failed', 'cancelled',
]);
const CUSTODY_PLAN_VERSIONS = Object.freeze([6, 7, 8, 9, 10, 11, 12, 13]);
const PLAN_VERSIONS = Object.freeze([...CUSTODY_PLAN_VERSIONS, 14]);

/** Open the selected services generation while leaving the dormant V2 initializer immutable. */
export function initializeFramescaperNativeServicesDatabaseV3(database: DatabaseSync): 3 {
	const applicationId = pragma(database, 'application_id');
	if (applicationId !== 0 && applicationId !== FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID) {
		throw new Error('The Framescaper native services V3 database belongs to another application.');
	}
	const initial = pragma(database, 'user_version');
	if (initial > FRAMESCAPER_NATIVE_SERVICES_DATABASE_V3_VERSION) {
		throw new Error('The Framescaper native services V3 database was written by a newer build.');
	}
	database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;');
	if (initial < FRAMESCAPER_NATIVE_SERVICES_DATABASE_V3_VERSION) {
		initializeFramescaperNativeServicesDatabase(database);
		database.exec('BEGIN IMMEDIATE');
		try {
			applyFramescaperNativeServicesDatabaseVersionThree(database);
			database.exec(`PRAGMA application_id = ${String(FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID)}`);
			database.exec(`PRAGMA user_version = ${String(FRAMESCAPER_NATIVE_SERVICES_DATABASE_V3_VERSION)}`);
			database.exec('COMMIT');
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}
	}
	return FRAMESCAPER_NATIVE_SERVICES_DATABASE_V3_VERSION;
}

/** Losslessly move every V2 row into record V3; only exact plan V14 may remain executable. */
export function applyFramescaperNativeServicesDatabaseVersionThree(database: DatabaseSync): void {
	const migrated = readVersionTwoQueueRecords(database).map(migrateNativeQueueRecordV2ToV3);
	database.exec(`
		CREATE TABLE render_queue_jobs_v3 (
			job_id TEXT PRIMARY KEY CHECK (length(job_id) = 40),
			record_version INTEGER NOT NULL CHECK (record_version = 3),
			task_kind TEXT NOT NULL CHECK (task_kind IN (${domain(TASKS)})),
			plan_version INTEGER NOT NULL CHECK (plan_version IN (${PLAN_VERSIONS.join(', ')})),
			plan_fingerprint TEXT NOT NULL CHECK (length(plan_fingerprint) = 64),
			plan_payload TEXT NOT NULL CHECK (length(plan_payload) > 0),
			project_id TEXT NOT NULL CHECK (length(project_id) > 0),
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			input_fingerprints TEXT NOT NULL,
			root_grant_id TEXT NOT NULL REFERENCES durable_root_grants(grant_id),
			relative_destination TEXT NOT NULL CHECK (
				length(relative_destination) > 0
				AND relative_destination NOT LIKE '/%'
				AND instr('/' || relative_destination || '/', '//') = 0
				AND instr('/' || relative_destination || '/', '/./') = 0
				AND instr('/' || relative_destination || '/', '/../') = 0
				AND instr(relative_destination, ':') = 0
				AND instr(relative_destination, char(92)) = 0
			),
			reservations TEXT NOT NULL,
			recovery_class TEXT NOT NULL CHECK (recovery_class IN (${domain(RECOVERY)})),
			state TEXT NOT NULL CHECK (state IN (${domain(STATES)})),
			position INTEGER NOT NULL CHECK (position >= 0),
			progress REAL CHECK (progress IS NULL OR (progress >= 0.0 AND progress <= 1.0)),
			attempt INTEGER NOT NULL CHECK (attempt >= 0),
			last_failure_code TEXT,
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
			CHECK (recovery_class <> 'verified-frame-checkpoint' OR task_kind = 'image-sequence-export'),
			CHECK (state <> 'failed' OR last_failure_code IS NOT NULL),
			CHECK (
				plan_version = 14
				OR (
					plan_version IN (${CUSTODY_PLAN_VERSIONS.join(', ')})
					AND (state = 'completed' OR (
						state IN ('blocked', 'cancelled')
						AND last_failure_code = 'unsupported-plan-version'
					))
				)
			)
		) STRICT;
		CREATE TABLE scratch_reservations_v3 (
			job_id TEXT PRIMARY KEY REFERENCES render_queue_jobs_v3(job_id) ON DELETE CASCADE,
			directory_name TEXT NOT NULL CHECK (length(directory_name) > 0),
			manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
			root_identity TEXT NOT NULL CHECK (length(root_identity) > 0),
			reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= 0),
			state TEXT NOT NULL CHECK (state IN ('reserved', 'released', 'retained')),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms >= created_at_ms)
		) STRICT;
	`);
	const insert = database.prepare(`
		INSERT INTO render_queue_jobs_v3 (
			job_id, record_version, task_kind, plan_version, plan_fingerprint, plan_payload,
			project_id, project_revision, input_fingerprints, root_grant_id,
			relative_destination, reservations, recovery_class, state, position, progress,
			attempt, last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	for (const record of migrated) insert.run(...values(record));
	database.exec(`
		INSERT INTO scratch_reservations_v3
			(job_id, directory_name, manifest_digest, root_identity, reserved_bytes, state, created_at_ms, expires_at_ms)
		SELECT job_id, directory_name, manifest_digest, root_identity, reserved_bytes, state, created_at_ms, expires_at_ms
		FROM scratch_reservations;
		DROP TABLE scratch_reservations;
		DROP TABLE render_queue_jobs;
		ALTER TABLE render_queue_jobs_v3 RENAME TO render_queue_jobs;
		ALTER TABLE scratch_reservations_v3 RENAME TO scratch_reservations;
		CREATE INDEX render_queue_jobs_dispatch
			ON render_queue_jobs (state, position, created_at_ms);
	`);
}

function readVersionTwoQueueRecords(database: DatabaseSync): readonly NativeQueueRecordV2[] {
	const rows = database.prepare('SELECT * FROM render_queue_jobs ORDER BY job_id').all() as Record<string, unknown>[];
	return rows.map((row) => {
		const record: NativeQueueRecordV2 = {
			jobId: row.job_id as string, recordVersion: row.record_version as 2,
			taskKind: row.task_kind as NativeQueueRecordV2['taskKind'],
			planVersion: row.plan_version as NativeQueueRecordV2['planVersion'],
			planFingerprint: row.plan_fingerprint as string, planPayload: row.plan_payload as string,
			projectId: row.project_id as string, projectRevision: row.project_revision as number,
			inputFingerprints: json(row.input_fingerprints, 'input fingerprints') as NativeQueueRecordV2['inputFingerprints'],
			rootGrantId: row.root_grant_id as string, relativeDestination: row.relative_destination as string,
			reservations: json(row.reservations, 'reservations') as NativeQueueRecordV2['reservations'],
			recoveryClass: row.recovery_class as NativeQueueRecordV2['recoveryClass'],
			state: row.state as NativeQueueRecordV2['state'], position: row.position as number,
			progress: row.progress as number | null, attempt: row.attempt as number,
			lastFailureCode: row.last_failure_code as string | null,
			createdAtMs: row.created_at_ms as number, updatedAtMs: row.updated_at_ms as number,
		};
		assertNativeQueueRecordV2(record);
		return record;
	});
}

function values(record: NativeQueueRecordV3) {
	return [
		record.jobId, record.recordVersion, record.taskKind, record.planVersion,
		record.planFingerprint, record.planPayload, record.projectId, record.projectRevision,
		JSON.stringify(record.inputFingerprints), record.rootGrantId, record.relativeDestination,
		JSON.stringify(record.reservations), record.recoveryClass, record.state, record.position,
		record.progress, record.attempt, record.lastFailureCode, record.createdAtMs, record.updatedAtMs,
	] as const;
}

function json(value: unknown, name: string): unknown {
	if (typeof value !== 'string') throw new TypeError(`Stored V2 ${name} are not JSON text.`);
	try { return JSON.parse(value) as unknown; } catch { throw new TypeError(`Stored V2 ${name} are invalid JSON.`); }
}

function domain(values: readonly string[]): string {
	return values.map((value) => `'${value}'`).join(', ');
}

function pragma(database: DatabaseSync, name: string): number {
	const row = database.prepare(`PRAGMA ${name}`).get();
	const value = row ? Object.values(row)[0] : 0;
	return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0;
}
