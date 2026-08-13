/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	loadFramescaperProjectV20,
	type LoadedFramescaperProjectV20,
} from './editor-project-v20.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';

export class FramescaperProjectV20ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly schemaVersion: number;
	readonly currentSchemaVersion = FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION;

	constructor(schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} is no longer readable; re-import the source media.`);
		this.name = 'FramescaperProjectV20ReimportRequiredError';
		this.schemaVersion = schemaVersion;
	}
}

export interface MigratedFramescaperProjectV20 extends LoadedFramescaperProjectV20 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Select exact V20 while retaining future documents as bounded opaque copies. */
export function migrateFramescaperProjectV20(
	profile: FramescaperProjectV20Profile | unknown,
	value: unknown,
): MigratedFramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION) {
		throw new FramescaperProjectV20ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		...loadFramescaperProjectV20(profile, value),
		migrated: false,
		fromVersion: schemaVersion,
	});
}
