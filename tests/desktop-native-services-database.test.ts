/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	assertFramescaperNativeServicesWriterLease,
	FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID,
	FRAMESCAPER_NATIVE_SERVICES_DATABASE_FILE_NAME,
	FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION,
	FRAMESCAPER_NATIVE_SERVICES_LEASE_MS,
	FramescaperNativeServicesDatabaseError,
	initializeFramescaperNativeServicesDatabase,
	releaseFramescaperNativeServicesWriterLease,
} from '../desktop/native-services-database.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository.ts';
import {
	assertNativeQueueRecordV2,
	createNativeQueueRecordV1,
	createNativeQueueRecordV2,
	NATIVE_QUEUE_ACTIVE_PLAN_VERSIONS,
	NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS,
	NATIVE_QUEUE_LEGACY_PLAN_VERSIONS,
	NATIVE_QUEUE_RECOVERY_CLASSES,
	NATIVE_QUEUE_STATES,
	NATIVE_QUEUE_TASK_KINDS,
	type NativeQueueRecordV1,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	nativeQueueKeyedPlanV7,
} from './helpers/native-queue-plan-fixture.ts';

const GRANT = 'f'.repeat(32);
const JOB = '1a'.repeat(20);
const PLAN = 'a'.repeat(64);

test('the services database is its own file, separate from the project library', () => {
	assert.equal(FRAMESCAPER_NATIVE_SERVICES_DATABASE_FILE_NAME, 'framescaper-native-services.sqlite');
	assert.notEqual(FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID, 0x53434150);

	const database = open();
	assert.equal(pragma(database, 'application_id'), FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID);
	assert.equal(pragma(database, 'user_version'), FRAMESCAPER_NATIVE_SERVICES_DATABASE_VERSION);
	assert.equal(pragma(database, 'synchronous'), 2);
	database.close();
});

test('initializing twice is idempotent', () => {
	const database = new DatabaseSync(':memory:');
	assert.equal(initializeFramescaperNativeServicesDatabase(database), 2);
	assert.equal(initializeFramescaperNativeServicesDatabase(database), 2);
	database.close();
});

test('a database from another application is refused rather than extended', () => {
	const database = new DatabaseSync(':memory:');
	database.exec('PRAGMA application_id = 1397048144');

	assert.throws(
		() => initializeFramescaperNativeServicesDatabase(database),
		/belongs to another application/u,
	);
	database.close();
});

test('a database written by a newer build is refused outright', () => {
	const database = new DatabaseSync(':memory:');
	database.exec(`PRAGMA application_id = ${String(FRAMESCAPER_NATIVE_SERVICES_APPLICATION_ID)}`);
	database.exec('PRAGMA user_version = 99');

	assert.throws(
		() => initializeFramescaperNativeServicesDatabase(database),
		FramescaperNativeServicesDatabaseError,
	);
	assert.throws(
		() => initializeFramescaperNativeServicesDatabase(database),
		/written by a newer build/u,
	);
	database.close();
});

test('the queue table refuses a row that violates the queue contract', () => {
	const database = open();
	grant(database);

	assert.doesNotThrow(() => insertJob(database, {}));
	for (const [overrides, pattern] of [
		[{ jobId: 'short' }, /CHECK/u],
		[{ planVersion: 13 }, /CHECK/u],
		[{ planVersion: 20 }, /CHECK/u],
		[{ state: 'wonderful' }, /CHECK/u],
		[{ progress: 1.5 }, /CHECK/u],
		[{ attempt: -1 }, /CHECK/u],
		[{ relativeDestination: '/etc/passwd' }, /CHECK/u],
		[{ relativeDestination: '..' }, /CHECK/u],
		[{ relativeDestination: '../escape.mp4' }, /CHECK/u],
		[{ relativeDestination: 'exports/../escape.mp4' }, /CHECK/u],
		[{ relativeDestination: 'exports/..' }, /CHECK/u],
		[{ relativeDestination: './reel.mp4' }, /CHECK/u],
		[{ relativeDestination: 'exports//reel.mp4' }, /CHECK/u],
		[{ relativeDestination: 'C:/reel.mp4' }, /CHECK/u],
		[{ relativeDestination: 'exports\\reel.mp4' }, /CHECK/u],
		[{ updatedAtMs: 0, createdAtMs: 10 }, /CHECK/u],
		[{ state: 'failed', lastFailureCode: null }, /CHECK/u],
		// Only an image sequence may checkpoint.
		[{ taskKind: 'encoded-export', recoveryClass: 'verified-frame-checkpoint' }, /CHECK/u],
		[{ rootGrantId: 'e'.repeat(32) }, /FOREIGN KEY/u],
	] as const) {
		assert.throws(
			() => insertJob(database, { jobId: uniqueJobId(), ...overrides }),
			pattern,
			JSON.stringify(overrides),
		);
	}
	assert.doesNotThrow(() => insertJob(database, {
		jobId: uniqueJobId(),
		taskKind: 'image-sequence-export',
		recoveryClass: 'verified-frame-checkpoint',
	}));
	assert.doesNotThrow(() => insertJob(database, { jobId: uniqueJobId(), planVersion: 8 }));
	assert.doesNotThrow(() => insertJob(database, { jobId: uniqueJobId(), planVersion: 9 }));
	assert.doesNotThrow(() => insertJob(database, {
		jobId: uniqueJobId(), planVersion: 6, state: 'blocked',
		lastFailureCode: 'unsupported-plan-version',
	}));
	assert.throws(
		() => insertJob(database, { jobId: uniqueJobId(), planVersion: 6 }),
		/CHECK/u,
		'a legacy plan may be stored only in its permanent typed block',
	);
	database.close();
});

