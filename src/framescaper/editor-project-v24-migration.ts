/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import {
	FramescaperProjectV24ReimportRequiredError,
	loadFramescaperProjectV24,
	type LoadedFramescaperProjectV24,
} from './editor-project-v24.ts';

export interface MigratedFramescaperProjectV24 extends LoadedFramescaperProjectV24 {
	readonly migrated: false;
	readonly fromVersion: number;
}

export function migrateFramescaperProjectV24(profile: unknown, value: unknown): MigratedFramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 24) throw new FramescaperProjectV24ReimportRequiredError(schemaVersion);
	return Object.freeze({
		...loadFramescaperProjectV24(profile, value),
		migrated: false as const,
		fromVersion: schemaVersion,
	});
}
