/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
	loadFramescaperProjectV18,
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
	type LoadedFramescaperProjectV18,
} from './editor-project-v18.ts';

export class FramescaperProjectReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly schemaVersion: number;
	readonly currentSchemaVersion = FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION;

	constructor(schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} is no longer readable; re-import the source media.`);
		this.name = 'FramescaperProjectReimportRequiredError';
		this.schemaVersion = schemaVersion;
	}
}

export interface MigratedFramescaperProjectV18 extends LoadedFramescaperProjectV18 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** Exact-current migration boundary: V17 is rejected before any nested traversal. */
export function migrateFramescaperProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	value: unknown,
): MigratedFramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION) {
		throw new FramescaperProjectReimportRequiredError(schemaVersion);
	}
	if (schemaVersion > FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION) {
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
		...loadFramescaperProjectV18(profile, value),
		migrated: false,
		fromVersion: schemaVersion,
	};
}
