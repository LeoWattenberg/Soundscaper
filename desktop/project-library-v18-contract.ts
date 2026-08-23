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

export const FRAMESCAPER_DESKTOP_LIBRARY_V18_SCHEMA_VERSION = 18 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V18_PROJECT_SCHEMA_VERSION = 27 as const;
export const DESKTOP_PROJECT_LIBRARY_V18_DATABASE_VERSION = 20 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V18_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V18_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V18_DATABASE_VERSION,
	scopeVersion: 'v18' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v27' as const,
});
const LABEL = 'Framescaper desktop V18';

export type FramescaperDesktopProjectLibraryV18Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV18Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<18, 27, 20, 'v18',
	'kw-media-framescaper-editor-v27'>;
export type FramescaperDesktopProjectLibraryV18Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV18Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV18Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v18', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV18Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV18Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v18', LABEL);
}

export function createFramescaperDesktopProjectLibraryV18Handshake(
): Readonly<FramescaperDesktopProjectLibraryV18Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV18Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV18Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV18Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV18Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
