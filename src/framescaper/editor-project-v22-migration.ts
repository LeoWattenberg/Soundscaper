/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import {
	FramescaperProjectV22ReimportRequiredError,
	loadFramescaperProjectV22,
	type LoadedFramescaperProjectV22,
} from './editor-project-v22.ts';

export interface MigratedFramescaperProjectV22 extends LoadedFramescaperProjectV22 {
	readonly migrated: false;
	readonly fromVersion: number;
}

export function migrateFramescaperProjectV22(profile: unknown, value: unknown): MigratedFramescaperProjectV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 22) throw new FramescaperProjectV22ReimportRequiredError(schemaVersion);
	return Object.freeze({
		...loadFramescaperProjectV22(profile, value),
		migrated: false as const,
		fromVersion: schemaVersion,
	});
}
