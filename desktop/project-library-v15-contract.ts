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

export const FRAMESCAPER_DESKTOP_LIBRARY_V15_SCHEMA_VERSION = 15 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V15_PROJECT_SCHEMA_VERSION = 25 as const;
export const DESKTOP_PROJECT_LIBRARY_V15_DATABASE_VERSION = 17 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V15_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V15_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V15_DATABASE_VERSION,
	scopeVersion: 'v15' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v25' as const,
});
const LABEL = 'Framescaper desktop V15';

export type FramescaperDesktopProjectLibraryV15Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV15Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<15, 25, 17, 'v15',
	'kw-media-framescaper-editor-v25'>;
export type FramescaperDesktopProjectLibraryV15Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV15Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV15Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v15', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV15Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV15Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v15', LABEL);
}

export function createFramescaperDesktopProjectLibraryV15Handshake(
): Readonly<FramescaperDesktopProjectLibraryV15Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV15Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV15Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV15Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV15Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
