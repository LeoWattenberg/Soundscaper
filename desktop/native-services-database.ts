/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-owned `framescaper-native-services.sqlite` database.
 *
 * It is deliberately a second database rather than more tables in the project
 * library: background services outlive any one project, and a corrupt or
 * migrating services database must never be able to take the user's project
 * library down with it.
 *
 * Every table is STRICT and carries its invariants as CHECK constraints, so a
 * row that violates the queue contract cannot be written even by a code path
 * that forgot to validate. The journal is WAL with full synchronous commits,
 * because a queue that loses its last few transactions on power loss is a queue
 * that silently re-runs or silently drops finished work.
 *
 * Schema changes are explicit, numbered migrations. A database stamped with a
 * *newer* version than this build understands is refused outright rather than
 * opened read-only or best-effort migrated backwards: an older build cannot
 * know what a newer one meant by a column it has never seen.
 */

import { DatabaseSync } from 'node:sqlite';

import {
	migrateNativeQueueRecordV1ToV2,
	type NativeQueueRecordV1,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';

/** 'FSNS' — distinct from the project library's own application id. */
export const FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID = 0x46534e53;

export const FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION = 2;

export const FRAMESCAPER_NATIVE_SERVICES_DATABASE_FILE_NAME = 'framescaper-native-services.sqlite';

/** A lease is renewed well inside this window; a crashed owner expires out of it. */
export const FRAMESCAPER_NATIVE_SERVICES_LEASE_MS = 30_000;

export interface FramescaperNativeServicesLease {
	readonly leaseId: string;
	readonly fencingToken: number;
	readonly expiresAtMs: number;
}

export class FramescaperNativeServicesDatabaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FramescaperNativeServicesDatabaseError';
	}
}

interface Migration {
	readonly version: number;
	apply(database: DatabaseSync): void;
}

const MIGRATIONS: readonly Migration[] = Object.freeze([
	Object.freeze({ version: 1, apply: applyVersionOne }),
	Object.freeze({ version: 2, apply: applyVersionTwo }),
]);

/**
 * The closed domains version one froze into the queue table.
 *
 * They are declared here rather than imported from the record contract because
 * a migration's text is frozen the moment it ships: `CREATE TABLE IF NOT
 * EXISTS` never rewrites an existing table's constraints, so a schema built
 * from whatever the registry happens to hold today would agree with the record
 * contract on a fresh database and silently disagree on every migrated one. A
 * later registry member therefore needs its own migration, and
 * `tests/desktop-native-services-database.test.ts` fails until it has one.
 */
const VERSION_ONE_TASK_KINDS = Object.freeze([
	'encoded-export', 'image-sequence-export', 'proxy-generation',
]);
const VERSION_ONE_CHECKPOINTABLE_TASK_KINDS = Object.freeze(['image-sequence-export']);
const VERSION_ONE_RECOVERY_CLASSES = Object.freeze(['atomic-restart', 'verified-frame-checkpoint']);
const VERSION_ONE_STATES = Object.freeze([
	'queued', 'running', 'paused', 'blocked', 'needs-authorization',
	'completed', 'failed', 'cancelled',
]);

/** Frozen V2 domains; a later executable plan requires another SQL migration. */
const VERSION_TWO_PLAN_VERSIONS = Object.freeze([6, 7, 8, 9, 10, 11, 12]);
const VERSION_TWO_ACTIVE_PLAN_VERSIONS = Object.freeze([7, 8, 9, 10, 11, 12]);

/**
 * Open, verify, and migrate the services database, returning its version.
 *
 * The application id is checked before anything else so that pointing this
 * initializer at an unrelated SQLite file — including the project library —
 * fails loudly instead of adding tables to it.
 */
