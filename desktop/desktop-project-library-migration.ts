/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';

import { migrateDesktopStorageEntries } from './desktop-storage-migration.ts';

export interface DesktopProjectLibraryMigrationOptions {
	readonly legacyAppDataPath: string;
	readonly projectLibraryAppDataPath: string;
	readonly appName: string;
}

/** Relocate only the current product library; archived schema stores remain untouched. */
export async function migrateDesktopProjectLibraries(
	options: DesktopProjectLibraryMigrationOptions,
): Promise<void> {
	const { legacyAppDataPath, projectLibraryAppDataPath, appName } = options;
	for (const [label, path] of Object.entries({ legacyAppDataPath, projectLibraryAppDataPath })) {
		if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
			throw new TypeError(`Desktop project-library ${label} must be an absolute path without NUL bytes.`);
		}
	}
	if (typeof appName !== 'string' || !appName || appName === '.' || appName === '..'
		|| /[/\\\0]/u.test(appName)) {
		throw new TypeError('Desktop project-library appName must be a single path component without NUL bytes.');
	}
	const destination = join(projectLibraryAppDataPath, appName, 'project-library', 'v1');
	const bases = new Set([resolve(legacyAppDataPath), resolve(projectLibraryAppDataPath)]);
	await migrateDesktopStorageEntries([...bases].map((base) => ({
		source: join(base, 'kw.media', `${appName.toLowerCase()}-project-library`, 'v1'),
		destination,
	})));
}
