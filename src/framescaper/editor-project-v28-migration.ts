/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { loadFramescaperProjectV28, type LoadedFramescaperProjectV28 } from './editor-project-v28.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';

export interface MigratedFramescaperProjectV28 extends LoadedFramescaperProjectV28 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Exact V28 load; V27 enters only through the explicit reimport command. */
export function migrateFramescaperProjectV28(profile: unknown, value: unknown): MigratedFramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	return Object.freeze({
		...loadFramescaperProjectV28(profile, value),
		migrated: false as const,
		fromVersion: readFramescaperProjectSchemaVersion(value),
	});
}
