/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	loadFramescaperProjectV27,
	type LoadedFramescaperProjectV27,
} from './editor-project-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';

export interface MigratedFramescaperProjectV27 extends LoadedFramescaperProjectV27 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Exact V27 load; earlier maintained generations require the explicit reimport path. */
export function migrateFramescaperProjectV27(
	profile: unknown,
	value: unknown,
): MigratedFramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	const fromVersion = readFramescaperProjectSchemaVersion(value);
	return Object.freeze({
		...loadFramescaperProjectV27(profile, value),
		migrated: false as const,
		fromVersion,
	});
}
