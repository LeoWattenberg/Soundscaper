/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	framescaperDesktopProjectLibraryNonNegative as nonNegative,
} from './framescaper-project-library-values.ts';

export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_APPLICATION_ID = 0x46534350;

export interface FramescaperDesktopProjectLibraryDatabaseIdentity {
	readonly label: string;
	readonly schemaFamily?: 'framescaper';
	readonly librarySchemaVersion: number;
	readonly schemaVersion: number;
	readonly databaseUserVersion: number;
}
/** Initialize one isolated exact-generation database without admitting adjacent generations. */
export function initializeFramescaperDesktopProjectLibraryExactGenerationDatabase(
	database: DatabaseSync,
	identity: FramescaperDesktopProjectLibraryDatabaseIdentity,
): void {
	const applicationId = pragma(database, 'application_id');
	const userVersion = pragma(database, 'user_version');
	if (applicationId !== 0 && applicationId !== FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_APPLICATION_ID) {
		throw new Error(`${identity.label} database belongs to another application`);
	}
	if (userVersion !== 0 && userVersion !== identity.databaseUserVersion) {
		throw new Error(`Unsupported ${identity.label} database version`);
	}
	const library = exactPositive(identity.librarySchemaVersion, 'library schema version');
	const project = exactPositive(identity.schemaVersion, 'project schema version');
	const version = exactPositive(identity.databaseUserVersion, 'database user version');
	const family = identity.schemaFamily ?? 'framescaper';
	if (family !== 'framescaper') {
		throw new TypeError('Framescaper desktop project schema family is invalid');
	}
	database.exec(`
		BEGIN IMMEDIATE;
		CREATE TABLE IF NOT EXISTS library_identity (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			schema_version INTEGER NOT NULL CHECK (schema_version = ${String(library)}),
			project_schema_family TEXT NOT NULL CHECK (project_schema_family = '${family}'),
			project_schema_version INTEGER NOT NULL CHECK (project_schema_version = ${String(project)}),
			metadata_revision INTEGER NOT NULL CHECK (metadata_revision >= 0)
		) STRICT;
		INSERT OR IGNORE INTO library_identity VALUES (
			1, ${String(library)}, '${family}', ${String(project)}, 0
		);
		CREATE TABLE IF NOT EXISTS projects (
			entry_id TEXT NOT NULL,
			project_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			updated_at_ms INTEGER NOT NULL,
			project_revision INTEGER NOT NULL,
			document_file TEXT NOT NULL,
			byte_length INTEGER NOT NULL,
			sha256 TEXT NOT NULL,
			bodies_json TEXT NOT NULL
		) STRICT;
		PRAGMA application_id = ${String(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_APPLICATION_ID)};
		PRAGMA user_version = ${String(version)};
		COMMIT;
	`);
	const stored = database.prepare(`
		SELECT schema_version, project_schema_family, project_schema_version
		FROM library_identity WHERE singleton = 1
	`).get() as Record<string, unknown> | undefined;
	if (stored?.schema_version !== library || stored.project_schema_family !== family
		|| stored.project_schema_version !== project) {
		throw new Error(`${identity.label} database identity is invalid`);
	}
}

export function framescaperDesktopProjectLibraryExactGenerationMetadataRevision(
	database: DatabaseSync,
): number {
	return nonNegative((database.prepare(
		'SELECT metadata_revision FROM library_identity WHERE singleton = 1',
	).get() as Record<string, unknown> | undefined)?.metadata_revision, 'metadata revision');
}

export function setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision(
	database: DatabaseSync,
	value: number,
	label: string,
): void {
	if (database.prepare(
		'UPDATE library_identity SET metadata_revision = ? WHERE singleton = 1',
	).run(nonNegative(value, 'metadata revision')).changes !== 1) {
		throw new Error(`${label} metadata revision owner is missing`);
	}
}

function pragma(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	return nonNegative((database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined)?.[name], `PRAGMA ${name}`);
}

function exactPositive(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Exact-generation ${label} is invalid`);
	return value;
}
