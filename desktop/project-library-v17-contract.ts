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

export const FRAMESCAPER_DESKTOP_LIBRARY_V17_SCHEMA_VERSION = 17 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V17_PROJECT_SCHEMA_VERSION = 20 as const;
export const DESKTOP_PROJECT_LIBRARY_V17_DATABASE_VERSION = 19 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V17_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V17_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V17_DATABASE_VERSION,
	scopeVersion: 'v17' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v20' as const,
});
const LABEL = 'Framescaper desktop V17';

export type FramescaperDesktopProjectLibraryV17Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV17Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<17, 20, 19, 'v17',
	'kw-media-framescaper-editor-v20'>;
export type FramescaperDesktopProjectLibraryV17Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV17Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV17Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v17', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV17Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV17Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v17', LABEL);
}

export function createFramescaperDesktopProjectLibraryV17Handshake(
): Readonly<FramescaperDesktopProjectLibraryV17Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV17Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV17Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV17Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV17Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
