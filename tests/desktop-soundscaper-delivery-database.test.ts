/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	SOUNDSCAPER_DELIVERY_APPLICATION_ID,
	SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME,
	SOUNDSCAPER_DELIVERY_DATABASE_VERSION,
	SOUNDSCAPER_DELIVERY_LEASE_MS,
	SoundscaperDeliveryDatabaseError,
	acquireSoundscaperDeliveryWriterLease,
	assertSoundscaperDeliveryWriterLease,
	initializeSoundscaperDeliveryDatabase,
	releaseSoundscaperDeliveryWriterLease,
	renewSoundscaperDeliveryWriterLease,
} from '../desktop/soundscaper-delivery-database.ts';

test('Soundscaper delivery owns a separate durable v1 database', () => {
	assert.equal(SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME, 'soundscaper-delivery-services-v1.sqlite');
	assert.notEqual(SOUNDSCAPER_DELIVERY_APPLICATION_ID, 0x53434150);
	const database = open();
	assert.equal(pragma(database, 'application_id'), SOUNDSCAPER_DELIVERY_APPLICATION_ID);
	assert.equal(pragma(database, 'user_version'), SOUNDSCAPER_DELIVERY_DATABASE_VERSION);
	assert.equal(pragma(database, 'synchronous'), 2);
	const tables = database.prepare(
		"SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
	).all().map((row) => String((row as Record<string, unknown>).name));
	assert.deepEqual(tables, [
		'delivery_attempt_reports', 'delivery_events', 'delivery_publication_journal', 'delivery_queue',
		'delivery_queue_state', 'delivery_roots', 'delivery_writer_lease',
	]);
	database.close();
});

test('the delivery writer lease renews, fences stale owners, and permits expiry takeover', () => {
	const database = open();
	const first = acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'lease-first', instanceId: 'instance-first', processId: 101, nowMs: 1_000,
	});
	assert.equal(first.fencingToken, 1);
	const renewed = renewSoundscaperDeliveryWriterLease(database, first, 2_000);
	assert.equal(renewed.expiresAtMs, 2_000 + SOUNDSCAPER_DELIVERY_LEASE_MS);
	assert.throws(() => acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'lease-second', instanceId: 'instance-second', processId: 202, nowMs: 2_001,
	}), /Another process holds/u);
	const takeoverAt = renewed.expiresAtMs + 1;
	const second = acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'lease-second', instanceId: 'instance-second', processId: 202, nowMs: takeoverAt,
	});
	assert.equal(second.fencingToken, 2);
	assert.throws(
		() => assertSoundscaperDeliveryWriterLease(database, renewed, takeoverAt + 1),
		/fenced/u,
	);
	assert.doesNotThrow(() => assertSoundscaperDeliveryWriterLease(database, second, takeoverAt + 1));
	assert.equal(releaseSoundscaperDeliveryWriterLease(database, renewed), false);
	assert.equal(releaseSoundscaperDeliveryWriterLease(database, second), true);
	database.close();
});

test('delivery database initialization is idempotent and refuses other or newer files', () => {
	const database = open();
	assert.equal(initializeSoundscaperDeliveryDatabase(database), 4);
	database.close();

	const unrelated = new DatabaseSync(':memory:');
	unrelated.exec('PRAGMA application_id = 1397048144');
	assert.throws(() => initializeSoundscaperDeliveryDatabase(unrelated), /another application/u);
	unrelated.close();

	const newer = new DatabaseSync(':memory:');
	newer.exec(`PRAGMA application_id = ${String(SOUNDSCAPER_DELIVERY_APPLICATION_ID)}`);
	newer.exec('PRAGMA user_version = 99');
	assert.throws(
		() => initializeSoundscaperDeliveryDatabase(newer),
		SoundscaperDeliveryDatabaseError,
	);
	newer.close();
});

test('numbered migrations add recovery, current reports, and append-only attempt history without replacing v1', () => {
	const database = open();
	database.exec('ALTER TABLE delivery_queue DROP COLUMN staging_recovery_token');
	database.exec('ALTER TABLE delivery_queue DROP COLUMN report_json');
	database.exec('DROP TABLE delivery_attempt_reports');
	database.exec('PRAGMA user_version = 1');
	assert.equal(initializeSoundscaperDeliveryDatabase(database), 4);
	const columns = database.prepare('PRAGMA table_info(delivery_queue)').all()
		.map((row) => String((row as Record<string, unknown>).name));
	assert.equal(columns.filter((name) => name === 'staging_recovery_token').length, 1);
	assert.equal(columns.filter((name) => name === 'report_json').length, 1);
	const history = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'delivery_attempt_reports'")
		.get() as Readonly<{ sql: string }>;
	assert.match(history.sql, /STRICT/iu);
	assert.match(history.sql, /PRIMARY KEY\s*\(job_id, attempt\)/iu);
	assert.equal(initializeSoundscaperDeliveryDatabase(database), 4);
	database.close();
});

function open(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	initializeSoundscaperDeliveryDatabase(database);
	return database;
}

function pragma(database: DatabaseSync, name: string): number {
	return Number((database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[name]);
}
