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

export const FRAMESCAPER_DESKTOP_LIBRARY_V13_SCHEMA_VERSION = 13 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V13_PROJECT_SCHEMA_VERSION = 22 as const;
export const DESKTOP_PROJECT_LIBRARY_V13_DATABASE_VERSION = 15 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V13_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V13_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V13_DATABASE_VERSION,
	scopeVersion: 'v13' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v22' as const,
});
const LABEL = 'Framescaper desktop V13';

export type FramescaperDesktopProjectLibraryV13Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV13Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<13, 22, 15, 'v13',
	'kw-media-framescaper-editor-v22'>;
export type FramescaperDesktopProjectLibraryV13Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV13Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV13Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v13', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV13Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV13Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v13', LABEL);
}

export function createFramescaperDesktopProjectLibraryV13Handshake(
): Readonly<FramescaperDesktopProjectLibraryV13Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV13Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV13Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV13Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV13Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
