/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import {
	FramescaperProjectV26ReimportRequiredError,
	loadFramescaperProjectV26,
	type LoadedFramescaperProjectV26,
} from './editor-project-v26.ts';

export interface MigratedFramescaperProjectV26 extends LoadedFramescaperProjectV26 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Exact V26 custody: older typed media is re-imported, never rewritten. */
export function migrateFramescaperProjectV26(
	profile: unknown,
	value: unknown,
): MigratedFramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 26) throw new FramescaperProjectV26ReimportRequiredError(schemaVersion);
	return Object.freeze({
		...loadFramescaperProjectV26(profile, value),
		migrated: false as const,
		fromVersion: schemaVersion,
	});
}
