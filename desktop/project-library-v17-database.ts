/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

/** Add V17-only writer, publication, and immutable-V12 import state. */
export function initializeFramescaperDesktopProjectLibraryV17LifecycleDatabase(
	database: DatabaseSync,
): void {
	database.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = FULL;
		PRAGMA trusted_schema = OFF;
		PRAGMA foreign_keys = ON;
		BEGIN IMMEDIATE;
		CREATE TABLE IF NOT EXISTS library_lease (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			active INTEGER NOT NULL CHECK (active IN (0, 1)),
			lease_id TEXT,
			fencing_token INTEGER NOT NULL CHECK (fencing_token >= 0),
			owner_json TEXT,
			expires_at_ms INTEGER,
			took_over INTEGER NOT NULL CHECK (took_over IN (0, 1))
		) STRICT;
		INSERT OR IGNORE INTO library_lease (
			singleton, active, lease_id, fencing_token, owner_json, expires_at_ms, took_over
		) VALUES (1, 0, NULL, 0, NULL, NULL, 0);
		CREATE TABLE IF NOT EXISTS publication_journal (
			publication_id TEXT PRIMARY KEY,
			state TEXT NOT NULL CHECK (state IN ('prepared', 'materialized', 'committed')),
			project_id TEXT NOT NULL,
			project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
			project_sha256 TEXT NOT NULL,
			document_file TEXT NOT NULL,
			expected_metadata_revision INTEGER NOT NULL CHECK (expected_metadata_revision >= 0),
			result_json TEXT,
			lease_id TEXT NOT NULL,
			fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
			created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
			updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms)
		) STRICT;
		CREATE TABLE IF NOT EXISTS v12_import (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			state TEXT NOT NULL CHECK (state IN ('pending', 'complete')),
			source_catalog_sha256 TEXT NOT NULL,
			source_metadata_revision INTEGER NOT NULL CHECK (source_metadata_revision >= 0),
			source_project_count INTEGER NOT NULL CHECK (source_project_count >= 0),
			next_project_index INTEGER NOT NULL CHECK (next_project_index >= 0),
			completed_at_ms INTEGER
		) STRICT;
		COMMIT;
	`);
}
