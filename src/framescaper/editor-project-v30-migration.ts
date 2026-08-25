/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	loadFramescaperProjectV30,
	type LoadedFramescaperProjectV30,
} from './editor-project-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';

export interface MigratedFramescaperProjectV30 extends LoadedFramescaperProjectV30 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** V30 never implicitly upgrades V28; reimport remains an explicit user operation. */
export function migrateFramescaperProjectV30(
	profile: unknown,
	value: unknown,
): MigratedFramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	const loaded = loadFramescaperProjectV30(profile, value);
	return Object.freeze({
		...loaded,
		migrated: false,
		fromVersion: Number((loaded.project as Readonly<Record<string, unknown>>).schemaVersion),
	});
}
