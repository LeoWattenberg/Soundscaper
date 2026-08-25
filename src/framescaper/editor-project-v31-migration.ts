/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	loadFramescaperProjectV31,
	type LoadedFramescaperProjectV31,
} from './editor-project-v31.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';

export interface MigratedFramescaperProjectV31 extends LoadedFramescaperProjectV31 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Exact F31 load; F28 enters only through the explicit reimport command. */
export function migrateFramescaperProjectV31(
	profile: unknown,
	value: unknown,
): MigratedFramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	return Object.freeze({
		...loadFramescaperProjectV31(profile, value),
		migrated: false as const,
		fromVersion: readFramescaperProjectSchemaVersion(value),
	});
}
