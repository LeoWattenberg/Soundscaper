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

export const FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION = 12 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION = 20 as const;
export const DESKTOP_PROJECT_LIBRARY_V12_APPLICATION_ID = 0x46534350;
export const DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION = 14 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	scopeVersion: 'v12' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v20' as const,
});
const LABEL = 'Framescaper desktop V12';

export type FramescaperDesktopProjectLibraryV12Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV12Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<12, 20, 14, 'v12',
	'kw-media-framescaper-editor-v20'>;

export type FramescaperDesktopProjectLibraryV12Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV12Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV12Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(
		appDataRoot,
		IDENTITY.scopeVersion,
		LABEL,
	);
}

export function validateFramescaperDesktopProjectLibraryV12Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV12Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(
		value,
		IDENTITY.scopeVersion,
		LABEL,
	);
}

export function createFramescaperDesktopProjectLibraryV12Handshake():
	Readonly<FramescaperDesktopProjectLibraryV12Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV12Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV12Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV12Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV12Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