test('a destination the record contract admits survives the database round trip', () => {
	const database = open();
	grant(database);
	const record = queueRecord({ relativeDestination: 'exports/final..v2.mp4' });

	assert.doesNotThrow(() => insertRecord(database, record));
	const stored = database.prepare(
		'SELECT relative_destination FROM render_queue_jobs WHERE job_id = ?',
	).get(record.jobId) as Record<string, unknown>;
	assert.equal(stored.relative_destination, record.relativeDestination);
	assert.doesNotThrow(() => assertNativeQueueRecordV2({
		...record, relativeDestination: stored.relative_destination as string,
	}));
	database.close();
});

test('the queue schema names exactly the closed domains the record registry owns', () => {
	const database = open();
	const schema = String((database.prepare(
		"SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'render_queue_jobs'",
	).get() as Record<string, unknown>).sql);

	assert.deepEqual(checkList(schema, 'task_kind IN'), [...NATIVE_QUEUE_TASK_KINDS]);
	assert.deepEqual(checkList(schema, 'state IN'), [...NATIVE_QUEUE_STATES]);
	assert.deepEqual(checkList(schema, 'recovery_class IN'), [...NATIVE_QUEUE_RECOVERY_CLASSES]);
	assert.deepEqual(
		checkList(schema, 'plan_version IN'),
		[...NATIVE_QUEUE_LEGACY_PLAN_VERSIONS, ...NATIVE_QUEUE_ACTIVE_PLAN_VERSIONS].map(String),
	);
	assert.deepEqual(
		checkList(schema, "recovery_class <> 'verified-frame-checkpoint' OR task_kind IN"),
		[...NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS],
	);
	database.close();
});

test('V1 migrates atomically to V2, preserving scratch and blocking legacy V6 work', () => {
	const database = versionOneDatabase();
	grant(database);
	const plan = { version: 6 };
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const legacy = createNativeQueueRecordV1({
		...historicalRecordInput(6, fingerprint.canonical, fingerprint.sha256),
	});
	insertVersionOneRecord(database, legacy);
	database.prepare(`
		INSERT INTO scratch_reservations
			(job_id, directory_name, manifest_digest, root_identity, reserved_bytes, state, created_at_ms, expires_at_ms)
		VALUES (?, 'job-scratch', ?, 'scratch-root', 4096, 'reserved', 0, NULL)
	`).run(legacy.jobId, 'c'.repeat(64));

	assert.equal(initializeFramescaperNativeServicesDatabase(database), 2);
	assert.equal(pragma(database, 'user_version'), 2);
	const migrated = readVersionTwoRecord(database, legacy.jobId);
	assert.doesNotThrow(() => assertNativeQueueRecordV2(migrated));
	assert.equal(migrated.recordVersion, 2);
	assert.equal(migrated.planVersion, 6);
	assert.equal(migrated.state, 'blocked');
	assert.equal(migrated.lastFailureCode, 'unsupported-plan-version');
	assert.equal(Number((database.prepare(
		'SELECT COUNT(*) AS count FROM scratch_reservations WHERE job_id = ?',
	).get(legacy.jobId) as Record<string, unknown>).count), 1);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'migration-lease', instanceId: 'migration-instance', processId: 1, nowMs: 1,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	let revalidations = 0;
	assert.deepEqual(queue.recover(lease, 1, () => {
		revalidations += 1;
		throw new Error('a legacy V6 row has no executable exact-plan adapter');
	}), []);
	assert.equal(revalidations, 0);
	assert.equal(queue.read(legacy.jobId)?.state, 'blocked');
	assert.equal(queue.control(legacy.jobId, { kind: 'cancel' }, lease, 2).record.state, 'cancelled');
	assert.equal(queue.remove(legacy.jobId, lease, 3), true);
	assert.equal(Number((database.prepare(
		'SELECT COUNT(*) AS count FROM scratch_reservations WHERE job_id = ?',
	).get(legacy.jobId) as Record<string, unknown>).count), 0);
	database.close();
});

