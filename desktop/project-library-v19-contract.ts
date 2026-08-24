/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryExactGenerationHandshake,
	createFramescaperDesktopProjectLibraryExactGenerationPaths,
	validateFramescaperDesktopProjectLibraryExactGenerationHandshake,
	validateFramescaperDesktopProjectLibraryExactGenerationOwner,
	validateFramescaperDesktopProjectLibraryExactGenerationPaths,
	type FramescaperDesktopProjectLibraryExactGenerationHandshake,
	type FramescaperDesktopProjectLibraryExactGenerationOwner,
	type FramescaperDesktopProjectLibraryExactGenerationPaths,
} from './project-library-exact-generation-contract.ts';

export const FRAMESCAPER_DESKTOP_LIBRARY_V19_SCHEMA_VERSION = 19 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V19_PROJECT_SCHEMA_VERSION = 28 as const;
export const DESKTOP_PROJECT_LIBRARY_V19_DATABASE_VERSION = 21 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V19_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V19_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V19_DATABASE_VERSION,
	scopeVersion: 'v19' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v28' as const,
});
const LABEL = 'Framescaper desktop V19';

export type FramescaperDesktopProjectLibraryV19Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV19Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<19, 28, 21, 'v19',
	'kw-media-framescaper-editor-v28'>;
export type FramescaperDesktopProjectLibraryV19Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV19Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV19Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v19', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV19Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV19Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v19', LABEL);
}

export function createFramescaperDesktopProjectLibraryV19Handshake(
): Readonly<FramescaperDesktopProjectLibraryV19Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV19Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV19Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV19Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV19Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
