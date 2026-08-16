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
	assert.equal(initializeFramescaperNativeServicesDatabase(database), 1);
	assert.equal(initializeFramescaperNativeServicesDatabase(database), 1);
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
		[{ planVersion: 20 }, /CHECK/u],
		[{ state: 'wonderful' }, /CHECK/u],
		[{ progress: 1.5 }, /CHECK/u],
		[{ attempt: -1 }, /CHECK/u],
		[{ relativeDestination: '/etc/passwd' }, /CHECK/u],
		[{ relativeDestination: '../escape.mp4' }, /CHECK/u],
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

function insertJob(database: DatabaseSync, overrides: Record<string, unknown>): void {
	const row = {
		jobId: JOB,
		taskKind: 'encoded-export',
		planVersion: 6,
		planFingerprint: PLAN,
		planPayload: '{"version":6}',
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
			job_id, task_kind, plan_version, plan_fingerprint, plan_payload, project_id,
			project_revision, input_fingerprints, root_grant_id, relative_destination,
			reservations, recovery_class, state, position, progress, attempt,
			last_failure_code, created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		row.jobId as string, row.taskKind as string, row.planVersion as number,
		row.planFingerprint as string, row.planPayload as string, row.projectId as string,
		row.projectRevision as number, row.inputFingerprints as string, row.rootGrantId as string,
		row.relativeDestination as string, row.reservations as string, row.recoveryClass as string,
		row.state as string, row.position as number, row.progress as number | null,
		row.attempt as number, row.lastFailureCode as string | null,
		row.createdAtMs as number, row.updatedAtMs as number,
	);
}

function pragma(database: DatabaseSync, name: string): number {
	const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
	return Number(Object.values(row)[0]);
}