test('V1 migration reparses supported plans and keeps an exact V7 row dispatchable', () => {
	const database = versionOneDatabase();
	grant(database);
	const plan = nativeQueueKeyedPlanV7();
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const record = createNativeQueueRecordV1({
		...historicalRecordInput(7, fingerprint.canonical, fingerprint.sha256),
	});
	insertVersionOneRecord(database, record);

	initializeFramescaperNativeServicesDatabase(database);
	const migrated = readVersionTwoRecord(database, record.jobId);
	assert.doesNotThrow(() => assertNativeQueueRecordV2(migrated));
	assert.equal(migrated.state, 'queued');
	assert.equal(migrated.planVersion, 7);
	database.close();
});

test('corrupt V1 plan identity aborts migration without altering the V1 database', () => {
	const database = versionOneDatabase();
	grant(database);
	const plan = nativeQueueKeyedPlanV7();
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const corrupt = createNativeQueueRecordV1({
		...historicalRecordInput(7, fingerprint.canonical, '0'.repeat(64)),
	});
	insertVersionOneRecord(database, corrupt);

	assert.throws(
		() => initializeFramescaperNativeServicesDatabase(database),
		/plan payload does not match its canonical fingerprint/u,
	);
	assert.equal(pragma(database, 'user_version'), 1);
	assert.equal(tableColumns(database, 'render_queue_jobs').includes('record_version'), false);
	assert.equal((database.prepare(
		'SELECT plan_fingerprint FROM render_queue_jobs WHERE job_id = ?',
	).get(corrupt.jobId) as Record<string, unknown>).plan_fingerprint, '0'.repeat(64));
	database.close();
});

test('a watched file is imported at most once per rule, identity, and content', () => {
	const database = open();
	grant(database);
	database.prepare(`
		INSERT INTO watch_rules (rule_id, grant_id, project_id, bin_id, extensions, recursive, import_mode, generate_proxies, enabled, created_at_ms)
		VALUES (?, ?, 'project-1', NULL, 'mp4,mov', 0, 'link', 0, 1, 0)
	`).run('d'.repeat(32), GRANT);
	const insert = database.prepare(
		'INSERT INTO watch_imports (rule_id, file_identity, content_sha256, imported_at_ms) VALUES (?, ?, ?, ?)',
	);

	insert.run('d'.repeat(32), 'dev:1|ino:2', 'c'.repeat(64), 10);
	assert.throws(
		() => insert.run('d'.repeat(32), 'dev:1|ino:2', 'c'.repeat(64), 20),
		/UNIQUE|PRIMARY KEY/u,
	);
	// Replaced content under the same identity is a different file, so it imports.
	assert.doesNotThrow(() => insert.run('d'.repeat(32), 'dev:1|ino:2', 'e'.repeat(64), 30));
	database.close();
});

test('one process holds the writer lease and a second cannot dispatch', () => {
	const database = open();
	const first = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 100, nowMs: 1_000,
	});

	assert.equal(first.fencingToken, 1);
	assert.doesNotThrow(() => assertFramescaperNativeServicesWriterLease(database, first, 1_500));
	assert.throws(() => acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-b', instanceId: 'instance-b', processId: 200, nowMs: 1_500,
	}), /Another process holds/u);
	database.close();
});

test('an expired lease may be taken over and the old holder is then refused', () => {
	const database = open();
	const first = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 100, nowMs: 0,
	});
	const afterExpiry = FRAMESCAPER_NATIVE_SERVICES_LEASE_MS + 1;
	const second = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-b', instanceId: 'instance-b', processId: 200, nowMs: afterExpiry,
	});

	assert.equal(second.fencingToken, 2, 'every takeover advances the fencing token');
	assert.doesNotThrow(() => assertFramescaperNativeServicesWriterLease(database, second, afterExpiry + 1));
	assert.throws(
		() => assertFramescaperNativeServicesWriterLease(database, first, afterExpiry + 1),
		/taken over/u,
	);
	database.close();
});