export function initializeFramescaperNativeServicesDatabase(database: DatabaseSync): number {
	const applicationId = pragmaNumber(database, 'application_id');
	if (applicationId !== 0 && applicationId !== FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID) {
		throw new FramescaperNativeServicesDatabaseError(
			'The Framescaper native services database belongs to another application.',
		);
	}
	const userVersion = pragmaNumber(database, 'user_version');
	if (userVersion > FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION) {
		throw new FramescaperNativeServicesDatabaseError(
			'The Framescaper native services database was written by a newer build and is refused.',
		);
	}
	database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;');
	database.exec('BEGIN IMMEDIATE');
	try {
		for (const migration of MIGRATIONS) {
			if (migration.version > userVersion) migration.apply(database);
		}
		database.exec(`PRAGMA application_id = ${String(FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID)}`);
		database.exec(`PRAGMA user_version = ${String(FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION)}`);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
	return FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION;
}

/**
 * Take the single-writer lease. Only its holder may dispatch work, so a second
 * application instance cannot start a helper for a job this one already owns.
 * An expired lease may be taken over — its owner is gone — but a live one may
 * not, and every takeover advances the fencing token so a returning zombie
 * writer is recognisable and refused.
 */
export function acquireFramescaperNativeServicesWriterLease(
	database: DatabaseSync,
	options: Readonly<{ leaseId: string; instanceId: string; processId: number; nowMs: number }>,
): FramescaperNativeServicesLease {
	const nowMs = nonNegativeInteger(options.nowMs, 'nowMs');
	const expiresAtMs = nowMs + FRAMESCAPER_NATIVE_SERVICES_LEASE_MS;
	database.exec('BEGIN IMMEDIATE');
	try {
		const current = database.prepare(
			'SELECT active, lease_id, fencing_token, owner_instance_id, expires_at_ms FROM native_services_writer_lease WHERE singleton = 1',
		).get() as Record<string, unknown> | undefined;
		const active = Number(current?.active ?? 0) === 1;
		const heldExpiry = Number(current?.expires_at_ms ?? 0);
		const heldBySomeoneElse = active
			&& current?.owner_instance_id !== options.instanceId
			&& heldExpiry > nowMs;
		if (heldBySomeoneElse) {
			database.exec('ROLLBACK');
			throw new FramescaperNativeServicesDatabaseError(
				'Another process holds the Framescaper native services writer lease.',
			);
		}
		const fencingToken = Number(current?.fencing_token ?? 0) + 1;
		database.prepare(`
			INSERT INTO native_services_writer_lease
				(singleton, active, lease_id, fencing_token, owner_process_id, owner_instance_id, acquired_at_ms, expires_at_ms)
			VALUES (1, 1, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(singleton) DO UPDATE SET
				active = 1, lease_id = excluded.lease_id, fencing_token = excluded.fencing_token,
				owner_process_id = excluded.owner_process_id, owner_instance_id = excluded.owner_instance_id,
				acquired_at_ms = excluded.acquired_at_ms, expires_at_ms = excluded.expires_at_ms
		`).run(
			options.leaseId, fencingToken, options.processId, options.instanceId, nowMs, expiresAtMs,
		);
		database.exec('COMMIT');
		return Object.freeze({ leaseId: options.leaseId, fencingToken, expiresAtMs });
	} catch (error) {
		if (!(error instanceof FramescaperNativeServicesDatabaseError)) database.exec('ROLLBACK');
		throw error;
	}
}

/** Dispatch guard: refuse to act unless this process still owns the lease. */
export function assertFramescaperNativeServicesWriterLease(
	database: DatabaseSync,
	lease: FramescaperNativeServicesLease,
	nowMs: number,
): void {
	const current = database.prepare(
		'SELECT active, lease_id, fencing_token, expires_at_ms FROM native_services_writer_lease WHERE singleton = 1',
	).get() as Record<string, unknown> | undefined;
	if (Number(current?.active ?? 0) !== 1
		|| current?.lease_id !== lease.leaseId
		|| Number(current?.fencing_token ?? 0) !== lease.fencingToken) {
		throw new FramescaperNativeServicesDatabaseError(
			'The Framescaper native services writer lease was taken over; this process may not dispatch.',
		);
	}
	if (Number(current.expires_at_ms ?? 0) <= nonNegativeInteger(nowMs, 'nowMs')) {
		throw new FramescaperNativeServicesDatabaseError(
			'The Framescaper native services writer lease has expired; renew it before dispatching.',
		);
	}
}

/** Extend the exact live fence without advancing its takeover generation. */
export function renewFramescaperNativeServicesWriterLease(
	database: DatabaseSync,
	lease: FramescaperNativeServicesLease,
	nowMs: number,
): FramescaperNativeServicesLease {
	const renewedAtMs = nonNegativeInteger(nowMs, 'nowMs');
	const expiresAtMs = renewedAtMs + FRAMESCAPER_NATIVE_SERVICES_LEASE_MS;
	database.exec('BEGIN IMMEDIATE');
	try {
		assertFramescaperNativeServicesWriterLease(database, lease, renewedAtMs);
		const result = database.prepare(`
			UPDATE native_services_writer_lease SET expires_at_ms = ?
			WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
		`).run(expiresAtMs, lease.leaseId, lease.fencingToken);
		if (result.changes !== 1) {
			throw new FramescaperNativeServicesDatabaseError(
				'The Framescaper native services writer lease could not be renewed.',
			);
		}
		database.exec('COMMIT');
		return Object.freeze({
			leaseId: lease.leaseId,
			fencingToken: lease.fencingToken,
			expiresAtMs,
		});
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

export function releaseFramescaperNativeServicesWriterLease(
	database: DatabaseSync,
	lease: FramescaperNativeServicesLease,
): void {
	database.prepare(
		'UPDATE native_services_writer_lease SET active = 0, expires_at_ms = 0 WHERE singleton = 1 AND lease_id = ? AND fencing_token = ?',
	).run(lease.leaseId, lease.fencingToken);
}

function applyVersionOne(database: DatabaseSync): void {
	database.exec(`
	CREATE TABLE IF NOT EXISTS native_services_writer_lease (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		active INTEGER NOT NULL CHECK (active IN (0, 1)),
		lease_id TEXT,
		fencing_token INTEGER NOT NULL CHECK (fencing_token >= 0),
		owner_process_id INTEGER,
		owner_instance_id TEXT,
		acquired_at_ms INTEGER,
		expires_at_ms INTEGER
	) STRICT;
	CREATE TABLE IF NOT EXISTS durable_root_grants (
		grant_id TEXT PRIMARY KEY CHECK (length(grant_id) BETWEEN 16 AND 64),
		root_path TEXT NOT NULL,
		volume_identity TEXT NOT NULL,
		directory_identity TEXT NOT NULL,
		authorized_at_ms INTEGER NOT NULL CHECK (authorized_at_ms >= 0),
		revoked_at_ms INTEGER CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= authorized_at_ms)
	) STRICT;
	CREATE TABLE IF NOT EXISTS render_queue_jobs (
		job_id TEXT PRIMARY KEY CHECK (length(job_id) = 40),
		task_kind TEXT NOT NULL CHECK (task_kind IN (${closedDomain(VERSION_ONE_TASK_KINDS)})),
		plan_version INTEGER NOT NULL CHECK (plan_version IN (6, 7)),
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
		recovery_class TEXT NOT NULL CHECK (recovery_class IN (${closedDomain(VERSION_ONE_RECOVERY_CLASSES)})),
		state TEXT NOT NULL CHECK (state IN (${closedDomain(VERSION_ONE_STATES)})),
		position INTEGER NOT NULL CHECK (position >= 0),
		progress REAL CHECK (progress IS NULL OR (progress >= 0.0 AND progress <= 1.0)),
		attempt INTEGER NOT NULL CHECK (attempt >= 0),
		last_failure_code TEXT,
		created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
		updated_at_ms INTEGER NOT NULL,
		CHECK (updated_at_ms >= created_at_ms),
		CHECK (recovery_class <> 'verified-frame-checkpoint' OR task_kind IN (${closedDomain(VERSION_ONE_CHECKPOINTABLE_TASK_KINDS)})),
		CHECK (state <> 'failed' OR last_failure_code IS NOT NULL)
	) STRICT;
	CREATE INDEX IF NOT EXISTS render_queue_jobs_dispatch
		ON render_queue_jobs (state, position, created_at_ms);
	CREATE TABLE IF NOT EXISTS watch_rules (
		rule_id TEXT PRIMARY KEY CHECK (length(rule_id) BETWEEN 16 AND 64),
		grant_id TEXT NOT NULL REFERENCES durable_root_grants(grant_id),
		project_id TEXT NOT NULL CHECK (length(project_id) > 0),
		bin_id TEXT,
		extensions TEXT NOT NULL CHECK (length(extensions) > 0),
		recursive INTEGER NOT NULL CHECK (recursive IN (0, 1)),
		import_mode TEXT NOT NULL CHECK (import_mode IN ('link', 'copy')),
		generate_proxies INTEGER NOT NULL CHECK (generate_proxies IN (0, 1)),
		enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
		created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
	) STRICT;
	CREATE TABLE IF NOT EXISTS watch_imports (
		rule_id TEXT NOT NULL REFERENCES watch_rules(rule_id) ON DELETE CASCADE,
		file_identity TEXT NOT NULL CHECK (length(file_identity) > 0),
		content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
		imported_at_ms INTEGER NOT NULL CHECK (imported_at_ms >= 0),
		PRIMARY KEY (rule_id, file_identity, content_sha256)
	) STRICT;
	CREATE TABLE IF NOT EXISTS scratch_reservations (
		job_id TEXT PRIMARY KEY REFERENCES render_queue_jobs(job_id) ON DELETE CASCADE,
		directory_name TEXT NOT NULL CHECK (length(directory_name) > 0),
		manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
		root_identity TEXT NOT NULL CHECK (length(root_identity) > 0),
		reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= 0),
		state TEXT NOT NULL CHECK (state IN ('reserved', 'released', 'retained')),
		created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
		expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms >= created_at_ms)
	) STRICT;
	`);
	database.prepare(`
		INSERT OR IGNORE INTO native_services_writer_lease
			(singleton, active, lease_id, fencing_token, owner_process_id, owner_instance_id, acquired_at_ms, expires_at_ms)
		VALUES (1, 0, NULL, 0, NULL, NULL, NULL, NULL)
	`).run();
}

/**
 * Replace the queue table atomically so its frozen plan domain matches the
 * executable V7–V12 envelope. Every row is reparsed before any old table is
 * dropped. A malformed payload therefore rolls the transaction back to the
 * untouched V1 database instead of becoming a best-effort queue entry.
 */
function applyVersionTwo(database: DatabaseSync): void {
	const migrated = readVersionOneQueueRecords(database).map((record) => {
		try {
			return migrateNativeQueueRecordV1ToV2(record);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new FramescaperNativeServicesDatabaseError(
				`The Framescaper native queue V1 row ${record.jobId} cannot migrate: ${detail}`,
			);
		}
	});
	database.exec(`
		CREATE TABLE render_queue_jobs_v2 (
			job_id TEXT PRIMARY KEY CHECK (length(job_id) = 40),
			record_version INTEGER NOT NULL CHECK (record_version = 2),
			task_kind TEXT NOT NULL CHECK (task_kind IN (${closedDomain(VERSION_ONE_TASK_KINDS)})),
			plan_version INTEGER NOT NULL CHECK (plan_version IN (${VERSION_TWO_PLAN_VERSIONS.join(', ')})),
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
			recovery_class TEXT NOT NULL CHECK (recovery_class IN (${closedDomain(VERSION_ONE_RECOVERY_CLASSES)})),
			state TEXT NOT NULL CHECK (state IN (${closedDomain(VERSION_ONE_STATES)})),
			position INTEGER NOT NULL CHECK (position >= 0),
			progress REAL CHECK (progress IS NULL OR (progress >= 0.0 AND progress <= 1.0)),
			attempt INTEGER NOT NULL CHECK (attempt >= 0),
			last_failure_code TEXT,
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			updated_at_ms INTEGER NOT NULL,
			CHECK (updated_at_ms >= created_at_ms),
			CHECK (recovery_class <> 'verified-frame-checkpoint' OR task_kind IN (${closedDomain(VERSION_ONE_CHECKPOINTABLE_TASK_KINDS)})),
			CHECK (state <> 'failed' OR last_failure_code IS NOT NULL),
			CHECK (
				plan_version IN (${VERSION_TWO_ACTIVE_PLAN_VERSIONS.join(', ')})
				OR (
					plan_version = 6
					AND (
						state = 'completed'
						OR (state IN ('blocked', 'cancelled') AND last_failure_code = 'unsupported-plan-version')
					)
				)
			)
		) STRICT;
		CREATE TABLE scratch_reservations_v2 (
			job_id TEXT PRIMARY KEY REFERENCES render_queue_jobs_v2(job_id) ON DELETE CASCADE,
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
		INSERT INTO render_queue_jobs_v2 (
			job_id, record_version, task_kind, plan_version, plan_fingerprint, plan_payload,
			project_id, project_revision, input_fingerprints, root_grant_id,
			relative_destination, reservations, recovery_class, state, position, progress,
			attempt, last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	for (const record of migrated) insertVersionTwoQueueRecord(insert, record);
	database.exec(`
		INSERT INTO scratch_reservations_v2
			(job_id, directory_name, manifest_digest, root_identity, reserved_bytes, state, created_at_ms, expires_at_ms)
		SELECT job_id, directory_name, manifest_digest, root_identity, reserved_bytes, state, created_at_ms, expires_at_ms
		FROM scratch_reservations;
		DROP TABLE scratch_reservations;
		DROP TABLE render_queue_jobs;
		ALTER TABLE render_queue_jobs_v2 RENAME TO render_queue_jobs;
		ALTER TABLE scratch_reservations_v2 RENAME TO scratch_reservations;
		CREATE INDEX render_queue_jobs_dispatch
			ON render_queue_jobs (state, position, created_at_ms);
	`);
}

function readVersionOneQueueRecords(database: DatabaseSync): readonly NativeQueueRecordV1[] {
	const rows = database.prepare('SELECT * FROM render_queue_jobs ORDER BY job_id').all() as Record<string, unknown>[];
	return rows.map((row) => ({
		jobId: row.job_id as string,
		taskKind: row.task_kind as NativeQueueRecordV1['taskKind'],
		planVersion: row.plan_version as number,
		planFingerprint: row.plan_fingerprint as string,
		planPayload: row.plan_payload as string,
		projectId: row.project_id as string,
		projectRevision: row.project_revision as number,
		inputFingerprints: parseStoredJson(row.input_fingerprints, 'input_fingerprints') as NativeQueueRecordV1['inputFingerprints'],
		rootGrantId: row.root_grant_id as string,
		relativeDestination: row.relative_destination as string,
		reservations: parseStoredJson(row.reservations, 'reservations') as NativeQueueRecordV1['reservations'],
		recoveryClass: row.recovery_class as NativeQueueRecordV1['recoveryClass'],
		state: row.state as NativeQueueRecordV1['state'],
		position: row.position as number,
		progress: row.progress as number | null,
		attempt: row.attempt as number,
		lastFailureCode: row.last_failure_code as string | null,
		createdAtMs: row.created_at_ms as number,
		updatedAtMs: row.updated_at_ms as number,
	}));
}

function insertVersionTwoQueueRecord(
	statement: ReturnType<DatabaseSync['prepare']>,
	record: NativeQueueRecordV2,
): void {
	statement.run(
		record.jobId, record.recordVersion, record.taskKind, record.planVersion,
		record.planFingerprint, record.planPayload, record.projectId, record.projectRevision,
		JSON.stringify(record.inputFingerprints), record.rootGrantId, record.relativeDestination,
		JSON.stringify(record.reservations), record.recoveryClass, record.state, record.position,
		record.progress, record.attempt, record.lastFailureCode, record.createdAtMs, record.updatedAtMs,
	);
}

function parseStoredJson(value: unknown, label: string): unknown {
	if (typeof value !== 'string') {
		throw new FramescaperNativeServicesDatabaseError(
			`The Framescaper native queue ${label} field is not stored text.`,
		);
	}
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new FramescaperNativeServicesDatabaseError(
			`The Framescaper native queue ${label} field is not valid JSON.`,
		);
	}
}

/** Render a frozen domain as SQL literals, refusing anything a literal cannot hold. */
function closedDomain(members: readonly string[]): string {
	return members.map((member) => {
		if (!/^[a-z][a-z0-9-]*$/u.test(member)) {
			throw new FramescaperNativeServicesDatabaseError(
				`The Framescaper native services schema cannot name the domain member ${member}.`,
			);
		}
		return `'${member}'`;
	}).join(', ');
}

function pragmaNumber(database: DatabaseSync, pragma: string): number {
	const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
	const value = row ? Object.values(row)[0] : 0;
	return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new FramescaperNativeServicesDatabaseError(`${label} must be a non-negative safe integer.`);
	}
	return value as number;
}
