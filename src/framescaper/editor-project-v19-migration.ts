/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	loadFramescaperProjectV19,
	type LoadedFramescaperProjectV19,
} from './editor-project-v19.ts';
import {
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
} from './editor-project-v18.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';

export class FramescaperProjectV19ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly schemaVersion: number;
	readonly currentSchemaVersion = FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION;

	constructor(schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} is no longer readable; re-import the source media.`);
		this.name = 'FramescaperProjectV19ReimportRequiredError';
		this.schemaVersion = schemaVersion;
	}
}

export interface MigratedFramescaperProjectV19 extends LoadedFramescaperProjectV19 {
	readonly migrated: false;
	readonly fromVersion: number;
}

export function migrateFramescaperProjectV19(
	profile: EditorProjectRuntimeProfile | unknown,
	value: unknown,
): MigratedFramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION) {
		throw new FramescaperProjectV19ReimportRequiredError(schemaVersion);
	}
	if (schemaVersion > FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION) {
		return {
			project: snapshotFramescaperOpaqueProject(value),
			migrated: false,
			fromVersion: schemaVersion,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		};
	}
	return {
		...loadFramescaperProjectV19(profile, value),
		migrated: false,
		fromVersion: schemaVersion,
	};
}