test('a lease that has aged out cannot dispatch even for its own holder', () => {
	const database = open();
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 100, nowMs: 0,
	});

	assert.throws(
		() => assertFramescaperNativeServicesWriterLease(database, lease, FRAMESCAPER_NATIVE_SERVICES_LEASE_MS),
		/expired/u,
	);
	database.close();
});

test('the same instance may renew its own lease', () => {
	const database = open();
	const first = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 100, nowMs: 0,
	});
	const renewed = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 100, nowMs: 5_000,
	});

	assert.equal(renewed.fencingToken, first.fencingToken + 1);
	assert.doesNotThrow(() => assertFramescaperNativeServicesWriterLease(database, renewed, 6_000));
	releaseFramescaperNativeServicesWriterLease(database, renewed);
	assert.throws(
		() => assertFramescaperNativeServicesWriterLease(database, renewed, 6_000),
		/taken over/u,
	);
	database.close();
});

let jobCounter = 0;

function uniqueJobId(): string {
	jobCounter += 1;
	return jobCounter.toString(16).padStart(40, '0');
}

function open(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	return database;
}

function grant(database: DatabaseSync): void {
	database.prepare(`
		INSERT INTO durable_root_grants (grant_id, root_path, volume_identity, directory_identity, authorized_at_ms, revoked_at_ms)
		VALUES (?, '/exports', 'volume-1', 'dev:1|ino:9', 0, NULL)
	`).run(GRANT);
}

function checkList(schema: string, clause: string): readonly string[] {
	const match = new RegExp(`${clause.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\(([^)]*)\\)`, 'u').exec(schema);
	assert.ok(match, `the queue schema must express ${clause} as a list drawn from the record registry`);
	return match[1]!.split(',').map((member) => member.trim().replaceAll("'", ''));
}

function queueRecord(overrides: Readonly<{ relativeDestination: string }>): NativeQueueRecordV2 {
	return createNativeQueueRecordV2({
		jobId: uniqueJobId(),
		taskKind: 'encoded-export',
		plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1',
		projectRevision: 42,
		inputFingerprints: [{ sourceId: 'source-a', sha256: 'b'.repeat(64) }],
		rootGrantId: GRANT,
		relativeDestination: overrides.relativeDestination,
		reservations: {
			cpuCores: 4,
			processTreeRssBytes: 1024 ** 3,
			scratchBytes: 8 * 1024 ** 3,
			minimumFreeBytes: 10 * 1024 ** 3,
			hardwareBackend: null,
		},
		position: 0,
		createdAtMs: 0,
	});
}

function insertRecord(database: DatabaseSync, record: NativeQueueRecordV2): void {
	insertJob(database, {
		...record,
		inputFingerprints: JSON.stringify(record.inputFingerprints),
		reservations: JSON.stringify(record.reservations),
	});
}

