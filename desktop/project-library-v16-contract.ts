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

export const FRAMESCAPER_DESKTOP_LIBRARY_V16_SCHEMA_VERSION = 16 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V16_PROJECT_SCHEMA_VERSION = 26 as const;
export const DESKTOP_PROJECT_LIBRARY_V16_DATABASE_VERSION = 18 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V16_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V16_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V16_DATABASE_VERSION,
	scopeVersion: 'v16' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v26' as const,
});
const LABEL = 'Framescaper desktop V16';

export type FramescaperDesktopProjectLibraryV16Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV16Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<16, 26, 18, 'v16',
	'kw-media-framescaper-editor-v26'>;
export type FramescaperDesktopProjectLibraryV16Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV16Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV16Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v16', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV16Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV16Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v16', LABEL);
}

export function createFramescaperDesktopProjectLibraryV16Handshake(
): Readonly<FramescaperDesktopProjectLibraryV16Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV16Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV16Handshake> {
	const validated = validateFramescaperDesktopProjectLibraryExactGenerationHandshake(
		value, IDENTITY, LABEL,
	);
	return validated;
}

export function validateFramescaperDesktopProjectLibraryV16Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV16Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
