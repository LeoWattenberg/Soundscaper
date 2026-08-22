/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DESKTOP_PROJECT_LIBRARY_V12_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
} from './project-library-v12-contract.ts';
import {
	framescaperDesktopProjectLibraryExactGenerationMetadataRevision,
	initializeFramescaperDesktopProjectLibraryExactGenerationDatabase,
	setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision,
} from './project-library-exact-generation-database.ts';

import type { DatabaseSync } from 'node:sqlite';

export function initializeFramescaperDesktopProjectLibraryV12Database(database: DatabaseSync): void {
	void DESKTOP_PROJECT_LIBRARY_V12_APPLICATION_ID;
	initializeFramescaperDesktopProjectLibraryExactGenerationDatabase(database, {
		label: 'Framescaper desktop V12',
		librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
		projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
		databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	});
}

export function framescaperDesktopProjectLibraryV12MetadataRevision(database: DatabaseSync): number {
	return framescaperDesktopProjectLibraryExactGenerationMetadataRevision(database);
}

export function setFramescaperDesktopProjectLibraryV12MetadataRevision(
	database: DatabaseSync,
	value: number,
): void {
	setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision(database, value, 'Framescaper V12');
}