function insertJob(database: DatabaseSync, overrides: Record<string, unknown>): void {
	const row = {
		jobId: JOB,
		recordVersion: 2,
		taskKind: 'encoded-export',
		planVersion: 7,
		planFingerprint: PLAN,
		planPayload: '{"version":7}',
		projectId: 'project-1',
		projectRevision: 42,
		inputFingerprints: '[]',
		rootGrantId: GRANT,
		relativeDestination: 'exports/reel.mp4',
		reservations: '{}',
		recoveryClass: 'atomic-restart',
		state: 'queued',
		position: 0,
		progress: null,
		attempt: 0,
		lastFailureCode: null,
		createdAtMs: 0,
		updatedAtMs: 0,
		...overrides,
	};
	database.prepare(`
		INSERT INTO render_queue_jobs (
			job_id, record_version, task_kind, plan_version, plan_fingerprint, plan_payload, project_id,
			project_revision, input_fingerprints, root_grant_id, relative_destination,
			reservations, recovery_class, state, position, progress, attempt,
			last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		row.jobId as string, row.recordVersion as number, row.taskKind as string, row.planVersion as number,
		row.planFingerprint as string, row.planPayload as string, row.projectId as string,
		row.projectRevision as number, row.inputFingerprints as string, row.rootGrantId as string,
		row.relativeDestination as string, row.reservations as string, row.recoveryClass as string,
		row.state as string, row.position as number, row.progress as number | null,
		row.attempt as number, row.lastFailureCode as string | null,
		row.createdAtMs as number, row.updatedAtMs as number,
	);
}

function historicalRecordInput(planVersion: number, planPayload: string, planFingerprint: string) {
	return {
		jobId: uniqueJobId(),
		taskKind: 'encoded-export' as const,
		planVersion,
		planFingerprint,
		planPayload,
		projectId: 'project-1',
		projectRevision: 42,
		inputFingerprints: [{ sourceId: 'source-a', sha256: 'b'.repeat(64) }],
		rootGrantId: GRANT,
		relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 4,
			processTreeRssBytes: 1024 ** 3,
			scratchBytes: 8 * 1024 ** 3,
			minimumFreeBytes: 10 * 1024 ** 3,
			hardwareBackend: null,
		},
		position: 0,
		createdAtMs: 0,
	};
}

function versionOneDatabase(): DatabaseSync {
	const database = open();
	database.exec(`
		PRAGMA foreign_keys = OFF;
		DROP TABLE scratch_reservations;
		DROP TABLE render_queue_jobs;
		CREATE TABLE render_queue_jobs (
			job_id TEXT PRIMARY KEY,
			task_kind TEXT NOT NULL,
			plan_version INTEGER NOT NULL CHECK (plan_version IN (6, 7)),
			plan_fingerprint TEXT NOT NULL,
			plan_payload TEXT NOT NULL,
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL,
			input_fingerprints TEXT NOT NULL,
			root_grant_id TEXT NOT NULL REFERENCES durable_root_grants(grant_id),
			relative_destination TEXT NOT NULL,
			reservations TEXT NOT NULL,
			recovery_class TEXT NOT NULL,
			state TEXT NOT NULL,
			position INTEGER NOT NULL,
			progress REAL,
			attempt INTEGER NOT NULL,
			last_failure_code TEXT,
			created_at_ms INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		) STRICT;
		CREATE INDEX render_queue_jobs_dispatch
			ON render_queue_jobs (state, position, created_at_ms);
		CREATE TABLE scratch_reservations (
			job_id TEXT PRIMARY KEY REFERENCES render_queue_jobs(job_id) ON DELETE CASCADE,
			directory_name TEXT NOT NULL,
			manifest_digest TEXT NOT NULL,
			root_identity TEXT NOT NULL,
			reserved_bytes INTEGER NOT NULL,
			state TEXT NOT NULL,
			created_at_ms INTEGER NOT NULL,
			expires_at_ms INTEGER
		) STRICT;
		PRAGMA user_version = 1;
		PRAGMA foreign_keys = ON;
	`);
	return database;
}

function insertVersionOneRecord(database: DatabaseSync, record: NativeQueueRecordV1): void {
	database.prepare(`
		INSERT INTO render_queue_jobs (
			job_id, task_kind, plan_version, plan_fingerprint, plan_payload, project_id,
			project_revision, input_fingerprints, root_grant_id, relative_destination,
			reservations, recovery_class, state, position, progress, attempt,
			last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		record.jobId, record.taskKind, record.planVersion, record.planFingerprint, record.planPayload,
		record.projectId, record.projectRevision, JSON.stringify(record.inputFingerprints),
		record.rootGrantId, record.relativeDestination, JSON.stringify(record.reservations),
		record.recoveryClass, record.state, record.position, record.progress, record.attempt,
		record.lastFailureCode, record.createdAtMs, record.updatedAtMs,
	);
}

function readVersionTwoRecord(database: DatabaseSync, jobId: string): NativeQueueRecordV2 {
	const row = database.prepare('SELECT * FROM render_queue_jobs WHERE job_id = ?').get(jobId) as Record<string, unknown>;
	return {
		jobId: row.job_id as string,
		recordVersion: row.record_version as 2,
		taskKind: row.task_kind as NativeQueueRecordV2['taskKind'],
		planVersion: row.plan_version as NativeQueueRecordV2['planVersion'],
		planFingerprint: row.plan_fingerprint as string,
		planPayload: row.plan_payload as string,
		projectId: row.project_id as string,
		projectRevision: row.project_revision as number,
		inputFingerprints: JSON.parse(row.input_fingerprints as string) as NativeQueueRecordV2['inputFingerprints'],
		rootGrantId: row.root_grant_id as string,
		relativeDestination: row.relative_destination as string,
		reservations: JSON.parse(row.reservations as string) as NativeQueueRecordV2['reservations'],
		recoveryClass: row.recovery_class as NativeQueueRecordV2['recoveryClass'],
		state: row.state as NativeQueueRecordV2['state'],
		position: row.position as number,
		progress: row.progress as number | null,
		attempt: row.attempt as number,
		lastFailureCode: row.last_failure_code as string | null,
		createdAtMs: row.created_at_ms as number,
		updatedAtMs: row.updated_at_ms as number,
	};
}

function tableColumns(database: DatabaseSync, table: string): readonly string[] {
	return (database.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[])
		.map((row) => row.name as string);
}

function pragma(database: DatabaseSync, name: string): number {
	const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
	return Number(Object.values(row)[0]);
}
