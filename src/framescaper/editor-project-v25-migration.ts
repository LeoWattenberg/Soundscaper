/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import {
	FramescaperProjectV25ReimportRequiredError,
	loadFramescaperProjectV25,
	type LoadedFramescaperProjectV25,
} from './editor-project-v25.ts';

export interface MigratedFramescaperProjectV25 extends LoadedFramescaperProjectV25 {
	readonly migrated: false;
	readonly fromVersion: number;
}

export function migrateFramescaperProjectV25(profile: unknown, value: unknown): MigratedFramescaperProjectV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 25) throw new FramescaperProjectV25ReimportRequiredError(schemaVersion);
	return Object.freeze({
		...loadFramescaperProjectV25(profile, value),
		migrated: false as const,
		fromVersion: schemaVersion,
	});
}
