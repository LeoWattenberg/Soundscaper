/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fixed directory geometry shared by the two product-scoped desktop libraries. */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export interface FixedProjectLibraryPaths {
	readonly libraryRoot: string;
	readonly databasePath: string;
	readonly projectsRoot: string;
	readonly managedMediaRoot: string;
}

export function fixedProjectLibraryPaths(libraryRoot: string): Readonly<FixedProjectLibraryPaths> {
	return Object.freeze({
		libraryRoot,
		databasePath: join(libraryRoot, 'library.sqlite3'),
		projectsRoot: join(libraryRoot, 'projects'),
		managedMediaRoot: join(libraryRoot, 'media'),
	});
}

export function createFixedProjectLibraryPaths(
	appDataRoot: string,
	scope: readonly string[],
): Readonly<FixedProjectLibraryPaths> {
	return fixedProjectLibraryPaths(resolve(normalize(appDataRoot), ...scope));
}

export function isProjectLibraryDescendant(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
