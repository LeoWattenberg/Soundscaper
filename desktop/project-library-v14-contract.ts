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

export const FRAMESCAPER_DESKTOP_LIBRARY_V14_SCHEMA_VERSION = 14 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V14_PROJECT_SCHEMA_VERSION = 24 as const;
export const DESKTOP_PROJECT_LIBRARY_V14_DATABASE_VERSION = 16 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V14_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V14_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V14_DATABASE_VERSION,
	scopeVersion: 'v14' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v24' as const,
});
const LABEL = 'Framescaper desktop V14';

export type FramescaperDesktopProjectLibraryV14Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV14Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<14, 24, 16, 'v14',
	'kw-media-framescaper-editor-v24'>;
export type FramescaperDesktopProjectLibraryV14Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV14Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV14Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v14', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV14Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV14Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v14', LABEL);
}

export function createFramescaperDesktopProjectLibraryV14Handshake(
): Readonly<FramescaperDesktopProjectLibraryV14Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV14Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV14Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV14Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV14Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
