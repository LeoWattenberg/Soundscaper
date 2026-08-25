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

export const FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION = 20 as const;
export const FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION = 31 as const;
export const DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION = 22 as const;

const IDENTITY = Object.freeze({
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION,
	scopeVersion: 'v20' as const,
	storageDatabaseName: 'kw-media-framescaper-editor-v31' as const,
});
const LABEL = 'Framescaper desktop V20';

export type FramescaperDesktopProjectLibraryV20Paths =
	FramescaperDesktopProjectLibraryExactGenerationPaths;
export type FramescaperDesktopProjectLibraryV20Handshake =
	FramescaperDesktopProjectLibraryExactGenerationHandshake<20, 31, 22, 'v20',
	'kw-media-framescaper-editor-v31'>;
export type FramescaperDesktopProjectLibraryV20Owner =
	FramescaperDesktopProjectLibraryExactGenerationOwner;

export function createFramescaperDesktopProjectLibraryV20Paths(
	appDataRoot: string,
): Readonly<FramescaperDesktopProjectLibraryV20Paths> {
	return createFramescaperDesktopProjectLibraryExactGenerationPaths(appDataRoot, 'v20', LABEL);
}

export function validateFramescaperDesktopProjectLibraryV20Paths(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV20Paths> {
	return validateFramescaperDesktopProjectLibraryExactGenerationPaths(value, 'v20', LABEL);
}

export function createFramescaperDesktopProjectLibraryV20Handshake(
): Readonly<FramescaperDesktopProjectLibraryV20Handshake> {
	return createFramescaperDesktopProjectLibraryExactGenerationHandshake(IDENTITY);
}

export function validateFramescaperDesktopProjectLibraryV20Handshake(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV20Handshake> {
	return validateFramescaperDesktopProjectLibraryExactGenerationHandshake(value, IDENTITY, LABEL);
}

export function validateFramescaperDesktopProjectLibraryV20Owner(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV20Owner> {
	return validateFramescaperDesktopProjectLibraryExactGenerationOwner(value, LABEL);
}
