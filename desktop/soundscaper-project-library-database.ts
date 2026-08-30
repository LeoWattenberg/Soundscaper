/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	DESKTOP_PROJECT_LIBRARY_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
} from './soundscaper-project-library-contract.ts';
import { emptySoundscaperDesktopLibraryMetadata } from './soundscaper-project-library-metadata.ts';

export function initializeSoundscaperDesktopProjectLibraryDatabase(
	database: DatabaseSync,
): void {
	const applicationId = pragmaNumber(database, 'application_id');
	if (applicationId !== 0 && applicationId !== DESKTOP_PROJECT_LIBRARY_APPLICATION_ID) {
		throw new Error('Soundscaper desktop baseline database belongs to another application');
	}
	const userVersion = pragmaNumber(database, 'user_version');
	if (userVersion !== 0 && userVersion !== DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION) {
		throw new Error('Unsupported Soundscaper desktop baseline database version');
	}
	database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;');
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
			owner_product TEXT CHECK (owner_product IS NULL OR owner_product = 'soundscaper'),
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
		CREATE TABLE IF NOT EXISTS project_revisions (
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			project_sha256 TEXT NOT NULL CHECK (length(project_sha256) = 64),
			entry_id TEXT NOT NULL,
			relative_file TEXT NOT NULL UNIQUE,
			byte_length INTEGER NOT NULL CHECK (byte_length > 0),
			document_json TEXT NOT NULL,
			published_at_ms INTEGER NOT NULL CHECK (published_at_ms >= 0),
			PRIMARY KEY (project_id, project_revision)
		) STRICT;
		CREATE TABLE IF NOT EXISTS managed_bodies (
			body_id TEXT PRIMARY KEY,
			kind TEXT NOT NULL CHECK (kind = 'audio-freeze'),
			encoding TEXT NOT NULL,
			binding_id TEXT,
			source_id TEXT NOT NULL,
			storage_key TEXT NOT NULL,
			relative_file TEXT NOT NULL UNIQUE,
			mime_type TEXT NOT NULL,
			byte_length INTEGER NOT NULL CHECK (byte_length > 0),
			sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
			descriptor_json TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state = 'published'),
			published_at_ms INTEGER NOT NULL CHECK (published_at_ms >= 0),
			CHECK (
				kind = 'audio-freeze' AND encoding = 'audio-f32le-chunks-v1'
					AND binding_id IS NOT NULL AND body_id = binding_id
			)
		) STRICT;
		CREATE TABLE IF NOT EXISTS project_revision_bodies (
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
			body_id TEXT NOT NULL,
			PRIMARY KEY (project_id, project_revision, ordinal),
			UNIQUE (project_id, project_revision, body_id),
			FOREIGN KEY (project_id, project_revision)
				REFERENCES project_revisions(project_id, project_revision),
			FOREIGN KEY (body_id) REFERENCES managed_bodies(body_id)
		) STRICT;
		CREATE TABLE IF NOT EXISTS native_plugin_state_bodies (
			body_id TEXT PRIMARY KEY CHECK (body_id GLOB 'native-plugin-state:*'),
			sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
			byte_length INTEGER NOT NULL CHECK (byte_length >= 0 AND byte_length <= 16777216),
			bytes BLOB NOT NULL,
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			CHECK (length(bytes) = byte_length),
			CHECK (body_id = 'native-plugin-state:' || sha256)
		) STRICT;
		CREATE TABLE IF NOT EXISTS publication_journal (
			transaction_id TEXT PRIMARY KEY,
			state TEXT NOT NULL CHECK (state IN ('prepared', 'materialized', 'committed', 'complete')),
			expected_metadata_revision INTEGER NOT NULL CHECK (expected_metadata_revision >= 0),
			previous_metadata_json TEXT NOT NULL,
			previous_metadata_digest TEXT NOT NULL CHECK (length(previous_metadata_digest) = 64),
			next_metadata_json TEXT NOT NULL,
			next_metadata_digest TEXT NOT NULL CHECK (length(next_metadata_digest) = 64),
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			project_sha256 TEXT NOT NULL CHECK (length(project_sha256) = 64),
			entry_id TEXT NOT NULL,
			project_relative_file TEXT NOT NULL,
			project_byte_length INTEGER NOT NULL CHECK (project_byte_length > 0),
			project_json TEXT NOT NULL,
			bodies_json TEXT NOT NULL,
			stages_json TEXT NOT NULL,
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			completed_at_ms INTEGER
		) STRICT;
		CREATE TABLE IF NOT EXISTS storage_reclamation (
			relative_file TEXT PRIMARY KEY,
			role TEXT NOT NULL CHECK (role IN ('project', 'media')),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
		) STRICT;
		`);
		const empty = emptySoundscaperDesktopLibraryMetadata();
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
		PRAGMA application_id = ${String(DESKTOP_PROJECT_LIBRARY_APPLICATION_ID)};
		PRAGMA user_version = ${String(DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION)};
		COMMIT;
		`);
	} catch (error) {
		if (database.isTransaction) database.exec('ROLLBACK');
		throw error;
	}
}

export function assertSoundscaperDesktopProjectLibraryDatabaseIdentity(
	database: DatabaseSync,
): void {
	if (pragmaNumber(database, 'application_id') !== DESKTOP_PROJECT_LIBRARY_APPLICATION_ID
		|| pragmaNumber(database, 'user_version') !== DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION) {
		throw new Error('Soundscaper desktop baseline database identity is invalid');
	}
}

function pragmaNumber(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	const row = database.prepare(`PRAGMA ${name}`).get();
	const value = row?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline PRAGMA ${name} is invalid`);
	}
	return value;
}
