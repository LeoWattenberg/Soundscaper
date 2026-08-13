/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION,
} from './project-library-v10-contract.ts';
import { emptyFramescaperDesktopLibraryV10Metadata } from './project-library-v10-metadata.ts';

export function initializeFramescaperDesktopProjectLibraryV10Database(
	database: DatabaseSync,
): void {
	const applicationId = pragmaNumber(database, 'application_id');
	if (applicationId !== 0 && applicationId !== DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID) {
		throw new Error('Framescaper desktop V10 database belongs to another application');
	}
	const userVersion = pragmaNumber(database, 'user_version');
	if (userVersion !== 0 && userVersion !== DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION) {
		throw new Error('Unsupported Framescaper desktop V10 database version');
	}
	database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;');
	database.exec('BEGIN IMMEDIATE');
	try {
		database.exec(`
		CREATE TABLE IF NOT EXISTS library_metadata (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			revision INTEGER NOT NULL CHECK (revision >= 0),
			json TEXT NOT NULL,
			digest TEXT NOT NULL,
			published_at_ms INTEGER NOT NULL CHECK (published_at_ms >= 0)
		) STRICT;
		CREATE TABLE IF NOT EXISTS library_lease (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			active INTEGER NOT NULL CHECK (active IN (0, 1)),
			lease_id TEXT,
			fencing_token INTEGER NOT NULL CHECK (fencing_token >= 0),
			owner_product TEXT CHECK (owner_product IS NULL OR owner_product = 'framescaper'),
			owner_process_id INTEGER,
			owner_instance_id TEXT,
			acquired_at_ms INTEGER,
			expires_at_ms INTEGER,
			took_over INTEGER NOT NULL CHECK (took_over IN (0, 1))
		) STRICT;
		CREATE TABLE IF NOT EXISTS metadata_journal (
			transaction_id TEXT PRIMARY KEY,
			state TEXT NOT NULL CHECK (state IN ('prepared', 'committed', 'complete', 'recovered')),
			previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
			previous_json TEXT NOT NULL,
			previous_digest TEXT NOT NULL,
			next_revision INTEGER NOT NULL CHECK (next_revision > 0),
			next_json TEXT NOT NULL,
			next_digest TEXT NOT NULL,
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			completed_at_ms INTEGER
		) STRICT;
		`);
		const empty = emptyFramescaperDesktopLibraryV10Metadata();
		const json = JSON.stringify(empty);
		const digest = createHash('sha256').update(json, 'utf8').digest('hex');
		database.prepare(`
		INSERT OR IGNORE INTO library_metadata
		(singleton, revision, json, digest, published_at_ms) VALUES (1, ?, ?, ?, 0)
		`).run(empty.revision, json, digest);
		database.prepare(`
		INSERT OR IGNORE INTO library_lease
		(singleton, active, fencing_token, took_over) VALUES (1, 0, 0, 0)
		`).run();
		database.exec(`
		PRAGMA application_id = ${String(DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID)};
		PRAGMA user_version = ${String(DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION)};
		COMMIT;
		`);
	} catch (error) {
		if (database.isTransaction) database.exec('ROLLBACK');
		throw error;
	}
}

export function assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(
	database: DatabaseSync,
): void {
	if (pragmaNumber(database, 'application_id') !== DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID
		|| pragmaNumber(database, 'user_version') !== DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION) {
		throw new Error('Framescaper desktop V10 database identity is invalid');
	}
}

function pragmaNumber(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	const row = database.prepare(`PRAGMA ${name}`).get();
	const value = row?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper desktop V10 PRAGMA ${name} is invalid`);
	}
	return value;
}
